import { Crosshair, Minus, Plus } from "lucide-preact";
import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import type { Coordinates } from "../lib/types";

interface LightMapProps {
  selected: Coordinates | null;
  center: Coordinates;
  onSelect: (coordinates: Coordinates) => void;
}

interface ViewState {
  center: Coordinates;
  zoom: number; // fractional during animation / gestures
}

const TILE_SIZE = 256;
const MIN_ZOOM = 3;
const MAX_ZOOM = 17;
const DEFAULT_ZOOM = 5;
const SELECTED_ZOOM = 11;
const DRAG_THRESHOLD = 6;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function roundCoordinate(value: number): number {
  // 5 decimals (~1 m) — same precision the coordinate fields display.
  return Math.round(value * 100_000) / 100_000;
}

function wrapLng(lng: number): number {
  return ((((lng + 180) % 360) + 360) % 360) - 180;
}

/** Web-Mercator projection to world pixels at a (possibly fractional) zoom. */
function project({ lat, lng }: Coordinates, zoom: number): { x: number; y: number } {
  const scale = TILE_SIZE * 2 ** zoom;
  const sinLat = Math.sin((clamp(lat, -85.05112878, 85.05112878) * Math.PI) / 180);
  return {
    x: ((lng + 180) / 360) * scale,
    y: (0.5 - Math.log((1 + sinLat) / (1 - sinLat)) / (4 * Math.PI)) * scale
  };
}

function unproject(point: { x: number; y: number }, zoom: number): Coordinates {
  const scale = TILE_SIZE * 2 ** zoom;
  const lng = (point.x / scale) * 360 - 180;
  const n = Math.PI - (2 * Math.PI * point.y) / scale;
  const lat = (180 / Math.PI) * Math.atan(Math.sinh(n));
  return { lat: clamp(lat, -85.05112878, 85.05112878), lng: wrapLng(lng) };
}

function tileUrl(x: number, y: number, zoom: number): string {
  const count = 2 ** zoom;
  const wrappedX = ((x % count) + count) % count;
  return `https://tile.openstreetmap.org/${zoom}/${wrappedX}/${y}.png`;
}

function sameCoordinate(a: Coordinates | null, b: Coordinates | null): boolean {
  if (!a || !b) return a === b;
  return Math.abs(a.lat - b.lat) < 6e-6 && Math.abs(a.lng - b.lng) < 6e-6;
}

const prefersReducedMotion = () =>
  typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

export default function LightMap({ selected, center, onSelect }: LightMapProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [mounted, setMounted] = useState(false);
  const [size, setSize] = useState({ width: 720, height: 420 });
  const [view, setViewState] = useState<ViewState>(() => ({
    center: selected || center,
    zoom: selected ? SELECTED_ZOOM : DEFAULT_ZOOM
  }));

  // Always-current copy of the view. Every handler and animation reads from here,
  // so nothing works from a stale closure (the root of the old pin/coords drift).
  const viewRef = useRef(view);
  const setView = (next: ViewState) => {
    viewRef.current = next;
    setViewState(next);
  };

  const animationRef = useRef<number | null>(null);
  // The coordinate this map itself just emitted. When it comes back through props
  // we must not fly again (that was the "double animation" jump).
  const lastEmittedRef = useRef<Coordinates | null>(null);
  const dragRef = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    startWorld: { x: number; y: number };
    zoom: number;
    moved: boolean;
  } | null>(null);

  function stopAnimation() {
    if (animationRef.current !== null) {
      cancelAnimationFrame(animationRef.current);
      animationRef.current = null;
    }
  }

  /**
   * Fly to a target. Interpolates in projected (pixel) space at a fractional zoom,
   * so the map moves in a straight visual line and the pin never detaches.
   */
  function flyTo(target: Coordinates, targetZoom: number) {
    stopAnimation();
    const start = viewRef.current;
    const endZoom = clamp(targetZoom, MIN_ZOOM, MAX_ZOOM);

    if (prefersReducedMotion()) {
      setView({ center: target, zoom: endZoom });
      return;
    }

    // Work at a common reference zoom so lerping x/y is meaningful.
    const ref = Math.max(start.zoom, endZoom);
    const a = project(start.center, ref);
    // Take the short way around the antimeridian.
    const worldWidth = TILE_SIZE * 2 ** ref;
    const bRaw = project(target, ref);
    let bx = bRaw.x;
    if (bx - a.x > worldWidth / 2) bx -= worldWidth;
    if (a.x - bx > worldWidth / 2) bx += worldWidth;

    const duration = 600;
    const startedAt = performance.now();

    const frame = (now: number) => {
      const t = clamp((now - startedAt) / duration, 0, 1);
      const e = 1 - Math.pow(1 - t, 3);
      const zoom = start.zoom + (endZoom - start.zoom) * e;
      const point = { x: a.x + (bx - a.x) * e, y: a.y + (bRaw.y - a.y) * e };
      setView({ center: unproject(point, ref), zoom });
      if (t < 1) {
        animationRef.current = requestAnimationFrame(frame);
      } else {
        animationRef.current = null;
        setView({ center: target, zoom: endZoom });
      }
    };
    animationRef.current = requestAnimationFrame(frame);
  }

  /** Zoom keeping the geographic point under (px, py) fixed on screen. */
  function zoomAround(nextZoom: number, px?: number, py?: number) {
    stopAnimation();
    const current = viewRef.current;
    const zoom = clamp(nextZoom, MIN_ZOOM, MAX_ZOOM);
    if (zoom === current.zoom) return;
    const { width, height } = sizeRef.current;
    const ox = (px ?? width / 2) - width / 2;
    const oy = (py ?? height / 2) - height / 2;
    const c = project(current.center, current.zoom);
    const anchor = unproject({ x: c.x + ox, y: c.y + oy }, current.zoom);
    const anchorNext = project(anchor, zoom);
    setView({ center: unproject({ x: anchorNext.x - ox, y: anchorNext.y - oy }, zoom), zoom });
  }

  const sizeRef = useRef(size);
  sizeRef.current = size;

  useEffect(() => {
    setMounted(true);
    return stopAnimation;
  }, []);

  // React to selection changes coming from OUTSIDE the map (inputs, geolocation, recents, URL).
  useEffect(() => {
    if (!selected) return;
    if (sameCoordinate(selected, lastEmittedRef.current)) return;
    lastEmittedRef.current = null;
    flyTo(selected, Math.max(viewRef.current.zoom, SELECTED_ZOOM));
  }, [selected?.lat, selected?.lng]);

  // Default center only matters while nothing is selected.
  useEffect(() => {
    if (selected) return;
    flyTo(center, viewRef.current.zoom);
  }, [center.lat, center.lng]);

  useEffect(() => {
    const element = containerRef.current;
    if (!element) return undefined;
    const observer = new ResizeObserver(([entry]) => {
      setSize({ width: entry.contentRect.width, height: entry.contentRect.height });
    });
    observer.observe(element);

    // Non-passive wheel listener so preventDefault actually stops page scroll.
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      const rect = element.getBoundingClientRect();
      // Proportional for trackpads, capped per notch for mouse wheels.
      const step = clamp(event.deltaY * (event.deltaMode === 1 ? 0.05 : 0.004), -0.6, 0.6);
      zoomAround(viewRef.current.zoom - step, event.clientX - rect.left, event.clientY - rect.top);
    };
    element.addEventListener("wheel", onWheel, { passive: false });
    return () => {
      observer.disconnect();
      element.removeEventListener("wheel", onWheel);
    };
  }, []);

  // Tiles are fetched at an integer zoom and scaled for the fractional part.
  const tileZoom = clamp(Math.round(view.zoom), MIN_ZOOM, MAX_ZOOM);
  const tileScale = 2 ** (view.zoom - tileZoom);
  const scaledTile = TILE_SIZE * tileScale;
  const centerPoint = project(view.center, tileZoom);

  const tiles = useMemo(() => {
    const halfW = size.width / 2 / tileScale;
    const halfH = size.height / 2 / tileScale;
    const minX = Math.floor((centerPoint.x - halfW) / TILE_SIZE);
    const maxX = Math.floor((centerPoint.x + halfW) / TILE_SIZE);
    const minY = Math.max(0, Math.floor((centerPoint.y - halfH) / TILE_SIZE));
    const maxY = Math.min(2 ** tileZoom - 1, Math.floor((centerPoint.y + halfH) / TILE_SIZE));
    const list: Array<{ key: string; url: string; left: number; top: number }> = [];
    for (let x = minX; x <= maxX; x += 1) {
      for (let y = minY; y <= maxY; y += 1) {
        list.push({
          key: `${tileZoom}-${x}-${y}`,
          url: tileUrl(x, y, tileZoom),
          left: (x * TILE_SIZE - centerPoint.x) * tileScale + size.width / 2,
          top: (y * TILE_SIZE - centerPoint.y) * tileScale + size.height / 2
        });
      }
    }
    return list;
  }, [centerPoint.x, centerPoint.y, size.width, size.height, tileZoom, tileScale]);

  // Pin uses the exact same projection + zoom as the tiles, every frame.
  let pin: { left: number; top: number } | null = null;
  if (selected) {
    const worldWidth = TILE_SIZE * 2 ** tileZoom;
    const p = project(selected, tileZoom);
    let dx = p.x - centerPoint.x;
    if (dx > worldWidth / 2) dx -= worldWidth;
    if (dx < -worldWidth / 2) dx += worldWidth;
    pin = {
      left: size.width / 2 + dx * tileScale,
      top: size.height / 2 + (p.y - centerPoint.y) * tileScale
    };
  }
  const pinOffscreen =
    pin !== null && (pin.left < 0 || pin.top < 0 || pin.left > size.width || pin.top > size.height);

  function coordinatesAt(clientX: number, clientY: number): Coordinates | null {
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return null;
    const current = viewRef.current;
    const c = project(current.center, current.zoom);
    const point = unproject(
      { x: c.x + (clientX - rect.left - rect.width / 2), y: c.y + (clientY - rect.top - rect.height / 2) },
      current.zoom
    );
    return { lat: roundCoordinate(point.lat), lng: roundCoordinate(point.lng) };
  }

  function select(next: Coordinates) {
    // The pin lands exactly where the user tapped; the map does not jump under their finger.
    lastEmittedRef.current = next;
    onSelect(next);
  }

  function handlePointerDown(event: PointerEvent) {
    if (event.button !== 0) return;
    stopAnimation();
    const current = viewRef.current;
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
    dragRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      startWorld: project(current.center, current.zoom),
      zoom: current.zoom,
      moved: false
    };
  }

  function handlePointerMove(event: PointerEvent) {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    const dx = event.clientX - drag.startX;
    const dy = event.clientY - drag.startY;
    if (!drag.moved && Math.hypot(dx, dy) < DRAG_THRESHOLD) return;
    drag.moved = true;
    setView({
      center: unproject({ x: drag.startWorld.x - dx, y: drag.startWorld.y - dy }, drag.zoom),
      zoom: drag.zoom
    });
  }

  function handlePointerUp(event: PointerEvent) {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    dragRef.current = null;
    const target = event.currentTarget as HTMLElement;
    if (target.hasPointerCapture(event.pointerId)) target.releasePointerCapture(event.pointerId);
    if (!drag.moved) {
      const next = coordinatesAt(event.clientX, event.clientY);
      if (next) select(next);
    }
  }

  function handleKeyDown(event: KeyboardEvent) {
    const step = 80;
    const current = viewRef.current;
    const c = project(current.center, current.zoom);
    const moves: Record<string, [number, number]> = {
      ArrowUp: [0, -step],
      ArrowDown: [0, step],
      ArrowLeft: [-step, 0],
      ArrowRight: [step, 0]
    };
    if (moves[event.key]) {
      event.preventDefault();
      const [mx, my] = moves[event.key];
      setView({ center: unproject({ x: c.x + mx, y: c.y + my }, current.zoom), zoom: current.zoom });
    } else if (event.key === "+" || event.key === "=") {
      zoomAround(Math.round(current.zoom) + 1);
    } else if (event.key === "-") {
      zoomAround(Math.round(current.zoom) - 1);
    } else if (event.key === "Enter") {
      select({ lat: roundCoordinate(current.center.lat), lng: roundCoordinate(current.center.lng) });
    }
  }

  return (
    <div className="map" ref={containerRef}>
      <div
        className="map-canvas"
        role="application"
        tabIndex={0}
        aria-label="Map. Tap to pick a location. Arrow keys pan, plus and minus zoom, Enter picks the center."
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={() => {
          dragRef.current = null;
        }}
        onDblClick={(event) => {
          event.preventDefault();
          const rect = containerRef.current!.getBoundingClientRect();
          zoomAround(Math.round(viewRef.current.zoom) + 1, event.clientX - rect.left, event.clientY - rect.top);
        }}
        onKeyDown={handleKeyDown}
      >
        {mounted ? (
          tiles.map((tile) => (
            <img
              key={tile.key}
              className="map-tile"
              src={tile.url}
              alt=""
              draggable={false}
              style={{
                width: `${scaledTile + 0.5}px`,
                height: `${scaledTile + 0.5}px`,
                transform: `translate3d(${tile.left}px, ${tile.top}px, 0)`
              }}
            />
          ))
        ) : (
          <div className="map-loading">Loading map…</div>
        )}

        {mounted && pin && !pinOffscreen ? (
          <div className="map-pin" style={{ transform: `translate3d(${pin.left}px, ${pin.top}px, 0)` }}>
            <span className="sr-only">Selected location</span>
          </div>
        ) : null}
      </div>

      <div className="map-toolbar" aria-label="Map controls">
        <button type="button" className="icon-button" onClick={() => zoomAround(Math.round(viewRef.current.zoom) + 1)} aria-label="Zoom in" disabled={view.zoom >= MAX_ZOOM}>
          <Plus size={18} aria-hidden="true" />
        </button>
        <button type="button" className="icon-button" onClick={() => zoomAround(Math.round(viewRef.current.zoom) - 1)} aria-label="Zoom out" disabled={view.zoom <= MIN_ZOOM}>
          <Minus size={18} aria-hidden="true" />
        </button>
        {selected ? (
          <button
            type="button"
            className={`icon-button ${pinOffscreen ? "is-attention" : ""}`}
            onClick={() => flyTo(selected, Math.max(viewRef.current.zoom, SELECTED_ZOOM))}
            aria-label="Center map on selected location"
            title="Center on pin"
          >
            <Crosshair size={18} aria-hidden="true" />
          </button>
        ) : null}
      </div>

      <div className="map-attribution">
        ©{" "}
        <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">
          OpenStreetMap
        </a>
      </div>
    </div>
  );
}
