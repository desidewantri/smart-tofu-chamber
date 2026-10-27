'use client';

import {
  CartesianGrid,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { useI18n } from '@/context/I18nContext';
import { TICK, TOOLTIP_STYLE, xAxisLabel, yAxisLabel } from '@/lib/chart';

/**
 * Grafik perkiraan sisa umur simpan.
 * Sumbu X: waktu sejak tahu masuk (jam). Sumbu Y: sisa umur simpan (jam).
 * Garis putus-putus: Batas Segar (hijau) dan Batas Rawan (kuning).
 */
export default function ShelfLifeChart({
  data,
  zones = { segarHours: 24, rawanHours: 8 },
  xKey = 'elapsedHours',
  yKey = 'shelfLife',
  color = '#16a34a',
  height = 230,
  heightClass,
}) {
  const { t } = useI18n();
  const maxVal = Math.max(0, ...(data || []).map((d) => d[yKey] || 0));
  const yMax = Math.max(Math.ceil((zones.segarHours * 1.25) / 10) * 10, Math.ceil(maxVal / 10) * 10);

  return (
    <div style={heightClass ? undefined : { height }} className={heightClass ? `w-full ${heightClass}` : 'w-full'}>
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 8, right: 16, bottom: 22, left: 4 }}>
          <CartesianGrid stroke="#e2e8f0" strokeDasharray="3 3" vertical={false} />
          <XAxis
            dataKey={xKey}
            type="number"
            domain={[0, 'dataMax']}
            tick={TICK}
            tickFormatter={(v) => `${Math.round(v)}`}
            axisLine={false}
            tickLine={false}
            label={xAxisLabel(t('Waktu sejak tahu masuk (jam)'))}
          />
          <YAxis
            domain={[0, yMax]}
            ticks={[0, zones.rawanHours, zones.segarHours, yMax]}
            tick={TICK}
            axisLine={false}
            tickLine={false}
            width={56}
            label={yAxisLabel(t('Sisa umur (jam)'))}
          />
          <Tooltip
            formatter={(v) => [`${Number(v).toFixed(1)} ${t('jam')}`, t('Sisa umur simpan')]}
            labelFormatter={(v) => t('Jam ke-{n}', { n: Number(v).toFixed(1) })}
            contentStyle={TOOLTIP_STYLE}
          />
          <ReferenceLine
            y={zones.segarHours}
            stroke="#16a34a"
            strokeDasharray="5 4"
            label={{ value: t('Batas Segar'), position: 'insideTopRight', fontSize: 10, fill: '#15803d' }}
          />
          <ReferenceLine
            y={zones.rawanHours}
            stroke="#d97706"
            strokeDasharray="5 4"
            label={{ value: t('Batas Rawan'), position: 'insideTopRight', fontSize: 10, fill: '#b45309' }}
          />
          <Line type="monotone" dataKey={yKey} stroke={color} strokeWidth={2.5} dot={false} isAnimationActive={false} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
