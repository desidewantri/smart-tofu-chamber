import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, test, vi, beforeEach } from 'vitest';
import { I18nProvider } from '@/context/I18nContext';
import { ToastProvider } from '@/components/common/Toast';
import SampleStatusControl from './SampleStatusControl';

vi.mock('@/services/api', () => ({
  api: { updateSampleStatus: vi.fn() },
}));

const { api } = await import('@/services/api');

function renderWithProviders(ui) {
  return render(
    <I18nProvider>
      <ToastProvider>{ui}</ToastProvider>
    </I18nProvider>
  );
}

beforeEach(() => {
  api.updateSampleStatus.mockReset();
  api.updateSampleStatus.mockResolvedValue({});
});

describe('SampleStatusControl', () => {
  test('UNKNOWN shows Belum diverifikasi with a secondary record action', () => {
    renderWithProviders(
      <SampleStatusControl experimentId="exp-1" sessionId="ses-1" status="UNKNOWN" />
    );
    expect(screen.getByText(/belum diverifikasi/i)).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: /catat kondisi sampel/i })
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: /^belum rusak$/i })
    ).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^rusak$/i })).not.toBeInTheDocument();
  });

  test('recording Belum rusak is available after opening the record action', async () => {
    const onChanged = vi.fn();
    renderWithProviders(
      <SampleStatusControl experimentId="exp-1" sessionId="ses-1" status="UNKNOWN" onChanged={onChanged} />
    );
    fireEvent.click(screen.getByRole('button', { name: /catat kondisi sampel/i }));
    fireEvent.click(screen.getByRole('button', { name: /^belum rusak$/i }));
    await waitFor(() => {
      expect(api.updateSampleStatus).toHaveBeenCalledWith('exp-1', 'ses-1', {
        sampleStatus: 'NOT_SPOILED',
      });
    });
    expect(onChanged).toHaveBeenCalled();
  });

  test('recording Rusak still requires confirmation', async () => {
    renderWithProviders(
      <SampleStatusControl experimentId="exp-1" sessionId="ses-1" status="NOT_SPOILED" />
    );
    fireEvent.click(screen.getByRole('button', { name: /catat kondisi sampel/i }));
    fireEvent.click(screen.getByRole('button', { name: /^rusak$/i }));
    expect(screen.getByText(/tandai sampel sebagai rusak/i)).toBeInTheDocument();
    expect(api.updateSampleStatus).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: /ya, sampel rusak/i }));
    await waitFor(() => {
      expect(api.updateSampleStatus).toHaveBeenCalledWith('exp-1', 'ses-1', {
        sampleStatus: 'SPOILED',
      });
    });
  });

  test('SPOILED shows Dilaporkan rusak without an individual range claim', () => {
    renderWithProviders(
      <SampleStatusControl experimentId="exp-1" sessionId="ses-1" status="SPOILED" />
    );
    expect(screen.getByText(/dilaporkan rusak/i)).toBeInTheDocument();
  });
});
