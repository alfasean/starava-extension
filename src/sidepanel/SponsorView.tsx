import { useState } from 'react';

const SPONSOR_URL = 'https://github.com/sponsors/alfasean';

export default function SponsorView() {
  const [copied, setCopied] = useState(false);

  const onOpen = () => {
    void chrome.tabs.create({ url: SPONSOR_URL });
  };

  const onCopy = async () => {
    try {
      await navigator.clipboard.writeText(SPONSOR_URL);
      setCopied(true);
    } catch {
      // Clipboard can be unavailable; the link is shown below as text anyway.
    }
  };

  return (
    <div className="sponsor">
      <h2>Free, and it stays that way</h2>
      <p>
        This extension has no backend, no accounts and no paid features. All analysis runs in your browser
        with your own AI provider key.
      </p>
      <p>If the coach helped you train smarter, a one-time tip is appreciated — but never expected.</p>
      <div className="actions">
        <button type="button" className="primary" onClick={onOpen}>
          Open GitHub Sponsors
        </button>
        <button type="button" className="ghost" onClick={onCopy}>
          {copied ? 'Copied!' : 'Copy link'}
        </button>
      </div>
      <p className="muted small">{SPONSOR_URL}</p>

      <h2>Other ways to help</h2>
      <ul>
        <li>Star and share the repo with your running club</li>
        <li>File an issue when something breaks — Strava changes can hit this tool</li>
        <li>Pull requests are very welcome</li>
      </ul>
    </div>
  );
}
