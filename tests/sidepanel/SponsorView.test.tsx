import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import SponsorView from '../../src/sidepanel/SponsorView';

const SPONSOR_URL = 'https://github.com/sponsors/alfasean';

afterEach(() => vi.unstubAllGlobals());

describe('SponsorView', () => {
  it('opens the GitHub Sponsors page in a new tab', () => {
    render(<SponsorView />);
    fireEvent.click(screen.getByRole('button', { name: 'Open GitHub Sponsors' }));
    expect(chrome.tabs.create).toHaveBeenCalledWith({ url: SPONSOR_URL });
  });

  it('copies the sponsor link to the clipboard', async () => {
    const writeText = vi.fn(async () => {});
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    render(<SponsorView />);
    fireEvent.click(screen.getByRole('button', { name: 'Copy link' }));
    expect(await screen.findByText('Copied!')).toBeTruthy();
    expect(writeText).toHaveBeenCalledWith(SPONSOR_URL);
  });
});
