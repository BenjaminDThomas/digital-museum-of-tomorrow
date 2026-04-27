'use strict';

// TextEncoder / TextDecoder are available in Node but not always injected
// into the jsdom global. Import them explicitly so the mock stream helper works.
const { TextEncoder, TextDecoder } = require('util');
global.TextEncoder = TextEncoder;
global.TextDecoder = TextDecoder;

/**
 * Tests for the Ollama API service layer — js/services/ollama.js
 *
 * Covered:
 *   checkApi          — health-check the Ollama server
 *   parseJsonResponse — clean and parse model text output as JSON
 *   streamChat        — send messages, accumulate streamed chunks, handle errors
 *
 * All network calls are intercepted by a jest.fn() mock so the real Ollama
 * server does not need to be running.
 */

// ---------------------------------------------------------------------------
// Helper: build a mock ReadableStream that yields chunks in a single read
// ---------------------------------------------------------------------------
function makeMockStream(chunks) {
  const encoder = new TextEncoder();
  const text = chunks.map(c => JSON.stringify(c) + '\n').join('');
  let done = false;
  return {
    getReader: () => ({
      read: () => {
        if (done) return Promise.resolve({ done: true, value: undefined });
        done = true;
        return Promise.resolve({ done: false, value: encoder.encode(text) });
      },
    }),
  };
}

// ---------------------------------------------------------------------------
// Setup / teardown
// ---------------------------------------------------------------------------
beforeEach(() => {
  // Re-require the module each time so the internal readinessChecks Map starts
  // empty and window.A2BCOllama is freshly initialised.
  jest.resetModules();
  delete global.window.A2BCOllama;
  global.fetch = jest.fn();
  require('../js/services/ollama.js');
});

afterEach(() => {
  jest.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// checkApi — verifies the Ollama server is reachable
// ---------------------------------------------------------------------------
describe('checkApi', () => {
  it('resolves to true when Ollama responds with HTTP 200', async () => {
    global.fetch.mockResolvedValueOnce({ ok: true, status: 200 });

    await expect(
      window.A2BCOllama.checkApi('http://localhost:11434/api/tags')
    ).resolves.toBe(true);
  });

  it('throws a descriptive error when the server returns a non-200 status', async () => {
    global.fetch.mockResolvedValueOnce({ ok: false, status: 503 });

    await expect(
      window.A2BCOllama.checkApi('http://localhost:11434/api/tags')
    ).rejects.toThrow('Ollama health check failed: 503');
  });

  it('throws when the network is unreachable', async () => {
    global.fetch.mockRejectedValueOnce(new TypeError('Failed to fetch'));

    await expect(
      window.A2BCOllama.checkApi('http://localhost:11434/api/tags')
    ).rejects.toThrow('Failed to fetch');
  });

  it('returns the cached promise on a second call to the same URL (no extra fetch)', async () => {
    global.fetch.mockResolvedValueOnce({ ok: true, status: 200 });

    await window.A2BCOllama.checkApi('http://localhost:11434/api/tags');
    await window.A2BCOllama.checkApi('http://localhost:11434/api/tags');

    // Only one real network request should have been made
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  it('removes the cache entry after a failure so the next call retries', async () => {
    global.fetch
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce({ ok: true, status: 200 });

    // First call fails
    await expect(
      window.A2BCOllama.checkApi('http://localhost:11434/api/tags')
    ).rejects.toThrow('offline');

    // Second call should succeed because the failed entry was evicted
    await expect(
      window.A2BCOllama.checkApi('http://localhost:11434/api/tags')
    ).resolves.toBe(true);
  });
});

// ---------------------------------------------------------------------------
// parseJsonResponse — cleans and parses model text output as JSON
// ---------------------------------------------------------------------------
describe('parseJsonResponse', () => {
  it('parses a plain JSON string', () => {
    expect(window.A2BCOllama.parseJsonResponse('{"key":"value"}')).toEqual({ key: 'value' });
  });

  it('strips markdown ```json code fences before parsing', () => {
    const fenced = '```json\n{"key":"value"}\n```';
    expect(window.A2BCOllama.parseJsonResponse(fenced)).toEqual({ key: 'value' });
  });

  it('strips plain ``` code fences before parsing', () => {
    const fenced = '```\n{"key":"value"}\n```';
    expect(window.A2BCOllama.parseJsonResponse(fenced)).toEqual({ key: 'value' });
  });

  it('extracts a JSON object embedded inside surrounding prose', () => {
    const text = 'Sure, here is the result: {"name":"vase"} Hope that helps!';
    expect(window.A2BCOllama.parseJsonResponse(text)).toEqual({ name: 'vase' });
  });

  it('throws the correct error message when no JSON can be found', () => {
    expect(() => window.A2BCOllama.parseJsonResponse('absolutely nothing here'))
      .toThrow('Text model did not return valid JSON.');
  });
});

// ---------------------------------------------------------------------------
// streamChat — sends a request and accumulates streamed text chunks
// ---------------------------------------------------------------------------
describe('streamChat', () => {
  it('sends the correct model, systemPrompt, and userPrompt in the request body', async () => {
    global.fetch
      .mockResolvedValueOnce({ ok: true, status: 200 })   // checkApi call
      .mockResolvedValueOnce({                             // chat request
        ok: true,
        body: makeMockStream([{ message: { content: 'hello' } }]),
      });

    await window.A2BCOllama.streamChat({
      systemPrompt: 'You are a museum guide.',
      userPrompt: 'Tell me about vases.',
      model: 'phi3:mini',
      chatUrl: 'http://localhost:11434/api/chat',
      tagsUrl: 'http://localhost:11434/api/tags',
    });

    const [, [, chatCallOptions]] = global.fetch.mock.calls;
    const body = JSON.parse(chatCallOptions.body);

    expect(body.model).toBe('phi3:mini');
    expect(body.stream).toBe(true);
    expect(body.messages).toContainEqual({ role: 'system', content: 'You are a museum guide.' });
    expect(body.messages).toContainEqual({ role: 'user', content: 'Tell me about vases.' });
  });

  it('defaults to the phi3:mini model when no model is specified', async () => {
    global.fetch
      .mockResolvedValueOnce({ ok: true, status: 200 })
      .mockResolvedValueOnce({
        ok: true,
        body: makeMockStream([{ message: { content: 'ok' } }]),
      });

    await window.A2BCOllama.streamChat({
      userPrompt: 'Test',
      chatUrl: 'http://localhost:11434/api/chat',
      tagsUrl: 'http://localhost:11434/api/tags',
    });

    const [, [, chatCallOptions]] = global.fetch.mock.calls;
    expect(JSON.parse(chatCallOptions.body).model).toBe('phi3:mini');
  });

  it('accumulates streamed chunks into the full response and calls onText each time', async () => {
    global.fetch
      .mockResolvedValueOnce({ ok: true, status: 200 })
      .mockResolvedValueOnce({
        ok: true,
        body: makeMockStream([
          { message: { content: 'Hello' } },
          { message: { content: ' World' } },
        ]),
      });

    const received = [];
    const result = await window.A2BCOllama.streamChat({
      userPrompt: 'Hi',
      chatUrl: 'http://localhost:11434/api/chat',
      tagsUrl: 'http://localhost:11434/api/tags',
      onText: text => received.push(text),
    });

    expect(result).toBe('Hello World');
    expect(received).toEqual(['Hello', 'Hello World']);
  });

  it('omits the system message when no systemPrompt is provided', async () => {
    global.fetch
      .mockResolvedValueOnce({ ok: true, status: 200 })
      .mockResolvedValueOnce({
        ok: true,
        body: makeMockStream([{ message: { content: 'ok' } }]),
      });

    await window.A2BCOllama.streamChat({
      userPrompt: 'No system',
      chatUrl: 'http://localhost:11434/api/chat',
      tagsUrl: 'http://localhost:11434/api/tags',
    });

    const [, [, chatCallOptions]] = global.fetch.mock.calls;
    const body = JSON.parse(chatCallOptions.body);
    expect(body.messages.every(m => m.role !== 'system')).toBe(true);
  });

  it('passes the options block (temperature, num_predict) through to the payload', async () => {
    global.fetch
      .mockResolvedValueOnce({ ok: true, status: 200 })
      .mockResolvedValueOnce({
        ok: true,
        body: makeMockStream([{ message: { content: 'ok' } }]),
      });

    await window.A2BCOllama.streamChat({
      userPrompt: 'Test options',
      options: { temperature: 0.3, num_predict: 320 },
      chatUrl: 'http://localhost:11434/api/chat',
      tagsUrl: 'http://localhost:11434/api/tags',
    });

    const [, [, chatCallOptions]] = global.fetch.mock.calls;
    const body = JSON.parse(chatCallOptions.body);
    expect(body.options).toEqual({ temperature: 0.3, num_predict: 320 });
  });

  it('throws when the chat endpoint returns a non-200 status', async () => {
    global.fetch
      .mockResolvedValueOnce({ ok: true, status: 200 })
      .mockResolvedValueOnce({ ok: false, status: 500 });

    await expect(
      window.A2BCOllama.streamChat({
        userPrompt: 'Test',
        chatUrl: 'http://localhost:11434/api/chat',
        tagsUrl: 'http://localhost:11434/api/tags',
      })
    ).rejects.toThrow('HTTP error! status: 500');
  });

  it('throws when the chat endpoint returns no body', async () => {
    global.fetch
      .mockResolvedValueOnce({ ok: true, status: 200 })
      .mockResolvedValueOnce({ ok: true, body: null });

    await expect(
      window.A2BCOllama.streamChat({
        userPrompt: 'Test',
        chatUrl: 'http://localhost:11434/api/chat',
        tagsUrl: 'http://localhost:11434/api/tags',
      })
    ).rejects.toThrow('Ollama response body was empty.');
  });
});
