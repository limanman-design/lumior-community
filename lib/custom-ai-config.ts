export type CustomAiProtocol = 'responses' | 'chat-completions';
export type CustomAiConfig = { name: string; baseUrl: string; protocol: CustomAiProtocol };

/** No credentials, query secrets, local addresses, non-TLS endpoints or redirects. */
export function normalizeCustomAiUrl(value: unknown): string {
  if (typeof value !== 'string' || value.length > 512 || /[\s\\%]/.test(value)) throw new Error('Enter a public HTTPS API base URL.');
  let url: URL;
  try { url = new URL(value); } catch { throw new Error('Enter a public HTTPS API base URL.'); }
  const host = url.hostname;
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash || (url.port && url.port !== '443')
    || !/^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,63}$/.test(host)
    || /(?:^|\.)(?:localhost|local|internal|lan|home|test|invalid|example|onion)$/.test(host)
    || !/^\/[a-zA-Z0-9._~/-]*$/.test(url.pathname) || /(?:^|\/)\.\.?(?:\/|$)/.test(value.replace(/^https:\/\//, ''))
    || /\/(?:responses|chat\/completions|models)\/?$/.test(url.pathname)) throw new Error('Enter a public HTTPS API base URL, without a specific endpoint.');
  return url.href.replace(/\/+$/, '');
}
export function validateCustomAiConfig(value: unknown): CustomAiConfig {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid custom AI settings.');
  const config = value as Record<string, unknown>;
  if (Object.keys(config).some(key => !['name', 'baseUrl', 'protocol'].includes(key)) || typeof config.name !== 'string'
    || !config.name.trim() || config.name.trim().length > 64 || Array.from(config.name, char => char.charCodeAt(0)).some(code => code < 32 || code === 127)
    || !['responses', 'chat-completions'].includes(String(config.protocol))) throw new Error('Invalid custom AI settings.');
  return { name: config.name.trim(), baseUrl: normalizeCustomAiUrl(config.baseUrl), protocol: config.protocol as CustomAiProtocol };
}
