import manifest from '../manifest.config';
test('manifest declares side panel and required permissions', () => {
  const m = manifest as any;
  expect(m.manifest_version).toBe(3);
  expect(m.side_panel.default_path).toBe('src/sidepanel/index.html');
  expect(m.permissions).toEqual(['sidePanel', 'storage', 'tabs']);
  expect(m.host_permissions).toEqual([
    'https://www.strava.com/*', 'https://api.openai.com/*',
    'https://api.anthropic.com/*', 'https://generativelanguage.googleapis.com/*',
  ]);
  expect(m.optional_host_permissions).toEqual(['https://*/*', 'http://localhost/*', 'http://127.0.0.1/*']);
});
