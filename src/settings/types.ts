export type ProviderId = 'openai' | 'anthropic' | 'gemini' | 'openai-compatible' | 'new-api';

export interface AthleteProfile {
  maxHr: number;
  restHr: number;
  thresholdPaceSecPerKm?: number;
}

export interface Settings {
  provider: ProviderId;
  apiKey: string;
  model: string;
  baseUrl?: string;
  athlete: AthleteProfile;
}

export class SettingsValidationError extends Error {
  problems: string[];
  constructor(problems: string[]) {
    super(`Invalid settings: ${problems.join('; ')}`);
    this.name = 'SettingsValidationError';
    this.problems = problems;
  }
}
