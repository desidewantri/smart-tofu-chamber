import { render, screen } from '@testing-library/react';
import { describe, expect, test } from 'vitest';
import { I18nProvider } from '@/context/I18nContext';
import RslDataQuality from './RslDataQuality';
import { availableRsl, latestReading } from '@/test/fixtures/rsl';

function renderWithI18n(ui) {
  return render(<I18nProvider>{ui}</I18nProvider>);
}

describe('RslDataQuality', () => {
  test('separates measurement time, receipt time, and model calculation time', () => {
    renderWithI18n(
      <RslDataQuality
        rsl={availableRsl}
        session={{ sampleStatus: 'NOT_SPOILED', storageCondition: 'DRY', readingCount: 120 }}
        latestReading={latestReading}
        chamber={{ connected: true }}
      />
    );

    expect(screen.getByText(/waktu pengukuran/i)).toBeInTheDocument();
    expect(screen.getByText(/waktu diterima server/i)).toBeInTheDocument();
    expect(screen.getByText(/dihitung/i)).toBeInTheDocument();
    expect(screen.getByText(/dari sample_id/i)).toBeInTheDocument();
    expect(screen.getByText(/google sheets/i)).toBeInTheDocument();
    expect(screen.getByText(/belum rusak/i)).toBeInTheDocument();
  });

  test('shows a missing-reading state without fabricating timestamps', () => {
    renderWithI18n(
      <RslDataQuality
        rsl={availableRsl}
        session={{ sampleStatus: 'NOT_SPOILED', storageCondition: 'DRY', readingCount: 0 }}
        latestReading={null}
        chamber={{ connected: false }}
      />
    );

    expect(screen.getByText(/belum ada pembacaan sensor/i)).toBeInTheDocument();
    expect(screen.queryByText(/waktu pengukuran/i)).not.toBeInTheDocument();
  });

  test('warns when timestamp quality is missing or invalid', () => {
    renderWithI18n(
      <RslDataQuality
        rsl={availableRsl}
        session={{ sampleStatus: 'NOT_SPOILED', storageCondition: 'DRY', readingCount: 1 }}
        latestReading={{ ...latestReading, timestampQuality: 'MISSING', sampledAt: null, timestampSource: 'received_at' }}
        chamber={{ connected: true }}
      />
    );

    expect(screen.getByText(/waktu pengukuran tidak tersedia/i)).toBeInTheDocument();
  });
});
