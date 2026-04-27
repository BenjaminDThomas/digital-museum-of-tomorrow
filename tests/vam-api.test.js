'use strict';

/**
 * Tests for the V&A Collections API service layer — js/core/vam-api.js
 *
 * Covered:
 *   checkVamApi      — reachability check for the V&A API
 *   searchObjects    — URL construction, response parsing, caching, daily quota
 *   escHtml          — HTML-escaping utility (XSS prevention)
 *   formatDateRange  — human-readable date formatting
 *   renderArtefactCard — creates a populated article DOM element
 *
 * All network calls are intercepted by a jest.fn() mock.
 * localStorage is available via jsdom and is cleared between tests.
 */

const VAM_QUOTA_KEY = 'vam-api-usage-v1';

// ---------------------------------------------------------------------------
// Setup / teardown
// ---------------------------------------------------------------------------
beforeEach(() => {
  jest.resetModules();
  delete global.window.VAM;
  localStorage.clear();
  global.fetch = jest.fn();
  require('../js/core/vam-api.js');
});

afterEach(() => {
  jest.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// checkVamApi — lightweight V&A API health check
// ---------------------------------------------------------------------------
describe('checkVamApi', () => {
  it('returns ok:true when the V&A API responds with HTTP 200', async () => {
    global.fetch.mockResolvedValueOnce({ ok: true, status: 200 });

    const result = await window.VAM.checkVamApi(true);

    expect(result.ok).toBe(true);
    expect(result.message).toBe('V&A API reachable');
  });

  it('returns ok:false and includes the status code when the API returns an error', async () => {
    global.fetch.mockResolvedValueOnce({ ok: false, status: 429 });

    const result = await window.VAM.checkVamApi(true);

    expect(result.ok).toBe(false);
    expect(result.message).toContain('429');
  });

  it('returns ok:false with an error message when the network is unreachable', async () => {
    global.fetch.mockRejectedValueOnce(new Error('Network error'));

    const result = await window.VAM.checkVamApi(true);

    expect(result.ok).toBe(false);
    expect(result.message).toContain('Network error');
  });

  it('returns the cached result on a second call without force', async () => {
    global.fetch.mockResolvedValueOnce({ ok: true, status: 200 });

    await window.VAM.checkVamApi(true);
    const second = await window.VAM.checkVamApi();

    expect(second.ok).toBe(true);
    // Only one real fetch should have been made (the second used the cache)
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// searchObjects — searches the V&A collection with the given parameters
// ---------------------------------------------------------------------------
describe('searchObjects', () => {
  it('includes query parameters in the request URL', async () => {
    global.fetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ records: [], info: { record_count: 0 } }),
    });

    await window.VAM.searchObjects({ q: 'vase', page_size: 6 });

    const [calledUrl] = global.fetch.mock.calls[0];
    expect(calledUrl).toContain('q=vase');
    expect(calledUrl).toContain('page_size=6');
  });

  it('targets the correct V&A API base URL', async () => {
    global.fetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ records: [], info: { record_count: 0 } }),
    });

    await window.VAM.searchObjects({ q: 'test' });

    const [calledUrl] = global.fetch.mock.calls[0];
    expect(calledUrl).toContain('api.vam.ac.uk/v2/objects/search');
  });

  it('returns the records array and total count from the API response', async () => {
    const fakeRecords = [
      { systemNumber: 'O123', _primaryTitle: 'Blue Vase', objectType: 'Vase' },
    ];
    global.fetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ records: fakeRecords, info: { record_count: 1 } }),
    });

    const result = await window.VAM.searchObjects({ q: 'vase' });

    expect(result.records).toHaveLength(1);
    expect(result.records[0].systemNumber).toBe('O123');
    expect(result.info.record_count).toBe(1);
  });

  it('returns a deep clone so mutating the result does not affect the cache', async () => {
    const fakeRecord = { systemNumber: 'O123', _primaryTitle: 'Original Title' };
    global.fetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ records: [fakeRecord], info: { record_count: 1 } }),
    });

    const first = await window.VAM.searchObjects({ q: 'test-clone' });
    first.records[0]._primaryTitle = 'Mutated Title';

    const second = await window.VAM.searchObjects({ q: 'test-clone' });
    expect(second.records[0]._primaryTitle).toBe('Original Title');
  });

  it('throws a daily limit error when the quota has been reached', async () => {
    const today = new Date().toISOString().slice(0, 10);
    localStorage.setItem(VAM_QUOTA_KEY, JSON.stringify({ day: today, count: 3000 }));

    await expect(window.VAM.searchObjects({ q: 'anything' }))
      .rejects.toThrow('daily limit reached');
  });

  it('resets the quota count for a new day', async () => {
    // Simulate yesterday's maxed-out quota
    const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
    localStorage.setItem(VAM_QUOTA_KEY, JSON.stringify({ day: yesterday, count: 3000 }));

    global.fetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ records: [], info: { record_count: 0 } }),
    });

    // Should not throw — the old quota belongs to yesterday
    await expect(window.VAM.searchObjects({ q: 'reset test' })).resolves.toBeDefined();
  });

  it('throws when the API returns a non-200 status', async () => {
    global.fetch.mockResolvedValueOnce({ ok: false, status: 500 });

    await expect(window.VAM.searchObjects({ q: 'error test' }))
      .rejects.toThrow('API error: 500');
  });
});

// ---------------------------------------------------------------------------
// escHtml — prevents XSS by escaping HTML special characters
// ---------------------------------------------------------------------------
describe('escHtml', () => {
  it('escapes ampersands', () => {
    expect(window.VAM.escHtml('A & B')).toBe('A &amp; B');
  });

  it('escapes less-than signs', () => {
    expect(window.VAM.escHtml('<script>')).toBe('&lt;script&gt;');
  });

  it('escapes double quotes', () => {
    expect(window.VAM.escHtml('"quoted"')).toBe('&quot;quoted&quot;');
  });

  it('returns an empty string for null or undefined input', () => {
    expect(window.VAM.escHtml(null)).toBe('');
    expect(window.VAM.escHtml(undefined)).toBe('');
  });

  it('leaves safe plain text unchanged', () => {
    expect(window.VAM.escHtml('Plain text 123')).toBe('Plain text 123');
  });
});

// ---------------------------------------------------------------------------
// formatDateRange — formats a record's date fields into readable text
// ---------------------------------------------------------------------------
describe('formatDateRange', () => {
  it('returns the object_date_text field when it is present', () => {
    expect(window.VAM.formatDateRange({ object_date_text: '18th century' }))
      .toBe('18th century');
  });

  it('combines begin and end dates with an en-dash when both are present', () => {
    expect(window.VAM.formatDateRange({ object_begin_date: '1800', object_end_date: '1850' }))
      .toBe('1800–1850');
  });

  it('returns only the begin date when begin and end are the same', () => {
    expect(window.VAM.formatDateRange({ object_begin_date: '1900', object_end_date: '1900' }))
      .toBe('1900');
  });

  it('returns "Date unknown" when no date information is available', () => {
    expect(window.VAM.formatDateRange({})).toBe('Date unknown');
  });
});

// ---------------------------------------------------------------------------
// renderArtefactCard — creates a populated article element for a collection record
// ---------------------------------------------------------------------------
describe('renderArtefactCard', () => {
  it('returns an article element', () => {
    const card = window.VAM.renderArtefactCard({ systemNumber: 'O1', _primaryTitle: 'Vase' });
    expect(card.tagName.toLowerCase()).toBe('article');
  });

  it('renders the artefact title in the card', () => {
    const card = window.VAM.renderArtefactCard({ systemNumber: 'O2', _primaryTitle: 'Gold Cup' });
    expect(card.textContent).toContain('Gold Cup');
  });

  it('renders the AI recommendation reason when a whyLabel is supplied', () => {
    const card = window.VAM.renderArtefactCard(
      { systemNumber: 'O3', _primaryTitle: 'Silk Panel' },
      'Matches your interests'
    );
    expect(card.textContent).toContain('Matches your interests');
  });

  it('does not render an AI tag when no whyLabel is supplied', () => {
    const card = window.VAM.renderArtefactCard({ systemNumber: 'O4', _primaryTitle: 'Ring' });
    expect(card.querySelector('.artefact-card__ai-tag')).toBeNull();
  });

  it('falls back to "Untitled object" when the record has no title', () => {
    const card = window.VAM.renderArtefactCard({ systemNumber: 'O5' });
    expect(card.textContent).toContain('Untitled object');
  });
});
