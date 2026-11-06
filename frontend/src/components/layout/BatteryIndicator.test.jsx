import { render, screen } from '@testing-library/react';
import { describe, expect, test, vi, beforeEach } from 'vitest';
import { I18nProvider } from '@/context/I18nContext';
import BatteryIndicator from './BatteryIndicator';

vi.mock('@/services/api', () => ({
  api: { getBattery: vi.fn() },
}));

const { api } = await import('@/services/api');

function renderWithI18n(ui) {
  return render(<I18nProvider>{ui}</I18nProvider>);
}

beforeEach(() => {
  api.getBattery.mockReset();
});

describe('BatteryIndicator', () => {
  test('renders live percent with chamber provenance', async () => {
    api.getBattery.mockResolvedValue({
      percent: 78,
      level: 'baik',
      at: new Date(Date.now() - 60000).toISOString(),
      stale: false,
      chamberId: 2,
    });
    renderWithI18n(<BatteryIndicator />);
    expect(await screen.findByText('78%')).toBeInTheDocument();
    expect(screen.getByRole('status').getAttribute('aria-label')).toMatch(/78%/);
  });

  test('shows a visible stale warning instead of a fresh-looking value', async () => {
    api.getBattery.mockResolvedValue({
      percent: 78,
      level: 'baik',
      at: new Date(Date.now() - 3600000).toISOString(),
      stale: true,
      chamberId: 1,
    });
    renderWithI18n(<BatteryIndicator />);
    expect(await screen.findByText('78%')).toBeInTheDocument();
    expect(screen.getByText(/data lama/i)).toBeInTheDocument();
  });

  test('shows an honest empty state instead of hiding silently', async () => {
    api.getBattery.mockResolvedValue({ percent: null, level: null, at: null, stale: false, chamberId: null });
    renderWithI18n(<BatteryIndicator />);
    expect(
      await screen.findByText(/data baterai tidak tersedia/i)
    ).toBeInTheDocument();
  });
});
