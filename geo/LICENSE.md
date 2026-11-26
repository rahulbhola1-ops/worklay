# Place names

The files in this folder list regions, cities and areas. They were built with
[scripts/build-geo.py](../scripts/build-geo.py) from:

- **GeoNames**, https://www.geonames.org, licensed under
  [Creative Commons Attribution 4.0](https://creativecommons.org/licenses/by/4.0/): administrative regions,
  populated places, city parts and postal places. Selected, cleaned and grouped by region and city.
- **OpenStreetMap**, for the countries whose `<CODE>.json` says `"osm": true`: names of suburbs, quarters,
  neighbourhoods and boroughs. © OpenStreetMap contributors. This data is available under the
  [Open Database License (ODbL) 1.0](https://opendatacommons.org/licenses/odbl/1-0/), see
  https://www.openstreetmap.org/copyright. Because these files combine it with other data, the files of those
  countries are a derivative database and are made available under the ODbL as well.
- A few hand-made lists (India, Singapore, Estonia), in [scripts/geo-handmade.json](../scripts/geo-handmade.json).

The website names both sources on every country page.
