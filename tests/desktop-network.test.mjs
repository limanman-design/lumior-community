import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { createDesktopFetch } = require('../desktop/runtime/network.cjs');

void test('only the official OpenAI HTTPS origin uses the system network transport', async () => {
  const calls = [];
  const fetcher = createDesktopFetch({
    nodeFetch: async input => { calls.push(['node', String(input)]); return new Response('node'); },
    chromiumFetch: async input => { calls.push(['system', String(input)]); return new Response('system'); },
  });
  for (const url of ['https://api.openai.com/v1/models', 'https://api.openai.com/v1/responses', new URL('https://api.openai.com/v1/models')]) {
    assert.equal(await (await fetcher(url)).text(), 'system');
  }
  for (const url of ['http://127.0.0.1:43171/api/ai', 'http://localhost:43221/', 'https://api.deepseek.com/models', 'https://api.openai.com.example.com/', 'http://api.openai.com/', 'https://api.openai.com:8443/', 'data:text/plain,hello', 'invalid URL']) {
    assert.equal(await (await fetcher(url)).text(), 'node');
  }
  assert.equal(calls.length, 11);
});

void test('OpenAI requests retain the exact body, authorization, abort signal and streamed response', async () => {
  const controller = new AbortController();
  const headers = { Authorization: 'Bearer synthetic-fixture-only', 'Content-Type': 'application/json' };
  const body = JSON.stringify({ model: 'gpt-6.1-sol', input: 'Synthetic test', store: false });
  let sent = 0;
  const stream = new ReadableStream({ start(out) { out.enqueue(new TextEncoder().encode('data: fixture\n\n')); out.close(); } });
  const response = new Response(stream, { headers: { 'Content-Type': 'text/event-stream' } });
  const fetcher = createDesktopFetch({ nodeFetch: () => assert.fail('must use system transport'), chromiumFetch: async (url, options) => {
    sent++;
    assert.equal(url, 'https://api.openai.com/v1/responses');
    assert.equal(options.body, body);
    assert.equal(options.headers, headers);
    assert.equal(options.signal, controller.signal);
    assert.equal(options.method, 'POST');
    assert.equal(options.credentials, 'omit');
    assert.equal(options.cache, 'no-store');
    return response;
  } });
  assert.equal(await fetcher('https://api.openai.com/v1/responses', { method: 'POST', body, headers, signal: controller.signal }), response);
  assert.equal(await response.text(), 'data: fixture\n\n');
  assert.equal(sent, 1);
});

void test('Request objects retain their body and signal and neither failure nor cancellation retries', async () => {
  const stopped = new DOMException('Stopped', 'AbortError');
  const controller = new AbortController();
  const request = new Request('https://api.openai.com/v1/responses', { method: 'POST', body: 'fixture', signal: controller.signal });
  let calls = 0;
  const fetcher = createDesktopFetch({ nodeFetch: () => assert.fail('must not retry on the other transport'), chromiumFetch: async (input, options) => {
    calls++;
    assert.equal(input, request);
    assert.equal(await input.clone().text(), 'fixture');
    assert.equal(options.credentials, 'omit');
    throw stopped;
  } });
  controller.abort(stopped);
  await assert.rejects(fetcher(request), error => error === stopped);
  assert.equal(request.signal.aborted, true);
  assert.equal(calls, 1);
});
