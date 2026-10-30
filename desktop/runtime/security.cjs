'use strict';
/* oxlint-disable typescript/no-require-imports -- Shared with the CommonJS desktop entry. */
const { timingSafeEqual } = require('node:crypto');

// A stable origin keeps Chromium's IndexedDB identity unchanged across launches.
// Isolated automation may run beside a real workspace on this reserved test port.
function desktopConfiguration(packaged, environment = process.env, distribution = 'official') {
  if (!['community', 'official'].includes(distribution)) throw new Error('Unknown desktop distribution.');
  const development = !packaged && environment.LUMIOR_DESKTOP_DEV === '1';
  const testPort = development ? '43272' : '43271';
  const isolatedTest = environment.LUMIOR_DESKTOP_TEST_MODE === '1'
    && environment.LUMIOR_DESKTOP_TEST_PORT === testPort
    && typeof environment.LUMIOR_DESKTOP_DATA_DIR === 'string'
    && environment.LUMIOR_DESKTOP_DATA_DIR.trim().length > 0;
  const productionPort = distribution === 'community' ? 43173 : 43171;
  return { development, port: isolatedTest ? Number(testPort) : productionPort + (development ? 1 : 0) };
}
const DESKTOP_PORT = desktopConfiguration(true).port;
const DESKTOP_ORIGIN = `http://127.0.0.1:${DESKTOP_PORT}`;
const SESSION_PARTITION = 'persist:lumior-workspace';
function createSecurity(port) {
  const origin = `http://127.0.0.1:${port}`;
  const isAppUrl = value => { try { return new URL(value).origin === origin; } catch { return false; } };
  const authorizeRequest = (headers, token) => {
    if (headers.host !== `127.0.0.1:${port}` || (headers.origin && headers.origin !== origin)) return false;
    const supplied = headers['x-lumior-desktop'];
    if (typeof supplied !== 'string' || typeof token !== 'string') return false;
    const a = Buffer.from(supplied), b = Buffer.from(token);
    return a.length === b.length && a.length >= 32 && timingSafeEqual(a, b);
  };
  return { DESKTOP_PORT: port, DESKTOP_ORIGIN: origin, isAppUrl, authorizeRequest };
}
const { isAppUrl, authorizeRequest } = createSecurity(DESKTOP_PORT);
function externalUrl(value) {
  try {
    const url = new URL(value);
    if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) return null;
    return url.href;
  } catch { return null; }
}
function cleanBackendEnvironment(environment, token, webRoot, development = false, distribution = 'official') {
  if (!['community', 'official'].includes(distribution)) throw new Error('Unknown desktop distribution.');
  const result = {};
  for (const [key, value] of Object.entries(environment)) {
    if (!/(?:API_KEY|SECRET|TOKEN|PASSWORD|CREDENTIAL|ELECTRON_RUN_AS_NODE|NODE_OPTIONS|LUMIOR_DESKTOP_DEV)/i.test(key)) result[key] = value;
  }
  return { ...result, NODE_ENV: development ? 'development' : 'production', LUMIOR_DESKTOP_DEV: development ? '1' : '0', LUMIOR_DESKTOP_DISTRIBUTION: distribution, LUMIOR_DESKTOP: '1', LUMIOR_DESKTOP_TOKEN: token, LUMIOR_DESKTOP_WEB_ROOT: webRoot, LUMIOR_PDF_LAYOUT_PORT: '43221' };
}
module.exports = { DESKTOP_PORT, DESKTOP_ORIGIN, SESSION_PARTITION, isAppUrl, externalUrl, authorizeRequest, cleanBackendEnvironment, desktopConfiguration, createSecurity };
