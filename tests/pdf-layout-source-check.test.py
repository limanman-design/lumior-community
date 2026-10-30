"""Independent PDF-source checks with real, tiny PDF streams and fault injection.

No model or layout engine is involved. The source IL and PDF operands are
explicit fixtures so parser/coordinate mistakes cannot pass via shared output.
"""

from copy import deepcopy
import importlib.util
from pathlib import Path
import sys
import tempfile
import unittest

SPEC = importlib.util.spec_from_file_location("lumior_source_checker", Path(__file__).resolve().parents[1] / "scripts/check-pdf-layout.py")
CHECKER = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(CHECKER)


def write_pdf(path, stream, *, font="Helvetica", font_extra=""):
    content = stream.encode("ascii")
    objects = [b"<< /Type /Catalog /Pages 2 0 R >>",
               b"<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
               b"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 200] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
               f"<< /Type /Font /Subtype /Type1 /BaseFont /{font} {font_extra} >>".encode(),
               f"<< /Length {len(content)} >>\nstream\n".encode() + content + b"\nendstream"]
    data, offsets = b"%PDF-1.7\n", [0]
    for index, value in enumerate(objects, 1):
        offsets.append(len(data))
        data += f"{index} 0 obj\n".encode() + value + b"\nendobj\n"
    start = len(data)
    data += b"xref\n0 6\n0000000000 65535 f \n" + b"".join(f"{offset:010d} 00000 n \n".encode() for offset in offsets[1:])
    data += f"trailer << /Size 6 /Root 1 0 R >>\nstartxref\n{start}\n%%EOF\n".encode()
    path.write_bytes(data)


def draw(text, x=20, y=50, *, size=10, vertical=False):
    matrix = f"0 1 -1 0 {x} {y}" if vertical else f"1 0 0 1 {x} {y}"
    return f"BT /F1 {size} Tf {matrix} Tm ({text}) Tj ET\n"


def glyph(text, cid, box, *, size=10, vertical=False):
    return {"char_unicode": text, "pdf_character_id": cid,
            "pdf_style": {"font_id": "F1", "font_size": size},
            "box": dict(zip(("x", "y", "x2", "y2"), box)), "vertical": vertical, "xobj_id": 0}


def paragraph(identity, characters, *, formulas=(), box=(15, 45, 55, 85)):
    compositions = [{"pdf_same_style_characters": {"pdf_character": characters}}] if characters else []
    compositions += [{"pdf_formula": {"pdf_character": values, "box": dict(zip(("x", "y", "x2", "y2"), bounds))}}
                     for values, bounds in formulas]
    return {"debug_id": identity, "layout_label": "plain text", "box": dict(zip(("x", "y", "x2", "y2"), box)),
            "pdf_paragraph_composition": compositions}


def document(paragraphs):
    return {"page": [{"page_number": 0, "pdf_font": [{"font_id": "F1", "name": "Helvetica"}],
                      "pdf_paragraph": paragraphs}]}


def table_fixture():
    """Four real citation rows and columns, with a two-line target cell."""
    parts = []
    columns, ys = [25, 65, 105, 145], [160, 120, 80, 40]
    for row, y in enumerate(ys):
        for column, x in enumerate(columns):
            text = f"[{row + 1}]" if column == 0 else "X"
            advance = 20 / len(text)
            values = [glyph(char, ord(char), (x - 10 + i * advance, y - 5,
                                             x - 10 + (i + 1) * advance, y + 5)) for i, char in enumerate(text)]
            p = paragraph(f"r{row}c{column}", values, box=(x - 10, y - 5, x + 10, y + 5))
            p.update(layout_label="fallback_line", pdf_style={"font_id": "F1", "font_size": 10}, unicode=text)
            parts.append(p)
    source = document(parts)
    source["total_pages"] = 1
    page = source["page"][0]
    page.update(cropbox={"box": CHECKER.box_dict((0, 0, 200, 200))},
                mediabox={"box": CHECKER.box_dict((0, 0, 200, 200))},
                page_layout=[{"id": 3, "class_name": "table", "conf": 0.97, "box": CHECKER.box_dict((10, 20, 190, 190))}],
                pdf_curve=[{"box": CHECKER.box_dict((10, y, 190, y)), "render_order": i}
                           for i, y in enumerate((185, 175, 25))])
    translated, final = deepcopy(source), deepcopy(source)
    entry = {"page": 1, "reason": "verified table cell allocations", "tableId": 3,
             "tableBox": CHECKER.box_dict((10, 20, 190, 190)), "confidence": 0.97,
             "topRule": 175, "bottomRule": 25, "columns": columns, "rowAnchors": [], "rows": [], "cells": []}
    y_edges, x_edges = [174.5, 140, 100, 60, 25.5], [10.5, 45, 85, 125, 189.5]
    for row, y in enumerate(ys):
        anchor = parts[row * 4]
        entry["rowAnchors"].append({"id": anchor["debug_id"], "centerY": y, "sourceBox": deepcopy(anchor["box"]), "number": row + 1})
        entry["rows"].append({"index": row, "y": y_edges[row + 1], "y2": y_edges[row],
                              "sourceBounds": CHECKER.box_dict((15, y - 5, 155, y + 5))})
        for column in range(1, 4):
            p = parts[row * 4 + column]
            cell = (x_edges[column] + 0.25, y_edges[row + 1] + 0.25,
                    x_edges[column + 1] - 0.25, y_edges[row] - 0.25)
            entry["cells"].append({"id": f"table-3-row-{row}-column-{column}", "row": row, "column": column,
                                   "box": CHECKER.box_dict(cell), "parts": [{"id": p["debug_id"], "sourceBox": deepcopy(p["box"])}]})
            target = final["page"][0]["pdf_paragraph"][row * 4 + column]
            target["box"] = CHECKER.box_dict(cell)
    # Full target sequence spans two lines inside the first physical cell;
    # the frozen source ink rectangle was only ten points high.
    identity, target_text = 1, "ABCDEFGHIJ"
    for doc in (translated, final):
        p = doc["page"][0]["pdf_paragraph"][identity]
        p["unicode"] = target_text
        values = [glyph(char, ord(char), (48 + (i % 5) * 5, 161 - (i // 5) * 12,
                                             53 + (i % 5) * 5, 171 - (i // 5) * 12))
                  for i, char in enumerate(target_text)]
        p["pdf_paragraph_composition"] = [{"pdf_same_style_characters": {"pdf_character": values}}]
    return source, translated, final, [entry]


class TableAllocationTests(unittest.TestCase):
    def check(self, fixture):
        source, translated, final, adjustments = fixture
        return CHECKER.check_layout(source, translated, final, geometry_adjustments=adjustments)[0]

    def test_two_line_target_uses_verified_cell_without_changing_source_ink(self):
        fixture = table_fixture()
        before = deepcopy(fixture[0])
        report = self.check(fixture)
        self.assertTrue(report["passed"], report["issues"])
        self.assertEqual(report["tableAllocations"]["verifiedParts"], 12)
        self.assertEqual(fixture[0], before)
        self.assertEqual(report["paragraphs"][1]["renderedCharacters"], 10)

    def test_metadata_without_source_physical_evidence_cannot_authorize_expansion(self):
        for fault in ("confidence", "rules", "markers", "columns"):
            fixture = table_fixture()
            page, entry = fixture[0]["page"][0], fixture[3][0]
            if fault == "confidence":
                page["page_layout"][0]["conf"] = 0.1
            elif fault == "rules":
                page["pdf_curve"] = []
            elif fault == "markers":
                page["pdf_paragraph"][4]["pdf_paragraph_composition"][0]["pdf_same_style_characters"]["pdf_character"][1]["char_unicode"] = "9"
            else:
                entry["columns"][1] += 10
            with self.subTest(fault=fault):
                report = self.check(fixture)
                self.assertFalse(report["passed"])
                self.assertTrue(any(i["code"] == "invalid_table_allocation" for i in report["issues"]))

    def test_unknown_duplicate_cross_page_and_oversized_allocations_fail(self):
        for fault in ("unknown", "duplicate", "page", "part", "cell", "source", "missing", "unknown_field"):
            fixture = table_fixture()
            entry = fixture[3][0]
            cell = entry["cells"][0]
            if fault == "unknown":
                entry["reason"] = "trust me"
            elif fault == "duplicate":
                fixture[3].append(deepcopy(entry))
            elif fault == "page":
                entry["page"] = 2
            elif fault == "part":
                cell["parts"][0]["id"] = "unrelated"
            elif fault == "cell":
                cell["box"]["x2"] = 190
            elif fault == "source":
                cell["parts"][0]["sourceBox"]["y"] -= 20
            elif fault == "missing":
                cell["parts"] = []
            else:
                entry["permission"] = "skip bounds"
            with self.subTest(fault=fault):
                report = self.check(fixture)
                self.assertFalse(report["passed"])
                self.assertTrue(any(i["code"] == "invalid_table_allocation" for i in report["issues"]))

    def test_target_cannot_leave_cell_or_inherit_expansion_without_metadata(self):
        fixture = table_fixture()
        fixture[2]["page"][0]["pdf_paragraph"][1]["box"]["x2"] += 1
        self.assertFalse(self.check(fixture)["passed"])
        fixture = table_fixture()
        fixture[3].clear()
        report = self.check(fixture)
        self.assertFalse(report["passed"])
        self.assertTrue(any(i["code"] == "paragraph_box_changed" for i in report["issues"]))

    def test_source_region_forgery_is_not_proof_of_available_cell_space(self):
        source, translated, final, adjustments = table_fixture()
        for p in source["page"][0]["pdf_paragraph"]:
            if p["debug_id"].endswith("c1"):
                p["box"]["x"] += 4
                p["box"]["x2"] += 4
        adjustments[0]["columns"][1] += 4
        issues = []
        self.assertFalse(CHECKER.verified_table_allocations(source, final, adjustments, lambda *a, **k: issues.append(a)))
        self.assertIn("frozen glyphs", issues[0][1])

    def test_valid_allocation_still_requires_full_text_and_at_least_85_percent(self):
        for fault in ("text", "scale"):
            fixture = table_fixture()
            p = fixture[2]["page"][0]["pdf_paragraph"][1]
            if fault == "text":
                p["pdf_paragraph_composition"][0]["pdf_same_style_characters"]["pdf_character"].pop()
            else:
                p["scale"] = 0.8
            with self.subTest(fault=fault):
                report = self.check(fixture)
                self.assertFalse(report["passed"])
                self.assertTrue(any(i["code"] == ("rendered_text_mismatch" if fault == "text" else "excessive_font_shrink") for i in report["issues"]))

    def test_preserved_graphic_and_foreign_paragraph_block_cell_space(self):
        for fault in ("graphic", "visual", "formula_graphic", "paragraph"):
            fixture = table_fixture()
            page = fixture[0]["page"][0]
            if fault == "graphic":
                page["pdf_rectangle"] = [{"box": CHECKER.box_dict((50, 145, 80, 165))}]
            elif fault == "visual":
                page["pdf_character"] = [{"box": CHECKER.box_dict((5, 5, 10, 15)),
                                           "visual_bbox": {"box": CHECKER.box_dict((50, 145, 80, 165))}}]
            elif fault == "formula_graphic":
                page["pdf_paragraph"][1]["pdf_paragraph_composition"].append({"pdf_formula": {
                    "pdf_character": [], "pdf_curve": [{"box": CHECKER.box_dict((50, 145, 80, 165))}]}})
            else:
                page["pdf_paragraph"].append(paragraph("stationary", [glyph("Z", 90, (50, 145, 55, 155))], box=(50, 145, 55, 155)))
            with self.subTest(fault=fault):
                report = self.check(fixture)
                self.assertFalse(report["passed"])
                self.assertTrue(any(i["code"] == "invalid_table_allocation" for i in report["issues"]))

    def test_multiple_source_lines_get_disjoint_target_subregions(self):
        source, translated, final, adjustments = table_fixture()
        extra = paragraph("extra-line", [glyph("Y", 89, (55, 145, 75, 155))], box=(55, 145, 75, 155))
        extra.update(layout_label="fallback_line", pdf_style={"font_id": "F1", "font_size": 10}, unicode="Y")
        source["page"][0]["pdf_paragraph"].append(extra)
        final["page"][0]["pdf_paragraph"].append(deepcopy(extra))
        entry = adjustments[0]
        entry["rows"][0]["sourceBounds"]["y"] = 145
        entry["rows"][0]["y"] = entry["rows"][1]["y2"] = 135
        for cell in entry["cells"]:
            if cell["row"] == 0:
                cell["box"]["y"] = 135.25
            elif cell["row"] == 1:
                cell["box"]["y2"] = 134.75
            part = next(p for p in final["page"][0]["pdf_paragraph"] if p["debug_id"] == cell["parts"][0]["id"])
            part["box"] = deepcopy(cell["box"])
        first = entry["cells"][0]
        first["parts"].append({"id": "extra-line", "sourceBox": deepcopy(extra["box"])})
        final["page"][0]["pdf_paragraph"][1]["box"]["y"] = 155
        final["page"][0]["pdf_paragraph"][-1]["box"] = CHECKER.box_dict((45.25, 135.25, 84.75, 154.75))
        issues = []
        allowed = CHECKER.verified_table_allocations(source, final, adjustments, lambda *a, **k: issues.append(a))
        self.assertFalse(issues, issues)
        self.assertEqual(len(allowed), 13)
        final["page"][0]["pdf_paragraph"][-1]["box"]["y2"] = 156
        issues = []
        self.assertFalse(CHECKER.verified_table_allocations(source, final, adjustments, lambda *a, **k: issues.append(a)))
        self.assertIn("overlap", issues[0][1])


class SourceCheckTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.input = Path(self.temp.name) / "source.pdf"
        self.output = Path(self.temp.name) / "target.pdf"

    def tearDown(self):
        self.temp.cleanup()

    def check(self, source, *, target=None):
        report = {"issues": [], "limitations": []}
        CHECKER.check_original_pdf(source, report, self.input, Path(sys.executable), [],
                                   final=target, output_pdf=self.output if target is not None else None)
        self.assertTrue(report["sourceExtraction"]["performed"], report["issues"])
        return report

    def test_vertical_glyph_matches_nominal_matrix_box_outside_ink_region(self):
        write_pdf(self.input, draw(".", 40, 50, size=20, vertical=True))
        # Helvetica '.' advances 278/1000 em. The nominal rotated glyph box
        # differs from pdfplumber's descent-shifted x0/x1 and its narrow ink.
        source = document([paragraph("rotated", [glyph(".", 46, (20, 50, 40, 55.56), size=20, vertical=True)],
                                     box=(22, 49, 27, 56))])
        report = self.check(source)
        self.assertTrue(report["sourceExtraction"]["passed"], report["issues"])
        self.assertEqual(report["sourceExtraction"]["sourceGlyphsChecked"], 1)

    def test_spanning_formula_box_does_not_remove_prose_on_another_line(self):
        write_pdf(self.input, draw("A") + draw("B", y=70))
        protected = glyph("A", 65, (20, 50, 26.67, 60))
        ordinary = glyph("B", 66, (20, 70, 26.67, 80))
        source = document([paragraph("reference", [ordinary], formulas=[([protected], (15, 45, 55, 85))])])
        report = self.check(source)
        self.assertTrue(report["sourceExtraction"]["passed"], report["issues"])
        self.assertEqual(report["sourceExtraction"]["protectedSourceGlyphsChecked"], 1)

    def test_overlaid_accent_excludes_only_matching_cid_not_underlying_letter(self):
        write_pdf(self.input, draw("A") + draw("^"))
        ordinary = glyph("A", 65, (20, 50, 26.67, 60))
        accent = glyph("^", 94, (20, 50, 24.69, 60))
        source = document([paragraph("accent", [ordinary], formulas=[([accent], (20, 50, 26.67, 60))])])
        report = self.check(source)
        self.assertTrue(report["sourceExtraction"]["passed"], report["issues"])
        self.assertEqual(report["sourceExtraction"]["sourceGlyphsChecked"], 2)

    def test_missing_prose_glyph_is_not_hidden_by_formula_rectangle(self):
        write_pdf(self.input, draw("A") + draw("B", y=70))
        protected = glyph("A", 65, (20, 50, 26.67, 60))
        source = document([paragraph("missing", [], formulas=[([protected], (15, 45, 55, 85))])])
        report = self.check(source)
        self.assertFalse(report["sourceExtraction"]["passed"])
        self.assertEqual(report["sourceExtraction"]["mismatches"][0]["missingFromIl"], {"B": 1})

    def test_prose_unicode_is_not_replaced_by_cid_match_or_normalized(self):
        write_pdf(self.input, draw("A"))
        source = document([paragraph("wrong-text", [glyph("a", 65, (20, 50, 26.67, 60))])])
        report = self.check(source)
        self.assertFalse(report["sourceExtraction"]["passed"])
        mismatch = report["sourceExtraction"]["mismatches"][0]
        self.assertEqual(mismatch["missingFromIl"], {"A": 1})
        self.assertEqual(mismatch["extraInIl"], {"a": 1})

    def test_an_undecoded_ordinary_cid_is_not_accepted_as_literal_prose(self):
        write_pdf(self.input, draw(r"\000"), font="Custom", font_extra="/FirstChar 0 /LastChar 0 /Widths [667] /FontDescriptor << /Type /FontDescriptor /FontName /Custom /Flags 4 /FontBBox [0 -200 1000 800] /Ascent 800 /Descent -200 >>")
        source = document([paragraph("undefined", [glyph("(cid:0)", 0, (20, 50, 26.67, 60))])])
        source["page"][0]["pdf_font"][0]["name"] = "Custom"
        report = self.check(source)
        self.assertFalse(report["sourceExtraction"]["passed"])
        self.assertTrue(report["sourceExtraction"]["unresolvedGlyphParagraphs"])

    def test_protected_source_cid_font_and_position_faults_fail(self):
        write_pdf(self.input, draw("A"))
        base = document([paragraph("protected", [], formulas=[([glyph("A", 65, (20, 50, 26.67, 60))], (15, 45, 55, 85))])])
        mutations = []
        wrong_cid = deepcopy(base)
        wrong_cid["page"][0]["pdf_paragraph"][0]["pdf_paragraph_composition"][0]["pdf_formula"]["pdf_character"][0]["pdf_character_id"] = 66
        mutations.append(wrong_cid)
        wrong_font = deepcopy(base)
        wrong_font["page"][0]["pdf_font"][0]["name"] = "Times-Roman"
        mutations.append(wrong_font)
        wrong_position = deepcopy(base)
        wrong_position["page"][0]["pdf_paragraph"][0]["pdf_paragraph_composition"][0]["pdf_formula"]["pdf_character"][0]["box"]["x"] += 1
        mutations.append(wrong_position)
        for source in mutations:
            with self.subTest(source=source):
                report = self.check(source)
                self.assertFalse(report["sourceExtraction"]["passed"])
                self.assertTrue(report["sourceExtraction"]["glyphMismatches"])

    def test_preserved_output_may_move_and_use_tight_ink_box(self):
        write_pdf(self.input, draw("A"))
        write_pdf(self.output, draw("A", 70, 90))
        source = document([paragraph("flow", [glyph("A", 65, (20, 50, 26.67, 60))])])
        # Latin glyph ink bounds are narrower than the actual em-sized PDF
        # drawing. Match its final origin + Tf, allowing legitimate relocation.
        target = document([paragraph("flow", [glyph("A", 65, (70, 90, 76, 96))])])
        report = self.check(source, target=target)
        self.assertTrue(report["sourceExtraction"]["passed"], report["issues"])
        self.assertEqual(report["sourceExtraction"]["outputOriginalGlyphsChecked"], 1)

    def test_output_cid_font_and_origin_mutations_cannot_pass(self):
        write_pdf(self.input, draw("A"))
        source = document([paragraph("flow", [glyph("A", 65, (20, 50, 26.67, 60))])])
        target = document([paragraph("flow", [glyph("A", 65, (70, 90, 76, 96))])])
        for stream, font in [(draw("B", 70, 90), "Helvetica"),
                             (draw("A", 71, 90), "Helvetica"),
                             (draw("A", 70, 90), "Times-Roman"),
                             (draw("A", 70, 90, size=9), "Helvetica")]:
            with self.subTest(stream=stream, font=font):
                write_pdf(self.output, stream, font=font)
                report = self.check(source, target=target)
                self.assertFalse(report["sourceExtraction"]["passed"])
                self.assertEqual(report["sourceExtraction"]["glyphMismatches"][0]["stage"], "output")

    def test_uncaptured_drawing_label_must_survive_at_original_pdf_operands(self):
        write_pdf(self.input, draw("A") + draw("B", 110, 140))
        source = document([paragraph("flow", [glyph("A", 65, (20, 50, 26.67, 60))])])
        target = document([paragraph("flow", [glyph("A", 65, (70, 90, 76, 96))])])
        write_pdf(self.output, draw("A", 70, 90) + draw("B", 110, 140))
        report = self.check(source, target=target)
        self.assertTrue(report["sourceExtraction"]["passed"], report["issues"])
        self.assertEqual(report["sourceExtraction"]["uncapturedSourceGlyphs"], 1)
        self.assertEqual(report["sourceExtraction"]["uncapturedPreservedOutputGlyphsChecked"], 1)
        # A lost label outside all paragraph boxes must fail, not disappear
        # behind the scope of the prose-only counter check.
        write_pdf(self.output, draw("A", 70, 90))
        report = self.check(source, target=target)
        self.assertFalse(report["sourceExtraction"]["passed"])
        self.assertEqual(report["sourceExtraction"]["glyphMismatches"][0]["debugId"], "__uncaptured_pdf_operations__")


if __name__ == "__main__":
    unittest.main()
