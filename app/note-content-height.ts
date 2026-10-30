// Measure the rendered note at its current width, without the old fixed height
// or the editor's empty writing space influencing the result.
export function measureNoteContentHeight(article: HTMLElement): number | null {
  const scroll = article.querySelector<HTMLElement>('.card-scroll');
  const editor = scroll?.querySelector<HTMLElement>('.bn-editor');
  if (!scroll || !editor) return null;
  const scrollStyle = scroll.getAttribute('style');
  const editorStyle = editor.getAttribute('style');
  try {
    scroll.style.height = 'auto';
    editor.style.minHeight = '0px';
    const style = getComputedStyle(article);
    const outer = [
      'paddingTop',
      'paddingBottom',
      'borderTopWidth',
      'borderBottomWidth',
    ].reduce(
      (sum, property) =>
        sum +
        (parseFloat(style[property as keyof CSSStyleDeclaration] as string) ||
          0),
      0,
    );
    return scroll.offsetHeight + outer;
  } finally {
    if (scrollStyle === null) scroll.removeAttribute('style');
    else scroll.setAttribute('style', scrollStyle);
    if (editorStyle === null) editor.removeAttribute('style');
    else editor.setAttribute('style', editorStyle);
  }
}
