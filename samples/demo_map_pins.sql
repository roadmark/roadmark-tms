-- Sample map pins so the Live map has content before Roadmark is connected.
-- Global directory rows (company_id null) imitate what the Roadmark sync will bring in;
-- the company pins are the kind your own team drops.
-- Run once in the SQL Editor after migration 016.

insert into map_places (company_id, source, external_id, kind, name, lat, lng, address, city, state, phone, rating, reviews_count, services)
values
 (null,'roadmark','rm-1','repair_shop','I-80 Truck & Trailer Repair',41.5250,-88.0817,'2100 Rte 30','Joliet','IL','(815) 555-0133',4.6,128,'{engine,brakes,electrical}'),
 (null,'roadmark','rm-2','repair_shop','Midwest Diesel Service',39.7684,-86.1581,'4400 W Washington St','Indianapolis','IN','(317) 555-0144',4.3,86,'{engine,aftertreatment}'),
 (null,'roadmark','rm-3','repair_shop','Southern Fleet Care',33.7490,-84.3880,'1890 Fulton Industrial','Atlanta','GA','(404) 555-0175',4.1,54,'{brakes,tires}'),
 (null,'roadmark','rm-4','tire_shop','Interstate Tire Center',35.1495,-90.0490,'3120 Airways Blvd','Memphis','TN','(901) 555-0121',4.7,203,'{tires,roadservice}'),
 (null,'roadmark','rm-5','tire_shop','Great Plains Tire',39.0997,-94.5786,'5500 Front St','Kansas City','MO','(816) 555-0166',4.2,71,'{tires}'),
 (null,'roadmark','rm-6','towing','Heavy Haul Recovery',41.8781,-87.6298,'8800 S Cicero Ave','Chicago','IL','(312) 555-0199',4.0,44,'{towing,recovery}'),
 (null,'roadmark','rm-7','dealer','Freightliner of Dallas',32.7767,-96.7970,'2600 Irving Blvd','Dallas','TX','(214) 555-0188',4.4,159,'{parts,warranty}'),
 (null,'roadmark','rm-8','dealer','Volvo Trucks Columbus',39.9612,-82.9988,'3200 Alum Creek Dr','Columbus','OH','(614) 555-0112',4.5,97,'{parts,service}'),
 (null,'roadmark','rm-9','truck_stop','Pilot #442 Effingham',39.1200,-88.5434,'1702 W Fayette Ave','Effingham','IL','(217) 555-0102',4.1,412,'{fuel,parking,showers}'),
 (null,'roadmark','rm-10','truck_stop','Loves #219 Knoxville',35.9606,-83.9207,'6800 Strawberry Plains','Knoxville','TN','(865) 555-0143',4.3,388,'{fuel,parking,scales}'),
 (null,'roadmark','rm-11','parking','Secure Truck Parking — Gary',41.5934,-87.3464,'1500 Chase St','Gary','IN','(219) 555-0177',3.9,66,'{gated,lighting}'),
 (null,'roadmark','rm-12','parking','I-95 Overnight Lot',39.2904,-76.6122,'4400 Pulaski Hwy','Baltimore','MD',null,3.6,29,'{overnight}'),
 (null,'roadmark','rm-13','weigh_station','Ohio Turnpike Scale — Toledo',41.6528,-83.5379,'I-80 MM 59','Toledo','OH',null,null,null,null),
 (null,'roadmark','rm-14','weigh_station','I-65 Scale — Louisville',38.2527,-85.7585,'I-65 MM 120','Louisville','KY',null,null,null,null),
 (null,'roadmark','rm-15','mobile_repair','24/7 Mobile Diesel',36.1627,-86.7816,'Mobile — Nashville area','Nashville','TN','(615) 555-0190',4.8,52,'{mobile,roadservice}')
on conflict (source, external_id) do nothing;

-- a few pins the company dropped itself
do $$
declare cid uuid := '11111111-1111-1111-1111-111111111111'; trl uuid;
begin
  select id into trl from trailers where company_id = cid order by unit_number limit 1;
  insert into map_places (company_id, source, kind, name, lat, lng, city, state, note, trailer_id, expected_until)
  values
    (cid,'tms','dropped_trailer','Trailer dropped at Pilot #442', 39.1215, -88.5410, 'Effingham','IL',
     'Left in the back row near the fence. Keys with the fuel desk. Pick up Thursday.', trl, now() + interval '3 days'),
    (cid,'tms','yard','South Holland yard', 41.6006, -87.6070, 'South Holland','IL',
     'Main yard — 17201 State St. Gate code 4417.', null, null),
    (cid,'tms','customer_facility','Whitco Supply — dock 4', 39.9700, -82.0000, 'Barnesville','OH',
     'Check in at the guard shack, ask for Denise. No overnight parking on site.', null, null);
end $$;

select kind, count(*), case when company_id is null then 'directory' else 'ours' end as who
from map_places group by kind, who order by who, kind;
