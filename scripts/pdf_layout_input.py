"""Reject unsupported input before model translation; no provider settings are read."""

import argparse
import json
from pathlib import Path
import traceback
import unicodedata


class InputQualityError(ValueError):
    pass


def inspect_pdf(path):
    import pymupdf

    with pymupdf.open(path) as document:
        if document.needs_pass:
            raise InputQualityError("这个 PDF 已加密，请先提供可直接打开的文件。")
        if not 0 < document.page_count <= 500:
            raise InputQualityError("原版式翻译暂时支持最多 500 页的 PDF。")
        empty = []
        count = 0
        for number, page in enumerate(document, start=1):
            # This engine has demonstrated missing visible prose with old Type3
            # fonts. Do not silently treat its incomplete extraction as success.
            if any(font[2] == "Type3" for font in page.get_fonts(full=True)):
                raise InputQualityError("这个 PDF 使用暂不支持的旧 Type3 字体，无法可靠还原文字；请使用普通译文方式。")
            text = page.get_text().strip()
            if not text:
                empty.append(number)
            count += len(text)
            if count > 2_000_000:
                raise InputQualityError("这个 PDF 的文字超过完整翻译容量，请拆分后重试。")
        if not count:
            raise InputQualityError("这个 PDF 没有可提取文字，扫描件识别尚未接入。")
        return {"totalPages": document.page_count, "emptyPages": empty}


def inspect_source_layout(source, requests):
    if not requests:
        raise InputQualityError("没有可靠提取到可翻译段落，请使用普通译文方式。")
    for page in source.get("page", []):
        for paragraph in page.get("pdf_paragraph", []):
            for composition in paragraph.get("pdf_paragraph_composition", []):
                if composition.get("pdf_formula"):
                    continue
                characters = []
                for kind in ("pdf_line", "pdf_same_style_characters"):
                    if composition.get(kind):
                        characters.extend(composition[kind].get("pdf_character", []))
                if composition.get("pdf_character"):
                    characters.append(composition["pdf_character"])
                text = (composition.get("pdf_same_style_unicode_characters") or {}).get("unicode", "")
                text += "".join(character.get("char_unicode") or "" for character in characters)
                if any(character == "\ufffd" or (unicodedata.category(character) == "Cc" and not character.isspace()) for character in text):
                    raise InputQualityError("原文字体编码无法可靠读取，已停止原版式翻译；请使用普通译文方式。")
                for character in characters:
                    size = (character.get("pdf_style") or {}).get("font_size")
                    if isinstance(size, (int, float)) and 0 < size < 1 and (character.get("char_unicode") or "").strip():
                        raise InputQualityError("原文字号信息异常，无法可靠还原版式；请使用普通译文方式。")


def write_preflight_report(input_path, output_path):
    try:
        report = {"passed": True, **inspect_pdf(input_path)}
    except Exception as failure:
        if not isinstance(failure, InputQualityError):
            # The service redirects child stderr to its private engine.log.
            # HTTP receives only the friendly report, never this traceback.
            traceback.print_exc()
        report = {"passed": False, "error": str(failure) if isinstance(failure, InputQualityError) else "这个 PDF 无法可靠读取，请检查文件是否完整。"}
    output_path.write_text(json.dumps(report, ensure_ascii=False))
    return 0 if report["passed"] else 1


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("input", type=Path)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    return write_preflight_report(args.input, args.output)


if __name__ == "__main__":
    raise SystemExit(main())
