import { useState, type CSSProperties } from 'react';
import { ArrowUp, BookOpen, Check, ChevronDown, Copy, FileText, Image, Layers, MoreHorizontal, Pencil, Plus, RotateCcw, Search, Trash2, Video, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import examples from './color-examples.json';
import type { ColorValues } from './color-merge';
import './color-demos.css';

export type ColorExample = typeof examples[number];
const cssProperty = (name:string) => name.replace(/-([a-z])/g,(_,letter:string)=>letter.toUpperCase());
export function ColorDemo({example,values,mini=false,locate=false,interactive=false,plain=false}:{example:ColorExample;values:ColorValues;mini?:boolean;locate?:boolean;interactive?:boolean;plain?:boolean}) {
  const [checked,setChecked]=useState(false),[stage,setStage]=useState(example.key==='fill-hover'?'定题':'读文献'),[done,setDone]=useState(false);
  const key=example.key;
  const variables=Object.fromEntries(Object.entries(values).map(([name,value])=>[`--ui-${name}`,value])) as CSSProperties;
  const keyStyle=()=>{
    const source=example.source;
    if(!source)return {background:'var(--ui-success-soft)'};
    if(source.property.startsWith('--'))return {[['glass','control-raised','brand'].includes(key)?'background':'color']:source.value};
    return {[cssProperty(source.property)]:source.value};
  };
  const target=(extra:CSSProperties={})=>({'data-demo-target':key,style:{...(!plain?keyStyle():{}),...extra} as CSSProperties});
  const iconProps={size:16,strokeWidth:1.7};
  const basicNote=<><small><FileText {...iconProps}/> 研究笔记</small><h4>让研究问题变得具体</h4><p>记录事实，整理证据，再确认下一步。</p></>;
  const backdrop=<div className="cd-backdrop-board"><aside>我的论文<br/><br/>文献资料<br/><br/>研究笔记</aside><div><article>访谈记录<br/><span>整理核心发现与下一步。</span></article><article>待核对的证据</article></div></div>;
  let content;
  switch(example.scene) {
    case 'workspace':content=<div className="cd-workspace" {...(key==='canvas'?target():{})}><div className="cd-canvas-label">画板 · 我的论文</div><article className="cd-note" {...(key==='surface'?target():key==='brand-line'?target({borderWidth:1,borderStyle:'solid'}):{})}>{basicNote}</article></div>;break;
    case 'dialog':content=<div className="cd-layer-scene">{backdrop}<section className="cd-dialog" {...target()}><strong>论文项目</strong><X size={15}/><p>这一画板对应一篇论文。</p><div className="cd-dialog-actions"><button type="button" onClick={()=>setDone(!done)}>{done?'已打开':'打开选题卡'}</button><button type="button" onClick={()=>setDone(false)}>完成</button></div></section></div>;break;
    case 'toolbar':content=<div className="cd-toolbar-scene"><p>将这些<span>重要发现</span>整理为笔记。</p><div className="cd-toolbar" {...(key!=='control-hover'?target():{})}><button type="button" {...(key==='control-hover'?target():{})} onClick={()=>setDone(!done)}><Copy {...iconProps}/>{done?'已复制':'复制'}</button><i/><button type="button" onClick={()=>setDone(!done)}><Plus {...iconProps}/>新建笔记</button><button type="button" aria-label="更多示例操作"><MoreHorizontal {...iconProps}/></button></div><small>选中文字后出现的浮动工具条</small></div>;break;
    case 'button':content=<div className="cd-centered"><small>保存选题卡的修改</small><Button data-demo-target={key} variant="secondary" onClick={()=>setDone(!done)}><Pencil/>{done?'已完成（演示）':'编辑内容'}</Button><span>可点击查看状态，不会保存资料</span></div>;break;
    case 'progress':content=<div className="cd-centered"><strong>正在下载更新</strong><progress className="cd-progress" data-demo-target={key} aria-label="示例下载进度" max={100} value={60}/><small>60% · 品牌色用于进度反馈</small></div>;break;
    case 'composer':content=<div className="cd-layer-scene cd-composer-scene">{backdrop}<div className="cd-composer" {...target()}><textarea aria-label="示例输入框" placeholder="继续追问，或回答 AI 的问题…" readOnly={!interactive}/><div><Plus {...iconProps}/><button type="button">/ 研究助手 <ChevronDown size={12}/></button><span/><button type="button">Auto</button><button className="cd-send" type="button" aria-label="示例发送" onClick={()=>setDone(!done)}>{done?<Check size={15}/>:<ArrowUp size={15}/>}</button></div></div></div>;break;
    case 'reading':content=<article className="cd-reading"><header><BookOpen {...iconProps}/><span>{key==='text-muted'?'对话':'引用预览'}</span><small {...(key==='text-muted'?target():{})}>{key==='text-muted'?'2 轮':'来自研究笔记'}</small></header><h4 {...(key==='text'?target():{})}>让研究问题变得具体</h4><p {...(key==='text-secondary'?target():{})}>从你熟悉的一件工作开始，记录发生了什么。</p><span className="cd-reading-meta">选题卡 · 最近更新</span></article>;break;
    case 'disabled':content=<div className="cd-centered"><div className="cd-button-pair"><button type="button"><RotateCcw {...iconProps}/>撤销</button><button type="button" aria-disabled="true" {...target()}><RotateCcw {...iconProps}/>重做</button></div><small>没有下一步记录时，重做不可用。</small></div>;break;
    case 'save':content=<div className="cd-centered"><p>已整理出 3 个研究要点。</p><button type="button" className="cd-save" {...target()} onClick={()=>setDone(!done)}><Plus {...iconProps}/>{done?'已生成示例':'新建笔记'}</button><small>AI 回答后的保存入口</small></div>;break;
    case 'mask':content=<div className="cd-mask-scene"><div className="cd-mask-content" {...target()}><p>上一个问题的回答…</p><p>研究对象和问题范围已经确认。</p><p>下一步，核对可获得的数据。</p><p>更多对话内容…</p></div><small>渐隐区 · 顶部滚动边缘</small></div>;break;
    case 'history':content=<div className="cd-history"><div className="cd-history-tabs" {...target()}><strong>最近对话</strong><span>操作记录</span></div><p><FileText {...iconProps}/>选题讨论 <small>刚刚</small></p><p><FileText {...iconProps}/>读取文献 <small>昨天</small></p></div>;break;
    case 'drop':content=<div className="cd-centered"><article className="cd-drop" {...target()}><FileText {...iconProps}/><div><strong>文献中的关键发现</strong><small>松手放入画板</small></div><Plus {...iconProps}/></article><small>拖动引用卡片时的可放入状态</small></div>;break;
    case 'receipt':content=<div className="cd-centered"><div className="cd-receipt" {...target()}><Check size={18}/><div><strong>已整理 7 张卡片</strong><small>布局已更新</small></div><button type="button" onClick={()=>setDone(!done)}>{done?'已撤销':'撤销'}</button></div></div>;break;
    case 'stage':content=<div className="cd-stage-scene"><strong>论文阶段</strong><div className="cd-stages">{['定题','读文献','综述'].map((name,i)=><button key={name} type="button" onClick={()=>setStage(name)} className={stage===name?'is-current':''} {...(((key==='fill-hover'&&i===1)||(key==='fill-selected'&&stage===name))?target():{})}>{i===0?<Check size={13}/>:<i {...(i===1 && ['success','warning'].includes(key)?target():{})} style={{...((i===1 && ['success','warning'].includes(key))?target().style:{}),...(i===2?{background:'var(--ui-warning)'}:{})}}/>}{name}</button>)}</div><p>{['fill-hover','fill-selected'].includes(key)?(plain?'默认底色':key==='fill-hover'?'显示「读文献」悬停时的底色':'显示当前阶段的选中底色'):key==='success'?'绿色小点：进行中':'黄色小点：需要补充或复核'}</p></div>;break;
    case 'switch':content=<div className="cd-centered"><div className="cd-setting"><span>显示封面</span><button role="switch" aria-checked={checked} aria-label="示例显示封面" className="cd-switch" type="button" {...(!checked?target():{})} onClick={()=>setChecked(!checked)}><i/></button></div><small>关闭时看底色，点击可切换。</small></div>;break;
    case 'overlay':content=<div className="cd-layer-scene">{backdrop}<div className={`cd-overlay ${key==='overlay'?'is-blurred':''}`} {...target()}/>{key==='overlay-heavy'?<div className="cd-image-preview"><Image size={30}/><span>图片内容</span></div>:<section className="cd-dialog"><strong>保存更改？</strong><X size={15}/><p>背景变暗，视线集中在弹窗。</p><button type="button" onClick={()=>setDone(!done)}>{done?'已保存（演示）':'保存'}</button></section>}</div>;break;
    case 'excerpt':content=<div className="cd-excerpt"><small>原文定位</small><p>研究首先需要明确对象，</p><p {...target()}>再围绕具体问题收集证据。</p><p>结论应回应最初的问题。</p></div>;break;
    case 'delete':content=<div className="cd-delete"><strong>将论文画板移入回收站？</strong><p>画板和论文状态可以在保留期内恢复。</p><div><button type="button" onClick={()=>setDone(false)}>保留画板</button><button type="button" className={key==='danger-fill'&&!plain?'is-hot':''} {...target()} onClick={()=>setDone(!done)}><Trash2 size={14}/>{done?'已演示':'继续删除'}</button></div><small>仅演示，不删除任何内容</small></div>;break;
    case 'error':content=<div className="cd-centered"><div className="cd-error" {...target()}><span>!</span><div><strong>未能保存这条对话</strong><p>请稍后重试。</p></div></div></div>;break;
    case 'success':content=<div className="cd-centered"><div className="cd-success" {...target()}><Check size={18}/><span>资料已保存</span></div><small>预留色的假设示例 · 当前产品未使用</small></div>;break;
    case 'warning':content=<div className="cd-centered"><div className="cd-warning" {...target()}><span>!</span><div><strong>还需要补充资料</strong><p>请先上传文献或填写研究背景。</p></div></div></div>;break;
    case 'origin':content=<article className="cd-reading"><h4>访谈资料摘要</h4><p>整理了 3 个值得继续研究的问题。</p><span className="cd-origin" {...target()}><Layers size={13}/>由 AI 整理</span></article>;break;
    case 'files':content=<div className="cd-files">{[{key:'literature',name:'参考文献.pdf',Icon:FileText},{key:'note',name:'研究笔记',Icon:Pencil},{key:'board',name:'我的论文',Icon:Layers},{key:'video',name:'访谈记录.mp4',Icon:Video}].map(({key:role,name,Icon})=><div key={role}><span {...(role===key?target():{})} style={{color:`var(--ui-${role})`,...(role===key?target().style:{})}}><Icon {...iconProps}/></span><span>{name}</span><MoreHorizontal size={14}/></div>)}</div>;break;
    case 'filter':content=<div className="cd-filter-scene"><header><strong>文献资料</strong><Search size={16}/></header><button type="button" className="cd-filter" {...target()} onClick={()=>setDone(!done)}>筛选 · {done?'待阅读':'已阅读'}<ChevronDown size={13}/></button><div className="cd-table-row"><FileText size={14}/>管理研究中的方法选择</div><small>多维表中已启用的条件</small></div>;break;
    default:content=<span>暂无示例</span>;
  }
  return <div className="color-demo" data-scene={example.scene} data-token={key} data-mini={mini||undefined} data-locate={locate||undefined} data-interactive={interactive||undefined} style={variables} aria-label={`${example.location}：${example.target}`}><div className="cd-scene-body" inert={!interactive}>{content}</div></div>;
}
