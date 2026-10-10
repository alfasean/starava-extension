import { describe, expect, it } from 'vitest';
import { ensureHostPermission, originPattern } from '../../src/sidepanel/permissions';

describe('originPattern', () => {
  it('drops the port and path', () => {
    expect(originPattern('http://localhost:11434/v1')).toBe('http://localhost/*');
    expect(originPattern('http://127.0.0.1:1234/v1')).toBe('http://127.0.0.1/*');
  });

  it('keeps https hosts', () => {
    expect(originPattern('https://openrouter.ai/api/v1')).toBe('https://openrouter.ai/*');
  });
});

describe('ensureHostPermission', () => {
  it('requests the origin pattern and returns the grant', async () => {
    chrome.permissions.request = vi.fn(async () => true) as any;
    await expect(ensureHostPermission('http://localhost:11434/v1')).resolves.toBe(true);
    expect(chrome.permissions.request).toHaveBeenCalledWith({ origins: ['http://localhost/*'] });
  });

  it('returns false when denied', async () => {
    chrome.permissions.request = vi.fn(async () => false) as any;
    await expect(ensureHostPermission('https://openrouter.ai/api/v1')).resolves.toBe(false);
  });

  it('returns false when the request throws or the URL is invalid', async () => {
    chrome.permissions.request = vi.fn(async () => {
      throw new Error('not in optional permissions');
    }) as any;
    await expect(ensureHostPermission('http://192.168.1.5:8000/v1')).resolves.toBe(false);
    await expect(ensureHostPermission('not a url')).resolves.toBe(false);
  });
});
