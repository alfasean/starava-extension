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
test('manifest declares icons for all Chrome sizes', () => {
  const m = manifest as any;
  const expected = {
    16: 'icons/icon16.png',
    32: 'icons/icon32.png',
    48: 'icons/icon48.png',
    128: 'icons/icon128.png',
  };
  expect(m.icons).toEqual(expected);
  expect(m.action.default_icon).toEqual(expected);
});
