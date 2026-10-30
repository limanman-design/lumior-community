"""Regression tests use fake preparation and ordinary sleeping processes only."""

import importlib.util
import hashlib
from contextlib import redirect_stderr
from io import BytesIO, StringIO
import json
import os
from pathlib import Path
import signal
import subprocess
import sys
import tempfile
import threading
import time
from types import SimpleNamespace
import unittest
from unittest.mock import patch
import uuid

SCRIPTS = Path(__file__).resolve().parents[1] / "scripts"
sys.path.insert(0, str(SCRIPTS))
SPEC = importlib.util.spec_from_file_location("lumior_layout_service", SCRIPTS / "pdf-layout-service.py")
SERVICE = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = SERVICE
SPEC.loader.exec_module(SERVICE)
import pdf_layout_input as INPUT


class FakeService(SERVICE.LayoutService):
    def run_prepare(self, job):
        units, mappings = SERVICE.prepare_units([{"key": "a", "page": 1, "source": "Hello {v0} <style id='2'>world</style>."}], 1)
        with self.lock:
            if not job.retired:
                job.prepared = {"sourceHash": job.source_hash, "totalPages": 1, "emptyPages": [], "units": units}
                job.mappings = mappings
                job.stage = "prepared"

    def run_render(self, job):
        # No PDF is generated: just observe the validated engine input.
        self.rendered_rows = json.loads((job.directory / "translations.json").read_text())


class LayoutServiceTests(unittest.TestCase):
    def test_unverified_original_text_cannot_be_published_as_a_complete_pdf(self):
        report = {"missing": 0, "placeholderErrors": []}
        unicode_qa = {"passed": True, "pixelIdentical": True, "unchangedDrawingStreams": True}
        layout_qa = {"passed": True, "sourceExtraction": {"performed": True, "passed": True}}
        manifest = {"qaPassed": True}
        self.assertTrue(SERVICE.render_reports_verified(report, unicode_qa, layout_qa, manifest))
        # Layout equality alone can pass even when an independent reader was
        # unavailable or discovered source text omitted before translation.
        for evidence in ({}, {"performed": False, "passed": False}, {"performed": True, "passed": False}):
            self.assertFalse(SERVICE.render_reports_verified(report, unicode_qa, {"passed": True, "sourceExtraction": evidence}, manifest))
        self.assertFalse(SERVICE.render_reports_verified({"missing": 1}, unicode_qa, layout_qa, manifest))
        self.assertFalse(SERVICE.render_reports_verified(report, {**unicode_qa, "unchangedDrawingStreams": False}, layout_qa, manifest))

    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.now = 0
        self.wall = 2_000_000
        self.service = FakeService(sys.executable, Path(self.temp.name) / "cache", Path(self.temp.name) / "jobs", clock=lambda: self.now, wall_clock=lambda: self.wall)

    def tearDown(self):
        for job in self.service.jobs.values():
            if job.process:
                self.service.retire(job)
        self.temp.cleanup()

    def body(self, owner="reader", generation=1):
        return {"jobId": str(uuid.uuid4()), "ownerId": owner, "ownerGeneration": generation}

    def start(self, body):
        self.service.prepare(body, b"%PDF- fake test input, not an actual PDF")
        job = self.service.jobs[body["jobId"]]
        deadline = time.monotonic() + 2
        while job.stage != "prepared" and time.monotonic() < deadline:
            time.sleep(0.005)
        self.assertEqual(job.stage, "prepared")
        return job

    def test_long_nested_style_slices_balance_and_reconstruct(self):
        source = "Begin <style id='3'>" + "long text " * 700 + "<style id='4'>" + "😃" * 2500 + " {v9}</style>" + " more" * 1100 + "</style> end."
        chunks = SERVICE.split_protected_text(source)
        self.assertGreater(len(chunks), 3)
        for chunk in chunks:
            self.assertLessEqual(SERVICE.character_length(chunk["text"]), 4500)
            SERVICE.token_signature(chunk["text"])
        # Wrapper removal alone must preserve every original source character.
        reconstructed = "".join(SERVICE.remove_slice_wrappers(chunk["text"], chunk) for chunk in chunks)
        self.assertEqual(reconstructed, source)
        SERVICE.validate_placeholders(source, reconstructed)

    def test_formula_near_limit_is_never_split(self):
        source = "a" * 4498 + "{v128}" + "tail" * 1200
        chunks = SERVICE.split_protected_text(source)
        self.assertEqual("".join(chunk["slice"] for chunk in chunks), source)
        self.assertEqual(sum("{v128}" in chunk["text"] for chunk in chunks), 1)
        self.assertTrue(all(len(chunk["text"]) <= 4500 for chunk in chunks))

    def test_marker_faults_and_style_reparenting_rejected(self):
        source = "<style id='1'>A<style id='2'>B</style></style> {v0}"
        for target in (source.replace("{v0}", ""), "<style id='2'>A<style id='1'>B</style></style> {v0}", source + "</style>"):
            with self.assertRaises(SERVICE.ServiceError):
                SERVICE.validate_placeholders(source, target)

    def test_equivalent_token_spelling_restores_exact_source_tokens(self):
        source = "A {v1} <style id='2'>B</style> {v1} <style id='3'>C</style>"
        target = '甲 { v 1 } <style id="2">乙</ style > {v1} < style id="3" >丙</style>'
        normalized = SERVICE.normalize_placeholder_spelling(source, target)
        self.assertEqual(normalized, "甲 {v1} <style id='2'>乙</style> {v1} <style id='3'>丙</style>")
        with self.assertRaises(SERVICE.ServiceError):
            SERVICE.normalize_placeholder_spelling(source, target.replace('id="2"', 'id="4"'))
        with self.assertRaises(SERVICE.ServiceError):
            SERVICE.normalize_placeholder_spelling(source, target.replace("{ v 1 }", "{v9}"))

    def test_sibling_style_subtrees_can_reorder(self):
        source = "<style id='1'>A<style id='3'>C</style></style> and <style id='2'>B</style>"
        target = '<style id="2">乙</style>及<style id="1">甲<style id="3">丙</style></style>'
        SERVICE.validate_placeholders(source, target)
        normalized = SERVICE.normalize_placeholder_spelling(source, target)
        self.assertEqual(normalized, "<style id='2'>乙</style>及<style id='1'>甲<style id='3'>丙</style></style>")

    def test_style_parent_chain_change_is_rejected(self):
        source = "<style id='1'>A<style id='3'>C</style></style> and <style id='2'>B</style>"
        target = "<style id='2'>乙<style id='3'>丙</style></style>及<style id='1'>甲</style>"
        with self.assertRaises(SERVICE.ServiceError):
            SERVICE.validate_placeholders(source, target)
        with self.assertRaises(SERVICE.ServiceError):
            SERVICE.normalize_placeholder_spelling(source, target)

    def test_stable_unit_ids_follow_request_hash_order(self):
        rows = [{"key": "b", "page": 3, "source": "Second"}, {"key": "a", "page": 2, "source": "First"}]
        left = SERVICE.prepare_units(rows, 3)[0]
        right = SERVICE.prepare_units(list(reversed(rows)), 3)[0]
        self.assertEqual(left, right)
        self.assertEqual([unit["id"] for unit in left], [SERVICE.stable_unit_id(2, "First", 0), SERVICE.stable_unit_id(3, "Second", 0)])
        self.assertTrue(all(unit["protected"] for unit in left))

    def test_stable_unit_ids_survive_insertions_and_request_key_changes(self):
        rows = [{"key": "b", "page": 1, "source": "First"}, {"key": "c", "page": 1, "source": "Second"}]
        original = {unit["text"]: unit["id"] for unit in SERVICE.prepare_units(rows, 1)[0]}
        changed = [{"key": "a", "page": 1, "source": "Inserted"}, {**rows[0], "key": "z"}, rows[1]]
        current = {unit["text"]: unit["id"] for unit in SERVICE.prepare_units(changed, 1)[0]}
        self.assertEqual({text: current[text] for text in original}, original)
        for identity in current.values():
            self.assertRegex(identity, r"^\d+:\d+$")

    def test_stable_unit_ids_bind_page_and_entire_source(self):
        old = SERVICE.prepare_units([{"key": "a", "page": 1, "source": "x" * 9000}], 2)[0]
        changed = SERVICE.prepare_units([{"key": "a", "page": 1, "source": "x" * 8999 + "y"}], 2)[0]
        moved = SERVICE.prepare_units([{"key": "a", "page": 2, "source": "x" * 9000}], 2)[0]
        self.assertEqual(old[0]["text"], old[1]["text"])
        self.assertNotEqual(old[0]["id"], old[1]["id"])
        self.assertEqual(old[0]["text"], changed[0]["text"])
        self.assertTrue(all(a["id"] != b["id"] for a, b in zip(old, changed)))
        self.assertTrue(all(a["id"] != b["id"] for a, b in zip(old, moved)))

    def resume_fixture(self, *, source="Old {v0} <style id='1'>text</style>", target='旧 {v0} <style id="1">译文</style>', rows=None):
        rows = rows or [{"key": "b", "page": 1, "source": source}]
        data = b"%PDF- receipt ownership fixture"
        source_hash = hashlib.sha256(data).hexdigest()
        directory = self.marked_directory(age=1)
        marker = {"version": 1, "jobId": directory.name, "createdAt": self.wall - 1,
                  "sourceHash": source_hash, "ownerId": "reader", "ownerGeneration": 1, "unitIdScheme": "ordinal-v1"}
        (directory / SERVICE.CACHE_MARKER).write_text(json.dumps(marker))
        (directory / "input.pdf").write_bytes(data)
        (directory / "collect").mkdir()
        (directory / "collect/requests.json").write_text(json.dumps(rows))
        (directory / "translations.json").write_text(json.dumps([{"source": source, "target": target}]))
        identity = str(uuid.uuid4())
        job = SERVICE.Job(identity, "reader", 2, self.service.work_root / identity, source_hash,
                          prepared={"totalPages": 1})
        units, mappings = SERVICE.prepare_units(rows, 1)
        return job, directory, marker, units, mappings

    def test_legacy_receipts_require_exact_current_source_and_normalize_only_tokens(self):
        job, directory, _marker, _units, _mappings = self.resume_fixture()
        old_rows = json.loads((directory / "collect/requests.json").read_text())
        current_rows = [{"key": "a", "page": 1, "source": "New inserted paragraph"}, *old_rows]
        units, mappings = SERVICE.prepare_units(current_rows, 1)
        receipts = self.service.resume_units(job, units, mappings)
        expected = {"id": SERVICE.stable_unit_id(1, old_rows[0]["source"], 0), "legacyId": "1:0", "page": 1,
                    "text": "旧 {v0} <style id='1'>译文</style>"}
        self.assertEqual(receipts, [expected])
        changed_units, changed_mappings = SERVICE.prepare_units([{**old_rows[0], "source": old_rows[0]["source"] + " changed"}], 1)
        self.assertEqual(self.service.resume_units(job, changed_units, changed_mappings), [])

    def test_new_or_unknown_id_schemes_cannot_claim_legacy_ordinal_history(self):
        job, directory, marker, units, mappings = self.resume_fixture()
        for scheme in (None, "source-hash-v2", "unknown"):
            changed = {**marker, "unitIdScheme": scheme}
            (directory / SERVICE.CACHE_MARKER).write_text(json.dumps(changed))
            self.assertEqual(self.service.resume_units(job, units, mappings), [])

    def test_legacy_receipts_reject_unverified_or_changed_targets(self):
        for target in ("", None, "x" * 20001, "旧 {v9} <style id='1'>译文</style>",
                       "旧 {v0} <style id='1'>未闭合", "旧 {v0} <style class='bold'>译文</style>", "旧 {v0} <style id='1'>译文</style>{vBAD}"):
            with self.subTest(target=str(target)[:50]):
                job, _directory, _marker, units, mappings = self.resume_fixture(target=target)
                self.assertEqual(self.service.resume_units(job, units, mappings), [])

    def test_legacy_receipts_do_not_guess_long_translation_slice_boundaries(self):
        job, _directory, _marker, units, mappings = self.resume_fixture(source="x" * 9000, target="长段译文")
        self.assertEqual(self.service.resume_units(job, units, mappings), [])

    def test_legacy_receipts_require_same_pdf_hash_and_service_ownership_before_content_reads(self):
        for mutation in ("unmarked", "wrong-job", "wrong-version", "missing-hash", "other-pdf", "other-owner", "expired", "future", "marker-link", "directory-link"):
            with self.subTest(mutation=mutation):
                job, directory, marker, units, mappings = self.resume_fixture()
                marker_path = directory / SERVICE.CACHE_MARKER
                if mutation == "unmarked":
                    marker_path.unlink()
                elif mutation == "marker-link":
                    marker_path.unlink()
                    marker_path.symlink_to(directory / "not-a-marker.json")
                elif mutation == "directory-link":
                    outside = Path(self.temp.name) / str(uuid.uuid4())
                    directory.rename(outside)
                    directory.symlink_to(outside, target_is_directory=True)
                else:
                    if mutation == "wrong-job": marker["jobId"] = str(uuid.uuid4())
                    if mutation == "wrong-version": marker["version"] = True
                    if mutation == "missing-hash": marker.pop("sourceHash")
                    if mutation == "other-pdf": marker["sourceHash"] = "0" * 64
                    if mutation == "other-owner": marker["ownerId"] = "other"
                    if mutation == "expired": marker["createdAt"] = self.wall - SERVICE.CACHE_RETENTION - 1
                    if mutation == "future": marker["createdAt"] = self.wall + 1
                    marker_path.write_text(json.dumps(marker))
                # Only marker metadata may be examined for rejected ownership;
                # neither another original PDF nor its text is opened.
                original_read_bytes = Path.read_bytes
                def guarded_read_bytes(path):
                    if path.name == "input.pdf": raise AssertionError("Read an unverified original")
                    return original_read_bytes(path)
                with patch.object(Path, "read_bytes", guarded_read_bytes):
                    self.assertEqual(self.service.resume_units(job, units, mappings), [])

    def test_legacy_receipts_verify_pdf_bytes_and_reject_interior_links(self):
        for mutation in ("changed-pdf", "input-link", "collect-link", "target-link", "duplicate-target"):
            with self.subTest(mutation=mutation):
                job, directory, _marker, units, mappings = self.resume_fixture()
                if mutation == "changed-pdf": (directory / "input.pdf").write_bytes(b"%PDF- different original")
                if mutation in ("input-link", "target-link"):
                    file = directory / ("input.pdf" if mutation == "input-link" else "translations.json")
                    target = Path(self.temp.name) / str(uuid.uuid4())
                    file.rename(target)
                    file.symlink_to(target)
                if mutation == "collect-link":
                    target = Path(self.temp.name) / str(uuid.uuid4())
                    (directory / "collect").rename(target)
                    (directory / "collect").symlink_to(target, target_is_directory=True)
                if mutation == "duplicate-target":
                    file = directory / "translations.json"
                    rows = json.loads(file.read_text())
                    file.write_text(json.dumps(rows + rows))
                self.assertEqual(self.service.resume_units(job, units, mappings), [])

    def recovery_fixture(self, **kwargs):
        job, directory, marker, units, mappings = self.resume_fixture(**kwargs)
        marker["unitIdScheme"] = "source-hash-v2"
        (directory / SERVICE.CACHE_MARKER).write_text(json.dumps(marker))
        return job, directory, marker, units, mappings

    def write_slice_cache(self, directory, mappings, *, transform=lambda text: text.replace("long text ", "译文 ")):
        rows = []
        for mapping in mappings:
            values = [transform(chunk["text"]) for chunk in mapping["chunks"]]
            target = "".join(SERVICE.remove_slice_wrappers(value, chunk) for value, chunk in zip(values, mapping["chunks"]))
            rows.append({"source": mapping["source"], "target": target,
                         "chunks": [{"id": identity, "source": chunk["text"], "target": value}
                                    for identity, chunk, value in zip(mapping["ids"], mapping["chunks"], values)]})
        (directory / "translations.json").write_text(json.dumps(rows))
        return rows

    def test_recovery_restores_old_single_slice_targets_by_exact_current_source(self):
        job, directory, _marker, _units, _mappings = self.recovery_fixture()
        old_rows = json.loads((directory / "collect/requests.json").read_text())
        current_rows = [{"key": "a", "page": 1, "source": "Inserted"}, *old_rows]
        units, mappings = SERVICE.prepare_units(current_rows, 1)
        restored = self.service.recovered_units(job, units, mappings)
        self.assertEqual(restored, [{"id": SERVICE.stable_unit_id(1, old_rows[0]["source"], 0), "page": 1,
                                    "text": "旧 {v0} <style id='1'>译文</style>"}])
        for changed in ({**old_rows[0], "source": old_rows[0]["source"] + " changed"}, {**old_rows[0], "page": 2}):
            changed_units, changed_mappings = SERVICE.prepare_units([changed], 2)
            self.assertEqual(self.service.recovered_units(job, changed_units, changed_mappings), [])
        altered_units = [{**unit, "text": unit["text"] + " changed"} for unit in units]
        self.assertEqual(self.service.recovered_units(job, altered_units, mappings), [])

    def test_recovery_rejects_other_owners_sources_and_invalid_markers_before_contents(self):
        for mutation in ("unmarked", "wrong-job", "wrong-version", "missing-hash", "other-pdf", "other-owner", "missing-owner",
                         "expired", "future", "missing-scheme", "unknown-scheme", "ordinal", "missing-generation", "invalid-generation"):
            with self.subTest(mutation=mutation):
                job, directory, marker, units, mappings = self.recovery_fixture()
                path = directory / SERVICE.CACHE_MARKER
                if mutation == "unmarked": path.unlink()
                else:
                    if mutation == "wrong-job": marker["jobId"] = str(uuid.uuid4())
                    if mutation == "wrong-version": marker["version"] = True
                    if mutation == "missing-hash": marker.pop("sourceHash")
                    if mutation == "other-pdf": marker["sourceHash"] = "0" * 64
                    if mutation == "other-owner": marker["ownerId"] = "other"
                    if mutation == "missing-owner": marker.pop("ownerId")
                    if mutation == "expired": marker["createdAt"] = self.wall - SERVICE.CACHE_RETENTION - 1
                    if mutation == "future": marker["createdAt"] = self.wall + 1
                    if mutation == "missing-scheme": marker.pop("unitIdScheme")
                    if mutation == "unknown-scheme": marker["unitIdScheme"] = "unknown"
                    if mutation == "ordinal": marker["unitIdScheme"] = "ordinal-v1"
                    if mutation == "missing-generation": marker.pop("ownerGeneration")
                    if mutation == "invalid-generation": marker["ownerGeneration"] = True
                    path.write_text(json.dumps(marker))
                original_read_bytes = Path.read_bytes
                def guarded_read_bytes(path):
                    if path.name == "input.pdf": raise AssertionError("Read a cache without verified ownership")
                    return original_read_bytes(path)
                with patch.object(Path, "read_bytes", guarded_read_bytes):
                    self.assertEqual(self.service.recovered_units(job, units, mappings), [])

    def test_recovery_rejects_changed_pdf_duplicate_targets_and_cache_links(self):
        for mutation in ("changed-pdf", "directory-link", "marker-link", "input-link", "collect-link", "target-link", "duplicate-target"):
            with self.subTest(mutation=mutation):
                job, directory, _marker, units, mappings = self.recovery_fixture()
                if mutation == "changed-pdf": (directory / "input.pdf").write_bytes(b"%PDF- another original")
                if mutation == "directory-link":
                    target = Path(self.temp.name) / str(uuid.uuid4())
                    directory.rename(target)
                    directory.symlink_to(target, target_is_directory=True)
                if mutation in ("marker-link", "input-link", "collect-link", "target-link"):
                    relative = {"marker-link": SERVICE.CACHE_MARKER, "input-link": "input.pdf", "collect-link": "collect", "target-link": "translations.json"}[mutation]
                    file = directory / relative
                    target = Path(self.temp.name) / str(uuid.uuid4())
                    file.rename(target)
                    file.symlink_to(target, target_is_directory=mutation == "collect-link")
                if mutation == "duplicate-target":
                    file = directory / "translations.json"
                    rows = json.loads(file.read_text())
                    file.write_text(json.dumps(rows + rows))
                self.assertEqual(self.service.recovered_units(job, units, mappings), [])

    def test_recovery_rejects_invalid_targets_and_protection_tokens(self):
        for target in ("", None, "x" * 20001, "😃" * 10001, "旧 {v9} <style id='1'>译文</style>",
                       "旧 {v0} <style id='1'>未闭合", "旧 {v0} <style class='bold'>译文</style>", "旧 {v0} <style id='1'>译文</style>{vBAD}"):
            with self.subTest(target_type=type(target).__name__):
                job, _directory, _marker, units, mappings = self.recovery_fixture(target=target)
                self.assertEqual(self.service.recovered_units(job, units, mappings), [])

    def test_recovery_does_not_guess_old_long_target_slice_boundaries(self):
        job, _directory, _marker, units, mappings = self.recovery_fixture(source="x" * 9000, target="长段译文")
        self.assertEqual(self.service.recovered_units(job, units, mappings), [])

    def test_recovery_restores_complete_exact_long_slice_receipts(self):
        source = "Start <style id='1'>" + "long text " * 1000 + " {v0}</style> end"
        job, directory, _marker, units, mappings = self.recovery_fixture(source=source, target="unused")
        rows = self.write_slice_cache(directory, mappings)
        restored = self.service.recovered_units(job, units, mappings)
        self.assertEqual([unit["id"] for unit in restored], [unit["id"] for unit in units])
        self.assertEqual([unit["text"] for unit in restored], [receipt["target"] for receipt in rows[0]["chunks"]])

    def test_recovery_rejects_entire_paragraph_if_any_slice_receipt_is_incomplete_or_changed(self):
        source = "Start <style id='1'>" + "long text " * 1000 + " {v0}</style> end"
        for mutation in ("missing", "changed-id", "changed-source", "duplicate", "reordered", "oversized", "bad-token", "changed-target"):
            with self.subTest(mutation=mutation):
                job, directory, _marker, units, mappings = self.recovery_fixture(source=source, target="unused")
                rows = self.write_slice_cache(directory, mappings)
                chunks = rows[0]["chunks"]
                if mutation == "missing": chunks.pop()
                if mutation == "changed-id": chunks[0]["id"] = "1:0"
                if mutation == "changed-source": chunks[0]["source"] += " changed"
                if mutation == "duplicate": chunks[1] = chunks[0]
                if mutation == "reordered": chunks.reverse()
                if mutation == "oversized": chunks[0]["target"] += "x" * 20000
                if mutation == "bad-token": chunks[0]["target"] += "{vBAD}"
                if mutation == "changed-target": chunks[0]["target"] = chunks[0]["target"].replace("译文", "别的译文", 1)
                (directory / "translations.json").write_text(json.dumps(rows))
                self.assertEqual(self.service.recovered_units(job, units, mappings), [])

    def test_recovery_prefers_latest_complete_cache_and_caps_candidate_scans(self):
        job, older, old_marker, units, mappings = self.recovery_fixture(target="旧 {v0} <style id='1'>译文</style>")
        _job, newer, new_marker, _units, _mappings = self.recovery_fixture(target="新 {v0} <style id='1'>译文</style>")
        old_marker["createdAt"] = self.wall - 2
        (older / SERVICE.CACHE_MARKER).write_text(json.dumps(old_marker))
        new_marker["createdAt"] = self.wall - 1
        (newer / SERVICE.CACHE_MARKER).write_text(json.dumps(new_marker))
        restored = self.service.recovered_units(job, units, mappings)
        self.assertEqual(len(restored), 1)
        self.assertTrue(restored[0]["text"].startswith("新"))
        with patch.object(SERVICE, "MAX_RECOVERY_DIRECTORIES", 1), patch.object(Path, "iterdir", return_value=iter([older, newer])):
            restored = self.service.recovered_units(job, units, mappings)
        self.assertEqual(len(restored), 1)
        self.assertTrue(restored[0]["text"].startswith("旧"))

    def test_recovery_response_budget_never_restores_a_partial_long_paragraph(self):
        source = "Start <style id='1'>" + "long text " * 1000 + " {v0}</style> end"
        job, directory, _marker, units, mappings = self.recovery_fixture(source=source, target="unused")
        rows = self.write_slice_cache(directory, mappings)
        first_size = SERVICE.character_length(rows[0]["chunks"][0]["target"])
        with patch.object(SERVICE, "MAX_RECOVERED_CHARACTERS", first_size):
            self.assertEqual(self.service.recovered_units(job, units, mappings), [])

    def test_virtual_environment_entry_keeps_isolated_packages_visible(self):
        environment = Path(self.temp.name) / "isolated-venv"
        subprocess.run([sys.executable, "-m", "venv", "--without-pip", str(environment)], check=True, capture_output=True)
        entry = environment / "bin/python"
        arguments = SimpleNamespace(python=entry, cache=Path(self.temp.name) / "cache", work_root=Path(self.temp.name) / "other-jobs")
        service = SERVICE.service_from_arguments(arguments)
        self.assertEqual(service.python, entry.absolute())
        site_packages = next((environment / "lib").glob("python*/site-packages"))
        (site_packages / "lumior_isolation_sentinel.py").write_text("value = 'isolated package'\n")
        result = subprocess.run([str(service.python), "-c", "import json,sys,lumior_isolation_sentinel as marker; print(json.dumps([sys.prefix,sys.base_prefix,marker.value]))"], check=True, capture_output=True, text=True)
        prefix, base, marker = json.loads(result.stdout)
        self.assertEqual(Path(prefix), environment)
        self.assertNotEqual(prefix, base)
        self.assertEqual(marker, "isolated package")

    def test_unknown_preflight_exception_is_local_diagnostic_only(self):
        output = Path(self.temp.name) / "input-metadata.json"
        diagnostics = StringIO()
        with patch.object(INPUT, "inspect_pdf", side_effect=RuntimeError("private diagnostic /secret/local/path")), redirect_stderr(diagnostics):
            status = INPUT.write_preflight_report(Path(self.temp.name) / "input.pdf", output)
        self.assertEqual(status, 1)
        report = json.loads(output.read_text())
        self.assertFalse(report["passed"])
        self.assertNotIn("/secret/local/path", report["error"])
        self.assertIn("Traceback", diagnostics.getvalue())
        self.assertIn("private diagnostic /secret/local/path", diagnostics.getvalue())

    def marked_directory(self, *, identity=None, age=SERVICE.CACHE_RETENTION + 1, marker=True):
        identity = identity or str(uuid.uuid4())
        directory = self.service.work_root / identity
        directory.mkdir()
        (directory / "unimportant-local-cache.bin").write_bytes(b"opaque temporary content")
        if marker:
            (directory / SERVICE.CACHE_MARKER).write_text(json.dumps({"version": 1, "jobId": identity, "createdAt": self.wall - age}))
        return directory

    def test_cache_cleanup_deletes_only_expired_owned_terminal_jobs(self):
        terminal = self.marked_directory()
        recent = self.marked_directory(age=1)
        unknown = self.marked_directory(marker=False)
        arbitrary = self.marked_directory(identity="research-originals")
        wrong_marker = self.marked_directory()
        (wrong_marker / SERVICE.CACHE_MARKER).write_text(json.dumps({"version": 1, "jobId": str(uuid.uuid4()), "createdAt": 1}))
        active_body = self.body()
        active = self.start(active_body)
        (active.directory / SERVICE.CACHE_MARKER).write_text(json.dumps({"version": 1, "jobId": active.identity, "createdAt": self.wall - SERVICE.CACHE_RETENTION - 1}))
        self.service.cleanup_cache(force=True)
        self.assertFalse(terminal.exists())
        for retained in (recent, unknown, arbitrary, wrong_marker, active.directory):
            self.assertTrue(retained.exists())

    def test_cache_cleanup_never_follows_outer_or_marker_symlinks(self):
        outside = Path(self.temp.name) / "real-originals"
        outside.mkdir()
        original = outside / "original.bin"
        original.write_bytes(b"preserve this original")
        identity = str(uuid.uuid4())
        (outside / SERVICE.CACHE_MARKER).write_text(json.dumps({"version": 1, "jobId": identity, "createdAt": 1}))
        linked = self.service.work_root / identity
        linked.symlink_to(outside, target_is_directory=True)
        marker_link = self.marked_directory(marker=False)
        marker_target = Path(self.temp.name) / "shared-marker.json"
        marker_target.write_text(json.dumps({"version": 1, "jobId": marker_link.name, "createdAt": 1}))
        (marker_link / SERVICE.CACHE_MARKER).symlink_to(marker_target)
        owned_with_link = self.marked_directory()
        (owned_with_link / "linked-originals").symlink_to(outside, target_is_directory=True)
        self.service.cleanup_cache(force=True)
        self.assertFalse(owned_with_link.exists())
        self.assertTrue(linked.is_symlink())
        self.assertTrue(marker_link.exists())
        self.assertEqual(original.read_bytes(), b"preserve this original")
        self.assertTrue(marker_target.exists())

    def test_cache_sweep_is_throttled_and_restart_recovers_marked_leftovers(self):
        terminal = self.marked_directory()
        self.service.cleanup_cache()
        self.assertTrue(terminal.exists())
        self.now = SERVICE.CACHE_SWEEP_INTERVAL
        self.service.cleanup_cache()
        self.assertFalse(terminal.exists())
        leftover = self.marked_directory()
        unknown = self.marked_directory(marker=False)
        restarted = FakeService(sys.executable, self.service.cache, self.service.work_root, clock=lambda: self.now, wall_clock=lambda: self.wall)
        self.assertFalse(leftover.exists())
        self.assertTrue(unknown.exists())
        self.assertEqual(restarted.last_cache_sweep, self.now)

    def test_fake_http_rejects_origin_and_wrong_binding(self):
        for change in ({"Origin": "http://localhost:3001"}, {"X-Lumior-Layout": "0"}, {"Host": "hostile.example:3021"}):
            handler = SERVICE.Handler.__new__(SERVICE.Handler)
            handler.path = "/api"
            handler.headers = {"Host": "127.0.0.1:3021", "X-Lumior-Layout": "1", **change}
            replies = []
            handler.send = lambda value, status=200: replies.append((value, status))
            handler.do_POST()
            self.assertEqual(replies[0][1], 403)

    def test_configured_loopback_port_accepts_only_its_own_host(self):
        body = self.body()
        self.start(body)
        payload = json.dumps({**body, "action": "status"}).encode()
        for host, status in (("127.0.0.1:43221", 200), ("127.0.0.1:3021", 403), ("localhost:43221", 403)):
            handler = SERVICE.Handler.__new__(SERVICE.Handler)
            handler.path = "/api"
            handler.headers = {"Host": host, "X-Lumior-Layout": "1", "Content-Type": "application/json",
                               "Content-Length": str(len(payload))}
            handler.rfile = BytesIO(payload)
            handler.server = SimpleNamespace(service=self.service, server_port=43221)
            replies = []
            handler.send = lambda value, status=200: replies.append((value, status))
            handler.do_POST()
            self.assertEqual(replies[0][1], status)

    def test_loopback_port_rejects_invalid_values(self):
        self.assertEqual(SERVICE.loopback_port("43221"), 43221)
        self.assertEqual(SERVICE.loopback_port("1"), 1)
        self.assertEqual(SERVICE.loopback_port("65535"), 65535)
        for value in ("0", "65536", "-1", "1.5", "", " ", "1e3", "127.0.0.1:3021", "3021/api", True):
            with self.assertRaises(SERVICE.argparse.ArgumentTypeError):
                SERVICE.loopback_port(value)

    def test_process_launch_options_match_the_platform(self):
        with patch.object(SERVICE.sys, "platform", "darwin"):
            self.assertEqual(SERVICE.engine_process_options(), {"start_new_session": True})
        with patch.object(SERVICE.sys, "platform", "win32"), \
                patch.object(SERVICE.subprocess, "CREATE_NEW_PROCESS_GROUP", 0x200, create=True), \
                patch.object(SERVICE.subprocess, "CREATE_NO_WINDOW", 0x8000000, create=True):
            self.assertEqual(SERVICE.engine_process_options(), {"creationflags": 0x8000200})

    def test_windows_cancel_forces_the_tree_before_killing_its_leader(self):
        process = SimpleNamespace(pid=987654)
        with patch.object(SERVICE.sys, "platform", "win32"), \
                patch.object(SERVICE.subprocess, "CREATE_NO_WINDOW", 0x8000000, create=True), \
                patch.object(SERVICE.subprocess, "run", return_value=SimpleNamespace(returncode=0)) as taskkill, \
                patch.object(SERVICE.os, "killpg", create=True) as killpg, \
                patch.object(SERVICE.threading, "Timer") as timer:
            SERVICE.terminate_process_group(process)
        command = taskkill.call_args.args[0]
        self.assertTrue(command[0].endswith("taskkill.exe"))
        self.assertEqual(command[1:], ["/PID", "987654", "/T", "/F"])
        self.assertEqual(taskkill.call_args.kwargs["creationflags"], 0x8000000)
        self.assertFalse(taskkill.call_args.kwargs.get("shell", False))
        killpg.assert_not_called()
        timer.assert_not_called()
        self.assertNotIn(process.pid, SERVICE.TERMINATING_GROUPS)

    def test_raw_pdf_upload_uses_only_identity_headers(self):
        body = self.body()
        data = b"%PDF- opaque fake input for a protocol test"
        handler = SERVICE.Handler.__new__(SERVICE.Handler)
        handler.path = "/api"
        handler.headers = {"Host": "127.0.0.1:3021", "X-Lumior-Layout": "1", "Content-Type": "application/pdf",
                           "Content-Length": str(len(data)), "X-Lumior-Job-Id": body["jobId"],
                           "X-Lumior-Owner-Id": body["ownerId"], "X-Lumior-Owner-Generation": str(body["ownerGeneration"])}
        handler.rfile = BytesIO(data)
        handler.server = SimpleNamespace(service=self.service)
        replies = []
        handler.send = lambda value, status=200: replies.append((value, status))
        handler.do_POST()
        self.assertEqual(replies[0][1], 202)
        self.assertEqual(replies[0][0]["jobId"], body["jobId"])
        job = self.service.jobs[body["jobId"]]
        self.assertEqual((job.directory / "input.pdf").read_bytes(), data)
        self.assertEqual(job.generation, body["ownerGeneration"])
        self.assertIsNone(job.pages)

    def test_raw_pdf_upload_rejects_missing_or_invalid_generation(self):
        data = b"%PDF- fake"
        for generation in (None, "garbage"):
            handler = SERVICE.Handler.__new__(SERVICE.Handler)
            handler.path = "/api"
            handler.headers = {"Host": "127.0.0.1:3021", "X-Lumior-Layout": "1", "Content-Type": "application/pdf",
                               "Content-Length": str(len(data)), "X-Lumior-Job-Id": str(uuid.uuid4()),
                               "X-Lumior-Owner-Id": "reader", "X-Lumior-Owner-Generation": generation}
            handler.rfile = BytesIO(data)
            handler.server = SimpleNamespace(service=self.service)
            replies = []
            handler.send = lambda value, status=200: replies.append((value, status))
            handler.do_POST()
            self.assertEqual(replies[0][1], 400)
        self.assertFalse(self.service.jobs)

    def test_fake_status_has_no_source_text_or_local_paths_until_prepared(self):
        body = self.body()
        job = self.start(body)
        job.stage = "rendering"
        payload = json.dumps(self.service.status(job), ensure_ascii=False)
        self.assertNotIn(self.temp.name, payload)
        self.assertNotIn("Hello", payload)
        job.stage = "complete"
        job.artifact = {"name": "中文译文.pdf", "pages": []}
        payload = json.dumps(self.service.status(job), ensure_ascii=False)
        self.assertNotIn(self.temp.name, payload)
        self.assertNotIn("input.pdf", payload)

    def test_cancel_before_prepare_blocks_late_request(self):
        body = self.body()
        self.assertTrue(self.service.action({**body, "action": "cancel"})["cancelled"])
        with self.assertRaises(SERVICE.ServiceError) as rejected:
            self.service.prepare(body, b"%PDF- fake")
        self.assertEqual(rejected.exception.status, 409)

    def test_owner_replacement_releases_only_owned_job(self):
        old = self.start(self.body())
        other = self.start(self.body("other"))
        replacement = self.start(self.body(generation=2))
        self.assertEqual(old.stage, "cancelled")
        self.assertEqual(other.stage, "prepared")
        self.assertEqual(replacement.stage, "prepared")
        with self.assertRaises(SERVICE.ServiceError) as rejected:
            self.service.prepare(self.body("third"), b"%PDF- fake")
        self.assertEqual(rejected.exception.status, 429)
        with self.assertRaises(SERVICE.ServiceError):
            self.service.prepare(self.body(generation=1), b"%PDF- fake")

    def test_wrong_owner_cannot_cancel_or_download(self):
        body = self.body()
        job = self.start(body)
        for action in ("cancel", "pdf"):
            with self.assertRaises(SERVICE.ServiceError) as rejected:
                self.service.action({**body, "ownerId": "other", "action": action})
            self.assertEqual(rejected.exception.status, 403)
        self.assertEqual(job.stage, "prepared")

    def test_heartbeat_and_expiry_release_capacity(self):
        body = self.body()
        job = self.start(body)
        self.now = 80
        self.assertTrue(self.service.action({**body, "action": "heartbeat"})["active"])
        self.now = 100
        self.service.clean()
        self.assertEqual(job.stage, "prepared")
        self.now = 171
        self.service.clean()
        self.assertEqual(job.stage, "cancelled")
        self.assertFalse(self.service.action({**body, "action": "heartbeat"})["active"])

    def test_partial_render_keeps_prepared_job_then_valid_render(self):
        body = self.body()
        job = self.start(body)
        with self.assertRaises(SERVICE.ServiceError):
            self.service.render({**body, "units": []})
        self.assertEqual(job.stage, "prepared")
        units = [{"id": unit["id"], "text": unit["text"].replace("Hello", "你好").replace("world", "世界").replace("id='2'", 'id="2"')} for unit in job.prepared["units"]]
        self.service.render({**body, "units": units})
        deadline = time.monotonic() + 2
        while not hasattr(self.service, "rendered_rows") and time.monotonic() < deadline:
            time.sleep(0.005)
        self.assertIn("你好", self.service.rendered_rows[0]["target"])
        self.assertIn("<style id='2'>", self.service.rendered_rows[0]["target"])
        receipts = self.service.rendered_rows[0]["chunks"]
        self.assertEqual([receipt["id"] for receipt in receipts], [unit["id"] for unit in job.prepared["units"]])
        self.assertEqual(receipts[0]["source"], job.prepared["units"][0]["text"])
        SERVICE.validate_placeholders(receipts[0]["source"], receipts[0]["target"])

    def test_source_quality_rejects_ordinary_control_glyph(self):
        document = {"page": [{"pdf_paragraph": [{"pdf_paragraph_composition": [{"pdf_character": {"char_unicode": "\x01"}}]}]}]}
        with self.assertRaises(SERVICE.InputQualityError):
            SERVICE.inspect_source_layout(document, [{"source": "A"}])
        document["page"][0]["pdf_paragraph"][0]["pdf_paragraph_composition"] = [{"pdf_formula": {"pdf_character": [{"char_unicode": "\x01"}]}}]
        SERVICE.inspect_source_layout(document, [{"source": "{v0}"}])

    def test_cancel_kills_descendant_process_group(self):
        self.assert_descendant_cleanup(immediate_shutdown=False)

    def test_shutdown_kills_cancelled_group_before_grace_timer(self):
        self.assert_descendant_cleanup(immediate_shutdown=True)

    def assert_descendant_cleanup(self, immediate_shutdown):
        body = self.body()
        job = self.start(body)
        descendant = Path(self.temp.name) / "descendant.pid"
        heartbeat = Path(self.temp.name) / "descendant.heartbeat"
        child_code = "import signal,sys,time; signal.signal(signal.SIGTERM,signal.SIG_IGN)\nwhile True:\n open(sys.argv[1],'w').write(str(time.monotonic()))\n time.sleep(.05)"
        code = "import subprocess,sys,time; p=subprocess.Popen([sys.executable,'-c',sys.argv[3],sys.argv[2]]); open(sys.argv[1],'w').write(str(p.pid)); time.sleep(60)"
        process = subprocess.Popen([sys.executable, "-c", code, str(descendant), str(heartbeat), child_code], **SERVICE.engine_process_options())
        job.process = process
        deadline = time.monotonic() + 3
        while not heartbeat.exists() and time.monotonic() < deadline:
            time.sleep(0.01)
        try:
            self.assertTrue(heartbeat.exists())
            self.service.action({**body, "action": "cancel"})
            process.wait(timeout=3)
            self.assertEqual(job.stage, "cancelled")
            # This descendant ignores SIGTERM. Its heartbeat must stop after
            # the forced group kill even though the parent has already exited.
            if immediate_shutdown:
                SERVICE.force_process_groups(set(SERVICE.TERMINATING_GROUPS))
                self.assertNotIn(process.pid, SERVICE.TERMINATING_GROUPS)
                time.sleep(0.15)
            else:
                time.sleep(1.8)
            last = heartbeat.read_text()
            time.sleep(0.25)
            self.assertEqual(heartbeat.read_text(), last)
        finally:
            if sys.platform == "win32":
                with SERVICE.GROUP_LOCK:
                    SERVICE.TERMINATING_GROUPS.add(process.pid)
                SERVICE.force_process_groups({process.pid})
            else:
                try:
                    os.killpg(process.pid, signal.SIGKILL)
                except ProcessLookupError:
                    pass


if __name__ == "__main__":
    unittest.main()
