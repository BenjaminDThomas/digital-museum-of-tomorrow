'use strict';

(function initVamApi() {
  const VAM_API = 'https://api.vam.ac.uk/v2';
  const VAM_RATE_LIMIT_MS = 1000;
  const VAM_DAILY_LIMIT = 3000;
  const VAM_DAILY_USAGE_KEY = 'vam-api-usage-v1';
  const VAM_CACHE_TTL_MS = 60 * 1000;
  let vamApiStatus = null;
  let vamLastRequestAt = 0;
  let vamQueue = Promise.resolve();
  const vamResponseCache = new Map();

  function getIsoDateKey(date = new Date()) {
    return date.toISOString().slice(0, 10);
  }

  function readVamDailyUsage() {
    try {
      const raw = localStorage.getItem(VAM_DAILY_USAGE_KEY);
      if (!raw) return { day: getIsoDateKey(), count: 0 };
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed.day !== 'string' || typeof parsed.count !== 'number') {
        return { day: getIsoDateKey(), count: 0 };
      }
      if (parsed.day !== getIsoDateKey()) {
        return { day: getIsoDateKey(), count: 0 };
      }
      return parsed;
    } catch (_) {
      return { day: getIsoDateKey(), count: 0 };
    }
  }

  function writeVamDailyUsage(usage) {
    try {
      localStorage.setItem(VAM_DAILY_USAGE_KEY, JSON.stringify(usage));
    } catch (_) {
      // Ignore blocked storage.
    }
  }

  function consumeDailyQuota() {
    const usage = readVamDailyUsage();
    if (usage.count >= VAM_DAILY_LIMIT) {
      throw new Error(`V&A API daily limit reached (${VAM_DAILY_LIMIT}). Please try again tomorrow.`);
    }
    usage.count += 1;
    writeVamDailyUsage(usage);
  }

  function deepClone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  async function enqueueVamRequest(task) {
    const run = async () => {
      const now = Date.now();
      const waitMs = Math.max(0, VAM_RATE_LIMIT_MS - (now - vamLastRequestAt));
      if (waitMs > 0) {
        await new Promise(resolve => setTimeout(resolve, waitMs));
      }

      consumeDailyQuota();
      vamLastRequestAt = Date.now();
      return task();
    };

    const scheduled = vamQueue.then(run, run);
    vamQueue = scheduled.then(() => undefined, () => undefined);
    return scheduled;
  }

  async function fetchWithTimeout(url, options = {}, timeoutMs = 10000) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      return await fetch(url, { ...options, signal: controller.signal });
    } finally {
      clearTimeout(timeout);
    }
  }

  async function checkVamApi(force = false) {
    if (!force && vamApiStatus) return vamApiStatus;
    try {
      const response = await enqueueVamRequest(() => fetchWithTimeout(`${VAM_API}/objects/search?q=test&page_size=1`));
      vamApiStatus = {
        ok: response.ok,
        status: response.status,
        message: response.ok ? 'V&A API reachable' : `V&A API returned ${response.status}`
      };
      return vamApiStatus;
    } catch (error) {
      vamApiStatus = {
        ok: false,
        status: 0,
        message: `V&A API unreachable: ${error.message}`
      };
      return vamApiStatus;
    }
  }

  async function searchObjects(params = {}) {
    const health = await checkVamApi();
    if (!health.ok) throw new Error(health.message);

    const url = new URL(`${VAM_API}/objects/search`);
    const hasValue = value => value !== null && value !== undefined && !(typeof value === 'string' && value.trim() === '');

    Object.entries(params).forEach(([key, value]) => {
      if (Array.isArray(value)) {
        value.filter(hasValue).forEach(item => url.searchParams.append(key, item));
        return;
      }
      if (!hasValue(value)) return;
      url.searchParams.set(key, typeof value === 'string' ? value.trim() : value);
    });

    const cacheKey = url.toString();
    const cached = vamResponseCache.get(cacheKey);
    if (cached && Date.now() - cached.at <= VAM_CACHE_TTL_MS) {
      return deepClone(cached.payload);
    }

    const response = await enqueueVamRequest(() => fetchWithTimeout(cacheKey));
    if (!response.ok) throw new Error(`API error: ${response.status}`);
    const payload = await response.json();
    vamResponseCache.set(cacheKey, { at: Date.now(), payload });
    return deepClone(payload);
  }

  async function getObject(id) {
    const health = await checkVamApi();
    if (!health.ok) throw new Error(health.message);

    const url = `${VAM_API}/object/${id}`;
    const cached = vamResponseCache.get(url);
    if (cached && Date.now() - cached.at <= VAM_CACHE_TTL_MS) {
      return deepClone(cached.payload);
    }

    const response = await enqueueVamRequest(() => fetchWithTimeout(url));
    if (!response.ok) throw new Error(`API error: ${response.status}`);
    const payload = await response.json();
    vamResponseCache.set(url, { at: Date.now(), payload });
    return deepClone(payload);
  }

  function getArtefactImageUrl(record, size = 'medium') {
    const imageId = record?._images?._primary_thumbnail || record?._images?._iiif_image_base_url;
    if (!imageId) return null;
    if (record._images._iiif_image_base_url) {
      const base = record._images._iiif_image_base_url;
      const width = size === 'thumb' ? 200 : size === 'medium' ? 400 : 800;
      return `${base}/full/${width},/0/default.jpg`;
    }
    return imageId;
  }

  function formatDateRange(record) {
    const parts = [];
    if (record.object_date_text) return record.object_date_text;
    if (record.object_begin_date) parts.push(record.object_begin_date);
    if (record.object_end_date && record.object_end_date !== record.object_begin_date) parts.push(record.object_end_date);
    return parts.length ? parts.join('–') : 'Date unknown';
  }

  function escHtml(str) {
    if (!str) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function openArtefactModal(record, systemNumber) {
    const existing = document.getElementById('artefact-modal');
    if (existing) existing.remove();

    const modal = document.createElement('dialog');
    modal.id = 'artefact-modal';
    modal.className = 'artefact-modal';
    modal.setAttribute('aria-labelledby', 'modal-title');
    modal.setAttribute('aria-modal', 'true');

    const imageUrl = getArtefactImageUrl(record, 'large');
    const title = record._primaryTitle || record.objectType || 'Untitled object';
    const description = record._primaryDescription?.[0]?.value || record.briefDescription || '';

    modal.innerHTML = `
      <div class="artefact-modal__inner">
        <button class="artefact-modal__close" aria-label="Close artefact detail">✕</button>
        <div class="artefact-modal__grid">
          <div class="artefact-modal__image">
            ${imageUrl ? `<img src="${imageUrl}" alt="${escHtml(title)}" />` : '<div class="artefact-card__image-placeholder artefact-card__image-placeholder-300">🏺</div>'}
          </div>
          <div class="artefact-modal__content">
            <p class="section-eyebrow">${escHtml(record.objectType || '')}</p>
            <h2 id="modal-title" class="artefact-modal__title">${escHtml(title)}</h2>
            <p class="artefact-modal__meta">${escHtml(formatDateRange(record))}</p>
            ${description ? `<p class="artefact-modal__desc">${escHtml(description)}</p>` : ''}
            <div class="bias-notice">
              <span class="bias-notice__icon">ℹ</span>
              <span>This record is from the V&A Collections API. Descriptions reflect historical cataloguing and may contain dated terminology. <a href="pages/transparency.html" class="link-accent-dim">Learn more about our approach.</a></span>
            </div>
            ${systemNumber ? `<a href="https://collections.vam.ac.uk/item/${systemNumber}/" target="_blank" rel="noopener noreferrer" class="btn btn--ghost btn-mt-6">View source record ↗</a>` : ''}
          </div>
        </div>
      </div>
    `;

    document.body.appendChild(modal);
    modal.showModal();

    modal.querySelector('.artefact-modal__close').addEventListener('click', () => modal.remove());
    modal.addEventListener('click', event => {
      if (event.target === modal) modal.remove();
    });
    document.addEventListener('keydown', function close(event) {
      if (event.key === 'Escape') {
        modal.remove();
        document.removeEventListener('keydown', close);
      }
    });
  }

  function renderArtefactCard(record, whyLabel = null) {
    const card = document.createElement('article');
    card.className = 'artefact-card';
    const imageUrl = getArtefactImageUrl(record);
    const title = record._primaryTitle || record.objectType || 'Untitled object';
    const category = record.objectType || '';
    const date = formatDateRange(record);
    const systemNumber = record.systemNumber || '';

    card.innerHTML = `
      <div class="artefact-card__image">
        ${imageUrl
          ? `<img src="${imageUrl}" alt="${escHtml(title)}" loading="lazy" />`
          : `<div class="artefact-card__image-placeholder" aria-hidden="true">🏺</div>`
        }
      </div>
      <div class="artefact-card__body">
        ${category ? `<p class="artefact-card__category">${escHtml(category)}</p>` : ''}
        <h3 class="artefact-card__title">${escHtml(title)}</h3>
        <p class="artefact-card__date">${escHtml(date)}</p>
        ${whyLabel ? `
          <div class="artefact-card__ai-tag">
            <span class="ai-badge" aria-label="AI recommendation reason">✦ AI</span>
            <span>${escHtml(whyLabel)}</span>
          </div>` : ''}
      </div>
    `;

    card.addEventListener('click', () => openArtefactModal(record, systemNumber));
    return card;
  }

  window.VAM = {
    searchObjects,
    checkVamApi,
    getObject,
    getArtefactImageUrl,
    renderArtefactCard,
    openArtefactModal,
    formatDateRange,
    escHtml,
  };
})();
