SET LOCAL lock_timeout = '5s';
ALTER TABLE public.inventory_items ADD COLUMN yield_percent numeric(7,4);
ALTER TABLE public.inventory_items ADD CONSTRAINT inventory_items_yield_percent_check CHECK (yield_percent > 0 AND yield_percent <= 100);
COMMENT ON COLUMN public.inventory_items.yield_percent IS 'Usable ingredient yield as a percentage of the as-purchased quantity, after trimming, peeling, or draining. 85 means 85% usable. NULL means not yet specified. This is separate from package conversions and prepared recipe output yield; do not apply losses twice.';
;
