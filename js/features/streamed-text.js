'use strict';

// Shared text rendering helpers. Exposes window.A2BCText for safely displaying
// AI-streamed output as escaped HTML across all pages.
(function initStreamedTextFeature() {
  // Render a plain text string into a target element as escaped inline HTML.
  function renderInline(target, text) {
    if (!target) return;
    target.innerHTML = window.VAM.escHtml(text || '').replace(/\n/g, '<br>');
  }

  // Split text on blank lines and render each paragraph as a <p> element.
  function renderParagraphs(target, text) {
    if (!target) return;
    const paragraphs = String(text || '')
      .split(/\n\s*\n/)
      .map(paragraph => paragraph.trim())
      .filter(Boolean);

    target.innerHTML = paragraphs.length
      ? paragraphs.map(paragraph => `<p>${window.VAM.escHtml(paragraph).replace(/\n/g, '<br>')}</p>`).join('')
      : '';
  }

  window.A2BCText = {
    renderInline,
    renderParagraphs,
  };
})();
