import { describe, expect, it } from 'vitest';
import { toUserFacingError } from '../../src/sidepanel/errors';
import { StravaAuthError, StravaFormatError, StravaRateLimitError } from '../../src/strava/errors';
import { LlmHttpError } from '../../src/llm/errors';

describe('toUserFacingError', () => {
  it('returns null for AbortError', () => {
    expect(toUserFacingError(new DOMException('Aborted', 'AbortError'))).toBeNull();
  });

  it('maps StravaAuthError to a login prompt', () => {
    expect(toUserFacingError(new StravaAuthError())).toEqual({
      message: 'Please log in to strava.com and try again.',
      action: 'open-strava',
    });
  });

  it('maps StravaFormatError with details', () => {
    expect(toUserFacingError(new StravaFormatError('bad', 'streams: missing time'))).toEqual({
      message: "Strava's data format changed.",
      details: 'streams: missing time',
    });
  });

  it('maps StravaRateLimitError', () => {
    expect(toUserFacingError(new StravaRateLimitError())).toEqual({
      message: 'Strava is rate limiting requests. Wait a minute and try again.',
    });
  });

  it.each([
    ['openai', 401, 'OpenAI rejected the API key.'],
    ['anthropic', 403, 'Anthropic rejected the API key.'],
    ['gemini', 401, 'Google Gemini rejected the API key.'],
    ['new-api', 401, 'Your New API gateway rejected the API key.'],
    ['openai-compatible', 401, 'Your OpenAI-compatible provider rejected the API key.'],
    ['openai', 429, 'OpenAI quota or rate limit reached.'],
    ['gemini', 429, 'Google Gemini quota or rate limit reached.'],
  ] as const)('maps LlmHttpError %s %i', (provider, status, message) => {
    expect(toUserFacingError(new LlmHttpError(provider, status, '{}'))).toEqual({
      message,
      action: 'open-settings',
    });
  });

  it('maps other LlmHttpError statuses to the generic message with details', () => {
    const r = toUserFacingError(new LlmHttpError('anthropic', 500, 'overloaded'));
    expect(r?.message).toBe('Something went wrong.');
    expect(r?.details).toContain('500');
    expect(r?.details).toContain('overloaded');
  });

  it('maps unknown errors to the generic message with details', () => {
    expect(toUserFacingError(new TypeError('Failed to fetch'))).toEqual({
      message: 'Something went wrong.',
      details: 'Failed to fetch',
    });
    expect(toUserFacingError('boom')).toEqual({ message: 'Something went wrong.', details: 'boom' });
  });
});
