'use strict';
/* oxlint-disable typescript/no-require-imports -- Shared by the Electron entry and build script. */
const fs = require('node:fs/promises');
const path = require('node:path');

function isolatedTrialTest(environment = process.env) {
  return environment.LUMIOR_DESKTOP_TEST_MODE === '1'
    && ['43271', '43272'].includes(environment.LUMIOR_DESKTOP_TEST_PORT)
    && typeof environment.LUMIOR_DESKTOP_DATA_DIR === 'string'
    && environment.LUMIOR_DESKTOP_DATA_DIR.trim().length > 0;
}
function normalizeTrialGatewayUrl(value, { allowLocalTest = false } = {}) {
  if (typeof value !== 'string' || value.length > 256) throw new Error('Invalid trial service configuration.');
  let url;
  try { url = new URL(value); } catch { throw new Error('Invalid trial service configuration.'); }
  const production = url.protocol === 'https:' && url.hostname === 'api.lumior.work' && !url.port;
  const localTest = allowLocalTest && url.protocol === 'http:' && url.hostname === '127.0.0.1' && ['8787', '43371'].includes(url.port);
  if ((!production && !localTest) || url.username || url.password || url.pathname !== '/' || url.search || url.hash) throw new Error('Invalid trial service configuration.');
  return url.origin;
}
async function readTrialService(directory, { environment = process.env } = {}) {
  let source;
  try { source = await fs.readFile(path.join(directory, 'trial-service.json'), 'utf8'); } catch (error) { if (error.code === 'ENOENT') return ''; throw error; }
  let settings;
  try { settings = JSON.parse(source); } catch { throw new Error('Invalid trial service configuration.'); }
  if (!settings || typeof settings !== 'object' || Array.isArray(settings) || Object.keys(settings).some(key => key !== 'gatewayUrl')) throw new Error('Invalid trial service configuration.');
  return normalizeTrialGatewayUrl(settings.gatewayUrl, { allowLocalTest: isolatedTrialTest(environment) });
}
function normalizeInvitationCode(value) {
  if (typeof value !== 'string' || value.length > 128) throw new Error('Enter a valid invitation code.');
  const code = value.trim().toUpperCase();
  if (!/^[A-Z0-9-]{16,96}$/.test(code)) throw new Error('Enter a valid invitation code.');
  return code;
}
function isTrialToken(value) { return typeof value === 'string' && /^[A-Za-z0-9_-]{43}$/.test(value); }
async function readReceipt(response) {
  const limit = 4096;
  if (Number(response.headers?.get('content-length')) > limit || !response.body) throw new Error('Invitation activation could not be confirmed. Retry the same code.');
  const reader = response.body.getReader();
  let bytes = 0;
  const chunks = [];
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > limit) throw new Error('Invitation activation could not be confirmed. Retry the same code.');
      chunks.push(value);
    }
  } finally { await reader.cancel().catch(() => {}); }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { throw new Error('Invitation activation could not be confirmed. Retry the same code.'); }
}
async function redeemInvitation(gatewayUrl, code, claimToken, { fetcher = fetch, allowLocalTest = false, timeoutMs = 10000, now = Date.now } = {}) {
  const origin = normalizeTrialGatewayUrl(gatewayUrl, { allowLocalTest });
  normalizeInvitationCode(code);
  if (!isTrialToken(claimToken)) throw new Error('Invalid trial credentials.');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetcher(`${origin}/v1/invitations/redeem`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code, claimToken }), redirect: 'error', signal: controller.signal,
    });
    if (!response.ok) throw new Error('Invitation activation failed. Check the code or try again later.');
    const receipt = await readReceipt(response);
    if (!receipt || typeof receipt !== 'object' || Array.isArray(receipt)
      || typeof receipt.userId !== 'string' || !/^[a-zA-Z0-9_-]{1,128}$/.test(receipt.userId)
      || typeof receipt.expiresAt !== 'string' || !Number.isFinite(Date.parse(receipt.expiresAt)) || Date.parse(receipt.expiresAt) <= now()) throw new Error('Invitation activation could not be confirmed. Retry the same code.');
  } catch (error) {
    if (error.message === 'Invitation activation failed. Check the code or try again later.' || error.message === 'Invitation activation could not be confirmed. Retry the same code.') throw error;
    throw new Error('The trial service could not be reached. Retry the same code later.');
  } finally { clearTimeout(timer); }
}

module.exports = { isolatedTrialTest, normalizeTrialGatewayUrl, readTrialService, normalizeInvitationCode, isTrialToken, redeemInvitation };
