'use strict';

function initChatbotPage() {
  const chatMessages = document.getElementById('chat-messages');
  if (!chatMessages) return;

  const topics = [
    'Victorian fashion',
    'Japanese ceramics',
    'Islamic geometric art',
    'Tudor jewellery',
    'Arts and Crafts movement',
    'Ancient Egyptian objects',
    'William Morris designs',
    'Medieval manuscripts'
  ];
  const prompts = [
    'Show me objects made of silk',
    'What did people wear in 1870s England?',
    'Find pottery from the Tang dynasty',
    'Tell me about the Arts and Crafts movement',
    'Objects connected to India',
    'Jewellery from the Renaissance'
  ];
  const systemPrompt = `You are a knowledgeable, friendly museum data guide for A2BC. You help visitors explore collection records spanning 5,000 years of art, design, fashion, and culture from around the world.

Your role:
- Answer questions about artefacts, periods, styles, materials, makers, and cultural contexts
- Suggest relevant search terms and filters for the V&A API (e.g. material IDs, technique IDs, place IDs)
- Make connections between objects, periods, and cultures in an engaging, accessible way
- Be honest when you don't know something or when data may be incomplete
- Flag if descriptions may use dated terminology and suggest respectful alternatives
- Keep responses concise but rich — this is a museum context, not an academic paper

Hard rules:
- Keep prose replies brief: maximum 2-4 short sentences.
- Never invent exhibits, object titles, IDs, or records.
- Never say you cannot access the museum data.
- If the user asks to see/find/show objects, always provide a vam_search JSON suggestion.
- If you are uncertain about exact matches, say so briefly and immediately provide a broad vam_search query.
- Only include filter IDs (e.g. id_material, id_technique) if you are confident they are valid; otherwise omit IDs and use q only.

When suggesting V&A API searches, format them as JSON at the end of your response like this:
{"vam_search": {"q": "search term", "id_material": "AAT12345"}}

Be inclusive, curious, and celebratory of human creativity across all cultures and time periods.`;

  const chatInput = document.getElementById('chat-input');
  const sendButton = document.getElementById('send-btn');
  const chatWelcome = document.getElementById('chat-welcome');
  const welcomePrompts = document.getElementById('welcome-prompts');
  const inlinePrompts = document.getElementById('inline-prompts');
  const chatHistory = document.getElementById('chat-history');
  const topicSuggestions = document.getElementById('topic-suggestions');

  let conversationHistory = [];

  function createPromptButton(text) {
    const button = document.createElement('button');
    button.className = 'suggested-prompt';
    button.textContent = text;
    button.type = 'button';
    button.addEventListener('click', () => sendMessage(text));
    return button;
  }

  function showInlinePrompts() {
    inlinePrompts.innerHTML = '';
    prompts.slice(0, 3).forEach(prompt => {
      inlinePrompts.appendChild(createPromptButton(prompt));
    });
  }

  function appendMessage(role, content, extras = {}) {
    if (chatWelcome) chatWelcome.hidden = true;
    const message = document.createElement('div');
    message.className = `message message--${role === 'user' ? 'user' : 'ai'}`;
    message.innerHTML = `
      <div class="message__avatar" aria-hidden="true">${role === 'user' ? '👤' : '✶'}</div>
      <div class="message__bubble">
        <div class="message__text"></div>
        ${extras.source ? `<div class="message__source"><span>📖</span> Source: ${extras.source}</div>` : ''}
      </div>
    `;
    window.A2BCText.renderInline(message.querySelector('.message__text'), content);
    chatMessages.appendChild(message);
    chatMessages.scrollTop = chatMessages.scrollHeight;
    return message;
  }

  async function appendRelatedObjects(container, params) {
    try {
      const data = await window.VAM.searchObjects({ ...params, page_size: 4 });
      const records = data.records || [];
      if (!records.length) return;

      const section = document.createElement('div');
      section.className = 'related-objects';
      section.innerHTML = '<h4>Related objects from the collection</h4><div class="related-objects-grid"></div>';
      container.appendChild(section);
      const grid = section.querySelector('.related-objects-grid');

      records.forEach(record => {
        const mini = document.createElement('div');
        mini.className = 'related-mini-card';
        mini.tabIndex = 0;
        mini.setAttribute('role', 'button');
        const imageUrl = window.VAM.getArtefactImageUrl(record, 'thumb');
        const title = record._primaryTitle || record.objectType || 'Object';
        mini.innerHTML = `
          ${imageUrl ? `<img src="${imageUrl}" alt="${window.VAM.escHtml(title)}" loading="lazy"/>` : '<div class="artefact-placeholder">🏺</div>'}
          <p>${window.VAM.escHtml(title.slice(0, 40))}${title.length > 40 ? '…' : ''}</p>
        `;
        mini.addEventListener('click', () => window.VAM.openArtefactModal(record, record.systemNumber || ''));
        mini.addEventListener('keydown', event => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            window.VAM.openArtefactModal(record, record.systemNumber || '');
          }
        });
        grid.appendChild(mini);
      });
    } catch (_) {
      // Ignore related object failures.
    }
  }

  function parseVamSearchSnippet(snippet) {
    if (!snippet) return null;
    const normalized = snippet
      .replace(/[\u201C\u201D]/g, '"')
      .replace(/[\u2018\u2019]/g, "'")
      .trim();
    try {
      const parsed = JSON.parse(normalized);
      if (parsed && typeof parsed === 'object' && parsed.vam_search && typeof parsed.vam_search === 'object') {
        return parsed.vam_search;
      }
    } catch (_) {
      // Ignore invalid JSON snippets.
    }
    return null;
  }

  function extractVamSearch(text) {
    let cleanText = text;
    let searchParams = null;

    const fencedBlockRegex = /```(?:json)?\s*([\s\S]*?)```/gi;
    cleanText = cleanText.replace(fencedBlockRegex, (fullMatch, blockContent) => {
      if (!searchParams) {
        const direct = parseVamSearchSnippet(blockContent);
        if (direct) searchParams = direct;
      }
      const embeddedMatches = blockContent.match(/\{[\s\S]*?"vam_search"\s*:\s*\{[\s\S]*?\}\s*\}/g) || [];
      if (!searchParams) {
        for (const match of embeddedMatches) {
          const parsed = parseVamSearchSnippet(match);
          if (parsed) {
            searchParams = parsed;
            break;
          }
        }
      }
      return '';
    });

    const inlineMatches = cleanText.match(/\{[\s\S]*?"vam_search"\s*:\s*\{[\s\S]*?\}\s*\}/g) || [];
    for (const match of inlineMatches) {
      if (!searchParams) {
        const parsed = parseVamSearchSnippet(match);
        if (parsed) searchParams = parsed;
      }
      cleanText = cleanText.replace(match, '');
    }

    return {
      searchParams,
      cleanText: cleanText.trim()
    };
  }

  function isCollectionIntent(text) {
    return /(show|find|search|looking for|look for|artefacts?|artifacts?|objects?|collection|related to)/i.test(text || '');
  }

  function makeConciseReply(text, maxChars = 480) {
    const normalized = (text || '').trim();
    if (normalized.length <= maxChars) return normalized;
    const sentences = normalized.match(/[^.!?]+[.!?]?/g) || [normalized];
    let concise = '';
    for (const sentence of sentences) {
      const candidate = `${concise} ${sentence}`.trim();
      if (candidate.length > maxChars) break;
      concise = candidate;
      if ((concise.match(/[.!?]/g) || []).length >= 3) break;
    }
    return concise || `${normalized.slice(0, maxChars - 1)}…`;
  }

  async function sendMessage(text) {
    if (!text.trim()) return;

    chatInput.value = '';
    chatInput.style.height = 'auto';
    sendButton.disabled = true;

    appendMessage('user', text);
    conversationHistory.push({ role: 'user', content: text });

    const historyItem = document.createElement('div');
    historyItem.className = 'chat-history-item';
    historyItem.textContent = text.slice(0, 50) + (text.length > 50 ? '…' : '');
    historyItem.tabIndex = 0;
    chatHistory.prepend(historyItem);

    const assistantMessage = appendMessage('ai', '');
    const textNode = assistantMessage.querySelector('.message__text');
    let fullResponse = '';

    try {
      fullResponse = await window.A2BCOllama.streamChat({
        systemPrompt,
        messages: conversationHistory,
        options: {
          temperature: 0.3,
          num_predict: 180
        },
        onText: streamedText => {
          window.A2BCText.renderInline(textNode, streamedText);
          chatMessages.scrollTop = chatMessages.scrollHeight;
        }
      });

      conversationHistory.push({ role: 'assistant', content: fullResponse });
      const extracted = extractVamSearch(fullResponse);
      let searchParams = extracted.searchParams;
      const cleanText = makeConciseReply(extracted.cleanText);
      window.A2BCText.renderInline(textNode, cleanText);

      const source = document.createElement('div');
      source.className = 'message__source';
      source.innerHTML = '<span>📖</span> Source: V&A Collections API + AI';
      assistantMessage.querySelector('.message__bubble').appendChild(source);

      if (!searchParams && isCollectionIntent(text)) {
        searchParams = { q: text };
      }

      if (searchParams) {
        await appendRelatedObjects(assistantMessage.querySelector('.message__bubble'), searchParams);
      }
      showInlinePrompts();
    } catch (error) {
      textNode.textContent = `Error: ${error.message}. Make sure OLLAMA is running.`;
    } finally {
      sendButton.disabled = false;
      chatInput.focus();
    }
  }

  topics.forEach(topic => {
    const button = document.createElement('button');
    button.className = 'chat-history-item';
    button.textContent = topic;
    button.type = 'button';
    button.addEventListener('click', () => sendMessage(topic));
    topicSuggestions.appendChild(button);
  });
  prompts.slice(0, 4).forEach(prompt => welcomePrompts.appendChild(createPromptButton(prompt)));

  chatInput.addEventListener('input', () => {
    chatInput.style.height = 'auto';
    chatInput.style.height = `${Math.min(chatInput.scrollHeight, 160)}px`;
    sendButton.disabled = chatInput.value.trim().length === 0;
  });
  chatInput.addEventListener('keydown', event => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      if (!sendButton.disabled) sendMessage(chatInput.value.trim());
    }
  });
  sendButton.addEventListener('click', () => {
    if (!sendButton.disabled) sendMessage(chatInput.value.trim());
  });
}

document.addEventListener('DOMContentLoaded', () => {
  initChatbotPage();
});
