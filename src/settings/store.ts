import { SettingsValidationError, type Settings } from './types';

export { SettingsValidationError };
export type { Settings, ProviderId, AthleteProfile } from './types';

const KEY = 'settings';

export const DEFAULT_SETTINGS: Settings = {
  provider: 'openai',
  apiKey: '',
  model: '',
  athlete: { maxHr: 190, restHr: 60 },
};

export async function loadSettings(): Promise<Settings> {
  const res = await chrome.storage.local.get(KEY);
  const stored = (res[KEY] ?? {}) as Partial<Settings>;
  return {
    ...DEFAULT_SETTINGS,
    ...stored,
    athlete: { ...DEFAULT_SETTINGS.athlete, ...(stored.athlete ?? {}) },
  };
}

export async function saveSettings(s: Settings): Promise<void> {
  const problems = validateSettings(s);
  if (problems.length > 0) throw new SettingsValidationError(problems);
  await chrome.storage.local.set({ [KEY]: s });
}

export function validateSettings(s: Settings): string[] {
  const problems: string[] = [];
  const { maxHr, restHr, thresholdPaceSecPerKm: pace } = s.athlete;
  if (!(maxHr >= 100 && maxHr <= 230)) problems.push('Max heart rate must be between 100 and 230 bpm.');
  if (!(restHr >= 30 && restHr <= 100)) problems.push('Resting heart rate must be between 30 and 100 bpm.');
  if (restHr >= maxHr) problems.push('Resting heart rate must be lower than max heart rate.');
  if (pace !== undefined && !(pace >= 120 && pace <= 900)) {
    problems.push('Threshold pace must be between 120 and 900 seconds per km.');
  }
  const baseUrl = s.baseUrl?.trim();
  if (s.provider === 'openai-compatible' && !baseUrl) {
    problems.push('Base URL is required for an OpenAI-compatible provider.');
  } else if (s.provider === 'new-api' && !baseUrl) {
    problems.push('Gateway URL is required for a New API gateway.');
  } else if (baseUrl && !/^https?:\/\//i.test(baseUrl)) {
    problems.push('Base URL must start with http:// or https://.');
  }
  return problems;
}

export function isConfigured(s: Settings): boolean {
  return validateSettings(s).length === 0 && !!s.apiKey && !!s.model;
}
