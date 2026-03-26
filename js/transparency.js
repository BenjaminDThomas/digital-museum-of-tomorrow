'use strict';

function initTransparencyPage() {
  const faqList = document.getElementById('faq-list');
  if (!faqList) return;

  const faqs = [
    {
      q: 'Is the AI making things up about artefacts?',
      a: 'The chatbot draws on actual V&A Collections API data. However, large language models can sometimes combine information incorrectly or fill in gaps with plausible but inaccurate details — this is called "hallucination". Every AI response includes a disclaimer and links to the authoritative source record. A2BC is not affiliated with the V&A. Always verify important information with official collections pages.'
    },
    {
      q: 'Does the recommender create a filter bubble?',
      a: 'We have explicitly designed against this. Alongside personalised recommendations, we offer a "Serendipitous" mode that surfaces random objects across the whole collection, and an "Underrepresented" mode that deliberately shows objects from less commonly visited collections. Your interest preferences are applied loosely, and we intentionally inject diversity into results. You can also clear all preferences at any time.'
    },
    {
      q: 'Why are some artefact descriptions in old or offensive language?',
      a: 'Collection records in the V&A Collections API date back to the 19th century. Some historical catalogue entries use terminology that is now considered outdated, disrespectful, or reflecting colonial viewpoints. We display this data as it exists in the API, but our AI tools are instructed to flag such language where possible. If you spot something harmful, please report it using the link above.'
    },
    {
      q: 'How is my data used?',
      a: 'We do not create user accounts, require logins, or store personal information. Your interest preferences are saved to your browser\'s local storage only — they are never sent to our servers. Uploaded images in the Visual Search tool are sent to the AI model for analysis only and are not stored. Chat messages within a session are used to maintain conversation context but are not retained after you close the browser.'
    },
    {
      q: 'Does the AI represent all cultures equally?',
      a: 'No — and we are honest about this. The source collection data is significantly weighted toward European, South Asian, and East Asian objects due to historical acquisition patterns. Our AI tools inherit this bias. In the Discover tool, we have an "Underrepresented" mode that specifically surfaces objects from collections that receive less traffic, including African, Latin American, and Oceanic holdings. This does not solve the underlying problem, but it is one active step we are taking. We publish a bias report updated quarterly.'
    },
    {
      q: 'How accessible are these tools?',
      a: 'All tools are built with accessibility as a core requirement, not an afterthought. This includes: semantic HTML5 landmarks and headings; ARIA labels throughout; full keyboard navigation; screen reader compatible (tested with NVDA, VoiceOver); a built-in large text mode; a high contrast mode; colour choices that meet WCAG 2.1 AA contrast ratios; and a skip-to-content link. We welcome accessibility feedback to improve further.'
    },
    {
      q: 'Are the AI interpretations in the Reimagine tool accurate?',
      a: 'The "Reimagine" tool is explicitly an interpretive and educational tool, not a source of authoritative museum information. Every output is clearly labelled as AI-generated interpretation. The AI is instructed to acknowledge uncertainty, flag when it is speculating, and note where cultural perspectives are incomplete or contested. Think of it as a starting point for exploration — always follow the links to real collection objects and curated source content to go deeper.'
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

document.addEventListener('DOMContentLoaded', () => {
  initTransparencyPage();
});
