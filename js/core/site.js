'use strict';

(function initSiteCore() {
  function createA11yBtn(icon, label, onClick) {
    const btn = document.createElement('button');
    btn.className = 'a11y-btn';
    btn.setAttribute('aria-label', label);
    btn.setAttribute('type', 'button');
    btn.textContent = icon;
    btn.addEventListener('click', onClick);
    return btn;
  }

  function injectA11yToolbar() {
    const toolbar = document.createElement('aside');
    toolbar.className = 'a11y-toolbar';
    toolbar.setAttribute('aria-label', 'Accessibility tools');

    const largeTextBtn = createA11yBtn('Aa', 'Toggle large text', () => {
      document.body.classList.toggle('large-text');
      localStorage.setItem('vam-large-text', document.body.classList.contains('large-text'));
    });

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

  function initScrollReveal() {
    const items = document.querySelectorAll('.tool-card, .trust-pillar, .artefact-card');
    if (!window.IntersectionObserver) return;
    const observer = new IntersectionObserver(entries => {
      entries.forEach(entry => {
        if (entry.isIntersecting) {
          entry.target.style.opacity = '1';
          entry.target.style.transform = 'translateY(0)';
          observer.unobserve(entry.target);
        }
      });
    }, { threshold: 0.1 });

    items.forEach((element, index) => {
      element.style.opacity = '0';
      element.style.transform = 'translateY(20px)';
      element.style.transition = `opacity 0.5s ease ${index * 0.07}s, transform 0.5s ease ${index * 0.07}s`;
      observer.observe(element);
    });
  }

  function initNavigation() {
    const navToggle = document.querySelector('.nav-toggle');
    const mainNav = document.querySelector('.main-nav');
    if (!navToggle || !mainNav) return;

    navToggle.addEventListener('click', () => {
      const open = navToggle.getAttribute('aria-expanded') === 'true';
      navToggle.setAttribute('aria-expanded', String(!open));
      mainNav.classList.toggle('open', !open);
    });

    document.addEventListener('keydown', event => {
      if (event.key === 'Escape' && mainNav.classList.contains('open')) {
        navToggle.setAttribute('aria-expanded', 'false');
        mainNav.classList.remove('open');
        navToggle.focus();
      }
    });
  }

  document.addEventListener('DOMContentLoaded', () => {
    initNavigation();
    injectA11yToolbar();
    initScrollReveal();
  });
})();
