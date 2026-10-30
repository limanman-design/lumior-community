"""Conservative source geometry corrections for the isolated BabelDOC trial.

Keep this separate from Lumior's reader. Source ink bounds are not always a
complete line box: CJK replacement needs the original font's em height. Split
visually separate title labels and numbered affiliation rows before translation
so that the engine cannot join them into one sentence.
"""

from copy import deepcopy
from collections import Counter
from dataclasses import asdict
import json
import logging
import math
import re
from statistics import median


def composition_value(composition):
    for name in ("pdf_same_style_characters", "pdf_formula", "pdf_line", "pdf_character"):
        value = getattr(composition, name)
        if value is not None:
            return value
    return None


def characters(compositions):
    for composition in compositions:
        value = composition_value(composition)
        if value is not None:
            if composition.pdf_character is not None:
                yield value
            else:
                yield from value.pdf_character


def group_box(compositions, Box):
    boxes = [value.box for composition in compositions
             if (value := composition_value(composition)) is not None and value.box]
    return Box(x=min(box.x for box in boxes), y=min(box.y for box in boxes),
               x2=max(box.x2 for box in boxes), y2=max(box.y2 for box in boxes))


def split_groups(paragraph, groups, Box, get_unicode, styles=None):
    result = []
    for index, group in enumerate(groups):
        part = deepcopy(paragraph)
        part.pdf_paragraph_composition = group
        part.debug_id = f"{paragraph.debug_id}:row{index}"
        part.box = group_box(group, Box)
        if styles:
            part.pdf_style = deepcopy(styles[index])
        part.unicode = get_unicode(part)
        part.first_line_indent = False
        result.append(part)
    return result


class ReferenceLayoutError(ValueError):
    """A bibliography cannot be regrouped without a complete glyph proof."""


REFERENCE_MARKER = re.compile(r"^\[(\d{1,4})\]\s*$")
REFERENCE_JOURNAL = re.compile(r"(?:Phys\.|Rev\.|Lett\.|Europhys\.|Nature\b|Science\b|Acad\.|Opt\.)")
REFERENCE_METADATA = re.compile(r"^[\d\s.,;:()\[\]\-–—/+Rr]+$")


def _source_text(compositions):
    return "".join(char.char_unicode or "" for char in characters(compositions))


def _glyph_proof(compositions):
    # Include coordinates and style, not only Unicode, so regrouping cannot
    # replace a glyph with an identical-looking glyph from another source run.
    return Counter(json.dumps(asdict(char), sort_keys=True) for char in characters(compositions))


def ordered_reference_characters(values):
    """Recover inline citation order from source baselines and horizontal origins.

    Formula detection can collect bold volume/page digits before the commas and
    dashes that lie between them. Ink boxes are not baselines: italic descenders
    have different lower bounds, so use the original em boxes for line grouping.
    """
    values = list(values)
    if not values:
        raise ReferenceLayoutError("Reference metadata has no source glyphs.")
    for char in values:
        if (char.box is None or char.visual_bbox is None or char.visual_bbox.box is None
                or char.pdf_style is None or not char.pdf_style.font_id
                or not char.pdf_style.font_size or char.vertical
                or any(not isinstance(value, (int, float)) or not math.isfinite(value)
                       for value in (char.box.x, char.box.y, char.box.x2, char.box.y2))
                or (not (char.char_unicode or "").isspace() and char.pdf_character_id is None)):
            raise ReferenceLayoutError("Reference metadata contains an unverifiable source glyph.")
    proofs = [json.dumps(asdict(char), sort_keys=True) for char in values]
    if len(set(proofs)) != len(proofs):
        raise ReferenceLayoutError("Reference metadata repeats the same source glyph.")
    size = median(char.pdf_style.font_size for char in values)
    if any(abs(char.pdf_style.font_size - size) > size * 0.15 for char in values):
        raise ReferenceLayoutError("Reference metadata contains ambiguous baseline sizes.")
    rows = []
    for char in sorted(values, key=lambda char: (-char.box.y, char.box.x)):
        if not rows or abs(char.box.y - rows[-1][0].box.y) > size * 0.15:
            rows.append([])
        rows[-1].append(char)
    return [char for row in rows for char in sorted(row, key=lambda char: char.box.x)]


def _reference_formula(composition):
    formula = composition.pdf_formula
    return (formula is not None
            and bool(REFERENCE_JOURNAL.search(_source_text([composition])))
            and any(char.isdigit() for char in _source_text([composition])))


def _reference_group(compositions):
    """Combine only source citation metadata, keeping original glyph positions."""
    from babeldoc.format.pdf.document_il.il_version_1 import PdfParagraphComposition
    from babeldoc.format.pdf.document_il.utils.formular_helper import update_formula_data

    result, index, repairs = [], 0, 0
    while index < len(compositions):
        composition = compositions[index]
        if not _reference_formula(composition):
            result.append(deepcopy(composition))
            index += 1
            continue
        formula = composition.pdf_formula
        if formula.pdf_curve or formula.pdf_form:
            raise ReferenceLayoutError("Reference metadata includes protected graphic objects.")
        end = index + 1
        while end < len(compositions):
            next_composition = compositions[end]
            text = _source_text([next_composition])
            if (next_composition.pdf_same_style_characters is not None
                    and text and REFERENCE_METADATA.fullmatch(text)):
                end += 1
            else:
                break
        combined = deepcopy(formula)
        combined.pdf_character = deepcopy(ordered_reference_characters(characters(compositions[index:end])))
        combined.x_offset = combined.y_offset = combined.x_advance = 0
        update_formula_data(combined)
        result.append(PdfParagraphComposition(pdf_formula=combined))
        repairs += 1
        index = end
    if _glyph_proof(compositions) != _glyph_proof(result):
        raise ReferenceLayoutError("Reference regrouping changed source glyph identity or coverage.")
    return result, repairs


def prepare_reference_layout(document):
    """Split clear numbered bibliographies before translation, atomically.

    A new request is produced for each reference. Journal, volume, pages, year,
    and punctuation become one protected source formula in exact visual order.
    Glyphs retain original PDF positions here; compact placement is a separate
    runtime typesetting operation and does not weaken source-PDF verification.
    """
    from babeldoc.format.pdf.document_il.il_version_1 import Box

    plans, changes = [], []
    for page in document.page:
        paragraphs = []
        for paragraph in page.pdf_paragraph:
            comps = paragraph.pdf_paragraph_composition
            if (paragraph.box is None or paragraph.pdf_style is None
                    or not paragraph.pdf_style.font_size or paragraph.pdf_style.font_size > 10
                    or ":reference-" in (paragraph.debug_id or "")):
                paragraphs.append(paragraph)
                continue
            markers = []
            for index, composition in enumerate(comps):
                match = REFERENCE_MARKER.fullmatch(_source_text([composition]))
                value = composition_value(composition)
                if (match and value is not None and value.box is not None
                        and value.box.x <= paragraph.box.x + paragraph.pdf_style.font_size * 1.5):
                    markers.append((index, int(match.group(1)), value.box.y))
            if not markers or not any(_reference_formula(composition) for composition in comps):
                paragraphs.append(paragraph)
                continue
            if (any(right[1] != left[1] + 1 or right[2] >= left[2] - 1
                    for left, right in zip(markers, markers[1:]))):
                raise ReferenceLayoutError("Reference labels have ambiguous source order.")
            starts = [(index, str(number)) for index, number, _ in markers]
            if starts[0][0] != 0:
                starts.insert(0, (0, "continuation"))
            ends = [index for index, _ in starts[1:]] + [len(comps)]
            parts, repairs = [], 0
            for (start, name), end in zip(starts, ends):
                group, count = _reference_group(comps[start:end])
                part = deepcopy(paragraph)
                part.debug_id = f"{paragraph.debug_id}:reference-{name}"
                part.pdf_paragraph_composition = group
                part.unicode = _source_text(group)
                part.first_line_indent = False
                glyph_boxes = [box for char in characters(group)
                               for box in (char.box, char.visual_bbox.box if char.visual_bbox else None)
                               if box is not None]
                if not glyph_boxes:
                    raise ReferenceLayoutError("Reference paragraph has no source geometry.")
                part.box = Box(x=paragraph.box.x, x2=paragraph.box.x2,
                               y=min(box.y for box in glyph_boxes), y2=max(box.y2 for box in glyph_boxes))
                parts.append(part)
                repairs += count
            if _glyph_proof(comps) != _glyph_proof([composition for part in parts for composition in part.pdf_paragraph_composition]):
                raise ReferenceLayoutError("Reference splitting changed source glyph coverage.")
            paragraphs.extend(parts)
            changes.append({"page": page.page_number + 1, "id": paragraph.debug_id,
                            "reason": "separate references and protect inline citation metadata",
                            "parts": len(parts), "citations": repairs})
        plans.append((page, paragraphs))
    for page, paragraphs in plans:
        page.pdf_paragraph = paragraphs
    return changes


def compact_reference_formula(formula):
    """Make a single-line runtime copy without changing glyph signature/order."""
    from babeldoc.format.pdf.document_il.il_version_1 import Box

    if formula.pdf_curve or formula.pdf_form:
        raise ReferenceLayoutError("Reference metadata includes protected graphic objects.")
    compact = deepcopy(formula)
    x = 0.0
    for char in compact.pdf_character:
        old = deepcopy(char.box)
        dx, dy = x - old.x, -old.y
        # BabelDOC's synthesized spaces share one Box instance between em and
        # visual bounds. deepcopy preserves that alias; translate it only once.
        for box in {id(char.box): char.box, id(char.visual_bbox.box): char.visual_bbox.box}.values():
            box.x += dx
            box.x2 += dx
            box.y += dy
            box.y2 += dy
        advance = char.advance if char.advance is not None else old.x2 - old.x
        if not math.isfinite(advance) or advance <= 0:
            raise ReferenceLayoutError("Reference metadata has an invalid glyph advance.")
        x += advance
    compact.box = Box(x=0, y=0, x2=x,
                      y2=max(char.pdf_style.font_size for char in compact.pdf_character))
    compact.x_offset = compact.y_offset = compact.x_advance = 0
    return compact


def reference_accent_anchors(paragraph):
    """Record proven source diacritics without changing any request/source IL.

    TeX names can store a spacing diaeresis as one protected formula on top of
    the next ordinary a/u glyph. Its advance belongs to that letter, so treating
    it as an independent inline word shifts the accent in translated references.
    """
    if ":reference-" not in (paragraph.debug_id or ""):
        return []
    anchors = []
    comps = paragraph.pdf_paragraph_composition
    for index, composition in enumerate(comps[:-1]):
        formula = composition.pdf_formula
        if (formula is None or len(formula.pdf_character) != 1
                or formula.pdf_character[0].char_unicode != "¨"):
            continue
        accent = formula.pdf_character[0]
        following = list(characters(comps[index + 1:index + 2]))
        if formula.pdf_curve or formula.pdf_form or not following:
            raise ReferenceLayoutError("Reference diacritic has no verifiable source letter.")
        base = following[0]
        if (base.char_unicode not in "aeiouAEIOU" or not accent.box or not base.box
                or not accent.visual_bbox or not base.visual_bbox
                or not accent.pdf_style or not base.pdf_style
                or accent.pdf_style.font_id != base.pdf_style.font_id
                or abs(accent.pdf_style.font_size - base.pdf_style.font_size) > 0.01
                or abs(accent.box.y - base.box.y) > base.pdf_style.font_size * 0.1
                or accent.visual_bbox.box.y < base.box.y + base.pdf_style.font_size * 0.4
                or accent.visual_bbox.box.x < base.box.x - base.pdf_style.font_size * 0.1
                or accent.visual_bbox.box.x2 > base.box.x2 + base.pdf_style.font_size * 0.1):
            raise ReferenceLayoutError("Reference diacritic source attachment is ambiguous.")
        anchors.append({"signature": (accent.char_unicode, accent.pdf_character_id,
                                      accent.pdf_style.font_id, accent.xobj_id),
                        "base": base.char_unicode,
                        "baseWidth": base.box.x2 - base.box.x,
                        "offsetX": accent.box.x - base.box.x,
                        "offsetY": accent.box.y - base.box.y})
    return anchors


def page_obstacle_boxes(page, paragraph, *, include_paragraphs=True):
    boxes = ([other.box for other in page.pdf_paragraph
              if other is not paragraph and other.box is not None] if include_paragraphs else [])
    values = [(name, value)
              for name in ("pdf_figure", "pdf_rectangle", "pdf_curve", "pdf_form", "pdf_character")
              for value in getattr(page, name, []) or []]
    # The detector can move protected paths and Forms into a formula rather
    # than retaining them in the page collections. They still occupy their
    # original area, even when surrounding text flows inside a proven cell.
    for source in page.pdf_paragraph:
        for composition in source.pdf_paragraph_composition:
            formula = composition.pdf_formula
            if formula is not None:
                values.extend((name, value) for name in ("pdf_curve", "pdf_form")
                              for value in getattr(formula, name, []) or [])
    for name, value in values:
        obstacle = value.box
        if name == "pdf_form" and getattr(value, "form_type", None) == "form":
            subtype = getattr(value, "pdf_form_subtype", None)
            reference = getattr(subtype, "pdf_xobj_form", None)
            xref = getattr(reference, "xref_id", None)
            matches = [item.box for item in page.pdf_xobject
                       if xref is not None and item.xref_id == xref and item.box is not None]
            if (len(matches) == 1
                    and all(isinstance(number, (int, float)) and math.isfinite(number)
                            for number in (matches[0].x, matches[0].y, matches[0].x2, matches[0].y2))
                    and matches[0].x2 > matches[0].x and matches[0].y2 > matches[0].y):
                # A Form XObject's captured page-space BBox is its source
                # clipping boundary. Upstream can add that already-offset
                # origin again when calculating the enclosing form.box,
                # spuriously covering headers outside the protected Form.
                # Use only an unambiguous same-xref clipping boundary.
                obstacle = matches[0]
        if obstacle is not None:
            boxes.append(obstacle)
        visual = getattr(value, "visual_bbox", None)
        if visual is not None and visual.box is not None:
            boxes.append(visual.box)
    return boxes


def page_counter_allocation(page, paragraph):
    """Keep a recognised running page counter on its original right edge."""
    from babeldoc.format.pdf.document_il.il_version_1 import Box

    box, style = paragraph.box, paragraph.pdf_style
    frame = getattr(page, "cropbox", None) or getattr(page, "mediabox", None)
    frame = frame.box if frame is not None else None
    if (box is None or style is None or not style.font_size or frame is None
            or paragraph.layout_label != "abandon"
            or not re.fullmatch(r"\s*\d{1,4}\s+of\s+\d{1,4}\s*", paragraph.unicode or "", re.IGNORECASE)):
        return None
    size = style.font_size
    if (box.x2 < frame.x2 - size * 8
            or not (box.y >= frame.y2 - size * 6 or box.y2 <= frame.y + size * 6)):
        return None
    left = max(frame.x + size * 2, box.x2 - size * 12)
    guard = size * 0.5
    for obstacle in page_obstacle_boxes(page, paragraph):
        if (obstacle.y2 > box.y - guard and obstacle.y < box.y2 + guard
                and obstacle.x < box.x and obstacle.x2 > left):
            left = max(left, min(box.x, obstacle.x2 + guard))
    if left >= box.x - size:
        return None
    return Box(x=left, y=box.y, x2=box.x2, y2=box.y2)


def table_line_allocation(page, paragraph, source_boxes=None):
    """Use bounded empty cell space for a detector's single ink line."""
    from babeldoc.format.pdf.document_il.il_version_1 import Box

    box, style = paragraph.box, paragraph.pdf_style
    if (box is None or style is None or not style.font_size
            or not 4 <= style.font_size <= 12 or paragraph.layout_label != "fallback_line"
            or box.y2 - box.y > style.font_size * 1.5):
        return None
    tables = [layout.box for layout in page.page_layout
              if layout.class_name == "table" and layout.box is not None and (layout.conf or 0) >= 0.8
              and layout.box.x <= box.x and layout.box.x2 >= box.x2
              and layout.box.y <= box.y and layout.box.y2 >= box.y2]
    if len(tables) != 1:
        return None
    table = tables[0]
    left, right = max(table.x, box.x - style.font_size * 3), min(table.x2, box.x2 + style.font_size * 3)
    obstacles = [(source_boxes.get(id(other), other.box) if source_boxes is not None else other.box, True)
                 for other in page.pdf_paragraph if other is not paragraph and other.box is not None]
    obstacles.extend((value, False) for value in page_obstacle_boxes(page, paragraph, include_paragraphs=False))
    for obstacle, is_text in obstacles:
        if obstacle.y2 <= box.y - 0.5 or obstacle.y >= box.y2 + 0.5:
            continue
        overlap_height = min(obstacle.y2, box.y2) - max(obstacle.y, box.y)
        if (is_text and overlap_height <= style.font_size * 0.25
                and obstacle.y2 - obstacle.y <= style.font_size * 1.5
                and abs((obstacle.y + obstacle.y2) - (box.y + box.y2)) * 0.5 >= style.font_size * 0.75):
            # Distinct source baselines can have overlapping italic descender /
            # em boxes. They remain different table rows, with unchanged
            # vertical allocations; only same-row cells share horizontal space.
            continue
        if obstacle.x2 <= box.x:
            boundary = (obstacle.x2 + box.x) * 0.5 + 0.25 if is_text else obstacle.x2 + 0.5
            left = max(left, min(box.x, boundary))
        elif obstacle.x >= box.x2:
            boundary = (box.x2 + obstacle.x) * 0.5 - 0.25 if is_text else obstacle.x - 0.5
            right = min(right, max(box.x2, boundary))
        elif obstacle.x2 > box.x and obstacle.x < box.x2:
            # A source cell already crossing a protected object has no proven
            # empty allocation on either side.
            return None
    if box.x - left <= 0.5 and right - box.x2 <= 0.5:
        return None
    return Box(x=left, y=box.y, x2=right, y2=box.y2)


def sidebar_column_allocation(page, paragraph):
    """Recover a short label block's column from aligned neighbours.

    A date block's detector box can describe its longest English ink line,
    rather than the sidebar column. Require matching small-print blocks both
    above and below before using their shared width. Every other text/graphic
    object is an obstacle, and row heights and baselines remain unchanged.
    """
    from babeldoc.format.pdf.document_il.il_version_1 import Box

    box, style = paragraph.box, paragraph.pdf_style
    if box is None or style is None or not style.font_size:
        return None
    size = style.font_size
    neighbours = {"above": [], "below": []}
    for other in page.pdf_paragraph:
        other_box, other_style = other.box, other.pdf_style
        if (other is paragraph or other_box is None or other_style is None
                or other.layout_label != "plain text" or not other_style.font_size
                or other_style.font_size > 8.5
                or abs(other_style.font_size - size) > size * 0.15
                or abs(other_box.x - box.x) > size * 0.25
                or not box.x2 - box.x <= other_box.x2 - other_box.x <= 150):
            continue
        if other_box.y >= box.y2:
            neighbours["above"].append((other_box.y - box.y2, other_box))
        elif other_box.y2 <= box.y:
            neighbours["below"].append((box.y - other_box.y2, other_box))
    if any(not values for values in neighbours.values()):
        return None
    above, below = (min(neighbours[side], key=lambda item: item[0])
                    for side in ("above", "below"))
    if max(above[0], below[0]) > size * 8:
        return None
    right = min(above[1].x2, below[1].x2)
    guard = size * 0.5
    for obstacle in page_obstacle_boxes(page, paragraph):
        if (obstacle.y2 > box.y - guard and obstacle.y < box.y2 + guard
                and obstacle.x2 > box.x2 and obstacle.x < right):
            # An object already crossing the old right edge makes any new
            # horizontal allocation ambiguous; retain the original box.
            right = min(right, max(box.x2, obstacle.x - guard))
    if right <= box.x2 + size:
        return None
    return Box(x=box.x, y=box.y, x2=right, y2=box.y2)


def source_paragraph_box(paragraph):
    from babeldoc.format.pdf.document_il.il_version_1 import Box

    box = paragraph.box
    if box is None:
        return None
    glyph_boxes = [item for char in characters(paragraph.pdf_paragraph_composition)
                   for item in (char.box, char.visual_bbox.box if char.visual_bbox else None)
                   if item is not None]
    return Box(x=box.x, x2=box.x2,
               y=min([box.y] + [item.y for item in glyph_boxes]),
               y2=max([box.y2] + [item.y2 for item in glyph_boxes]))


def prepare_table_cell_allocations(page, source_boxes):
    """Prove cells of a numbered evidence table without changing source IL.

    Repeated columns, consecutive first-column citation markers, and source
    horizontal rules establish the grid. Source line requests remain separate;
    the typesetter later flows them together inside that physical cell.
    """
    from babeldoc.format.pdf.document_il.il_version_1 import Box

    plans = []
    for table in page.page_layout:
        if table.class_name != "table" or table.box is None or (table.conf or 0) < 0.8:
            continue
        tb = table.box
        parts = [p for p in page.pdf_paragraph if id(p) in source_boxes
                 and p.layout_label == "fallback_line"
                 and tb.x <= source_boxes[id(p)].x and tb.x2 >= source_boxes[id(p)].x2
                 and tb.y <= source_boxes[id(p)].y and tb.y2 >= source_boxes[id(p)].y2]
        sizes = [p.pdf_style.font_size for p in parts if p.pdf_style and p.pdf_style.font_size]
        if not sizes:
            continue
        size = median(sizes)
        markers = []
        for p in parts:
            b = source_boxes[id(p)]
            match = REFERENCE_MARKER.fullmatch(_source_text(p.pdf_paragraph_composition).strip())
            if match and (b.x + b.x2) * 0.5 < tb.x + (tb.x2 - tb.x) * 0.2:
                markers.append((p, int(match.group(1))))
        markers.sort(key=lambda item: -source_boxes[id(item[0])].y2)
        if (len(markers) < 4 or any(right[1] != left[1] + 1
                                    for left, right in zip(markers, markers[1:]))):
            continue
        marker_x = median((source_boxes[id(p)].x + source_boxes[id(p)].x2) * 0.5 for p, _ in markers)
        rules = sorted({curve.box.y for curve in page.pdf_curve if curve.box is not None
                        and abs(curve.box.y2 - curve.box.y) < 0.1
                        and curve.box.x <= tb.x + 2 and curve.box.x2 >= tb.x2 - 3
                        and tb.y <= curve.box.y <= tb.y2})
        above = [y for y in rules if y > max(source_boxes[id(p)].y2 for p, _ in markers)]
        below = [y for y in rules if y < min(source_boxes[id(p)].y for p, _ in markers)]
        if not above or not below:
            continue
        top_rule, bottom_rule = min(above), max(below)
        body = [p for p in parts if source_boxes[id(p)].y >= bottom_rule
                and source_boxes[id(p)].y2 <= top_rule]
        anchors = [p for p in body if abs((source_boxes[id(p)].x + source_boxes[id(p)].x2) * 0.5 - marker_x) <= size]
        anchors.sort(key=lambda p: -source_boxes[id(p)].y2)
        anchor_ys = [(source_boxes[id(p)].y + source_boxes[id(p)].y2) * 0.5 for p in anchors]
        if len(anchors) < len(markers) or any(a - b < size * 2 for a, b in zip(anchor_ys, anchor_ys[1:])):
            continue
        clusters = []
        for p in sorted(body, key=lambda p: (source_boxes[id(p)].x + source_boxes[id(p)].x2) * 0.5):
            x = (source_boxes[id(p)].x + source_boxes[id(p)].x2) * 0.5
            if not clusters or abs(x - median(clusters[-1])) > size * 0.8:
                clusters.append([])
            clusters[-1].append(x)
        columns = [median(cluster) for cluster in clusters if len(cluster) >= 3]
        if len(columns) < 4 or any(b - a < size * 3 for a, b in zip(columns, columns[1:])):
            continue
        members, row_members, unassigned = {}, [[] for _ in anchors], []
        for p in body:
            b = source_boxes[id(p)]
            row = min(range(len(anchors)), key=lambda index: abs((b.y + b.y2) * 0.5 - anchor_ys[index]))
            column = min(range(len(columns)), key=lambda index: abs((b.x + b.x2) * 0.5 - columns[index]))
            row_members[row].append(p)
            if abs((b.x + b.x2) * 0.5 - columns[column]) > size:
                unassigned.append(p)
                continue
            members.setdefault((row, column), []).append(p)
        if any(not values for values in row_members):
            continue
        row_bounds = [Box(x=min(source_boxes[id(p)].x for p in values),
                          x2=max(source_boxes[id(p)].x2 for p in values),
                          y=min(source_boxes[id(p)].y for p in values),
                          y2=max(source_boxes[id(p)].y2 for p in values)) for values in row_members]
        if any(below_box.y2 - above_box.y > size * 0.25
               for above_box, below_box in zip(row_bounds, row_bounds[1:])):
            continue
        y_edges = [top_rule - 0.5] + [(a.y + b.y2) * 0.5 for a, b in zip(row_bounds, row_bounds[1:])] + [bottom_rule + 0.5]
        x_edges = [tb.x + 0.5] + [(a + b) * 0.5 for a, b in zip(columns, columns[1:])] + [tb.x2 - 0.5]
        cells = []
        for (row, column), values in sorted(members.items()):
            if column == 0:
                continue
            cell = Box(x=x_edges[column] + 0.25, x2=x_edges[column + 1] - 0.25,
                       y=y_edges[row + 1] + 0.25, y2=y_edges[row] - 0.25)
            if any(source_boxes[id(p)].y2 > cell.y and source_boxes[id(p)].y < cell.y2
                   and source_boxes[id(p)].x2 > cell.x and source_boxes[id(p)].x < cell.x2 for p in unassigned):
                continue
            if any(ob.y2 > cell.y and ob.y < cell.y2 and ob.x2 > cell.x and ob.x < cell.x2
                   for ob in page_obstacle_boxes(page, values[0], include_paragraphs=False)):
                # Never flow through a table image, rule, or protected graphic.
                continue
            values.sort(key=lambda p: -source_boxes[id(p)].y2)
            cells.append({"id": f"table-{table.id}-row-{row}-column-{column}",
                          "row": row, "column": column, "box": asdict(cell),
                          "parts": [{"id": p.debug_id, "sourceBox": asdict(source_boxes[id(p)])} for p in values]})
        if cells:
            numbers = {id(p): number for p, number in markers}
            plans.append({"page": page.page_number + 1, "reason": "verified table cell allocations",
                          "tableId": table.id, "tableBox": asdict(tb), "confidence": table.conf,
                          "topRule": top_rule, "bottomRule": bottom_rule, "columns": columns,
                          "rowAnchors": [{"id": p.debug_id, "centerY": y, "sourceBox": asdict(source_boxes[id(p)]),
                                          "number": numbers.get(id(p))} for p, y in zip(anchors, anchor_ys)],
                          "rows": [{"index": index, "y": y_edges[index + 1], "y2": y_edges[index],
                                    "sourceBounds": asdict(value)} for index, value in enumerate(row_bounds)],
                          "cells": cells})
    return plans


def prepare_source(document):
    import re
    from babeldoc.format.pdf.document_il.il_version_1 import Box, PdfParagraphComposition
    from babeldoc.format.pdf.document_il.utils.formular_helper import update_formula_data
    from babeldoc.format.pdf.document_il.utils.layout_helper import get_paragraph_unicode

    line_skips, boxes, changes = {}, {}, prepare_reference_layout(document)
    for page in document.page:
        paragraphs = []
        for paragraph in page.pdf_paragraph:
            comps = paragraph.pdf_paragraph_composition
            # Some TeX PDFs identify a math accent as ordinary text. Keep an
            # isolated accent with the formula whose glyph it overlaps, retaining
            # its original font and exact relative position. Include an adjacent
            # opening formula group so the resulting expression is indivisible.
            index = 0
            while index + 1 < len(comps):
                accent = comps[index].pdf_same_style_characters
                following = comps[index + 1].pdf_formula
                accent_text = "".join(char.char_unicode or "" for char in accent.pdf_character) if accent else ""
                if (accent and following and accent_text in set("ˆˇ˘˙¨˜¯")
                        and accent.box.x < following.box.x2 and accent.box.x2 > following.box.x
                        and accent.box.y > following.box.y + (following.box.y2 - following.box.y) * 0.4):
                    start = index
                    previous = comps[index - 1].pdf_formula if index else None
                    if (previous and abs(previous.box.y - following.box.y) < 1
                            and 0 <= following.box.x - previous.box.x2 < 3):
                        start -= 1
                    merged = deepcopy(following)
                    merged.pdf_character = list(characters(comps[start:index + 2]))
                    merged.pdf_curve = [curve for composition in comps[start:index + 2]
                                        if composition.pdf_formula for curve in composition.pdf_formula.pdf_curve]
                    merged.pdf_form = [form for composition in comps[start:index + 2]
                                       if composition.pdf_formula for form in composition.pdf_formula.pdf_form]
                    merged.x_offset = merged.y_offset = merged.x_advance = 0
                    update_formula_data(merged)
                    comps[start:index + 2] = [PdfParagraphComposition(pdf_formula=merged)]
                    paragraph.unicode = get_paragraph_unicode(paragraph)
                    changes.append({"page": page.page_number + 1, "id": paragraph.debug_id,
                                    "reason": "preserve overlapping math accent"})
                    index = start + 1
                else:
                    index += 1
            parts = [paragraph]
            # A small article-type label above a large title is a separate line,
            # even when the detector has assigned both to one title region.
            if paragraph.layout_label == "title" and len(comps) >= 2:
                prefix = comps[0].pdf_same_style_characters
                if prefix and prefix.pdf_style and paragraph.pdf_style:
                    rest = group_box(comps[1:], Box)
                    if (prefix.pdf_style.font_size < paragraph.pdf_style.font_size * 0.75
                            and prefix.box.y > rest.y2 + 1):
                        parts = split_groups(paragraph, [comps[:1], comps[1:]], Box,
                                             get_paragraph_unicode,
                                             [prefix.pdf_style, paragraph.pdf_style])
                        changes.append({"page": page.page_number + 1, "id": paragraph.debug_id,
                                        "reason": "separate title label", "parts": len(parts)})

            # Small-print affiliation rows have left-aligned 1/2/* prefixes on
            # separate baselines. Do not split general body text or equations.
            if (len(parts) == 1 and page.page_number == 0 and paragraph.pdf_style
                    and paragraph.pdf_style.font_size <= 8.5 and "@" in (paragraph.unicode or "")):
                markers = []
                for index, composition in enumerate(comps):
                    value = composition_value(composition)
                    if value is None or value.box is None:
                        continue
                    text = "".join(char.char_unicode or "" for char in characters([composition])).strip()
                    if (text and (text.isdigit() or text == "*") and len(text) <= 2
                            and value.box.x <= paragraph.box.x + 2):
                        markers.append(index)
                has_correspondence_marker = any(
                    "".join(char.char_unicode or "" for char in characters([comps[index]])).strip() == "*"
                    for index in markers)
                if (len(markers) >= 2 and markers[0] == 0 and has_correspondence_marker
                        and paragraph.box.x2 - paragraph.box.x > 200):
                    marker_boxes = [composition_value(comps[index]).box for index in markers]
                    if all(first.y > second.y2 for first, second in zip(marker_boxes, marker_boxes[1:])):
                        ends = markers[1:] + [len(comps)]
                        parts = split_groups(paragraph, [comps[start:end] for start, end in zip(markers, ends)],
                                             Box, get_paragraph_unicode)
                        changes.append({"page": page.page_number + 1, "id": paragraph.debug_id,
                                        "reason": "separate affiliation rows", "parts": len(parts)})
            # A narrow sidebar can contain several independent label/value rows.
            # Preserve these line boundaries instead of flowing the labels into
            # one paragraph (e.g. four publication dates).
            if (len(parts) == 1 and len(comps) == 1 and comps[0].pdf_same_style_characters
                    and paragraph.pdf_style and paragraph.pdf_style.font_size <= 8.5
                    and paragraph.box.x2 - paragraph.box.x <= 150):
                value = comps[0].pdf_same_style_characters
                rows = []
                for char in value.pdf_character:
                    if not rows or abs(char.box.y - rows[-1][0].box.y) > 1:
                        rows.append([])
                    rows[-1].append(char)
                groups = []
                for row in rows:
                    group = deepcopy(value)
                    group.pdf_character = row
                    group.box = Box(x=min(char.box.x for char in row),
                                    y=min(char.box.y for char in row),
                                    x2=max(char.box.x2 for char in row),
                                    y2=max(char.box.y2 for char in row))
                    groups.append([PdfParagraphComposition(pdf_same_style_characters=group)])
                if len(groups) >= 3:
                    candidates = split_groups(paragraph, groups, Box, get_paragraph_unicode)
                    if all(re.match(r"^[A-Za-z][A-Za-z ]{1,25}:", candidate.unicode) for candidate in candidates):
                        column = sidebar_column_allocation(page, paragraph)
                        for candidate in candidates:
                            candidate.box.x = paragraph.box.x
                            candidate.box.x2 = column.x2 if column is not None else paragraph.box.x2
                        parts = candidates
                        changes.append({"page": page.page_number + 1, "id": paragraph.debug_id,
                                        "reason": "separate sidebar label/value rows", "parts": len(parts)})
                        if column is not None:
                            changes.append({"page": page.page_number + 1, "id": paragraph.debug_id,
                                            "reason": "recover aligned sidebar column allocation",
                                            "oldRight": paragraph.box.x2, "right": column.x2})
            paragraphs.extend(parts)

        page.pdf_paragraph = paragraphs
        table_source_boxes = {id(paragraph): source_paragraph_box(paragraph) for paragraph in paragraphs
                              if paragraph.box is not None}
        cell_plans = prepare_table_cell_allocations(page, table_source_boxes)
        cell_parts = {part["id"]: (cell, plan) for plan in cell_plans for cell in plan["cells"] for part in cell["parts"]}
        proven_table_body = {paragraph.debug_id for paragraph in paragraphs
                             if id(paragraph) in table_source_boxes
                             and any(plan["bottomRule"] <= table_source_boxes[id(paragraph)].y
                                     and table_source_boxes[id(paragraph)].y2 <= plan["topRule"]
                                     and plan["tableBox"]["x"] <= table_source_boxes[id(paragraph)].x
                                     and plan["tableBox"]["x2"] >= table_source_boxes[id(paragraph)].x2
                                     for plan in cell_plans)}
        for paragraph in paragraphs:
            chars = list(characters(paragraph.pdf_paragraph_composition))
            # Retain the detected region and include original glyph em bounds.
            # This is an allocation correction before translation, never an
            # excuse to expand a translated paragraph into neighbouring content.
            raw_boxes = [char.box for char in chars if char.box]
            raw_boxes.extend(char.visual_bbox.box for char in chars
                             if char.visual_bbox and char.visual_bbox.box)
            if raw_boxes and paragraph.box:
                paragraph.box = Box(
                    x=paragraph.box.x, x2=paragraph.box.x2,
                    y=min(paragraph.box.y, *(box.y for box in raw_boxes)),
                    y2=max(paragraph.box.y2, *(box.y2 for box in raw_boxes)),
                )
            counter_box = page_counter_allocation(page, paragraph)
            if counter_box is not None:
                old_left = paragraph.box.x
                paragraph.box = counter_box
                boxes[(page.page_number, paragraph.debug_id, "right-anchor")] = counter_box.x2
                changes.append({"page": page.page_number + 1, "id": paragraph.debug_id,
                                "reason": "reserve right-aligned page counter space",
                                "oldLeft": old_left, "left": counter_box.x})
            table_box = (table_line_allocation(page, paragraph, table_source_boxes)
                         if paragraph.debug_id not in proven_table_body else None)
            if table_box is not None:
                original_box = paragraph.box
                boxes[(page.page_number, paragraph.debug_id, "center-anchor")] = (original_box.x + original_box.x2) * 0.5
                paragraph.box = table_box
                changes.append({"page": page.page_number + 1, "id": paragraph.debug_id,
                                "reason": "reserve proven table cell line space",
                                "oldLeft": original_box.x, "oldRight": original_box.x2,
                                "left": table_box.x, "right": table_box.x2})
            size = paragraph.pdf_style.font_size if paragraph.pdf_style else None
            if size and size >= 4:
                baselines = sorted(char.box.y for char in chars if char.box and char.pdf_style
                                   and abs(char.pdf_style.font_size - size) < size * 0.1)
                lines = []
                for baseline in baselines:
                    if not lines or baseline - lines[-1] > 1:
                        lines.append(baseline)
                gaps = [second - first for first, second in zip(lines, lines[1:])]
                if gaps:
                    line_skips[(page.page_number, paragraph.debug_id)] = max(1.05, min(1.5, median(gaps) / size))
            boxes[(page.page_number, paragraph.debug_id)] = deepcopy(paragraph.box)
            if paragraph.debug_id in cell_parts:
                cell, plan = cell_parts[paragraph.debug_id]
                boxes[(page.page_number, paragraph.debug_id, "table-cell")] = cell
            accents = reference_accent_anchors(paragraph)
            if accents:
                boxes[(page.page_number, paragraph.debug_id, "reference-accents")] = accents
            if ":reference-" in (paragraph.debug_id or "") and paragraph.pdf_paragraph_composition:
                marker = paragraph.pdf_paragraph_composition[0].pdf_formula
                if marker and REFERENCE_MARKER.fullmatch(_source_text([paragraph.pdf_paragraph_composition[0]])):
                    baseline = marker.pdf_character[0].box.y
                    body = [char.box.x for char in characters(paragraph.pdf_paragraph_composition[1:])
                            if char.box and abs(char.box.y - baseline) < size * 0.15
                            and (char.char_unicode or "").strip()]
                    if body:
                        # A private allocation entry preserves hanging indents;
                        # normal paragraph keys remain the source Box objects.
                        boxes[(page.page_number, paragraph.debug_id, "reference-body-x")] = min(body)
        changes.extend(cell_plans)
    return line_skips, boxes, changes


def install_typesetting_policy(Typesetting, line_skips, boxes):
    """Fit full text at 85-100%, retaining source regions and source line grid."""
    from babeldoc.format.pdf.document_il.il_version_1 import PdfParagraphComposition

    original_units = Typesetting.create_typesetting_units
    original_lookahead = Typesetting._get_width_before_next_break_point
    original_preprocess = Typesetting.preprocess_document
    original_render_paragraph = Typesetting.render_paragraph
    individual_scales = {}
    runtime_boxes, cell_scales, cell_top_overhangs = {}, {}, {}
    cell_paragraph_objects = set()
    closing_punctuation = set("，。；：？！、）】》」』〕〉〗〙〛”’")

    def create_units(self, paragraph, fonts):
        units = original_units(self, paragraph, fonts)
        if id(paragraph) in cell_paragraph_objects:
            for unit in units:
                if unit.char and unit.char.pdf_style and unit.char.pdf_style.font_size:
                    unit.height_cache = unit.char.pdf_style.font_size
        if ":reference-" in (paragraph.debug_id or ""):
            from babeldoc.format.pdf.document_il.midend.typesetting import TypesettingUnit
            # The policy is installed before source extraction. Consult its
            # shared allocation registry at use time, after prepare_source.
            reference_body_positions = {key[1]: value for key, value in boxes.items()
                                        if len(key) == 3 and key[2] == "reference-body-x"}
            reference_accents = next((value for key, value in boxes.items()
                                     if len(key) == 3 and key[1] == paragraph.debug_id
                                     and key[2] == "reference-accents"), [])

            class ReferenceFormulaUnit(TypesettingUnit):
                # A reference with untranslated source prose still needs layout
                # after compacting its citation geometry. Force that paragraph
                # through the same measured fit as translated references.
                @property
                def can_passthrough(self):
                    return False

                def relocate(self, x, y, scale):
                    relocated = super().relocate(x, y, scale)
                    result = ReferenceFormulaUnit(formular=relocated.formular)
                    result.try_resue_cache(relocated)
                    return result

                def render(self):
                    return self.passthrough()

            class ReferenceMarkerUnit(ReferenceFormulaUnit):
                def __init__(self, formular, offset):
                    super().__init__(formular=formular)
                    self.offset = offset
                    self.width_cache = 0

                def relocate(self, x, y, scale):
                    from babeldoc.format.pdf.document_il.il_version_1 import Box
                    relocated = super().relocate(x - self.offset * scale, y, scale)
                    result = ReferenceMarkerUnit(relocated.formular, self.offset)
                    # The number occupies the source hanging-indent margin;
                    # author/title text starts at x on every line.
                    result.box_cache = Box(x=x, x2=x, y=relocated.box.y, y2=relocated.box.y2)
                    return result

            class ReferenceAccentUnit(ReferenceFormulaUnit):
                def __init__(self, formular, offset_x, offset_y, source_height):
                    super().__init__(formular=formular)
                    self.offset_x, self.offset_y = offset_x, offset_y
                    self.source_height = source_height
                    self.width_cache = 0
                    self.height_cache = source_height
                    # Reserve the following Latin word before allowing a wrap,
                    # so an accent cannot be stranded at the end of a line.
                    self.can_break_line_cache = False

                def relocate(self, x, y, scale):
                    from babeldoc.format.pdf.document_il.il_version_1 import Box
                    relocated = super().relocate(x + self.offset_x * scale,
                                                 y + self.offset_y * scale, scale)
                    result = ReferenceAccentUnit(relocated.formular, self.offset_x,
                                                 self.offset_y, self.source_height * scale)
                    # Keep the inline cursor on the following base letter. The
                    # emitted glyph retains its full source font/CID/ink bounds.
                    result.box_cache = Box(x=x, x2=x, y=relocated.box.y, y2=relocated.box.y2)
                    return result

            units = [ReferenceFormulaUnit(formular=compact_reference_formula(unit.formular))
                     if unit.formular and REFERENCE_JOURNAL.search(
                         "".join(char.char_unicode or "" for char in unit.formular.pdf_character))
                     else unit for unit in units]
            matched_accents = 0
            for index, unit in enumerate(units):
                if not unit.formular or len(unit.formular.pdf_character) != 1:
                    continue
                accent = unit.formular.pdf_character[0]
                signature = (accent.char_unicode, accent.pdf_character_id,
                             accent.pdf_style.font_id, accent.xobj_id)
                matching = [anchor for anchor in reference_accents if anchor["signature"] == signature]
                if not matching:
                    continue
                if len(matching) != 1 or index + 1 >= len(units):
                    raise ReferenceLayoutError("Reference diacritic target attachment is ambiguous.")
                anchor, base_unit = matching[0], units[index + 1]
                if base_unit.try_get_unicode() != anchor["base"]:
                    raise ReferenceLayoutError("Reference diacritic no longer precedes its source letter.")
                # CJK fallback fonts can give Latin a/u a slightly wider advance.
                # Keep the old accent glyph centered over that actual advance.
                offset_x = anchor["offsetX"] + (base_unit.width - anchor["baseWidth"]) * 0.5
                units[index] = ReferenceAccentUnit(
                    compact_reference_formula(unit.formular), offset_x, anchor["offsetY"],
                    accent.pdf_style.font_size)
                matched_accents += 1
            if matched_accents != len(reference_accents):
                raise ReferenceLayoutError("Reference diacritic source glyph coverage changed.")
            if (units and units[0].formular and paragraph.debug_id in reference_body_positions
                    and REFERENCE_MARKER.fullmatch("".join(char.char_unicode or ""
                                                         for char in units[0].formular.pdf_character))):
                body_x = reference_body_positions[paragraph.debug_id]
                marker = units[0].formular
                offset = body_x - marker.pdf_character[0].box.x
                if offset < 0 or offset > paragraph.pdf_style.font_size * 4:
                    raise ReferenceLayoutError("Reference hanging indent has ambiguous source geometry.")
                units[0] = ReferenceMarkerUnit(compact_reference_formula(marker), offset)
            for unit in units:
                if unit.char and unit.char.pdf_style and unit.char.pdf_style.font_size:
                    # Source Latin units report ink height but relocate to an em
                    # box. A tight reference allocation must measure the emitted
                    # em, including collect's untranslated fixture, from the start.
                    unit.height_cache = unit.char.pdf_style.font_size
        for unit in units:
            # No hanging punctuation outside source columns. Keep numeric
            # percentages together, including the decimal point and sign.
            unit.is_hung_punctuation_cache = False
            if unit.try_get_unicode() in ("%", "％", "."):
                unit.can_break_line_cache = False
        return units

    def lookahead(self, units, scale):
        width = original_lookahead(self, units, scale)
        if units and not units[0].can_break_line:
            # Upstream includes the current unbreakable Latin unit in this
            # lookahead, while its caller adds that unit's width separately.
            # Count it once; the independent emitted-glyph bounds below still
            # require the complete word to remain inside the allocation.
            width = max(0, width - units[0].width * scale)
        # A Chinese closing mark stays with the preceding character. Reserving
        # its width before that character wraps keeps punctuation inside the
        # source column without moving it to the start of the following line.
        closing_width = 0
        for following in units[1:]:
            if following.try_get_unicode() not in closing_punctuation:
                break
            closing_width += following.width * scale
        if units and units[0].formular:
            formula_text = "".join(char.char_unicode or "" for char in units[0].formular.pdf_character).strip()
            # Isotope mass numbers stay attached to their immediately following
            # element symbol, e.g. superscript 87 + Rb.
            if formula_text.isdigit() and len(formula_text) <= 3:
                symbol_width = 0
                symbol = ""
                for following in units[1:]:
                    char = following.try_get_unicode() or ""
                    if len(char) != 1 or not char.isascii() or not char.isalpha():
                        break
                    symbol += char
                    symbol_width += following.width * scale
                if symbol and len(symbol) <= 3:
                    closing_width = max(closing_width, symbol_width)
        return max(width, closing_width)

    def fit(self, paragraph, page, units, initial_scale=1.0,
            use_english_line_break=True, apply_layout=False):
        key = (page.page_number, paragraph.debug_id)
        paragraph.box = deepcopy(runtime_boxes.get(key, boxes[key]))
        allocation_box = deepcopy(paragraph.box)
        allocation_box.y2 -= cell_top_overhangs.get(key, 0)
        if key + ("reference-body-x",) in boxes:
            allocation_box.x = boxes[key + ("reference-body-x",)]
        line_skip = 1.05 if key in cell_scales else line_skips.get(key, 1.3)
        candidates = (cell_scales[key],) if key in cell_scales else (1.0, 0.95, 0.9, 0.85)
        for scale in candidates:
            if scale > initial_scale + 0.001:
                continue
            if key + ("right-anchor",) in boxes:
                allocation_box.x = max(paragraph.box.x,
                                       boxes[key + ("right-anchor",)] - sum(unit.width for unit in units) * scale)
            elif key + ("center-anchor",) in boxes:
                width = sum(unit.width for unit in units) * scale
                allocation_box.x = max(paragraph.box.x,
                                       min(paragraph.box.x2 - width,
                                           boxes[key + ("center-anchor",)] - width * 0.5))
            laid_out, fits = self._layout_typesetting_units(
                units, allocation_box, scale, line_skip, paragraph, True)
            layout_fits = fits
            # Upstream checks line starts, so independently check whole glyph
            # bounds, including the first line and punctuation at the right.
            fits = fits and all(unit.box.x >= paragraph.box.x - 0.05
                                and unit.box.x2 <= paragraph.box.x2 + 0.05
                                and unit.box.y >= paragraph.box.y - 0.05
                                and unit.box.y2 <= paragraph.box.y2 + 0.05 for unit in laid_out)
            if not fits:
                if scale == 0.85 and ":reference-" in (paragraph.debug_id or ""):
                    logging.getLogger(__name__).warning(
                        "Reference fit diagnostics id=%s units=%s layoutFits=%s source=%s allocation=%s bounds=%s",
                        paragraph.debug_id, len(units), layout_fits, paragraph.box, allocation_box,
                        (min((unit.box.x for unit in laid_out), default=None),
                         min((unit.box.y for unit in laid_out), default=None),
                         max((unit.box.x2 for unit in laid_out), default=None),
                         max((unit.box.y2 for unit in laid_out), default=None)))
                continue
            individual_scales[key] = scale
            if apply_layout:
                paragraph.scale = scale
                paragraph.pdf_paragraph_composition = []
                for unit in laid_out:
                    chars, curves, forms = unit.render()
                    paragraph.pdf_paragraph_composition.extend(
                        PdfParagraphComposition(pdf_character=char) for char in chars)
                    page.pdf_curve.extend(curves)
                    page.pdf_form.extend(forms)
            return scale, laid_out if apply_layout else None
        raise RuntimeError(f"Full translation cannot fit at >=85%: {paragraph.debug_id}")

    def plan_table_cells(self, document):
        from babeldoc.format.pdf.document_il.il_version_1 import Box

        for page in document.page:
            self._lumior_current_page = page.page_number
            cells = {}
            for paragraph in page.pdf_paragraph:
                cell = boxes.get((page.page_number, paragraph.debug_id, "table-cell"))
                if cell is not None:
                    cells[cell["id"]] = cell
            if not cells:
                continue
            cell_paragraph_objects.update(id(paragraph) for paragraph in page.pdf_paragraph
                                          if (page.page_number, paragraph.debug_id, "table-cell") in boxes)
            page_fonts = {font.font_id: font for font in page.pdf_font if font.font_id}
            fonts = dict(page_fonts)
            fonts.update(getattr(self.font_mapper, "fontid2font", {}))
            for xobject in page.pdf_xobject:
                if xobject.xobj_id is not None:
                    fonts[xobject.xobj_id] = dict(page_fonts)
                    fonts[xobject.xobj_id].update({font.font_id: font for font in xobject.pdf_font if font.font_id})
            paragraphs = {paragraph.debug_id: paragraph for paragraph in page.pdf_paragraph}
            for cell in cells.values():
                cb = Box(**cell["box"])
                parts = [paragraphs[part["id"]] for part in cell["parts"]]
                units = [self.create_typesetting_units(part, fonts) for part in parts]
                successful = None
                for scale in (1.0, 0.95, 0.9, 0.85):
                    heights, overhangs = [], []
                    for paragraph, paragraph_units in zip(parts, units):
                        measure = Box(x=cb.x, x2=cb.x2, y=0, y2=4096)
                        laid_out, fits = self._layout_typesetting_units(
                            paragraph_units, measure, scale, 1.05, paragraph, True)
                        if (not fits or len(laid_out) != len(paragraph_units)
                                or any(unit.box.x < cb.x - 0.05 or unit.box.x2 > cb.x2 + 0.05 for unit in laid_out)):
                            break
                        low = min(unit.box.y for unit in laid_out)
                        high = max(unit.box.y2 for unit in laid_out)
                        # Avoid an exact-bottom floating-point comparison
                        # inventing a new line-fit failure when relocating a
                        # measured multiline run from the virtual origin.
                        heights.append(high - low + 0.02)
                        overhangs.append(max(0, high - measure.y2))
                    if len(heights) != len(parts):
                        continue
                    needed = sum(heights) + 0.5 * (len(parts) - 1)
                    if needed <= cb.y2 - cb.y + 0.05:
                        successful = scale, heights, overhangs, needed
                        break
                if successful is None:
                    raise RuntimeError(f"Full table cell translation cannot fit at >=85%: {cell['id']}")
                scale, heights, overhangs, needed = successful
                cursor = cb.y2 - ((cb.y2 - cb.y) - needed) * 0.5
                for paragraph, height, overhang in zip(parts, heights, overhangs):
                    key = (page.page_number, paragraph.debug_id)
                    runtime_boxes[key] = Box(x=cb.x, x2=cb.x2, y=cursor - height, y2=cursor)
                    cell_scales[key] = individual_scales[key] = scale
                    cell_top_overhangs[key] = overhang
                    cursor -= height + 0.5

    def preprocess(self, document, pbar):
        plan_table_cells(self, document)
        result = original_preprocess(self, document, pbar)
        # Do not shrink all paragraphs to a document-wide mode. Only a paragraph
        # that actually needs extra room receives its own small size reduction.
        for page in document.page:
            for paragraph in page.pdf_paragraph:
                key = (page.page_number, paragraph.debug_id)
                if key in individual_scales:
                    paragraph.optimal_scale = individual_scales[key]
        return result

    def render_paragraph(self, paragraph, page, fonts):
        self._lumior_current_page = page.page_number
        key = (page.page_number, paragraph.debug_id)
        if key in cell_scales:
            units = self.create_typesetting_units(paragraph, fonts)
            fit(self, paragraph, page, units, initial_scale=cell_scales[key], apply_layout=True)
            self._update_paragraph_render_order(paragraph)
            return None
        paragraph.box = deepcopy(boxes[key])
        return original_render_paragraph(self, paragraph, page, fonts)

    Typesetting.create_typesetting_units = create_units
    Typesetting._get_width_before_next_break_point = lookahead
    Typesetting._find_optimal_scale_and_layout = fit
    Typesetting.preprocess_document = preprocess
    Typesetting.render_paragraph = render_paragraph
    Typesetting.plan_table_cells = plan_table_cells
