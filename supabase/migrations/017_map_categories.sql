-- 017_map_categories.sql — carry Roadmark's own grouping into the TMS map
--   shop_type 'chain'  → a truck-stop brand (Love's, TA/Petro, Southern Tire Mart…)
--   shop_type independent / mechanic / community → the ★ Recommended list

alter table map_places add column if not exists shop_type text;
alter table map_places add column if not exists brand text;
alter table map_places add column if not exists is_recommended boolean not null default false;

create index if not exists idx_places_brand on map_places(brand) where brand is not null;
create index if not exists idx_places_recommended on map_places(is_recommended) where is_recommended;

-- allow the truck_stop / cat_scale kinds used by the new grouping
alter table map_places drop constraint if exists map_places_kind_check;
alter table map_places add constraint map_places_kind_check check (kind in
  ('repair_shop','dealer','tire_shop','towing','mobile_repair','parking','truck_stop',
   'weigh_station','cat_scale','yard','customer_facility','dropped_trailer','dropped_truck',
   'fuel','hazard','other'));
