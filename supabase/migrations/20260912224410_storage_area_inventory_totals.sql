SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

ALTER TABLE public.inventory_transactions
  ALTER COLUMN storage_area_id SET NOT NULL;

COMMENT ON COLUMN public.inventory_transactions.storage_area_id IS
  'Required storage area for every inventory movement. This keeps each area balance auditable and makes the location total the sum of its area balances.';

COMMENT ON TABLE public.inventory_item_storage_areas IS
  'Permitted storage areas for an inventory item at a location. An item may be assigned to multiple areas.';

COMMENT ON COLUMN public.location_inventory_items.default_storage_area_id IS
  'Optional default receiving area only. It does not limit the item to one storage area.';

COMMENT ON VIEW public.v_live_inventory IS
  'Current inventory balance by organization, location, storage area, and inventory item. Computed from the append-only inventory ledger.';

CREATE OR REPLACE VIEW public.v_location_live_inventory
WITH (security_invoker = true)
AS
SELECT
  organization_id,
  location_id,
  inventory_item_id,
  sum(quantity_base) AS quantity_base
FROM public.v_live_inventory
GROUP BY organization_id, location_id, inventory_item_id;

COMMENT ON VIEW public.v_location_live_inventory IS
  'Live inventory total for each item at a location. It is the sum of all storage-area balances and is updated by receipts, sales, waste, counts, and transfers recorded in the inventory ledger.';

REVOKE ALL ON public.v_location_live_inventory FROM PUBLIC, anon;
GRANT SELECT ON public.v_location_live_inventory TO authenticated, service_role;
;
