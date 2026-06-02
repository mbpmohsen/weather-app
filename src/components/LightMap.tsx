import { Minus, Plus } from "lucide-preact";
import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import type { Coordinates } from "../lib/types";

interface LightMapProps {
  selected: Coordinates | null;
  center: Coordinates;
  onSelect: (coordinates: Coordinates) => void;
}

const TILE_SIZE = 256;
const MIN_ZOOM = 3;
const MAX_ZOOM = 13;
const DEFAULT_ZOOM = 8;
const SELECTED_ZOOM = 12;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function roundCoordinate(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000;
}

function project({ lat, lng }: Coordinates, zoom: number): { x: number; y: number } {
  const scale = TILE_SIZE * 2 ** zoom;
  const safeLat = clamp(lat, -85.05112878, 85.05112878);
  const sinLat = Math.sin((safeLat * Math.PI) / 180);

  return {
    x: ((lng + 180) / 360) * scale,
    y: (0.5 - Math.log((1 + sinLat) / (1 - sinLat)) / (4 * Math.PI)) * scale
  };
}

function unproject(point: { x: number; y: number }, zoom: number): Coordinates {
  const scale = TILE_SIZE * 2 ** zoom;
  const lng = (point.x / scale) * 360 - 180;
  const mercator = Math.PI - (2 * Math.PI * point.y) / scale;
  const lat =
    (180 / Math.PI) *
    Math.atan(0.5 * (Math.exp(mercator) - Math.exp(-mercator)));

  return {
    lat: roundCoordinate(lat),
    lng: roundCoordinate(lng)
  };
}

function tileUrl(x: number, y: number, zoom: number): string {
  const count = 2 ** zoom;
  const wrappedX = ((x % count) + count) % count;

  return `https://tile.openstreetmap.org/${zoom}/${wrappedX}/${y}.png`;
}

function isSameCoordinate(a: Coordinates, b: Coordinates): boolean {
  return Math.abs(a.lat - b.lat) < 0.000001 && Math.abs(a.lng - b.lng) < 0.000001;
}

export default function LightMap({ selected, center, onSelect }: LightMapProps) {
  const containerRef = useRef<HTMLDivElement>(null);

  const dragRef = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    startCenter: Coordinates;
    moved: boolean;
  } | null>(null);

  const animationRef = useRef<number | null>(null);

  const [mounted, setMounted] = useState(false);
  const [size, setSize] = useState({ width: 720, height: 420 });
  const [view, setView] = useState(center);
  const [zoom, setZoom] = useState(DEFAULT_ZOOM);

  useEffect(() => {
    setMounted(true);

    return () => {
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current);
      }
    };
  }, []);

  function animateToView(target: Coordinates, targetZoom = zoom) {
    if (animationRef.current) {
      cancelAnimationFrame(animationRef.current);
    }

    const startView = view;
    const startZoom = zoom;
    const duration = 550;
    const startedAt = performance.now();

    function frame(now: number) {
      const rawProgress = clamp((now - startedAt) / duration, 0, 1);

      // easeOutCubic
      const progress = 1 - Math.pow(1 - rawProgress, 3);

      const nextView = {
        lat: startView.lat + (target.lat - startView.lat) * progress,
        lng: startView.lng + (target.lng - startView.lng) * progress
      };

      const nextZoom = startZoom + (targetZoom - startZoom) * progress;

      setView(nextView);
      setZoom(Math.round(nextZoom));

      if (rawProgress < 1) {
        animationRef.current = requestAnimationFrame(frame);
      } else {
        setView(target);
        setZoom(targetZoom);
        animationRef.current = null;
      }
    }

    animationRef.current = requestAnimationFrame(frame);
  }

  useEffect(() => {
    const nextView = selected || center;
    const nextZoom = selected ? SELECTED_ZOOM : DEFAULT_ZOOM;

    if (isSameCoordinate(nextView, view) && zoom === nextZoom) return;

    animateToView(nextView, nextZoom);
  }, [center.lat, center.lng, selected?.lat, selected?.lng]);

  useEffect(() => {
    const element = containerRef.current;
    if (!element) return undefined;

    const resizeObserver = new ResizeObserver(([entry]) => {
      setSize({
        width: entry.contentRect.width,
        height: entry.contentRect.height
      });
    });

    resizeObserver.observe(element);

    return () => resizeObserver.disconnect();
  }, []);

  const centerPoint = useMemo(() => project(view, zoom), [view.lat, view.lng, zoom]);

  const tiles = useMemo(() => {
    const minX = Math.floor((centerPoint.x - size.width / 2) / TILE_SIZE) - 1;
    const maxX = Math.floor((centerPoint.x + size.width / 2) / TILE_SIZE) + 1;
    const minY = Math.max(
      0,
      Math.floor((centerPoint.y - size.height / 2) / TILE_SIZE) - 1
    );
    const maxY = Math.min(
      2 ** zoom - 1,
      Math.floor((centerPoint.y + size.height / 2) / TILE_SIZE) + 1
    );

    const nextTiles: Array<{
      key: string;
      url: string;
      left: number;
      top: number;
    }> = [];

    for (let x = minX; x <= maxX; x += 1) {
      for (let y = minY; y <= maxY; y += 1) {
        nextTiles.push({
          key: `${zoom}-${x}-${y}`,
          url: tileUrl(x, y, zoom),
          left: x * TILE_SIZE - centerPoint.x + size.width / 2,
          top: y * TILE_SIZE - centerPoint.y + size.height / 2
        });
      }
    }

    return nextTiles;
  }, [centerPoint.x, centerPoint.y, size.height, size.width, zoom]);

  const pinPosition = useMemo(() => {
    if (!selected) return null;

    const point = project(selected, zoom);

    return {
      left: size.width / 2 + point.x - centerPoint.x,
      top: size.height / 2 + point.y - centerPoint.y
    };
  }, [
    centerPoint.x,
    centerPoint.y,
    selected?.lat,
    selected?.lng,
    size.height,
    size.width,
    zoom
  ]);

  function getCoordinatesFromPointer(clientX: number, clientY: number): Coordinates | null {
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return null;

    const x = clientX - rect.left;
    const y = clientY - rect.top;

    const point = {
      x: centerPoint.x + x - rect.width / 2,
      y: centerPoint.y + y - rect.height / 2
    };

    return unproject(point, zoom);
  }

  function selectFromPointer(clientX: number, clientY: number) {
    const next = getCoordinatesFromPointer(clientX, clientY);
    if (!next) return;

    onSelect(next);
    animateToView(next, SELECTED_ZOOM);
  }

  function handlePointerDown(event: PointerEvent) {
    const element = containerRef.current;
    if (!element) return;

    element.setPointerCapture(event.pointerId);

    dragRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      startCenter: view,
      moved: false
    };
  }

  function handlePointerMove(event: PointerEvent) {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;

    if (animationRef.current) {
      cancelAnimationFrame(animationRef.current);
      animationRef.current = null;
    }

    const dx = event.clientX - drag.startX;
    const dy = event.clientY - drag.startY;

    if (Math.abs(dx) + Math.abs(dy) > 4) {
      drag.moved = true;
    }

    const startPoint = project(drag.startCenter, zoom);

    setView(
      unproject(
        {
          x: startPoint.x - dx,
          y: startPoint.y - dy
        },
        zoom
      )
    );
  }

  function handlePointerUp(event: PointerEvent) {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;

    dragRef.current = null;

    const element = containerRef.current;
    if (element.hasPointerCapture(event.pointerId)) {
      element.releasePointerCapture(event.pointerId);
    }

    // Do not select on normal click.
    // Selection is handled by double click.
  }

  function zoomBy(delta: number) {
    setZoom((current) => clamp(current + delta, MIN_ZOOM, MAX_ZOOM));
  }

  return (
    <div className="map" ref={containerRef} aria-label="Selectable weather map">
      <div
        className="map-canvas"
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={() => {
          dragRef.current = null;
        }}
        onDblClick={(event) => {
          event.preventDefault();
          selectFromPointer(event.clientX, event.clientY);
        }}
        onWheel={(event) => {
          event.preventDefault();
          zoomBy(event.deltaY > 0 ? -1 : 1);
        }}
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
                transform: `translate(${tile.left}px, ${tile.top}px)`
              }}
            />
          ))
        ) : (
          <div className="map-loading">Loading map</div>
        )}

        {mounted && pinPosition ? (
          <div
            className="map-pin"
            style={{
              transform: `translate(${pinPosition.left}px, ${pinPosition.top}px) translate(-50%, -100%)`
            }}
          >
            <span className="sr-only">Selected location</span>
          </div>
        ) : null}
      </div>

      <div className="map-toolbar" aria-label="Map zoom controls">
        <button
          type="button"
          className="icon-button"
          onClick={() => zoomBy(1)}
          aria-label="Zoom in"
        >
          <Plus size={18} aria-hidden="true" />
        </button>

        <button
          type="button"
          className="icon-button"
          onClick={() => zoomBy(-1)}
          aria-label="Zoom out"
        >
          <Minus size={18} aria-hidden="true" />
        </button>
      </div>

      <div className="map-attribution">
        <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">
          OpenStreetMap
        </a>
      </div>
    </div>
  );
}
