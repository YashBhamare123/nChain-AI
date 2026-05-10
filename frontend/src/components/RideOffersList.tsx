import { motion, AnimatePresence } from "framer-motion";
import { Clock, CheckCircle2, Loader2 } from "lucide-react";

export interface RideOffer {
  id: string;
  ride_id: string;
  driver_address: string;
  eta_min: number;
  counter_fare_eth: number | null;
  driver_lat: number | null;
  driver_lng: number | null;
  status: string;
  created_at: string;
}

interface Props {
  offers: RideOffer[];
  baseFareEth: number;
  onPick: (offer: RideOffer) => void;
  picking: string | null;
}

const RideOffersList = ({ offers, baseFareEth, onPick, picking }: Props) => {
  if (offers.length === 0) {
    return (
      <div className="text-center text-xs text-muted-foreground py-3">
        No offers yet. Drivers nearby will respond shortly…
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-2">
      <AnimatePresence initial={false}>
        {offers.map((o) => {
          const fare = o.counter_fare_eth ?? baseFareEth;
          return (
            <motion.div
              key={o.id}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              className="bg-secondary rounded-lg p-3"
            >
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-mono text-muted-foreground">
                  {o.driver_address.slice(0, 6)}…{o.driver_address.slice(-4)}
                </span>
                <span className="flex items-center gap-1 text-xs text-primary">
                  <Clock size={11} /> ETA {Math.round(o.eta_min)} min
                </span>
              </div>
              <div className="flex items-center justify-between">
                <div className="flex flex-col">
                  <span className="font-mono text-sm text-foreground">{fare.toFixed(4)} SepoliaETH</span>
                </div>
                <button
                  onClick={() => onPick(o)}
                  disabled={picking === o.id}
                  className="bg-gradient-primary text-primary-foreground px-3 py-1.5 rounded-lg text-xs font-semibold disabled:opacity-50 flex items-center gap-1.5"
                >
                  {picking === o.id ? <Loader2 size={12} className="animate-spin" /> : <CheckCircle2 size={12} />}
                  Pick driver
                </button>
              </div>
            </motion.div>
          );
        })}
      </AnimatePresence>
    </div>
  );
};

export default RideOffersList;
