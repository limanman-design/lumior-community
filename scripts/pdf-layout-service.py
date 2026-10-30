"""Local two-stage PDF layout worker; model credentials stay in the web API.

The web API proxies requests to this loopback-only service. Each engine run has
its own process group because BabelDOC adapters patch engine internals.
Windows cancellation force-closes the child tree before its leader can exit.
"""

from __future__ import annotations

import argparse
from collections import Counter, defaultdict, deque
from dataclasses import dataclass, field
from email.parser import BytesParser
from email.policy import default
import hashlib
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
import logging
import math
import os
from pathlib import Path
import re
import signal
import shutil
import subprocess
import sys
import threading
import time
import uuid

from pdf_layout_input import InputQualityError, inspect_source_layout

TOKEN = re.compile(r"\{\s*v\s*(\d+)\s*\}|<\s*style\s+id=['\"](\d+)['\"]\s*>|<\s*/\s*style\s*>")
MAX_PDF = 25 * 1024 * 1024
MAX_REQUEST = 27 * 1024 * 1024
CACHE_MARKER = ".lumior-layout-job.json"
CACHE_RETENTION = 24 * 3600
CACHE_SWEEP_INTERVAL = 300
MAX_RECOVERY_DIRECTORIES = 128
MAX_RECOVERY_JOBS = 8
MAX_RECOVERED_CHARACTERS = 2_000_000
ACTIVE = {"preparing", "prepared", "rendering"}
LOGGER = logging.getLogger("lumior.pdf.layout")
TERMINATING_GROUPS = set()
GROUP_LOCK = threading.Lock()


def loopback_port(value):
    if not re.fullmatch(r"[0-9]+", str(value)) or not 1 <= int(value) <= 65535:
        raise argparse.ArgumentTypeError("port must be an integer between 1 and 65535")
    return int(value)


def engine_process_options():
    if sys.platform == "win32":
        return {"creationflags": subprocess.CREATE_NEW_PROCESS_GROUP | subprocess.CREATE_NO_WINDOW}
    return {"start_new_session": True}


class ServiceError(ValueError):
    def __init__(self, message, status=400):
        super().__init__(message)
        self.status = status


def token_signature(text):
    counts, stack, ancestry = Counter(), [], Counter()
    for token in TOKEN.finditer(text):
        if token.group(1) is not None:
            counts[("formula", token.group(1))] += 1
        elif token.group(2) is not None:
            identity = token.group(2)
            counts[("style", identity)] += 1
            # Translation may reorder sibling styled phrases. Preserve each
            # style's parent chain and multiplicity, rather than sibling order.
            ancestry[(tuple(stack), identity)] += 1
            stack.append(identity)
        else:
            if not stack:
                raise ServiceError("译文样式标记不完整，本段未保存，请重试。")
            stack.pop()
    if stack:
        raise ServiceError("译文样式标记不完整，本段未保存，请重试。")
    return counts, ancestry


def validate_placeholders(source, target):
    if token_signature(source) != token_signature(target):
        raise ServiceError("译文改变了公式或文字样式标记，本段未保存，请重试。")


def render_reports_verified(report, unicode_qa, layout_qa, manifest):
    source = layout_qa.get("sourceExtraction", {})
    return (not report.get("missing") and not report.get("placeholderErrors")
            and unicode_qa.get("passed") is True
            and unicode_qa.get("pixelIdentical") is True
            and unicode_qa.get("unchangedDrawingStreams") is True
            and layout_qa.get("passed") is True and manifest.get("qaPassed") is True
            and source.get("performed") is True and source.get("passed") is True)


def normalize_placeholder_spelling(source, target):
    """Restore exact source token spelling only after semantic validation.

    BabelDOC's fixture adapter deliberately compares literal token strings.
    Equivalent model quote/spacing choices must not cause a later rejection,
    but changed IDs, counts, or style nesting remain invalid.
    """
    validate_placeholders(source, target)
    spellings = defaultdict(deque)
    def identity(token):
        if token.group(1) is not None:
            return ("formula", token.group(1))
        if token.group(2) is not None:
            return ("style", token.group(2))
        return ("close",)
    for token in TOKEN.finditer(source):
        spellings[identity(token)].append(token.group(0))
    return TOKEN.sub(lambda token: spellings[identity(token)].popleft(), target)


def character_length(text):
    # Match JavaScript's existing 4500 UTF-16-unit request limit.
    return len(text.encode("utf-16-le")) // 2


def update_stack(stack, tokens):
    value = list(stack)
    for token in tokens:
        if token.group(2) is not None:
            value.append(token.group(2))
        elif token.group(1) is None:
            if not value:
                raise ServiceError("原文样式无法可靠读取，请使用普通译文方式。")
            value.pop()
    return value


def split_protected_text(text, limit=4500):
    """Keep tokens intact and balance styles while retaining exact source slices.

    Prefix/suffix tags introduced only for slice balancing are recorded so they
    can be removed after translation, before checking the complete paragraph.
    """
    token_signature(text)
    tokens = list(TOKEN.finditer(text))
    chunks, start, stack = [], 0, []
    while start < len(text):
        prefix = "".join(f"<style id='{identity}'>" for identity in stack)
        end = min(len(text), start + limit - len(prefix))
        while True:
            for token in tokens:
                if token.start() < end < token.end():
                    end = token.start()
                    break
            relevant = [token for token in tokens if start <= token.start() < end]
            ending_stack = update_stack(stack, relevant)
            suffix = "</style>" * len(ending_stack)
            over = character_length(prefix + text[start:end] + suffix) - limit
            if over <= 0:
                break
            end -= over
        if end <= start:
            raise ServiceError("这个段落的样式层级过深，无法可靠分片，请使用普通译文方式。")
        if end < len(text):
            # Prefer a word/line boundary when it does not waste most of a batch.
            candidates = [match.end() for match in re.finditer(r"\s+|(?<=[。！？;])", text[start:end])]
            candidates = [start + value for value in candidates if value >= (end - start) // 2]
            candidates = [value for value in candidates if not any(token.start() < value < token.end() for token in tokens)]
            if candidates:
                end = candidates[-1]
                relevant = [token for token in tokens if start <= token.start() < end]
                ending_stack = update_stack(stack, relevant)
                suffix = "</style>" * len(ending_stack)
        source_slice = text[start:end]
        chunk = {"text": prefix + source_slice + suffix, "slice": source_slice,
                 "prefixIds": list(stack), "suffixCount": len(ending_stack)}
        token_signature(chunk["text"])
        if character_length(chunk["text"]) > limit:
            raise ServiceError("原文分片超过完整翻译容量。")
        chunks.append(chunk)
        start, stack = end, ending_stack
    return chunks


def remove_slice_wrappers(target, chunk):
    text = target.strip()
    for identity in chunk["prefixIds"]:
        token = TOKEN.match(text)
        if not token or token.group(2) != identity:
            raise ServiceError("长段译文的样式边界被移动，本段未保存，请重试。")
        text = text[token.end():]
    for _ in range(chunk["suffixCount"]):
        tokens = list(TOKEN.finditer(text))
        token = tokens[-1] if tokens else None
        if not token or token.end() != len(text) or token.group(1) is not None or token.group(2) is not None:
            raise ServiceError("长段译文的样式边界被移动，本段未保存，请重试。")
        text = text[:token.start()]
    return text


def stable_unit_id(page, source, chunk_index):
    payload = json.dumps([page, source, chunk_index], ensure_ascii=False, separators=(",", ":")).encode("utf-8")
    return f"{page}:{int.from_bytes(hashlib.sha256(payload).digest()[:16], 'big')}"


def prepare_units(requests, total_pages, *, legacy_ids=False):
    units, mappings, counters, seen = [], [], defaultdict(int), set()
    for row in sorted(requests, key=lambda value: (value["key"], value["source"])):
        page = row.get("page", 1)
        if not isinstance(page, int) or not 1 <= page <= total_pages:
            page = 1
        source = row["source"]
        chunks = split_protected_text(source)
        identities = []
        for chunk_index, chunk in enumerate(chunks):
            identity = f"{page}:{counters[page]}" if legacy_ids else stable_unit_id(page, source, chunk_index)
            counters[page] += 1
            if identity in seen:
                raise ServiceError("原文段落编号重复，无法可靠复用译文。")
            seen.add(identity)
            units.append({"id": identity, "page": page, "text": chunk["text"], "protected": True})
            identities.append(identity)
        mappings.append({"source": source, "ids": identities, "chunks": chunks})
    return units, mappings


def legacy_resume_receipts(requests, translations, current_units, current_mappings, total_pages):
    """Bind old ordinal IDs to exact source/target pairs, never to their position.

    Engine targets combine long translated slices. Their original target slice
    boundaries cannot be recovered, so only unambiguous single-slice receipts
    are returned; multi-slice drafts are translated again instead of guessed.
    """
    if not isinstance(requests, list) or not isinstance(translations, list) or len(requests) > 2000 or len(translations) > 2000:
        return []
    if any(not isinstance(row, dict) or not isinstance(row.get("key"), str)
           or not isinstance(row.get("source"), str) or not row["source"].strip()
           or type(row.get("page", 1)) is not int or not 1 <= row.get("page", 1) <= total_pages
           for row in requests):
        return []
    targets = {}
    for row in translations:
        if not isinstance(row, dict) or not isinstance(row.get("source"), str) or row["source"] in targets:
            return []
        target = row.get("target")
        if not isinstance(target, str) or not target.strip() or character_length(target) > 20000:
            continue
        try:
            # Reject malformed reserved tokens as well as altered valid tokens.
            for text in (row["source"], target):
                if re.search(r"\{\s*v|<\s*/?\s*style\b", TOKEN.sub("", text), re.IGNORECASE):
                    raise ServiceError("译文保护标记格式不正确。")
            targets[row["source"]] = normalize_placeholder_spelling(row["source"], target)
        except ServiceError:
            continue
    old_units, old_mappings = prepare_units(requests, total_pages, legacy_ids=True)
    new_units, new_mappings = prepare_units(requests, total_pages)
    old_by_id, new_by_id = ({unit["id"]: unit for unit in values} for values in (old_units, new_units))
    current_by_id = {unit["id"]: unit for unit in current_units}
    current_sources = {mapping["source"] for mapping in current_mappings}
    receipts = []
    for old, new in zip(old_mappings, new_mappings):
        source = old["source"]
        if source not in current_sources or source not in targets or len(old["ids"]) != 1:
            continue
        old_id, new_id = old["ids"][0], new["ids"][0]
        unit = new_by_id[new_id]
        if current_by_id.get(new_id) != unit:
            continue
        receipts.append({"id": new_id, "legacyId": old_id, "page": old_by_id[old_id]["page"], "text": targets[source]})
    return receipts


def recovered_translation_units(requests, translations, current_units, current_mappings, total_pages):
    """Recover only exact source-bound, complete translated paragraph slices.

    Older caches have only a combined target, so their long paragraphs cannot
    be split again safely. New caches retain each validated slice as a receipt;
    a missing or changed slice makes the entire paragraph ineligible.
    """
    if not isinstance(requests, list) or not isinstance(translations, list) or len(requests) > 2000 or len(translations) > 2000:
        return []
    if any(not isinstance(row, dict) or not isinstance(row.get("key"), str)
           or not isinstance(row.get("source"), str) or not row["source"].strip()
           or type(row.get("page", 1)) is not int or not 1 <= row.get("page", 1) <= total_pages
           for row in requests):
        return []
    previous_units, previous_mappings = prepare_units(requests, total_pages)
    if len(previous_units) > 2000 or sum(character_length(unit["text"]) for unit in previous_units) > 2_000_000:
        return []
    previous_by_id = {unit["id"]: unit for unit in previous_units}
    current_by_id = {unit["id"]: unit for unit in current_units}
    current_mapping_ids = {(mapping["source"], tuple(mapping["ids"])) for mapping in current_mappings}
    targets = {}
    for row in translations:
        if not isinstance(row, dict) or not isinstance(row.get("source"), str) or row["source"] in targets:
            return []
        targets[row["source"]] = row
    recovered = []
    for mapping in previous_mappings:
        if (mapping["source"], tuple(mapping["ids"])) not in current_mapping_ids:
            continue
        row = targets.get(mapping["source"])
        if row is None or any(previous_by_id[identity] != current_by_id.get(identity) for identity in mapping["ids"]):
            continue
        target = row.get("target")
        if not isinstance(target, str) or not target.strip():
            continue
        try:
            for text in (mapping["source"], target):
                if re.search(r"\{\s*v|<\s*/?\s*style\b", TOKEN.sub("", text), re.IGNORECASE):
                    raise ServiceError("译文保护标记格式不正确。")
            normalized = normalize_placeholder_spelling(mapping["source"], target)
            if "chunks" not in row:
                if len(mapping["ids"]) != 1 or character_length(normalized) > 20000:
                    continue
                values = [normalized]
            else:
                chunks = row["chunks"]
                if not isinstance(chunks, list) or len(chunks) != len(mapping["ids"]):
                    continue
                values = []
                for receipt, identity, chunk in zip(chunks, mapping["ids"], mapping["chunks"]):
                    if (not isinstance(receipt, dict) or receipt.get("id") != identity
                            or receipt.get("source") != chunk["text"] or not isinstance(receipt.get("target"), str)
                            or not receipt["target"].strip() or character_length(receipt["target"]) > 20000
                            or re.search(r"\{\s*v|<\s*/?\s*style\b", TOKEN.sub("", receipt["target"]), re.IGNORECASE)):
                        raise ServiceError("译文分片缓存无法核对。")
                    values.append(normalize_placeholder_spelling(chunk["text"], receipt["target"]))
                joined = "".join(remove_slice_wrappers(value, chunk) for value, chunk in zip(values, mapping["chunks"]))
                if normalize_placeholder_spelling(mapping["source"], joined) != normalized:
                    continue
            recovered.extend({"id": identity, "page": previous_by_id[identity]["page"], "text": value}
                             for identity, value in zip(mapping["ids"], values))
        except ServiceError:
            continue
    return recovered


def paragraph_rects(rects):
    groups = {}
    for item in rects:
        rectangle, identity = item["rect"], item["id"]
        x, y = rectangle["x"], rectangle["y"]
        bounds = (x, y, x + rectangle["width"], y + rectangle["height"])
        if identity in groups:
            old = groups[identity]
            bounds = (min(old[0], bounds[0]), min(old[1], bounds[1]), max(old[2], bounds[2]), max(old[3], bounds[3]))
        groups[identity] = bounds
    return [{"id": identity, "rect": {"x": bounds[0], "y": bounds[1], "width": bounds[2] - bounds[0], "height": bounds[3] - bounds[1]}}
            for identity, bounds in groups.items()]


@dataclass
class Job:
    identity: str
    owner: str
    generation: int
    directory: Path
    source_hash: str
    pages: str | None = None
    stage: str = "preparing"
    expires: float = 0
    process: subprocess.Popen | None = None
    retired: bool = False
    prepared: dict | None = None
    mappings: list = field(default_factory=list)
    artifact: dict | None = None
    pdf: Path | None = None
    error: str | None = None
    progress: str = "正在读取 PDF 版式…"
    updated: float = field(default_factory=time.monotonic)


class LayoutService:
    def __init__(self, python, cache, work_root, *, lease=90, clock=time.monotonic, wall_clock=time.time):
        self.python, self.cache, self.work_root = Path(python), Path(cache), Path(work_root)
        self.lease, self.clock, self.wall_clock = lease, clock, wall_clock
        self.jobs, self.cancelled, self.generations = {}, {}, {}
        self.lock = threading.RLock()
        self.scripts = Path(__file__).resolve().parent
        self.work_root.mkdir(parents=True, exist_ok=True)
        self.last_cache_sweep = -math.inf
        self.cleanup_cache(force=True)

    def cache_file(self, directory, relative, maximum):
        """Return only bounded ordinary files inside one marked job directory."""
        path = directory
        for component in Path(relative).parts:
            path = path / component
            if path.is_symlink():
                raise ValueError("Cache links are not migration evidence")
        if not path.is_file() or path.stat().st_size > maximum:
            raise ValueError("Cache file is missing or too large")
        if not path.resolve().is_relative_to(directory.resolve()):
            raise ValueError("Cache file is outside its owned directory")
        return path

    def resume_units(self, job, units, mappings):
        """Read receipts only after the service marker identifies the same PDF."""
        receipts, seen = [], set()
        try:
            directories = list(self.work_root.iterdir())
        except OSError:
            return receipts
        for directory in directories:
            try:
                if directory == job.directory or directory.is_symlink() or not directory.is_dir() or str(uuid.UUID(directory.name)) != directory.name:
                    continue
                marker = self.cache_file(directory, CACHE_MARKER, 4096)
                metadata = json.loads(marker.read_text(encoding="utf-8"))
                if not isinstance(metadata, dict) or type(metadata.get("version")) is not int or metadata["version"] != 1 or metadata.get("jobId") != directory.name:
                    continue
                created = metadata.get("createdAt")
                if type(created) not in (int, float) or not math.isfinite(created) or created < 0 or created > self.wall_clock() or self.wall_clock() - created > CACHE_RETENTION:
                    continue
                # Inspect no other PDF contents. Old markers without a source
                # hash need explicit verification before they become eligible.
                if metadata.get("sourceHash") != job.source_hash:
                    continue
                if metadata.get("unitIdScheme") != "ordinal-v1":
                    continue
                if "ownerId" in metadata and metadata["ownerId"] != job.owner:
                    continue
                if "ownerGeneration" in metadata and (type(metadata["ownerGeneration"]) is not int or metadata["ownerGeneration"] < 1):
                    continue
                original = self.cache_file(directory, "input.pdf", MAX_PDF)
                if hashlib.sha256(original.read_bytes()).hexdigest() != job.source_hash:
                    continue
                requests = json.loads(self.cache_file(directory, "collect/requests.json", MAX_REQUEST).read_text(encoding="utf-8"))
                translations = json.loads(self.cache_file(directory, "translations.json", MAX_REQUEST).read_text(encoding="utf-8"))
                candidates = legacy_resume_receipts(requests, translations, units, mappings, job.prepared["totalPages"])
                for receipt in candidates:
                    identity = (receipt["id"], receipt["legacyId"], receipt["text"])
                    if identity not in seen:
                        receipts.append(receipt)
                        seen.add(identity)
            except (ValueError, TypeError, KeyError, OSError):
                # An invalid cache cannot authorize migration or block a fresh
                # translation. No local path or source is exposed in the reply.
                continue
        return receipts

    def recovered_units(self, job, units, mappings):
        """Reuse recent same-owner stable-ID caches without exposing other jobs."""
        candidates = []
        try:
            entries = self.work_root.iterdir()
            for index, directory in enumerate(entries):
                if index >= MAX_RECOVERY_DIRECTORIES:
                    break
                try:
                    if directory == job.directory or directory.is_symlink() or not directory.is_dir() or str(uuid.UUID(directory.name)) != directory.name:
                        continue
                    metadata = json.loads(self.cache_file(directory, CACHE_MARKER, 4096).read_text(encoding="utf-8"))
                    created = metadata.get("createdAt") if isinstance(metadata, dict) else None
                    if (not isinstance(metadata, dict) or type(metadata.get("version")) is not int or metadata["version"] != 1
                            or metadata.get("jobId") != directory.name or metadata.get("unitIdScheme") != "source-hash-v2"
                            or metadata.get("ownerId") != job.owner or metadata.get("sourceHash") != job.source_hash
                            or type(metadata.get("ownerGeneration")) is not int or metadata["ownerGeneration"] < 1
                            or type(created) not in (int, float) or not math.isfinite(created) or created < 0
                            or created > self.wall_clock() or self.wall_clock() - created > CACHE_RETENTION):
                        continue
                    active = self.jobs.get(directory.name)
                    if active and active.stage in ACTIVE:
                        continue
                    candidates.append((created, directory))
                except (ValueError, TypeError, KeyError, OSError):
                    continue
        except OSError:
            return []
        recovered, seen, characters = [], set(), 0
        for _created, directory in sorted(candidates, key=lambda item: item[0], reverse=True)[:MAX_RECOVERY_JOBS]:
            try:
                original = self.cache_file(directory, "input.pdf", MAX_PDF)
                if hashlib.sha256(original.read_bytes()).hexdigest() != job.source_hash:
                    continue
                requests = json.loads(self.cache_file(directory, "collect/requests.json", MAX_REQUEST).read_text(encoding="utf-8"))
                translations = json.loads(self.cache_file(directory, "translations.json", MAX_REQUEST).read_text(encoding="utf-8"))
                values = recovered_translation_units(requests, translations, units, mappings, job.prepared["totalPages"])
                # Admit whole paragraphs only; never partially restore a long
                # paragraph because the response budget was reached mid-slice.
                by_id = {unit["id"]: unit for unit in values}
                for mapping in mappings:
                    identities = mapping["ids"]
                    if any(identity in seen or identity not in by_id for identity in identities):
                        continue
                    size = sum(character_length(by_id[identity]["text"]) for identity in identities)
                    if len(recovered) + len(identities) > 2000 or characters + size > MAX_RECOVERED_CHARACTERS:
                        continue
                    recovered.extend(by_id[identity] for identity in identities)
                    seen.update(identities)
                    characters += size
            except (ValueError, TypeError, KeyError, OSError):
                continue
        return recovered

    def cleanup_cache(self, *, force=False):
        """Remove only expired, marked temporary jobs within this service root."""
        now = self.clock()
        with self.lock:
            if not force and now - self.last_cache_sweep < CACHE_SWEEP_INTERVAL:
                return
            self.last_cache_sweep = now
            wall_now = self.wall_clock()
            try:
                entries = list(self.work_root.iterdir())
            except OSError:
                LOGGER.exception("Could not scan the local layout cache")
                return
            for directory in entries:
                try:
                    if directory.is_symlink() or not directory.is_dir() or str(uuid.UUID(directory.name)) != directory.name:
                        continue
                    marker = directory / CACHE_MARKER
                    if marker.is_symlink() or not marker.is_file() or marker.stat().st_size > 4096:
                        continue
                    metadata = json.loads(marker.read_text(encoding="utf-8"))
                    if not isinstance(metadata, dict) or type(metadata.get("version")) is not int or metadata.get("version") != 1 or metadata.get("jobId") != directory.name:
                        continue
                    created = metadata.get("createdAt")
                    if type(created) not in (int, float) or not math.isfinite(created) or created < 0 or wall_now - created <= CACHE_RETENTION:
                        continue
                    job = self.jobs.get(directory.name)
                    if job and (job.stage in ACTIVE or job.process and job.process.poll() is None):
                        continue
                    # rmtree removes interior links without following their
                    # targets. The top-level directory itself must never be a link.
                    shutil.rmtree(directory)
                    self.jobs.pop(directory.name, None)
                except (ValueError, TypeError, OSError):
                    # Malformed/unmarked or concurrently changed entries remain
                    # untouched; these are not evidence of service ownership.
                    continue

    def identity(self, body):
        identity, owner, generation = body.get("jobId"), body.get("ownerId"), body.get("ownerGeneration")
        try:
            if str(uuid.UUID(identity)) != identity:
                raise ValueError()
        except (TypeError, ValueError, AttributeError):
            raise ServiceError("翻译任务编号不正确。") from None
        if not isinstance(owner, str) or not re.fullmatch(r"[a-zA-Z0-9-]{1,80}", owner):
            raise ServiceError("翻译任务归属不正确。")
        if type(generation) is not int or generation < 1:
            raise ServiceError("翻译任务代次不正确。")
        return identity, owner, generation

    def clean(self):
        now = self.clock()
        with self.lock:
            for identity, expiry in list(self.cancelled.items()):
                if expiry < now:
                    del self.cancelled[identity]
            stale = [job for job in self.jobs.values() if job.stage in ACTIVE and now >= job.expires]
        for job in stale:
            self.retire(job)
        with self.lock:
            for identity, job in list(self.jobs.items()):
                if job.stage not in ACTIVE and now - job.updated > 3600:
                    self.jobs.pop(identity, None)
        self.cleanup_cache()

    def retire(self, job):
        with self.lock:
            job.retired = True
            job.stage = "cancelled"
            job.updated = self.clock()
            self.cancelled[job.identity] = self.clock() + 60
            process = job.process
        if process:
            terminate_process_group(process)

    def owned(self, body):
        identity, owner, generation = self.identity(body)
        job = self.jobs.get(identity)
        if not job:
            raise ServiceError("翻译任务已释放，可重新开始。", 404)
        if job.owner != owner or job.generation != generation:
            raise ServiceError("翻译任务归属不一致。", 403)
        return job

    def status(self, job):
        with self.lock:
            result = {"jobId": job.identity, "stage": job.stage, "progress": job.progress}
            if job.error:
                result["error"] = job.error
            if job.stage == "prepared":
                result.update(job.prepared)
            elif job.stage == "complete":
                result["artifact"] = job.artifact
            return result

    def prepare(self, body, data):
        identity, owner, generation = self.identity(body)
        if not data or len(data) > MAX_PDF or not data.lstrip().startswith(b"%PDF-"):
            raise ServiceError("请提供完整的 PDF，文件最大为 25 MB。")
        pages = body.get("pages")
        if pages is not None and (not isinstance(pages, str) or not re.fullmatch(r"\d+(?:-\d+)?(?:,\d+(?:-\d+)?)*", pages)):
            raise ServiceError("PDF 页码范围不正确。")
        self.clean()
        with self.lock:
            if identity in self.cancelled:
                raise ServiceError("翻译已停止，可重新打开后继续。", 409)
            if identity in self.jobs:
                raise ServiceError("同一翻译任务已存在。", 409)
            if generation <= self.generations.get(owner, 0):
                raise ServiceError("翻译请求已过期，可继续翻译。", 409)
            orphans = [job for job in self.jobs.values() if job.owner == owner and job.stage in ACTIVE]
            for job in orphans:
                self.retire(job)
            if sum(job.stage in ACTIVE for job in self.jobs.values()) >= 2:
                raise ServiceError("正在翻译其他资料，请稍后重试。", 429)
            self.generations[owner] = generation
            directory = self.work_root / identity
            if directory.exists() or directory.is_symlink():
                raise ServiceError("同一翻译任务已存在，请重新开始。", 409)
            directory.mkdir(parents=True, exist_ok=False)
            source_hash = hashlib.sha256(data).hexdigest()
            (directory / CACHE_MARKER).write_text(json.dumps({"version": 1, "jobId": identity, "createdAt": self.wall_clock(),
                                                           "sourceHash": source_hash, "ownerId": owner, "ownerGeneration": generation,
                                                           "unitIdScheme": "source-hash-v2"}))
            (directory / "input.pdf").write_bytes(data)
            job = Job(identity, owner, generation, directory, source_hash, pages=pages,
                      expires=self.clock() + self.lease, updated=self.clock())
            self.jobs[identity] = job
        threading.Thread(target=self.run_prepare, args=(job,), daemon=True).start()
        return self.status(job)

    def run_command(self, job, command):
        with (job.directory / "engine.log").open("ab") as diagnostics:
            with self.lock:
                if job.retired:
                    raise ServiceError("翻译已停止。", 409)
                process = subprocess.Popen(command, stdout=diagnostics, stderr=subprocess.STDOUT,
                                           cwd=self.scripts.parent, **engine_process_options())
                job.process = process
            code = process.wait()
            with self.lock:
                if job.process is process:
                    job.process = None
                if job.retired:
                    raise ServiceError("翻译已停止。", 409)
            if code:
                raise ServiceError("版式处理未通过检查，已保留译文；可重试或使用普通译文方式。", 422)

    def engine_command(self, job, *, collect):
        command = [str(self.python), str(self.scripts / "pdf-layout-prototype.py"), str(job.directory / "input.pdf"),
                   "--pages", job.pages or f"1-{job.prepared['totalPages']}",
                   "--output", str(job.directory / ("collected-pdf" if collect else "output")),
                   "--work", str(job.directory / ("collect" if collect else "render")), "--cache", str(self.cache)]
        if collect:
            command.append("--collect")
        else:
            command.extend(["--translations", str(job.directory / "translations.json"), "--allow-original-formula-cids"])
        return command

    def fail(self, job, failure):
        LOGGER.exception("Layout job failed: %s", job.identity)
        with self.lock:
            if not job.retired:
                job.stage = "error"
                job.error = str(failure) if isinstance(failure, (ServiceError, InputQualityError)) else "原版式处理失败，已保留完成的译文，可重试。"
                job.updated = self.clock()

    def run_prepare(self, job):
        try:
            metadata_path = job.directory / "input-metadata.json"
            try:
                self.run_command(job, [str(self.python), str(self.scripts / "pdf_layout_input.py"), str(job.directory / "input.pdf"), "--output", str(metadata_path)])
            except ServiceError:
                if metadata_path.exists():
                    metadata = json.loads(metadata_path.read_text())
                    if metadata.get("error"):
                        raise InputQualityError(metadata["error"]) from None
                raise
            metadata = json.loads(metadata_path.read_text())
            job.prepared = {"sourceHash": job.source_hash, "totalPages": metadata["totalPages"], "emptyPages": metadata["emptyPages"]}
            self.run_command(job, self.engine_command(job, collect=True))
            source = json.loads((job.directory / "collect/source-layout.json").read_text())
            requests = json.loads((job.directory / "collect/requests.json").read_text())
            inspect_source_layout(source, requests)
            units, mappings = prepare_units(requests, metadata["totalPages"])
            if len(units) > 2000 or sum(character_length(unit["text"]) for unit in units) > 2_000_000:
                raise ServiceError("资料超过本轮完整翻译容量，请拆分 PDF。", 413)
            resume_units = self.resume_units(job, units, mappings)
            recovered_units = self.recovered_units(job, units, mappings)
            with self.lock:
                if job.retired:
                    return
                job.prepared["units"] = units
                job.prepared["resumeUnits"] = resume_units
                job.prepared["recoveredUnits"] = recovered_units
                job.mappings = mappings
                job.stage = "prepared"
                job.progress = "原文版式已读取，正在准备翻译…"
                job.updated = self.clock()
        except Exception as failure:
            self.fail(job, failure)

    def render(self, body):
        with self.lock:
            job = self.owned(body)
            if job.stage != "prepared":
                raise ServiceError("版式准备尚未完成，或任务已释放。", 409)
            values = body.get("units")
            expected = {unit["id"]: unit for unit in job.prepared["units"]}
            if not isinstance(values, list) or len(values) != len(expected):
                raise ServiceError("译文尚未覆盖全部原文，完成的部分已保留。")
            translated = {}
            for unit in values:
                if not isinstance(unit, dict) or unit.get("id") not in expected or unit["id"] in translated or not isinstance(unit.get("text"), str) or not unit["text"].strip() or len(unit["text"]) > 20000:
                    raise ServiceError("译文段落不完整或重复，完成的部分已保留。")
                validate_placeholders(expected[unit["id"]]["text"], unit["text"])
                translated[unit["id"]] = unit["text"]
            rows = []
            for mapping in job.mappings:
                target = "".join(remove_slice_wrappers(translated[identity], chunk)
                                 for identity, chunk in zip(mapping["ids"], mapping["chunks"]))
                target = normalize_placeholder_spelling(mapping["source"], target)
                rows.append({"source": mapping["source"], "target": target,
                             "chunks": [{"id": identity, "source": chunk["text"],
                                         "target": normalize_placeholder_spelling(chunk["text"], translated[identity])}
                                        for identity, chunk in zip(mapping["ids"], mapping["chunks"])]})
            (job.directory / "translations.json").write_text(json.dumps(rows, ensure_ascii=False))
            job.stage = "rendering"
            job.progress = "正在回填原版式并检查文字和公式…"
            job.updated = self.clock()
        threading.Thread(target=self.run_render, args=(job,), daemon=True).start()
        return self.status(job)

    def run_render(self, job):
        try:
            self.run_command(job, self.engine_command(job, collect=False))
            self.run_command(job, [str(self.python), str(self.scripts / "check-pdf-layout.py"), "--work", str(job.directory / "render")])
            report = json.loads((job.directory / "render/run-report.json").read_text())
            unicode_qa = json.loads((job.directory / "render/unicode-qa.json").read_text())
            layout_qa = json.loads((job.directory / "render/layout-qa.json").read_text())
            manifest = json.loads((job.directory / "render/hover-manifest.json").read_text())
            if not render_reports_verified(report, unicode_qa, layout_qa, manifest):
                raise ServiceError("译文未通过完整性或版式检查，已保留完成的译文；请使用普通译文方式。", 422)
            pdf = Path(report["pdf"]).resolve()
            if not pdf.is_relative_to((job.directory / "output").resolve()):
                raise ServiceError("译文生成结果无法核对。", 422)
            data = pdf.read_bytes()
            artifact = {"name": "中文译文.pdf", "size": len(data), "sha256": hashlib.sha256(data).hexdigest(),
                        "engine": "BabelDOC", "engineVersion": "0.6.4",
                        "pages": [{"source": page["source"], "target": page["target"],
                                   "rects": paragraph_rects(page["rects"]), "sourceRects": paragraph_rects(page["sourceRects"])}
                                  for page in manifest["pages"]]}
            with self.lock:
                if not job.retired:
                    job.pdf, job.artifact, job.stage = pdf, artifact, "complete"
                    job.progress = "翻译完成，原版式 PDF 已通过检查。"
                    job.updated = self.clock()
        except Exception as failure:
            self.fail(job, failure)

    def action(self, body):
        self.clean()
        action = body.get("action")
        if action == "cancel":
            identity, owner, generation = self.identity(body)
            with self.lock:
                existing = self.jobs.get(identity)
                if existing and (existing.owner != owner or existing.generation != generation):
                    raise ServiceError("翻译任务归属不一致。", 403)
                self.cancelled[identity] = self.clock() + 60
                self.generations[owner] = max(generation, self.generations.get(owner, 0))
            if existing and existing.stage in ACTIVE:
                self.retire(existing)
            return {"cancelled": True}
        with self.lock:
            job = self.owned(body)
            if action == "heartbeat":
                if job.stage in ACTIVE:
                    job.expires = self.clock() + self.lease
                return {"active": job.stage in ACTIVE}
            if action == "status":
                return self.status(job)
            if action == "pdf":
                if job.stage != "complete" or not job.pdf:
                    raise ServiceError("原版式 PDF 尚未完成。", 409)
                return job.pdf.read_bytes()
        if action == "render":
            return self.render(body)
        raise ServiceError("版式操作不正确。")


def terminate_process_group(process):
    with GROUP_LOCK:
        TERMINATING_GROUPS.add(process.pid)
    if sys.platform == "win32":
        # Killing just the leader loses taskkill's descendant relationship.
        # Use one forced tree operation while that process still exists.
        force_process_groups({process.pid})
        return
    try:
        os.killpg(process.pid, signal.SIGTERM)
    except ProcessLookupError:
        with GROUP_LOCK:
            TERMINATING_GROUPS.discard(process.pid)
        return
    # A child may outlive the group leader. Always check/kill the group after
    # the grace period instead of relying only on the leader's return code.
    def force():
        force_process_groups({process.pid})
    timer = threading.Timer(1.5, force)
    timer.daemon = True
    timer.start()


def force_process_groups(groups):
    with GROUP_LOCK:
        for identity in groups:
            if identity not in TERMINATING_GROUPS:
                continue
            try:
                if sys.platform == "win32":
                    taskkill = os.path.join(os.environ.get("SystemRoot", r"C:\Windows"), "System32", "taskkill.exe")
                    result = subprocess.run([taskkill, "/PID", str(identity), "/T", "/F"],
                                            stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL,
                                            stderr=subprocess.DEVNULL, timeout=10,
                                            creationflags=subprocess.CREATE_NO_WINDOW, check=False)
                    if result.returncode:
                        LOGGER.warning("Windows engine tree cleanup returned %s", result.returncode)
                else:
                    os.killpg(identity, signal.SIGKILL)
            except ProcessLookupError:
                pass
            except (OSError, subprocess.TimeoutExpired):
                LOGGER.exception("Could not terminate the engine process tree")
            finally:
                TERMINATING_GROUPS.discard(identity)


class Handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def log_message(self, format, *args):
        LOGGER.info("Local request: %s", format % args)

    def send(self, value, status=200):
        binary = isinstance(value, bytes)
        data = value if binary else json.dumps(value, ensure_ascii=False).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/pdf" if binary else "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.end_headers()
        self.wfile.write(data)

    def do_GET(self):
        if self.path == "/health":
            self.send({"available": True, "engine": "BabelDOC", "engineVersion": "0.6.4"})
        else:
            self.send({"error": "未找到版式操作。"}, 404)

    def do_POST(self):
        try:
            if self.path != "/api":
                raise ServiceError("未找到版式操作。", 404)
            if self.headers.get("Origin") is not None or self.headers.get("X-Lumior-Layout") != "1":
                raise ServiceError("版式服务仅接受本机应用请求。", 403)
            host = self.headers.get("Host", "")
            port = getattr(getattr(self, "server", None), "server_port", 3021)
            if host != f"127.0.0.1:{port}":
                raise ServiceError("版式服务仅接受本机应用请求。", 403)
            try:
                length = int(self.headers.get("Content-Length", "0"))
            except ValueError:
                raise ServiceError("版式请求格式不正确。") from None
            if not 0 < length <= MAX_REQUEST:
                raise ServiceError("请提供完整的 PDF，文件最大为 25 MB。", 413)
            data = self.rfile.read(length)
            if len(data) != length:
                raise ServiceError("PDF 上传不完整，请重试。")
            content_type = self.headers.get("Content-Type", "")
            if content_type.split(";", 1)[0].strip().lower() == "application/pdf":
                # Raw uploads avoid frameworks treating multipart POSTs as
                # Server Actions before the API route receives the PDF.
                fields = {"jobId": self.headers.get("X-Lumior-Job-Id"),
                          "ownerId": self.headers.get("X-Lumior-Owner-Id")}
                try:
                    fields["ownerGeneration"] = int(self.headers.get("X-Lumior-Owner-Generation", ""))
                except (TypeError, ValueError):
                    raise ServiceError("翻译任务代次不正确。") from None
                value = self.server.service.prepare(fields, data)
                self.send(value, 202)
            elif content_type.startswith("multipart/form-data"):
                message = BytesParser(policy=default).parsebytes(("Content-Type: " + content_type + "\r\nMIME-Version: 1.0\r\n\r\n").encode() + data)
                fields, upload = {}, None
                if not message.is_multipart():
                    raise ServiceError("PDF 上传格式不正确。")
                for part in message.iter_parts():
                    name = part.get_param("name", header="content-disposition")
                    payload = part.get_payload(decode=True)
                    if name == "file":
                        if upload is not None:
                            raise ServiceError("每次仅支持一个 PDF。")
                        upload = payload
                    elif name in {"jobId", "ownerId", "ownerGeneration", "pages"}:
                        if name in fields or len(payload) > 4096:
                            raise ServiceError("PDF 上传格式不正确。")
                        fields[name] = payload.decode("utf-8")
                try:
                    fields["ownerGeneration"] = int(fields.get("ownerGeneration", ""))
                except ValueError:
                    raise ServiceError("翻译任务代次不正确。") from None
                value = self.server.service.prepare(fields, upload)
                self.send(value, 202)
            elif content_type.startswith("application/json"):
                body = json.loads(data)
                if not isinstance(body, dict):
                    raise ServiceError("版式请求格式不正确。")
                value = self.server.service.action(body)
                self.send(value, 202 if body.get("action") == "render" else 200)
            else:
                raise ServiceError("版式请求格式不正确。")
        except ServiceError as failure:
            self.close_connection = True
            self.send({"error": str(failure)}, failure.status)
        except (ValueError, UnicodeError, TypeError):
            self.close_connection = True
            self.send({"error": "版式请求格式不正确。"}, 400)
        except Exception:
            self.close_connection = True
            LOGGER.exception("Local layout request failed")
            self.send({"error": "版式服务暂时无法处理请求，请重试。"}, 500)


def service_from_arguments(args):
    # Resolving the venv's Python symlink would select the base interpreter and
    # lose the isolated engine packages. Keep its absolute executable location.
    return LayoutService(args.python.absolute(), args.cache.resolve(), args.work_root.resolve())


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--python", type=Path, required=True)
    parser.add_argument("--cache", type=Path, required=True)
    parser.add_argument("--work-root", type=Path, required=True)
    parser.add_argument("--port", type=loopback_port, default=3021)
    args = parser.parse_args()
    service = service_from_arguments(args)
    logging.basicConfig(filename=service.work_root / "service.log", level=logging.INFO,
                        format="%(asctime)s %(levelname)s %(message)s")
    server = ThreadingHTTPServer(("127.0.0.1", args.port), Handler)
    server.daemon_threads = True
    server.service = service
    stop = threading.Event()
    def shutdown(signum, frame):
        if not stop.is_set():
            stop.set()
            # BaseServer.shutdown must run outside the serve_forever thread.
            threading.Thread(target=server.shutdown, daemon=True).start()
    signal.signal(signal.SIGTERM, shutdown)
    signal.signal(signal.SIGINT, shutdown)
    def expire():
        while not stop.wait(0.25):
            service.clean()
    threading.Thread(target=expire, daemon=True).start()
    try:
        server.serve_forever()
    finally:
        stop.set()
        for job in list(service.jobs.values()):
            if job.stage in ACTIVE:
                service.retire(job)
        # Do not rely on daemon timers surviving interpreter shutdown. Kill any
        # remaining descendants even when the group leader already exited.
        with GROUP_LOCK:
            pending = set(TERMINATING_GROUPS)
        force_process_groups(pending)
        server.server_close()


if __name__ == "__main__":
    main()
