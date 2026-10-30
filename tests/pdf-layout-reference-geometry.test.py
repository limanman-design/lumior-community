"""Reference regrouping preserves source glyphs and rejects ambiguous evidence."""

from copy import deepcopy
from dataclasses import asdict
from pathlib import Path
import sys
from types import SimpleNamespace
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))
import pdf_layout_geometry as GEOMETRY
from babeldoc.format.pdf.document_il.il_version_1 import (
    Box, Cropbox, Document, Page, PageLayout, PdfCharacter, PdfFormula, PdfParagraph,
    PdfParagraphComposition, PdfSameStyleCharacters, PdfSameStyleUnicodeCharacters, PdfStyle, VisualBbox,
)


def chars(text, x=25, y=100, *, font="F1", size=9):
    result = []
    for char in text:
        result.append(PdfCharacter(char_unicode=char, pdf_character_id=None if char == " " else ord(char),
                                   pdf_style=PdfStyle(font_id=font, font_size=size),
                                   box=Box(x=x, y=y, x2=x + 4, y2=y + size),
                                   visual_bbox=VisualBbox(box=Box(x=x, y=y - 1, x2=x + 4, y2=y + 7)),
                                   advance=4, vertical=False, xobj_id=0))
        x += 4
    return result


def formula(values):
    return PdfParagraphComposition(pdf_formula=PdfFormula(
        pdf_character=values, box=Box(x=min(c.box.x for c in values), y=min(c.box.y for c in values),
                                    x2=max(c.box.x2 for c in values), y2=max(c.box.y2 for c in values)),
        x_offset=0, y_offset=0, x_advance=0))


def plain(values):
    return PdfParagraphComposition(pdf_same_style_characters=PdfSameStyleCharacters(
        pdf_character=values, pdf_style=deepcopy(values[0].pdf_style),
        box=Box(x=min(c.box.x for c in values), y=min(c.box.y for c in values),
                x2=max(c.box.x2 for c in values), y2=max(c.box.y2 for c in values))))


def reference(number=1, top=100):
    # The detector emits the letters/digits in a formula and all interleaved
    # commas/dashes/brackets as separate prose. They share the same baseline.
    metadata = chars("Phys. Rev. B 40, 546–570 (1989). ", x=35, y=top - 20, font="Italic")
    protected = [char for char in metadata if char.char_unicode.isalnum() or char.char_unicode in " ."]
    punctuation = [char for char in metadata if char not in protected]
    return [formula(chars(f"[{number}] ", x=20, y=top)),
            plain(chars("Fisher. Boson transition. ", x=36, y=top)),
            formula(protected), plain(punctuation)]


def document(compositions=None):
    compositions = compositions if compositions is not None else reference() + reference(2, 50)
    return Document(page=[Page(page_number=6, pdf_paragraph=[PdfParagraph(
        debug_id="refs", box=Box(x=20, y=10, x2=240, y2=110),
        pdf_style=PdfStyle(font_id="F1", font_size=9), first_line_indent=False,
        pdf_paragraph_composition=compositions, layout_label="plain text", xobj_id=0)])])


def author_diacritic(base="a"):
    """Actual Greiner TeX glyph metrics, rather than a combined-Unicode mock."""
    size, y = 8.9664, 206.924
    base_x = 439.97831296 if base == "a" else 416.35543552
    base_width = 4.60783296 if base == "a" else 5.1198144
    accent_x = base_x + (0.00089664 if base == "a" else 0.25195584)
    h = chars("H", x=base_x - 6.91040448, y=y, size=size)[0]
    h.pdf_style.font_id = "F33"
    h.box.x2 = base_x
    h.advance = 6.91040448
    accent = chars("¨", x=accent_x, y=y, font="F33", size=size)[0]
    accent.pdf_character_id = 127
    accent.box.x2 = accent_x + 4.60783296
    accent.advance = 4.60783296
    accent.visual_bbox.box = Box(x=accent_x + 0.9504384, y=y + 5.0929152,
                                x2=accent_x + 3.6493248, y2=y + 6.007488)
    tail = chars(base + "nsch", x=base_x, y=y, font="F33", size=size)
    tail[0].box.x2 = base_x + base_width
    tail[0].advance = base_width
    tail[0].visual_bbox.box = Box(x=base_x + 0.3, y=y - 0.0986304,
                                x2=base_x + base_width - 0.1, y2=y + 4.0169472)
    doc = document([plain([h]), formula([accent]), plain(tail)])
    para = doc.page[0].pdf_paragraph[0]
    para.debug_id = "authors:reference-continuation"
    para.pdf_style = PdfStyle(font_id="F33", font_size=size)
    para.box = Box(x=h.box.x, y=y - 0.1, x2=base_x + 100, y2=y + size)
    return doc


def sidebar_document():
    """The failing 21-page PDF's four small-print date-row allocations."""
    size = 6.9738
    rows = []
    for index, label in enumerate(("Received", "Revised", "Accepted", "Published")):
        values = chars(label + ": 3 January 2025", x=35.716,
                       y=291.458 - index * 11.925, size=size)
        # Match the original row's finite em/ink heights and narrow column.
        for offset, char in enumerate(values):
            char.box.x = 35.716 + offset * 2.5
            char.box.x2 = char.box.x + 2.5
            char.advance = 2.5
            char.visual_bbox.box = Box(x=char.box.x, x2=char.box.x2,
                                      y=char.box.y - 1.9735854,
                                      y2=char.box.y + 5.0629788)
        rows.extend(values)
    parent = PdfParagraph(debug_id="dates", layout_label="plain text",
                          pdf_style=PdfStyle(font_id="F1", font_size=size),
                          box=Box(x=35.548607, y=253.7084146,
                                  x2=105.7120306, y2=298.4318),
                          pdf_paragraph_composition=[plain(rows)], xobj_id=0)
    above = PdfParagraph(debug_id="above", layout_label="plain text",
                         pdf_style=deepcopy(parent.pdf_style),
                         box=Box(x=35.820607, y=305.3944146,
                                 x2=150.1769794, y2=338.1928))
    below = PdfParagraph(debug_id="below", layout_label="plain text",
                         pdf_style=deepcopy(parent.pdf_style),
                         box=Box(x=35.7996856, y=165.253,
                                 x2=151.927019641, y2=247.7791884))
    body = PdfParagraph(debug_id="body", layout_label="plain text",
                        pdf_style=PdfStyle(font_id="F2", font_size=9.9626),
                        box=Box(x=166.6032146, y=254, x2=558.874343, y2=331))
    return Document(page=[Page(page_number=0, pdf_paragraph=[above, parent, below, body])])


def numbered_table_document():
    paragraphs = []
    for row, number in enumerate(range(84, 89)):
        y = 350 - row * 50
        paragraphs.append(PdfParagraph(debug_id=f"marker-{row}", layout_label="fallback_line",
                                       box=Box(x=20, y=y, x2=36, y2=y + 9),
                                       pdf_paragraph_composition=[formula(chars(f"[{number}]", x=20, y=y))]))
        for column, x in enumerate((70, 120, 170), start=1):
            values = chars("text", x=x, y=y)
            paragraphs.append(PdfParagraph(debug_id=f"cell-{row}-{column}", layout_label="fallback_line",
                                           pdf_style=PdfStyle(font_id="F1", font_size=9),
                                           box=Box(x=x, y=y, x2=x + 16, y2=y + 9),
                                           pdf_paragraph_composition=[plain(values)]))
    page = Page(page_number=14, pdf_paragraph=paragraphs,
                page_layout=[PageLayout(id=3, class_name="table", conf=0.98,
                                        box=Box(x=10, y=100, x2=229, y2=400))])
    page.pdf_curve = [SimpleNamespace(box=Box(x=10, y=390, x2=229, y2=390)),
                      SimpleNamespace(box=Box(x=10, y=100, x2=229, y2=100))]
    return Document(page=[page])


class ReferenceGeometryTests(unittest.TestCase):
    def test_numbered_table_cell_proof_keeps_source_geometry_and_records_complete_members(self):
        doc = numbered_table_document()
        page = doc.page[0]
        before = asdict(doc)
        source = {id(p): GEOMETRY.source_paragraph_box(p) for p in page.pdf_paragraph}
        plans = GEOMETRY.prepare_table_cell_allocations(page, source)
        self.assertEqual(asdict(doc), before)
        self.assertEqual(len(plans), 1)
        plan = plans[0]
        self.assertEqual((plan["topRule"], plan["bottomRule"]), (390, 100))
        self.assertEqual(plan["columns"], [28, 78, 128, 178])
        self.assertEqual([anchor["number"] for anchor in plan["rowAnchors"]], list(range(84, 89)))
        self.assertEqual(len(plan["cells"]), 15)
        self.assertEqual({part["id"] for cell in plan["cells"] for part in cell["parts"]},
                         {p.debug_id for p in page.pdf_paragraph if not p.debug_id.startswith("marker")})
        for cell in plan["cells"]:
            self.assertGreater(cell["box"]["y2"] - cell["box"]["y"], 9)
            self.assertTrue(all(part["sourceBox"] == asdict(source[id(next(p for p in page.pdf_paragraph
                                                                          if p.debug_id == part["id"]))])
                                for part in cell["parts"]))

    def test_table_cell_proof_rejects_ambiguous_numbering_and_graphic_intrusion(self):
        for defect in ("numbering", "missing_rule", "low_confidence"):
            doc = numbered_table_document()
            page = doc.page[0]
            if defect == "numbering":
                page.pdf_paragraph[4].pdf_paragraph_composition = [formula(chars("[84]", x=20, y=300))]
            elif defect == "missing_rule":
                page.pdf_curve = page.pdf_curve[:1]
            else:
                page.page_layout[0].conf = 0.7
            with self.subTest(defect=defect):
                self.assertEqual(GEOMETRY.prepare_table_cell_allocations(
                    page, {id(p): GEOMETRY.source_paragraph_box(p) for p in page.pdf_paragraph}), [])
        doc = numbered_table_document()
        page = doc.page[0]
        page.pdf_form = [SimpleNamespace(box=Box(x=70, y=349, x2=85, y2=360))]
        plans = GEOMETRY.prepare_table_cell_allocations(
            page, {id(p): GEOMETRY.source_paragraph_box(p) for p in page.pdf_paragraph})
        self.assertEqual(len(plans[0]["cells"]), 14)
        self.assertNotIn("cell-0-1", {part["id"] for cell in plans[0]["cells"] for part in cell["parts"]})

    def test_complete_targets_flow_to_multiple_lines_inside_one_cell_without_changing_source_boxes(self):
        from babeldoc.format.pdf.document_il.midend.typesetting import Typesetting

        class TestTypesetting(Typesetting):
            pass

        font = SimpleNamespace(font_id="fallback", has_glyph=lambda code: code,
                               char_lengths=lambda text, size: [size])
        targets = ("甲乙丙丁戊己庚辛壬癸甲乙", "第一项")
        parts = [PdfParagraph(debug_id=f"part-{i}", layout_label="fallback_line", xobj_id=0,
                              pdf_style=PdfStyle(font_id="F1", font_size=9),
                              box=Box(x=30, y=100 - i * 11, x2=70, y2=109 - i * 11),
                              pdf_paragraph_composition=[PdfParagraphComposition(
                                  pdf_same_style_unicode_characters=PdfSameStyleUnicodeCharacters(
                                      unicode=text, pdf_style=PdfStyle(font_id="F1", font_size=9)))])
                 for i, text in enumerate(targets)]
        page = Page(page_number=14, pdf_paragraph=parts,
                    pdf_font=[SimpleNamespace(font_id="F1")])
        cell = {"id": "cell", "box": {"x": 20, "y": 80, "x2": 80, "y2": 125},
                "parts": [{"id": p.debug_id, "sourceBox": asdict(p.box)} for p in parts]}
        boxes = {(14, p.debug_id): deepcopy(p.box) for p in parts}
        boxes.update({(14, p.debug_id, "table-cell"): cell for p in parts})
        source = {key: deepcopy(value) for key, value in boxes.items() if len(key) == 2}
        engine = object.__new__(TestTypesetting)
        engine.font_mapper = SimpleNamespace(base_font=font, map=lambda old, char: font, fontid2font={})
        GEOMETRY.install_typesetting_policy(TestTypesetting, {}, boxes)
        engine.plan_table_cells(Document(page=[page]))
        self.assertEqual({key: boxes[key] for key in source}, source)
        for p, target in zip(parts, targets):
            engine.render_paragraph(p, page, {"F1": SimpleNamespace(font_id="F1")})
            self.assertEqual(GEOMETRY._source_text(p.pdf_paragraph_composition), target)
            self.assertGreaterEqual(p.scale, 0.85)
            self.assertGreaterEqual(p.box.y, 80)
            self.assertLessEqual(p.box.y2, 125)
        self.assertEqual(len({round(char.box.y, 5) for char in GEOMETRY.characters(parts[0].pdf_paragraph_composition)}), 2)
        self.assertGreaterEqual(parts[0].box.y - parts[1].box.y2, 0.5)

    def test_table_cells_preserve_formula_graphics_even_when_only_visual_bounds_intrude(self):
        for kind in ("pdf_curve", "pdf_form"):
            with self.subTest(kind=kind):
                page = numbered_table_document().page[0]
                source = page.pdf_paragraph[1]
                graphic = SimpleNamespace(box=Box(x=230, y=420, x2=240, y2=430),
                                          visual_bbox=VisualBbox(box=Box(x=70, y=349, x2=85, y2=360)))
                protected = formula(chars("x", x=74, y=350)).pdf_formula
                setattr(protected, kind, [graphic])
                source.pdf_paragraph_composition.append(PdfParagraphComposition(pdf_formula=protected))
                plans = GEOMETRY.prepare_table_cell_allocations(
                    page, {id(p): GEOMETRY.source_paragraph_box(p) for p in page.pdf_paragraph})
                self.assertEqual(len(plans[0]["cells"]), 14)
                self.assertNotIn("cell-0-1", {part["id"] for cell in plans[0]["cells"] for part in cell["parts"]})
                self.assertIn(graphic.visual_bbox.box,
                              GEOMETRY.page_obstacle_boxes(page, source, include_paragraphs=False))

    def test_unbreakable_latin_word_fits_its_exact_width_without_double_counting_first_glyph(self):
        from babeldoc.format.pdf.document_il.midend.typesetting import Typesetting

        class TestTypesetting(Typesetting):
            pass

        para = PdfParagraph(debug_id="word", layout_label="plain text", xobj_id=0,
                            pdf_style=PdfStyle(font_id="F1", font_size=10),
                            box=Box(x=20, y=100, x2=50, y2=110))
        para.pdf_paragraph_composition = [PdfParagraphComposition(
            pdf_same_style_unicode_characters=PdfSameStyleUnicodeCharacters(
                unicode="abcdef", pdf_style=deepcopy(para.pdf_style)))]
        font = SimpleNamespace(font_id="fallback", has_glyph=lambda code: code,
                               char_lengths=lambda text, size: [size * 0.5])
        engine = object.__new__(TestTypesetting)
        engine.font_mapper = SimpleNamespace(base_font=font, map=lambda old, char: font)
        GEOMETRY.install_typesetting_policy(TestTypesetting, {}, {(0, "word"): deepcopy(para.box)})
        units = engine.create_typesetting_units(para, {"F1": SimpleNamespace(font_id="F1")})
        scale, _ = engine._find_optimal_scale_and_layout(para, Page(page_number=0), units, apply_layout=True)
        self.assertEqual(scale, 1)
        self.assertEqual(GEOMETRY._source_text(para.pdf_paragraph_composition), "abcdef")
        self.assertAlmostEqual(list(GEOMETRY.characters(para.pdf_paragraph_composition))[-1].box.x2, 50)

    def test_table_header_fallback_font_uses_only_proven_empty_space(self):
        from babeldoc.format.pdf.document_il.midend.typesetting import Typesetting

        class TestTypesetting(Typesetting):
            pass

        size = 9.9626
        para = PdfParagraph(debug_id="unit", layout_label="fallback_line", xobj_id=0,
                            pdf_style=PdfStyle(font_id="F1", font_size=size),
                            box=Box(x=437.1073544, y=442.5258896,
                                    x2=471.9764544, y2=453.5246))
        left = PdfParagraph(debug_id="left", box=Box(x=370.4473544, y=449.3706358,
                                                     x2=420.5393072, y2=459.5026))
        right = PdfParagraph(debug_id="protected", box=Box(x=472.3649958, y=442.316675,
                                                           x2=477.3462958, y2=453.5246))
        page = Page(page_number=9, pdf_paragraph=[para, left, right], page_layout=[PageLayout(
            class_name="table", conf=0.9825, box=Box(x=34, y=137, x2=560, y2=464))])
        doc = Document(page=[page])
        skips, boxes, _ = GEOMETRY.prepare_source(doc)
        self.assertAlmostEqual(para.box.x, (left.box.x2 + 437.1073544) * 0.5 + 0.25)
        self.assertAlmostEqual(para.box.x2, 471.9764544)
        intended = "AB(xyz"
        para.pdf_paragraph_composition = [PdfParagraphComposition(
            pdf_same_style_unicode_characters=PdfSameStyleUnicodeCharacters(
                unicode=intended, pdf_style=deepcopy(para.pdf_style)))]
        font = SimpleNamespace(font_id="fallback", has_glyph=lambda code: code,
                               char_lengths=lambda text, size: [size * 0.7])
        engine = object.__new__(TestTypesetting)
        engine.font_mapper = SimpleNamespace(base_font=font, map=lambda old, char: font)
        GEOMETRY.install_typesetting_policy(TestTypesetting, skips, boxes)
        units = engine.create_typesetting_units(para, {"F1": SimpleNamespace(font_id="F1")})
        scale, _ = engine._find_optimal_scale_and_layout(para, page, units, apply_layout=True)
        self.assertGreaterEqual(scale, 0.85)
        self.assertEqual(GEOMETRY._source_text(para.pdf_paragraph_composition), intended)
        emitted = list(GEOMETRY.characters(para.pdf_paragraph_composition))
        self.assertGreater(min(char.box.x for char in emitted), left.box.x2)
        self.assertLess(max(char.box.x2 for char in emitted), right.box.x)

    def test_table_line_allocation_requires_unique_table_and_preserves_rules(self):
        para = PdfParagraph(debug_id="unit", layout_label="fallback_line",
                            pdf_style=PdfStyle(font_id="F1", font_size=10),
                            box=Box(x=100, y=200, x2=130, y2=210))
        table = PageLayout(class_name="table", conf=0.98, box=Box(x=80, y=150, x2=200, y2=250))
        page = Page(page_number=9, pdf_paragraph=[para], page_layout=[table])
        page.pdf_curve = [SimpleNamespace(box=Box(x=92, y=190, x2=92, y2=220)),
                          SimpleNamespace(box=Box(x=142, y=190, x2=142, y2=220))]
        allocation = GEOMETRY.table_line_allocation(page, para)
        self.assertEqual((allocation.x, allocation.x2), (92.5, 141.5))
        self.assertEqual((allocation.y, allocation.y2), (200, 210))
        for defect in ("missing_table", "duplicate_table", "low_confidence", "body", "multiline", "crossing_graphic"):
            changed, changed_page = deepcopy(para), deepcopy(page)
            changed_page.pdf_paragraph = [changed]
            if defect == "missing_table":
                changed_page.page_layout = []
            elif defect == "duplicate_table":
                changed_page.page_layout.append(deepcopy(table))
            elif defect == "low_confidence":
                changed_page.page_layout[0].conf = 0.7
            elif defect == "body":
                changed.layout_label = "plain text"
            elif defect == "multiline":
                changed.box.y2 = 230
            else:
                changed_page.pdf_form = [SimpleNamespace(box=Box(x=115, y=190, x2=120, y2=220))]
            with self.subTest(defect=defect):
                self.assertIsNone(GEOMETRY.table_line_allocation(changed_page, changed))

    def test_neighbouring_table_cells_share_source_gap_without_order_dependence(self):
        left = PdfParagraph(debug_id="left", layout_label="fallback_line",
                            pdf_style=PdfStyle(font_id="F1", font_size=10),
                            box=Box(x=100, y=200, x2=130, y2=210))
        right = PdfParagraph(debug_id="right", layout_label="fallback_line",
                             pdf_style=PdfStyle(font_id="F1", font_size=10),
                             box=Box(x=160, y=200, x2=180, y2=210))
        page = Page(page_number=9, pdf_paragraph=[left, right], page_layout=[PageLayout(
            class_name="table", conf=0.98, box=Box(x=80, y=150, x2=200, y2=250))])
        source = {id(p): deepcopy(p.box) for p in page.pdf_paragraph}
        left.box = GEOMETRY.table_line_allocation(page, left, source)
        right.box = GEOMETRY.table_line_allocation(page, right, source)
        self.assertEqual(left.box.x2, 144.75)
        self.assertEqual(right.box.x, 145.25)
        self.assertEqual(right.box.x - left.box.x2, 0.5)

    def test_distinct_table_baselines_do_not_treat_source_italic_em_overlap_as_one_row(self):
        para = PdfParagraph(debug_id="below", layout_label="fallback_line",
                            pdf_style=PdfStyle(font_id="F1", font_size=8.9664),
                            box=Box(x=438.082816, y=547.1574944, x2=455.343136, y2=557.0564))
        above = PdfParagraph(debug_id="above", layout_label="fallback_line",
                             pdf_style=deepcopy(para.pdf_style),
                             box=Box(x=405.631392, y=556.6639376, x2=491.96684, y2=568.0154))
        page = Page(page_number=14, pdf_paragraph=[above, para], page_layout=[PageLayout(
            class_name="table", conf=0.98, box=Box(x=34, y=262, x2=561, y2=573))])
        allocation = GEOMETRY.table_line_allocation(page, para)
        self.assertIsNotNone(allocation)
        self.assertLess(allocation.x, para.box.x)
        self.assertGreater(allocation.x2, para.box.x2)
        self.assertEqual((allocation.y, allocation.y2), (para.box.y, para.box.y2))
        page.pdf_form = [SimpleNamespace(box=deepcopy(above.box))]
        self.assertIsNone(GEOMETRY.table_line_allocation(page, para), "Protected graphics remain obstacles across rows.")
        page.pdf_form = []
        above.box.y -= 4
        self.assertIsNone(GEOMETRY.table_line_allocation(page, para), "Substantial source overlap remains ambiguous.")

    def test_running_page_counter_keeps_complete_translation_and_right_anchor(self):
        from babeldoc.format.pdf.document_il.midend.typesetting import Typesetting

        class TestTypesetting(Typesetting):
            pass

        size = 7.9701
        source = plain(chars("2 of 21", x=536.8555216, y=797.979598, size=size))
        para = PdfParagraph(debug_id="counter", layout_label="abandon", unicode="2 of 21",
                            pdf_style=PdfStyle(font_id="F1", font_size=size),
                            xobj_id=0,
                            box=Box(x=536.8555216, y=797.979598,
                                    x2=564.8555216, y2=805.949698),
                            pdf_paragraph_composition=[source])
        page = Page(page_number=1, cropbox=Cropbox(box=Box(x=0, y=0, x2=595.276, y2=841.89)),
                    pdf_paragraph=[para])
        doc = Document(page=[page])
        proof = GEOMETRY._glyph_proof(para.pdf_paragraph_composition)
        skips, boxes, _ = GEOMETRY.prepare_source(doc)
        self.assertEqual(proof, GEOMETRY._glyph_proof(para.pdf_paragraph_composition))
        self.assertLess(para.box.x, 500)
        self.assertEqual(boxes[(1, "counter", "right-anchor")], 564.8555216)
        intended = "第 2 页，共 21 页"
        para.pdf_paragraph_composition = [PdfParagraphComposition(
            pdf_same_style_unicode_characters=PdfSameStyleUnicodeCharacters(
                unicode=intended, pdf_style=deepcopy(para.pdf_style)))]
        font = SimpleNamespace(font_id="fallback", has_glyph=lambda code: code,
                               char_lengths=lambda text, size: [size * (0.25 if text.isspace()
                                                                          else 0.55 if text.isdigit() else 1)])
        engine = object.__new__(TestTypesetting)
        engine.font_mapper = SimpleNamespace(base_font=font, map=lambda old, char: font)
        GEOMETRY.install_typesetting_policy(TestTypesetting, skips, boxes)
        units = engine.create_typesetting_units(para, {"F1": SimpleNamespace(font_id="F1")})
        scale, _ = engine._find_optimal_scale_and_layout(para, page, units, apply_layout=True)
        self.assertGreaterEqual(scale, 0.85)
        self.assertEqual(GEOMETRY._source_text(para.pdf_paragraph_composition), intended)
        emitted = list(GEOMETRY.characters(para.pdf_paragraph_composition))
        self.assertAlmostEqual(emitted[-1].box.x2, 564.8555216)
        self.assertEqual(len({round(char.box.y, 4) for char in emitted}), 1)

    def test_counter_allocation_does_not_expand_body_text_or_overlap_header_graphics(self):
        size = 7.9701
        para = PdfParagraph(debug_id="counter", layout_label="abandon", unicode="2 of 21",
                            pdf_style=PdfStyle(font_id="F1", font_size=size),
                            box=Box(x=536.8555216, y=797.979598,
                                    x2=559.0203697, y2=806.1091))
        page = Page(page_number=1, cropbox=Cropbox(box=Box(x=0, y=0, x2=595.276, y2=841.89)),
                    pdf_paragraph=[para])
        page.pdf_form = [SimpleNamespace(box=Box(x=475, y=799, x2=500, y2=810))]
        allocation = GEOMETRY.page_counter_allocation(page, para)
        self.assertAlmostEqual(allocation.x, 500 + size * 0.5)
        page.pdf_form[0].box.x2 = 540
        self.assertIsNone(GEOMETRY.page_counter_allocation(page, para))
        page.pdf_form = []
        for defect in ("body", "ordinary_prose", "not_right_edge", "missing_frame"):
            changed, changed_page = deepcopy(para), deepcopy(page)
            changed_page.pdf_paragraph = [changed]
            if defect == "body":
                changed.box.y, changed.box.y2 = 400, 410
            elif defect == "ordinary_prose":
                changed.unicode = "2 of these 21 samples"
            elif defect == "not_right_edge":
                changed.box.x, changed.box.x2 = 200, 225
            else:
                changed_page.cropbox = None
            with self.subTest(defect=defect):
                self.assertIsNone(GEOMETRY.page_counter_allocation(changed_page, changed))

    def test_nested_form_uses_its_unique_source_clipping_bbox_as_obstacle(self):
        size = 7.9701
        para = PdfParagraph(debug_id="counter", layout_label="abandon", unicode="9 of 21",
                            pdf_style=PdfStyle(font_id="F1", font_size=size),
                            box=Box(x=536.887402, y=797.979598,
                                    x2=559.0203697, y2=806.1091))
        page = Page(page_number=8, cropbox=Cropbox(box=Box(x=0, y=0, x2=595.276, y2=841.89)),
                    pdf_paragraph=[para])
        source_clip = Box(x=166.394, y=568.548, x2=434.389, y2=731.999)
        page.pdf_xobject = [SimpleNamespace(xref_id=109, box=source_clip)]
        form = SimpleNamespace(box=Box(x=166.394, y=568.548, x2=598.812, y2=1200.488),
                               form_type="form", pdf_form_subtype=SimpleNamespace(
                                   pdf_xobj_form=SimpleNamespace(xref_id=109)))
        page.pdf_form = [form]
        before = deepcopy(form.box)
        allocation = GEOMETRY.page_counter_allocation(page, para)
        self.assertIsNotNone(allocation)
        self.assertLess(allocation.x, 500)
        self.assertEqual(form.box, before, "Obstacle measurement must not mutate protected Form geometry.")
        # Duplicate or missing XObject evidence must keep the conservative raw
        # form bounds rather than guessing which source clipping box applies.
        page.pdf_xobject.append(SimpleNamespace(xref_id=109, box=deepcopy(source_clip)))
        self.assertIsNone(GEOMETRY.page_counter_allocation(page, para))
        page.pdf_xobject = []
        self.assertIsNone(GEOMETRY.page_counter_allocation(page, para))
        # A real Form clipping rectangle in the header continues to block it.
        page.pdf_xobject = [SimpleNamespace(xref_id=109, box=Box(x=520, y=799, x2=540, y2=820))]
        self.assertIsNone(GEOMETRY.page_counter_allocation(page, para))

    def test_date_rows_use_proven_sidebar_width_and_keep_all_source_glyphs(self):
        doc = sidebar_document()
        parent = doc.page[0].pdf_paragraph[1]
        proof = GEOMETRY._glyph_proof(parent.pdf_paragraph_composition)
        _, boxes, changes = GEOMETRY.prepare_source(doc)
        rows = [p for p in doc.page[0].pdf_paragraph if p.debug_id.startswith("dates:row")]
        self.assertEqual(len(rows), 4)
        self.assertEqual(proof, GEOMETRY._glyph_proof([c for p in rows for c in p.pdf_paragraph_composition]))
        for index, row in enumerate(rows):
            self.assertAlmostEqual(row.box.x2, 150.1769794)
            self.assertAlmostEqual(row.box.y2, 298.4318 - index * 11.925)
            self.assertEqual(boxes[(0, row.debug_id)], row.box)
            if index:
                self.assertLess(row.box.y2, rows[index - 1].box.y)
        self.assertTrue(any(change["reason"] == "recover aligned sidebar column allocation" for change in changes))

    def test_full_chinese_date_fits_without_deleting_spaces_or_shrinking_below_85_percent(self):
        from babeldoc.format.pdf.document_il.midend.typesetting import Typesetting

        class TestTypesetting(Typesetting):
            pass

        doc = sidebar_document()
        skips, boxes, _ = GEOMETRY.prepare_source(doc)
        row = next(p for p in doc.page[0].pdf_paragraph if p.debug_id == "dates:row0")
        intended = "收稿日期：2025 年 1 月 3 日"
        row.pdf_paragraph_composition = [PdfParagraphComposition(
            pdf_same_style_unicode_characters=PdfSameStyleUnicodeCharacters(
                unicode=intended, pdf_style=deepcopy(row.pdf_style)))]
        font = SimpleNamespace(font_id="fallback", has_glyph=lambda code: code,
                               char_lengths=lambda text, size: [size * (0.25 if text.isspace()
                                                                          else 0.55 if text.isdigit() else 1)])
        engine = object.__new__(TestTypesetting)
        engine.font_mapper = SimpleNamespace(base_font=font, map=lambda old, char: font)
        GEOMETRY.install_typesetting_policy(TestTypesetting, skips, boxes)
        units = engine.create_typesetting_units(row, {"F1": SimpleNamespace(font_id="F1")})
        scale, _ = engine._find_optimal_scale_and_layout(row, doc.page[0], units, apply_layout=True)
        self.assertGreaterEqual(scale, 0.85)
        self.assertEqual(GEOMETRY._source_text(row.pdf_paragraph_composition), intended)
        emitted = list(GEOMETRY.characters(row.pdf_paragraph_composition))
        self.assertEqual(len({round(char.box.y, 4) for char in emitted}), 1)
        self.assertTrue(all(char.box.x2 <= 150.1769794 for char in emitted))

    def test_sidebar_expansion_requires_aligned_neighbours_both_above_and_below(self):
        for defect in ("missing", "different_column", "distant", "different_font_size"):
            doc = sidebar_document()
            parent = doc.page[0].pdf_paragraph[1]
            below = doc.page[0].pdf_paragraph[2]
            if defect == "missing":
                doc.page[0].pdf_paragraph.remove(below)
            elif defect == "different_column":
                below.box.x += 15
            elif defect == "distant":
                below.box.y2 -= 100
            else:
                below.pdf_style.font_size = 9.5
            with self.subTest(defect=defect):
                self.assertIsNone(GEOMETRY.sidebar_column_allocation(doc.page[0], parent))

    def test_sidebar_graphics_and_text_cap_expansion_with_a_safety_gap(self):
        for kind in ("pdf_figure", "pdf_curve", "pdf_form", "text"):
            doc = sidebar_document()
            parent = doc.page[0].pdf_paragraph[1]
            obstacle = SimpleNamespace(box=Box(x=125, y=270, x2=145, y2=280))
            if kind == "text":
                doc.page[0].pdf_paragraph.append(PdfParagraph(
                    debug_id="obstacle", box=obstacle.box, layout_label="plain text"))
            else:
                setattr(doc.page[0], kind, [obstacle])
            with self.subTest(kind=kind):
                allocation = GEOMETRY.sidebar_column_allocation(doc.page[0], parent)
                self.assertIsNotNone(allocation)
                self.assertAlmostEqual(allocation.x2, 125 - parent.pdf_style.font_size * 0.5)
                self.assertEqual((allocation.y, allocation.y2), (parent.box.y, parent.box.y2))
        doc = sidebar_document()
        parent = doc.page[0].pdf_paragraph[1]
        doc.page[0].pdf_form = [SimpleNamespace(box=Box(x=100, y=270, x2=145, y2=280))]
        self.assertIsNone(GEOMETRY.sidebar_column_allocation(doc.page[0], parent))

    def test_individual_references_recover_inline_metadata_and_all_source_glyphs(self):
        doc = document()
        before = GEOMETRY._glyph_proof(doc.page[0].pdf_paragraph[0].pdf_paragraph_composition)
        changes = GEOMETRY.prepare_reference_layout(doc)
        self.assertEqual([part.debug_id for part in doc.page[0].pdf_paragraph],
                         ["refs:reference-1", "refs:reference-2"])
        self.assertEqual(changes[0]["citations"], 2)
        after = [composition for part in doc.page[0].pdf_paragraph for composition in part.pdf_paragraph_composition]
        self.assertEqual(before, GEOMETRY._glyph_proof(after))
        for part in doc.page[0].pdf_paragraph:
            self.assertIn("Phys. Rev. B 40, 546–570 (1989).", part.unicode)
            self.assertEqual(len(part.pdf_paragraph_composition), 3)
        self.assertGreater(doc.page[0].pdf_paragraph[0].box.y, doc.page[0].pdf_paragraph[1].box.y2)

    def test_source_baselines_recover_a_citation_that_crosses_two_original_lines(self):
        values = chars("Phys. ", x=190, y=100, font="Italic") + chars("Rev. B 40, 546–570 (1989).", x=36, y=90)
        shuffled = values[::2] + values[1::2]
        ordered = GEOMETRY.ordered_reference_characters(shuffled)
        self.assertEqual("".join(c.char_unicode for c in ordered), "Phys. Rev. B 40, 546–570 (1989).")
        compact = GEOMETRY.compact_reference_formula(formula(ordered).pdf_formula)
        self.assertEqual({char.box.y for char in compact.pdf_character}, {0})
        self.assertLess(compact.box.x2, 220)
        self.assertEqual([(c.char_unicode, c.pdf_character_id, c.pdf_style.font_id) for c in compact.pdf_character],
                         [(c.char_unicode, c.pdf_character_id, c.pdf_style.font_id) for c in ordered])

    def test_runtime_compaction_changes_only_a_copy_and_keeps_old_fonts(self):
        doc = document()
        GEOMETRY.prepare_reference_layout(doc)
        original = doc.page[0].pdf_paragraph[0].pdf_paragraph_composition[-1].pdf_formula
        before = asdict(original)
        compact = GEOMETRY.compact_reference_formula(original)
        self.assertEqual(before, asdict(original))
        self.assertTrue(all(c.pdf_style.font_id == "Italic" for c in compact.pdf_character))
        self.assertEqual("".join(c.char_unicode for c in compact.pdf_character), "Phys. Rev. B 40, 546–570 (1989). ")

    def test_engine_synthetic_space_with_aliased_boxes_is_transformed_only_once(self):
        values = chars("Phys. Rev. B 40, 546–570 (1989).", x=330, y=700)
        for char in values:
            if char.char_unicode == " ":
                # Actual BabelDOC extraction aliases these objects. Serializing
                # and reconstructing an IL fixture accidentally removes it.
                char.visual_bbox.box = char.box
        original = formula(values).pdf_formula
        before = asdict(original)
        compact = GEOMETRY.compact_reference_formula(original)
        self.assertEqual(before, asdict(original))
        for char in compact.pdf_character:
            self.assertGreaterEqual(char.visual_bbox.box.x, 0)
            self.assertGreaterEqual(char.box.x, 0)
            self.assertEqual(char.box.y, 0)
            if char.char_unicode == " ":
                self.assertEqual(char.visual_bbox.box.x, char.box.x)

    def test_missing_or_duplicate_source_glyph_rejects_without_partial_mutation(self):
        for missing in (True, False):
            doc = document()
            formula_value = doc.page[0].pdf_paragraph[0].pdf_paragraph_composition[6].pdf_formula
            if missing:
                formula_value.pdf_character[0].pdf_character_id = None
            else:
                formula_value.pdf_character.append(deepcopy(formula_value.pdf_character[0]))
            before = asdict(doc)
            with self.subTest(missing=missing), self.assertRaises(GEOMETRY.ReferenceLayoutError):
                GEOMETRY.prepare_reference_layout(doc)
            self.assertEqual(before, asdict(doc))

    def test_nonmonotonic_or_repeated_reference_labels_are_rejected(self):
        for number in (1, 4):
            doc = document(reference() + reference(number, 50))
            with self.subTest(number=number), self.assertRaisesRegex(GEOMETRY.ReferenceLayoutError, "labels"):
                GEOMETRY.prepare_reference_layout(doc)

    def test_protected_graphics_are_never_dropped_from_a_metadata_candidate(self):
        doc = document()
        doc.page[0].pdf_paragraph[0].pdf_paragraph_composition[2].pdf_formula.pdf_curve.append(object())
        with self.assertRaisesRegex(GEOMETRY.ReferenceLayoutError, "graphic"):
            GEOMETRY.prepare_reference_layout(doc)

    def test_publisher_prose_and_author_accents_are_kept_outside_metadata(self):
        comp = reference()
        publisher = plain(chars("(Cambridge University Press). ", x=40, y=70))
        accent = formula(chars("¨", x=38, y=102))
        comp[1:1] = [accent]
        comp.append(publisher)
        doc = document(comp)
        GEOMETRY.prepare_reference_layout(doc)
        result = doc.page[0].pdf_paragraph[0].pdf_paragraph_composition
        self.assertEqual(asdict(result[-1]), asdict(publisher))
        self.assertEqual(asdict(result[1]), asdict(accent))

    def test_cross_column_continuation_and_trailing_unfinished_reference_are_retained(self):
        continuation = plain(chars("Bose condensates. ", x=36, y=120))
        continuation_metadata = reference()[2:]
        unfinished = reference(3, 10)[:2]
        doc = document([continuation] + continuation_metadata + reference(2, 60) + unfinished)
        GEOMETRY.prepare_reference_layout(doc)
        self.assertEqual([part.debug_id for part in doc.page[0].pdf_paragraph],
                         ["refs:reference-continuation", "refs:reference-2", "refs:reference-3"])
        self.assertIn("Bose condensates", doc.page[0].pdf_paragraph[0].unicode)
        self.assertIn("Fisher", doc.page[0].pdf_paragraph[-1].unicode)

    def test_ordinary_body_math_and_numbered_lists_are_unchanged(self):
        comps = [formula(chars("[1] ", x=20)), plain(chars("An ordinary numbered list", x=36)),
                 formula(chars("x + 20", x=80, y=70))]
        doc = document(comps)
        before = asdict(doc)
        self.assertEqual(GEOMETRY.prepare_reference_layout(doc), [])
        self.assertEqual(before, asdict(doc))

    def test_prepare_is_idempotent_and_records_source_hanging_indent(self):
        doc = document()
        skips, boxes, changes = GEOMETRY.prepare_source(doc)
        before = asdict(doc)
        self.assertEqual(GEOMETRY.prepare_reference_layout(doc), [])
        self.assertEqual(before, asdict(doc))
        self.assertEqual(boxes[(6, "refs:reference-1", "reference-body-x")], 36)

    def test_runtime_typesetting_keeps_complete_formula_sequence_and_hanging_indent(self):
        from babeldoc.format.pdf.document_il.midend.typesetting import Typesetting

        class TestTypesetting(Typesetting):
            pass

        doc = document(reference())
        skips, boxes = {}, {}
        # Match the prototype: install hooks before source extraction fills
        # the shared allocation registries.
        GEOMETRY.install_typesetting_policy(TestTypesetting, skips, boxes)
        prepared_skips, prepared_boxes, _ = GEOMETRY.prepare_source(doc)
        skips.update(prepared_skips)
        boxes.update(prepared_boxes)
        engine = object.__new__(TestTypesetting)
        engine.font_mapper = SimpleNamespace(base_font=SimpleNamespace(char_lengths=lambda text, size: [size / 2]))
        part = doc.page[0].pdf_paragraph[0]
        protected = [c for c in GEOMETRY.characters(part.pdf_paragraph_composition[-1:])]
        intended = GEOMETRY._source_text(part.pdf_paragraph_composition)
        units = engine.create_typesetting_units(part, {})
        self.assertFalse(units[0].can_passthrough)
        self.assertTrue(all(unit.height == unit.char.pdf_style.font_size for unit in units if unit.char))
        engine._find_optimal_scale_and_layout(part, doc.page[0], units, apply_layout=True)
        final = list(GEOMETRY.characters(part.pdf_paragraph_composition))
        self.assertEqual(GEOMETRY._source_text(part.pdf_paragraph_composition).replace(" ", ""), intended.replace(" ", ""))
        identity = lambda c: (c.char_unicode, c.pdf_character_id, c.pdf_style.font_id)
        signature = [identity(c) for c in protected]
        identities = [identity(c) for c in final]
        self.assertTrue(any(identities[i:i + len(signature)] == signature for i in range(len(identities))))
        self.assertAlmostEqual(final[0].box.x, 20)
        authors = next(char for char in final if char.char_unicode == "F")
        self.assertAlmostEqual(authors.box.x, 36)

    def test_actual_spacing_diaeresis_overlays_its_source_letter_at_full_and_reduced_scale(self):
        from babeldoc.format.pdf.document_il.midend.typesetting import Typesetting

        for base in ("a", "u"):
            for scale in (1.0, 0.85):
                with self.subTest(base=base, scale=scale):
                    class TestTypesetting(Typesetting):
                        pass

                    doc = author_diacritic(base)
                    skips, boxes, _ = GEOMETRY.prepare_source(doc)
                    para = doc.page[0].pdf_paragraph[0]
                    source = asdict(doc)
                    source_signature = [(c.char_unicode, c.pdf_character_id, c.pdf_style.font_id)
                                        for c in para.pdf_paragraph_composition[1].pdf_formula.pdf_character]
                    # Match actual translated Latin fallback metrics: its a/u
                    # advance differs from the original TeX font's advance.
                    for index, text in ((0, "H"), (2, base + "nsch")):
                        para.pdf_paragraph_composition[index] = PdfParagraphComposition(
                            pdf_same_style_unicode_characters=PdfSameStyleUnicodeCharacters(
                                unicode=text, pdf_style=deepcopy(para.pdf_style)))
                    target = asdict(doc)
                    font = SimpleNamespace(font_id="fallback", has_glyph=lambda code: code,
                                           char_lengths=lambda text, size: [size * ({"a": 0.557128,
                                                                                   "u": 0.652832}.get(text, 0.5))])
                    engine = object.__new__(TestTypesetting)
                    engine.font_mapper = SimpleNamespace(base_font=font, map=lambda old, char: font)
                    GEOMETRY.install_typesetting_policy(TestTypesetting, skips, boxes)
                    units = engine.create_typesetting_units(para, {"F33": SimpleNamespace(font_id="F33")})
                    self.assertEqual(asdict(doc), target, "Runtime preparation must not mutate pre-typesetting IL.")
                    scale_used, _ = engine._find_optimal_scale_and_layout(
                        para, doc.page[0], units, initial_scale=scale, apply_layout=True)
                    self.assertEqual(scale_used, scale)
                    emitted = list(GEOMETRY.characters(para.pdf_paragraph_composition))
                    accent = next(c for c in emitted if c.char_unicode == "¨")
                    letter = next(c for c in emitted if c.char_unicode == base)
                    self.assertEqual((accent.char_unicode, accent.pdf_character_id, accent.pdf_style.font_id), source_signature[0])
                    self.assertAlmostEqual(accent.box.y, letter.box.y)
                    ink_center = (accent.visual_bbox.box.x + accent.visual_bbox.box.x2) / 2
                    self.assertAlmostEqual(ink_center, (letter.box.x + letter.box.x2) / 2, delta=0.02)
                    self.assertGreater(accent.visual_bbox.box.y, letter.box.y + letter.pdf_style.font_size * 0.4)
                    self.assertEqual("".join(c.char_unicode for c in emitted), "H¨" + base + "nsch")
                    self.assertEqual(source["page"][0]["pdf_paragraph"][0]["pdf_paragraph_composition"][1]["pdf_formula"]["pdf_character"][0]["pdf_character_id"], 127)

    def test_changed_target_base_letter_or_ambiguous_source_attachment_is_rejected(self):
        from babeldoc.format.pdf.document_il.midend.typesetting import Typesetting

        class TestTypesetting(Typesetting):
            pass

        doc = author_diacritic()
        skips, boxes, _ = GEOMETRY.prepare_source(doc)
        para = doc.page[0].pdf_paragraph[0]
        para.pdf_paragraph_composition[2].pdf_same_style_characters.pdf_character[0].char_unicode = "x"
        GEOMETRY.install_typesetting_policy(TestTypesetting, skips, boxes)
        engine = object.__new__(TestTypesetting)
        with self.assertRaisesRegex(GEOMETRY.ReferenceLayoutError, "source letter"):
            engine.create_typesetting_units(para, {})
        doc = author_diacritic()
        doc.page[0].pdf_paragraph[0].pdf_paragraph_composition[1].pdf_formula.pdf_character[0].box.y += 3
        with self.assertRaisesRegex(GEOMETRY.ReferenceLayoutError, "ambiguous"):
            GEOMETRY.prepare_source(doc)


if __name__ == "__main__":
    unittest.main()
