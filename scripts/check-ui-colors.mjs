import { readFile, readdir } from 'node:fs/promises';
import { resolve, relative, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import ts from 'typescript';
import { colorPattern, colorException } from './ui-color-policy.mjs';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const require=createRequire(import.meta.url);
const postcss=createRequire(require.resolve('vite/package.json'))('postcss');
const palette=JSON.parse(await readFile(resolve(root,'design-system/ui-palette.json'),'utf8'));
const keys=new Set(palette.colors.map(c=>`--ui-${c.key}`));
const errors=[];
if(palette.colors.length>50)errors.push('界面色板超过 50 项（包含透明度变体）');
if(keys.size!==palette.colors.length)errors.push('色板用途重复');
async function walk(dir){const files=[];for(const e of await readdir(dir,{withFileTypes:true})){if(e.name==='vendor')continue;const p=resolve(dir,e.name);if(e.isDirectory())files.push(...await walk(p));else if(/\.(css|tsx|ts)$/.test(e.name))files.push(p);}return files;}
for(const path of [...await walk(resolve(root,'app')),...await walk(resolve(root,'components')),...await walk(resolve(root,'desktop/pet'))]) {
  const file=relative(root,path),text=await readFile(path,'utf8');
  const check=(value,selector,property,line)=>{
    for(const [,name] of value.matchAll(/var\(\s*(--ui-[\w-]+)/g))if(!keys.has(name))errors.push(`${file}:${line} 未定义 ${name}`);
    if(colorException({file,selector,property,value}))return;
    for(const [color] of value.matchAll(colorPattern))errors.push(`${file}:${line} ${property} 仍使用 ${color}`);
    if(/^(?:color|background(?:-color)?|border(?:-color)?|fill|stroke|outline|box-shadow)$/.test(property) && /(?<![\w-])(?:white|black|red|blue|green|gray|grey|yellow|purple|orange|pink|rebeccapurple)(?![\w-])/.test(value))errors.push(`${file}:${line} 请用规范色替代命名色`);
  };
  if(file.endsWith('.css'))postcss.parse(text,{from:file}).walkDecls(d=>check(d.value,d.parent.selector||'',d.prop,d.source.start.line));
  else {
    const source=ts.createSourceFile(file,text,ts.ScriptTarget.Latest,true,file.endsWith('tsx')?ts.ScriptKind.TSX:ts.ScriptKind.TS);
    const visit=node=>{
      if(ts.isStringLiteral(node)) {
        const line=source.getLineAndCharacterOfPosition(node.getStart(source)).line+1;
        if(/^(?:#[\da-f]{3,8}$|(?:rgba?|hsla?|oklch|(?:linear|radial)-gradient)\(|var\(--ui-)/i.test(node.text))check(node.text,'','TS / TSX',line);
        // Catch Tailwind arbitrary colors and stock hue utilities too.
        if(!colorException({file}) && /(?:bg|text|border|ring|fill|stroke)-(?:\[(?:#|rgb|hsl)|(?:red|blue|green|yellow|purple|orange|pink|gray|slate|zinc|white|black)(?:[-/\s]|$))/.test(node.text))errors.push(`${file}:${line} Tailwind 颜色请使用语义变量`);
      }
      ts.forEachChild(node,visit);
    };visit(source);
  }
}
if(errors.length){console.error(errors.join('\n'));process.exitCode=1;}
else console.log(`PASS · ${palette.colors.length}/50 UI color slots; no unregistered literals or undefined UI tokens in owned CSS / color literals / Tailwind classes.`);
