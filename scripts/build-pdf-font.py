"""Convert OFL Source Han Sans outlines to TrueType for reliable PDF glyph subsets.
Usage: python build-pdf-font.py input.otf output.ttf (fonttools required).
"""
import sys
from fontTools.ttLib import TTFont
from fontTools.fontBuilder import FontBuilder
from fontTools.pens.ttGlyphPen import TTGlyphPen
from fontTools.pens.cu2quPen import Cu2QuPen

source = TTFont(sys.argv[1])
cmap = source.getBestCmap()
order = ['.notdef'] + sorted(set(cmap.values()) - {'.notdef'})
glyph_set = source.getGlyphSet()
font = FontBuilder(source['head'].unitsPerEm, isTTF=True)
font.setupGlyphOrder(order)
font.setupCharacterMap(cmap)
glyphs = {}
for index, name in enumerate(order):
    pen = TTGlyphPen(None)
    glyph_set[name].draw(Cu2QuPen(pen, max_err=1, reverse_direction=True))
    glyphs[name] = pen.glyph()
    if index % 10000 == 0:
        print(f'Converted {index} / {len(order)} glyphs', flush=True)
font.setupGlyf(glyphs)
# Fontkit uses short offsets for small PDF subsets. Align outlines so those
# two-byte offsets never truncate an odd-length glyph and lose its contours.
font.font['glyf'].padding = 4
font.setupHorizontalMetrics({name: source['hmtx'].metrics[name] for name in order})
font.setupHorizontalHeader(ascent=source['hhea'].ascent, descent=source['hhea'].descent)
font.setupNameTable({'familyName': 'Lumior Document Sans', 'styleName': 'Regular',
    'uniqueFontIdentifier': 'LumiorDocumentSans-Regular-1', 'fullName': 'Lumior Document Sans Regular',
    'psName': 'LumiorDocumentSans-Regular', 'version': 'Version 1.0',
    'copyright': 'Derived from Source Han Sans, Copyright 2014-2025 Adobe. SIL Open Font License 1.1.'})
os2 = source['OS/2']
font.setupOS2(sTypoAscender=os2.sTypoAscender, sTypoDescender=os2.sTypoDescender,
    usWinAscent=os2.usWinAscent, usWinDescent=os2.usWinDescent)
font.setupPost(keepGlyphNames=False)
font.setupMaxp()
font.save(sys.argv[2])
print(f'Saved {len(order)} glyphs', flush=True)
