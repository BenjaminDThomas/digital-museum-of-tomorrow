/* =========================================
   MAIN JS — V&A AI Collection Explorer
   ========================================= */

'use strict';

// ---- Nav toggle ----
const navToggle = document.querySelector('.nav-toggle');
const mainNav   = document.querySelector('.main-nav');
if (navToggle && mainNav) {
  navToggle.addEventListener('click', () => {
    const open = navToggle.getAttribute('aria-expanded') === 'true';
    navToggle.setAttribute('aria-expanded', String(!open));
    mainNav.classList.toggle('open', !open);
  });
  // Close on Escape
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && mainNav.classList.contains('open')) {
      navToggle.setAttribute('aria-expanded', 'false');
      mainNav.classList.remove('open');
      navToggle.focus();
    }
  });
}

// ---- Accessibility toolbar ----
function injectA11yToolbar() {
  const toolbar = document.createElement('aside');
  toolbar.className = 'a11y-toolbar';
  toolbar.setAttribute('aria-label', 'Accessibility tools');

  const largeTextBtn = createA11yBtn('Aa', 'Toggle large text', () => {
    document.body.classList.toggle('large-text');
    localStorage.setItem('vam-large-text', document.body.classList.contains('large-text'));
  });

  const contrastBtn = createA11yBtn('◑', 'Toggle high contrast', () => {
    document.body.classList.toggle('high-contrast');
    localStorage.setItem('vam-high-contrast', document.body.classList.contains('high-contrast'));
  });

  toolbar.append(largeTextBtn, contrastBtn);
  const headerInner = document.querySelector('.header-inner');
  const navToggle = document.querySelector('.nav-toggle');
  if (headerInner && navToggle) {
    headerInner.insertBefore(toolbar, navToggle);
  } else if (headerInner) {
    headerInner.appendChild(toolbar);
  } else {
    document.body.appendChild(toolbar);
  }

  // Restore preferences
  if (localStorage.getItem('vam-large-text') === 'true') document.body.classList.add('large-text');
  if (localStorage.getItem('vam-high-contrast') === 'true') document.body.classList.add('high-contrast');
}

function createA11yBtn(icon, label, onClick) {
  const btn = document.createElement('button');
  btn.className = 'a11y-btn';
  btn.setAttribute('aria-label', label);
  btn.setAttribute('type', 'button');
  btn.textContent = icon;
  btn.addEventListener('click', onClick);
  return btn;
}

// ---- Smooth reveal on scroll ----
function initScrollReveal() {
  const items = document.querySelectorAll('.tool-card, .trust-pillar, .artefact-card');
  if (!window.IntersectionObserver) return;
  const obs = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        entry.target.style.opacity = '1';
        entry.target.style.transform = 'translateY(0)';
        obs.unobserve(entry.target);
      }
    });
  }, { threshold: 0.1 });

  items.forEach((el, i) => {
    el.style.opacity = '0';
    el.style.transform = 'translateY(20px)';
    el.style.transition = `opacity 0.5s ease ${i * 0.07}s, transform 0.5s ease ${i * 0.07}s`;
    obs.observe(el);
  });
}

// ---- V&A API helper ----
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
    // If storage is blocked, continue without persistence.
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
    const res = await enqueueVamRequest(() => fetchWithTimeout(`${VAM_API}/objects/search?q=test&page_size=1`));
    vamApiStatus = {
      ok: res.ok,
      status: res.status,
      message: res.ok ? 'V&A API reachable' : `V&A API returned ${res.status}`
    };
    return vamApiStatus;
  } catch (err) {
    vamApiStatus = {
      ok: false,
      status: 0,
      message: `V&A API unreachable: ${err.message}`
    };
    return vamApiStatus;
  }
}

async function searchObjects(params = {}) {
  const health = await checkVamApi();
  if (!health.ok) throw new Error(health.message);

  const url = new URL(`${VAM_API}/objects/search`);
  Object.entries(params).forEach(([k, v]) => {
    if (Array.isArray(v)) v.forEach(val => url.searchParams.append(k, val));
    else url.searchParams.set(k, v);
  });
  const cacheKey = url.toString();
  const cached = vamResponseCache.get(cacheKey);
  if (cached && Date.now() - cached.at <= VAM_CACHE_TTL_MS) {
    return deepClone(cached.payload);
  }

  const res = await enqueueVamRequest(() => fetchWithTimeout(cacheKey));
  if (!res.ok) throw new Error(`API error: ${res.status}`);
  const payload = await res.json();
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

  const res = await enqueueVamRequest(() => fetchWithTimeout(url));
  if (!res.ok) throw new Error(`API error: ${res.status}`);
  const payload = await res.json();
  vamResponseCache.set(url, { at: Date.now(), payload });
  return deepClone(payload);
}

// ---- Image helper ----
function getArtefactImageUrl(record, size = 'medium') {
  const imgId = record?._images?._primary_thumbnail || record?._images?._iiif_image_base_url;
  if (!imgId) return null;
  // V&A image service
  if (record._images._iiif_image_base_url) {
    const base = record._images._iiif_image_base_url;
    const w = size === 'thumb' ? 200 : size === 'medium' ? 400 : 800;
    return `${base}/full/${w},/0/default.jpg`;
  }
  return imgId;
}

// ---- Format date range ----
function formatDateRange(record) {
  const parts = [];
  if (record.object_date_text) return record.object_date_text;
  if (record.object_begin_date) parts.push(record.object_begin_date);
  if (record.object_end_date && record.object_end_date !== record.object_begin_date) parts.push(record.object_end_date);
  return parts.length ? parts.join('–') : 'Date unknown';
}

// ---- Render artefact card ----
function renderArtefactCard(record, whyLabel = null) {
  const card = document.createElement('article');
  card.className = 'artefact-card';
  const imgUrl = getArtefactImageUrl(record);
  const title = record._primaryTitle || record.objectType || 'Untitled object';
  const category = record.objectType || '';
  const date = formatDateRange(record);
  const systemNumber = record.systemNumber || '';

  card.innerHTML = `
    <div class="artefact-card__image">
      ${imgUrl
        ? `<img src="${imgUrl}" alt="${escHtml(title)}" loading="lazy" />`
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
  card.style.cursor = 'pointer';
  return card;
}

// ---- Artefact detail modal ----
function openArtefactModal(record, systemNumber) {
  const existing = document.getElementById('artefact-modal');
  if (existing) existing.remove();

  const modal = document.createElement('dialog');
  modal.id = 'artefact-modal';
  modal.className = 'artefact-modal';
  modal.setAttribute('aria-labelledby', 'modal-title');
  modal.setAttribute('aria-modal', 'true');

  const imgUrl = getArtefactImageUrl(record, 'large');
  const title = record._primaryTitle || record.objectType || 'Untitled object';
  const desc = record._primaryDescription?.[0]?.value || record.briefDescription || '';

  modal.innerHTML = `
    <div class="artefact-modal__inner">
      <button class="artefact-modal__close" aria-label="Close artefact detail">✕</button>
      <div class="artefact-modal__grid">
        <div class="artefact-modal__image">
          ${imgUrl ? `<img src="${imgUrl}" alt="${escHtml(title)}" />` : '<div class="artefact-card__image-placeholder artefact-card__image-placeholder-300">🏺</div>'}
        </div>
        <div class="artefact-modal__content">
          <p class="section-eyebrow">${escHtml(record.objectType || '')}</p>
          <h2 id="modal-title" class="artefact-modal__title">${escHtml(title)}</h2>
          <p class="artefact-modal__meta">${escHtml(formatDateRange(record))}</p>
          ${desc ? `<p class="artefact-modal__desc">${escHtml(desc)}</p>` : ''}
          <div class="bias-notice">
            <span class="bias-notice__icon">ℹ</span>
            <span>This record is from the V&A Collections API. Descriptions reflect historical cataloguing and may contain dated terminology. <a href="pages/transparency.html" class="link-accent-dim">Learn more about our approach.</a></span>
          </div>
          ${systemNumber ? `<a href="https://collections.vam.ac.uk/item/${systemNumber}/" target="_blank" rel="noopener noreferrer" class="btn btn--ghost btn-mt-6">View on V&A website ↗</a>` : ''}
        </div>
      </div>
    </div>
  `;

  document.body.appendChild(modal);
  modal.showModal();

  modal.querySelector('.artefact-modal__close').addEventListener('click', () => modal.remove());
  modal.addEventListener('click', e => { if (e.target === modal) modal.remove(); });
  document.addEventListener('keydown', function close(e) {
    if (e.key === 'Escape') { modal.remove(); document.removeEventListener('keydown', close); }
  });
}

// ---- Escape HTML ----
function escHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ---- Artefact modal styles ----
function injectModalStyles() {
  const style = document.createElement('style');
  style.textContent = `
    .artefact-modal {
      padding: 0;
      border: 1px solid var(--clr-border-light);
      border-radius: var(--radius-xl);
      background: var(--clr-surface);
      color: var(--clr-text);
      max-width: 880px;
      width: 90vw;
      max-height: 90vh;
      overflow-y: auto;
      box-shadow: var(--shadow-lg);
    }
    .artefact-modal::backdrop { background: rgba(0,0,0,0.7); backdrop-filter: blur(4px); }
    .artefact-modal__inner { position: relative; padding: var(--sp-8); }
    .artefact-modal__close {
      position: absolute; top: var(--sp-4); right: var(--sp-4);
      width: 36px; height: 36px;
      display: flex; align-items: center; justify-content: center;
      background: var(--clr-surface-3);
      border: 1px solid var(--clr-border);
      border-radius: 50%;
      color: var(--clr-text-muted);
      cursor: pointer; font-size: 14px;
      transition: all var(--transition-fast);
    }
    .artefact-modal__close:hover { background: var(--clr-surface-2); color: var(--clr-text); }
    .artefact-modal__grid { display: grid; grid-template-columns: 1fr 1fr; gap: var(--sp-8); }
    .artefact-modal__image img { width: 100%; border-radius: var(--radius-md); }
    @media (max-width: 640px) { .artefact-modal__grid { grid-template-columns: 1fr; } }
  `;
  document.head.appendChild(style);
}

// ---- Exports for sub-pages ----
window.VAM = {
  searchObjects,
  getObject,
  checkVamApi,
  getArtefactImageUrl,
  renderArtefactCard,
  formatDateRange,
  escHtml,
};

// ---- Init ----
document.addEventListener('DOMContentLoaded', () => {
  injectA11yToolbar();
  injectModalStyles();
  initScrollReveal();
});
