import { describe, it, expect } from 'vitest';
import { buildOpenAiPayload } from '../modelMapper';

describe('buildOpenAiPayload', () => {
  it('should format deepseek-v4-flash payload correctly', () => {
    const payload = buildOpenAiPayload('deepseek-v4-flash', [{ role: 'user', content: 'hi' }]);
    expect(payload.model).toBe('deepseek-ai/deepseek-v4-flash');
    expect(payload.max_tokens).toBe(16384);
    expect(payload.chat_template_kwargs.thinking).toBe(true);
  });



  it('should map mimo models correctly', () => {
    const fastPayload = buildOpenAiPayload('mimo-v2.5', []);
    expect(fastPayload.model).toBe('mimo-v2.5');

    const proPayload = buildOpenAiPayload('mimo-v2.5-pro', []);
    expect(proPayload.model).toBe('mimo-v2.5-pro');
  });

  it('should pass tools when tools are provided', () => {
    const tools = [{ type: 'function', function: { name: 'test' } }];
    const payload = buildOpenAiPayload('glm-5.2', [], tools);
    expect(payload.tools).toEqual(tools);
  });

  it('should not pass tools if tools array is empty', () => {
    const payload = buildOpenAiPayload('glm-5.2', [], []);
    expect(payload.tools).toBeUndefined();
  });
});
