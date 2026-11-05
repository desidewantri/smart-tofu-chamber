import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import { I18nProvider } from '@/context/I18nContext';
import RslModelTab from './RslModelTab';
import { availableRsl, latestReading, snapshots } from '@/test/fixtures/rsl';

vi.mock('@/services/api', () => ({
  api: {
    getChamber: vi.fn(),
    getRslSnapshots: vi.fn(),
  },
}));

const { api } = await import('@/services/api');

function renderWithI18n(ui) {
  return render(<I18nProvider>{ui}</I18nProvider>);
}

const chamber = {
  id: 'chamber-1',
  chamberId: 1,
  name: 'Chamber 1',
  connected: true,
  enabled: true,
  lastSeenAt: '2026-11-05T11:56:00.000Z',
};

const activeSession = {
  id: 'ses-test-1',
  experimentId: 'exp-test-1',
  chamberId: 1,
  sampleStatus: 'NOT_SPOILED',
  storageCondition: 'DRY',
  readingCount: 120,
  status: 'aktif',
};

beforeEach(() => {
  api.getChamber.mockReset();
  api.getRslSnapshots.mockReset();
});

describe('RslModelTab', () => {
  test('loads the selected chamber and renders live RSL plus historical snapshots', async () => {
    api.getChamber.mockResolvedValue({
      chamber,
      experiment: { id: 'exp-test-1', startedAt: '2026-11-04T16:00:00.000Z', storageCondition: 'DRY' },
      activeSession,
      latestReading,
      rsl: availableRsl,
      recentSessions: [],
    });
    api.getRslSnapshots.mockResolvedValue({ chamberId: 1, limit: 20, items: snapshots });

    renderWithI18n(<RslModelTab chamberId="1" />);

    expect(await screen.findByText(/m1 · rentang historis tersisa/i)).toBeInTheDocument();
    expect(await screen.findByRole('table', { name: /perbandingan model rsl/i })).toBeInTheDocument();
    expect(await screen.findByText(/riwayat snapshot rsl/i)).toBeInTheDocument();
    expect(api.getChamber).toHaveBeenCalledWith('1');
    expect(api.getRslSnapshots).toHaveBeenCalledWith('1');
  });

  test('shows an explicit no-active-experiment state without stale live data', async () => {
    api.getChamber.mockResolvedValue({
      chamber,
      experiment: null,
      activeSession: null,
      latestReading: null,
      rsl: null,
      recentSessions: [],
    });
    api.getRslSnapshots.mockResolvedValue({ chamberId: 1, limit: 20, items: [] });

    renderWithI18n(<RslModelTab chamberId="1" />);

    expect(await screen.findByText(/tidak ada eksperimen aktif/i)).toBeInTheDocument();
    expect(await screen.findByText(/belum ada snapshot rsl/i)).toBeInTheDocument();
    expect(screen.queryByText(/m1 · rentang historis tersisa/i)).not.toBeInTheDocument();
  });

  test('shows an API error state without crashing', async () => {
    api.getChamber.mockRejectedValue(new Error('backend unavailable'));
    api.getRslSnapshots.mockRejectedValue(new Error('backend unavailable'));

    renderWithI18n(<RslModelTab chamberId="1" />);

    expect(await screen.findByText(/data tidak dapat dimuat/i)).toBeInTheDocument();
    expect(screen.getByText(/backend unavailable/i)).toBeInTheDocument();
  });
});

  test('chamber switching never shows the previous chamber data', async () => {
    api.getChamber.mockImplementation((id) =>
      Promise.resolve({
        chamber: { ...chamber, chamberId: Number(id), name: `Chamber ${id}` },
        experiment: { id: 'exp-test-1', startedAt: '2026-11-04T16:00:00.000Z', storageCondition: 'DRY' },
        activeSession: { ...activeSession, chamberId: Number(id) },
        latestReading: { ...latestReading, chamberId: Number(id) },
        rsl: { ...availableRsl, chamberId: Number(id) },
        recentSessions: [],
      })
    );
    api.getRslSnapshots.mockImplementation((id) =>
      Promise.resolve({ chamberId: Number(id), limit: 20, items: Number(id) === 1 ? snapshots : [] })
    );

    const { rerender } = renderWithI18n(<RslModelTab chamberId="1" />);
    expect(await screen.findByText('Chamber 1')).toBeInTheDocument();

    rerender(
      <I18nProvider>
        <RslModelTab chamberId="2" />
      </I18nProvider>
    );

    // The guard must drop the old chamber immediately, not after the request.
    expect(screen.queryByText('Chamber 1')).not.toBeInTheDocument();
    expect(await screen.findByText('Chamber 2')).toBeInTheDocument();
    expect(screen.queryByText('Chamber 1')).not.toBeInTheDocument();
  });
