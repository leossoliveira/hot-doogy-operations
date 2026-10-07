
ALTER TABLE public.recipe_components ADD COLUMN component_type text NOT NULL DEFAULT 'ingredient'
CHECK (component_type IN ('ingredient','packaging'));
COMMENT ON COLUMN public.recipe_components.component_type IS 'Packaging is linked inventory with quantity and unit, excluded from food-cost markup and added at cost to suggested selling price.';
UPDATE public.recipe_components c SET component_type='packaging'
FROM public.inventory_items i JOIN public.inventory_categories cat ON cat.id=i.category_id
WHERE i.id=c.component_inventory_item_id AND lower(cat.name)='packaging';

CREATE VIEW public.recipe_packaging WITH (security_invoker=true) AS
SELECT * FROM public.recipe_components WHERE component_type='packaging'
WITH CASCADED CHECK OPTION;
CREATE VIEW public.recipe_ingredients WITH (security_invoker=true) AS
SELECT * FROM public.recipe_components WHERE component_type='ingredient'
WITH CASCADED CHECK OPTION;
GRANT SELECT ON public.recipe_packaging,public.recipe_ingredients TO authenticated;
GRANT ALL ON public.recipe_packaging,public.recipe_ingredients TO service_role;
REVOKE ALL ON public.recipe_packaging,public.recipe_ingredients FROM anon;

CREATE FUNCTION public.calculate_recipe_suggested_price(
p_ingredient_cost numeric,p_packaging_cost numeric,p_food_cost_percent numeric)
RETURNS TABLE(ingredient_cost numeric,packaging_cost numeric,total_cost numeric,food_cost_percent numeric,optimal_price numeric,suggested_selling_price numeric,gross_profit numeric)
LANGUAGE plpgsql IMMUTABLE SECURITY INVOKER SET search_path='' AS $$
BEGIN
IF p_ingredient_cost IS NULL OR p_packaging_cost IS NULL OR p_food_cost_percent IS NULL
OR p_ingredient_cost < 0 OR p_packaging_cost < 0 OR p_food_cost_percent <= 0 OR p_food_cost_percent > 100
OR p_ingredient_cost::text IN ('NaN','Infinity','-Infinity')
OR p_packaging_cost::text IN ('NaN','Infinity','-Infinity')
OR p_food_cost_percent::text IN ('NaN','Infinity','-Infinity')
THEN RAISE EXCEPTION 'Costs must be finite, nonnegative and known; food cost percent must be > 0 and <= 100'; END IF;
RETURN QUERY SELECT p_ingredient_cost,p_packaging_cost,p_ingredient_cost+p_packaging_cost,p_food_cost_percent,
round(p_ingredient_cost*100/p_food_cost_percent,2),
round(p_ingredient_cost*100/p_food_cost_percent+p_packaging_cost,2),
round(p_ingredient_cost*100/p_food_cost_percent+p_packaging_cost,2)-p_ingredient_cost-p_packaging_cost;
END $$;
REVOKE ALL ON FUNCTION public.calculate_recipe_suggested_price(numeric,numeric,numeric) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.calculate_recipe_suggested_price(numeric,numeric,numeric) TO authenticated,service_role;
COMMENT ON FUNCTION public.calculate_recipe_suggested_price(numeric,numeric,numeric) IS 'Pass per-product costs, with packaging costs separate (including packaging from prep recipes). Percent uses 25 for 25%. Packaging is passed through at cost, never marked up. Does not change menu selling prices.';

CREATE FUNCTION public.get_recipe_packaging_for_location(p_version_id uuid,p_location_id uuid)
RETURNS SETOF public.recipe_components LANGUAGE sql STABLE SECURITY INVOKER SET search_path='' AS $$
SELECT c.* FROM public.get_recipe_components_for_location(p_version_id,p_location_id) c WHERE c.component_type='packaging'
$$;
CREATE FUNCTION public.get_recipe_ingredients_for_location(p_version_id uuid,p_location_id uuid)
RETURNS SETOF public.recipe_components LANGUAGE sql STABLE SECURITY INVOKER SET search_path='' AS $$
SELECT c.* FROM public.get_recipe_components_for_location(p_version_id,p_location_id) c WHERE c.component_type='ingredient'
$$;
REVOKE ALL ON FUNCTION public.get_recipe_packaging_for_location(uuid,uuid), public.get_recipe_ingredients_for_location(uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_recipe_packaging_for_location(uuid,uuid), public.get_recipe_ingredients_for_location(uuid,uuid) TO authenticated,service_role;

;
