"""Rotated source text must be verified glyph by glyph without normalization."""

from copy import deepcopy
import importlib.util
from pathlib import Path
import unittest

import pymupdf

SPEC = importlib.util.spec_from_file_location("layout_unicode_repair", Path(__file__).resolve().parents[1] / "scripts" / "repair-pdf-layout-unicode.py")
REPAIR = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(REPAIR)


def fixture(text="arXiv:", x=32, duplicate=False, rotate=90, color=(0, 0, 0)):
    doc = pymupdf.open()
    page = doc.new_page(width=612, height=792)
    page.insert_text((x, 624), text, fontsize=20, fontname="Times-Roman", rotate=rotate, color=color)
    if duplicate:
        page.insert_text((x, 624), text, fontsize=20, fontname="Times-Roman", rotate=90)
    return doc


def layout_for(doc):
    page = doc[0]
    alias = next(font[4] for font in page.get_fonts(full=True) if font[3] == "Times-Roman")
    raw = [char for block in page.get_text("rawdict")["blocks"] if block["type"] == 0
           for line in block["lines"] for span in line["spans"] for char in span["chars"]]
    chars = [{"char_unicode": char["c"], "pdf_character_id": ord(char["c"]), "vertical": True,
              "pdf_style": {"font_id": alias, "font_size": 20},
              "box": {"x": char["origin"][0] - 20, "x2": char["origin"][0],
                      "y": page.rect.height - char["origin"][1], "y2": page.rect.height - char["bbox"][1]}}
             for char in raw]
    return {"page": [{"page_number": 0, "pdf_paragraph": [
        {"debug_id": "formula-split", "vertical": True, "box": {"x": 12, "x2": 26, "y": 168, "y2": 214},
         "pdf_paragraph_composition": [{"pdf_formula": {"pdf_character": chars[3:5]}}, {"pdf_formula": {"pdf_character": chars[:3]}}]},
        {"debug_id": "narrow-punctuation", "vertical": True, "box": {"x": 13.4, "x2": 15.8, "y": 213, "y2": 224},
         "pdf_paragraph_composition": [{"pdf_character": chars[5]}]},
    ]}]}


class RotatedUnicodeTests(unittest.TestCase):
    def test_split_formula_order_and_narrow_ink_bounds_still_bind_every_source_glyph(self):
        with fixture() as source, fixture() as output:
            layout = layout_for(source)
            checked = REPAIR.validate_paragraphs(output, layout)
            self.assertTrue(checked["passed"])
            self.assertEqual(checked["paragraphsChecked"], 2)
            self.assertEqual(REPAIR.paragraph_pdf_text(output[0], layout["page"][0]["pdf_paragraph"][0]), "ivarX")
            proof = REPAIR.verify_preserved_rotated_paragraphs(source, output, layout, deepcopy(layout))
            self.assertTrue(proof["passed"])
            self.assertEqual(proof["glyphsVerified"], 6)

    def test_changed_font_glyph_or_placement_cannot_pass_source_identity_proof(self):
        with fixture() as source:
            layout = layout_for(source)
            for kwargs in ({"text": "arYiv:"}, {"x": 33}, {"text": "arXi"}, {"duplicate": True}, {"rotate": 270}, {"color": (1, 0, 0)}):
                with self.subTest(kwargs=kwargs), fixture(**kwargs) as output:
                    with self.assertRaises(ValueError):
                        REPAIR.verify_preserved_rotated_paragraphs(source, output, layout, deepcopy(layout))

    def test_changed_standard_font_program_identity_is_rejected(self):
        with fixture() as source, fixture() as output:
            layout = layout_for(source)
            font_xref = output[0].get_fonts(full=True)[0][0]
            output.xref_set_key(font_xref, "BaseFont", "/Helvetica")
            with self.assertRaises(ValueError):
                REPAIR.verify_preserved_rotated_paragraphs(source, output, layout, deepcopy(layout))

    def test_changed_il_unicode_or_character_identity_is_rejected(self):
        with fixture() as source, fixture() as output:
            layout = layout_for(source)
            changed = deepcopy(layout)
            char = changed["page"][0]["pdf_paragraph"][0]["pdf_paragraph_composition"][0]["pdf_formula"]["pdf_character"][0]
            char["char_unicode"] = "j"
            with self.assertRaisesRegex(ValueError, "IL glyph identities"):
                REPAIR.verify_preserved_rotated_paragraphs(source, output, layout, changed)


if __name__ == "__main__":
    unittest.main()
