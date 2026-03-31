'use strict';

(function initStreamedTextFeature() {
  function renderInline(target, text) {
    if (!target) return;
    target.innerHTML = window.VAM.escHtml(text || '').replace(/\n/g, '<br>');
  }

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
