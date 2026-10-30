import type { Language } from './i18n-core';

export function editorPlaceholder(language: Language, pdfExcerpt = false) {
  if (pdfExcerpt) return language === 'zh'
    ? '写下你对这段原文的理解…'
    : 'Write your thoughts about this passage…';
  return language === 'zh'
    ? '写下你的想法，输入 / 添加标题、列表等内容'
    : 'Write your thoughts. Type / to add headings, lists, and more.';
}
