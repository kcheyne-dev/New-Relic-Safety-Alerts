-- The 9 NR offices, matching the prototype's hardcoded list.
INSERT INTO offices (id, name, country, region, address, lat, lng, headcount) VALUES
  ('SFO','San Francisco','USA','Americas','188 Spear St, San Francisco, CA 94105',37.7898,-122.3942,412),
  ('PDX','Portland','USA','Americas','111 SW 5th Ave, Portland, OR 97204',45.5152,-122.6784,188),
  ('ATL','Atlanta','USA','Americas','1100 Peachtree St NE, Atlanta, GA 30309',33.7837,-84.3833,262),
  ('BCN','Barcelona','Spain','EMEA','Carrer de Roc Boronat 78, 08005 Barcelona',41.3996,2.1944,142),
  ('DUB','Dublin','Ireland','EMEA','One Spencer Dock, North Wall Quay, Dublin 1',53.3470,-6.2486,217),
  ('LON','London','UK','EMEA','35 New Bridge St, London EC4V 6BW',51.5145,-0.1037,305),
  ('TYO','Tokyo','Japan','APAC','Yotsuya Tower, Shinjuku-ku, Tokyo',35.6762,139.6503,96),
  ('BLR','Bengaluru','India','APAC','Knowledge City, Bellandur, Bengaluru',12.9716,77.5946,512),
  ('HYD','Hyderabad','India','APAC','Salarpuria Sattva Knowledge City, Raidurg',17.4435,78.3772,484)
ON CONFLICT (id) DO UPDATE SET
  name = EXCLUDED.name,
  country = EXCLUDED.country,
  region = EXCLUDED.region,
  address = EXCLUDED.address,
  lat = EXCLUDED.lat,
  lng = EXCLUDED.lng,
  headcount = EXCLUDED.headcount;
