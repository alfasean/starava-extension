import { useState } from 'react';

type Tab = 'chat' | 'settings';

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
      </nav>
      <main>{tab === 'chat' ? <p>Chat placeholder</p> : <p>Settings placeholder</p>}</main>
    </div>
  );
}
