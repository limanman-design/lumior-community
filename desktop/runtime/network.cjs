'use strict';

/** OpenAI needs the desktop's system proxy/PAC support, which Node fetch lacks.
 * Keep local services and other transports unchanged. This adapter does not
 * retry, choose models or change the caller's credentials and cancellation.
 */
function createDesktopFetch({ nodeFetch, chromiumFetch }) {
  return function desktopFetch(input, init) {
    let url;
    try { url = new URL(typeof input === 'object' && input !== null && 'url' in input ? input.url : input); }
    catch { return nodeFetch(input, init); }
    if (url.origin !== 'https://api.openai.com') return nodeFetch(input, init);
    // Node requests never use a browser cookie jar. Preserve that isolation
    // when moving the official API request onto Chromium's network stack.
    return chromiumFetch(input, { ...init, credentials: 'omit', cache: 'no-store' });
  };
}

module.exports = { createDesktopFetch };
