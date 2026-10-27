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

const fmtH = (v) => `${Number(v).toFixed(1)} j`;

/**
 * Grafik estimasi sisa shelf-life (jam) terhadap waktu sejak tahu masuk (jam).
 * Garis putus-putus: Batas Segar (hijau) & Batas Rawan (kuning).
 */
export default function ShelfLifeChart({
  data,
  zones = { segarHours: 24, rawanHours: 8 },
  xKey = 'elapsedHours',
  yKey = 'shelfLife',
  color = '#16a34a',
  height = 190,
}) {
  const maxVal = Math.max(0, ...(data || []).map((d) => d[yKey] || 0));
  const yMax = Math.max(Math.ceil((zones.segarHours * 1.25) / 10) * 10, Math.ceil(maxVal / 10) * 10);

  return (
    <div style={{ height }} className="w-full">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 8, right: 12, bottom: 14, left: -12 }}>
          <CartesianGrid stroke="#e2e8f0" strokeDasharray="3 3" vertical={false} />
          <XAxis
            dataKey={xKey}
            type="number"
            domain={[0, 'dataMax']}
            tick={{ fontSize: 11, fill: '#64748b' }}
            tickFormatter={(v) => `${Math.round(v)}`}
            axisLine={false}
            tickLine={false}
            label={{ value: 'Jam sejak masuk', position: 'insideBottomRight', offset: -14, fontSize: 10, fill: '#94a3b8' }}
          />
          <YAxis
            domain={[0, yMax]}
            ticks={[0, zones.rawanHours, zones.segarHours, yMax]}
            tick={{ fontSize: 11, fill: '#64748b' }}
            axisLine={false}
            tickLine={false}
            width={44}
          />
          <Tooltip
            formatter={(v) => [fmtH(v), 'Sisa shelf-life']}
            labelFormatter={(v) => `Jam ke-${Number(v).toFixed(1)}`}
            contentStyle={{ borderRadius: 12, border: '1px solid #e2e8f0', fontSize: 12 }}
          />
          <ReferenceLine
            y={zones.segarHours}
            stroke="#16a34a"
            strokeDasharray="5 4"
            label={{ value: 'Batas Segar', position: 'insideTopRight', fontSize: 10, fill: '#15803d' }}
          />
          <ReferenceLine
            y={zones.rawanHours}
            stroke="#d97706"
            strokeDasharray="5 4"
            label={{ value: 'Batas Rawan', position: 'insideTopRight', fontSize: 10, fill: '#b45309' }}
          />
          <Line type="monotone" dataKey={yKey} stroke={color} strokeWidth={2.5} dot={false} isAnimationActive={false} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
