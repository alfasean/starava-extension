import { LlmHttpError } from '../llm/errors';
import { SettingsValidationError, type ProviderId } from '../settings/types';
import { StravaAuthError, StravaFormatError, StravaRateLimitError } from '../strava/errors';

export interface UserFacingError {
  message: string;
  action?: 'open-strava' | 'open-settings';
  details?: string;
}

const PROVIDER_NAMES: Record<ProviderId, string> = {
  openai: 'OpenAI',
  anthropic: 'Anthropic',
  gemini: 'Google Gemini',
  'openai-compatible': 'Your OpenAI-compatible provider',
  'new-api': 'Your New API gateway',
};

export function providerDisplayName(p: ProviderId): string {
  return PROVIDER_NAMES[p] ?? p;
}

export function isAbortError(e: unknown): boolean {
  return (
    typeof e === 'object' && e !== null && 'name' in e && (e as { name: unknown }).name === 'AbortError'
  );
}

const GENERIC = 'Something went wrong.';

/** Maps any thrown value to copy for the UI; `null` means "stay silent" (user aborted). */
export function toUserFacingError(e: unknown): UserFacingError | null {
  if (isAbortError(e)) return null;
  if (e instanceof StravaAuthError) {
    return { message: 'Please log in to strava.com and try again.', action: 'open-strava' };
  }
  if (e instanceof StravaFormatError) {
    return { message: "Strava's data format changed.", details: e.details };
  }
  if (e instanceof StravaRateLimitError) {
    return { message: 'Strava is rate limiting requests. Wait a minute and try again.' };
  }
  if (e instanceof LlmHttpError) {
    const name = providerDisplayName(e.provider);
    if (e.status === 401 || e.status === 403) {
      return { message: `${name} rejected the API key.`, action: 'open-settings' };
    }
    if (e.status === 429) {
      return { message: `${name} quota or rate limit reached.`, action: 'open-settings' };
    }
    return { message: GENERIC, details: `${name}: HTTP ${e.status}${e.body ? ` — ${e.body}` : ''}` };
  }
  if (e instanceof SettingsValidationError) {
    return { message: 'Your settings need attention.', action: 'open-settings', details: e.problems.join('\n') };
  }
  return { message: GENERIC, details: e instanceof Error ? e.message : String(e) };
}
