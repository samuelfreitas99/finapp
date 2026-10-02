import { useEffect, useId, useRef, useState, type ReactNode } from 'react';

export interface BarSeries<T> {
  key: string;
  label: string;
  /** Cor da série (token CSS). */
  color: string | ((row: T) => string);
  value: (row: T) => number;
}

interface Props<T> {
  rows: T[];
  rowKey: (row: T) => string;
  /** Rótulo curto do eixo x (ex.: "out"). */
  rowLabel: (row: T) => string;
  series: BarSeries<T>[];
  formatValue: (v: number) => string;
  /** Texto do tooltip/leitor de tela para a linha inteira. */
  describe: (row: T) => ReactNode;
  selected?: string | null;
  onSelect?: (key: string) => void;
  height?: number;
  /** Resumo para leitores de tela (a tabela fica ao lado). */
  summary: string;
}

const PAD_TOP = 12;
const PAD_BOTTOM = 26;
const AXIS_W = 56;

function niceStep(range: number): number {
  const raw = range / 3;
  const pow = 10 ** Math.floor(Math.log10(raw || 1));
  const n = raw / pow;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * pow;
}

/** Barras verticais finas com base no zero (valores negativos descem). @see skill dataviz */
export function BarChart<T>({
  rows,
  rowKey,
  rowLabel,
  series,
  formatValue,
  describe,
  selected,
  onSelect,
  height = 200,
  summary,
}: Props<T>) {
  const wrap = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(320);
  const [active, setActive] = useState<number | null>(null);
  const titleId = useId();

  useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => {
      if (entry) setWidth(Math.max(240, Math.floor(entry.contentRect.width)));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const values = rows.flatMap((r) => series.map((s) => s.value(r)));
  const min = Math.min(0, ...values);
  const max = Math.max(0, ...values);
  const step = niceStep(max - min || 1);
  const top = Math.ceil(max / step) * step || step;
  const bottom = Math.floor(min / step) * step;
  const plotH = height - PAD_TOP - PAD_BOTTOM;
  const y = (v: number) => PAD_TOP + ((top - v) / (top - bottom || 1)) * plotH;
  const ticks: number[] = [];
  for (let v = bottom; v <= top + step / 2; v += step) ticks.push(v);

  const slot = (width - AXIS_W) / Math.max(1, rows.length);
  const gap = 2;
  const barW = Math.max(3, Math.min(18, (slot * 0.62 - gap * (series.length - 1)) / series.length));
  const groupW = barW * series.length + gap * (series.length - 1);
  const everyOther = slot < 30;

  const bar = (x: number, v: number, w: number, color: string, key: string) => {
    const y0 = y(0);
    const y1 = y(v);
    const h = Math.abs(y1 - y0);
    if (h < 0.5) return <rect key={key} x={x} y={y0 - 0.5} width={w} height={1} fill={color} />;
    const r = Math.min(4, w / 2, h);
    // Cantos arredondados só na ponta do dado; a base fica reta no zero.
    const d =
      v >= 0
        ? `M${x},${y0} V${y1 + r} Q${x},${y1} ${x + r},${y1} H${x + w - r} Q${x + w},${y1} ${x + w},${y1 + r} V${y0} Z`
        : `M${x},${y0} V${y1 - r} Q${x},${y1} ${x + r},${y1} H${x + w - r} Q${x + w},${y1} ${x + w},${y1 - r} V${y0} Z`;
    return <path key={key} d={d} fill={color} />;
  };

  const activeRow = active !== null ? rows[active] : undefined;
  const tooltipLeft =
    active !== null
      ? Math.min(width - 180, Math.max(0, AXIS_W + slot * active + slot / 2 - 90))
      : 0;

  return (
    <div className="chart" ref={wrap}>
      <svg
        width={width}
        height={height}
        role="img"
        aria-labelledby={titleId}
        onMouseLeave={() => setActive(null)}
      >
        <title id={titleId}>{summary}</title>
        {ticks.map((t) => (
          <g key={t}>
            <line
              x1={AXIS_W}
              x2={width}
              y1={y(t)}
              y2={y(t)}
              stroke="var(--chart-grid)"
              strokeWidth={t === 0 ? 1.5 : 1}
              strokeDasharray={t === 0 ? undefined : '2 4'}
            />
            <text x={AXIS_W - 6} y={y(t) + 4} textAnchor="end" className="chart__tick">
              {formatValue(t)}
            </text>
          </g>
        ))}
        {rows.map((row, i) => {
          const key = rowKey(row);
          const x0 = AXIS_W + slot * i + (slot - groupW) / 2;
          const isSel = selected === key;
          return (
            <g key={key}>
              {isSel && (
                <rect
                  x={AXIS_W + slot * i + 1}
                  y={PAD_TOP - 6}
                  width={slot - 2}
                  height={plotH + 12}
                  rx={6}
                  fill="var(--primary-soft)"
                />
              )}
              {series.map((s, k) =>
                bar(
                  x0 + k * (barW + gap),
                  s.value(row),
                  barW,
                  typeof s.color === 'function' ? s.color(row) : s.color,
                  `${key}-${s.key}`,
                ),
              )}
              {(!everyOther || i % 2 === 0) && (
                <text
                  x={AXIS_W + slot * i + slot / 2}
                  y={height - 8}
                  textAnchor="middle"
                  className={isSel ? 'chart__label chart__label--sel' : 'chart__label'}
                >
                  {rowLabel(row)}
                </text>
              )}
              {/* Área de toque maior que a barra. */}
              <rect
                x={AXIS_W + slot * i}
                y={0}
                width={slot}
                height={height}
                fill="transparent"
                style={{ cursor: onSelect ? 'pointer' : 'default' }}
                onMouseEnter={() => setActive(i)}
                onClick={() => onSelect?.(key)}
              />
            </g>
          );
        })}
      </svg>
      {activeRow && (
        <div className="chart__tooltip" style={{ left: tooltipLeft }} role="status">
          {describe(activeRow)}
        </div>
      )}
      {series.length > 1 && (
        <ul className="chart__legend">
          {series.map((s) => (
            <li key={s.key}>
              <span
                className="chart__swatch"
                style={{ background: typeof s.color === 'string' ? s.color : 'var(--muted)' }}
                aria-hidden="true"
              />
              {s.label}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
