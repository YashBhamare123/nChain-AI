-- Ride requests table
CREATE TYPE public.ride_status AS ENUM ('pending', 'accepted', 'in_progress', 'completed', 'cancelled');

CREATE TABLE public.ride_requests (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  rider_address TEXT NOT NULL,
  driver_address TEXT,
  pickup_label TEXT NOT NULL,
  pickup_lat DOUBLE PRECISION NOT NULL,
  pickup_lng DOUBLE PRECISION NOT NULL,
  dropoff_label TEXT NOT NULL,
  dropoff_lat DOUBLE PRECISION NOT NULL,
  dropoff_lng DOUBLE PRECISION NOT NULL,
  distance_km DOUBLE PRECISION NOT NULL,
  duration_min DOUBLE PRECISION NOT NULL,
  fare_eth DOUBLE PRECISION NOT NULL,
  ride_type TEXT NOT NULL DEFAULT 'solo',
  status public.ride_status NOT NULL DEFAULT 'pending',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.ride_requests ENABLE ROW LEVEL SECURITY;

-- Demo app uses wallet auth (not Supabase auth). Allow anon read/insert/update.
-- This is acceptable for a hackathon-style demo; not production-ready.
CREATE POLICY "Anyone can view ride requests"
  ON public.ride_requests FOR SELECT
  USING (true);

CREATE POLICY "Anyone can create ride requests"
  ON public.ride_requests FOR INSERT
  WITH CHECK (true);

CREATE POLICY "Anyone can update ride requests"
  ON public.ride_requests FOR UPDATE
  USING (true);

-- updated_at trigger
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public;

CREATE TRIGGER update_ride_requests_updated_at
  BEFORE UPDATE ON public.ride_requests
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Realtime
ALTER TABLE public.ride_requests REPLICA IDENTITY FULL;
ALTER PUBLICATION supabase_realtime ADD TABLE public.ride_requests;

CREATE INDEX idx_ride_requests_status ON public.ride_requests(status);
CREATE INDEX idx_ride_requests_rider ON public.ride_requests(rider_address);
CREATE INDEX idx_ride_requests_driver ON public.ride_requests(driver_address);