import uPlot from "uplot";
import "uplot/dist/uPlot.min.css";
import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import { buildChartGroups, type ChartGroup } from "../lib/chartAdapters";
import type { OpenMeteoResponse, VariableSelection } from "../lib/types";

interface WeatherChartsProps {
  forecast: OpenMeteoResponse;
  selection: VariableSelection;
}

const colors = ["#15616d", "#c8791a", "#5a4fcf", "#2d7d46", "#b83256", "#5b6572"];

function timestamp(time: string): number {
  return Math.floor(new Date(time).getTime() / 1000);
}

function formatTime(time: string): string {
  return new Intl.DateTimeFormat("en", {
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit"
  }).format(new Date(time));
}

function ChartPanel({ group }: { group: ChartGroup }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const plotRef = useRef<uPlot | null>(null);
  const [enabled, setEnabled] = useState(() => new Set(group.series.map((series) => series.key)));
  const [readout, setReadout] = useState("Tap or hover a chart point for details.");
  const activeSeries = useMemo(() => group.series.filter((series) => enabled.has(series.key)), [enabled, group.series]);

  useEffect(() => {
    setEnabled(new Set(group.series.map((series) => series.key)));
  }, [group.id, group.series.length]);

  useEffect(() => {
    const element = containerRef.current;
    if (!element || activeSeries.length === 0) return undefined;

    plotRef.current?.destroy();
    const xValues = group.times.map(timestamp);
    const data = [xValues, ...activeSeries.map((series) => series.values)] as uPlot.AlignedData;
    const width = Math.max(element.clientWidth, Math.min(980, Math.max(560, group.times.length * 18)));
    const options: uPlot.Options = {
      width,
      height: 260,
      padding: [12, 12, 0, 0],
      legend: { show: true },
      cursor: { drag: { x: false, y: false } },
      scales: { x: { time: true } },
      axes: [
        {
          stroke: "#5f6c65",
          grid: { stroke: "rgba(31, 57, 48, 0.12)" }
        },
        {
          stroke: "#5f6c65",
          grid: { stroke: "rgba(31, 57, 48, 0.08)" }
        }
      ],
      series: [
        {},
        ...activeSeries.map((series, index) => ({
          label: `${series.label} (${series.unit})`,
          stroke: colors[index % colors.length],
          width: 2,
          points: { size: 5, width: 1 }
        }))
      ],
      hooks: {
        setCursor: [
          (plot) => {
            const left = plot.cursor.left;
            if (left == null) return;
            const index = plot.posToIdx(left);
            const time = group.times[index];
            if (!time) return;
            const values = activeSeries
              .map((series) => {
                const value = series.values[index];
                const display = value === null ? "No value" : `${Math.round(value * 10) / 10}${series.unit}`;
                return `${series.label}: ${display} (${series.interpretation(value)})`;
              })
              .join(" | ");
            setReadout(`${formatTime(time)} - ${values}`);
          }
        ]
      }
    };

    const plot = new uPlot(options, data, element);
    plotRef.current = plot;
    const resizeObserver = new ResizeObserver(() => {
      const nextWidth = Math.max(element.clientWidth, Math.min(980, Math.max(560, group.times.length * 18)));
      plot.setSize({ width: nextWidth, height: 260 });
    });
    resizeObserver.observe(element);

    return () => {
      resizeObserver.disconnect();
      plot.destroy();
      plotRef.current = null;
    };
  }, [activeSeries, group.times]);

  return (
    <section className="chart-panel" aria-labelledby={`chart-${group.id}`}>
      <div className="chart-header">
        <h3 id={`chart-${group.id}`}>{group.title}</h3>
        <div className="chart-toggles" aria-label={`${group.title} variables`}>
          {group.series.map((series) => (
            <label key={series.key} className="mini-check">
              <input
                type="checkbox"
                checked={enabled.has(series.key)}
                onChange={() => {
                  setEnabled((current) => {
                    const next = new Set(current);
                    if (next.has(series.key)) next.delete(series.key);
                    else next.add(series.key);
                    return next.size ? next : current;
                  });
                }}
              />
              <span>{series.label}</span>
            </label>
          ))}
        </div>
      </div>
      <div className="chart-scroll">
        <div ref={containerRef} className="uplot-wrap" />
      </div>
      <p className="chart-readout" aria-live="polite">
        {readout}
      </p>
    </section>
  );
}

export default function WeatherCharts({ forecast, selection }: WeatherChartsProps) {
  const groups = useMemo(() => buildChartGroups(forecast, selection), [forecast, selection]);

  if (!groups.length) {
    return (
      <section className="charts-section">
        <h2>Forecast charts</h2>
        <p className="muted">No hourly chart variables are selected.</p>
      </section>
    );
  }

  return (
    <section className="charts-section" aria-labelledby="charts-heading">
      <div className="section-heading">
        <p className="eyebrow">Hourly timeline</p>
        <h2 id="charts-heading">Forecast charts</h2>
      </div>
      <div className="charts-grid">
        {groups.map((group) => (
          <ChartPanel key={group.id} group={group} />
        ))}
      </div>
    </section>
  );
}
