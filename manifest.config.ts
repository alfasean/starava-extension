import { defineManifest } from '@crxjs/vite-plugin';

export default defineManifest({
  manifest_version: 3,
  name: 'Strava Run Analyzer',
  version: '0.1.0',
  description: 'Chat with an LLM about your Strava runs.',
  permissions: ['sidePanel', 'storage', 'tabs'],
  host_permissions: [
    'https://www.strava.com/*',
    'https://api.openai.com/*',
    'https://api.anthropic.com/*',
    'https://generativelanguage.googleapis.com/*',
  ],
  optional_host_permissions: ['https://*/*', 'http://localhost/*', 'http://127.0.0.1/*'],
  background: { service_worker: 'src/background.ts', type: 'module' },
  side_panel: { default_path: 'src/sidepanel/index.html' },
  action: { default_title: 'Strava Run Analyzer' },
  ...(process.env.VITE_PROBE === '1'
    ? { content_scripts: [{ matches: ['https://www.strava.com/*'], js: ['src/dev/probeContent.ts'] }] }
    : {}),
});
