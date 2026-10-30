import { useEffect, useState } from 'react';
import { ArrowRight, Check, Download, RotateCcw, Search, X } from 'lucide-react';
import { Dialog, DialogContent, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import audit from './generated/audit.json';
import palette from './ui-palette.json';
import examples from './color-examples.json';
import { ColorDemo } from './color-demos';
import { previewColors, withMerge, differentColorCount, type MergePlan, type ColorValues } from './color-merge';
import { composite, contrast } from './color-utils';
import './color-library.css';

const base:ColorValues=Object.fromEntries(palette.colors.map(c=>[c.key,c.value]));
const storageKey='lumior-design-color-merge-v1';
const nameOf=(key:string)=>palette.colors.find(c=>c.key===key)?.name||key;
const exampleOf=(key:string)=>examples.find(e=>e.key===key)!;
const candidates=[
  {source:'success-soft',target:null,title:'可优先删除',detail:'成功淡底：未检出产品引用。'},
  {source:'line-subtle',target:'fill-hover',title:'已经同色',detail:'弱分隔线 / 悬停底色：都是白色 8%。'},
  {source:'line',target:'fill-pressed',title:'已经同色',detail:'普通边框 / 按下底色：都是白色 14%。'},
  {source:'control',target:'control-raised',title:'已按确认方案统一',detail:'控件底色 / 突出控件：现在共用 #303133。'},
  {source:'shadow-strong',target:'shadow',title:'可试着合并',detail:'标准 / 深阴影：在相同场景中看差别。'},
];
const priorityKeys=new Set(candidates.flatMap(c=>c.target?[c.source,c.target]:[c.source]));
function loadReview():{plan:MergePlan;removed:string[]} {
  try {
    const saved=JSON.parse(localStorage.getItem(storageKey)||'null');
    if(!saved || typeof saved.plan!=='object' || !saved.plan)return {plan:{},removed:[]};
    if(Object.entries(saved.plan).some(([from,to])=>!(from in base)||typeof to!=='string'||!(to in base)))return {plan:{},removed:[]};
    previewColors(base,saved.plan);
    return {plan:saved.plan,removed:Array.isArray(saved.removed)?saved.removed.filter((key:unknown)=>typeof key==='string'&&exampleOf(key)?.kind==='unused'):[]};
  } catch {return {plan:{},removed:[]};}
}
function usesOf(key:string) {
  const visited=new Set<string>(),found=new Map<string,typeof audit.variables[number]['uses'][number]>();
  const visit=(name:string)=>{if(visited.has(name))return;visited.add(name);for(const use of audit.variables.find(v=>v.name===name)?.uses||[]){found.set(`${use.file}:${use.line}:${use.selector}:${use.property}`,use);if(use.property.startsWith('--'))visit(use.property);}};
  visit(`--ui-${key}`);return [...found.values()];
}
function sampleRatio(key:string,values:ColorValues):number|null {
  // If the canvas itself becomes translucent, the review shell underneath is
  // outside this specimen's palette. Do not report an invented contrast ratio.
  if(values.canvas.length!==7)return null;
  const opaque=(role:string,background=values.canvas)=>composite(values[role],background);
  if(['text','text-secondary','text-muted'].includes(key))return contrast(values[key],values.canvas);
  if(['white','ink'].includes(key))return contrast(values.ink,opaque('white'));
  if(key==='danger-fill')return contrast(values.white,opaque('danger-fill',opaque('panel')));
  if(key==='danger')return contrast(values.danger,opaque('danger-soft',opaque('panel')));
  return null;
}

export function PaletteLibrary() {
  const [review,setReview]=useState(loadReview),[key,setKey]=useState<string|null>(null),[target,setTarget]=useState('');
  const [query,setQuery]=useState(''),[group,setGroup]=useState('全部用途'),[priority,setPriority]=useState(false),[locate,setLocate]=useState(false),[plain,setPlain]=useState(false),[message,setMessage]=useState('');
  useEffect(()=>{try{localStorage.setItem(storageKey,JSON.stringify(review));}catch{/* The review still works in memory when storage is unavailable. */}},[review]);
  const token=palette.colors.find(c=>c.key===key),example=token?exampleOf(token.key):null;
  let trialPlan=review.plan,error='';
  if(key&&target)try{trialPlan=withMerge(base,review.plan,key,target);}catch(e){error=e instanceof Error?e.message:'无法预览这组替换';}
  const after=previewColors(base,trialPlan);
  const count=(values:ColorValues)=>differentColorCount(Object.fromEntries(Object.entries(values).filter(([name])=>!review.removed.includes(name))));
  const uses=key?usesOf(key):[];
  const filtered=palette.colors.filter(c=>(group==='全部用途'||c.group===group)&&(!priority||priorityKeys.has(c.key))&&`${c.name} ${c.usage} ${exampleOf(c.key).location} ${exampleOf(c.key).target} ${c.value}`.toLowerCase().includes(query.toLowerCase()));
  const open=(name:string,to?:string|null)=>{setKey(name);setTarget(to||review.plan[name]||name);setLocate(false);setPlain(false);setMessage('');};
  const removeUnused=(name:string)=>{setReview({...review,removed:review.removed.includes(name)?review.removed.filter(k=>k!==name):[...review.removed,name]});};
  const exportReview=()=>{
    const body={format:'lumior-color-merge-review-v1',appliedToProduct:false,createdAt:new Date().toISOString(),basePalette:base,aliases:review.plan,removeUnused:review.removed,previewColors:previewColors(base,review.plan)};
    const link=document.createElement('a'),url=URL.createObjectURL(new Blob([JSON.stringify(body,null,2)],{type:'application/json'}));link.href=url;link.download='lumior-color-merge-review.json';link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);setMessage('合并建议已导出；没有修改产品。');
  };
  const same=!!key&&!!target&&key!==target&&base[key]===after[key];
  const beforeRatio=key?sampleRatio(key,base):null,afterRatio=key?sampleRatio(key,after):null;
  const hasPlan=Object.keys(review.plan).length>0||review.removed.length>0;
  return <>
    <p className="catalog-lede color-demo-lede">每种颜色都放回一个组件场景。先看「用在哪里」，再试换成另一种颜色，左右比较是否还需要区分。</p>
    <div className="color-review-summary"><span><strong>{palette.colors.length}</strong> 项用途 · {differentColorCount(base)} 个色值</span><span><strong>{examples.length}</strong> 个配色示例</span><span>试配后 <strong>{count(previewColors(base,review.plan))}</strong> 个色值</span><small>只影响本页预览</small></div>
    <div className="color-first-look"><div><h2>这几组可以先看</h2><span>判断依据来自当前产品引用</span></div><div className="color-candidates">{candidates.map(item=><button key={item.source} onClick={()=>open(item.source,item.target)}><small>{item.title}</small><span>{item.detail}</span><ArrowRight size={15}/></button>)}</div></div>
    <div className="color-review-filters"><label><Search size={16}/><input aria-label="搜索颜色或组件" value={query} onChange={e=>setQuery(e.target.value)} placeholder="搜索：输入框、删除、阴影…"/></label><select aria-label="筛选颜色用途" value={group} onChange={e=>setGroup(e.target.value)}><option>全部用途</option>{[...new Set(palette.colors.map(c=>c.group))].map(g=><option key={g}>{g}</option>)}</select><button aria-pressed={priority} onClick={()=>setPriority(!priority)}>优先看可合并项</button><span>{filtered.length} / {examples.length}</span></div>
    {hasPlan&&<div className="color-saved-plan"><div><strong>已保留 {Object.keys(review.plan).length} 组试配 · {review.removed.length} 项删除候选</strong><span>仅保存在此浏览器的审查台中，产品未改。</span></div><button onClick={exportReview}><Download size={14}/>导出建议</button><button onClick={()=>{setReview({plan:{},removed:[]});setMessage('试配已清空，产品色板保持不变。');}}><RotateCcw size={14}/>重置试配</button><div className="color-plan-tags">{Object.entries(review.plan).map(([from,to])=><button key={from} onClick={()=>open(from,to)}>{nameOf(from)} → {nameOf(to)}</button>)}{review.removed.map(name=><button key={name} onClick={()=>open(name)}>删除候选：{nameOf(name)}</button>)}</div></div>}
    <div className="color-demo-grid">{filtered.map(item=>{const demo=exampleOf(item.key);return <article className="color-demo-card" key={item.key}><div className="color-demo-card-heading"><span>{demo.location}</span><small>{demo.kind==='unused'?'未使用 · 假设示例':demo.kind==='component'?'实际按钮组件':'配色原型'}</small></div><ColorDemo example={demo} values={base} mini/><div className="color-demo-card-caption"><span>↳ {demo.target}</span>{review.removed.includes(item.key)&&<b>删除候选</b>}{review.plan[item.key]&&<b>已有试配</b>}</div><button className="color-demo-card-open" aria-label={`查看${item.name}的组件示例`} onClick={()=>open(item.key)}><i style={{background:item.value}}/><span><strong>{item.name}</strong><code>{item.value}</code></span><span className="color-card-cta">查看 / 比较 <ArrowRight size={14}/></span></button></article>;})}</div>
    {!filtered.length&&<div className="color-no-results">没有匹配的示例。试试组件名称，或切回全部用途。</div>}
    <p className="catalog-footnote">真实 Button 直接引用产品组件；其余配色原型按当前色板和对应组件的关键样式复现，布局有所简化。阴影、透明度、文字和状态均可试配。预留色明确标注，不把它当成产品现状。</p>
    <details className="color-audit-details"><summary>保留的内容色与统计口径</summary><p>源码颜色写法由 719 降到 {audit.stats.colorSpellings}；{audit.uiPalette.exceptions.length} 处批注、自选标签、插画等内容色引用保留。44 项是界面用途数，不是所有像素的颜色数。当前未登记界面色值：{audit.uiPalette.unregistered.length}。</p>{[...new Set(audit.uiPalette.exceptions.map(use=>use.reason))].map(reason=><details key={reason}><summary>{reason}</summary>{audit.uiPalette.exceptions.filter(use=>use.reason===reason).map((use,i)=><div className="color-exception-row" key={i}><i style={{background:use.color}}/><code>{use.color}</code><span>{use.file}:{use.line}</span></div>)}</details>)}</details>

    <Dialog open={!!token} onOpenChange={open=>{if(!open)setKey(null);}}><DialogContent className="color-example-dialog"><DialogTitle>{token?.name} · 用在哪里</DialogTitle><DialogDescription>{example?.location}。观察「{example?.target}」；左侧是当前产品配色，右侧是临时试配。</DialogDescription>{token&&example&&<>
      <div className="color-workbench-controls"><label><input type="checkbox" checked={locate} onChange={e=>setLocate(e.target.checked)}/>定位用色区域</label>{example.state==='hover'&&<label><input type="checkbox" checked={plain} onChange={e=>setPlain(e.target.checked)}/>对照默认状态</label>}<span>{example.kind==='component'?'实际产品组件':'配色原型 · 简化布局'}</span></div>
      <div className="color-compare-grid"><section><header><strong>当前配色</strong><code>{token.value}</code></header><ColorDemo key={`${key}-before`} example={example} values={base} locate={locate} interactive plain={plain}/></section><section><header><strong>试配后 {target!==key&&!error?'· 已替换':'· 尚未替换'}</strong><code>{after[token.key]}</code></header><ColorDemo key={`${key}-after`} example={example} values={after} locate={locate} interactive plain={plain}/></section></div>
      <div className="color-target-caption">↳ 这项颜色控制：<strong>{example.target}</strong>。可以在示例里点击按钮、输入文字或切换状态，不会执行真实业务。</div>
      <div className="color-merge-controls">{example.kind==='unused'?<><div><strong>未检出产品引用，可直接列为删除候选。</strong><p>此处展示假设用法；删除候选不会立即移除色板项。</p></div><button className="color-apply" onClick={()=>removeUnused(token.key)}>{review.removed.includes(token.key)?'撤回删除候选':'标记为删除候选'}</button></>:<><label htmlFor="color-merge-target">把「{token.name}」试换成<select id="color-merge-target" value={target} onChange={e=>{setTarget(e.target.value);setMessage('');}}><option value={token.key}>保留原色</option>{[...new Set(palette.colors.map(c=>c.group))].map(g=><optgroup key={g} label={g}>{palette.colors.filter(c=>c.group===g&&c.key!==token.key&&exampleOf(c.key).kind!=='unused').map(c=><option key={c.key} value={c.key}>{c.name} · {c.value}</option>)}</optgroup>)}</select></label><button className="color-apply" disabled={!!error || target===key&&!review.plan[token.key]} onClick={()=>{setReview({...review,plan:trialPlan});setMessage(target===key?'已撤回这组试配。':'已保留这组试配，产品没有修改。');}}><Check size={15}/>{target===key?'撤回这组试配':'保留这组试配'}</button></>}
      </div>
      {error?<p className="color-merge-notice" role="alert">{error}</p>:<p className="color-merge-notice">{example.kind==='unused'?'删除这项预留用途不会改变当前组件。':same?'这两项本来就是同色：统一名称不会再减少色值。若以后可能分别调整，可保留不同用途名。':target!==key?`这组试配后，界面不同色值预计为 ${count(after)} 个；用途名称仍保留，方便撤回和适配亮色。`:'选择一个替代色后，右侧场景立即更新。先比较视觉，再决定是否合并。'}</p>}
      {example.note&&<p className="color-example-note">{example.note}</p>}
      {beforeRatio!==null&&afterRatio!==null&&<div className="color-example-ratio"><span>本示例文字对比度：{beforeRatio.toFixed(2)} → {afterRatio.toFixed(2)}</span><strong data-warning={afterRatio<4.5||undefined}>{afterRatio<4.5?'试配后文字可能不够清晰':'达到普通文字参考值'}</strong><small>按示例所展示的配色状态计算；临时悬停变化不计入，不代表全系统验收。</small></div>}
      {target!==key&&!error&&example.kind!=='unused'&&<details className="color-target-example"><summary>看看替代色原本用在哪：{nameOf(target)}</summary><ColorDemo example={exampleOf(target)} values={base} mini/><p>↳ {exampleOf(target).target}</p></details>}
      <details className="color-source-details"><summary>查看实际样式依据与其他引用（{uses.length} 处 CSS 直接或别名引用）</summary>{example.source&&<div><strong>本示例对应</strong><code>{example.source.file}:{example.source.line}</code><code>{example.source.selector}</code><code>{example.source.property}: {example.source.value}</code></div>}<div className="color-source-list">{uses.map((use,i)=><div key={i}><code>{use.file}:{use.line}</code><span>{use.selector}</span><small>{use.property}: {use.value}</small></div>)}</div></details>
    </>}</DialogContent></Dialog>
    {message&&<output className="color-review-toast">{message}<button aria-label="关闭配色提示" onClick={()=>setMessage('')}><X size={14}/></button></output>}
  </>;
}
