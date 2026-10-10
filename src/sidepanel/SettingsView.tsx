import { useState, type FormEvent } from 'react';
import { saveSettings, validateSettings } from '../settings/store';
import { SettingsValidationError, type ProviderId, type Settings } from '../settings/types';
import { ensureHostPermission } from './permissions';

const PROVIDERS: Array<{ id: ProviderId; label: string; modelHint: string }> = [
  { id: 'openai', label: 'OpenAI', modelHint: 'e.g. gpt-…' },
  { id: 'anthropic', label: 'Anthropic', modelHint: 'e.g. claude-…' },
  { id: 'gemini', label: 'Google Gemini', modelHint: 'e.g. gemini-…' },
  { id: 'openai-compatible', label: 'OpenAI-compatible', modelHint: 'e.g. llama3.1' },
];

const PACE_RE = /^(\d{1,2}):([0-5]\d)$/;

export function formatPace(sec: number | undefined): string {
  if (sec === undefined) return '';
  return `${Math.floor(sec / 60)}:${String(Math.round(sec % 60)).padStart(2, '0')}`;
}

/** '' → undefined; 'm:ss' → seconds; anything else → NaN. */
export function parsePace(s: string): number | undefined {
  const t = s.trim();
  if (!t) return undefined;
  const m = PACE_RE.exec(t);
  return m ? Number(m[1]) * 60 + Number(m[2]) : NaN;
}

interface Props {
  initial: Settings;
  onSaved(s: Settings): void;
}

export default function SettingsView({ initial, onSaved }: Props) {
  const [provider, setProvider] = useState<ProviderId>(initial.provider);
  const [apiKey, setApiKey] = useState(initial.apiKey);
  const [showKey, setShowKey] = useState(false);
  const [model, setModel] = useState(initial.model);
  const [baseUrl, setBaseUrl] = useState(initial.baseUrl ?? '');
  const [maxHr, setMaxHr] = useState(String(initial.athlete.maxHr));
  const [restHr, setRestHr] = useState(String(initial.athlete.restHr));
  const [pace, setPace] = useState(formatPace(initial.athlete.thresholdPaceSecPerKm));
  const [problems, setProblems] = useState<string[]>([]);
  const [warning, setWarning] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);

  const hint = PROVIDERS.find((p) => p.id === provider)?.modelHint ?? '';
  const compatible = provider === 'openai-compatible';

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setSaved(false);
    setWarning(null);

    const paceSec = parsePace(pace);
    const s: Settings = {
      provider,
      apiKey: apiKey.trim(),
      model: model.trim(),
      ...(compatible ? { baseUrl: baseUrl.trim() } : {}),
      athlete: {
        maxHr: Number(maxHr),
        restHr: Number(restHr),
        ...(paceSec !== undefined && !Number.isNaN(paceSec) ? { thresholdPaceSecPerKm: paceSec } : {}),
      },
    };
    const found = validateSettings(s);
    if (Number.isNaN(paceSec)) found.push('Threshold pace must be in mm:ss format, e.g. 4:30.');
    if (found.length > 0) {
      setProblems(found);
      return;
    }
    setProblems([]);
    setSaving(true);
    try {
      // Request first, while the click still counts as a user gesture.
      if (compatible && !(await ensureHostPermission(s.baseUrl!))) {
        setWarning(
          'Permission to reach this base URL was not granted. Requests to it will fail until you allow it.',
        );
      }
      await saveSettings(s);
      setSaved(true);
      onSaved(s);
    } catch (err) {
      setProblems(err instanceof SettingsValidationError ? err.problems : [String(err)]);
    } finally {
      setSaving(false);
    }
  };

  return (
    <form className="settings" onSubmit={onSubmit} noValidate>
      <h2>AI provider</h2>
      <label>
        Provider
        <select value={provider} onChange={(e) => setProvider(e.target.value as ProviderId)}>
          {PROVIDERS.map((p) => (
            <option key={p.id} value={p.id}>
              {p.label}
            </option>
          ))}
        </select>
      </label>
      <label>
        API key
        <span className="with-button">
          <input
            type={showKey ? 'text' : 'password'}
            value={apiKey}
            autoComplete="off"
            spellCheck={false}
            onChange={(e) => setApiKey(e.target.value)}
          />
          <button type="button" className="ghost" onClick={() => setShowKey((v) => !v)}>
            {showKey ? 'Hide' : 'Show'}
          </button>
        </span>
      </label>
      <label>
        Model
        <input value={model} placeholder={hint} spellCheck={false} onChange={(e) => setModel(e.target.value)} />
      </label>
      {compatible && (
        <label>
          Base URL
          <input
            value={baseUrl}
            placeholder="e.g. http://localhost:11434/v1"
            spellCheck={false}
            onChange={(e) => setBaseUrl(e.target.value)}
          />
        </label>
      )}
      <p className="muted small">Your API key is stored locally in this browser and sent only to the provider.</p>

      <h2>Athlete</h2>
      <div className="row">
        <label>
          Max HR (bpm)
          <input type="number" inputMode="numeric" value={maxHr} onChange={(e) => setMaxHr(e.target.value)} />
        </label>
        <label>
          Resting HR (bpm)
          <input type="number" inputMode="numeric" value={restHr} onChange={(e) => setRestHr(e.target.value)} />
        </label>
      </div>
      <label>
        Threshold pace (mm:ss per km, optional)
        <input value={pace} placeholder="e.g. 4:30" onChange={(e) => setPace(e.target.value)} />
      </label>

      {problems.length > 0 && (
        <ul className="problems" role="alert">
          {problems.map((p) => (
            <li key={p}>{p}</li>
          ))}
        </ul>
      )}
      {warning && (
        <p className="warning" role="status">
          {warning}
        </p>
      )}
      <div className="actions">
        <button type="submit" className="primary" disabled={saving}>
          Save
        </button>
        {saved && <span className="muted small">Saved.</span>}
      </div>
    </form>
  );
}
