import uPlot from "uplot";
import "uplot/dist/uPlot.min.css";
import { ChevronLeft, ChevronRight } from "lucide-preact";
import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import { buildChartTimeline, type ChartGroup, type ChartTimeline } from "../lib/chartAdapters";
import { weatherCodeLabel } from "../lib/nowcast";
import { locationNow } from "../lib/scoringEngine";
import type { OpenMeteoResponse, VariableSelection } from "../lib/types";

interface WeatherChartsProps {
  forecast: OpenMeteoResponse;
  selection: VariableSelection;
}

const HOUR = 3600;
const WINDOW_HOURS = 48;

interface Palette {
  series: string[];
  axis: string;
  grid: string;
  now: string;
  cursor: string;
  wet: string;
  night: string;
}

function cssVar(name: string, fallback: string): string {
  if (typeof document === "undefined") return fallback;
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;
}

function readPalette(): Palette {
  return {
    series: [cssVar("--blue", "#15616d"), cssVar("--orange", "#c8791a"), cssVar("--green-2", "#2d7d46"), cssVar("--rose", "#b83256")],
    axis: cssVar("--muted", "#5f6c65"),
    grid: cssVar("--line-soft", "rgba(31, 57, 48, 0.09)"),
    now: cssVar("--rose", "#b83256"),
    cursor: cssVar("--ink", "#13231d"),
    wet: cssVar("--chart-wet", "rgba(21, 97, 109, 0.12)"),
    night: cssVar("--chart-night", "rgba(19, 35, 29, 0.06)")
  };
}

/** Re-reads chart colors when the system switches between light and dark mode. */
function usePalette(): Palette {
  const [palette, setPalette] = useState(readPalette);
  useEffect(() => {
    const query = window.matchMedia?.("(prefers-color-scheme: dark)");
    if (!query) return undefined;
    const update = () => setPalette(readPalette());
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);
  return palette;
}

const weekdayFormat = new Intl.DateTimeFormat("en", { weekday: "short", timeZone: "UTC" });

function dayLabel(stamp: number): string {
  const date = new Date(stamp * 1000);
  return `${weekdayFormat.format(date)} ${date.getUTCDate()}`;
}

function tickLabel(stamp: number): string {
  const date = new Date(stamp * 1000);
  const hour = date.getUTCHours();
  return hour === 0 ? dayLabel(stamp) : `${`${hour}`.padStart(2, "0")}:00`;
}

function formatNumber(value: number): string {
  if (Math.abs(value) >= 100) return `${Math.round(value)}`;
  return `${Math.round(value * 10) / 10}`;
}

function formatValue(value: number | null, unit: string): string {
  if (value === null) return "–";
  const spacer = unit === "%" || unit.startsWith("°") ? "" : " ";
  return `${formatNumber(value)}${spacer}${unit}`;
}

interface PanelProps {
  group: ChartGroup;
  timeline: ChartTimeline;
  palette: Palette;
  index: number;
  nowIndex: number;
  range: [number, number];
  onIndex: (index: number) => void;
}

function ChartPanel({ group, timeline, palette, index, nowIndex, range, onIndex }: PanelProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const plotRef = useRef<uPlot | null>(null);
  const indexRef = useRef(index);
  const rangeRef = useRef(range);
  const onIndexRef = useRef(onIndex);
  indexRef.current = index;
  rangeRef.current = range;
  onIndexRef.current = onIndex;

  useEffect(() => {
    const element = containerRef.current;
    if (!element) return undefined;
    const height = window.matchMedia("(max-width: 760px)").matches ? 170 : 210;
    const { stamps } = timeline;
    const [leftUnit, rightUnit] = group.scales;

    const scales: uPlot.Scales = { x: { time: true } };
    group.scales.forEach((unit) => {
      const hasBars = group.series.some((series) => series.scale === unit && series.kind === "bars");
      if (unit === "%") scales[unit] = { range: [0, 100] };
      else if (hasBars) scales[unit] = { range: (_u, _min, max) => [0, Math.max(1, max)] };
      else scales[unit] = {};
    });

    const axes: uPlot.Axis[] = [
      {
        stroke: palette.axis,
        grid: { stroke: palette.grid },
        ticks: { stroke: palette.grid },
        space: 64,
        values: (_u, splits) => splits.map((value) => tickLabel(value))
      },
      {
        scale: leftUnit,
        stroke: palette.axis,
        grid: { stroke: palette.grid },
        ticks: { show: false },
        size: 48,
        values: (_u, splits) => splits.map((value) => `${formatNumber(value)}${leftUnit === "%" ? "%" : ""}`)
      }
    ];
    if (rightUnit) {
      axes.push({
        scale: rightUnit,
        side: 1,
        stroke: palette.axis,
        grid: { show: false },
        ticks: { show: false },
        size: 44,
        values: (_u, splits) => splits.map((value) => `${formatNumber(value)}${rightUnit === "%" ? "%" : ""}`)
      });
    }

    const bars = uPlot.paths.bars?.({ size: [0.7, 14] });
    const series: uPlot.Series[] = [
      {},
      ...group.series.map((item, seriesIndex) => {
        const color = palette.series[seriesIndex % palette.series.length];
        return item.kind === "bars"
          ? { label: item.label, scale: item.scale, stroke: color, fill: color, width: 0, paths: bars, points: { show: false } }
          : { label: item.label, scale: item.scale, stroke: color, width: 2, points: { show: false }, spanGaps: true };
      })
    ];

    const xAt = (u: uPlot, stamp: number) => u.valToPos(stamp, "x", true);

    const options: uPlot.Options = {
      width: Math.max(280, element.clientWidth),
      height,
      padding: [8, rightUnit ? 4 : 12, 0, 0],
      tzDate: (stamp) => uPlot.tzDate(new Date(stamp * 1000), "Etc/UTC"),
      legend: { show: false },
      cursor: { x: false, y: false, points: { show: false }, drag: { x: false, y: false } },
      scales,
      axes,
      series,
      hooks: {
        drawClear: [
          (u) => {
            const { ctx, bbox } = u;
            const [min, max] = rangeRef.current;
            ctx.save();
            stamps.forEach((stamp, i) => {
              if (stamp + HOUR < min || stamp > max) return;
              const x0 = xAt(u, stamp);
              const width = xAt(u, stamp + HOUR) - x0;
              if (timeline.night[i]) {
                ctx.fillStyle = palette.night;
                ctx.fillRect(x0, bbox.top, width, bbox.height);
              }
              if (timeline.wet[i]) {
                ctx.fillStyle = palette.wet;
                ctx.fillRect(x0, bbox.top, width, bbox.height);
              }
            });
            ctx.restore();
          }
        ],
        draw: [
          (u) => {
            const { ctx, bbox } = u;
            const ratio = devicePixelRatio || 1;
            ctx.save();
            if (nowIndex >= 0) {
              const x = Math.round(xAt(u, stamps[nowIndex]));
              ctx.strokeStyle = palette.now;
              ctx.lineWidth = 1.5 * ratio;
              ctx.setLineDash([4 * ratio, 4 * ratio]);
              ctx.beginPath();
              ctx.moveTo(x, bbox.top);
              ctx.lineTo(x, bbox.top + bbox.height);
              ctx.stroke();
            }
            const selected = indexRef.current;
            const x = Math.round(xAt(u, stamps[selected]));
            ctx.setLineDash([]);
            ctx.strokeStyle = palette.cursor;
            ctx.lineWidth = 1.5 * ratio;
            ctx.beginPath();
            ctx.moveTo(x, bbox.top);
            ctx.lineTo(x, bbox.top + bbox.height);
            ctx.stroke();
            group.series.forEach((item, seriesIndex) => {
              const value = item.values[selected];
              if (value === null || item.kind === "bars") return;
              const y = u.valToPos(value, item.scale, true);
              ctx.fillStyle = palette.series[seriesIndex % palette.series.length];
              ctx.beginPath();
              ctx.arc(x, y, 4 * ratio, 0, Math.PI * 2);
              ctx.fill();
            });
            ctx.restore();
          }
        ],
        setCursor: [
          (u) => {
            const idx = u.cursor.idx;
            if (idx !== null && idx !== undefined && idx !== indexRef.current) onIndexRef.current(idx);
          }
        ],
        ready: [
          (u) => {
            // Touch: a horizontal drag on the chart scrubs; vertical swipes still scroll the page (touch-action: pan-y).
            const pick = (event: PointerEvent) => {
              if (event.pointerType === "mouse") return;
              const idx = u.posToIdx(event.offsetX);
              if (idx >= 0 && idx !== indexRef.current) onIndexRef.current(idx);
            };
            u.over.addEventListener("pointerdown", pick);
            u.over.addEventListener("pointermove", pick);
          }
        ]
      }
    };

    const data = [stamps, ...group.series.map((item) => item.values)] as uPlot.AlignedData;
    const plot = new uPlot(options, data, element);
    plot.setScale("x", { min: rangeRef.current[0], max: rangeRef.current[1] });
    plotRef.current = plot;

    const resizeObserver = new ResizeObserver(() => {
      plot.setSize({ width: Math.max(280, element.clientWidth), height });
    });
    resizeObserver.observe(element);
    return () => {
      resizeObserver.disconnect();
      plot.destroy();
      plotRef.current = null;
    };
  }, [group, timeline, palette, nowIndex]);

  useEffect(() => {
    plotRef.current?.setScale("x", { min: range[0], max: range[1] });
  }, [range[0], range[1]]);

  useEffect(() => {
    plotRef.current?.redraw(false, false);
  }, [index]);

  return (
    <section className="chart-panel" aria-labelledby={`chart-${group.id}`}>
      <div className="chart-header">
        <h3 id={`chart-${group.id}`}>{group.title}</h3>
        <ul className="chart-legend">
          {group.series.map((item, seriesIndex) => (
            <li key={item.key}>
              <span
                className={`swatch ${item.kind === "bars" ? "is-bar" : ""}`}
                style={{ background: palette.series[seriesIndex % palette.series.length] }}
                aria-hidden="true"
              />
              {item.label} ({item.unit}){group.scales.length > 1 ? (item.scale === group.scales[1] ? " · right" : " · left") : ""}
            </li>
          ))}
        </ul>
      </div>
      <div ref={containerRef} className="uplot-wrap" role="img" aria-label={`${group.title} chart. Use the time control above to read exact values.`} />
    </section>
  );
}

function Readout({ timeline, index, codes }: { timeline: ChartTimeline; index: number; codes: Array<number | string | null> | undefined }) {
  const code = codes?.[index];
  const items = timeline.groups.flatMap((group) => group.series);
  return (
    <div className="chart-readout" aria-live="polite">
      <p className="readout-condition">
        {typeof code === "number" ? weatherCodeLabel(code) : timeline.wet[index] ? "Wet" : "Dry"}
        {timeline.wet[index] ? <span className="readout-tag is-wet">Wet hour</span> : null}
        {timeline.night[index] ? <span className="readout-tag">Night</span> : null}
      </p>
      <dl>
        {items.map((item) => (
          <div key={item.key}>
            <dt>{item.label}</dt>
            <dd>
              {formatValue(item.values[index], item.unit)}
              {item.interpretation(item.values[index]) !== "Forecast value" ? <small>{item.interpretation(item.values[index])}</small> : null}
            </dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

export default function WeatherCharts({ forecast, selection }: WeatherChartsProps) {
  const timeline = useMemo(() => buildChartTimeline(forecast, selection), [forecast, selection]);
  const palette = usePalette();
  const count = timeline.times.length;
  const nowIndex = useMemo(() => {
    const now = locationNow(forecast);
    if (!now) return -1;
    const hour = `${now.slice(0, 13)}:00`;
    return timeline.times.indexOf(hour);
  }, [forecast, timeline]);

  const [index, setIndex] = useState(() => Math.max(0, nowIndex));
  const [showAll, setShowAll] = useState(false);
  const [windowStart, setWindowStart] = useState(() => Math.max(0, Math.min(Math.max(0, nowIndex) - 6, count - WINDOW_HOURS)));

  // Reset when a new forecast arrives.
  useEffect(() => {
    setIndex(Math.max(0, nowIndex));
    setWindowStart(Math.max(0, Math.min(Math.max(0, nowIndex) - 6, count - WINDOW_HOURS)));
  }, [timeline]);

  const windowed = !showAll && count > WINDOW_HOURS;
  // Keep the selected hour visible: slide the 48 h window when the cursor leaves it.
  useEffect(() => {
    if (!windowed) return;
    if (index < windowStart || index >= windowStart + WINDOW_HOURS) {
      setWindowStart(Math.max(0, Math.min(index - 6, count - WINDOW_HOURS)));
    }
  }, [index, windowed]);

  if (!count || !timeline.groups.length) {
    return (
      <section className="charts-section">
        <h2>Hourly charts</h2>
        <p className="muted">No hourly chart variables are selected.</p>
      </section>
    );
  }

  const first = windowed ? windowStart : 0;
  const last = windowed ? Math.min(count - 1, windowStart + WINDOW_HOURS - 1) : count - 1;
  const range: [number, number] = [timeline.stamps[first], timeline.stamps[last] + HOUR];
  const clamp = (value: number) => Math.max(0, Math.min(count - 1, value));
  const stamp = timeline.stamps[index];
  const timeText = `${dayLabel(stamp)}, ${timeline.times[index].slice(11, 16)}`;

  return (
    <section className="charts-section" aria-labelledby="charts-heading">
      <div className="section-row">
        <h2 id="charts-heading">Hourly charts</h2>
        {count > WINDOW_HOURS ? (
          <div className="segmented compact chart-span" role="group" aria-label="Chart time span">
            <button type="button" className={!showAll ? "is-selected" : ""} aria-pressed={!showAll} onClick={() => setShowAll(false)}>
              48 h
            </button>
            <button type="button" className={showAll ? "is-selected" : ""} aria-pressed={showAll} onClick={() => setShowAll(true)}>
              All {Math.round(count / 24)} days
            </button>
          </div>
        ) : null}
      </div>

      <div className="scrubber-wrap">
        <div className="scrubber" role="group" aria-label="Chart time">
          <button type="button" className="icon-button" onClick={() => setIndex(clamp(index - 1))} disabled={index <= 0} aria-label="One hour earlier">
            <ChevronLeft size={20} aria-hidden="true" />
          </button>
          <div className="scrubber-mid">
            <output className="scrubber-time" htmlFor="chart-hour">
              {timeText}
              {index === nowIndex ? <span className="now-tag">Now</span> : null}
            </output>
            <input
              id="chart-hour"
              type="range"
              min={0}
              max={count - 1}
              step={1}
              value={index}
              onInput={(event) => setIndex(Number(event.currentTarget.value))}
              aria-label="Hour shown in charts"
              aria-valuetext={timeText}
            />
          </div>
          <button type="button" className="icon-button" onClick={() => setIndex(clamp(index + 1))} disabled={index >= count - 1} aria-label="One hour later">
            <ChevronRight size={20} aria-hidden="true" />
          </button>
          <button type="button" className="now-button" onClick={() => setIndex(Math.max(0, nowIndex))} disabled={nowIndex < 0 || index === nowIndex}>
            Now
          </button>
        </div>
        <Readout timeline={timeline} index={index} codes={forecast.hourly?.weather_code} />
      </div>

      <div className="charts-grid">
        {timeline.groups.map((group) => (
          <ChartPanel key={group.id} group={group} timeline={timeline} palette={palette} index={index} nowIndex={nowIndex} range={range} onIndex={setIndex} />
        ))}
      </div>
      <p className="chart-key">
        <span className="key-wet" aria-hidden="true" /> Wet hours <span className="key-night" aria-hidden="true" /> Night <span className="key-now" aria-hidden="true" /> Now
      </p>
    </section>
  );
}
