'use strict';
// Keep validation identical to lib/custom-ai-config.ts; parity is tested.
/** No credentials, query secrets, local addresses, non-TLS endpoints or redirects. */
function normalizeCustomAiUrl(value) {
  if (typeof value !== 'string' || value.length > 512 || /[\s\\%]/.test(value)) throw new Error('Enter a public HTTPS API base URL.');
  let url;
  try { url = new URL(value); } catch { throw new Error('Enter a public HTTPS API base URL.'); }
  const host = url.hostname;
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash || (url.port && url.port !== '443')
    || !/^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,63}$/.test(host)
    || /(?:^|\.)(?:localhost|local|internal|lan|home|test|invalid|example|onion)$/.test(host)
    || !/^\/[a-zA-Z0-9._~/-]*$/.test(url.pathname) || /(?:^|\/)\.\.?(?:\/|$)/.test(value.replace(/^https:\/\//, ''))
    || /\/(?:responses|chat\/completions|models)\/?$/.test(url.pathname)) throw new Error('Enter a public HTTPS API base URL, without a specific endpoint.');
  return url.href.replace(/\/+$/, '');
}
function validateCustomAiConfig(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid custom AI settings.');
  const config = value;
  if (Object.keys(config).some(key => !['name', 'baseUrl', 'protocol'].includes(key)) || typeof config.name !== 'string'
    || !config.name.trim() || config.name.trim().length > 64 || Array.from(config.name, char => char.charCodeAt(0)).some(code => code < 32 || code === 127)
    || !['responses', 'chat-completions'].includes(String(config.protocol))) throw new Error('Invalid custom AI settings.');
  return { name: config.name.trim(), baseUrl: normalizeCustomAiUrl(config.baseUrl), protocol: config.protocol };
}

module.exports = { normalizeCustomAiUrl, validateCustomAiConfig };
