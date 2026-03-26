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

function initTransparencyPage() {
  const faqList = document.getElementById('faq-list');
  if (!faqList) return;

  const faqs = [
    {
      q: 'Is the AI making things up about artefacts?',
      a: 'The chatbot draws on actual V&A Collections API data. However, large language models can sometimes combine information incorrectly or fill in gaps with plausible but inaccurate details — this is called "hallucination". Every AI response includes a disclaimer and links to the authoritative V&A record. Always verify important information with V&A curators or official collections pages.'
    },
    {
      q: 'Does the recommender create a filter bubble?',
      a: 'We have explicitly designed against this. Alongside personalised recommendations, we offer a "Serendipitous" mode that surfaces random objects across the whole collection, and an "Underrepresented" mode that deliberately shows objects from less commonly visited collections. Your interest preferences are applied loosely, and we intentionally inject diversity into results. You can also clear all preferences at any time.'
    },
    {
      q: 'Why are some artefact descriptions in old or offensive language?',
      a: 'The V&A holds records dating back to the 19th century. Some historical catalogue entries use terminology that is now considered outdated, disrespectful, or reflecting colonial viewpoints. We display this data as it exists in the API, but our AI tools are instructed to flag such language where possible. We are actively working with the museum to improve catalogue descriptions. If you spot something harmful, please report it using the link above.'
    },
    {
      q: 'How is my data used?',
      a: 'We do not create user accounts, require logins, or store personal information. Your interest preferences are saved to your browser\'s local storage only — they are never sent to our servers. Uploaded images in the Visual Search tool are sent to the AI model for analysis only and are not stored. Chat messages within a session are used to maintain conversation context but are not retained after you close the browser.'
    },
    {
      q: 'Does the AI represent all cultures equally?',
      a: 'No — and we are honest about this. The V&A\'s own collection is significantly weighted toward European, South Asian, and East Asian objects due to historical acquisition patterns. Our AI tools inherit this bias. In the Discover tool, we have an "Underrepresented" mode that specifically surfaces objects from collections that receive less traffic, including African, Latin American, and Oceanic holdings. This does not solve the underlying problem, but it is one active step we are taking. We publish a bias report updated quarterly.'
    },
    {
      q: 'How accessible are these tools?',
      a: 'All tools are built with accessibility as a core requirement, not an afterthought. This includes: semantic HTML5 landmarks and headings; ARIA labels throughout; full keyboard navigation; screen reader compatible (tested with NVDA, VoiceOver); a built-in large text mode; a high contrast mode; colour choices that meet WCAG 2.1 AA contrast ratios; and a skip-to-content link. We welcome accessibility feedback to improve further.'
    },
    {
      q: 'Are the AI interpretations in the Reimagine tool accurate?',
      a: 'The "Reimagine" tool is explicitly an interpretive and educational tool, not a source of authoritative museum information. Every output is clearly labelled as AI-generated interpretation. The AI is instructed to acknowledge uncertainty, flag when it is speculating, and note where cultural perspectives are incomplete or contested. Think of it as a starting point for exploration — always follow the links to real collection objects and curated V&A content to go deeper.'
    },
  ];

  faqs.forEach((faq, index) => {
    const item = document.createElement('div');
    item.className = 'faq-item';
    item.setAttribute('role', 'listitem');
    const id = `faq-answer-${index}`;
    item.innerHTML = `
      <button class="faq-question" aria-expanded="false" aria-controls="${id}" type="button">
        <span>${faq.q}</span>
        <span class="faq-question__icon" aria-hidden="true">+</span>
      </button>
      <div class="faq-answer" id="${id}" role="region">
        <div class="faq-answer-inner">
          ${faq.a.split('\n').map(paragraph => paragraph.trim() ? `<p>${paragraph.trim()}</p>` : '').join('')}
        </div>
      </div>
    `;
    const button = item.querySelector('.faq-question');
    button.addEventListener('click', () => {
      const open = item.classList.toggle('open');
      button.setAttribute('aria-expanded', String(open));
    });
    faqList.appendChild(item);
  });
}

function initRecommenderPage() {
  const interestTags = document.getElementById('interest-tags');
  if (!interestTags) return;

  const interests = [
    { label: 'Fashion & Textiles', q: 'fashion textile' },
    { label: 'Ceramics', q: 'ceramics pottery' },
    { label: 'Jewellery', q: 'jewellery' },
    { label: 'Furniture', q: 'furniture' },
    { label: 'Prints & Drawings', q: 'print drawing' },
    { label: 'Metalwork', q: 'metalwork silver gold' },
    { label: 'Glass', q: 'glass' },
    { label: 'Photography', q: 'photograph' },
    { label: 'Sculpture', q: 'sculpture' },
    { label: 'Architecture', q: 'architecture' },
  ];
  const periods = [
    { label: 'Medieval', range: [1000, 1500] },
    { label: '16th–17th c.', range: [1500, 1700] },
    { label: '18th century', range: [1700, 1800] },
    { label: 'Victorian', range: [1837, 1901] },
    { label: '20th century', range: [1900, 2000] },
  ];
  const materials = [
    { label: 'Silk', id: 'AAT11029' },
    { label: 'Glass', id: 'AAT10797' },
    { label: 'Silver', id: 'AAT11029' },
    { label: 'Porcelain', id: 'AAT7521' },
    { label: 'Wool', id: 'AAT11011' },
    { label: 'Ivory', id: 'AAT12309' },
  ];
  const regions = [
    { label: 'Britain', q: 'Britain' },
    { label: 'Japan', q: 'Japan' },
    { label: 'India', q: 'India' },
    { label: 'China', q: 'China' },
    { label: 'Italy', q: 'Italy' },
    { label: 'Middle East', q: 'Middle East' },
  ];
  const modes = {
    personalised: { label: 'Personalised', info: 'Recommendations based on your selected interests, from V&A API data.' },
    serendipitous: { label: 'Serendipitous', info: 'Random selection across the whole collection — expect the unexpected.' },
    underrepresented: { label: 'Underrepresented', info: 'Deliberately surfaces objects from collections that are less commonly explored.' }
  };
  const whyLabels = {
    personalised: 'Matches your interests',
    serendipitous: 'Random discovery',
    underrepresented: 'Underrepresented collection',
  };

  let selectedInterests = new Set();
  let selectedPeriod = null;
  let selectedMaterial = null;
  let selectedRegion = null;
  let currentMode = 'personalised';
  let currentPage = 1;
  let totalRecords = 0;

  function renderChips(container, items, onSelect) {
    container.innerHTML = '';
    items.forEach(item => {
      const button = document.createElement('button');
      button.className = 'filter-chip';
      button.textContent = item.label;
      button.type = 'button';
      button.setAttribute('aria-pressed', 'false');
      button.addEventListener('click', () => {
        const isSelected = button.classList.toggle('active');
        button.setAttribute('aria-pressed', String(isSelected));
        onSelect(item, isSelected);
      });
      container.appendChild(button);
    });
  }

  renderChips(interestTags, interests, (item, selected) => selected ? selectedInterests.add(item.q) : selectedInterests.delete(item.q));
  renderChips(document.getElementById('period-filters'), periods, (item, selected) => {
    document.querySelectorAll('#period-filters .filter-chip').forEach(chip => {
      chip.classList.remove('active');
      chip.setAttribute('aria-pressed', 'false');
    });
    selectedPeriod = selected ? item : null;
  });
  renderChips(document.getElementById('material-filters'), materials, (item, selected) => {
    selectedMaterial = selected ? item : null;
  });
  renderChips(document.getElementById('region-filters'), regions, (item, selected) => {
    selectedRegion = selected ? item : null;
  });

  document.querySelectorAll('.discovery-mode-btn').forEach(button => {
    button.addEventListener('click', () => {
      document.querySelectorAll('.discovery-mode-btn').forEach(modeButton => modeButton.classList.remove('active'));
      button.classList.add('active');
      currentMode = button.dataset.mode;
      updateBanner();
      loadResults(true);
    });
  });

  function updateBanner() {
    const banner = document.getElementById('serendipity-banner');
    const paragraph = banner.querySelector('p');
    banner.querySelector('h3').textContent = modes[currentMode].label;
    paragraph.textContent = `${modes[currentMode].info} `;
    const link = document.createElement('a');
    link.href = 'transparency.html';
    link.className = 'discover-inline-link';
    link.textContent = 'How this works →';
    paragraph.appendChild(link);
  }

  async function buildSearchParams() {
    const params = { page_size: 12, page: currentPage };

    if (currentMode === 'serendipitous') {
      const letters = 'abcdefghijklmnoprstw';
      params.q = letters[Math.floor(Math.random() * letters.length)];
    } else if (currentMode === 'underrepresented') {
      const underrepresented = ['Korea', 'Peru', 'Mali', 'Ethiopia', 'Indonesia', 'Mexico', 'Iran', 'Nigeria'];
      params.q = underrepresented[Math.floor(Math.random() * underrepresented.length)];
    } else {
      const queries = Array.from(selectedInterests);
      params.q = queries.length ? queries.join(' ') : 'art design';
    }

    if (selectedMaterial) params.id_material = selectedMaterial.id;
    if (selectedRegion) params.q = `${params.q || ''} ${selectedRegion.q}`.trim();
    return params;
  }

  async function loadResults(reset) {
    if (reset) currentPage = 1;
    const grid = document.getElementById('results-grid');
    const loadMoreButton = document.getElementById('load-more');
    const count = document.getElementById('results-count');

    if (reset) {
      grid.innerHTML = '';
      for (let index = 0; index < 8; index += 1) {
        const skeleton = document.createElement('div');
        skeleton.className = 'result-skeleton-card';
        skeleton.innerHTML = '<div class="skeleton result-skeleton-card__image"></div><div class="result-skeleton-card__body"><div class="skeleton result-skeleton-card__line result-skeleton-card__line--short"></div><div class="skeleton result-skeleton-card__line result-skeleton-card__line--long"></div><div class="skeleton result-skeleton-card__line result-skeleton-card__line--medium"></div></div>';
        grid.appendChild(skeleton);
      }
    }

    try {
      const params = await buildSearchParams();
      const data = await window.VAM.searchObjects(params);
      const records = data.records || [];
      totalRecords = data.info?.record_count || 0;

      if (reset) grid.innerHTML = '';

      count.textContent = `Showing objects from ${totalRecords.toLocaleString()} results`;
      records.forEach(record => {
        const card = window.VAM.renderArtefactCard(record, whyLabels[currentMode]);
        card.setAttribute('role', 'listitem');
        grid.appendChild(card);
      });

      loadMoreButton.style.display = currentPage * 12 < totalRecords ? 'flex' : 'none';
    } catch (_) {
      if (reset) {
        grid.innerHTML = '<p class="results-status-message results-status-message--padded">Unable to load results. Please check your connection.</p>';
      }
    }
  }

  document.getElementById('apply-filters').addEventListener('click', () => loadResults(true));
  document.getElementById('reset-filters').addEventListener('click', () => {
    selectedInterests.clear();
    selectedMaterial = null;
    selectedPeriod = null;
    selectedRegion = null;
    document.querySelectorAll('.filter-chip').forEach(chip => {
      chip.classList.remove('active');
      chip.setAttribute('aria-pressed', 'false');
    });
    loadResults(true);
  });
  document.getElementById('load-more').addEventListener('click', () => {
    currentPage += 1;
    loadResults(false);
  });

  updateBanner();
  loadResults(true);
}

function initGenerativePage() {
  const lensGrid = document.getElementById('lens-grid');
  if (!lensGrid) return;

  const lenses = [
    { id: 'cultural', icon: '🌍', title: 'Cultural connections', desc: 'How does this object connect to similar traditions in other cultures?' },
    { id: 'historical', icon: '⏳', title: 'Through time', desc: 'How would this object have been understood in different time periods?' },
    { id: 'material', icon: '🔬', title: 'Material stories', desc: 'What journeys did the materials take to become this object?' },
    { id: 'maker', icon: '🤲', title: 'The maker\'s hand', desc: 'Who made this and what was their world like?' },
    { id: 'symbol', icon: '✦', title: 'Symbols and meaning', desc: 'What symbols, motifs, or hidden meanings does this carry?' },
    { id: 'contemporary', icon: '🌱', title: 'Contemporary resonance', desc: 'How does this object speak to contemporary issues?' },
  ];
  const generativeSystem = `You are a thoughtful, imaginative museum educator at the Victoria & Albert Museum. Your role is to create engaging, accurate, and culturally sensitive interpretations of museum artefacts from specific perspectives.

When given an artefact and an interpretive lens, you:
1. Write a poetic, evocative opening passage (2-3 sentences) about the artefact from that lens
2. Provide a substantive cultural/historical analysis (3-4 paragraphs) that is educational and nuanced
3. Surface 3-4 specific connections to other V&A objects or broader cultural movements as search suggestions
4. Always acknowledge limitations and areas where interpretation is uncertain

Format your response as JSON:
{
  "opening": "Poetic opening passage",
  "analysis": "Full educational analysis text",
  "connections": [
    {"label": "Connection title", "search": "V&A API search term", "reason": "Why this connects"},
    ...
  ],
  "caveats": "Any important caveats about the interpretation"
}

Be culturally sensitive, avoid stereotypes, and acknowledge when historical accounts were written from a colonial or limited perspective. This content will be clearly labelled as AI interpretation.`;
  const ollamaChatUrl = 'http://localhost:11434/api/chat';
  const ollamaTagsUrl = 'http://localhost:11434/api/tags';
  const sdTxt2ImgUrl = 'http://localhost:7860/sdapi/v1/txt2img';
  const sdModelsUrl = 'http://localhost:7860/sdapi/v1/sd-models';
  const sdLensPrompts = {
    cultural: 'cross-cultural artistic fusion, world art traditions, multicultural decorative motifs',
    historical: 'historical period art style, period-accurate aesthetic, art history reimagining',
    material: 'rich material texture detail, artisan craftsmanship, raw materials close-up',
    maker: 'handcraft workshop aesthetic, traditional making technique, artisan detail',
    symbol: 'ornate symbolic iconography, decorative motifs, sacred geometry patterns',
    contemporary: 'contemporary modern art reinterpretation, minimalist redesign, modern aesthetic',
  };

  let selectedArtefact = null;
  let selectedLens = null;
  let ollamaChecked = false;

  async function checkOllamaApi() {
    if (ollamaChecked) return;
    const response = await fetch(ollamaTagsUrl, { method: 'GET' });
    if (!response.ok) throw new Error(`Ollama health check failed: ${response.status}`);
    ollamaChecked = true;
  }

  async function callOllamaJson(systemPrompt, userPrompt) {
    await checkOllamaApi();
    const response = await fetch(ollamaChatUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'phi3:mini',
        format: 'json',
        stream: false,
        options: { num_predict: 1000 },
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt }
        ]
      })
    });
    if (!response.ok) throw new Error(`Ollama request failed: ${response.status}`);

    const data = await response.json();
    const text = (data.message?.content || '').replace(/```json|```/g, '').trim();
    try {
      return JSON.parse(text);
    } catch (_) {
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (!jsonMatch) throw new Error('Text model did not return valid JSON.');
      return JSON.parse(jsonMatch[0]);
    }
  }

  function updateGenerateButton() {
    document.getElementById('generate-btn').disabled = !(selectedArtefact && selectedLens);
  }

  lenses.forEach(lens => {
    const card = document.createElement('button');
    card.className = 'lens-card';
    card.type = 'button';
    card.setAttribute('aria-pressed', 'false');
    card.dataset.id = lens.id;
    card.innerHTML = `
      <div class="lens-card__icon" aria-hidden="true">${lens.icon}</div>
      <div class="lens-card__title">${lens.title}</div>
      <div class="lens-card__desc">${lens.desc}</div>
    `;
    card.addEventListener('click', () => {
      document.querySelectorAll('.lens-card').forEach(item => {
        item.classList.remove('selected');
        item.setAttribute('aria-pressed', 'false');
      });
      card.classList.add('selected');
      card.setAttribute('aria-pressed', 'true');
      selectedLens = lens;
      updateGenerateButton();
    });
    lensGrid.appendChild(card);
  });

  const artefactSearch = document.getElementById('artefact-search');
  const dropdown = document.getElementById('search-dropdown');
  const sdStatusBadge = document.getElementById('sd-status-badge');
  let searchTimeout;

  artefactSearch.addEventListener('input', () => {
    clearTimeout(searchTimeout);
    const value = artefactSearch.value.trim();
    if (value.length < 3) {
      dropdown.classList.remove('open');
      return;
    }
    searchTimeout = setTimeout(() => doArtefactSearch(value), 400);
  });

  artefactSearch.addEventListener('keydown', event => {
    if (event.key === 'Escape') {
      dropdown.classList.remove('open');
      artefactSearch.focus();
    }
    if (event.key === 'ArrowDown') {
      const first = dropdown.querySelector('.dropdown-item');
      if (first) {
        event.preventDefault();
        first.focus();
      }
    }
  });

  document.addEventListener('click', event => {
    if (!artefactSearch.closest('.artefact-search-box').contains(event.target)) {
      dropdown.classList.remove('open');
    }
  });

  async function doArtefactSearch(query) {
    try {
      const data = await window.VAM.searchObjects({ q: query, page_size: 5 });
      const records = data.records || [];
      dropdown.innerHTML = '';
      if (!records.length) {
        dropdown.innerHTML = '<p class="search-results-dropdown__empty">No results found</p>';
        dropdown.classList.add('open');
        return;
      }
      records.forEach(record => {
        const item = document.createElement('button');
        item.className = 'dropdown-item';
        item.type = 'button';
        item.setAttribute('role', 'option');
        const imageUrl = window.VAM.getArtefactImageUrl(record, 'thumb');
        const title = record._primaryTitle || record.objectType || 'Object';
        const date = window.VAM.formatDateRange(record);
        item.innerHTML = `
          ${imageUrl ? `<img src="${imageUrl}" alt="" />` : '<div class="dropdown-item__placeholder"></div>'}
          <div>
            <div class="dropdown-item__title">${window.VAM.escHtml(title.slice(0, 50))}</div>
            <div class="dropdown-item__meta">${window.VAM.escHtml(record.objectType || '')} · ${window.VAM.escHtml(date)}</div>
          </div>
        `;
        item.addEventListener('click', () => selectArtefact(record));
        item.addEventListener('keydown', event => {
          if (event.key === 'ArrowDown') {
            event.preventDefault();
            item.nextElementSibling?.focus();
          }
          if (event.key === 'ArrowUp') {
            event.preventDefault();
            item.previousElementSibling?.focus() || artefactSearch.focus();
          }
          if (event.key === 'Escape') {
            dropdown.classList.remove('open');
            artefactSearch.focus();
          }
        });
        dropdown.appendChild(item);
      });
      dropdown.classList.add('open');
    } catch (_) {
      dropdown.classList.remove('open');
    }
  }

  function selectArtefact(record) {
    selectedArtefact = record;
    dropdown.classList.remove('open');
    const title = record._primaryTitle || record.objectType || 'Object';
    artefactSearch.value = title;

    const imageUrl = window.VAM.getArtefactImageUrl(record, 'medium');
    const selected = document.getElementById('selected-artefact');
    const selectedImage = document.getElementById('selected-img');
    const selectedTitle = document.getElementById('selected-title');
    const selectedDate = document.getElementById('selected-date');

    selectedTitle.textContent = title;
    selectedDate.textContent = `${window.VAM.formatDateRange(record)}${record.objectType ? ` · ${record.objectType}` : ''}`;
    if (imageUrl) {
      selectedImage.src = imageUrl;
      selectedImage.alt = title;
      selectedImage.hidden = false;
    } else {
      selectedImage.removeAttribute('src');
      selectedImage.alt = '';
      selectedImage.hidden = true;
    }
    selected.classList.add('show');
    updateGenerateButton();
    checkSdApi();
  }

  async function checkSdApi() {
    try {
      const response = await fetch(sdModelsUrl, { signal: AbortSignal.timeout(3000) });
      if (response.ok) {
        const models = await response.json();
        const ready = Array.isArray(models) && models.length > 0;
        sdStatusBadge.textContent = ready ? '● Stable Diffusion ready' : '● No SD model loaded';
        sdStatusBadge.className = ready ? 'sd-status-badge sd-status-badge--online' : 'sd-status-badge sd-status-badge--offline';
        return ready;
      }
    } catch (_) {
      // ignore
    }
    sdStatusBadge.textContent = '● Stable Diffusion offline';
    sdStatusBadge.className = 'sd-status-badge sd-status-badge--offline';
    return false;
  }

  async function runSdReimagining(lensId, customQuestion) {
    const output = document.getElementById('sd-output');
    if (!output) return;

    const lensStyle = sdLensPrompts[lensId] || 'artistic reimagining';
    const artefactTitle = selectedArtefact._primaryTitle || selectedArtefact.objectType || 'artefact';
    const artefactDescription = selectedArtefact._primaryDescription?.[0]?.value || selectedArtefact.briefDescription || '';
    const descriptionPart = artefactDescription ? `, ${artefactDescription.slice(0, 120)}` : '';
    const customPart = customQuestion ? `, ${customQuestion}` : '';
    const prompt = `${artefactTitle}${descriptionPart}, ${lensStyle}${customPart}, museum quality, detailed, high resolution`;

    output.className = 'sd-output sd-output--loading';
    output.innerHTML = `
      <div class="sd-output__spinner" aria-hidden="true">✦</div>
      <p class="sd-output__status">Generating visual reimagining — this may take 20–60 seconds…</p>
    `;

    try {
      const response = await fetch(sdTxt2ImgUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt,
          negative_prompt: 'blurry, ugly, watermark, text, low quality, deformed',
          steps: 20,
          width: 512,
          height: 512,
          cfg_scale: 7,
          sampler_name: 'Euler a'
        })
      });

      if (!response.ok) {
        const errorText = await response.text().catch(() => '');
        throw new Error(`Stable Diffusion error ${response.status}: ${errorText.slice(0, 200)}`);
      }

      const data = await response.json();
      const outputBase64 = data.images?.[0];
      if (!outputBase64) throw new Error('Stable Diffusion returned no image data.');

      const escapedTitle = window.VAM.escHtml(artefactTitle);
      output.className = 'sd-output sd-output--result';
      output.innerHTML = `
        <div class="sd-result-label">✦ AI-generated visual — Stable Diffusion · ${window.VAM.escHtml(lensStyle)}</div>
        <figure class="sd-figure sd-figure--single">
          <img src="data:image/png;base64,${outputBase64}" alt="AI visual reimagining of ${escapedTitle}" />
          <figcaption>${escapedTitle} — reimagined through ${window.VAM.escHtml(selectedLens.title)}</figcaption>
        </figure>
        <a class="btn btn--ghost sd-download-btn" href="data:image/png;base64,${outputBase64}" download="reimagined-artefact.png" aria-label="Download reimagined image as PNG">
          ↓ Download PNG
        </a>
      `;
    } catch (error) {
      output.className = 'sd-output sd-output--error';
      output.innerHTML = `
        <p class="sd-output__error-message">
          <strong>Visual reimagining unavailable.</strong> ${window.VAM.escHtml(error.message)}
        </p>
      `;
    }
  }

  async function generateInterpretation() {
    if (!selectedArtefact || !selectedLens) return;

    const sdOutput = document.getElementById('sd-output');
    if (sdOutput) {
      sdOutput.innerHTML = '';
      sdOutput.className = 'sd-output';
    }

    const customQuestion = document.getElementById('custom-prompt').value.trim();
    runSdReimagining(selectedLens.id, customQuestion);

    const output = document.getElementById('generation-output');
    output.className = 'generation-output loading';
    output.innerHTML = `
      <div class="spinning generation-output__spinner" aria-hidden="true">✦</div>
      <p class="generation-output__status">Generating interpretation…</p>
    `;

    const title = selectedArtefact._primaryTitle || selectedArtefact.objectType || 'Object';
    const description = selectedArtefact._primaryDescription?.[0]?.value || selectedArtefact.briefDescription || '';
    const date = window.VAM.formatDateRange(selectedArtefact);
    const userPrompt = `
Artefact: ${title}
Type: ${selectedArtefact.objectType || 'Unknown'}
Date: ${date}
Description: ${description}
Lens: ${selectedLens.title} — ${selectedLens.desc}
${customQuestion ? `Additional question: ${customQuestion}` : ''}

Please generate an interpretation of this artefact through the "${selectedLens.title}" lens.`;

    try {
      const parsed = await callOllamaJson(generativeSystem, userPrompt);
      output.className = 'generation-output';
      output.innerHTML = `
        <div class="generation-label">
          <strong>✦ AI-generated interpretation</strong> — <span>Lens: ${selectedLens.icon} ${selectedLens.title}</span>
        </div>
        <div class="generation-text" id="gen-opening"></div>
        <div class="generation-analysis" id="gen-analysis"></div>
        ${parsed.caveats ? `<div class="bias-notice"><span class="bias-notice__icon">ℹ</span><span>${window.VAM.escHtml(parsed.caveats)}</span></div>` : ''}
        ${parsed.connections?.length ? '<div class="generation-connections"><h4>Explore further</h4><div class="connection-list" id="connection-list"></div></div>' : ''}
      `;

      document.getElementById('gen-opening').textContent = parsed.opening || '';
      document.getElementById('gen-analysis').textContent = parsed.analysis || '';

      if (parsed.connections) {
        const connectionList = document.getElementById('connection-list');
        parsed.connections.forEach(connection => {
          const item = document.createElement('button');
          item.className = 'connection-item';
          item.type = 'button';
          item.innerHTML = `
            <span class="connection-item__arrow">→</span>
            <div>
              <div class="connection-item__title">${window.VAM.escHtml(connection.label)}</div>
              <div class="connection-item__reason">${window.VAM.escHtml(connection.reason)}</div>
            </div>
          `;
          item.addEventListener('click', () => {
            window.open(`https://collections.vam.ac.uk/search/?q=${encodeURIComponent(connection.search)}`, '_blank', 'noopener,noreferrer');
          });
          connectionList?.appendChild(item);
        });
      }
    } catch (error) {
      output.className = 'generation-output';
      output.innerHTML = `
        <p class="generation-output__error">
          <strong>Could not generate interpretation.</strong> ${window.VAM.escHtml(error?.message || 'Please try again.')}
        </p>
      `;
    }
  }

  document.getElementById('generate-btn').addEventListener('click', generateInterpretation);
  checkSdApi();
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
  initScrollReveal();
  initTransparencyPage();
  initRecommenderPage();
  initGenerativePage();
});
