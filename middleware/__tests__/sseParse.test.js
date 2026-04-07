import { extractTextDelta, parseEventBlock } from '../sseParse';

describe('extractTextDelta', () => {
  it('reads OpenAI chat completion delta', () => {
    expect(
      extractTextDelta({
        choices: [{ delta: { content: 'hello' } }],
      })
    ).toBe('hello');
  });

  it('returns empty for unknown shape', () => {
    expect(extractTextDelta({ foo: 1 })).toBe('');
  });
});

describe('parseEventBlock', () => {
  it('parses data: JSON line', () => {
    const block = 'data: {"choices":[{"delta":{"content":"Hi"}}]}';
    expect(parseEventBlock(block)).toBe('Hi');
  });

  it('returns null for [DONE]', () => {
    expect(parseEventBlock('data: [DONE]')).toBeNull();
  });

  it('ignores comment lines', () => {
    const block = ': ping\ndata: {"choices":[{"delta":{"content":"x"}}]}';
    expect(parseEventBlock(block)).toBe('x');
  });

  it('falls back to raw payload when JSON is invalid', () => {
    expect(parseEventBlock('data: not-json')).toBe('not-json');
  });

  it('returns null for empty payload', () => {
    expect(parseEventBlock('data: \n')).toBeNull();
  });
});
