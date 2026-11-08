import { normalizeCustomAiUrl } from './custom-ai-config.ts';

/** Deny special-use IPv4 and non-global IPv6, including IPv4-mapped addresses. */
export function publicAiAddress(address: string): boolean {
  if (address.includes(':')) {
    const parts = address.toLowerCase().split(':');
    const first = Number.parseInt(parts[0], 16), second = Number.parseInt(parts[1] || '0', 16);
    return !address.includes('.') && first >= 0x2000 && first < 0x4000
      && first !== 0x2002 && first !== 0x3fff && !(first === 0x2001 && (second < 0x200 || second === 0xdb8));
  }
  const bytes = address.split('.').map(Number);
  if (bytes.length !== 4 || bytes.some(n => !Number.isInteger(n) || n < 0 || n > 255)) return false;
  const [a,b,c] = bytes;
  return a !== 0 && a !== 10 && a !== 127 && a < 224
    && !(a === 100 && b >= 64 && b <= 127) && !(a === 169 && b === 254)
    && !(a === 172 && b >= 16 && b <= 31) && !(a === 192 && (b === 168 || b === 0 || (b === 88 && c === 99)))
    && !(a === 198 && (b === 18 || b === 19 || (b === 51 && c === 100))) && !(a === 203 && b === 0 && c === 113);
}

/** Node-only personal-service transport. Pin the checked DNS answer to the TLS
 * connection, preserving hostname certificate verification. No proxy, cookies,
 * retries or redirects; never reuse a connection after changing configuration. */
export const secureCustomAiFetch: typeof fetch = async (input, init) => {
  const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
  const suffix = ['/chat/completions', '/responses', '/models'].find(path => url.pathname.endsWith(path));
  if (!suffix) throw new Error('Invalid custom AI endpoint.');
  normalizeCustomAiUrl(url.href.slice(0, -suffix.length));
  const [{ request }, { lookup }, { Readable }] = await Promise.all([import('node:https'), import('node:dns/promises'), import('node:stream')]);
  init?.signal?.throwIfAborted();
  return new Promise<Response>((resolve, reject) => {
    const req = request(url, {
      method: init?.method || 'GET', headers: Object.fromEntries(new Headers(init?.headers)), signal: init?.signal || undefined,
      agent: false, rejectUnauthorized: true,
      lookup: (hostname, options, callback) => {
        void lookup(hostname, { all: true, order: 'verbatim' }).then(addresses => {
          if (!addresses.length || addresses.some(item => !publicAiAddress(item.address))) throw new Error('Private network addresses are not allowed.');
          if (options.all) callback(null, addresses);
          else callback(null, addresses[0].address, addresses[0].family);
        }).catch(() => callback(new Error('Custom AI address could not be safely resolved.'), '', 4));
      },
    }, res => {
      const status = res.statusCode || 502;
      if (status >= 300 && status < 400) { res.destroy(); reject(new Error('Custom AI redirects are not allowed.')); return; }
      const headers = new Headers();
      for (const [key, value] of Object.entries(res.headers)) if (value !== undefined) headers.set(key, Array.isArray(value) ? value.join(', ') : value);
      if ([204, 205, 304].includes(status)) { res.resume(); resolve(new Response(null, { status, headers })); return; }
      resolve(new Response(Readable.toWeb(res) as ReadableStream<Uint8Array>, { status, headers }));
    });
    req.on('error', () => reject(init?.signal?.aborted ? init.signal.reason : new Error('Custom AI connection failed. Check the HTTPS address and network.')));
    if (typeof init?.body === 'string') req.end(init.body); else req.end();
  });
};
