// Exceptions describe content, not arbitrary permission to add UI colors.
// The audit lists every exception with its source, so they remain reviewable.
export const colorPattern = /#[\da-f]{8}\b|#[\da-f]{6}\b|#[\da-f]{4}\b|#[\da-f]{3}\b|(?:rgba?|hsla?|oklch)\([^)]*\)/gi;
export function colorException({file, selector = '', property = '', value = ''}) {
  if (file === 'app/ui-colors.css') return '色板定义';
  if (/^app\/(trial-night-highway|note-pixel-reveal|canvas-flashlight)\.tsx$/.test(file)) return '插画 / 像素 / 灯光渲染';
  if (/^app\/(earthrise-background|trial-night-highway|canvas-flashlight)\.css$/.test(file) && !/hint/.test(selector)) return '插画 / 灯光与遮罩';
  if (file === 'app/desktop-wallpaper.css' && selector.startsWith('.wallpaper-swatch')) return '壁纸预览画面';
  if (file === 'app/memory-atlas.css' && selector === '.memory-atlas-page' && property === 'background') return '星海画面衔接';
  if (file === 'app/inspiration.css' && selector === '.observatory-feeds' && property === 'background') return '地球画面衔接';
  if (/^app\/(memory-atlas-data|research-board-compatibility|research-reorganization-data|ai-board-layout)\.ts$/.test(file)) return '用户内容的存储色 / 数据兼容映射';
  if (file === 'app/section-title.tsx' && ['#ffffff','#8bd8ff','#c4a5ed','#b1f017','#f5be92','#efa8c4'].includes(value.toLowerCase())) return '分区自选颜色 / 新内容默认值';
  if (file === 'app/page.tsx' && value.toLowerCase() === '#ffffff') return '分区自选颜色 / 新内容默认值';
  if (file === 'app/ai-composer.tsx' && ['#4d6bfe','#bfd0ff'].includes(value.toLowerCase())) return '供应商品牌标志';
  if (/^app\/(pdf-annotation-editor|pdf-viewer|pdf-reading-notes|pdf-region-excerpt)\.tsx$/.test(file) && ['#77cd82','#f5d84a','#64bfee','#ee83af','#b196ee','#fff','#b6c391'].includes(value.toLowerCase())) return 'PDF 批注 / 导出内容';
  if (file === 'app/mermaid-diagram.tsx' && ['#25263f','#5259e2','#898ba8'].includes(value.toLowerCase())) return 'Mermaid 内容渲染主题';
  if (file === 'components/ui/lumior-split-loader.tsx') return '像素动画渲染';
  if (file === 'app/database.css' && /\[data-color=/.test(selector)) return '用户自选多维表标签色';
  if (file === 'app/pdf-annotation-editor.css' && selector === '.pdf-custom-color' && property === 'background') return '用户自选批注颜色的色谱';
  if (/\.pdf-(citation-highlight|search-hit|selectable-text|note-marker)/.test(selector)) return 'PDF 原文上的检索 / 引用标记';
  if ((/\.pdf-page(?:[^a-z-]|$)|\.pdf-paper/.test(selector) || /\.note\.pdf-card \.pdf-cover|\.note:has\(\.pdf-excerpt-color\)/.test(selector)) && property.startsWith('background') && /#fff/i.test(value)) return 'PDF 白纸底色';
  // Colors in data URLs are image pixels, not CSS color declarations.
  if (/url\(['"]?data:/.test(value)) return '内嵌图像资源';
  return null;
}
