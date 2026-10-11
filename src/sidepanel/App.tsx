import { lazy, Suspense, useEffect, useState } from 'react';
import { isConfigured, loadSettings } from '../settings/store';
import type { Settings } from '../settings/types';
import ChatView from './ChatView';
import SettingsView from './SettingsView';
import SponsorView from './SponsorView';
import './styles.css';

const PROBE = import.meta.env.VITE_PROBE === '1';
const ProbeView = PROBE ? lazy(() => import('../dev/ProbeView')) : null;

type Tab = 'chat' | 'settings' | 'sponsor' | 'probe';

export default function App() {
  const [tab, setTab] = useState<Tab>('chat');
  const [settings, setSettings] = useState<Settings | null>(null);

  useEffect(() => {
    let live = true;
    void loadSettings().then((s) => {
      if (live) setSettings(s);
    });
    return () => {
      live = false;
    };
  }, []);

  const tabButton = (id: Tab, label: string) => (
    <button role="tab" aria-selected={tab === id} className="tab" onClick={() => setTab(id)}>
      {label}
    </button>
  );

  return (
    <div className="app">
      <nav role="tablist" className="tabs">
        {tabButton('chat', 'Chat')}
        {tabButton('settings', 'Settings')}
        {tabButton('sponsor', 'Sponsor')}
        {PROBE && tabButton('probe', 'Probe')}
      </nav>
      {/* Chat stays mounted while hidden so the conversation survives tab switches. */}
      <main className="main" hidden={tab !== 'chat'}>
        <ChatView configured={!!settings && isConfigured(settings)} onOpenSettings={() => setTab('settings')} />
      </main>
      {tab === 'settings' && (
        <main className="main scroll">
          {settings && <SettingsView initial={settings} onSaved={setSettings} />}
        </main>
      )}
      {tab === 'sponsor' && (
        <main className="main scroll">
          <SponsorView />
        </main>
      )}
      {PROBE && ProbeView && tab === 'probe' && (
        <main className="main scroll">
          <Suspense fallback={null}>
            <ProbeView />
          </Suspense>
        </main>
      )}
    </div>
  );
}
