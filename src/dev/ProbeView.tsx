// TEMPORARY: probe UI. Removed in Task 2 Step 6.
import { useState } from 'react';
import { downloadJson, runProbe, type ProbeEntry } from './probe';

export default function ProbeView() {
  const [ids, setIds] = useState('');
  const [rows, setRows] = useState<ProbeEntry[]>([]);
  const [busy, setBusy] = useState(false);

  const run = async () => {
    setBusy(true);
    setRows([]);
    const provided = ids
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
      .slice(0, 3);
    try {
      const all = await runProbe(provided, (e) => setRows((r) => [...r, e]));
      downloadJson(all);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <p>Open a logged-in strava.com tab and keep it active.</p>
      <input
        value={ids}
        onChange={(e) => setIds(e.target.value)}
        placeholder="activity ids (comma separated, max 3, optional)"
        style={{ width: '100%' }}
      />
      <button onClick={run} disabled={busy}>
        {busy ? 'Running...' : 'Run probe'}
      </button>
      <table>
        <thead>
          <tr>
            <th>mode</th>
            <th>name</th>
            <th>status</th>
            <th>contentType</th>
            <th>len</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i}>
              <td>{r.mode}</td>
              <td>{r.name}</td>
              <td>
                {r.status}
                {r.error ? ` (${r.error})` : ''}
              </td>
              <td>{r.contentType}</td>
              <td>{r.body.length}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
