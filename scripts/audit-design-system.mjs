import { readdir, readFile, writeFile, mkdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { colorException } from './ui-color-policy.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const postcss = createRequire(require.resolve('vite/package.json'))('postcss');
async function walk(directory) {
  const result = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (entry.name === 'vendor') continue;
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) result.push(...await walk(path));
    else if (/\.(?:css|tsx|ts)$/.test(entry.name)) result.push(path);
  }
  return result.sort((a,b)=>a.localeCompare(b));
}
function moduleFor(path) {
  if (path.startsWith('components/')) return '基础组件';
  if (/preview/.test(path)) return '独立预览';
  if (/thesis/.test(path)) return '论文助手';
  if (/(?:ai-|research)/.test(path)) return 'AI 对话';
  if (/pdf|bibliography/.test(path)) return 'PDF 与文献';
  if (/database/.test(path)) return '多维表';
  if (/document|expanded-note|block-editor|note-/.test(path)) return '笔记与编辑器';
  if (/video|image|media|sound/.test(path)) return '图片、影音';
  if (/trial|updates|settings|storage|data-settings/.test(path)) return '设置与更新';
  if (/home-|file-|card-library|global-card-search/.test(path)) return '首页与资料库';
  if (/memory|explore|inspiration|observatory|earthrise|wallpaper/.test(path)) return '星海与背景';
  if (/globals|i18n/.test(path)) return '全局';
  return '画布与工作区';
}
const paths = [...await walk(resolve(root, 'app')), ...await walk(resolve(root, 'components'))];
const files = await Promise.all(paths.map(async absolute => ({ file: relative(root, absolute), text: await readFile(absolute, 'utf8') })));
const colors = new Map(), variables = new Map(), modules = new Map(), components = [];
const colorPattern = /#[\da-f]{8}\b|#[\da-f]{6}\b|#[\da-f]{4}\b|#[\da-f]{3}\b|(?:rgba?|hsla?|oklch)\([^)]*\)/gi;
const samples = [];
let cssFiles = 0, declarations = 0, literalCount = 0, fallbackCount = 0, tokenCount = 0, sourceColorCandidates = 0;
for (const { file, text } of files) {
  const group = moduleFor(file);
  if (!modules.has(group)) modules.set(group, { name: group, files: [], cssFiles: 0, colorCount: 0 });
  modules.get(group).files.push(file);
  if (file.endsWith('.tsx')) {
    const name = file.split('/').at(-1).replace('.tsx', '');
    const imports = files.filter(other => other.file !== file && new RegExp(`(?:from\\s*|import\\s*)['"][^'"]*/${name}(?:\\.tsx)?['"]`).test(other.text)).map(other => other.file);
    components.push({ name, file, module: group, kind: file.startsWith('components/') ? '基础组件' : '业务组件 / 页面', imports });
  }
  if (!file.endsWith('.css')) {
    const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
    const visit = node => {
      // Count color-like literal values, not arbitrary hex fragments in prose,
      // URLs, SVG paths or generated document strings. This remains a candidate
      // inventory: user-content palettes and provider logos are intentional colors.
      if (ts.isStringLiteral(node) && /^(?:#[\da-f]{3,8}$|(?:rgba?|hsla?|oklch|(?:linear|radial)-gradient)\()/i.test(node.text)) {
        const parent = node.parent;
        const property = ts.isPropertyAssignment(parent) || ts.isJsxAttribute(parent) ? parent.name.getText(source) : '颜色候选字面量';
        for (const [raw] of node.text.matchAll(colorPattern)) {
          const color = raw.toLowerCase();
          if (!colors.has(color)) colors.set(color, { color, uses: [] });
          colors.get(color).uses.push({ file, line: source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1, selector: 'TS / TSX 字面量，需结合组件判断', property, value: node.text, module: group, kind: '源码颜色候选' });
          modules.get(group).colorCount++; sourceColorCandidates++;
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(source);
    continue;
  }
  cssFiles++; modules.get(group).cssFiles++;
  const sheet = postcss.parse(text, { from: file });
  sheet.walkDecls(decl => {
    declarations++;
    const selector = decl.parent.selector || decl.parent.name || ':root';
    const entry = { file, line: decl.source.start.line, selector, property: decl.prop, value: decl.value, module: group };
    if (decl.prop.startsWith('--')) {
      if (!variables.has(decl.prop)) variables.set(decl.prop, { name: decl.prop, definitions: [], uses: [] });
      variables.get(decl.prop).definitions.push(entry);
    }
    for (const [, name] of decl.value.matchAll(/var\(\s*(--[\w-]+)/g)) {
      if (!variables.has(name)) variables.set(name, { name, definitions: [], uses: [] });
      variables.get(name).uses.push(entry);
    }
    for (const [raw] of decl.value.matchAll(colorPattern)) {
      const color = raw.toLowerCase();
      if (!colors.has(color)) colors.set(color, { color, uses: [] });
      const kind = decl.prop.startsWith('--') ? '变量定义' : decl.value.includes('var(') ? '含变量回退' : '直接色值';
      colors.get(color).uses.push({ ...entry, kind });
      modules.get(group).colorCount++;
      if (kind === '变量定义') tokenCount++;
      else if (kind === '含变量回退') fallbackCount++;
      else literalCount++;
    }
  });
  // Preserve the cascade and declarations from the shipping menu, without importing
  // unrelated app layout rules into the isolated gallery.
  if (['app/lumior.css', 'app/board-chrome.css'].includes(file)) sheet.walkRules(rule => {
    if (rule.selector.includes('.lumior-menu')) samples.push(`/* ${file}:${rule.source.start.line} */\n${rule.toString()}`);
  });
}
const output = resolve(root, 'design-system/generated');
await mkdir(output, { recursive: true });
const data = {
  generatedAt: new Date().toISOString(),
  scope: '自有 CSS 声明及 TS / TSX 中明确的颜色候选字面量；排除 vendor。含独立预览、未使用基础组件和内容色；动态表达式、命名色及第三方内部样式未穷尽。计数是静态来源，不等同于运行时样式或违规数量。',
  stats: { cssFiles, componentFiles: components.length, primitives: components.filter(item => item.file.startsWith('components/')).length, declarations, colorSpellings: colors.size, literalCount, fallbackCount, tokenCount, sourceColorCandidates, variables: variables.size },
  colors: [...colors.values()].sort((a, b) => b.uses.length - a.uses.length),
  variables: [...variables.values()].sort((a, b) => b.uses.length - a.uses.length),
  modules: [...modules.values()].sort((a, b) => b.colorCount - a.colorCount),
  components,
};
const palette = JSON.parse(await readFile(resolve(root, 'design-system/ui-palette.json'), 'utf8'));
const usages = data.colors.flatMap(item => item.uses.map(use => ({ color: item.color, ...use })));
data.uiPalette = {
  slots: palette.colors.length,
  limit: palette.limit,
  distinctValues: new Set(palette.colors.map(item => item.value)).size,
  unregistered: usages.filter(use => !colorException(use)),
  exceptions: usages.filter(use => colorException(use) && colorException(use) !== '色板定义').map(use => ({...use,reason:colorException(use)})),
};
await writeFile(resolve(output, 'audit.json'), JSON.stringify(data));
await writeFile(resolve(output, 'production-samples.css'), samples.join('\n'));
console.log(JSON.stringify({...data.stats, uiSlots:data.uiPalette.slots, unregistered:data.uiPalette.unregistered.length, contentExceptions:data.uiPalette.exceptions.length}));
