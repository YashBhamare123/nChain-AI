import { useEffect, useMemo, useRef, useState } from "react";
import { GoogleMap, useJsApiLoader, Marker, Polyline } from "@react-google-maps/api";
import { useLocation } from "@/contexts/LocationContext";

const GOOGLE_MAPS_API_KEY = import.meta.env.VITE_GOOGLE_MAPS_API_KEY as string | undefined;

const containerStyle = { width: "100%", height: "100%" };

const mapOptions: google.maps.MapOptions = {
  disableDefaultUI: true,
  zoomControl: true,
  clickableIcons: false,
  gestureHandling: "greedy",
  styles: [
    { elementType: "geometry", stylers: [{ color: "#1a1d24" }] },
    { elementType: "labels.text.stroke", stylers: [{ color: "#1a1d24" }] },
    { elementType: "labels.text.fill", stylers: [{ color: "#9ca3af" }] },
    { featureType: "road", elementType: "geometry", stylers: [{ color: "#2a2f38" }] },
    { featureType: "road", elementType: "geometry.stroke", stylers: [{ color: "#2a2f38" }] },
    { featureType: "water", elementType: "geometry", stylers: [{ color: "#0f1116" }] },
    { featureType: "poi", elementType: "labels", stylers: [{ visibility: "off" }] },
    { featureType: "transit", elementType: "labels", stylers: [{ visibility: "off" }] },
  ],
};

interface MapViewProps {
  pickup?: [number, number] | null;
  dropoff?: [number, number] | null;
  driver?: [number, number] | null;
  /** Approach leg (driver -> pickup) — amber */
  approachRoute?: [number, number][] | null;
  /** Ride leg (pickup -> dropoff) — primary */
  rideRoute?: [number, number][] | null;
  /** Legacy single route — rendered as ride leg if rideRoute is not set */
  route?: [number, number][] | null;
  className?: string;
}

const toLatLng = (p: [number, number]) => ({ lat: p[0], lng: p[1] });

const MapView = ({ pickup, dropoff, driver, approachRoute, rideRoute, route, className = "" }: MapViewProps) => {
  const { lat, lng, loading, error, requestLocation } = useLocation();
  const mapRef = useRef<google.maps.Map | null>(null);
  const [recenterTick, setRecenterTick] = useState(0);

  const { isLoaded, loadError } = useJsApiLoader({
    googleMapsApiKey: GOOGLE_MAPS_API_KEY ?? "",
    id: "gmaps-script",
  });

  const center = useMemo<[number, number]>(
    () => (lat && lng ? [lat, lng] : [28.6139, 77.209]),
    [lat, lng]
  );

  // Instant recenter whenever user location changes
  useEffect(() => {
    if (!mapRef.current || !lat || !lng) return;
    mapRef.current.panTo({ lat, lng });
    setRecenterTick((t) => t + 1);
  }, [lat, lng]);

  // Fit bounds to all relevant points
  useEffect(() => {
    if (!mapRef.current || !isLoaded) return;
    const pts: [number, number][] = [];
    const ride = rideRoute ?? route ?? null;
    if (ride && ride.length > 1) pts.push(...ride);
    if (approachRoute && approachRoute.length > 1) pts.push(...approachRoute);
    if (pts.length === 0) {
      if (lat && lng) pts.push([lat, lng]);
      if (driver) pts.push(driver);
      if (pickup) pts.push(pickup);
      if (dropoff) pts.push(dropoff);
    }
    if (pts.length === 0) return;
    if (pts.length === 1) {
      mapRef.current.setCenter(toLatLng(pts[0]));
      mapRef.current.setZoom(15);
      return;
    }
    const bounds = new google.maps.LatLngBounds();
    pts.forEach((p) => bounds.extend(toLatLng(p)));
    mapRef.current.fitBounds(bounds, 60);
  }, [isLoaded, pickup?.[0], pickup?.[1], dropoff?.[0], dropoff?.[1], driver?.[0], driver?.[1], approachRoute, rideRoute, route]);

  if (!GOOGLE_MAPS_API_KEY) {
    return (
      <div className={`flex items-center justify-center bg-card rounded-xl border border-border ${className}`}>
        <div className="px-6 text-center max-w-sm">
          <p className="text-sm font-semibold mb-2">Google Maps API key missing</p>
          <p className="text-xs text-muted-foreground">
            Add <code className="font-mono text-primary">VITE_GOOGLE_MAPS_API_KEY</code> to your <code className="font-mono">.env</code> and reload.
          </p>
        </div>
      </div>
    );
  }

  if (loadError) {
    return (
      <div className={`flex items-center justify-center bg-card rounded-xl border border-border ${className}`}>
        <p className="text-xs text-destructive px-4 text-center">Failed to load Google Maps. Check API key & enabled APIs (Maps JS, Directions).</p>
      </div>
    );
  }

  if ((loading && !lat) || !isLoaded) {
    return (
      <div className={`flex items-center justify-center bg-card rounded-xl ${className}`}>
        <div className="flex flex-col items-center gap-3 px-6 text-center">
          <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin" />
          <span className="text-muted-foreground text-sm">Getting your location…</span>
          {error && (
            <>
              <span className="text-xs text-destructive max-w-xs">{error}</span>
              <button
                onClick={requestLocation}
                className="text-xs px-3 py-1.5 rounded-lg bg-primary text-primary-foreground font-semibold"
              >
                Retry
              </button>
            </>
          )}
        </div>
      </div>
    );
  }

  // Read CSS vars for path colors
  const styles = getComputedStyle(document.documentElement);
  const primary = `hsl(${styles.getPropertyValue("--primary").trim()})`;
  const amber = "#f59e0b";

  const ride = rideRoute ?? route ?? null;

  return (
    <div className={`rounded-xl overflow-hidden border border-border relative ${className}`}>
      <GoogleMap
        mapContainerStyle={containerStyle}
        center={{ lat: center[0], lng: center[1] }}
        zoom={14}
        options={mapOptions}
        onLoad={(m) => {
          mapRef.current = m;
        }}
      >
        {approachRoute && approachRoute.length > 1 && (
          <Polyline
            path={approachRoute.map(toLatLng)}
            options={{
              strokeColor: amber,
              strokeOpacity: 0,
              strokeWeight: 5,
              icons: [
                {
                  icon: { path: "M 0,-1 0,1", strokeOpacity: 1, scale: 3 },
                  offset: "0",
                  repeat: "14px",
                },
              ],
            }}
          />
        )}
        {ride && ride.length > 1 && (
          <Polyline
            path={ride.map(toLatLng)}
            options={{ strokeColor: primary, strokeOpacity: 0.9, strokeWeight: 5 }}
          />
        )}

        {lat && lng && (
          <Marker
            key={`me-${recenterTick}`}
            position={{ lat, lng }}
            icon={{
              path: google.maps.SymbolPath.CIRCLE,
              scale: 8,
              fillColor: primary,
              fillOpacity: 1,
              strokeColor: "#ffffff",
              strokeWeight: 2,
            }}
            title="You are here"
          />
        )}
        {driver && (
          <Marker
            position={toLatLng(driver)}
            label={{ text: "🚗", fontSize: "20px" }}
            icon={{
              path: google.maps.SymbolPath.CIRCLE,
              scale: 14,
              fillColor: amber,
              fillOpacity: 0.95,
              strokeColor: "#000000",
              strokeWeight: 1,
            }}
            title="Driver"
          />
        )}
        {pickup && (
          <Marker
            position={toLatLng(pickup)}
            label={{ text: "P", color: "#ffffff", fontWeight: "700", fontSize: "12px" }}
            icon={{
              path: google.maps.SymbolPath.CIRCLE,
              scale: 12,
              fillColor: primary,
              fillOpacity: 1,
              strokeColor: "#ffffff",
              strokeWeight: 2,
            }}
            title="Pickup"
          />
        )}
        {dropoff && (
          <Marker
            position={toLatLng(dropoff)}
            label={{ text: "D", color: "#ffffff", fontWeight: "700", fontSize: "12px" }}
            icon={{
              path: google.maps.SymbolPath.CIRCLE,
              scale: 12,
              fillColor: "#ef4444",
              fillOpacity: 1,
              strokeColor: "#ffffff",
              strokeWeight: 2,
            }}
            title="Dropoff"
          />
        )}
      </GoogleMap>
    </div>
  );
};

export default MapView;
