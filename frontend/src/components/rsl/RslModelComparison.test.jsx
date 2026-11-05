import { render, screen, within } from '@testing-library/react';
import { describe, expect, test } from 'vitest';
import { I18nProvider } from '@/context/I18nContext';
import RslModelComparison from './RslModelComparison';
import { availableRsl } from '@/test/fixtures/rsl';

function renderWithI18n(ui) {
  return render(<I18nProvider>{ui}</I18nProvider>);
}

describe('RslModelComparison', () => {
  test('shows M1 as primary and M2/M3 as supporting with actual values', () => {
    renderWithI18n(<RslModelComparison rsl={availableRsl} />);

    const table = screen.getByRole('table', { name: /perbandingan model rsl/i });
    const m1 = within(table).getByRole('row', { name: /m1/i });
    const m2 = within(table).getByRole('row', { name: /m2/i });
    const m3 = within(table).getByRole('row', { name: /m3/i });

    expect(within(m1).getByText(/utama/i)).toBeInTheDocument();
    expect(within(m1).getByText('3–23 jam')).toBeInTheDocument();
    expect(within(m1).getByText(/tersedia/i)).toBeInTheDocument();

    expect(within(m2).getByText(/pendukung/i)).toBeInTheDocument();
    expect(within(m2).getByText(/2 komponen support/i)).toBeInTheDocument();
    expect(within(m2).getByText(/0,000–0,004 j/)).toBeInTheDocument();

    expect(within(m3).getByText(/pendukung/i)).toBeInTheDocument();
    expect(within(m3).getByText(/r10 1,51 j/)).toBeInTheDocument();
    expect(within(m3).getByText(/r90 9,99 j/)).toBeInTheDocument();
  });

  test('marks missing M2/M3 as unavailable and never copies M1 values into them', () => {
    const partial = {
      ...availableRsl,
      supporting: { M2: null, M3: { ...availableRsl.supporting.M3, available: false, status: 'NOT_AVAILABLE' } },
    };
    renderWithI18n(<RslModelComparison rsl={partial} />);

    const table = screen.getByRole('table', { name: /perbandingan model rsl/i });
    const m2 = within(table).getByRole('row', { name: /m2/i });
    const m3 = within(table).getByRole('row', { name: /m3/i });

    expect(within(m2).getByText(/tidak tersedia/i)).toBeInTheDocument();
    expect(within(m3).getByText(/tidak tersedia/i)).toBeInTheDocument();
    expect(within(m2).queryByText('3–23 jam')).not.toBeInTheDocument();
    expect(within(m3).queryByText('3–23 jam')).not.toBeInTheDocument();
  });

  test('compact mode keeps the same primary/supporting semantics', () => {
    renderWithI18n(<RslModelComparison rsl={availableRsl} compact />);

    expect(screen.getByText(/m1 · utama/i)).toBeInTheDocument();
    expect(screen.getByText('3–23 jam')).toBeInTheDocument();
    expect(screen.getByText(/m2 · pendukung/i)).toBeInTheDocument();
    expect(screen.getByText(/m3 · pendukung/i)).toBeInTheDocument();
  });
});
