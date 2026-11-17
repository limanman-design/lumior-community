export type TranslationMarkdownRun = {
  text: string;
  bold?: boolean;
  italic?: boolean;
  code?: boolean;
};
export type TranslationMarkdownBlock = {
  kind: 'paragraph' | 'heading' | 'list' | 'quote' | 'code';
  level?: number;
  marker?: string;
  runs: TranslationMarkdownRun[];
};

type Emphasis = Pick<TranslationMarkdownRun, 'bold' | 'italic'>;
const identifierCharacter = (value: string) => /[\p{Letter}\p{Number}\p{Mark}_]/u.test(value) && !/\p{Script=Han}/u.test(value);

function characterBefore(text: string, index: number) {
  const tail = text.charCodeAt(index - 1);
  return text.slice(index - (tail >= 0xDC00 && tail <= 0xDFFF ? 2 : 1), index);
}

function appendRun(runs: TranslationMarkdownRun[], run: TranslationMarkdownRun) {
  if (!run.text) return;
  const last = runs.at(-1);
  if (last && last.bold === run.bold && last.italic === run.italic && last.code === run.code)
    last.text += run.text;
  else runs.push(run);
}

function escapedAt(text: string, index: number) {
  let count = 0;
  while (index > 0 && text[--index] === '\\') count++;
  return count % 2 === 1;
}

/** Conservative emphasis boundaries keep equations and identifiers literal. */
function delimiterBoundary(text: string, index: number, length: number, opening: boolean) {
  const before = index ? characterBefore(text, index) : '';
  const after = index + length < text.length ? String.fromCodePoint(text.codePointAt(index + length)!) : '';
  if (opening) return !!after && !/\s/u.test(after) && (!before || !identifierCharacter(before));
  return !!before && !/\s/u.test(before) && (!after || !identifierCharacter(after));
}

function inlineRuns(text: string, emphasis: Emphasis = {}, depth = 0): TranslationMarkdownRun[] {
  if (depth > 8) return [{ text, ...emphasis }];
  const runs: TranslationMarkdownRun[] = [];
  for (let index = 0; index < text.length;) {
    const character = text[index];
    if (character === '\\' && /[\\`*_]/u.test(text[index + 1] || '')) {
      appendRun(runs, { text: text[index + 1], ...emphasis });
      index += 2;
      continue;
    }
    if (character === '`') {
      let length = 1;
      while (text[index + length] === '`') length++;
      const delimiter = '`'.repeat(length);
      let end = text.indexOf(delimiter, index + length);
      while (end >= 0 && (text[end - 1] === '`' || text[end + length] === '`'))
        end = text.indexOf(delimiter, end + length);
      if (end > index + length) {
        appendRun(runs, { text: text.slice(index + length, end), ...emphasis, code: true });
        index = end + length;
        continue;
      }
      appendRun(runs, { text: delimiter, ...emphasis });
      index += length;
      continue;
    }
    if (character === '*' || character === '_') {
      let length = 1;
      while (text[index + length] === character) length++;
      const delimiter = character.repeat(length);
      if (length <= 3 && delimiterBoundary(text, index, length, true)) {
        let end = text.indexOf(delimiter, index + length);
        while (end >= 0) {
          if (!escapedAt(text, end) && text[end - 1] !== character && text[end + length] !== character && delimiterBoundary(text, end, length, false)) break;
          end = text.indexOf(delimiter, end + length);
        }
        if (end > index + length) {
          const nested: Emphasis = { ...emphasis, ...(length >= 2 ? { bold: true } : {}), ...(length !== 2 ? { italic: true } : {}) };
          for (const run of inlineRuns(text.slice(index + length, end), nested, depth + 1)) appendRun(runs, run);
          index = end + length;
          continue;
        }
      }
      appendRun(runs, { text: delimiter, ...emphasis });
      index += length;
      continue;
    }
    // Read Unicode code points so surrogate pairs never become separate runs.
    const value = String.fromCodePoint(text.codePointAt(index)!);
    appendRun(runs, { text: value, ...emphasis });
    index += value.length;
  }
  return runs;
}

function joinSoftLines(lines: string[]) {
  let text = '';
  for (const value of lines) {
    const line = value.trim();
    if (!line) continue;
    const separator = !text || /[\p{Script=Han}]$/u.test(text) || /^[\p{Script=Han}，。！？；：、）】]/u.test(line) ? '' : ' ';
    text += separator + line;
  }
  return text;
}

function quoteText(line: string) {
  const quote = /^ {0,3}>[ \t]?(.*)$/u.exec(line);
  if (!quote) return;
  const content = quote[1];
  // A comparison such as "> 0" or "> sin(x)" is not prose. Require Han
  // text or multiple English words before consuming the leading symbol.
  if (/\p{Script=Han}/u.test(content) || /\b[A-Za-z]{2,}\b(?:[ \t]+\b[A-Za-z]{2,}\b)+/u.test(content)) return content;
}

/**
 * The reflow renderer accepts a small, inert Markdown subset. Unsupported
 * syntax is text, and incomplete delimiters remain visible rather than
 * silently removing source content. This parser never renders HTML or URLs.
 */
export function parseTranslationMarkdown(text: string): TranslationMarkdownBlock[] {
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  const blocks: TranslationMarkdownBlock[] = [];
  let paragraph: string[] = [];
  const flush = () => {
    if (paragraph.length) blocks.push({ kind: 'paragraph', runs: inlineRuns(joinSoftLines(paragraph)) });
    paragraph = [];
  };
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index];
    if (!line.trim()) { flush(); continue; }
    const fence = /^ {0,3}(`{3,}|~{3,})(.*)$/u.exec(line);
    if (fence && !(fence[1][0] === '`' && fence[2].includes('`'))) {
      const closing = new RegExp(`^ {0,3}${fence[1][0]}{${fence[1].length},}[ \\t]*$`, 'u');
      let end = index + 1;
      while (end < lines.length && !closing.test(lines[end])) end++;
      if (end < lines.length) {
        flush();
        blocks.push({ kind: 'code', runs: [{ text: lines.slice(index + 1, end).join('\n'), code: true }] });
        index = end;
        continue;
      }
      // Preserve every line of an unclosed fence, including its language hint.
      flush();
      blocks.push({ kind: 'paragraph', runs: [{ text: lines.slice(index).join('\n') }] });
      break;
    }
    const heading = /^ {0,3}(#{1,6})[ \t]+(.+?)(?:[ \t]+#+[ \t]*)?$/u.exec(line);
    if (heading) {
      flush();
      blocks.push({ kind: 'heading', level: heading[1].length, runs: inlineRuns(heading[2].trim()) });
      continue;
    }
    const list = /^( {0,12})([-+*•●▪◦]|\d{1,9}[.)、]|[（(]\d{1,9}[）)])[ \t]+(.+)$/u.exec(line);
    if (list) {
      flush();
      blocks.push({ kind: 'list', level: Math.floor(list[1].length / 2), marker: list[2], runs: inlineRuns(list[3].trim()) });
      continue;
    }
    const quote = quoteText(line);
    if (quote !== undefined) {
      flush();
      const values = [quote];
      while (index + 1 < lines.length) {
        const next = quoteText(lines[index + 1]);
        if (next === undefined) break;
        values.push(next); index++;
      }
      blocks.push({ kind: 'quote', runs: inlineRuns(joinSoftLines(values)) });
      continue;
    }
    paragraph.push(line);
  }
  flush();
  return blocks;
}
