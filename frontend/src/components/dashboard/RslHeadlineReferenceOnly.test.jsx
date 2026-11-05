import { render, screen } from '@testing-library/react';
import { describe, expect, test } from 'vitest';
import { I18nProvider } from '@/context/I18nContext';
import RslHeadline from './RslHeadline';
import { availableRsl } from '@/test/fixtures/rsl';

function renderWithI18n(ui) {
  return render(<I18nProvider>{ui}</I18nProvider>);
}

const referenceOnly = {
  ...availableRsl,
  status: 'REFERENCE_ONLY',
  reason: 'SAMPLE_STATUS_UNKNOWN',
  message: 'Rentang referensi historis untuk sampel yang belum diverifikasi; bukan prediksi individual.',
  sampleStatus: 'UNKNOWN',
  referenceOnly: true,
};

describe('RslHeadline reference-only', () => {
  test('shows the reference range labeled as reference, not an individual prediction', () => {
    renderWithI18n(<RslHeadline rsl={referenceOnly} />);
    expect(screen.getByText('3–23')).toBeInTheDocument();
    expect(screen.getAllByText(/referensi historis/i).length).toBeGreaterThan(0);
    expect(screen.getByText(/belum diverifikasi/i)).toBeInTheDocument();
    expect(screen.queryByText(/perkiraan sisa umur tahu/i)).not.toBeInTheDocument();
  });

  test('keeps the verified AVAILABLE headline unchanged', () => {
    renderWithI18n(<RslHeadline rsl={availableRsl} />);
    expect(screen.getByText('3–23')).toBeInTheDocument();
    expect(screen.getByText(/rentang historis tersisa/i)).toBeInTheDocument();
  });
});
