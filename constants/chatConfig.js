/**
 * Chat streaming configuration.
 * Use plain functions (not methods on a config object) so `this` never breaks
 * when passing references around.
 *
 * Never commit real API keys — use env injection in CI or local overrides.
 */
export const CHAT_CONFIG = {
  /** When true, uses middleware/MockStream.js (no network). */
  useMock: true,

  sseUrl: 'https://api.openai.com/v1/chat/completions',
  apiKey: '',
  model: 'gpt-4o-mini',
};

export function buildChatRequestBody (userMessage) {
  return {
    model: CHAT_CONFIG.model,
    messages: [{ role: 'user', content: userMessage }],
    stream: true,
  };
}

export function buildChatHeaders () {
  const h = {
    'Content-Type': 'application/json',
    Accept: 'text/event-stream',
  };
  if (CHAT_CONFIG.apiKey) {
    h.Authorization = `Bearer ${CHAT_CONFIG.apiKey}`;
  }
  return h;
}
