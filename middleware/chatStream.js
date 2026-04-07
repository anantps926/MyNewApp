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
    throw new Error('Set CHAT_CONFIG.apiKey (or enable useMock) before streaming.');
  }

  const body = JSON.stringify(buildChatRequestBody(prompt));
  const headers = buildChatHeaders();

  yield* streamSSE(CHAT_CONFIG.sseUrl, { body, headers, signal });
}
