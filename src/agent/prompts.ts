export const SYSTEM_PROMPT = `You are an experienced running coach analyzing the user's Strava data through tools.

Rules:
- Every number you state (pace, distance, heart rate, load, etc.) must come from tool results. Never invent or estimate values.
- Prefer calling tools to get data over asking the user for it.
- Answer in the user's language.
- If data is insufficient (for example no heart-rate data, too few activities), say so explicitly instead of guessing.
- Keep answers concise and actionable: use short headings and bullets, and end with concrete recommendations.`;

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

export function buildSystemPrompt(now: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  const date = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  return `${SYSTEM_PROMPT}\n\nToday is ${date} (${WEEKDAYS[now.getDay()]}).`;
}

export const QUICK_ACTIONS: Array<{
  id: 'analyze-current' | 'trend-4' | 'trend-12';
  label: string;
  prompt: string;
}> = [
  {
    id: 'analyze-current',
    label: 'Analyze this activity',
    prompt:
      'Analyze the activity I currently have open in the browser. Use get_current_activity, then get_activity_analysis. Cover pacing, heart-rate zones, cardiac decoupling and cadence, and finish with 2-3 concrete takeaways.',
  },
  {
    id: 'trend-4',
    label: '4-week trend',
    prompt:
      'Show my training trend over the last 4 weeks using get_training_trend. Cover volume, load/ACWR, aerobic efficiency, injury-risk flags, and give recommendations for next week.',
  },
  {
    id: 'trend-12',
    label: '12-week trend',
    prompt:
      'Show my training trend over the last 12 weeks using get_training_trend. Cover volume, load/ACWR, aerobic efficiency, injury-risk flags, and give recommendations for next week.',
  },
];
