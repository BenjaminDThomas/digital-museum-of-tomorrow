'use strict';

// Ollama API service layer. Handles health checks, streamed chat, and JSON
// response parsing. Exposes window.A2BCOllama for use across all AI features.
(function initOllamaService() {
  const defaultChatUrl = 'http://localhost:11434/api/chat';
  const defaultTagsUrl = 'http://localhost:11434/api/tags';
  // Cache pending readiness checks to avoid duplicate requests on the same URL.
  const readinessChecks = new Map();

  // Check that the Ollama server is reachable, caching the in-flight promise.
  async function checkApi(tagsUrl = defaultTagsUrl) {
    const existingCheck = readinessChecks.get(tagsUrl);
    if (existingCheck) return existingCheck;

    const pendingCheck = fetch(tagsUrl, { method: 'GET' }).then(response => {
      if (!response.ok) {
        throw new Error(`Ollama health check failed: ${response.status}`);
      }
      return true;
    });

    readinessChecks.set(tagsUrl, pendingCheck);
    try {
      return await pendingCheck;
    } catch (error) {
      readinessChecks.delete(tagsUrl);
      throw error;
    }
  }

  // Send a streaming chat request to Ollama, calling onText with each accumulated chunk.
  async function streamChat({
    systemPrompt,
    messages = [],
    userPrompt = null,
    model = 'phi3:mini',
    chatUrl = defaultChatUrl,
    tagsUrl = defaultTagsUrl,
    options = {},
    format,
    onText,
  }) {
    await checkApi(tagsUrl);

    // Build the message array with optional system and user entries.
    const payload = {
      model,
      messages: [
        ...(systemPrompt ? [{ role: 'system', content: systemPrompt }] : []),
        ...messages,
        ...(userPrompt ? [{ role: 'user', content: userPrompt }] : []),
      ],
      stream: true,
      options,
    };

    if (format) payload.format = format;

    const response = await fetch(chatUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    if (!response.body) {
      throw new Error('Ollama response body was empty.');
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let fullResponse = '';
    // Buffer incomplete lines between chunks.
    let remainder = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      remainder += decoder.decode(value, { stream: true });
      const lines = remainder.split('\n');
      remainder = lines.pop() || '';

      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const data = JSON.parse(line);
          const chunk = data.message?.content || '';
          if (!chunk) continue;
          fullResponse += chunk;
          if (onText) onText(fullResponse, chunk);
        } catch (_) {
          // Ignore malformed stream lines.
        }
      }
    }

    // Flush any final incomplete line that was not followed by a newline.
    if (remainder.trim()) {
      try {
        const data = JSON.parse(remainder);
        const chunk = data.message?.content || '';
        if (chunk) {
          fullResponse += chunk;
          if (onText) onText(fullResponse, chunk);
        }
      } catch (_) {
        // Ignore malformed final line.
      }
    }

    return fullResponse;
  }

  // Strip code fences and attempt to parse the model's text output as JSON.
  function parseJsonResponse(text) {
    const cleaned = (text || '').replace(/```json|```/g, '').trim();
    try {
      return JSON.parse(cleaned);
    } catch (_) {
      const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        throw new Error('Text model did not return valid JSON.');
      }
      return JSON.parse(jsonMatch[0]);
    }
  }

  // Stream a chat request and parse the full response as JSON.
  async function streamJsonChat(config) {
    const text = await streamChat(config);
    return {
      text,
      parsed: parseJsonResponse(text),
    };
  }

  window.A2BCOllama = {
    checkApi,
    streamChat,
    streamJsonChat,
    parseJsonResponse,
  };
})();
