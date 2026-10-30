"""Convert only the supplied loading word/glyphs into offline SVG paths.
Requires fontTools at build-artwork time, never at app runtime.
Usage: python build-loading-artwork.py /path/to/downloaded/fonts
"""
import json
import re
import sys
from pathlib import Path
from fontTools.ttLib import TTFont
from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.pens.transformPen import TransformPen

root = Path(__file__).resolve().parents[1]
font_dir = Path(sys.argv[1])
specs = {
    'solid': ('gfsdidot', 29, .29), 'ht': ('doto', 30, 0),
    'dot': ('codystar', 28, 0), 'script': ('pinyonscript', 38, 0),
    'line': ('bungeeoutline', 27, 0), 'hatch': ('bungee', 27, 0),
    'topo': ('monoton', 25, 0), 'pix': ('silkscreen', 25, 0),
    'wire': ('majormonodisplay', 25, 0), 'geo': ('bungee', 27, 0),
}

def outlines(font_name, text, size, spacing=0):
    font = TTFont(font_dir / (font_name + '.ttf'))
    glyphs = font.getGlyphSet()
    cmap = font.getBestCmap()
    scale = size / font['head'].unitsPerEm
    # Keep a shared baseline; font outlines replace text without browser fonts.
    baseline = 29
    pen = SVGPathPen(glyphs, ntos=lambda v: str(round(v, 3)))
    x = 0
    for char in text:
        name = cmap[ord(char)]
        glyphs[name].draw(TransformPen(pen, (scale, 0, 0, -scale, x, baseline)))
        x += glyphs[name].width * scale + spacing
    return {'path': pen.getCommands(), 'width': round(x, 3)}

words = {style: outlines(family, 'Lumior', size, spacing) for style, (family, size, spacing) in specs.items()}
glyphs = {char: outlines('ibmplexmono', char, 26) for char in '@#%&$*=+08<>{}[]()?/' }
output = '// Generated SVG outlines from OFL Google Fonts; no font or network dependency.\n// Regenerate with scripts/build-loading-artwork.py; licenses: public/assets/loading/font-licenses/.\n'
output += 'export const loadingWords = ' + json.dumps(words, ensure_ascii=False, separators=(',', ':')) + ' as const;\n'
output += 'export const loadingLetters = ' + json.dumps({char: outlines('gfsdidot', char, 29, .29) for char in 'Lumior'}, separators=(',', ':')) + ' as const;\n'
output += 'export const loadingGlyphs = ' + json.dumps(glyphs, ensure_ascii=False, separators=(',', ':')) + ' as const;\n'
(root / 'app/loading-wordmark-paths.ts').write_text(output)
print('Wordmark paths:', len(output), 'bytes')
