// The static exporter changes this flag only in its isolated source copy.
export const PUBLIC_DEMO = false;
export const PUBLIC_DEMO_AI_MESSAGE = '网页 demo 不支持使用';
let noticeTimer: ReturnType<typeof setTimeout> | undefined;

function showDemoNotice() {
  if (typeof document === 'undefined' || !document.body) return;
  let notice = document.getElementById('lumior-public-demo-ai-notice');
  if (!notice) {
    notice = document.createElement('output');
    notice.id = 'lumior-public-demo-ai-notice';
    notice.className = 'notice public-demo-ai-notice';
    notice.setAttribute('role', 'status');
    notice.setAttribute('aria-live', 'polite');
    notice.style.cssText = 'position:fixed;bottom:64px;left:50%;z-index:9999;transform:translateX(-50%);pointer-events:none;';
    document.body.appendChild(notice);
  }
  notice.textContent = PUBLIC_DEMO_AI_MESSAGE;
  if (noticeTimer !== undefined) clearTimeout(noticeTimer);
  const visibleNotice = notice;
  noticeTimer = setTimeout(() => {
    visibleNotice.remove();
    noticeTimer = undefined;
  }, 3200);
}

export function blockPublicDemoAi(notify?: (message: string) => void): boolean {
  if (!PUBLIC_DEMO) return false;
  if (notify) notify(PUBLIC_DEMO_AI_MESSAGE);
  else showDemoNotice();
  return true;
}
