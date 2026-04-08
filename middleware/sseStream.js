/* global TextDecoder, XMLHttpRequest */
/**
 * SSE over fetch + ReadableStream. Parsing lives in ./sseParse.js.
 */

import { parseEventBlock } from './sseParse';

function drainSSEBlocks(carry, onDelta) {
  let next = carry.replace(/\r\n/g, '\n');
  let sep;
  while ((sep = next.indexOf('\n\n')) !== -1) {
    const block = next.slice(0, sep).trim();
    next = next.slice(sep + 2);
    if (!block) continue;
    const delta = parseEventBlock(block);
    if (delta) onDelta(delta);
  }
  return next;
}

async function* streamSSEViaReadableStream(response, { signal }) {
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let carry = '';
  const queue = [];

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (signal?.aborted) return;
      if (done) break;

      carry += decoder.decode(value, { stream: true });
      carry = drainSSEBlocks(carry, (delta) => queue.push(delta));
      while (queue.length > 0) yield queue.shift();
    }

    if (carry.trim()) {
      const delta = parseEventBlock(carry.trim());
      if (delta) yield delta;
    }
  } finally {
    reader.releaseLock?.();
  }
}

async function* streamSSEViaXHR(url, { body, headers, signal }) {
  const xhr = new XMLHttpRequest();
  let cursor = 0;
  let carry = '';
  const queue = [];
  let done = false;
  let fatalError = null;
  let wake = null;

  const notify = () => {
    if (wake) {
      wake();
      wake = null;
    }
  };
  const pushDelta = (delta) => {
    if (!delta) return;
    queue.push(delta);
    notify();
  };

  const absorbResponseText = () => {
    const full = xhr.responseText || '';
    if (cursor >= full.length) return;
    carry += full.slice(cursor);
    cursor = full.length;
    carry = drainSSEBlocks(carry, pushDelta);
  };

  xhr.open('POST', url, true);
  Object.entries(headers || {}).forEach(([k, v]) => xhr.setRequestHeader(k, v));

  xhr.onprogress = absorbResponseText;
  xhr.onerror = () => {
    fatalError = new Error('SSE network error');
    done = true;
    notify();
  };
  xhr.onabort = () => {
    done = true;
    notify();
  };
  xhr.onload = () => {
    absorbResponseText();
    if (carry.trim()) {
      const delta = parseEventBlock(carry.trim());
      if (delta) pushDelta(delta);
    }
    if (xhr.status < 200 || xhr.status >= 300) {
      fatalError = new Error(
        `SSE ${xhr.status}: ${(xhr.responseText || '').slice(0, 200)}`
      );
    }
    done = true;
    notify();
  };

  const abortHandler = () => xhr.abort();
  signal?.addEventListener?.('abort', abortHandler);
  xhr.send(body);

  try {
    while (!done || queue.length > 0) {
      if (queue.length > 0) {
        yield queue.shift();
        continue;
      }
      await new Promise((resolve) => {
        wake = resolve;
      });
    }
    if (fatalError && !signal?.aborted) {
      throw fatalError;
    }
  } finally {
    signal?.removeEventListener?.('abort', abortHandler);
    if (!done && xhr.readyState !== 4) xhr.abort();
  }
}

/**
 * Stream UTF-8 SSE from a Response body; yield text deltas.
 *
 * @param {string} url
 * @param {{ body?: string, headers?: Record<string, string>, signal?: AbortSignal }} options
 */
export async function* streamSSE (url, { body, headers = {}, signal } = {}) {
  const response = await fetch(url, { method: 'POST', headers, body, signal });
  if (!response.ok) {
    const errText = await response.text().catch(() => '');
    throw new Error(`SSE ${response.status}: ${errText.slice(0, 200)}`);
  }

  // Prefer ReadableStream, fallback to XHR on Android runtimes
  // where fetch streaming is not available.
  if (response.body?.getReader) {
    yield* streamSSEViaReadableStream(response, { signal });
    return;
  }

  yield* streamSSEViaXHR(url, { body, headers, signal });
}
