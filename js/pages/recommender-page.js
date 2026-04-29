'use strict';

// Recommender (Discover) page controller. Manages filter chips, discovery modes,
// infinite scroll, and fetching personalised/serendipitous/underrepresented results.
function initRecommenderPage() {
  const interestTags = document.getElementById('interest-tags');
  if (!interestTags) return;

  const resultsGrid = document.getElementById('results-grid');
  const resultsCount = document.getElementById('results-count');
  const sortSelect = document.getElementById('sort-select');
  const feedStatus = document.getElementById('discover-feed-status');
  const feedSentinel = document.getElementById('discover-feed-sentinel');

  const PAGE_SIZE = 12;
  const PREFETCH_ROOT_MARGIN = '1100px 0px';

  // Object category interests the user can toggle.
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
  // Historical period ranges used to filter search results.
  const periods = [
    { label: 'Medieval', range: [1000, 1500] },
    { label: '16th-17th c.', range: [1500, 1700] },
    { label: '18th century', range: [1700, 1800] },
    { label: 'Victorian', range: [1837, 1901] },
    { label: '20th century', range: [1900, 2000] },
  ];
  // Material filter options mapped to V&A AAT identifiers.
  const materials = [
    { label: 'Silk', id: 'AAT11029' },
    { label: 'Glass', id: 'AAT10797' },
    { label: 'Silver', id: 'AAT11029' },
    { label: 'Porcelain', id: 'AAT7521' },
    { label: 'Wool', id: 'AAT11011' },
    { label: 'Ivory', id: 'AAT12309' },
  ];
  // Geographic region filters.
  const regions = [
    { label: 'Britain', q: 'Britain' },
    { label: 'Japan', q: 'Japan' },
    { label: 'India', q: 'India' },
    { label: 'China', q: 'China' },
    { label: 'Italy', q: 'Italy' },
    { label: 'Middle East', q: 'Middle East' },
  ];
  // Discovery mode definitions with labels and explanatory text.
  const modes = {
    personalised: { label: 'Personalised', info: 'Recommendations based on your selected interests, from V&A Collections API data.' },
    serendipitous: { label: 'Serendipitous', info: 'Random selection across the whole collection - expect the unexpected.' },
    underrepresented: { label: 'Underrepresented', info: 'Deliberately surfaces objects from collections that are less commonly explored.' },
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

  let nextPage = 1;
  let totalRecords = 0;
  let loadedCount = 0;
  let isLoading = false;
  let hasMore = true;
  let filterVersion = 0;
  const seenKeys = new Set();

  const LEARNED_KEY = 'vam-learned-interests';
  function loadLearnedInterests() {
    try { return JSON.parse(localStorage.getItem(LEARNED_KEY)) || []; }
    catch (_) { return []; }
  }
  function saveLearnedInterests(arr) {
    try { localStorage.setItem(LEARNED_KEY, JSON.stringify(arr)); } catch (_) {}
  }
  let learnedInterests = loadLearnedInterests();

  function renderLearnedInterests() {
    const panel = document.getElementById('learned-interests-panel');
    const chips = document.getElementById('learned-interest-chips');
    if (!panel || !chips) return;
    panel.hidden = learnedInterests.length === 0;
    chips.innerHTML = '';
    learnedInterests.forEach(type => {
      const chip = document.createElement('span');
      chip.className = 'filter-chip filter-chip--passive';
      chip.textContent = type;
      chips.appendChild(chip);
    });
  }

  // Update the feed status text.
  function setFeedStatus(text) {
    if (feedStatus) feedStatus.textContent = text;
  }

  // Render a row of toggle chips from an items array into a container.
  function renderChips(container, items, onSelect, options = {}) {
    const { singleSelect = false } = options;
    container.innerHTML = '';

    items.forEach(item => {
      const button = document.createElement('button');
      button.className = 'filter-chip';
      button.textContent = item.label;
      button.type = 'button';

      button.addEventListener('click', () => {
        if (singleSelect) {
          const wasSelected = button.classList.contains('active');
          container.querySelectorAll('.filter-chip').forEach(chip => {
            chip.classList.remove('active');
          });

          const isSelected = !wasSelected;
          if (isSelected) {
            button.classList.add('active');
          }

          onSelect(item, isSelected);
          markFeedFiltersUpdated(true);
          return;
        }

        const isSelected = button.classList.toggle('active');
        onSelect(item, isSelected);
        markFeedFiltersUpdated(true);
      });

      container.appendChild(button);
    });
  }

  renderChips(
    interestTags,
    interests,
    (item, selected) => (selected ? selectedInterests.add(item.q) : selectedInterests.delete(item.q))
  );
  renderChips(
    document.getElementById('period-filters'),
    periods,
    (item, selected) => {
      selectedPeriod = selected ? item : null;
    },
    { singleSelect: true }
  );
  renderChips(
    document.getElementById('material-filters'),
    materials,
    (item, selected) => {
      selectedMaterial = selected ? item : null;
    },
    { singleSelect: true }
  );
  renderChips(
    document.getElementById('region-filters'),
    regions,
    (item, selected) => {
      selectedRegion = selected ? item : null;
    },
    { singleSelect: true }
  );

  document.querySelectorAll('.discovery-mode-btn').forEach(button => {
    button.addEventListener('click', () => {
      document.querySelectorAll('.discovery-mode-btn').forEach(modeButton => modeButton.classList.remove('active'));
      button.classList.add('active');
      currentMode = button.dataset.mode;
      updateBanner();
      markFeedFiltersUpdated(true);
    });
  });

  if (sortSelect) {
    sortSelect.addEventListener('change', () => {
      markFeedFiltersUpdated(true);
    });
  }

  // Update the info banner to reflect the currently active discovery mode.
  function updateBanner() {
    const banner = document.getElementById('serendipity-banner');
    const paragraph = banner.querySelector('p');
    banner.querySelector('h2').textContent = modes[currentMode].label;
    paragraph.textContent = `${modes[currentMode].info} `;

    const link = document.createElement('a');
    link.href = 'transparency.html';
    link.className = 'discover-inline-link';
    link.textContent = 'How this works ->';
    paragraph.appendChild(link);
  }

  // Capture a snapshot of all active filter state for use in a single batch load.
  function getFilterSnapshot() {
    return {
      mode: currentMode,
      interests: Array.from(selectedInterests),
      period: selectedPeriod,
      material: selectedMaterial,
      region: selectedRegion,
      sort: sortSelect ? sortSelect.value : 'relevance',
      learnedInterests: learnedInterests.slice(),
    };
  }

  // Return a human-readable summary of a filter snapshot for status messages.
  function describeSnapshot(snapshot) {
    const parts = [];

    parts.push(modes[snapshot.mode].label);
    if (snapshot.interests.length) parts.push(`${snapshot.interests.length} interests`);
    if (snapshot.period) parts.push(snapshot.period.label);
    if (snapshot.material) parts.push(snapshot.material.label);
    if (snapshot.region) parts.push(snapshot.region.label);

    return parts.join(' • ');
  }

  // Notify the feed that filters changed and optionally trigger an immediate load.
  function markFeedFiltersUpdated(tryAutoload) {
    filterVersion += 1;
    const snapshot = getFilterSnapshot();
    updateResultsCount();
    setFeedStatus(`Updated. Next tiles will use: ${describeSnapshot(snapshot)}.`);

    if (tryAutoload && shouldLoadSoon()) {
      loadNextBatch();
    }
  }

  // Return true if the viewport is close enough to the bottom to warrant prefetching.
  function shouldLoadSoon() {
    const pixelsFromBottom = document.documentElement.scrollHeight - (window.scrollY + window.innerHeight);
    return pixelsFromBottom < 1200;
  }

  // Sort a records array by object date, ascending or descending.
  function sortRecords(records, sortMode) {
    if (sortMode === 'date_asc') {
      return records.slice().sort((a, b) => Number(a.object_begin_date || 99999) - Number(b.object_begin_date || 99999));
    }
    if (sortMode === 'date_desc') {
      return records.slice().sort((a, b) => Number(b.object_begin_date || -99999) - Number(a.object_begin_date || -99999));
    }
    return records;
  }

  // Keep only records whose date range overlaps the selected period.
  function filterByPeriod(records, period) {
    if (!period) return records;
    const [startYear, endYear] = period.range;

    return records.filter(record => {
      const begin = Number(record.object_begin_date);
      const end = Number(record.object_end_date);

      if (!Number.isNaN(begin) && !Number.isNaN(end)) {
        return !(end < startYear || begin > endYear);
      }
      if (!Number.isNaN(begin)) {
        return begin >= startYear && begin <= endYear;
      }
      if (!Number.isNaN(end)) {
        return end >= startYear && end <= endYear;
      }
      return false;
    });
  }

  // Build the API search params for the current mode and filters.
  function buildSearchParams(snapshot, page) {
    const params = { page_size: PAGE_SIZE, page };

    if (snapshot.mode === 'serendipitous') {
      const letters = 'abcdefghijklmnoprstw';
      params.q = letters[Math.floor(Math.random() * letters.length)];
    } else if (snapshot.mode === 'underrepresented') {
      const underrepresented = ['Korea', 'Peru', 'Mali', 'Ethiopia', 'Indonesia', 'Mexico', 'Iran', 'Nigeria'];
      params.q = underrepresented[Math.floor(Math.random() * underrepresented.length)];
    } else {
      const allTerms = [
        ...(snapshot.interests.length ? snapshot.interests : []),
        ...snapshot.learnedInterests,
      ];
      if (allTerms.length) {
        params.q = allTerms[Math.floor(Math.random() * allTerms.length)];
      } else {
        params.q = 'art design';
      }
    }

    if (snapshot.material) {
      params.id_material = snapshot.material.id;
      params.q = `${params.q || ''} ${snapshot.material.label}`.trim();
    }
    if (snapshot.region) {
      params.q = `${params.q || ''} ${snapshot.region.q}`.trim();
    }

    return params;
  }

  // Append new, unseen artefact cards to the results grid and return the count added.
  function appendRecords(records, mode) {
    let appended = 0;

    records.forEach(record => {
      const key = record.systemNumber || record.id || record.pk;
      if (!key || seenKeys.has(key)) return;

      // Check if user has marked this item as not interested
      const systemNumber = record.systemNumber || '';
      if (localStorage.getItem(`vam-not-interested-${systemNumber}`) === 'true') {
        return; // Skip this record
      }

      seenKeys.add(key);

      const card = window.VAM.renderArtefactCard(record, whyLabels[mode]);
      resultsGrid.appendChild(card);
      appended += 1;

      card.addEventListener('click', event => {
        if (event.target.classList.contains('artefact-action-btn')) return;
        const type = record.objectType;
        if (type && !learnedInterests.includes(type)) {
          learnedInterests.unshift(type);
          if (learnedInterests.length > 20) learnedInterests.length = 20;
          saveLearnedInterests(learnedInterests);
          renderLearnedInterests();
        }
      });
    });

    loadedCount += appended;
    return appended;
  }

  // Refresh the results count label beneath the grid.
  function updateResultsCount() {
    const periodSummary = selectedPeriod ? ` (${selectedPeriod.label})` : '';
    resultsCount.textContent = `Loaded ${loadedCount.toLocaleString()} tiles${periodSummary}. Filter changes affect upcoming tiles only.`;
  }

  // Fetch and render the next page of results, retrying if few records pass the period filter.
  async function loadNextBatch() {
    if (isLoading || !hasMore) return;

    const snapshot = getFilterSnapshot();
    const requestVersion = filterVersion;
    isLoading = true;
    setFeedStatus('Loading more tiles...');

    let appended = 0;
    let attempts = 0;

    try {
      while (hasMore && appended < 6 && attempts < 5) {
        const params = buildSearchParams(snapshot, nextPage);
        nextPage += 1;
        attempts += 1;

        const data = await window.VAM.searchObjects(params);

        if (requestVersion !== filterVersion) {
          isLoading = false;
          return;
        }

        const rawRecords = data.records || [];
        totalRecords = data.info?.record_count || totalRecords;

        if (!rawRecords.length) {
          hasMore = false;
          break;
        }

        const periodFiltered = filterByPeriod(rawRecords, snapshot.period);
        const sorted = sortRecords(periodFiltered, snapshot.sort);
        appended += appendRecords(sorted, snapshot.mode);

        if (rawRecords.length < PAGE_SIZE) {
          hasMore = false;
          break;
        }
      }

      updateResultsCount();

      if (!loadedCount) {
        resultsGrid.innerHTML = '<p class="results-status-message results-status-message--padded">No objects matched these filters yet. Keep scrolling or change filters for upcoming tiles.</p>';
      }

      if (!hasMore) {
        setFeedStatus('You reached the end of this feed.');
      } else if (requestVersion !== filterVersion) {
        setFeedStatus('Loaded. New filter settings will apply to upcoming tiles.');
      } else {
        setFeedStatus(`Showing ${loadedCount.toLocaleString()} of ${totalRecords.toLocaleString()} available results.`);
      }
    } catch (_) {
      setFeedStatus('Unable to load more tiles right now.');
      if (!loadedCount) {
        resultsGrid.innerHTML = '<p class="results-status-message results-status-message--padded">Unable to load results. Please check your connection.</p>';
      }
    } finally {
      isLoading = false;
    }
  }

  // Set up IntersectionObserver (or scroll fallback) to load more tiles near the page end.
  function setupInfiniteScroll() {
    if (!feedSentinel) return;

    if ('IntersectionObserver' in window) {
      const observer = new IntersectionObserver(entries => {
        const [entry] = entries;
        if (entry.isIntersecting) {
          loadNextBatch();
        }
      }, { root: null, rootMargin: PREFETCH_ROOT_MARGIN });

      observer.observe(feedSentinel);
      return;
    }

    window.addEventListener('scroll', () => {
      if (shouldLoadSoon()) {
        loadNextBatch();
      }
    }, { passive: true });
  }

  document.getElementById('reset-filters').addEventListener('click', () => {
    selectedInterests = new Set();
    selectedPeriod = null;
    selectedMaterial = null;
    selectedRegion = null;

    document.querySelectorAll('.filter-chip').forEach(chip => {
      chip.classList.remove('active');
    });

    markFeedFiltersUpdated(true);
  });

  document.getElementById('clear-learned-interests').addEventListener('click', () => {
    learnedInterests.splice(0);
    saveLearnedInterests(learnedInterests);
    renderLearnedInterests();
  });

  document.getElementById('clear-results').addEventListener('click', () => {
    resultsGrid.innerHTML = '';
    nextPage = 1;
    totalRecords = 0;
    loadedCount = 0;
    isLoading = false;
    hasMore = true;
    seenKeys.clear();
    filterVersion += 1;
    updateResultsCount();
    setFeedStatus('Results cleared. Loading fresh recommendations.');
    loadNextBatch();
  });

  renderLearnedInterests();
  updateBanner();
  updateResultsCount();
  setupInfiniteScroll();
  loadNextBatch();
}

document.addEventListener('DOMContentLoaded', () => {
  initRecommenderPage();
});
