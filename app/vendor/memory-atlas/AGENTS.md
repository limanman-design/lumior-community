# AGENTS.md：给 AI 编程助手的接入说明

你要把「记忆星图（Memory Atlas）」接入一个知识管理产品（卡片、卡片库、白板）。这份文件说明它是什么、怎么接、哪些地方不能随便改、哪些地方要先问产品负责人。开始写代码前请完整读一遍，再读 `src/types.d.ts`。

## 它是什么

一个纯前端可视化组件。它把用户的知识画成两种可以切换的夜光场景：

- **海岸（shore）**：俯瞰的夜光海岸。记忆是浅水里的彩色光点，浪一波一波扫过来，再退回去。
- **星河（galaxy）**：一条流动的银河。记忆是嵌在银河里的星。哪段时间越活跃，那一段银河就越宽越亮。

两个场景共用三条编码规则：

- **时间**：沿海岸 / 银河从一端排到另一端。
- **理解深度**：光点越大越亮，表示理解越深。
- **碎片**：还没整理的收藏，是浪里或银河外的细小白光。

用户可以拖动来搅亮海水或拨动星尘，可以滚动沿时间轴漫游，也可以点一颗星，看它和哪些记忆相连。

技术上，它只依赖 WebGL 1 和 Canvas 2D，没有第三方依赖，不需要构建步骤。

## 文件结构

| 路径 | 作用 | 能否修改 |
|---|---|---|
| `src/memory-atlas.js` | 组件本体，导出 `createMemoryAtlas(container, options)` | 可以，但见下方「不变量」 |
| `src/shaders.js` | 两个场景的 GLSL 片元着色器 | 改动必须和 JS 几何函数同步 |
| `src/styles.js` | 组件样式，全部限定在 `.ma-root` 下 | 可以 |
| `src/types.d.ts` | 数据格式和接口的权威说明 | 接口变了要同步更新 |
| `src/sample-data.js` | 演示数据，产品里不需要 | 不要带进生产包 |
| `demo/index.html` | 完整体验演示（内置界面全开） | — |
| `examples/headless/` | 无界面模式：组件只画图，宿主自己做详情栏 | — |
| `examples/react/MemoryAtlas.tsx` | React 封装示例 | 按项目实际路径改 import |
| `standalone/` | 单文件原型，双击即可打开，仅供对照 | 不要从这里拷代码 |

## 接入步骤

1. **拷贝源码**：把 `src/` 下除 `sample-data.js` 以外的文件拷进项目，例如 `src/vendor/memory-atlas/`。它们是 ES Module，任何打包工具都能直接用。

2. **只在客户端渲染**：组件会用到 `window`、`document` 和 WebGL。
   - Next.js：在 `'use client'` 组件里使用，或者用 `dynamic(() => import(...), { ssr: false })`。
   - Nuxt / SvelteKit 等：同理，只在浏览器端挂载。

3. **给容器一个确定的高度**：组件会铺满容器（`position: absolute; inset: 0`）。容器高度为 0 时什么也看不到。如果容器是 `position: static`，组件会自动把它改成 `relative`。

4. **挂载和卸载**：
   ```js
   const atlas = createMemoryAtlas(el, { data, scene: 'shore', onSelect });
   // 页面离开 / 组件卸载时必须调用，否则动画循环、监听器和 WebGL 上下文会泄漏
   atlas.destroy();
   ```
   React 可以直接用 `examples/react/MemoryAtlas.tsx`。Vue 等框架照它的结构写一个封装即可：mounted 时创建，unmounted 时 destroy，data 变化时 `setData`。

5. **把产品数据映射成 `MemoryAtlasData`**，见下一节。

6. **选择界面模式**：
   - `ui: true`（默认）：用组件自带的标题、图例、场景开关和底部卡片。
   - `ui: { card: false }`：保留其他界面，在 `onSelect` 里打开产品自己的卡片详情。
   - `ui: false`：完全无界面，场景切换、筛选等全部由宿主调接口控制。

## 数据映射（需要和产品负责人确认）

下面是建议的对应关系。标「待确认」的项先问人，不要自己拍板。

| 组件字段 | 含义 | 建议来源 |
|---|---|---|
| `categories` | 光点颜色和图例 | 卡片库的分组 / 标签；建议不超过 6–8 类，类太多颜色区分不开 |
| `memories` | 已经理解的知识点 | 卡片 |
| `memories[].note` | 用户自己的一句话解释 | 卡片正文的第一句或摘要字段 |
| `memories[].date` | 时间轴位置 | 卡片创建时间（待确认：用创建时间还是「理解」的时间） |
| `memories[].understanding` | 0–1，理解深度 | **待确认**，见下文 |
| `memories[].links` | 相关记忆 | 白板上的连线、双向链接。只要有任意一条记忆带了 `links`，组件就只用真实连接，不再自动生成 |
| `fragments` | 还没整理的收藏 | 高亮、书签、AI 摘要、收件箱里的条目（待确认） |
| `fragments[].nearestMemoryId` | 碎片最相关的记忆 | 可选，不给就按位置自动找 |

**`understanding` 怎么算是产品决策，不是技术决策。** 这个产品的核心主张是「光越亮，理解越深」，奖励理解而不是收藏数量，所以这个值不能用「收藏了多少」「打开了多少次」来凑。可以给产品负责人这几个候选信号：

- 用户写过自己的解释
- 解释被 AI 追问后通过
- 隔一段时间后回想成功
- 和其他卡片建立了连接

在确认之前，先统一传 0.6 或不传（默认值就是 0.6），不要编造。

星河场景里，银河的宽度和亮度由活跃度决定。活跃度按记忆 1 分、碎片 0.3 分计算（`activityWeights`），这也是同一个原则：囤资料刷不亮银河。

## 不变量（改动前必须知道）

1. **几何函数在两处各有一份，必须一致。** 下面这些函数在 `memory-atlas.js` 和 `shaders.js` 里各写了一遍：
   - 海岸：`shoreY`、`bandW`、`waves`，对应着色器里的 `wave()`
   - 星河：`cen`、`sig`、`streamOff`、`pulseAt`

   着色器负责画面，JS 负责点击判定、光点被浪扫过时闪亮、脚印被浪抹掉。只改一边，画面和交互就会错位。例如要改浪的周期，必须同时改 JS 的 `WAVE_PERIOD` 和着色器里的 `t/30.`。

2. **只能用 WebGL 1 / GLSL ES 1.0。** 不要引入 WebGL 2 语法或扩展。

3. **布局是确定性的。** 同样的数据 + 同样的 `seed` = 同样的布局。不要在布局代码里用 `Math.random()`，要用 `build()` 里的种子随机数 `R()`。动画里的随机数可以用 `Math.random()`。

4. **不要用浏览器存储保存业务数据。** 组件唯一用到的存储是 `persistScene`，它只记住场景偏好。

5. **一个页面尽量只挂一个实例。** 每个实例都有自己的 WebGL 上下文，浏览器对上下文数量有上限。

## 接口速查

完整类型见 `src/types.d.ts`。

```js
const atlas = createMemoryAtlas(container, options);
atlas.setScene('galaxy');        // 'shore' | 'galaxy'，带过渡动画
atlas.setData(newData);          // 替换数据并重新布局
atlas.select('card-123');        // 选中并把镜头移过去；null 取消
atlas.focusDate('2026-03-14');   // 镜头飞到某一天
atlas.setFilter('psych');        // 只高亮某个分类；null 取消
atlas.setMode('pan');            // 拖动手势：'stir' 搅动 / 'pan' 移动视角
atlas.getSelected(); atlas.getScene();
atlas.destroy();
```

事件：

- `onSelect(item | null)`：`item.source` 是你传进来的原始对象，可以拿它取产品自己的字段。
- `onSceneChange(scene)`：在画面换好的那一刻触发。

## 性能

- 背景是全屏着色器，开销取决于渲染像素数，和光点数量关系不大。默认上限是 `maxPixels: 5.6e6`。在弱显卡或大屏上卡顿时，可以降到 `2.5e6`，画面几乎看不出差别。
- 光点在 2D 画布上逐个绘制。几百到一两千条都没问题；上万条需要改成 WebGL 批量绘制。
- 布局时最近邻查询用了空间网格，自动连线用的是按日期排序后的窗口扫描，几千条数据也能在百毫秒级完成布局。
- 容器滚出视口时，组件会自动暂停渲染（IntersectionObserver）。
- 系统开启「减少动态效果」时，动画会自动放慢，也可以手动传 `reducedMotion: true`。

## 可调参数在哪

| 想调的东西 | 位置 |
|---|---|
| 浪的快慢 | `WAVE_PERIOD`（JS）+ 着色器 `wave()` 里的 `t/30.`，两处同改 |
| 浪花光点的多少 | `FRAG_SHORE` 里 `flow(lp, 3.6, .27, …)` 等调用的第 3 个参数（密度） |
| 浪线的粗细和断续 | `FRAG_SHORE` 里 `line += exp(-ddl*ddl/mix(110., 45., settle))` 和 `seg` |
| 整体色调 | 两个着色器里的 `blue`、`cyanC`、`hot` 常量，以及 `styles.js` 里的 CSS 变量 |
| 银河宽度对活跃度的敏感程度 | `sig()` 里的 `150*actAt(x)`（JS 和着色器 `sigma()` 同改） |
| 光脉冲的速度和间隔 | `pulseAt` 和 `FRAG_GALAXY` 里的 `w.x/2800. - t/16.`，两处同改 |
| 时间轴疏密 | `pxPerDay` 选项（数据跨好几年时调小） |
| 界面文案 / 多语言 | `text` 选项，结构见 `memory-atlas.js` 里的 `DEFAULT_TEXT` |

## 接入后的检查清单

- [ ] 页面打开后能看到海浪或星河动起来，控制台没有 `[memory-atlas]` 报错。
- [ ] 点一颗星，`onSelect` 拿到的 `item.source` 是产品里的原始数据。
- [ ] 切换场景时，光点会飞到新位置，没有闪烁或白屏。
- [ ] 路由离开再回来，没有出现两个画布；内存和 WebGL 上下文没有持续增长（`destroy` 生效）。
- [ ] 手机宽度下：单指搅动，双指移动 / 缩放；卡片不遮挡底部开关。
- [ ] 数据为空（新用户）时页面不报错。空状态的文案和引导由产品决定，组件本身只会显示一片空的海或星河。
- [ ] 如果产品有严格的 CSP、不允许加载 Google Fonts，传 `loadFonts: false`，并在产品里提供字体。
