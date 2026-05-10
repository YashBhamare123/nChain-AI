// OSRM routing helper. Free public demo server — fine for prototype.
export interface OsrmRoute {
  coords: [number, number][]; // [lat, lng] pairs
  distanceKm: number;
  durationMin: number;
}

export async function fetchOsrmRoute(
  from: [number, number],
  to: [number, number]
): Promise<OsrmRoute | null> {
  const [flat, flng] = from;
  const [tlat, tlng] = to;
  const url = `https://router.project-osrm.org/route/v1/driving/${flng},${flat};${tlng},${tlat}?overview=full&geometries=geojson`;
  try {
    const res = await fetch(url);
    const data = await res.json();
    const r0 = data?.routes?.[0];
    if (!r0) return null;
    const coords: [number, number][] = r0.geometry.coordinates.map(
      (c: [number, number]) => [c[1], c[0]]
    );
    return {
      coords,
      distanceKm: r0.distance / 1000,
      durationMin: r0.duration / 60,
    };
  } catch {
    return null;
  }
}
