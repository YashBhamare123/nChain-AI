import { createContext, useContext, useState, useEffect, ReactNode } from "react";

interface LocationContextType {
  lat: number | null;
  lng: number | null;
  error: string | null;
  loading: boolean;
  requestLocation: () => void;
}

const LocationContext = createContext<LocationContextType>({
  lat: null,
  lng: null,
  error: null,
  loading: true,
  requestLocation: () => {},
});

export const useLocation = () => useContext(LocationContext);

export const LocationProvider = ({ children }: { children: ReactNode }) => {
  const [lat, setLat] = useState<number | null>(null);
  const [lng, setLng] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const requestLocation = () => {
    setLoading(true);
    setError(null);
    if (!navigator.geolocation) {
      setError("Geolocation not supported");
      setLoading(false);
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setLat(pos.coords.latitude);
        setLng(pos.coords.longitude);
        setLoading(false);
      },
      (err) => {
        setError(err.message);
        setLoading(false);
        // fallback to a default
        setLat(28.6139);
        setLng(77.2090);
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 30000 }
    );
  };

  useEffect(() => {
    requestLocation();
  }, []);

  return (
    <LocationContext.Provider value={{ lat, lng, error, loading, requestLocation }}>
      {children}
    </LocationContext.Provider>
  );
};
