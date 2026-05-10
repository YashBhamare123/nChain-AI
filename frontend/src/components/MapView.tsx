import MapViewGoogle from "./MapViewGoogle";
import MapViewMapLibre from "./MapViewMapLibre";

// Choose provider via VITE_MAP_PROVIDER in your local .env
//   VITE_MAP_PROVIDER=google     → Google Maps (requires VITE_GOOGLE_MAPS_API_KEY)
//   VITE_MAP_PROVIDER=maplibre   → MapLibre GL + OpenStreetMap (no key needed)
// Defaults to "google" to preserve existing behavior.
const provider = (import.meta.env.VITE_MAP_PROVIDER as string | undefined)?.toLowerCase() ?? "google";

const MapView = provider === "maplibre" ? MapViewMapLibre : MapViewGoogle;

export default MapView;
