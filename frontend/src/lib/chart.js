/**
 * Judul sumbu grafik: selalu menyebut variabel dan satuannya, mis. "Sisa umur simpan (jam)".
 * Dipakai oleh semua grafik agar sumbu X dan Y konsisten.
 */
const base = { fontSize: 11, fill: '#475569' };

export const xAxisLabel = (value) => ({ ...base, value, position: 'insideBottom', offset: -8 });

export const yAxisLabel = (value, side = 'left') => ({
  ...base,
  value,
  angle: side === 'left' ? -90 : 90,
  position: side === 'left' ? 'insideLeft' : 'insideRight',
  offset: 4,
  style: { textAnchor: 'middle' },
});

export const TICK = { fontSize: 11, fill: '#64748b' };
export const TOOLTIP_STYLE = { borderRadius: 12, border: '1px solid #e2e8f0', fontSize: 12 };
