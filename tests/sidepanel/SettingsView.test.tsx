import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import SettingsView from '../../src/sidepanel/SettingsView';
import type { Settings } from '../../src/settings/types';

const initial: Settings = { provider: 'openai', apiKey: '', model: '', athlete: { maxHr: 190, restHr: 60 } };

afterEach(() => vi.unstubAllGlobals());

describe('SettingsView New API', () => {
  it('shows Gateway URL and Load models, and loads model options', async () => {
    const f = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ data: [{ id: 'm-b' }, { id: 'm-a' }] }), { status: 200 }),
    );
    vi.stubGlobal('fetch', f);
    render(<SettingsView initial={initial} onSaved={() => {}} />);

    expect(screen.queryByText('Load models')).toBeNull();
    fireEvent.change(screen.getByLabelText('Provider'), { target: { value: 'new-api' } });
    const url = screen.getByLabelText('Gateway URL');
    const load = screen.getByRole('button', { name: 'Load models' }) as HTMLButtonElement;
    expect(load.disabled).toBe(true);

    fireEvent.change(url, { target: { value: 'https://gw.example' } });
    fireEvent.change(screen.getByLabelText('API key'), { target: { value: 'sk-1' } });
    expect(load.disabled).toBe(false);
    fireEvent.click(load);

    await waitFor(() => expect(document.querySelectorAll('datalist option').length).toBe(2));
    expect(f.mock.calls[0][0]).toBe('https://gw.example/v1/models');
    expect(chrome.permissions.request).toHaveBeenCalled();
  });

  it('shows an inline error when loading fails', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('no', { status: 401 })));
    render(<SettingsView initial={initial} onSaved={() => {}} />);
    fireEvent.change(screen.getByLabelText('Provider'), { target: { value: 'new-api' } });
    fireEvent.change(screen.getByLabelText('Gateway URL'), { target: { value: 'https://gw.example' } });
    fireEvent.change(screen.getByLabelText('API key'), { target: { value: 'k' } });
    fireEvent.click(screen.getByRole('button', { name: 'Load models' }));
    expect(await screen.findByText('Your New API gateway rejected the API key.')).toBeTruthy();
  });
});
