import { useEffect, useMemo, useRef } from "react";
import maplibregl, { Map as MLMap, Marker as MLMarker } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { useLocation } from "@/contexts/LocationContext";

interface MapViewProps {
  pickup?: [number, number] | null;
  dropoff?: [number, number] | null;
  driver?: [number, number] | null;
  approachRoute?: [number, number][] | null;
  rideRoute?: [number, number][] | null;
  route?: [number, number][] | null;
  className?: string;
}

// Free OSM raster style — no API key required
const STYLE: maplibregl.StyleSpecification = {
  version: 8,
  sources: {
    osm: {
      type: "raster",
      tiles: ["https://tile.openstreetmap.org/{z}/{x}/{y}.png"],
      tileSize: 256,
      attribution: "© OpenStreetMap contributors",
      maxzoom: 19,
    },
  },
  layers: [
    { id: "bg", type: "background", paint: { "background-color": "#1a1d24" } },
    { id: "osm", type: "raster", source: "osm", paint: { "raster-brightness-min": 0.1, "raster-brightness-max": 0.85, "raster-saturation": -0.5, "raster-contrast": 0.1 } },
  ],
};

const makeDot = (color: string, label?: string) => {
  const el = document.createElement("div");
  el.style.cssText = `width:20px;height:20px;border-radius:50%;background:${color};border:2px solid #fff;box-shadow:0 2px 6px rgba(0,0,0,.5);display:flex;align-items:center;justify-content:center;color:#fff;font-weight:700;font-size:11px;`;
  if (label) el.textContent = label;
  return el;
};

const MapViewMapLibre = ({ pickup, dropoff, driver, approachRoute, rideRoute, route, className = "" }: MapViewProps) => {
  const { lat, lng, loading, error, requestLocation } = useLocation();
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<MLMap | null>(null);
  const markersRef = useRef<Record<string, MLMarker>>({});

  const center = useMemo<[number, number]>(
    () => (lat && lng ? [lng, lat] : [77.209, 28.6139]),
    [lat, lng]
  );

  // Get primary color from CSS vars
  const primary = useMemo(() => {
    if (typeof document === "undefined") return "#3b82f6";
    const v = getComputedStyle(document.documentElement).getPropertyValue("--primary").trim();
    return v ? `hsl(${v})` : "#3b82f6";
  }, []);
  const amber = "#f59e0b";

  // Init map once
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    const map = new maplibregl.Map({
      container: containerRef.current,
      style: STYLE,
      center,
      zoom: 14,
      attributionControl: { compact: true },
    });
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right");
    mapRef.current = map;

    map.on("load", () => {
      map.addSource("ride", { type: "geojson", data: { type: "Feature", geometry: { type: "LineString", coordinates: [] }, properties: {} } });
      map.addSource("approach", { type: "geojson", data: { type: "Feature", geometry: { type: "LineString", coordinates: [] }, properties: {} } });
      map.addLayer({ id: "ride-line", type: "line", source: "ride", paint: { "line-color": primary, "line-width": 5, "line-opacity": 0.9 }, layout: { "line-cap": "round", "line-join": "round" } });
      map.addLayer({ id: "approach-line", type: "line", source: "approach", paint: { "line-color": amber, "line-width": 4, "line-dasharray": [1, 2] }, layout: { "line-cap": "round", "line-join": "round" } });
    });

    return () => {
      map.remove();
      mapRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Recenter on user location
  useEffect(() => {
    if (!mapRef.current || !lat || !lng) return;
    mapRef.current.panTo([lng, lat], { duration: 400 });
  }, [lat, lng]);

  // Update routes
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const apply = () => {
      const ride = rideRoute ?? route ?? [];
      const rideSrc = map.getSource("ride") as maplibregl.GeoJSONSource | undefined;
      const apprSrc = map.getSource("approach") as maplibregl.GeoJSONSource | undefined;
      rideSrc?.setData({ type: "Feature", geometry: { type: "LineString", coordinates: ride.map(([la, ln]) => [ln, la]) }, properties: {} });
      apprSrc?.setData({ type: "Feature", geometry: { type: "LineString", coordinates: (approachRoute ?? []).map(([la, ln]) => [ln, la]) }, properties: {} });

      // Fit bounds
      const pts: [number, number][] = [];
      if (ride.length > 1) pts.push(...ride);
      if (approachRoute && approachRoute.length > 1) pts.push(...approachRoute);
      if (pts.length === 0) {
        if (lat && lng) pts.push([lat, lng]);
        if (driver) pts.push(driver);
        if (pickup) pts.push(pickup);
        if (dropoff) pts.push(dropoff);
      }
      if (pts.length >= 2) {
        const bounds = new maplibregl.LngLatBounds();
        pts.forEach(([la, ln]) => bounds.extend([ln, la]));
        map.fitBounds(bounds, { padding: 60, duration: 500, maxZoom: 16 });
      }
    };
    if (map.isStyleLoaded()) apply();
    else map.once("load", apply);
  }, [approachRoute, rideRoute, route, pickup, dropoff, driver, lat, lng]);

  // Update markers
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    const upsert = (key: string, pos: [number, number] | null | undefined, color: string, label?: string) => {
      if (!pos) {
        markersRef.current[key]?.remove();
        delete markersRef.current[key];
        return;
      }
      const lngLat: [number, number] = [pos[1], pos[0]];
      let m = markersRef.current[key];
      if (!m) {
        m = new maplibregl.Marker({ element: makeDot(color, label) }).setLngLat(lngLat).addTo(map);
        markersRef.current[key] = m;
      } else {
        m.setLngLat(lngLat);
      }
    };

    upsert("me", lat && lng ? [lat, lng] : null, primary);
    upsert("driver", driver ?? null, amber, "🚗");
    upsert("pickup", pickup ?? null, primary, "P");
    upsert("dropoff", dropoff ?? null, "#ef4444", "D");
  }, [lat, lng, driver, pickup, dropoff, primary]);

  if ((loading && !lat)) {
    return (
      <div className={`flex items-center justify-center bg-card rounded-xl ${className}`}>
        <div className="flex flex-col items-center gap-3 px-6 text-center">
          <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin" />
          <span className="text-muted-foreground text-sm">Getting your location…</span>
          {error && (
            <>
              <span className="text-xs text-destructive max-w-xs">{error}</span>
              <button onClick={requestLocation} className="text-xs px-3 py-1.5 rounded-lg bg-primary text-primary-foreground font-semibold">
                Retry
              </button>
            </>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className={`rounded-xl overflow-hidden border border-border relative ${className}`}>
      <div ref={containerRef} style={{ width: "100%", height: "100%" }} />
    </div>
  );
};

export default MapViewMapLibre;
