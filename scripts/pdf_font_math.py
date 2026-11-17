"""Extend the renamed document font with missing, licensed Noto Math outlines.

Usage: python scripts/pdf_font_math.py existing.ttf NotoSansMath-Regular.ttf updated.ttf
Existing glyphs and source Unicode remain unchanged. Each new code point gets a
distinct glyph ID so PDF subsets preserve exact copy/search text, even for aliases.
"""
import hashlib
from fontTools.ttLib import TTFont
from fontTools.pens.recordingPen import DecomposingRecordingPen
from fontTools.pens.transformPen import TransformPen
from fontTools.pens.ttGlyphPen import TTGlyphPen

NOTO_SHA256 = "3f495fe933c06786e4d5f6d86b8ee70b6753a68ee3b9d87528726de0f6e2c47d"


def add_math_glyphs(font, source_path):
    with open(source_path, "rb") as source_file:
        if hashlib.sha256(source_file.read()).hexdigest() != NOTO_SHA256:
            raise ValueError("Use the pinned Noto Sans Math source recorded in pdf-fonts/README.txt")
    source_font = TTFont(source_path)
    cmap = font.getBestCmap()
    source_cmap = source_font.getBestCmap()
    source_glyphs = source_font.getGlyphSet()
    scale = font["head"].unitsPerEm / source_font["head"].unitsPerEm
    order = list(font.getGlyphOrder())
    for codepoint, source in sorted(source_cmap.items()):
        if codepoint in cmap:
            continue
        if len(order) >= 65535:
            raise ValueError("Merged font exceeds the TrueType glyph limit")
        name = f"mathU{codepoint:06X}"
        # Decompose all references before copying so the result has no hidden
        # dependency on Noto's glyph names, composite tables or units-per-em.
        recording = DecomposingRecordingPen(source_glyphs)
        source_glyphs[source].draw(recording)
        pen = TTGlyphPen(None)
        recording.replay(TransformPen(pen, (scale, 0, 0, scale, 0, 0)))
        font["glyf"][name] = pen.glyph()
        advance, bearing = source_font["hmtx"].metrics[source]
        font["hmtx"].metrics[name] = (round(advance * scale), round(bearing * scale))
        order.append(name)
        for table in font["cmap"].tables:
            if table.isUnicode() and (table.format == 12 or table.format == 4 and codepoint <= 0xFFFF):
                table.cmap[codepoint] = name
    font.setGlyphOrder(order)
    # The renamed derivative retains both upstream copyright notices in its
    # own metadata as well as the complete licenses shipped alongside it.
    notice = source_font["name"].getDebugName(0)
    for record in list(font["name"].names):
        if record.nameID == 0 and notice and notice not in record.toUnicode():
            value = record.toUnicode() + " Includes Noto Sans Math outlines. " + notice
            font["name"].setName(value, 0, record.platformID, record.platEncID, record.langID)
    # fontkit's PDF subsets need four-byte-aligned TrueType glyph outlines.
    font["glyf"].padding = 4


if __name__ == "__main__":
    import sys

    font = TTFont(sys.argv[1])
    add_math_glyphs(font, sys.argv[2])
    font.save(sys.argv[3])
