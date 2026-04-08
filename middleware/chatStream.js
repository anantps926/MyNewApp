import {
  CHAT_CONFIG,
  buildChatHeaders,
  buildChatRequestBody,
} from '../constants/chatConfig';
import { mockStreamResponse } from './MockStream';
import { streamSSE } from './sseStream';

/**
 * Single entry: mock SSE or live OpenAI-compatible streaming.
 *
 * @param {string} prompt
 * @param {{ signal?: AbortSignal }} options
 */
export async function* createChatStream (prompt, { signal } = {}) {
  if (CHAT_CONFIG.useMock) {
    yield* mockStreamResponse(prompt, { signal });
    return;
  }

  if (!CHAT_CONFIG.apiKey) {
    throw new Error('Missing GROQ_API_KEY in .env (or enable useMock).');
  }

  const body = JSON.stringify(buildChatRequestBody(prompt));
  const headers = buildChatHeaders(CHAT_CONFIG.apiKey);

  yield* streamSSE(CHAT_CONFIG.sseUrl, { body, headers, signal });
}
