import type { ProviderId } from '../settings/types';

export class LlmHttpError extends Error {
  constructor(
    readonly provider: ProviderId,
    readonly status: number,
    readonly body: string,
  ) {
    super(`${provider} request failed with HTTP ${status}`);
    this.name = 'LlmHttpError';
  }
}
