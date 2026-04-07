// mockStream.js
// Mimics an Anthropic-style SSE stream with realistic chunking behavior.
// Some chunks are single chars, some are small words — just like Claude.

const MOCK_RESPONSE = `Sure! React Native is a framework developed by Meta (formerly Facebook) that lets you build mobile apps using JavaScript and React.

Instead of compiling to native code directly, it runs your JS in a separate thread and communicates with native UI components via a bridge (or JSI in newer versions). This means you get real native widgets — not WebViews — while writing in JavaScript.

Key things to understand:
• The JS thread runs your logic and React reconciliation
• The UI thread renders actual native components (View → UIView on iOS, android.view.View on Android)
• Metro is the bundler that serves your JS bundle during development

The main tradeoff vs Flutter is that React Native depends on the host platform's native components, so UI parity across iOS and Android isn't always perfect. Flutter owns its own rendering engine (Skia/Impeller), so it's pixel-identical everywhere.

That said, React Native's ecosystem is massive and if you already know React, the learning curve is very shallow.`;

// Break text into chunks of variable size (1–6 chars) to mimic real LLM output
function chunkText(text) {
  const chunks = [];
  let i = 0;
  while (i < text.length) {
    // Vary chunk size: mostly 1-3 chars, occasionally up to 6
    const size = Math.random() < 0.7 ? 1 : Math.floor(Math.random() * 5) + 2;
    chunks.push(text.slice(i, i + size));
    i += size;
  }
  return chunks;
}

/**
 * mockStreamResponse
 *
 * Returns an async generator that yields text chunks with a variable delay,
 * simulating real LLM streaming behavior.
 *
 * Usage:
 *   for await (const chunk of mockStreamResponse(prompt)) {
 *     bufferRef.current += chunk;
 *   }
 *
 * @param {string} _prompt - ignored, always streams MOCK_RESPONSE
 * @param {{ signal?: AbortSignal }} options
 */
export async function* mockStreamResponse(_prompt, { signal } = {}) {
  // Simulate ~300ms TTFT (time to first token)
  await delay(300);

  const chunks = chunkText(MOCK_RESPONSE);

  for (const chunk of chunks) {
    if (signal?.aborted) return;

    yield chunk;

    // Variable inter-chunk delay: 10–40ms, occasional 80ms pause (punctuation feel)
    const isPunctuation = /[.,!?\n•]/.test(chunk);
    await delay(isPunctuation ? 80 : Math.random() * 30 + 10);
  }
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}