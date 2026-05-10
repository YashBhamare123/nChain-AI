-- Extend ride_status enum
ALTER TYPE public.ride_status ADD VALUE IF NOT EXISTS 'awaiting_pickup' BEFORE 'in_progress';

-- Add columns to ride_requests
ALTER TABLE public.ride_requests
  ADD COLUMN IF NOT EXISTS start_code TEXT,
  ADD COLUMN IF NOT EXISTS accepted_offer_id UUID,
  ADD COLUMN IF NOT EXISTS driver_lat DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS driver_lng DOUBLE PRECISION;

-- Offers table
CREATE TABLE IF NOT EXISTS public.ride_offers (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  ride_id UUID NOT NULL REFERENCES public.ride_requests(id) ON DELETE CASCADE,
  driver_address TEXT NOT NULL,
  eta_min DOUBLE PRECISION NOT NULL,
  counter_fare_eth DOUBLE PRECISION,
  driver_lat DOUBLE PRECISION,
  driver_lng DOUBLE PRECISION,
  status TEXT NOT NULL DEFAULT 'pending',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (ride_id, driver_address)
);

ALTER TABLE public.ride_offers ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can view offers" ON public.ride_offers FOR SELECT USING (true);
CREATE POLICY "Anyone can create offers" ON public.ride_offers FOR INSERT WITH CHECK (true);
CREATE POLICY "Anyone can update offers" ON public.ride_offers FOR UPDATE USING (true);

CREATE INDEX IF NOT EXISTS idx_ride_offers_ride ON public.ride_offers(ride_id);

-- Realtime
ALTER PUBLICATION supabase_realtime ADD TABLE public.ride_offers;
ALTER TABLE public.ride_offers REPLICA IDENTITY FULL;