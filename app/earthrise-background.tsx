'use client';

import { useEffect, useRef, useState } from 'react';
import { useI18n } from './i18n';
import './earthrise-background.css';

// Original scene: https://ascii.rest/earthrise/
// Official embedding/API: https://ascii.rest/docs/html and https://ascii.rest/docs/api
// MIT library: https://github.com/bas3line/ascii/blob/main/LICENSE
// The official modules stay inside an opaque-origin iframe, outside the app DOM.
const sceneDocument = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src https://ascii.rest 'nonce-earthrise-bootstrap'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'">
  <style>
    html, body { width: 100%; height: 100%; margin: 0; overflow: hidden; background: #030408; color: #e8edf5; }
    body { display: grid; place-items: center; }
    canvas { display: block; width: max(100vw, 200vh); height: auto; }
  </style>
</head>
<body inert>
  <canvas aria-hidden="true"></canvas>
  <script type="module" nonce="earthrise-bootstrap">
    try {
      const [{ mount }, earthrise] = await Promise.all([
        import('https://ascii.rest/mount.js'),
        import('https://ascii.rest/pieces/earthrise.js'),
      ]);
      const canvas = document.querySelector('canvas');
      const { cols, rows, cell = 2 } = earthrise.meta;
      canvas.style.width = 'max(100vw, ' + (100 * cols / (rows * cell)) + 'vh)';
      const stop = mount(canvas, earthrise);
      addEventListener('pagehide', stop, { once: true });
      parent.postMessage('lumiro:earthrise:ready', '*');
    } catch {
      parent.postMessage('lumiro:earthrise:failed', '*');
    }
  </script>
</body>
</html>`;

export function EarthriseBackground() {
  const { t } = useI18n();
  const frameRef = useRef<HTMLIFrameElement>(null);
  const [status, setStatus] = useState<'loading' | 'ready' | 'failed'>(
    'loading',
  );

  useEffect(() => {
    // A background failure remains a plain dark surface. Opening feeds again retries.
    const timeout = window.setTimeout(() => setStatus('failed'), 20000);
    const receive = (event: MessageEvent) => {
      if (
        event.source !== frameRef.current?.contentWindow ||
        event.origin !== 'null'
      )
        return;
      if (event.data === 'lumiro:earthrise:ready') {
        window.clearTimeout(timeout);
        setStatus('ready');
      } else if (event.data === 'lumiro:earthrise:failed') {
        window.clearTimeout(timeout);
        setStatus('failed');
      }
    };
    window.addEventListener('message', receive);
    return () => {
      window.clearTimeout(timeout);
      window.removeEventListener('message', receive);
    };
  }, []);

  return (
    <div
      className="earthrise-background"
      data-status={status}
      aria-hidden="true"
      inert
    >
      {status !== 'failed' && (
        <iframe
          ref={frameRef}
          title={t('Earthrise decorative background', 'Earthrise 装饰背景')}
          srcDoc={sceneDocument}
          sandbox="allow-scripts"
          referrerPolicy="no-referrer"
          tabIndex={-1}
          loading="lazy"
        />
      )}
    </div>
  );
}
