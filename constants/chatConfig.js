import Config from 'react-native-config';

/**
 * Chat streaming configuration.
 * GROQ_API_KEY is read from .env via react-native-config.
 */
export const CHAT_CONFIG = {
  /** When true, uses middleware/MockStream.js (no network). */
  useMock: false,

  /** Groq OpenAI-compatible chat completions endpoint. */
  sseUrl: 'https://api.groq.com/openai/v1/chat/completions',
  apiKey: Config.GROQ_API_KEY || '',
  model: 'openai/gpt-oss-120b',
};

export function buildChatRequestBody (userMessage) {
  return {
    model: CHAT_CONFIG.model,
    messages: [{ role: 'user', content: userMessage }],
    stream: true,
  };
}

export function buildChatHeaders (apiKey) {
  const h = {
    'Content-Type': 'application/json',
    Accept: 'text/event-stream',
  };
  if (apiKey) {
    h.Authorization = `Bearer ${apiKey}`;
  }
  return h;
}
