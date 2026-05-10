import { useState, useRef, useEffect, useCallback } from "react";
import { MapPin, Loader2, X } from "lucide-react";
import { httpRequest, toUserFacingError } from "@/lib/api/http";
import { toast } from "sonner";

interface AutocompleteItem {
  placeId: string;
  description: string;
  mainText: string;
  secondaryText: string;
}

interface AutocompleteResponse {
  predictions: AutocompleteItem[];
}

interface PlaceDetailsResponse {
  placeId: string;
  name: string;
  formattedAddress: string;
  location: {
    lat: number;
    lng: number;
  };
}

interface LocationSearchProps {
  value: string;
  onChange: (text: string) => void;
  onSelect: (lat: number, lng: number, label: string) => void;
  placeholder?: string;
  icon?: React.ReactNode;
  userLat?: number | null;
  userLng?: number | null;
}

const LocationSearch = ({
  value,
  onChange,
  onSelect,
  placeholder = "Search location…",
}: LocationSearchProps) => {
  const [results, setResults] = useState<AutocompleteItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>();
  const containerRef = useRef<HTMLDivElement>(null);

  // Close on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const search = useCallback((query: string) => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (query.length < 3) {
      setResults([]);
      setOpen(false);
      setLoading(false);
      return;
    }
    setLoading(true);
    debounceRef.current = setTimeout(async () => {
      try {
        const data = await httpRequest<AutocompleteResponse>(
          `/maps/autocomplete?q=${encodeURIComponent(query)}`
        );
        setResults(data.predictions);
        setOpen(data.predictions.length > 0);
      } catch (err) {
        setResults([]);
        console.error("Autocomplete error:", err);
      } finally {
        setLoading(false);
      }
    }, 400);
  }, []);

  const handleSelect = async (place: AutocompleteItem) => {
    onChange(place.description);
    setOpen(false);
    setLoading(true);
    try {
      const details = await httpRequest<PlaceDetailsResponse>(
        `/maps/place/${place.placeId}`
      );
      onSelect(details.location.lat, details.location.lng, details.name || details.formattedAddress || place.description);
    } catch (err) {
      toast.error(toUserFacingError(err, "Failed to get location details"));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div ref={containerRef} className="relative flex-1">
      <div className="relative">
        <input
          value={value}
          onChange={(e) => {
            onChange(e.target.value);
            search(e.target.value);
          }}
          onFocus={() => results.length > 0 && setOpen(true)}
          placeholder={placeholder}
          className="w-full bg-secondary rounded-lg px-3 py-2.5 text-sm text-foreground placeholder:text-muted-foreground outline-none focus:ring-1 focus:ring-primary pr-8"
        />
        {loading ? (
          <Loader2 size={14} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground animate-spin" />
        ) : value.length > 0 ? (
          <button
            onClick={() => {
              onChange("");
              setResults([]);
              setOpen(false);
            }}
            className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
          >
            <X size={14} />
          </button>
        ) : null}
      </div>

      {open && (
        <div className="absolute z-[1000] top-full mt-1 w-full bg-card border border-border rounded-lg shadow-xl overflow-hidden max-h-60 overflow-y-auto">
          {results.map((r) => (
            <button
              key={r.placeId}
              onClick={() => handleSelect(r)}
              className="w-full flex items-start gap-2.5 px-3 py-2.5 hover:bg-secondary/80 transition-colors text-left"
            >
              <MapPin size={14} className="text-primary mt-0.5 shrink-0" />
              <div className="min-w-0">
                <p className="text-sm text-foreground truncate">{r.mainText || r.description}</p>
                <p className="text-xs text-muted-foreground truncate">{r.secondaryText}</p>
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
};

export default LocationSearch;
