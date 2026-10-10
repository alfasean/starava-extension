import { describe, it, expect } from 'vitest';
import { DEFAULT_SETTINGS, loadSettings, saveSettings, validateSettings, isConfigured } from '../../src/settings/store';
import { SettingsValidationError, type Settings } from '../../src/settings/types';

const valid = (o: Partial<Settings> = {}): Settings => ({
  ...DEFAULT_SETTINGS, apiKey: 'k', model: 'm', ...o,
});

describe('settings store', () => {
  it('loads defaults from empty storage', async () => {
    expect(await loadSettings()).toEqual(DEFAULT_SETTINGS);
  });
  it('round-trips', async () => {
    const s = valid({ provider: 'anthropic', athlete: { maxHr: 185, restHr: 50, thresholdPaceSecPerKm: 270 } });
    await saveSettings(s);
    expect(await loadSettings()).toEqual(s);
  });
  it('fills athlete defaults for a stored partial athlete', async () => {
    await chrome.storage.local.set({ settings: { apiKey: 'x', athlete: { maxHr: 180 } } });
    const s = await loadSettings();
    expect(s.athlete).toEqual({ maxHr: 180, restHr: 60 });
    expect(s.apiKey).toBe('x');
  });
  it('saveSettings throws SettingsValidationError with problems', async () => {
    const bad = valid({ athlete: { maxHr: 100, restHr: 100 } });
    const err = await saveSettings(bad).catch((e) => e);
    expect(err).toBeInstanceOf(SettingsValidationError);
    expect(err.problems.length).toBeGreaterThan(0);
    expect((await chrome.storage.local.get('settings')).settings).toBeUndefined();
  });
});

describe('validateSettings', () => {
  it('accepts valid settings', () => expect(validateSettings(valid())).toEqual([]));
  it('flags restHr >= maxHr', () => {
    expect(validateSettings(valid({ athlete: { maxHr: 150, restHr: 150 } })).join()).toMatch(/lower than max/i);
  });
  it('flags maxHr out of range', () => {
    expect(validateSettings(valid({ athlete: { maxHr: 99, restHr: 60 } })).join()).toMatch(/max heart rate/i);
    expect(validateSettings(valid({ athlete: { maxHr: 231, restHr: 60 } })).join()).toMatch(/max heart rate/i);
  });
  it('flags restHr out of range', () => {
    expect(validateSettings(valid({ athlete: { maxHr: 190, restHr: 29 } })).join()).toMatch(/resting heart rate/i);
    expect(validateSettings(valid({ athlete: { maxHr: 190, restHr: 101 } })).join()).toMatch(/resting heart rate/i);
  });
  it('requires baseUrl for openai-compatible', () => {
    expect(validateSettings(valid({ provider: 'openai-compatible' })).join()).toMatch(/base url/i);
  });
  it('rejects non-http baseUrl', () => {
    expect(validateSettings(valid({ provider: 'openai-compatible', baseUrl: 'ftp://x' })).join()).toMatch(/http/i);
    expect(validateSettings(valid({ provider: 'openai-compatible', baseUrl: 'https://x/v1' }))).toEqual([]);
  });
  it('checks threshold pace range 120-900', () => {
    const a = (t: number) => valid({ athlete: { maxHr: 190, restHr: 60, thresholdPaceSecPerKm: t } });
    expect(validateSettings(a(119)).join()).toMatch(/threshold pace/i);
    expect(validateSettings(a(901)).join()).toMatch(/threshold pace/i);
    expect(validateSettings(a(120))).toEqual([]);
    expect(validateSettings(a(900))).toEqual([]);
  });
});

describe('isConfigured', () => {
  it('false when apiKey or model empty', () => {
    expect(isConfigured(valid({ apiKey: '' }))).toBe(false);
    expect(isConfigured(valid({ model: '' }))).toBe(false);
    expect(isConfigured(valid())).toBe(true);
  });
});
