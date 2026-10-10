import { lazy, Suspense, useState } from 'react';

const PROBE = import.meta.env.VITE_PROBE === '1';
const ProbeView = PROBE ? lazy(() => import('../dev/ProbeView')) : null;

type Tab = 'chat' | 'settings' | 'probe';

export default function App() {
  const [tab, setTab] = useState<Tab>('chat');
  return (
    <div>
      <nav role="tablist">
        <button role="tab" aria-selected={tab === 'chat'} onClick={() => setTab('chat')}>
          Chat
        </button>
        <button role="tab" aria-selected={tab === 'settings'} onClick={() => setTab('settings')}>
          Settings
        </button>
        {PROBE && (
          <button role="tab" aria-selected={tab === 'probe'} onClick={() => setTab('probe')}>
            Probe
          </button>
        )}
      </nav>
      <main>
        {tab === 'probe' && ProbeView ? (
          <Suspense fallback={null}>
            <ProbeView />
          </Suspense>
        ) : tab === 'chat' ? (
          <p>Chat placeholder</p>
        ) : (
          <p>Settings placeholder</p>
        )}
      </main>
    </div>
  );
}
