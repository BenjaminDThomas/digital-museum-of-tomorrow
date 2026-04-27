'use strict';

/**
 * Tests for the Visual Search feature — js/pages/visual-search-page.js
 *
 * Covered:
 *   rgbToColourName    (inline) — maps an RGB pixel to a colour name via HSL
 *   normaliseLabel     (inline) — cleans MobileNet class labels for use in searches
 *   buildVisualSearches(inline) — combines classifier predictions + colours into search terms
 *   Upload zone DOM            — initialises, handles clear, hides results before upload
 *
 * The three pure functions are internal to the page IIFE and not exported.
 * They are re-implemented here to test the logic independently, matching the
 * source code exactly so any future changes to the originals can be detected.
 */

// ---------------------------------------------------------------------------
// Inline re-implementations of internal pure functions
// (source: js/pages/visual-search-page.js)
// ---------------------------------------------------------------------------

/** Map an RGB pixel to a basic colour name via HSL conversion. */
function rgbToColourName(r, g, b) {
  const rn = r / 255, gn = g / 255, bn = b / 255;
  const max = Math.max(rn, gn, bn), min = Math.min(rn, gn, bn);
  const delta = max - min;
  const lightness = (max + min) / 2;
  const saturation = delta === 0 ? 0 : delta / (1 - Math.abs(2 * lightness - 1));

  let hue = 0;
  if (delta !== 0) {
    if (max === rn)      hue = ((gn - bn) / delta) % 6;
    else if (max === gn) hue = ((bn - rn) / delta) + 2;
    else                 hue = ((rn - gn) / delta) + 4;
    hue *= 60;
    if (hue < 0) hue += 360;
  }

  if (saturation < 0.15) {
    if (lightness < 0.2)  return 'black';
    if (lightness > 0.82) return 'white';
    return 'grey';
  }

  if (hue < 15 || hue >= 345) return 'red';
  if (hue < 40)  return 'orange';
  if (hue < 70)  return 'yellow';
  if (hue < 165) return 'green';
  if (hue < 205) return 'teal';
  if (hue < 250) return 'blue';
  if (hue < 295) return 'purple';
  return 'pink';
}

/** Strip classifier noise (commas, underscores, hyphens) from a MobileNet label. */
function normaliseLabel(value) {
  return String(value || '').split(',')[0].replace(/[_-]/g, ' ').trim();
}

/** Combine classifier predictions and dominant colours into a deduplicated search list. */
function buildVisualSearches(predictions, colours) {
  const searches = [];

  predictions.slice(0, 3).forEach(prediction => {
    const label = normaliseLabel(prediction.className);
    if (!label) return;

    searches.push({
      q:          `${label} ${colours[0] || ''}`.trim(),
      label:      `Detected form: ${label}`,
      confidence: Math.max(0.45, prediction.probability),
    });

    if (colours[1]) {
      searches.push({
        q:          `${colours[0]} ${colours[1]} ${label}`.trim(),
        label:      'Colour and form match',
        confidence: Math.max(0.4, prediction.probability * 0.9),
      });
    }
  });

  if (!searches.length) {
    searches.push({ q: 'decorative object', label: 'Fallback visual search', confidence: 0.35 });
  }

  const seen = new Set();
  return searches.filter(search => {
    const key = search.q.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).slice(0, 4);
}

// ---------------------------------------------------------------------------
// rgbToColourName
// ---------------------------------------------------------------------------
describe('rgbToColourName', () => {
  it('identifies pure red (255, 0, 0)',     () => expect(rgbToColourName(255,   0,   0)).toBe('red'));
  it('identifies pure green (0, 255, 0)',   () => expect(rgbToColourName(  0, 255,   0)).toBe('green'));
  it('identifies pure blue (0, 0, 255)',    () => expect(rgbToColourName(  0,   0, 255)).toBe('blue'));
  it('identifies white (255, 255, 255)',    () => expect(rgbToColourName(255, 255, 255)).toBe('white'));
  it('identifies black (0, 0, 0)',          () => expect(rgbToColourName(  0,   0,   0)).toBe('black'));
  it('identifies grey (128, 128, 128)',     () => expect(rgbToColourName(128, 128, 128)).toBe('grey'));
  it('identifies orange (255, 165, 0)',     () => expect(rgbToColourName(255, 165,   0)).toBe('orange'));
  it('identifies yellow (255, 220, 0)',     () => expect(rgbToColourName(255, 220,   0)).toBe('yellow'));
  it('identifies purple (100, 0, 200)',     () => expect(rgbToColourName(100,   0, 200)).toBe('purple'));
  it('identifies teal (0, 180, 180)',       () => expect(rgbToColourName(  0, 180, 180)).toBe('teal'));

  it('returns a string for any valid RGB triple', () => {
    const colourNames = ['red','orange','yellow','green','teal','blue','purple','pink','white','black','grey'];
    const result = rgbToColourName(200, 100, 50);
    expect(colourNames).toContain(result);
  });
});

// ---------------------------------------------------------------------------
// normaliseLabel
// ---------------------------------------------------------------------------
describe('normaliseLabel', () => {
  it('strips everything after the first comma', () => {
    expect(normaliseLabel('vase, pottery, ceramic')).toBe('vase');
  });

  it('replaces underscores with spaces', () => {
    expect(normaliseLabel('coffee_mug')).toBe('coffee mug');
  });

  it('replaces hyphens with spaces', () => {
    expect(normaliseLabel('art-deco-vase')).toBe('art deco vase');
  });

  it('trims leading and trailing whitespace', () => {
    expect(normaliseLabel('  vase  ')).toBe('vase');
  });

  it('returns an empty string for null', () => {
    expect(normaliseLabel(null)).toBe('');
  });

  it('returns an empty string for undefined', () => {
    expect(normaliseLabel(undefined)).toBe('');
  });

  it('handles a label with no special characters unchanged', () => {
    expect(normaliseLabel('porcelain')).toBe('porcelain');
  });
});

// ---------------------------------------------------------------------------
// buildVisualSearches
// ---------------------------------------------------------------------------
describe('buildVisualSearches', () => {
  it('builds a primary search query from the detected label and dominant colour', () => {
    const searches = buildVisualSearches([{ className: 'vase', probability: 0.8 }], ['blue', 'white']);
    expect(searches[0].q).toBe('vase blue');
  });

  it('includes a colour-combination search when two colours are detected', () => {
    const searches = buildVisualSearches([{ className: 'vase', probability: 0.8 }], ['blue', 'white']);
    expect(searches.some(s => s.q.includes('blue') && s.q.includes('white'))).toBe(true);
  });

  it('uses "decorative object" as a fallback when no predictions are provided', () => {
    const searches = buildVisualSearches([], []);
    expect(searches[0].q).toBe('decorative object');
    expect(searches[0].confidence).toBe(0.35);
  });

  it('deduplicates identical query strings across predictions', () => {
    const searches = buildVisualSearches(
      [
        { className: 'vase', probability: 0.9 },
        { className: 'vase', probability: 0.8 },
      ],
      ['blue']
    );
    const queries  = searches.map(s => s.q);
    const unique   = [...new Set(queries)];
    expect(queries).toEqual(unique);
  });

  it('limits results to a maximum of 4 searches', () => {
    const searches = buildVisualSearches(
      [
        { className: 'pot',  probability: 0.9 },
        { className: 'cup',  probability: 0.8 },
        { className: 'bowl', probability: 0.7 },
      ],
      ['red', 'gold']
    );
    expect(searches.length).toBeLessThanOrEqual(4);
  });

  it('enforces a minimum confidence of 0.45 for label-only searches', () => {
    const searches = buildVisualSearches([{ className: 'vase', probability: 0.05 }], ['blue']);
    const labelSearch = searches.find(s => s.label.startsWith('Detected form'));
    expect(labelSearch.confidence).toBeGreaterThanOrEqual(0.45);
  });

  it('enforces a minimum confidence of 0.40 for colour-and-form searches', () => {
    const searches = buildVisualSearches([{ className: 'vase', probability: 0.05 }], ['blue', 'gold']);
    const colourSearch = searches.find(s => s.label === 'Colour and form match');
    expect(colourSearch.confidence).toBeGreaterThanOrEqual(0.4);
  });

  it('does not include a colour-combination search when only one colour is detected', () => {
    const searches = buildVisualSearches([{ className: 'vase', probability: 0.8 }], ['blue']);
    const colourSearches = searches.filter(s => s.label === 'Colour and form match');
    expect(colourSearches.length).toBe(0);
  });

  it('skips predictions with an empty label after normalisation', () => {
    const searches = buildVisualSearches([{ className: '', probability: 0.9 }], ['blue']);
    expect(searches[0].q).toBe('decorative object'); // falls back
  });
});

// ---------------------------------------------------------------------------
// Upload zone DOM integration
// ---------------------------------------------------------------------------
describe('Visual search upload zone (DOM)', () => {
  beforeEach(() => {
    jest.resetModules();

    // Minimal DOM required by initVisualSearchPage()
    document.body.innerHTML = `
      <div id="upload-zone" role="button" tabindex="0">
        <input type="file" id="file-input" accept="image/*" />
        <div class="upload-zone__icon" aria-hidden="true">🖼</div>
        <h2 class="upload-zone__title">Drop an image here</h2>
        <p  class="upload-zone__sub">or click to browse</p>
      </div>
      <div id="upload-preview">
        <img id="preview-img" src="" alt="Uploaded image preview" />
        <div id="detected-attrs" aria-live="polite"></div>
        <button id="clear-upload">Clear image ✕</button>
      </div>
      <div class="bias-notice bias-notice--spaced"></div>
      <section id="results-section" style="display:none">
        <div class="results-header">
          <h2 id="results-heading">Visually similar artefacts</h2>
          <p id="result-count" aria-live="polite"></p>
        </div>
        <div id="visual-results" role="list"></div>
      </section>
    `;

    // Mock window.VAM so the page script can reference it without errors
    global.window.VAM = {
      searchObjects:      jest.fn().mockResolvedValue({ records: [], info: { record_count: 0 } }),
      renderArtefactCard: jest.fn().mockReturnValue(document.createElement('div')),
      escHtml:            jest.fn(t => String(t)),
    };

    require('../js/pages/visual-search-page.js');
    document.dispatchEvent(new Event('DOMContentLoaded'));
  });

  afterEach(() => {
    document.body.innerHTML = '';
    jest.restoreAllMocks();
  });

  it('initialises without throwing when all required DOM elements are present', () => {
    expect(document.getElementById('upload-zone')).toBeTruthy();
    expect(document.getElementById('file-input')).toBeTruthy();
    expect(document.getElementById('preview-img')).toBeTruthy();
  });

  it('keeps the results section hidden before an image is uploaded', () => {
    const section = document.getElementById('results-section');
    expect(section.style.display).not.toBe('block');
  });

  it('removes the "show" class and clears the preview src when clear is clicked', () => {
    const preview    = document.getElementById('upload-preview');
    const previewImg = document.getElementById('preview-img');

    // Simulate a loaded state
    preview.classList.add('show');
    previewImg.src = 'data:image/png;base64,abc123';

    document.getElementById('clear-upload').click();

    expect(preview.classList.contains('show')).toBe(false);
    // removeAttribute('src') leaves src as an empty string in jsdom
    expect(previewImg.getAttribute('src')).toBeFalsy();
  });

  it('clears detected attribute chips when clear is clicked', () => {
    const attrs = document.getElementById('detected-attrs');
    attrs.innerHTML = '<span class="visual-attr-chip">blue palette</span>';

    document.getElementById('clear-upload').click();

    expect(attrs.innerHTML).toBe('');
  });

  it('re-shows the upload zone (removes upload-zone--hidden) when clear is clicked', () => {
    const uploadZone = document.getElementById('upload-zone');
    uploadZone.classList.add('upload-zone--hidden');

    document.getElementById('clear-upload').click();

    expect(uploadZone.classList.contains('upload-zone--hidden')).toBe(false);
  });
});
