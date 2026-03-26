'use strict';

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
    { label: '16th\u201317th c.', range: [1500, 1700] },
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
    personalised: { label: 'Personalised', info: 'Recommendations based on your selected interests, from V&A Collections API data.' },
    serendipitous: { label: 'Serendipitous', info: 'Random selection across the whole collection — expect the unexpected.' },
    underrepresented: { label: 'Underrepresented', info: 'Deliberately surfaces objects from collections that are less commonly explored.' }
  };
  const whyLabels = {
    personalised: 'Matches your interests',
    serendipitous: 'Random discovery',
    underrepresented: 'Underrepresented collection',
  };

  let selectedInterests = new Set();
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
    link.textContent = 'How this works \u2192';
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

document.addEventListener('DOMContentLoaded', () => {
  initRecommenderPage();
});
