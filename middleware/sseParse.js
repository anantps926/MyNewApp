/**
 * Pure SSE event parsing — easy to unit test without fetch or streams.
 * Target format: OpenAI-style chat completion chunks over SSE.
 */

/**
 * @param {unknown} json
 * @returns {string}
 */
export function extractTextDelta (json) {
  if (json == null || typeof json !== 'object') return '';
  const o = json;
  const c0 = o.choices?.[0];
  if (c0?.delta?.content != null && typeof c0.delta.content === 'string') {
    return c0.delta.content;
  }
  if (c0?.delta?.text != null && typeof c0.delta.text === 'string') {
    return c0.delta.text;
  }
  if (o.delta?.content != null && typeof o.delta.content === 'string') {
    return o.delta.content;
  }
  if (typeof o.content === 'string') return o.content;
  if (typeof o.text === 'string') return o.text;
  return '';
}

/**
 * Parse one SSE event block (between blank lines).
 * @param {string} block
 * @returns {string|null} Text delta, or null if done / empty
 */
export function parseEventBlock (block) {
  const lines = block.split('\n');
  let dataPayload = '';
  for (const line of lines) {
    if (line.startsWith(':')) continue;
    if (!line.startsWith('data:')) continue;
    const rest = line.slice(5).trimStart();
    if (rest === '[DONE]') return null;
    dataPayload += rest;
  }
  if (!dataPayload.trim()) return null;
  try {
    const json = JSON.parse(dataPayload);
    return extractTextDelta(json);
  } catch {
    return dataPayload;
  }
}
