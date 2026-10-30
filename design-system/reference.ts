import uiPalette from './ui-palette.json';
export type Theme = 'dark' | 'light';
const sceneTokens = [
  { key:'canvas', name:'画布底色', group:'背景', dark:'#101010', light:'#f2f4ef', usage:'画布、空白工作区', source:'app/globals.css', rule:'不同于卡片表面；网格只作辅助。' },
  { key:'surface', name:'内容表面', group:'背景', dark:'#191919', light:'#ffffff', usage:'笔记卡片、阅读区、侧栏', source:'app/globals.css', rule:'深浅主题均保留层级，不反转 PDF 原文。' },
  { key:'raised', name:'浮层表面', group:'背景', dark:'#232323', light:'#ffffff', usage:'菜单、弹窗、AI 输入区', source:'app/globals.css', rule:'用边框与阴影区分浮层，不只靠亮度。' },
  { key:'control', name:'普通按钮底色', group:'背景', dark:'#28292a', light:'#e8ebe5', usage:'次要按钮、输入辅助控件', source:'app/globals.css', rule:'不承担“已选中”的含义。' },
  { key:'text', name:'主要文字', group:'文字', dark:'#eeeeee', light:'#20231d', usage:'正文、标题、重要图标', source:'app/globals.css', rule:'普通文字对比度参考 4.5:1。' },
  { key:'secondary', name:'次要文字', group:'文字', dark:'#b8b8b8', light:'#535b4d', usage:'说明、卡片来源、时间', source:'app/ai-canvas.css', rule:'需要阅读的信息不能用禁用色代替。' },
  { key:'muted', name:'辅助文字', group:'文字', dark:'#999999', light:'#697360', usage:'占位提示、未选中的辅助标签', source:'app/globals.css', rule:'按实际所在背景验证，不只看色值。' },
  { key:'border', name:'分隔与轮廓', group:'交互', dark:'#ffffff24', light:'#00000024', usage:'卡片边框、输入轮廓、分隔线', source:'app/globals.css', rule:'必要控件边界需要额外验证，装饰分隔线可弱化。' },
  { key:'hover', name:'悬停背景', group:'交互', dark:'#ffffff14', light:'#0000000f', usage:'侧栏、工具按钮、菜单行', source:'app/lumior.css', rule:'颜色改变伴随图标／文字同步变化。' },
  { key:'selected', name:'选中背景', group:'交互', dark:'#ffffff1a', light:'#00000014', usage:'助手、模型、论文当前阶段', source:'app/thesis-board.css', rule:'暗色沿用已确认的白色 10%；亮色使用对应深色覆盖。' },
  { key:'brand', name:'品牌主色', group:'动作', dark:'#b1f017', light:'#b1f017', usage:'品牌强调、选择描边、进度', source:'app/globals.css', rule:'荧光绿保留给品牌强调；不作为主操作按钮底色。' },
  { key:'primary', name:'主操作按钮底色', group:'动作', dark:'#ffffff', light:'#191919', usage:'主要操作按钮、发送与确认', source:'app/globals.css', rule:'暗色为白底，亮色为近黑底；与品牌主色分开。' },
  { key:'onPrimary', name:'主操作按钮文字', group:'动作', dark:'#191919', light:'#ffffff', usage:'主操作按钮上的文字和图标', source:'app/globals.css', rule:'暗色白底配深字；亮色近黑底配白字，图标跟随文字。' },
  { key:'focus', name:'焦点与主色文字', group:'动作', dark:'#b1f017', light:'#526f00', usage:'键盘焦点、亮色下主色文字', source:'app/globals.css', rule:'亮色下另给较深的绿，避免荧光绿文字看不清。' },
  { key:'danger', name:'危险操作文字', group:'状态', dark:'#f4776b', light:'#ae3328', usage:'删除菜单、删除提醒', source:'app/board-chrome.css', rule:'菜单用红字与中性 hover；不等同于红底按钮。' },
  { key:'dangerFill', name:'危险按钮填充', group:'状态', dark:'#b73f34', light:'#b73f34', usage:'确认删除的高亮填充', source:'app/thesis-board.css', rule:'比危险文字色更深，配白字；本色已应用本地产品源码。' },
  { key:'onDanger', name:'危险实底文字', group:'状态', dark:'#ffffff', light:'#ffffff', usage:'危险实底按钮上的文字和图标', source:'app/thesis-board.css', rule:'与危险填充配对验证；不是删除菜单的红字。' },
  { key:'success', name:'进行中／成功', group:'状态', dark:'#87cf75', light:'#2f7023', usage:'论文进行中、成功反馈', source:'app/thesis-board.css', rule:'配状态文案或图形，不能只用颜色。' },
  { key:'warning', name:'需要关注', group:'状态', dark:'#e5b35d', light:'#865800', usage:'需复核、待补资料', source:'app/thesis-board.css', rule:'已有成果仍用勾；说明具体原因。' },
  { key:'error', name:'错误／受阻', group:'状态', dark:'#ee7d79', light:'#ae3328', usage:'失败、缺失必要材料', source:'app/thesis-board.css', rule:'错误反馈与“删除动作”语义分开。' },
  { key:'literature', name:'文献类型', group:'内容', dark:'#b3de3e', light:'#4c650d', usage:'PDF／论文文献类型图标', source:'app/content-type-colors.css', rule:'内容类型不代表操作状态；亮色下使用深一档。' },
  { key:'note', name:'笔记类型', group:'内容', dark:'#9a9ef8', light:'#5259e2', usage:'NotePage 类型图标', source:'app/content-type-colors.css', rule:'暗色已提亮，内容中用户选择的紫色保持原样。' },
  { key:'board', name:'画板类型', group:'内容', dark:'#c4a5ed', light:'#7043a6', usage:'画板类型图标', source:'app/content-type-colors.css', rule:'与论文阶段的黄／红状态分开。' },
  { key:'video', name:'视频类型', group:'内容', dark:'#f5be92', light:'#98521f', usage:'视频类型图标', source:'app/content-type-colors.css', rule:'保留色相，按背景调整明度。' },
  { key:'image', name:'图片类型', group:'内容', dark:'#8bd8ff', light:'#17658f', usage:'图片类型图标', source:'app/content-type-colors.css', rule:'用户图片本身不参与主题替换。' },
] as const;
const productKeys: Record<string, string> = {raised:'panel',text:'text',secondary:'text-secondary',muted:'text-muted',border:'line',hover:'fill-hover',selected:'fill-selected',primary:'white',onPrimary:'ink',focus:'brand',dangerFill:'danger-fill',onDanger:'white',error:'danger',image:'info'};
export const tokens = sceneTokens.map(token => ({...token, dark:uiPalette.colors.find(color=>color.key === (productKeys[token.key] || token.key))!.value}));
export type TokenKey = typeof tokens[number]['key'];
export type Palette = Record<TokenKey, string>;
export const defaultPalette = (theme: Theme): Palette => Object.fromEntries(tokens.map(token => [token.key, token[theme]])) as Palette;
export const issues = [
  {id:'primary-action', level:'已确认', title:'主操作按钮使用黑白配色，品牌强调保留荧光绿', detail:'暗色主按钮为白底深字；亮色方案为近黑底白字。通用按钮和现有绿底主操作已调整，进度与选中描边仍用品牌色。', files:['components/ui/button.tsx','app/globals.css'], proposal:'新增主操作复用独立动作颜色；亮色目前是审查台方案，完整产品主题仍需另行接入。'},
  {id:'forced-dark', level:'亮色阻碍', title:'明暗主题最后都被覆盖为深色', detail:':root 和 .dark 共用同一组深色值；页面也固定 .dark。切掉 dark 类并不会得到亮色产品。', files:['app/ui-colors.css','app/globals.css','app/layout.tsx'], proposal:'分别定义主题，再让业务组件引用语义色。先迁移工作区外壳与基础控件。'},
  {id:'danger-contrast', level:'已收敛', title:'危险文字与实底分开，白字更清晰', detail:'原先删除高亮使用 #f4776b + 白字；本地源码已改用 #b73f34 实底，危险文字仍使用 #f4776b。', files:['app/thesis-board.css:37','app/database.css:954'], proposal:'主要删除入口已接入独立危险实底；右侧预览可以继续调整并看对比度。'},
  {id:'danger-variants', level:'已收敛', title:'删除入口统一为危险颜色用途', detail:'通用 Button、论文提醒、文件删除弹窗已共用危险文字、淡底、边框与实底。', files:['components/ui/button.tsx:26','app/workspace-file-browser.css:174','app/board-chrome.css:84'], proposal:'菜单维持红字与中性悬停；确认按钮采用深红填充配白字。'},
  {id:'radius-xs', level:'已通过', title:'通用按钮尺寸与圆角符合已确认规则', detail:'实际浏览器测量：24px 按钮使用 8px 圆角，28px / 32px 使用 12px。radius-md 是 10px × 0.8；不应把 radius-sm 的 0.6 倍误用于判断。', files:['components/ui/button.tsx:33','app/globals.css:44'], proposal:'保留现状。后续接入其他业务控件时，也按 24 → 8、28 / 32 → 12 检查；发送／停止保留圆形。'},
  {id:'selected', level:'已收敛', title:'当前选中底色共用白色 10%', detail:'助手、模型、论文阶段等选中底色已引用 fill-selected；亮色主题尚未迁移。', files:['app/thesis-board.css:4','app/ai-canvas.css:61','app/ai-composer.css:80'], proposal:'后续亮色将此用途映射为深色低透明度，保留文字与勾选语义。'},
  {id:'content-colors', level:'边界规则', title:'内容颜色与界面颜色需要分开', detail:'PDF 原文、用户高亮、分区自选颜色、图片、播放器及品牌标志不是普通界面底色。硬编码色值不等于违规。', files:['app/content-type-colors.css','app/pdf-annotation-editor.css','app/canvas-sections.css'], proposal:'主题只迁移界面语义色。内容与第三方品牌色单独登记，避免全局搜索替换。'},
] as const;
