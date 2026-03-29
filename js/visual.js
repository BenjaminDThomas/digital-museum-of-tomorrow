'use strict';

function initVisualSearchPage() {
  const uploadZone = document.getElementById('upload-zone');
  if (!uploadZone) return;

  const tfJsUrl = 'https://cdn.jsdelivr.net/npm/@tensorflow/tfjs@4.22.0/dist/tf.min.js';
  const mobileNetUrl = 'https://cdn.jsdelivr.net/npm/@tensorflow-models/mobilenet@2.1.1/dist/mobilenet.min.js';
  const fileInput = document.getElementById('file-input');
  const preview = document.getElementById('upload-preview');
  const previewImage = document.getElementById('preview-img');
  const clearButton = document.getElementById('clear-upload');
  const resultsSection = document.getElementById('results-section');
  const visualResults = document.getElementById('visual-results');
  const resultCount = document.getElementById('result-count');
  const detectedAttributes = document.getElementById('detected-attrs');

  let uploadedBase64 = null;
  let cvModelPromise = null;

  function loadExternalScript(src) {
    return new Promise((resolve, reject) => {
      const existing = document.querySelector(`script[src="${src}"]`);
      if (existing) {
        if (existing.dataset.loaded === 'true') {
          resolve();
          return;
        }
        existing.addEventListener('load', () => resolve(), { once: true });
        existing.addEventListener('error', () => reject(new Error(`Failed to load script: ${src}`)), { once: true });
        return;
      }

      const script = document.createElement('script');
      script.src = src;
      script.async = true;
      script.addEventListener('load', () => {
        script.dataset.loaded = 'true';
        resolve();
      }, { once: true });
      script.addEventListener('error', () => reject(new Error(`Failed to load script: ${src}`)), { once: true });
      document.head.appendChild(script);
    });
  }

  async function ensureComputerVisionModel() {
    if (cvModelPromise) return cvModelPromise;

    cvModelPromise = (async () => {
      await loadExternalScript(tfJsUrl);
      await loadExternalScript(mobileNetUrl);
      return window.mobilenet.load({ version: 2, alpha: 1.0 });
    })();

    return cvModelPromise;
  }

  function normaliseLabel(value) {
    return String(value || '')
      .split(',')[0]
      .replace(/[_-]/g, ' ')
      .trim();
  }

  function rgbToColourName(r, g, b) {
    const rn = r / 255;
    const gn = g / 255;
    const bn = b / 255;
    const max = Math.max(rn, gn, bn);
    const min = Math.min(rn, gn, bn);
    const delta = max - min;
    const lightness = (max + min) / 2;
    const saturation = delta === 0 ? 0 : delta / (1 - Math.abs((2 * lightness) - 1));

    let hue = 0;
    if (delta !== 0) {
      if (max === rn) hue = ((gn - bn) / delta) % 6;
      else if (max === gn) hue = ((bn - rn) / delta) + 2;
      else hue = ((rn - gn) / delta) + 4;
      hue *= 60;
      if (hue < 0) hue += 360;
    }

    if (saturation < 0.15) {
      if (lightness < 0.2) return 'black';
      if (lightness > 0.82) return 'white';
      return 'grey';
    }

    if (hue < 15 || hue >= 345) return 'red';
    if (hue < 40) return 'orange';
    if (hue < 70) return 'yellow';
    if (hue < 165) return 'green';
    if (hue < 205) return 'teal';
    if (hue < 250) return 'blue';
    if (hue < 295) return 'purple';
    return 'pink';
  }

  function extractDominantColours(imageElement) {
    const canvas = document.createElement('canvas');
    canvas.width = 120;
    canvas.height = 120;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(imageElement, 0, 0, canvas.width, canvas.height);

    const pixelData = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
    const bins = new Map();

    for (let i = 0; i < pixelData.length; i += 4) {
      const alpha = pixelData[i + 3];
      if (alpha < 20) continue;
      const r = pixelData[i];
      const g = pixelData[i + 1];
      const b = pixelData[i + 2];
      const colourName = rgbToColourName(r, g, b);
      bins.set(colourName, (bins.get(colourName) || 0) + 1);
    }

    return Array.from(bins.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(entry => entry[0]);
  }

  function buildVisualSearches(predictions, colours) {
    const searches = [];

    predictions.slice(0, 3).forEach(prediction => {
      const label = normaliseLabel(prediction.className);
      if (!label) return;

      searches.push({
        q: `${label} ${colours[0] || ''}`.trim(),
        label: `Detected form: ${label}`,
        confidence: Math.max(0.45, prediction.probability),
      });

      if (colours[1]) {
        searches.push({
          q: `${colours[0]} ${colours[1]} ${label}`.trim(),
          label: `Colour and form match`,
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

  function setUploadPreviewActive(active) {
    uploadZone.classList.toggle('upload-zone--hidden', active);
  }

  function renderSkeletons(count) {
    return Array(count).fill(`
      <div class="result-skeleton-card">
        <div class="skeleton result-skeleton-card__image"></div>
        <div class="result-skeleton-card__body">
          <div class="skeleton result-skeleton-card__line result-skeleton-card__line--short"></div>
          <div class="skeleton result-skeleton-card__line result-skeleton-card__line--long"></div>
          <div class="skeleton result-skeleton-card__line result-skeleton-card__line--medium"></div>
        </div>
      </div>
    `).join('');
  }

  async function loadVisualResults(searches) {
    resultsSection.style.display = 'block';
    visualResults.innerHTML = renderSkeletons(8);
    resultCount.textContent = 'Loading\u2026';

    try {
      const allRecords = [];
      for (const search of searches.slice(0, 3)) {
        const data = await window.VAM.searchObjects({ q: search.q, page_size: 6 });
        (data.records || []).forEach(record => {
          record._whyLabel = search.label;
          record._similarityScore = Math.round((search.confidence || 0.4) * 100);
          allRecords.push(record);
        });
      }

      visualResults.innerHTML = '';
      const bySystemNumber = new Map();
      allRecords.forEach(record => {
        const key = record.systemNumber || record.pk || record.id;
        if (!key) return;
        const existing = bySystemNumber.get(key);
        if (!existing || (record._similarityScore || 0) > (existing._similarityScore || 0)) {
          bySystemNumber.set(key, record);
        }
      });

      const rankedRecords = Array.from(bySystemNumber.values())
        .sort((a, b) => (b._similarityScore || 0) - (a._similarityScore || 0));

      rankedRecords.forEach(record => {
        const card = window.VAM.renderArtefactCard(record, record._whyLabel);
        card.setAttribute('role', 'listitem');
        const score = Math.max(10, Math.min(99, Math.round(record._similarityScore || 40)));
        const bar = document.createElement('div');
        bar.innerHTML = `
          <div class="similarity-score">
            <span>Visual similarity</span>
            <span>${score}%</span>
          </div>
          <div class="confidence-bar">
            <div class="confidence-fill"></div>
          </div>
        `;
        bar.querySelector('.confidence-fill').style.width = `${score}%`;
        card.querySelector('.artefact-card__body').appendChild(bar);
        visualResults.appendChild(card);
      });

      resultCount.textContent = `${rankedRecords.length} visually similar objects`;
      if (!rankedRecords.length) {
        visualResults.innerHTML = '<p class="results-status-message">No matching objects found. Try a different image.</p>';
      }
    } catch (_) {
      visualResults.innerHTML = '<p class="results-status-message">Search failed. Please try again.</p>';
    }
  }

  async function analyseAndSearch() {
    if (!uploadedBase64) return;
    detectedAttributes.innerHTML = '<span class="visual-attr-chip skeleton"></span>'.repeat(3);
    try {
      const model = await ensureComputerVisionModel();
      const predictions = await model.classify(previewImage, 5);
      const colours = extractDominantColours(previewImage);

      const attributes = [
        ...colours.map(colour => `${colour} palette`),
        ...predictions.slice(0, 3).map(prediction => normaliseLabel(prediction.className))
      ].filter(Boolean);

      const searches = buildVisualSearches(predictions, colours);

      detectedAttributes.innerHTML = '';
      attributes.forEach(attribute => {
        const chip = document.createElement('span');
        chip.className = 'visual-attr-chip';
        chip.textContent = attribute;
        detectedAttributes.appendChild(chip);
      });

      await loadVisualResults(searches);
    } catch (_) {
      detectedAttributes.innerHTML = '<p class="visual-error">Could not analyse image automatically. Please try another image.</p>';
    }
  }

  function handleFile(file) {
    if (file.size > 5 * 1024 * 1024) {
      alert('Please upload an image under 5MB.');
      return;
    }
    const reader = new FileReader();
    reader.onload = event => {
      previewImage.src = event.target.result;
      uploadedBase64 = event.target.result.split(',')[1];
      setUploadPreviewActive(true);
      preview.classList.add('show');
      analyseAndSearch();
    };
    reader.readAsDataURL(file);
  }

  uploadZone.addEventListener('dragover', event => {
    event.preventDefault();
    uploadZone.classList.add('drag-over');
  });
  uploadZone.addEventListener('dragleave', () => uploadZone.classList.remove('drag-over'));
  uploadZone.addEventListener('drop', event => {
    event.preventDefault();
    uploadZone.classList.remove('drag-over');
    const file = event.dataTransfer.files[0];
    if (file && file.type.startsWith('image/')) handleFile(file);
  });
  uploadZone.addEventListener('keydown', event => {
    if (event.key === 'Enter' || event.key === ' ') fileInput.click();
  });
  fileInput.addEventListener('change', () => {
    if (fileInput.files[0]) handleFile(fileInput.files[0]);
  });
  clearButton.addEventListener('click', () => {
    uploadedBase64 = null;
    preview.classList.remove('show');
    previewImage.removeAttribute('src');
    fileInput.value = '';
    detectedAttributes.innerHTML = '';
    setUploadPreviewActive(false);
  });
}

document.addEventListener('DOMContentLoaded', () => {
  initVisualSearchPage();
});
