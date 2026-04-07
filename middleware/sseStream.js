/* global TextDecoder */
/**
 * SSE over fetch + ReadableStream. Parsing lives in ./sseParse.js.
 */

import { parseEventBlock } from './sseParse';

/**
 * Stream UTF-8 SSE from a Response body; yield text deltas.
 *
 * @param {string} url
 * @param {{ body?: string, headers?: Record<string, string>, signal?: AbortSignal }} options
 */
export async function* streamSSE (url, { body, headers = {}, signal } = {}) {
  const response = await fetch(url, {
    method: 'POST',
    headers,
    body,
    signal,
  });

  if (!response.ok) {
    const errText = await response.text().catch(() => '');
    throw new Error(`SSE ${response.status}: ${errText.slice(0, 200)}`);
  }

  const stream = response.body;
  if (!stream?.getReader) {
    throw new Error('ReadableStream not available');
  }

  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let carry = '';

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (signal?.aborted) return;
      if (done) break;

      carry += decoder.decode(value, { stream: true });
      carry = carry.replace(/\r\n/g, '\n');

      let sep;
      while ((sep = carry.indexOf('\n\n')) !== -1) {
        const block = carry.slice(0, sep);
        carry = carry.slice(sep + 2);
        const trimmed = block.trim();
        if (!trimmed) continue;
        const delta = parseEventBlock(trimmed);
        if (delta) yield delta;
      }
    }

    if (carry.trim()) {
      const delta = parseEventBlock(carry.trim());
      if (delta) yield delta;
    }
  } finally {
    reader.releaseLock?.();
  }
}
