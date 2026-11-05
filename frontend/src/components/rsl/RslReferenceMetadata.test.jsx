import { render, screen } from '@testing-library/react';
import { describe, expect, test } from 'vitest';
import { I18nProvider } from '@/context/I18nContext';
import RslReferenceMetadata from './RslReferenceMetadata';
import { availableRsl } from '@/test/fixtures/rsl';

function renderWithI18n(ui) {
  return render(<I18nProvider>{ui}</I18nProvider>);
}

describe('RslReferenceMetadata', () => {
  test('shows the actual frozen reference metadata and DRY scope', () => {
    renderWithI18n(<RslReferenceMetadata rsl={availableRsl} />);

    expect(screen.getByText('v2.3-frozen-2026-11-04')).toBeInTheDocument();
    expect(screen.getByText('1.0.0')).toBeInTheDocument();
    expect(screen.getByText(/3 sesi kering/i)).toBeInTheDocument();
    expect(screen.getAllByText('DRY').length).toBeGreaterThan(0);
    expect(screen.getByText(/hanya DRY/i)).toBeInTheDocument();
    expect(screen.getByText(/bukan jaminan individual/i)).toBeInTheDocument();
    expect(screen.getByText(/tidak ditetapkan/i)).toBeInTheDocument();
  });

  test('keeps caveats inspectable without inventing metadata', () => {
    renderWithI18n(<RslReferenceMetadata rsl={availableRsl} />);

    expect(screen.getByText(/catatan metodologi/i)).toBeInTheDocument();
    expect(screen.getAllByText(/post hoc eksploratif/i).length).toBeGreaterThan(0);
    expect(screen.getByText(/tiga endpoint kering/i)).toBeInTheDocument();
  });

  test('renders an explicit unavailable state when metadata is absent', () => {
    renderWithI18n(<RslReferenceMetadata rsl={{ ...availableRsl, metadata: null }} />);

    expect(screen.getByText(/metadata referensi tidak tersedia/i)).toBeInTheDocument();
    expect(screen.queryByText('v2.3-frozen-2026-11-04')).not.toBeInTheDocument();
  });
});
