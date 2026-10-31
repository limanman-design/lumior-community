import { useMemo, useState, type CSSProperties, type ReactNode } from 'react';
import { ArrowRight, ArrowUp, Check, ChevronDown, Copy, FileText, Image, Layers, LayoutGrid, ListChecks, Menu, Moon, MoreHorizontal, Palette as PaletteIcon, Pencil, Plus, Search, Settings, Square, Sun, Trash2, Video, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Checkbox } from '@/components/ui/checkbox';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Dialog, DialogContent, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { ThesisDeleteDialog } from '@/app/thesis-board-controls';
import audit from './generated/audit.json';
import { PaletteLibrary } from './color-library';
import { tokens, defaultPalette, issues, type Palette, type Theme, type TokenKey } from './reference';
import { contrast } from './color-utils';
import '@/app/globals.css';
import './generated/production-samples.css';
import './catalog.css';

type Page = 'palette' | 'overview' | 'components' | 'colors' | 'review' | 'themes' | 'inventory';
const navigation: {id:Page; name:string; icon:typeof PaletteIcon}[] = [
  {id:'palette',name:'44 项规范色',icon:PaletteIcon},
  {id:'overview',name:'系统总览',icon:LayoutGrid}, {id:'components',name:'组件与状态',icon:Layers},
  {id:'colors',name:'颜色用在哪里',icon:PaletteIcon}, {id:'review',name:'规范检查',icon:ListChecks},
  {id:'themes',name:'明暗色方案',icon:Sun}, {id:'inventory',name:'全量模块清单',icon:Menu},
];
const componentNames: Record<string,string> = {button:'按钮',input:'单行输入',textarea:'多行输入',checkbox:'复选框',switch:'开关',badge:'标签',tabs:'页签',tooltip:'提示', 'dropdown-menu':'下拉菜单',dialog:'弹窗', 'thesis-board-controls':'论文阶段与删除提醒'};
const cssPalette = (palette: Palette) => Object.fromEntries(Object.entries(palette).map(([key, value])=>[`--ds-${key}`,value])) as CSSProperties;
function Source({children}:{children:ReactNode}) { return <code className="catalog-source">{children}</code>; }
function Specimen({title,source,children,kind='源组件',note}:{title:string;source:string;children:ReactNode;kind?:string;note?:string}) {
  return <section className="specimen"><div className="specimen-title"><h3>{title}</h3><span>{kind}</span></div><div className="specimen-body">{children}</div>{note && <p className="specimen-note">{note}</p>}<Source>{source}</Source></section>;
}
function Ratio({foreground,background,label}:{foreground:string;background:string;label:string}) {
  const value=contrast(foreground,background),passes=value>=4.5;
  return <div className="ratio-line"><span>{label}</span><strong className={passes?'ratio-pass':'ratio-attention'}>{value.toFixed(2)}:1 · {passes?'达到文字参考值':'需关注'}</strong></div>;
}
function ThemeScene({palette,theme,inspect,onInspect}:{palette:Palette;theme:Theme;inspect:boolean;onInspect:(key:TokenKey)=>void}) {
  const [stage,setStage]=useState('定题'),[selected,setSelected]=useState(true),[draft,setDraft]=useState(''),[running,setRunning]=useState(false);
  const inspectStyle=()=>inspect?{outline:'1px dashed var(--ds-focus)',outlineOffset:'3px'}:{};
  return <div className="ds-scene" data-theme={theme} style={cssPalette(palette)}>
    <div className="ds-top"><span><Layers size={16}/> 开题报告</span><span className="ds-secondary">Lumior · 方案预览</span><button aria-label="预览设置" onClick={()=>onInspect('control')}><Settings size={16}/></button></div>
    <div className="ds-scene-body">
      <nav className="ds-nav" aria-label={`${theme} 场景导航`}>
        <strong>资料库</strong><button className="is-selected" onClick={()=>onInspect('selected')}><Layers size={16} style={{color:palette.board}}/>我的论文</button><button onClick={()=>onInspect('literature')}><FileText size={16} style={{color:palette.literature}}/>研究文献</button><button onClick={()=>onInspect('note')}><Pencil size={16} style={{color:palette.note}}/>研究笔记</button><button onClick={()=>onInspect('video')}><Video size={16} style={{color:palette.video}}/>访谈视频</button><button onClick={()=>onInspect('image')}><Image size={16} style={{color:palette.image}}/>参考图片</button>
        <div className="ds-nav-bottom"><button className="ds-danger-menu" onClick={()=>onInspect('danger')}><Trash2 size={16}/>移入回收站</button></div>
      </nav>
      <div className="ds-canvas" style={inspectStyle()}>
        {inspect&&<button className="ds-inspect-label" onClick={()=>onInspect('canvas')}>查看画布底色</button>}
        <fieldset className="ds-stage"><legend className="catalog-sr-only">{theme} 论文阶段</legend>
          {['定题','读文献','文献综述','开题报告'].map((item,i)=><button key={item} aria-pressed={stage===item} onClick={()=>{setStage(item);if(inspect)onInspect('selected');}}>{item}{i===0?<Check size={12}/>:<i style={{background:i===1?palette.success:i===2?palette.warning:palette.muted}}/>}</button>)}
        </fieldset>
        <div className="ds-card-pair">
          <article className={`ds-note ${selected?'is-selected':''}`} style={inspectStyle()}>
            <button className="ds-card-label" aria-pressed={selected} onClick={()=>{setSelected(!selected);if(inspect)onInspect('focus');}}><FileText size={14}/>选题卡 · v2 <Check size={13}/></button>
            <h3>让研究问题变得具体</h3><p>在已有证据上，确认研究对象、问题范围与可获得的数据。</p><div className="ds-tag">待文献验证</div><hr/><span className="ds-secondary">已保留修改历史</span>
          </article>
          <article className="ds-note ds-small-note" style={inspectStyle()}><button className="ds-card-label" onClick={()=>onInspect('border')}><FileText size={14} style={{color:palette.literature}}/>论文文献</button><h3>文献阅读进度</h3><p>已读 5 篇 · 5 篇待处理</p><div className="ds-progress"><span/></div><div className="ds-secondary">下一批继续读取未处理文献</div></article>
        </div>
        <div className="ds-composer" style={inspectStyle()}>
          <label className="catalog-sr-only" htmlFor={`draft-${theme}`}>方案预览输入框</label><textarea id={`draft-${theme}`} value={draft} onChange={e=>setDraft(e.target.value)} placeholder="继续追问，或回答 AI 的问题…"/>
          <div className="ds-composer-actions"><button aria-label="预览添加资料" onClick={()=>onInspect('text')}><Plus size={18}/></button><button className="is-selected" onClick={()=>onInspect('selected')}>/ MBA · {stage}<ChevronDown size={14}/></button><div className="ds-spacer"/><button className="is-selected" onClick={()=>onInspect('selected')}>Kimi</button><button className="ds-send" aria-label={running?'预览停止':'预览发送'} onClick={()=>setRunning(!running)}>{running?<Square size={14} fill="currentColor"/>:<ArrowUp size={18}/>}</button></div>
        </div>
      </div>
    </div>
    <div className="ds-action-examples"><span>按钮示例</span><button className="ds-primary" onClick={()=>onInspect('primary')}>主要操作</button><button className="ds-secondary-button" onClick={()=>onInspect('control')}>次要操作</button><button className="ds-delete-button" onClick={()=>onInspect('dangerFill')}>确认删除</button><span className="ds-error-example" style={{color:palette.error}}>错误提示</span></div>
  </div>;
}
export default function App(){
  const [page,setPage]=useState<Page>('palette'),[query,setQuery]=useState(''),[module,setModule]=useState('全部模块');
  const [color,setColor]=useState<string|null>(null),[colorLimit,setColorLimit]=useState(48),[inspect,setInspect]=useState(false);
  const [theme,setTheme]=useState<Theme>('dark'),[palettes,setPalettes]=useState({dark:defaultPalette('dark'),light:defaultPalette('light')}),[activeToken,setActiveToken]=useState<TokenKey>('surface');
  const [deleteRequest,setDeleteRequest]=useState<{titles:string[];consequence:string;wholeBoard:boolean}|null>(null),[message,setMessage]=useState('');
  const [reviewed,setReviewed]=useState<string[]>([]);
  const [showVariables,setShowVariables]=useState(false);
  const palette=palettes[theme],active=tokens.find(item=>item.key===activeToken)!;
  const filteredColors=useMemo(()=>audit.colors.filter(item=>(!query||`${item.color} ${item.uses.map(use=>`${use.module} ${use.file} ${use.selector} ${use.property}`).join(' ')}`.toLowerCase().includes(query.toLowerCase()))&&(module==='全部模块'||item.uses.some(use=>use.module===module))),[query,module]);
  const colorEntry=audit.colors.find(item=>item.color===color);
  const go=(id:Page)=>{setPage(id);setQuery('');setModule('全部模块');setColorLimit(48);window.scrollTo({top:0,behavior:'auto'});};
  const showUses=(value:string)=>{setColor(value);};
  const exportPlan=()=>{
    const body={format:'lumior-color-review-v1',exportedAt:new Date().toISOString(),appliedToProduct:false,palettes,reviewedIssues:reviewed,sourceAuditGeneratedAt:audit.generatedAt};
    const link=document.createElement('a'),url=URL.createObjectURL(new Blob([JSON.stringify(body,null,2)],{type:'application/json'}));
    link.href=url;link.download='lumior-color-review.json';link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);setMessage('本次配色方案已导出；产品样式未修改。');
  };
  return <TooltipProvider><div className="catalog-shell">
    <aside className="catalog-sidebar"><div className="catalog-brand"><span className="brand-mark"><Layers size={21}/></span><span>lumior <small>设计审查台</small></span></div><div className="catalog-version">01 / 当前系统 · 2026.10</div>
      <nav aria-label="组件库导航">{navigation.map(item=><button key={item.id} aria-current={page===item.id?'page':undefined} onClick={()=>go(item.id)}><item.icon size={18}/>{item.name}{item.id==='review'&&<span>{issues.length}</span>}</button>)}</nav>
      <div className="catalog-side-footer"><span className="catalog-live-dot"/>本地审查版<p>44 项色板已接入本地源码。手动调色只影响预览。</p><button onClick={exportPlan}><Copy size={14}/>导出明暗配色</button></div>
    </aside>
    <main className="catalog-main">
      <header className="catalog-header"><div className="catalog-breadcrumb">LUMIOR / DESIGN SYSTEM <span>基础与界面的一致性</span></div><div className="catalog-status">现状与方案分开展示</div></header>
      <div className="catalog-content"><div className="catalog-page-title"><div><p className="catalog-eyebrow">{navigation.find(item=>item.id===page)?.id.toUpperCase()}</p><h1>{navigation.find(item=>item.id===page)?.name}</h1></div>{page==='themes'&&<div className="catalog-switcher" aria-label="方案主题">{(['dark','light'] as const).map(value=><button key={value} aria-pressed={theme===value} onClick={()=>setTheme(value)}>{value==='dark'?<Moon size={16}/>:<Sun size={16}/>} {value==='dark'?'暗色':'亮色'}</button>)}</div>}</div>
      {page==='palette'&&<PaletteLibrary/>}
      {page==='overview'&&<>
        <p className="catalog-lede">把颜色放回它使用的界面里，先看清现状，再一起决定规范。</p>
        <div className="catalog-hero"><div><span className="catalog-tag">第一版 · 可审查</span><h2>一套组件语义，<br/>两种清晰的明暗表达。</h2><p>源码组件用于核对现在；场景预览用于讨论下一步。颜色值、使用位置、已知偏差都可以逐项查看。</p><button className="catalog-primary" onClick={()=>go('themes')}>看明暗色方案 <ArrowRight size={16}/></button></div><div className="hero-surfaces"><div className="surface-stack layer-one">画布<span>#101010</span></div><div className="surface-stack layer-two">卡片<span>#191919</span></div><div className="surface-stack layer-three">浮层<span>#232323</span><i>文字 · 边框 · 交互</i></div></div></div>
        <div className="catalog-stats">{[[audit.stats.cssFiles,'自有 CSS 文件'],[audit.stats.componentFiles,'组件 / 页面源文件'],[audit.stats.colorSpellings,'颜色写法'],[issues.length,'人工标注的检查项']].map(([value,label])=><div key={label}><strong>{value}</strong><span>{label}</span></div>)}</div>
        <div className="catalog-callout"><strong>计数不等于违规。</strong> 包含变量定义、回退色、独立预览以及内容颜色；不将用户高亮、PDF、图片或品牌色批量替换。</div>
        <div className="catalog-section-heading"><h2>从使用场景开始</h2><button onClick={()=>go('inventory')}>查看完整清单 <ArrowRight size={14}/></button></div>
        <div className="module-grid">{audit.modules.filter(item=>item.name!=='独立预览').slice(0,8).map(item=><button key={item.name} onClick={()=>{go('colors');setModule(item.name);}}><span className="module-icon"><Layers size={18}/></span><h3>{item.name}</h3><p>{item.files.length} 个源文件 · {item.colorCount} 处色值</p><ArrowRight size={15}/></button>)}</div>
        <div className="catalog-section-heading"><h2>已确认的基础规则</h2></div><div className="rule-grid"><div><strong>24 → 8</strong><p>24px 按钮使用 8px 圆角</p></div><div><strong>28 / 32 → 12</strong><p>28px、32px 按钮使用 12px 圆角</p></div><div><strong>白色 10%</strong><p>暗色主题选中底色；亮色另做映射</p></div><div><strong>图标 = 文字</strong><p>交互颜色同步；特殊品牌图标除外</p></div></div>
        <p className="catalog-footnote">这一版是组件图鉴与规范审查入口，尚未把所有业务控件重构为统一组件。现状扫描覆盖自有 CSS / TSX；交互展示覆盖常用基础组件及论文删除提醒。</p>
      </>}
      {page==='components'&&<>
        <p className="catalog-lede">下面直接引用项目组件。可点击、输入、切换、打开菜单，检查默认、选中、禁用与焦点状态。</p>
        <div className="specimen-grid">
          <Specimen title="按钮 · 层级" source="components/ui/button.tsx" note="主操作在暗色为白底深字；亮色方案为近黑底白字。荧光绿保留给品牌强调、进度与选中描边。"><div className="sample-row"><Button>主要操作</Button><Button variant="secondary">次要操作</Button><Button variant="outline">描边</Button><Button variant="ghost">轻操作</Button></div><div className="sample-row"><Button variant="destructive"><Trash2/>删除</Button><Button disabled>不可用</Button><Button variant="link">文字链接</Button></div></Specimen>
          <Specimen title="按钮 · 尺寸与图标" source="components/ui/button.tsx" note="已实测：24px 对应 8px 圆角，28px / 32px 对应 12px，符合已确认规范。"><div className="sample-row"><Button size="xs" variant="secondary">24px</Button><Button size="sm" variant="secondary">28px</Button><Button variant="secondary">32px</Button><Button variant="secondary" size="icon-xs" aria-label="24px 添加"><Plus/></Button><Button variant="secondary" size="icon-sm" aria-label="28px 添加"><Plus/></Button><Button variant="secondary" size="icon" aria-label="32px 添加"><Plus/></Button></div></Specimen>
          <Specimen title="输入框" source="components/ui/input.tsx / textarea.tsx"><Input aria-label="正常输入示例" placeholder="输入研究主题…"/><Input aria-label="错误输入示例" aria-invalid defaultValue="需要核对的输入"/><Input aria-label="禁用输入示例" disabled placeholder="暂不可用"/><Textarea aria-label="多行输入示例" placeholder="用自己的话描述研究想法…"/></Specimen>
          <Specimen title="选择与开关" source="components/ui/checkbox.tsx / switch.tsx"><label className="sample-row" htmlFor="sample-checked"><Checkbox id="sample-checked" defaultChecked/>已选择</label><label className="sample-row" htmlFor="sample-unchecked"><Checkbox id="sample-unchecked"/>未选择</label><label className="sample-row" htmlFor="sample-disabled"><Checkbox id="sample-disabled" disabled/>不可用</label><label className="sample-row" htmlFor="sample-preview"><Switch id="sample-preview" defaultChecked/>显示卡片预览</label><label className="sample-row" htmlFor="sample-expand"><Switch id="sample-expand"/>自动展开对话</label></Specimen>
          <Specimen title="标签与状态" source="components/ui/badge.tsx"><div className="sample-row"><Badge>主色标签</Badge><Badge variant="secondary">普通标签</Badge><Badge variant="outline">描边标签</Badge><Badge variant="destructive">错误提示</Badge></div><p className="catalog-muted">业务状态点另见论文阶段，内容类型色另见颜色映射。</p></Specimen>
          <Specimen title="页签" source="components/ui/tabs.tsx"><Tabs defaultValue="first"><TabsList><TabsTrigger value="first">文献</TabsTrigger><TabsTrigger value="second">笔记</TabsTrigger><TabsTrigger value="third" disabled>待开放</TabsTrigger></TabsList><TabsContent value="first">文献内容预览</TabsContent><TabsContent value="second">笔记内容预览</TabsContent></Tabs></Specimen>
          <Specimen title="菜单 · 普通与删除" source="components/ui/dropdown-menu.tsx + 生产菜单 CSS" note="菜单样式从现有源码抽取；删除项红字红图标，高亮使用中性底色。"><DropdownMenu><DropdownMenuTrigger render={<Button variant="secondary"><MoreHorizontal/>打开画板菜单</Button>}/><DropdownMenuContent className="lumior-menu"><DropdownMenuItem onClick={()=>setMessage('这是重命名演示。')}><Pencil/>重命名</DropdownMenuItem><DropdownMenuItem onClick={()=>setMessage('这是移动演示。')}><Layers/>移动到…</DropdownMenuItem><DropdownMenuSeparator/><DropdownMenuItem variant="destructive" onClick={()=>setDeleteRequest({titles:['示例论文画板'],consequence:'画板及论文状态将移入回收站，可在保留期内恢复。此处仅演示，不会删除数据。',wholeBoard:true})}><Trash2/>移入回收站</DropdownMenuItem></DropdownMenuContent></DropdownMenu></Specimen>
          <Specimen title="提醒 · 一次确认" source="app/thesis-board-controls.tsx" note="直接使用当前论文画板删除提醒；确认只显示演示结果。"><Button variant="secondary" onClick={()=>setDeleteRequest({titles:['示例论文画板'],consequence:'画板及论文状态将移入回收站，可在保留期内恢复。此处仅演示，不会删除数据。',wholeBoard:true})}><Trash2/>打开论文删除提醒</Button></Specimen>
          <Specimen title="悬停提示" source="components/ui/tooltip.tsx"><Tooltip><TooltipTrigger render={<Button variant="secondary" aria-label="查看进度原因">悬停或聚焦查看原因</Button>}/><TooltipContent>选题已确认，可以开始整理文献。</TooltipContent></Tooltip></Specimen>
          <Specimen title="对话 · 资料与历史" source="app/thesis-board.css" kind="源码样式样本" note="MBA 使用普通画板；流程进度、资料用途和历史收进对话入口。"><div className="thesis-chat-tools"><button>资料与历史 · 2 项待处理</button></div></Specimen>
        </div><div className="catalog-callout">没有放进交互展示的组件仍列在“全量模块清单”。带业务状态的编辑器、PDF、完整多维表需要后续逐个补充场景验收，不能仅凭这张图鉴宣称全系统合规。</div>
      </>}
      {page==='colors'&&<>
        <p className="catalog-lede">点一个色块，看它在哪里出现、影响哪类元素。可按模块、色值或文件名搜索。</p>
        <div className="catalog-filter"><label className="catalog-search"><Search size={17}/><input aria-label="搜索颜色与使用位置" value={query} onChange={e=>{setQuery(e.target.value);setColorLimit(48);}} placeholder="#f4776b、AI、thesis、border…"/></label><select aria-label="按模块筛选颜色" value={module} onChange={e=>{setModule(e.target.value);setColorLimit(48);}}><option>全部模块</option>{audit.modules.map(item=><option key={item.name}>{item.name}</option>)}</select><button className={showVariables?'catalog-active':''} onClick={()=>setShowVariables(!showVariables)}>{showVariables?'查看色值':'查看现有变量'}</button></div>
        {!showVariables?<><div className="catalog-results">找到 {filteredColors.length} 种颜色写法 · 点击可展开实际位置</div><div className="swatch-grid">{filteredColors.slice(0,colorLimit).map(item=><button key={item.color} className="swatch-card" onClick={()=>showUses(item.color)}><div className="swatch-checker"><span style={{background:item.color}}/></div><code>{item.color}</code><span>{item.uses.length} 处 · {[...new Set(item.uses.map(use=>use.module))].slice(0,2).join(' / ')}</span></button>)}</div>{filteredColors.length>colorLimit&&<button className="catalog-load-more" onClick={()=>setColorLimit(colorLimit+48)}>再显示 48 种</button>}</>:<div className="variable-list">{audit.variables.filter(item=>(!query||`${item.name} ${item.definitions.map(d=>d.value).join(' ')}`.includes(query))&&(module==='全部模块'||[...item.definitions,...item.uses].some(use=>use.module===module))).map(item=><details key={item.name}><summary><code>{item.name}</code><span>{item.definitions.length} 处定义 · {item.uses.length} 处引用</span></summary>{item.definitions.map((entry,i)=><div className="source-row" key={i}><Source>{entry.file}:{entry.line}</Source><code>{entry.selector} → {entry.value}</code></div>)}{item.uses.slice(0,12).map((entry,i)=><div className="source-row" key={`use-${i}`}><Source>{entry.file}:{entry.line}</Source><code>{entry.selector} · {entry.property}</code></div>)}{item.uses.length>12&&<p>另有 {item.uses.length-12} 处引用，完整记录保存在扫描数据中。</p>}</details>)}</div>}
        <p className="catalog-footnote">{audit.scope} 扫描时间：{new Date(audit.generatedAt).toLocaleString('zh-CN')}。RGBA、HEX 等不同写法分开列出，不假装它们是不同的设计色。</p>
      </>}
      {page==='review'&&<>
        <p className="catalog-lede">先处理有证据的偏差。标记“已看过”不会修改产品，也不代表已经修复。</p>
        <div className="issue-list">{issues.map((item,index)=><article className="issue" key={item.id}><span className="issue-number">0{index+1}</span><div><span className="catalog-tag">{item.level}</span><h2>{item.title}</h2><p>{item.detail}</p><div className="issue-proposal"><strong>调整方向</strong><p>{item.proposal}</p></div><div className="issue-sources">{item.files.map(file=><Source key={file}>{file}</Source>)}</div>{item.id==='danger-contrast'&&<div className="contrast-compare"><div style={{background:'#f4776b',color:'#fff'}}>调整前：继续删除<strong>{contrast('#ffffff','#f4776b').toFixed(2)}:1</strong></div><div style={{background:palettes.dark.dangerFill,color:'#fff'}}>已接入：继续删除<strong>{contrast('#ffffff',palettes.dark.dangerFill).toFixed(2)}:1</strong></div></div>}</div><label className="issue-reviewed"><input type="checkbox" checked={reviewed.includes(item.id)} onChange={e=>setReviewed(e.target.checked?[...reviewed,item.id]:reviewed.filter(id=>id!==item.id))}/>已看过</label></article>)}</div>
        <div className="catalog-callout">对比度参照 <a href="https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html" target="_blank" rel="noreferrer">WCAG 2.2 文字对比度</a>。这里只测明确的前景／背景配对；透明层先合成，不将数值达标等同于整套界面已通过无障碍验收。</div>
      </>}
      {page==='themes'&&<>
        <p className="catalog-lede">这是语义色方案，不是已完成的亮色产品。修改任一颜色，整个示意场景同步变化；暗色与亮色分别编辑。</p>
        <div className="theme-workbench"><div className="theme-stage"><div className="theme-stage-heading"><span>{theme==='dark'?'暗色':'亮色'} · 交互场景示意</span><label><input type="checkbox" checked={inspect} onChange={e=>setInspect(e.target.checked)}/>标出颜色用途</label></div><ThemeScene palette={palette} theme={theme} inspect={inspect} onInspect={setActiveToken}/><div className="theme-readability"><Ratio foreground={palette.text} background={palette.surface} label="正文 / 卡片"/><Ratio foreground={palette.muted} background={palette.surface} label="辅助文字 / 卡片"/><Ratio foreground={palette.onPrimary} background={palette.primary} label="主操作文字 / 按钮底色"/><Ratio foreground={palette.onDanger} background={palette.dangerFill} label="白字 / 危险按钮填充"/></div></div>
          <aside className="token-editor"><span className="catalog-eyebrow">COLOR ROLE</span><h2>{active.name}</h2><p>{active.usage}</p><div className="token-color" style={{background:palette[activeToken]}}/><label className="color-input-label">调整{theme==='dark'?'暗色':'亮色'}值<input aria-label={`调整${active.name}颜色`} type="color" value={palette[activeToken].slice(0,7)} onInput={e=>{const value=e.currentTarget.value+(palette[activeToken].length===9?palette[activeToken].slice(7):'');setPalettes({...palettes,[theme]:{...palette,[activeToken]:value}});}}/></label><code>{palette[activeToken]}</code><p className="token-rule">{active.rule}</p><Source>{active.source}</Source><button className="catalog-reset" onClick={()=>setPalettes({...palettes,[theme]:defaultPalette(theme)})}>恢复本主题建议值</button></aside>
        </div>
        <div className="catalog-section-heading"><h2>按用途定义颜色</h2><span>点击色块，在上方调整</span></div><div className="semantic-grid">{tokens.map(token=><button key={token.key} aria-label={token.name} aria-pressed={activeToken===token.key} onClick={()=>setActiveToken(token.key)}><i style={{background:palette[token.key]}}/><span><small>{token.group}</small><strong>{token.name}</strong><code>{palette[token.key]}</code></span></button>)}</div>
        <div className="catalog-callout"><strong>亮色适配的关键：</strong>同一个“选中背景”在暗色映射白色 10%，在亮色映射深色低透明度；同一个品牌色在填充、文字、焦点上允许不同明度。PDF、图片和用户自选颜色不随主题反转。</div>
      </>}
      {page==='inventory'&&<>
        <p className="catalog-lede">完整静态清单保留基础组件和业务模块。引用数是源码直接引用，不代表最终页面出现次数。</p>
        <div className="catalog-filter"><label className="catalog-search"><Search size={17}/><input aria-label="搜索组件清单" value={query} onChange={e=>setQuery(e.target.value)} placeholder="按钮、AI、pdf、database…"/></label><select aria-label="按模块筛选组件" value={module} onChange={e=>setModule(e.target.value)}><option>全部模块</option>{audit.modules.map(item=><option key={item.name}>{item.name}</option>)}</select></div>
        <div className="inventory-table"><table><thead><tr><th>组件 / 页面</th><th>模块</th><th>直接引用</th><th>源码位置</th></tr></thead><tbody>{audit.components.filter(item=>(module==='全部模块'||item.module===module)&&`${item.name} ${componentNames[item.name]||''} ${item.module} ${item.file}`.toLowerCase().includes(query.toLowerCase())).map(item=><tr key={item.file}><td><strong>{componentNames[item.name]||item.name}</strong><span>{item.kind}</span></td><td>{item.module}</td><td>{item.imports.length?`${item.imports.length} 个文件`:'未检出 / 入口文件'}</td><td><details><summary>{item.file}</summary>{item.imports.map(file=><Source key={file}>{file}</Source>)}</details></td></tr>)}</tbody></table></div>
        <p className="catalog-footnote">路由、动态加载、目录导出和类型引用可能不包含在直接引用数中。未检出不等于可以删除。第三方 vendor 未纳入自有组件清单。</p>
      </>}
      <footer className="catalog-footer">Lumior / UI foundations <span>现状可追溯 · 方案可讨论 · 变更分批应用</span></footer>
      </div>
    </main>
    <ThesisDeleteDialog request={deleteRequest} onCancel={()=>setDeleteRequest(null)} onConfirm={()=>{setDeleteRequest(null);setMessage('一次确认已完成。这是演示，没有删除任何画板。');}}/>
    <Dialog open={!!colorEntry} onOpenChange={open=>{if(!open)setColor(null);}}><DialogContent className="catalog-color-dialog"><DialogTitle>颜色 {colorEntry?.color}</DialogTitle><DialogDescription>{colorEntry?.uses.length} 处源码使用。下方列出模块、元素、属性和位置。</DialogDescription><div className="inspector-swatch" style={{background:colorEntry?.color}}/><div className="color-use-list">{colorEntry?.uses.map((entry,i)=><article key={i}><div><strong>{entry.module}</strong><span>{entry.kind}</span></div><Source>{entry.file}:{entry.line}</Source><code>{entry.selector}</code><p>{entry.property}: {entry.value}</p></article>)}</div></DialogContent></Dialog>
    {message&&<output className="catalog-toast">{message}<button aria-label="关闭反馈" onClick={()=>setMessage('')}><X size={15}/></button></output>}
  </div></TooltipProvider>;
}
