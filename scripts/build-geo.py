"""Builds the places people choose from: geo/<CODE>.json (regions) and geo/<CODE>/<region>.json (cities -> areas).

Sources: GeoNames (https://www.geonames.org, CC BY 4.0) and, for the countries whose file is there, OpenStreetMap
(https://www.openstreetmap.org/copyright, ODbL; see geo/LICENSE.md). Usage:

  python -I scripts/build-geo.py <folder> [CODE ...]

<folder> holds admin1CodesASCII.txt, cities500.txt, full/all.zip (allCountries of the GeoNames dump),
postal/allCountries.txt (GeoNames postal codes) and osm/<CODE>.tsv (scripts/fetch-osm-areas.py).
Hand-made places (scripts/geo-handmade.json: India, Singapore, Estonia) are merged in, and so are the
hand-checked main areas of the big cities of every country (scripts/geo-main.json: {CODE: {city: [areas]}},
given to the largest city of that name in the country, and shown first in the order written).

A city is a populated place with at least 500 people. An area is a part of a city: a suburb, quarter or
neighbourhood, a postal locality, or a small place within the city's reach. Every area goes to the nearest
city, measured against the city's size.

India is handled more carefully, because its postal coordinates are only rough and villages crowd every city:
post offices go to a big city by PIN code (the first four digits of the city's head post office), villages
are left out, and offices named after a college, mill, bank or the like are dropped. Everywhere, a
"neighbourhood" that GeoNames also lists as a house or building at the same spot is dropped, and areas are
ordered main ones first: hand-made, then names that several sources agree on, then OpenStreetMap suburbs,
quarters and neighbourhoods, then the rest.

Every area is then checked against the postal codes: the town that the nearest postal code (within 3 km)
belongs to. If that is another city nearby, the area moves there; where postal towns are municipalities and a
small place has a postal town of its own, it is a separate place and not an area. Countries whose postal
coordinates are too rough for this are skipped (India is matched by PIN instead).
"""
import io, json, math, os, re, shutil, sys, unicodedata, zipfile

SRC = sys.argv[1]
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, 'geo')
ALL = ('AL AD AT BA BE BG CH CY CZ DE DK ES FI FR GB GR HR HU IE IS IT LI LT LU LV MC MD ME MK MT NL NO PL PT RO RS SE SI SK SM UA XK EE US CA AU IN SG '
       'AM AZ GE TR KZ KG TJ TM UZ AF PK BD LK NP BT MV MM TH LA KH VN MY ID PH BN TL JP KR MN TW IL JO LB IQ SY SA AE QA KW BH OM YE PS').split()
CODES = sys.argv[2:] or ALL
# Postal names that are real localities (elsewhere they are streets, buildings or companies).
POSTAL = set('IN AU JP ID LK PK BD MY PH CA TR GB LV HR AT SK CZ HU BG PL TH BE NL FI'.split())
REGION_LANGS = {
    'CH': {'fr': ['GE', 'JU', 'NE', 'VD'], 'fr de': ['FR', 'VS'], 'it': ['TI'], 'de fr': ['BE'], 'de it': ['GR']},
    'BE': {'fr nl': ['BRU'], 'fr de': ['WAL'], 'nl': ['VLG']},
    'CA': {'fr en': ['10'], 'en fr': ['04']},
    'IT': {'it de': ['17'], 'it fr': ['19']},
}
SKIP_TYPES = {'PPLX', 'PPLH', 'PPLQ', 'PPLW', 'PPLCH', 'STLMT'}
with open(os.path.join(ROOT, 'scripts', 'geo-handmade.json'), encoding='utf-8') as f:
    HAND = json.load(f)
with open(os.path.join(ROOT, 'scripts', 'geo-main.json'), encoding='utf-8') as f:
    MAIN = json.load(f)

def plain(s):
    return ''.join(c for c in unicodedata.normalize('NFKD', s) if not unicodedata.combining(c)).lower()

def slug(name):
    s = name
    for a, b in {'ß': 'ss', 'ø': 'o', 'Ø': 'O', 'ł': 'l', 'Ł': 'L', 'đ': 'd', 'Đ': 'D', 'æ': 'ae', 'ð': 'd', 'þ': 'th', 'ı': 'i', 'ə': 'a', 'ǝ': 'a', 'Ə': 'A', 'Ǝ': 'A'}.items():
        s = s.replace(a, b)
    return re.sub(r'[^a-z0-9]+', '-', unicodedata.normalize('NFKD', s).encode('ascii', 'ignore').decode().lower()).strip('-')

def clean(n):
    n = re.sub(r'\s*\([^)]*$', '', re.sub(r'\s*\(.*?\)\s*', ' ', n.replace('`', '’').replace("'", '’').replace('‘', '’')))
    return re.sub(r'\s+', ' ', n).strip(' .,-’')

# Same rule as VALID in countries.mjs, and at least one letter.
def ok(n):
    return 2 <= len(n) <= 45 and n[0].isalnum() and any(c.isalpha() for c in n) and all(c.isalnum() or unicodedata.category(c).startswith('M') or c in " .,'’()/&-" for c in n)

# Spelling-tolerant key for places written in Latin letters from another script (Swarup / Swaroop Nagar).
TRANSLIT = set('IN PK BD LK NP'.split())
def phon(s):
    s = re.sub(r'[^a-z0-9]', '', plain(s)).replace('oo', 'u').replace('ee', 'i').replace('w', 'v').replace('y', 'i')
    return re.sub(r'(.)\1+', r'\1', re.sub(r'([bcdgjkpt])h', r'\1', s))

# Indian post offices that are institutions, not localities.
NOT_PLACE = re.compile(r'\b(college|university|factory|mills?|exchange|sons|court|office|hospital|school|bank|refinery|plant|project|secretariat|medical|institute|depot|station|lines|industries|works|ltd|campus|command|btn|bn|barr\w*|regiment|signals?|ordnance|\w*mill|camp|air force|afs|depot)\b|^\d', re.I)
def acronym(n):
    w = n.split()
    return len(w) == 1 and (len(n) <= 3 or (n[0].lower() not in 'aeiou' and n[1].lower() not in 'aeiouhrlyw'))

want = set(CODES)
def lines(f):
    for line in f:
        yield line.rstrip('\n').split('\t')
def rows(*path):
    with open(os.path.join(SRC, *path), encoding='utf-8', newline='\n') as f:
        yield from lines(f)

regions = {c: {} for c in CODES}
for code, name, *_ in rows('admin1CodesASCII.txt'):
    cc, a1 = code.split('.', 1)
    if cc in want and name != 'Judea and Samaria Area':  # places there are listed under Palestine
        regions[cc][a1] = name

cities = {c: [] for c in CODES}
for r in rows('cities500.txt'):
    cc, n = r[8], clean(r[1])
    if cc in want and r[7] not in SKIP_TYPES and ok(n) and (r[10] in regions[cc] or cc == 'SG'):
        cities[cc].append({'n': n, 'a1': r[10], 'lat': float(r[4]), 'lon': float(r[5]), 'pop': int(r[14] or 0), 'areas': {},
                           'alt': {plain(x) for x in r[3].split(',') if x and x.isascii()}})

# Everything that may be an area: (lat, lon, name, kind, rank, source); kind 'part' is surely a part of a city,
# 'place' may be one; a lower rank is a more important area.
found = {c: [] for c in CODES}
spots = set()  # houses and buildings: (country, name, lat, lon)
spot = lambda cc, name, lat, lon: (cc, plain(name), round(lat, 2), round(lon, 2))
with zipfile.ZipFile(os.path.join(SRC, 'full', 'all.zip')) as z, io.TextIOWrapper(z.open('allCountries.txt'), encoding='utf-8', newline='\n') as f:
    for r in lines(f):
        if r[8] not in want:
            continue
        if r[6] == 'S' and r[7] in ('HSE', 'HSEC', 'BLDG'):
            spots.add(spot(r[8], clean(r[1]), float(r[4]), float(r[5])))
        elif r[6] != 'P':
            continue
        elif r[7] == 'PPLX':
            found[r[8]].append((float(r[4]), float(r[5]), clean(r[1]), 'part', 2, 'gn'))
        elif r[7] not in SKIP_TYPES and int(r[14] or 0) < 500 and r[8] != 'IN':  # Indian ones are villages
            found[r[8]].append((float(r[4]), float(r[5]), clean(r[1]), 'place', 4, 'gn'))
for cc in found:
    found[cc] = [x for x in found[cc] if spot(cc, x[2], x[0], x[1]) not in spots]
pins = []  # Indian post offices: (PIN, office name as written, name, lat, lon)
post = {c: {} for c in CODES}  # postal towns on a grid: (lat*20, lon*20) -> [(lat, lon, town key)]
for r in rows('postal', 'allCountries.txt'):
    cc = r[0]
    if cc not in want or len(r) < 11 or not r[9] or not r[10]:
        continue
    lat, lon = float(r[9]), float(r[10])
    post[cc].setdefault((int(lat * 20), int(lon * 20)), []).append((lat, lon, plain(clean(re.sub(r'\s+(\d+|cedex.*)$', '', r[2], flags=re.I)))))
    if cc not in POSTAL:
        continue
    if cc == 'IN':
        n = clean(re.sub(r'\s+(S\.?O|B\.?O|H\.?O|G\.?P\.?O|TSO)\.?$', '', r[2]))
        if not NOT_PLACE.search(n) and not acronym(n):
            pins.append((r[1], r[2], n, float(r[9]), float(r[10])))
        continue
    names = [r[2]]
    if cc == 'BG':
        names = [r[2].split(' / ')[-1]]
    elif cc == 'CA':
        m = re.search(r'\((.*)\)', r[2]); names = re.split(r' / |/', m.group(1)) if m else [r[2]]
    for n in names:
        n = clean(re.sub(r'\s+(S\.?O|B\.?O|H\.?O|G\.?P\.?O|TSO)\.?$', '', re.sub(r'\s+\d+$', '', n)))
        if cc == 'JP' and len(n) > 24:
            continue  # long names are buildings
        found[cc].append((float(r[9]), float(r[10]), n, 'place', 3, 'postal'))
with_osm = []
for cc in CODES:
    if not os.path.exists(os.path.join(SRC, 'osm', cc + '.tsv')):
        continue
    with_osm.append(cc)
    for r in list(rows('osm', cc + '.tsv'))[1:]:
        if len(r) < 6:
            continue
        name = next((clean(x) for x in (r[3], r[4], r[2]) if x and ok(clean(x))), '')
        try:
            if name: found[cc].append((float(r[0]), float(r[1]), name, 'part', {'suburb': 1, 'borough': 1, 'quarter': 2}.get(r[5].strip(), 3), 'osm'))
        except ValueError:
            pass

def reach(pop):  # km around the centre that still counts as the city
    return min(32, max(2.2, math.sqrt(max(pop, 500)) / 95))

for cc in CODES:
    hand = HAND.get(cc, {})
    grid, all_cities = {}, cities[cc]
    if cc == 'SG':  # one city-state: the towns are hand-made, GeoNames' "cities" are its parts
        for c in all_cities: found[cc].append((c['lat'], c['lon'], c['n'], 'part', 2, 'gn'))
        all_cities = []
    akey = phon if cc in TRANSLIT else plain
    def add(c, name, rank, src):
        k = akey(name)
        if k == c['akey']: return
        e = c['areas'].get(k)
        if not e: c['areas'][k] = [name, rank, {src}]
        else:
            e[2].add(src)
            if rank < e[1]: e[0], e[1] = name, rank
    for c in all_cities:
        c['r'], c['key'], c['akey'] = reach(c['pop']), plain(c['n']), akey(c['n'])
        grid.setdefault((int(c['lat'] * 4), int(c['lon'] * 4)), []).append(c)
    if cc == 'IN':  # post offices go to a big city when their PIN starts like the city's head post office
        heads = {}
        for pin, raw, n, lat, lon in pins:
            if re.search(r'\s(H\.?O|G\.?P\.?O)\.?$', raw): heads.setdefault(plain(n), []).append((pin, lat, lon))
        prefix = {}
        for c in sorted(all_cities, key=lambda c: -c['pop']):
            if c['pop'] < 300000: break
            for hn, offices in heads.items():
                if any(hn == x or hn.startswith(x + ' ') for x in {c['key']} | c['alt']):
                    for pin, lat, lon in offices:
                        if math.hypot((c['lat'] - lat) * 111.2, (c['lon'] - lon) * 111.2 * math.cos(math.radians(lat))) < 60:
                            prefix.setdefault(pin[:4], c)
        for pin, raw, n, lat, lon in pins:
            if pin[:4] in prefix and ok(n): add(prefix[pin[:4]], n, 3, 'postal')
        print('  PIN areas for', len({id(c) for c in prefix.values()}), 'big cities', flush=True)
    # Postal check, where postal points are precise enough (most of them at their own spot).
    pts = [x for v in post[cc].values() for x in v]
    check = cc not in POSTAL and cc != 'US' and len(pts) > 50 and len({(x[0], x[1]) for x in pts}) > 0.5 * len(pts)
    bykey = {}
    for c in all_cities: bykey.setdefault(c['key'], []).append(c)
    def postal_town(lat, lon, cos):
        near = []
        for gy in (int(lat * 20) - 1, int(lat * 20), int(lat * 20) + 1):
            for gx in (int(lon * 20) - 1, int(lon * 20), int(lon * 20) + 1):
                for plat, plon, town in post[cc].get((gy, gx), ()):
                    d = math.hypot((plat - lat) * 111.2, (plon - lon) * 111.2 * cos)
                    if d < 3: near.append((d, town))
        near.sort()
        # sure only when the nearest code is close and the next one names the same town
        return near[0][1] if near and near[0][0] < 2 and (len(near) == 1 or near[1][1] == near[0][1]) else None
    moved = dropped = 0
    for lat, lon, name, kind, rank, src in found[cc]:
        if cc in TRANSLIT and src == 'gn': rank = 4  # there these are mostly villages swallowed by the city
        if not ok(name):
            continue
        key, cos = plain(name), max(0.15, math.cos(math.radians(lat)))
        span, spanx, best = 2, int(math.ceil(37 / (111 * cos) * 4)), None
        for gy in range(int(lat * 4) - span, int(lat * 4) + span + 1):
            for gx in range(int(lon * 4) - spanx, int(lon * 4) + spanx + 1):
                for c in grid.get((gy, gx), ()):
                    d = math.hypot((c['lat'] - lat) * 111.2, (c['lon'] - lon) * 111.2 * cos) / c['r']
                    if kind == 'place' and (c['pop'] < 20000 or d > 0.8):
                        continue  # small places only count near larger cities
                    if d <= 1.15 and (best is None or d < best[0]):
                        best = (d, c)
        if best and check and src != 'postal':
            town = postal_town(lat, lon, cos)
            if town and town != best[1]['key']:
                was = best[1]['n']
                if town == key and kind == 'place' and cc not in POSTAL:
                    dropped += 1; continue  # a place with its own postal town is not part of a city
                near = [(math.hypot((c['lat'] - lat) * 111.2, (c['lon'] - lon) * 111.2 * cos), c) for c in bykey.get(town, ())]
                cur = best[1]
                near = [x for x in near if x[0] < 20 and math.hypot((x[1]['lat'] - cur['lat']) * 111.2, (x[1]['lon'] - cur['lon']) * 111.2 * cos) > cur['r']]  # never split a place off a city it lies in
                if near:
                    best = (0, min(near, key=lambda x: x[0])[1]); moved += 1
                    if os.environ.get('GEO_DEBUG') and moved % 40 == 1: print('   ', name, ':', was, '->', best[1]['n'], flush=True)
        if best:
            add(best[1], name, rank, src)
    if check: print('  postal check:', moved, 'moved,', dropped, 'not areas', flush=True)

    main, missing = {}, []  # city key -> (region code, areas)
    for city, areas in MAIN.get(cc, {}).items():
        kc = plain(city)
        c = max((c for c in all_cities if c['key'] == kc or kc in c['alt']), key=lambda c: (c['key'] == kc, c['pop']), default=None)
        if c: main[c['key']] = (c['a1'], areas)
        else: missing.append(city)
    if missing: print('  main areas: no such city', missing, flush=True)
    hand_regions = {plain(r['name']): r for r in hand.get('regions', [])}
    alias = {plain(k): plain(v) for k, v in hand.get('aliases', {}).items()}
    pairs = [(None, 'Estonia')] if cc == 'EE' else [] if cc == 'SG' else sorted(regions[cc].items(), key=lambda x: plain(x[1]))
    out, used, seen = [], set(), {}
    for a1, rname in pairs:
        k = alias.get(plain(rname), plain(rname)); h = hand_regions.get(k)
        if h: used.add(k)
        s = h['slug'] if h else (slug(rname) or (a1 or '').lower())
        seen[s] = seen.get(s, 0) + 1
        if seen[s] > 1: s = f'{s}-{seen[s]}'
        item = {'slug': s, 'name': h['name'] if h else rname}
        for langs, codes in REGION_LANGS.get(cc, {}).items():
            if a1 in codes: item['langs'] = langs.split()
        if h: item.update({f: h[f] for f in ('langs', 'group') if f in h})
        merged = {}
        for c in sorted((c for c in all_cities if a1 is None or c['a1'] == a1), key=lambda c: -c['pop']):
            if c['key'] in merged:
                for k2, v in c['areas'].items():
                    if k2 not in merged[c['key']]['areas']: merged[c['key']]['areas'][k2] = v
            else: merged[c['key']] = {'n': c['n'], 'areas': dict(c['areas'])}
        if h:
            for city, areas in reversed(list(h['cities'].items())):  # hand-made cities first, with their usual spelling
                kc = plain(city); e = merged.pop(kc, None) or {'n': city, 'areas': {}}
                got = dict(e['areas'])
                for i, a in enumerate(areas):
                    old = got.get(akey(a)); got[akey(a)] = [a, i - 500, (old[2] if old else set()) | {'hand'}]
                merged = {kc: {'n': city, 'areas': got}, **merged}
        for kc, (ra1, areas) in main.items():
            if (a1 is None or ra1 == a1) and kc in merged:
                got = merged[kc]['areas']
                for i, a in enumerate(areas):
                    old = got.get(akey(a))
                    got[akey(a)] = [a, i - 1000, (old[2] if old else set()) | {'hand'}]
        # Main areas first, in the order written; then a lower rank, one step up for every other source that agrees.
        order = lambda v: (('hand' not in v[2], v[1], '') if 'hand' in v[2] else (True, v[1] - min(len(v[2]), 3) + 1, plain(v[0])))
        out.append((item, {e['n']: [v[0] for v in sorted(e['areas'].values(), key=order)] for e in merged.values()}))
    for k, h in hand_regions.items():
        if k not in used:
            out.append(({f: h[f] for f in ('slug', 'name', 'langs', 'group') if f in h}, {c: list(a) for c, a in h['cities'].items()}))
    d = os.path.join(OUT, cc)
    shutil.rmtree(d, ignore_errors=True); os.makedirs(d, exist_ok=True)
    index = []
    for item, places in sorted(out, key=lambda x: plain(x[0]['name'])):
        index.append({**item, 'n': len(places)})
        with open(os.path.join(d, item['slug'] + '.json'), 'w', encoding='utf-8', newline='\n') as f:
            json.dump(places, f, ensure_ascii=False, separators=(',', ':'))
    with open(os.path.join(OUT, cc + '.json'), 'w', encoding='utf-8', newline='\n') as f:
        json.dump({'regions': index, **({'osm': True} if cc in with_osm else {})}, f, ensure_ascii=False, separators=(',', ':'))
    print(cc, len(index), 'regions', sum(len(p) for _, p in out), 'cities', sum(len(a) for _, p in out for a in p.values()), 'areas', '+osm' if cc in with_osm else '', flush=True)
