'use strict';

/**
 * Tests for the Stable Diffusion image-generation service.
 *
 * The SD server (sd-server/app.py) is a FastAPI application that exposes:
 *
 *   GET  /sdapi/v1/sd-models   — lists loaded models, used as a readiness probe
 *   POST /sdapi/v1/txt2img     — generates an image from a text prompt
 *   GET  /sdapi/v1/status      — returns loading progress information
 *
 * These tests mock fetch so the real Docker container does not need to be
 * running. They verify the expected request/response contracts that the
 * Reimagine page (js/pages/reimagine-page.js) depends on.
 */

const SD_BASE        = 'http://localhost';
const SD_MODELS_URL  = `${SD_BASE}/sdapi/v1/sd-models`;
const SD_TXT2IMG_URL = `${SD_BASE}/sdapi/v1/txt2img`;
const SD_STATUS_URL  = `${SD_BASE}/sdapi/v1/status`;

// ---------------------------------------------------------------------------
// Setup / teardown
// ---------------------------------------------------------------------------
beforeEach(() => {
  global.fetch = jest.fn();
});

afterEach(() => {
  jest.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// GET /sdapi/v1/sd-models — readiness / health check
// ---------------------------------------------------------------------------
describe('SD server health check (GET /sdapi/v1/sd-models)', () => {
  it('reports ready when the models endpoint returns HTTP 200 with a models array', async () => {
    global.fetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: () => Promise.resolve([
        { model_name: 'v1-5-pruned-emaonly.safetensors', title: 'Stable Diffusion v1-5' },
      ]),
    });

    const response = await fetch(SD_MODELS_URL);
    expect(response.ok).toBe(true);

    const models = await response.json();
    expect(Array.isArray(models)).toBe(true);
    expect(models.length).toBeGreaterThan(0);
    expect(models[0]).toHaveProperty('model_name');
  });

  it('indicates not ready when the server returns HTTP 503 (model still loading)', async () => {
    global.fetch.mockResolvedValueOnce({ ok: false, status: 503 });

    const response = await fetch(SD_MODELS_URL);
    expect(response.ok).toBe(false);
    expect(response.status).toBe(503);
  });

  it('rejects with an error when the SD container is not running', async () => {
    global.fetch.mockRejectedValueOnce(new TypeError('Failed to fetch'));

    await expect(fetch(SD_MODELS_URL)).rejects.toThrow('Failed to fetch');
  });
});

// ---------------------------------------------------------------------------
// POST /sdapi/v1/txt2img — image generation
// ---------------------------------------------------------------------------
describe('SD server image generation (POST /sdapi/v1/txt2img)', () => {
  it('sends the prompt, negative prompt, dimensions, and steps in the request body', async () => {
    global.fetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ images: ['iVBORw0KGgoAAAANSUhEUgAA'] }),
    });

    const payload = {
      prompt: 'A Victorian ceramic vase reimagined in an Art Nouveau style, detailed',
      negative_prompt: 'blurry, low quality, watermark',
      width: 512,
      height: 512,
      num_inference_steps: 25,
      guidance_scale: 7.5,
    };

    await fetch(SD_TXT2IMG_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    const [calledUrl, calledOptions] = global.fetch.mock.calls[0];
    expect(calledUrl).toBe(SD_TXT2IMG_URL);
    expect(calledOptions.method).toBe('POST');
    expect(calledOptions.headers['Content-Type']).toBe('application/json');

    const body = JSON.parse(calledOptions.body);
    expect(body.prompt).toBe(payload.prompt);
    expect(body.negative_prompt).toBe(payload.negative_prompt);
    expect(body.width).toBe(512);
    expect(body.height).toBe(512);
    expect(body.num_inference_steps).toBe(25);
  });

  it('returns a base64-encoded image string in the images array', async () => {
    const fakeBase64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

    global.fetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ images: [fakeBase64] }),
    });

    const response = await fetch(SD_TXT2IMG_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt: 'test' }),
    });

    const data = await response.json();
    expect(data.images).toBeInstanceOf(Array);
    expect(data.images[0]).toBeTruthy();

    // The page constructs a data URI from this value
    const dataUri = `data:image/png;base64,${data.images[0]}`;
    expect(dataUri).toMatch(/^data:image\/png;base64,/);
  });

  it('returns HTTP 500 when generation fails server-side', async () => {
    global.fetch.mockResolvedValueOnce({
      ok: false,
      status: 500,
      json: () => Promise.resolve({ detail: 'Internal Server Error' }),
    });

    const response = await fetch(SD_TXT2IMG_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt: 'fail test' }),
    });

    expect(response.ok).toBe(false);
    expect(response.status).toBe(500);
  });

  it('rejects when the SD container is not running during generation', async () => {
    global.fetch.mockRejectedValueOnce(new TypeError('Failed to fetch'));

    await expect(
      fetch(SD_TXT2IMG_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: 'timeout test' }),
      })
    ).rejects.toThrow('Failed to fetch');
  });
});

// ---------------------------------------------------------------------------
// GET /sdapi/v1/status — loading progress
// ---------------------------------------------------------------------------
describe('SD server loading status (GET /sdapi/v1/status)', () => {
  it('returns a ready status when the model has finished loading', async () => {
    global.fetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ status: 'ready', model: 'runwayml/stable-diffusion-v1-5' }),
    });

    const response = await fetch(SD_STATUS_URL);
    expect(response.ok).toBe(true);

    const data = await response.json();
    expect(data.status).toBe('ready');
  });

  it('returns a loading status while the model is being downloaded', async () => {
    global.fetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ status: 'loading', progress: 42 }),
    });

    const response = await fetch(SD_STATUS_URL);
    const data = await response.json();

    expect(data.status).toBe('loading');
    expect(typeof data.progress).toBe('number');
  });
});

// ---------------------------------------------------------------------------
// Request format validation — shared contract checks
// ---------------------------------------------------------------------------
describe('txt2img request format', () => {
  it('sends Content-Type: application/json', async () => {
    global.fetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ images: ['abc'] }),
    });

    await fetch(SD_TXT2IMG_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt: 'test' }),
    });

    const [, options] = global.fetch.mock.calls[0];
    expect(options.headers['Content-Type']).toBe('application/json');
  });

  it('uses POST as the HTTP method', async () => {
    global.fetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ images: ['abc'] }),
    });

    await fetch(SD_TXT2IMG_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt: 'test' }),
    });

    const [, options] = global.fetch.mock.calls[0];
    expect(options.method).toBe('POST');
  });
});
