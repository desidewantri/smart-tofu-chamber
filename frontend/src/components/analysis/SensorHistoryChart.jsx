'use client';

import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { useI18n } from '@/context/I18nContext';
import { TICK, TOOLTIP_STYLE, xAxisLabel, yAxisLabel } from '@/lib/chart';

/**
 * Grafik satu parameter sensor sepanjang sesi.
 * Sumbu X: waktu sejak tahu masuk (jam). Sumbu Y: nilai sensor dengan satuannya (yLabel).
 * scale: pembagi nilai untuk sumbu (mis. 1000 untuk TVOC dalam "ribu ppb").
 * minPad: rentang minimum di atas & bawah data agar fluktuasi kecil tidak terlihat dramatis (satuan sumbu).
 * fromZero: sumbu Y selalu mulai dari 0 (dipakai untuk TVOC).
 */
export default function SensorHistoryChart({
  data,
  dataKey,
  color,
  yLabel,
  unit,
  decimals = 1,
  scale = 1,
  minPad = 1,
  fromZero = false,
  height = 190,
}) {
  const { t } = useI18n();
  const rows = (data || [])
    .filter((d) => Number.isFinite(d[dataKey]))
    .map((d) => ({ x: d.elapsedHours, y: d[dataKey] / scale, raw: d[dataKey] }));
  const id = `grad-${dataKey}`;
  const ys = rows.map((r) => r.y);
  const lo = ys.length ? Math.min(...ys) : 0;
  const hi = ys.length ? Math.max(...ys) : 1;
  const pad = Math.max((hi - lo) * 0.2, minPad);
  const domain = [fromZero ? 0 : Math.floor(lo - pad), Math.ceil(hi + pad)];

  return (
    <div style={{ height }} className="w-full">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={rows} margin={{ top: 8, right: 8, bottom: 22, left: 4 }}>
          <defs>
            <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={color} stopOpacity={0.22} />
              <stop offset="100%" stopColor={color} stopOpacity={0.02} />
            </linearGradient>
          </defs>
          <CartesianGrid stroke="#e2e8f0" strokeDasharray="3 3" vertical={false} />
          <XAxis
            dataKey="x"
            type="number"
            domain={[0, 'dataMax']}
            tick={TICK}
            tickFormatter={(v) => `${Math.round(v)}`}
            axisLine={{ stroke: '#cbd5e1' }}
            tickLine={false}
            label={xAxisLabel(t('Waktu sejak tahu masuk (jam)'))}
          />
          <YAxis
            domain={domain}
            allowDecimals={false}
            tick={TICK}
            tickFormatter={(v) => Number(v).toLocaleString(undefined, { maximumFractionDigits: 1 })}
            axisLine={{ stroke: '#cbd5e1' }}
            tickLine={false}
            width={52}
            label={yAxisLabel(t(yLabel))}
          />
          <Tooltip
            formatter={(_v, _n, item) => [
              `${Number(item.payload.raw).toLocaleString(undefined, { maximumFractionDigits: decimals })} ${unit}`,
              t(yLabel),
            ]}
            labelFormatter={(v) => t('Jam ke-{n}', { n: Number(v).toFixed(1) })}
            contentStyle={TOOLTIP_STYLE}
          />
          <Area
            type="monotone"
            dataKey="y"
            stroke={color}
            strokeWidth={2.2}
            fill={`url(#${id})`}
            dot={false}
            activeDot={{ r: 4 }}
            isAnimationActive={false}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
