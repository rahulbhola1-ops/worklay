"""Downloads suburbs, quarters, neighbourhoods and boroughs per country from OpenStreetMap (ODbL) through
the public Overpass API, one request at a time with pauses. Finished countries are skipped, so it can be
stopped and started again.

Usage: python -I scripts/fetch-osm-areas.py <folder> CODE [CODE ...]
"""
import os, sys, time, urllib.parse, urllib.request

OUT, CODES = sys.argv[1], sys.argv[2:]
SERVERS = ['https://overpass-api.de/api/interpreter', 'https://overpass.private.coffee/api/interpreter']
Q = ('[out:csv(::lat,::lon,name,"name:en","int_name",place;false;"\\t")][timeout:280];area["ISO3166-1"="%s"][boundary=administrative]->.a;'
     'nwr["place"~"^(suburb|quarter|neighbourhood|borough)$"]["name"](area.a);out center;')
os.makedirs(OUT, exist_ok=True)
for code in CODES:
    path = os.path.join(OUT, code + '.tsv')
    if os.path.exists(path): continue
    for attempt in range(8):
        url = SERVERS[attempt % len(SERVERS)]
        try:
            req = urllib.request.Request(url, urllib.parse.urlencode({'data': Q % code}).encode(), {'User-Agent': 'geo-build/1.0'})
            with urllib.request.urlopen(req, timeout=320) as r: body = r.read().decode('utf-8')
            if body.lstrip().startswith('<') or 'runtime error' in body[:400].lower() or '502 Gateway' in body[:200] or 'at capacity' in body[:400]: raise RuntimeError(body[:120].replace('\n', ' '))
            with open(path, 'w', encoding='utf-8', newline='\n') as f: f.write(body)
            print(code, body.count('\n'), flush=True)
            time.sleep(4)
            break
        except Exception as e:
            print(code, 'try', attempt + 1, str(e)[:120], flush=True)
            time.sleep(15 + 15 * attempt)
    else:
        print(code, 'FAILED', flush=True)
print('done', flush=True)
