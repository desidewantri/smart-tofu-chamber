import { render, screen, within } from '@testing-library/react';
import { describe, expect, test } from 'vitest';
import { I18nProvider } from '@/context/I18nContext';
import RslSnapshotTimeline from './RslSnapshotTimeline';
import { snapshots } from '@/test/fixtures/rsl';

function renderWithI18n(ui) {
  return render(<I18nProvider>{ui}</I18nProvider>);
}

describe('RslSnapshotTimeline', () => {
  test('renders persisted snapshots with provenance and immutable wording', () => {
    renderWithI18n(<RslSnapshotTimeline snapshots={snapshots} />);

    expect(screen.getByText(/riwayat snapshot rsl/i)).toBeInTheDocument();
    expect(screen.getByText(/tidak dihitung ulang/i)).toBeInTheDocument();
    expect(screen.getAllByText(/snapshot akhir/i).length).toBeGreaterThan(0);
    const table = screen.getByRole('table', { name: /snapshot rsl/i });
    expect(within(table).getByText(/uji snapshot 1/i)).toBeInTheDocument();
    expect(within(table).getByText(/uji snapshot 2/i)).toBeInTheDocument();
    expect(within(table).getByText('3–23 jam')).toBeInTheDocument();
    expect(within(table).getAllByText(/v2.3-frozen-2026-11-04/).length).toBeGreaterThan(0);
  });

  test('shows an explicit empty state when no snapshot exists', () => {
    renderWithI18n(<RslSnapshotTimeline snapshots={[]} />);

    expect(screen.getByText(/belum ada snapshot rsl/i)).toBeInTheDocument();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
  });

  test('keeps unavailable snapshots visible instead of substituting a live value', () => {
    renderWithI18n(<RslSnapshotTimeline snapshots={snapshots} />);

    const table = screen.getByRole('table', { name: /snapshot rsl/i });
    const unavailable = within(table).getByRole('row', { name: /uji snapshot 2/i });
    expect(within(unavailable).getByText(/tidak tersedia/i)).toBeInTheDocument();
    expect(within(unavailable).queryByText('3–23 jam')).not.toBeInTheDocument();
  });

  test('renders loading and error states', () => {
    const { rerender } = renderWithI18n(<RslSnapshotTimeline snapshots={[]} loading />);
    expect(screen.getByText(/memuat data/i)).toBeInTheDocument();

    rerender(
      <I18nProvider>
        <RslSnapshotTimeline snapshots={[]} error={new Error('snapshot endpoint down')} onRetry={() => {}} />
      </I18nProvider>
    );
    expect(screen.getByText(/snapshot endpoint down/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /coba lagi/i })).toBeInTheDocument();
  });
});
