/**
 * 记忆星图 Memory Atlas 的数据格式与接口类型。
 * 运行时代码是纯 JS（memory-atlas.js），这个文件只用来给 TypeScript 项目和 AI 编程助手看。
 */

/** 分类：决定光点颜色和右上角图例 */
export interface MemoryCategory {
  id: string;
  name: string;
  /** '#60d6ff' 或 [96, 214, 255] */
  color: string | [number, number, number];
}

/** 记忆：用户已经理解、能用自己的话讲出来的知识点。画成彩色的星 / 光点。 */
export interface MemoryItem {
  id: string;
  title: string;
  /** 用户自己的一句话解释，显示在卡片里 */
  note?: string;
  categoryId: string;
  /** 'YYYY-MM-DD'，决定它在时间轴（海岸 / 星河）上的位置 */
  date: string;
  /** 0–1，理解深度。越高光点越大越亮，在海岸场景里离岸越近。默认 0.6 */
  understanding?: number;
  /** 回看次数，只用于卡片展示。默认 1 */
  views?: number;
  /** 相关记忆的 id。只要有任意一条记忆提供了 links，就完全使用数据里的连接，不再自动生成 */
  links?: string[];
}

/** 碎片：收藏了但还没整理 / 没理解的内容（高亮、AI 摘要、书签……）。画成浪里 / 银河外的细小白光。 */
export interface FragmentItem {
  id: string;
  title: string;
  note?: string;
  date: string;
  /** 和它最相关的记忆 id；不给的话按位置自动找最近的一段记忆 */
  nearestMemoryId?: string;
}

export interface MemoryAtlasData {
  categories: MemoryCategory[];
  memories: MemoryItem[];
  fragments?: FragmentItem[];
  /** 时间轴范围。不给时从最早一条数据到今天 */
  range?: { start?: string; end?: string };
}

export type MemoryAtlasScene = 'shore' | 'galaxy';

/** onSelect 回调里拿到的对象 */
export interface MemoryAtlasSelection {
  id: string;
  type: 'memory' | 'fragment';
  title: string;
  note: string;
  categoryId: string | null;
  date: string;
  understanding: number;
  views: number;
  links: string[];
  /** 原始传入的数据对象，方便宿主拿到自己的字段 */
  source: MemoryItem | FragmentItem;
}

export interface MemoryAtlasOptions {
  data: MemoryAtlasData;
  /** 初始场景，默认 'shore' */
  scene?: MemoryAtlasScene;
  /**
   * 内置界面。false = 完全不带界面（宿主自己画卡片、开关）；
   * 也可以逐项关闭：{ card: false } 表示用宿主自己的卡片，其他保留。
   */
  ui?: boolean | { brand?: boolean; legend?: boolean; controls?: boolean; hint?: boolean; card?: boolean };
  /** 选中 / 取消选中（null）时触发 */
  onSelect?: (item: MemoryAtlasSelection | null) => void;
  /** 场景切换完成（画面换好的那一刻）时触发 */
  onSceneChange?: (scene: MemoryAtlasScene) => void;
  /** 覆盖界面文案，结构见 memory-atlas.js 里的 DEFAULT_TEXT */
  text?: Record<string, unknown>;
  /** 布局随机种子，同一份数据 + 同一个种子 = 同样的布局。默认 20261006 */
  seed?: number;
  /** 没提供 links 时是否自动生成连接，默认 true */
  autoLink?: boolean;
  /** 活跃度权重（星河场景里银河的宽度和亮度），默认 { memory: 1, fragment: 0.3 } */
  activityWeights?: { memory: number; fragment: number };
  /** 每天在时间轴上占多少世界坐标，默认约 6.96。数据跨度很长时可以调小 */
  pxPerDay?: number;
  /** 海面 / 星河着色器最多渲染多少像素，默认 5.6e6。性能吃紧时调小，如 2.5e6 */
  maxPixels?: number;
  /** 实际绘制的帧率上限，默认 60；壁纸可设为 30。 */
  maxFps?: number;
  /** 是否绘制月份、年份与 Today 标注，默认 true。 */
  decorations?: boolean;
  /** WebGL 与着色器成功绘制首个可见帧时为 true；初始化不可用时为 false。 */
  onReady?: (ok: boolean) => void;
  /** 镜头一开始停在哪天，'YYYY-MM-DD'。默认最后 30 天附近 */
  initialDate?: string;
  /** 闲置 7 秒后镜头是否沿时间轴慢慢漂移，默认 true */
  idleDrift?: boolean;
  /** 是否记住用户上次选的场景（localStorage），默认 false */
  persistScene?: boolean;
  /** 是否自动注入组件样式，默认 true */
  injectStyles?: boolean;
  /** 是否从 Google Fonts 加载字体，默认 true。产品里已有字体时可关掉 */
  loadFonts?: boolean;
  /** 强制减少动画；不传时跟随系统设置 */
  reducedMotion?: boolean;
}

export interface MemoryAtlas {
  setScene(scene: MemoryAtlasScene): void;
  getScene(): MemoryAtlasScene;
  /** 暂停时保留画面并停止绘制，恢复时动画从暂停位置继续。 */
  setPaused(paused: boolean): void;
  /** 替换全部数据，会重新布局 */
  setData(data: MemoryAtlasData): void;
  /** 传 id 选中并把镜头移过去；传 null 取消选中 */
  select(id: string | null): void;
  getSelected(): MemoryAtlasSelection | null;
  /** 只高亮某个分类，null 取消 */
  setFilter(categoryId: string | null): void;
  /** 拖动手势：'stir' 搅动 / 拨动，'pan' 移动视角 */
  setMode(mode: 'stir' | 'pan'): void;
  /** 镜头飞到某一天 */
  focusDate(date: string): void;
  /** 容器尺寸变化会自动处理，一般不用手动调用 */
  resize(): void;
  /** 卸载：停止动画、移除监听、释放 WebGL */
  destroy(): void;
}

export function createMemoryAtlas(container: HTMLElement, options: MemoryAtlasOptions): MemoryAtlas;
export default createMemoryAtlas;
