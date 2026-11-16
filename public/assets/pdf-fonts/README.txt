Lumior Document Sans Regular is a TrueType outline conversion of Source Han Sans Regular (Adobe, SIL Open Font License 1.1).
The modified font has been renamed to comply with the reserved font name requirement.
Original project: https://github.com/adobe-fonts/source-han-sans
License: OFL.txt
Rebuild: scripts/build-pdf-font.py input.otf output.ttf NotoSansMath-Regular.ttf (fonttools 4.60.1).
The app loads this font when previewing or exporting a translated PDF. Each PDF embeds only the glyphs it uses.

Missing mathematical characters use outlines from Noto Sans Math Regular, also under
SIL Open Font License 1.1 (OFL-NotoSansMath.txt). Existing Source Han Sans glyphs are
unchanged. Added characters have separate glyph IDs and their exact original Unicode
values, including mathematical angle brackets, epsilon variants and non-BMP symbols.
No source or translated text is normalized, deleted or substituted.

Pinned source (Google Fonts commit 823468bd7825152bce2b8fd2cf740432ad2fce8d):
https://raw.githubusercontent.com/google/fonts/823468bd7825152bce2b8fd2cf740432ad2fce8d/ofl/notosansmath/NotoSansMath-Regular.ttf
SHA-256: 3f495fe933c06786e4d5f6d86b8ee70b6753a68ee3b9d87528726de0f6e2c47d
Original license:
https://raw.githubusercontent.com/google/fonts/823468bd7825152bce2b8fd2cf740432ad2fce8d/ofl/notosansmath/OFL.txt

The reproducible build includes scripts/pdf_font_math.py. It checks the source digest,
decomposes composite outlines and scales outlines and metrics to the destination units
per em. To upgrade an existing converted font:
python scripts/pdf_font_math.py existing.ttf NotoSansMath-Regular.ttf updated.ttf
