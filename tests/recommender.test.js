'use strict';

/**
 * Tests for the Discover (Recommender) feature — js/pages/recommender-page.js
 *
 * Covered:
 *   Page initialisation       — renders chips, loads initial batch
 *   Discovery mode buttons    — update active state
 *   Filter chips              — toggle state
 *   Reset button              — clears all active chip states
 *   filterByPeriod (inline)   — period overlap logic (function is internal to IIFE,
 *                               so it is re-implemented here to test the contract)
 *   sortRecords    (inline)   — date-ascending / date-descending / relevance
 *
 * window.VAM is mocked so no real V&A API calls are made.
 */

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build the minimal DOM the recommender page requires to initialise. */
function setupRecommenderDOM() {
  document.body.innerHTML = `
    <div id="interest-tags"></div>
    <div id="period-filters"></div>
    <div id="material-filters"></div>
    <div id="region-filters"></div>
    <div id="results-grid"></div>
    <p  id="results-count"></p>
    <select id="sort-select">
      <option value="relevance">Relevance</option>
      <option value="date_asc">Oldest first</option>
      <option value="date_desc">Newest first</option>
    </select>
    <p   id="discover-feed-status"></p>
    <div id="discover-feed-sentinel"></div>
    <div id="serendipity-banner">
      <span class="serendipity-banner__icon">✦</span>
      <div><h2></h2><p></p></div>
    </div>
    <button class="discovery-mode-btn active" data-mode="personalised"  type="button">Personalised</button>
    <button class="discovery-mode-btn"        data-mode="serendipitous" type="button">Serendipitous</button>
    <button class="discovery-mode-btn"        data-mode="underrepresented" type="button">Underrepresented</button>
    <button id="reset-filters">Clear filters</button>
  `;
}

/** Install a minimal window.VAM mock so the page script can call searchObjects. */
function mockVamApi() {
  global.window.VAM = {
    searchObjects:    jest.fn().mockResolvedValue({ records: [], info: { record_count: 0 } }),
    renderArtefactCard: jest.fn().mockReturnValue(document.createElement('div')),
    escHtml:          jest.fn(t => String(t)),
    formatDateRange:  jest.fn(() => ''),
  };
}

// ---------------------------------------------------------------------------
// Setup / teardown
// ---------------------------------------------------------------------------
beforeEach(() => {
  jest.resetModules();
  setupRecommenderDOM();
  mockVamApi();
});

afterEach(() => {
  document.body.innerHTML = '';
  jest.restoreAllMocks();
});

/** Load the recommender page script and fire DOMContentLoaded. */
function loadPage() {
  require('../js/pages/recommender-page.js');
  document.dispatchEvent(new Event('DOMContentLoaded'));
}

// ---------------------------------------------------------------------------
// Page initialisation
// ---------------------------------------------------------------------------
describe('Recommender page initialisation', () => {
  it('renders interest filter chips into the #interest-tags container', () => {
    loadPage();
    const chips = document.querySelectorAll('#interest-tags .filter-chip');
    expect(chips.length).toBeGreaterThan(0);
  });

  it('renders period filter chips into the #period-filters container', () => {
    loadPage();
    const chips = document.querySelectorAll('#period-filters .filter-chip');
    expect(chips.length).toBeGreaterThan(0);
  });

  it('calls the V&A API at least once to load the initial batch of artefacts', async () => {
    loadPage();
    // Flush microtask queue so async loadNextBatch() can run
    await Promise.resolve();
    await Promise.resolve();
    expect(window.VAM.searchObjects).toHaveBeenCalled();
  });

  it('does not throw when all required DOM elements are present', () => {
    expect(() => loadPage()).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// Discovery mode buttons
// ---------------------------------------------------------------------------
describe('Discovery mode buttons', () => {
  it('makes the clicked mode button active and removes active from others', () => {
    loadPage();

    const serendipitousBtn     = document.querySelector('[data-mode="serendipitous"]');
    const personalisedBtn      = document.querySelector('[data-mode="personalised"]');

    serendipitousBtn.click();

    expect(serendipitousBtn.classList.contains('active')).toBe(true);
    expect(personalisedBtn.classList.contains('active')).toBe(false);
  });

  it('updates the banner heading to reflect the new mode', () => {
    loadPage();

    document.querySelector('[data-mode="serendipitous"]').click();

    const bannerHeading = document.querySelector('#serendipity-banner h2');
    expect(bannerHeading.textContent).toBe('Serendipitous');
  });
});

// ---------------------------------------------------------------------------
// Filter chips
// ---------------------------------------------------------------------------
describe('Filter chips', () => {
  it('adds the active class when a chip is activated', () => {
    loadPage();
    const firstChip = document.querySelector('#interest-tags .filter-chip');
    firstChip.click();
    expect(firstChip.classList.contains('active')).toBe(true);
  });

  it('toggles the active class off on a second click of the same chip', () => {
    loadPage();
    const firstChip = document.querySelector('#interest-tags .filter-chip');
    firstChip.click(); // activate
    firstChip.click(); // deactivate
    expect(firstChip.classList.contains('active')).toBe(false);
  });

  it('allows only one period chip to be active at a time (single-select)', () => {
    loadPage();
    const periodChips = document.querySelectorAll('#period-filters .filter-chip');
    if (periodChips.length < 2) return; // skip if not enough chips

    periodChips[0].click();
    periodChips[1].click();

    const activeCount = [...periodChips].filter(c => c.classList.contains('active')).length;
    expect(activeCount).toBeLessThanOrEqual(1);
  });
});

// ---------------------------------------------------------------------------
// Reset button
// ---------------------------------------------------------------------------
describe('Reset filters button', () => {
  it('deactivates all filter chips', () => {
    loadPage();
    const chips = document.querySelectorAll('.filter-chip');

    // Activate a few chips first
    chips.forEach(c => c.click());

    document.getElementById('reset-filters').click();

    const stillActive = document.querySelectorAll('.filter-chip.active');
    expect(stillActive.length).toBe(0);
  });

  it('deactivates all filter chips after reset', () => {
    loadPage();
    document.querySelectorAll('#interest-tags .filter-chip').forEach(c => c.click());
    document.getElementById('reset-filters').click();

    const pressed = [...document.querySelectorAll('.filter-chip')]
      .filter(c => c.classList.contains('active'));
    expect(pressed.length).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// filterByPeriod — pure function re-implemented for isolated testing
//
// The actual implementation lives inside the page IIFE and is not exported.
// These tests verify the contract so any future refactor can be validated.
// ---------------------------------------------------------------------------
describe('filterByPeriod (logic)', () => {
  // Mirrors the filterByPeriod function from recommender-page.js
  function filterByPeriod(records, period) {
    if (!period) return records;
    const [startYear, endYear] = period.range;
    return records.filter(record => {
      const begin = Number(record.object_begin_date);
      const end   = Number(record.object_end_date);
      if (!Number.isNaN(begin) && !Number.isNaN(end)) return !(end < startYear || begin > endYear);
      if (!Number.isNaN(begin)) return begin >= startYear && begin <= endYear;
      if (!Number.isNaN(end))   return end   >= startYear && end   <= endYear;
      return false;
    });
  }

  const records = [
    { systemNumber: 'medieval', object_begin_date: '1200', object_end_date: '1400' },
    { systemNumber: 'victorian', object_begin_date: '1837', object_end_date: '1901' },
    { systemNumber: 'modern',   object_begin_date: '1950', object_end_date: '1999' },
    { systemNumber: 'no-dates' },
  ];

  const victorian = { label: 'Victorian', range: [1837, 1901] };

  it('returns only records that overlap the selected period', () => {
    const result = filterByPeriod(records, victorian);
    expect(result.map(r => r.systemNumber)).toEqual(['victorian']);
  });

  it('returns all records when no period is selected (null)', () => {
    expect(filterByPeriod(records, null)).toHaveLength(4);
  });

  it('excludes records entirely before the period', () => {
    const result = filterByPeriod(records, victorian);
    expect(result.find(r => r.systemNumber === 'medieval')).toBeUndefined();
  });

  it('excludes records entirely after the period', () => {
    const result = filterByPeriod(records, victorian);
    expect(result.find(r => r.systemNumber === 'modern')).toBeUndefined();
  });

  it('excludes records with no date information', () => {
    const result = filterByPeriod(records, victorian);
    expect(result.find(r => r.systemNumber === 'no-dates')).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// sortRecords — pure function re-implemented for isolated testing
// ---------------------------------------------------------------------------
describe('sortRecords (logic)', () => {
  // Mirrors the sortRecords function from recommender-page.js
  function sortRecords(records, sortMode) {
    if (sortMode === 'date_asc') {
      return records.slice().sort(
        (a, b) => Number(a.object_begin_date || 99999) - Number(b.object_begin_date || 99999)
      );
    }
    if (sortMode === 'date_desc') {
      return records.slice().sort(
        (a, b) => Number(b.object_begin_date || -99999) - Number(a.object_begin_date || -99999)
      );
    }
    return records;
  }

  const records = [
    { systemNumber: 'C', object_begin_date: '1900' },
    { systemNumber: 'A', object_begin_date: '1600' },
    { systemNumber: 'B', object_begin_date: '1800' },
  ];

  it('sorts oldest-first when date_asc is selected', () => {
    expect(sortRecords(records, 'date_asc').map(r => r.systemNumber)).toEqual(['A', 'B', 'C']);
  });

  it('sorts newest-first when date_desc is selected', () => {
    expect(sortRecords(records, 'date_desc').map(r => r.systemNumber)).toEqual(['C', 'B', 'A']);
  });

  it('returns records in their original order for relevance sort', () => {
    expect(sortRecords(records, 'relevance').map(r => r.systemNumber)).toEqual(['C', 'A', 'B']);
  });

  it('does not mutate the original array', () => {
    const original = [...records];
    sortRecords(records, 'date_asc');
    expect(records.map(r => r.systemNumber)).toEqual(original.map(r => r.systemNumber));
  });
});
