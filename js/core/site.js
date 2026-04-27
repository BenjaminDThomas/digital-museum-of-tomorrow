'use strict';

(function initSiteCore() {

  // Create a toggle button for the accessibility bar.
  function createA11yBtn(icon, label, onClick) {
    const btn = document.createElement('button');
    btn.className = 'a11y-btn';
    btn.setAttribute('aria-label', label);
    btn.setAttribute('type', 'button');
    btn.textContent = icon;
    btn.addEventListener('click', onClick);
    return btn;
  }

  // Create the text size toggle bar in the header
  function injectA11yToolbar() {
    const toolbar = document.createElement('aside');
    toolbar.className = 'a11y-toolbar';
    toolbar.setAttribute('aria-label', 'Accessibility tools');

    // Create the text size toggle button.
    const largeTextBtn = createA11yBtn('Aa', 'Toggle large text', () => {
      document.body.classList.toggle('large-text');
      localStorage.setItem('vam-large-text', document.body.classList.contains('large-text'));
    });

    // Add the text size toggle button to the toolbar
    toolbar.append(largeTextBtn);
    const headerInner = document.querySelector('.header-inner');
    const navToggle = document.querySelector('.nav-toggle');
    if (headerInner && navToggle) {
      headerInner.insertBefore(toolbar, navToggle);
    } else if (headerInner) {
      headerInner.appendChild(toolbar);
    } else {
      document.body.appendChild(toolbar);
    }

    if (localStorage.getItem('vam-large-text') === 'true') document.body.classList.add('large-text');
  }

  // Animate cards and pillars into view as the user scrolls down the page.
  function initScrollReveal() {
    const items = document.querySelectorAll('.tool-card, .trust-pillar, .artefact-card');
    if (!window.IntersectionObserver) return;

    // Reveal each element once it enters the viewport and stop watching it.
    const observer = new IntersectionObserver(entries => {
      entries.forEach(entry => {
        if (entry.isIntersecting) {
          entry.target.style.opacity = '1';
          entry.target.style.transform = 'translateY(0)';
          observer.unobserve(entry.target);
        }
      });
    }, { threshold: 0.1 });

    // Set each element to hidden with a staggered transition delay before observing.
    items.forEach((element, index) => {
      element.style.opacity = '0';
      element.style.transform = 'translateY(20px)';
      element.style.transition = `opacity 0.5s ease ${index * 0.07}s, transform 0.5s ease ${index * 0.07}s`;
      observer.observe(element);
    });
  }

  // Set up the mobile navigation toggle and keyboard accessibility.
  function initNavigation() {
    const navToggle = document.querySelector('.nav-toggle');
    const mainNav = document.querySelector('.main-nav');
    if (!navToggle || !mainNav) return;

    // Toggle the nav open or closed when the burger button is clicked.
    navToggle.addEventListener('click', () => {
      const open = navToggle.getAttribute('aria-expanded') === 'true';
      navToggle.setAttribute('aria-expanded', String(!open));
      mainNav.classList.toggle('open', !open);
    });

    // Close the nav on Escape and return focus to the toggle button.
    document.addEventListener('keydown', event => {
      if (event.key === 'Escape' && mainNav.classList.contains('open')) {
        navToggle.setAttribute('aria-expanded', 'false');
        mainNav.classList.remove('open');
        navToggle.focus();
      }
    });
  }

  // Initialise all site-wide features once the DOM is ready.
  document.addEventListener('DOMContentLoaded', () => {
    initNavigation();
    injectA11yToolbar();
    initScrollReveal();
  });
})();
