/** The user is not logged in to strava.com (or the session expired). */
export class StravaAuthError extends Error {
  constructor(message = 'Not logged in to Strava') {
    super(message);
    this.name = 'StravaAuthError';
  }
}

/** Strava returned data in a shape we do not understand. */
export class StravaFormatError extends Error {
  constructor(
    message: string,
    readonly details: string,
  ) {
    super(message);
    this.name = 'StravaFormatError';
  }
}

/** Strava kept answering 429 after all retries. */
export class StravaRateLimitError extends Error {
  constructor(message = 'Strava rate limit exceeded; try again later') {
    super(message);
    this.name = 'StravaRateLimitError';
  }
}

export function abortError(): DOMException {
  return new DOMException('The operation was aborted.', 'AbortError');
}

export function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw abortError();
}
