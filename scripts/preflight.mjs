const UA = `LeadOutreachBot/0.1 (preflight; contact: ${process.env.OUTREACH_CONTACT ?? 'unset-set-in-settings'})`;
const NEAR_LAT = 51.381, NEAR_LON = -2.359;
const BBOX = [51.370, -2.375, 51.392, -2.345];

const results = [];
const log = (name, ok, detail) => {
  results.push({ name, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `\n      ${detail}` : ''}`);
};

async function nominatim() {
  const url = new URL('https://nominatim.openstreetmap.org/search');
  url.search = new URLSearchParams({
    q: 'Bath, England', format: 'jsonv2', addressdetails: '1', limit: '1',
  }).toString();

  const t0 = Date.now();
  const res = await fetch(url, { headers: { 'User-Agent': UA, 'Accept-Language': 'en' } });
  const body = await res.text();
  const ms = Date.now() - t0;

  if (!res.ok) return log('nominatim responds', false, `HTTP ${res.status}: ${body.slice(0, 200)}`);

  let json;
  try { json = JSON.parse(body); } catch { return log('nominatim responds', false, 'not JSON'); }
  const hit = json[0];
  if (!hit) return log('nominatim responds', false, 'no results');

  const bb = (hit.boundingbox ?? []).map(Number);
  if (bb.length !== 4 || bb.some(Number.isNaN)) return log('nominatim returns bbox', false, JSON.stringify(hit.boundingbox));

  log('nominatim responds', true, `${ms}ms  ${hit.display_name}`);
  log('nominatim returns bbox', true, `s,w,n,e = [${bb.join(', ')}]  country=${hit.address?.country_code}`);
  log('nominatim returns osm ref', Boolean(hit.osm_type && hit.osm_id),
    `osm_type=${hit.osm_type} osm_id=${hit.osm_id} -> areaId=${hit.osm_type === 'relation' ? 3600000000 + Number(hit.osm_id) : 'n/a'}`);

  return { bbox: bb, osmType: hit.osm_type, osmId: Number(hit.osm_id), country: hit.address?.country_code };
}

function buildQuery({ areaId, bbox }) {
  const [s, w, n, e] = bbox;
  const area = areaId ? `area(${areaId})->.a;\n` : '';
  const scope = areaId ? '(area.a)' : '';
  return `[out:json][timeout:25];
${area}(
  nwr["amenity"~"^(restaurant|cafe|bar|fast_food|pub)$"]["name"]${scope}(${s},${w},${n},${e});
  nwr["shop"~"^(bakery|hairdresser|beauty)$"]["name"]${scope}(${s},${w},${n},${e});
);
out tags center 500;`;
}

const MIRRORS = [
  'https://overpass.private.coffee/api/interpreter',
  'https://overpass-api.de/api/interpreter',
];

async function overpass(label, mirror, query) {
  const t0 = Date.now();
  const res = await fetch(mirror, {
    method: 'POST',
    headers: { 'User-Agent': UA, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `data=${encodeURIComponent(query)}`,
  });
  const ms = Date.now() - t0;
  const text = await res.text();

  let json;
  try { json = JSON.parse(text); }
  catch { return log(`${label} @ ${new URL(mirror).host}`, false, `HTTP ${res.status}, body is not JSON: ${text.slice(0, 160)}`); }

  if (json.remark) log(`${label} incremental remark`, false, String(json.remark).slice(0, 160));
  if (!Array.isArray(json.elements)) return log(`${label} @ ${new URL(mirror).host}`, false, 'no elements array');

  const ways = json.elements.filter((e) => e.type === 'way');
  const waysWithCenter = ways.filter((e) => e.center && typeof e.center.lat === 'number');
  const named = json.elements.filter((e) => e.tags?.name).length;
  const withWeb = json.elements.filter((e) => e.tags?.website || e.tags?.['contact:website']).length;
  const withPhone = json.elements.filter((e) => e.tags?.phone || e.tags?.['contact:phone']).length;
  const withSocial = json.elements.filter((e) =>
    e.tags?.instagram || e.tags?.facebook || e.tags?.['contact:instagram'] || e.tags?.['contact:facebook']).length;

  log(`${label} @ ${new URL(mirror).host}`, true,
    `${ms}ms  elements=${json.elements.length} named=${named} osm_base=${json.osm3s?.timestamp_osm_base}`);

  return { count: json.elements.length, ways: ways.length, waysWithCenter: waysWithCenter.length, named, withWeb, withPhone, withSocial, ms };
}

console.log(`UA: ${UA}\nNode ${process.version}\n`);

const geo = await nominatim();
await new Promise((r) => setTimeout(r, 1200));

if (geo) {
  const areaId = geo.osmType === 'relation' ? 3600000000 + geo.osmId : null;

  const areaRun = await overpass('area+bbox', MIRRORS[0], buildQuery({ areaId, bbox: BBOX }));
  await new Promise((r) => setTimeout(r, 1500));
  const bboxRun = await overpass('bbox only', MIRRORS[0], buildQuery({ areaId: null, bbox: BBOX }));

  if (areaRun) {
    log('way elements carry center coords', areaRun.ways === 0 || areaRun.waysWithCenter === areaRun.ways,
      `ways=${areaRun.ways} withCenter=${areaRun.waysWithCenter} (out tags center must not drop coords)`);
    log('OSM tags already yield contacts', areaRun.withWeb + areaRun.withPhone + areaRun.withSocial > 0,
      `of ${areaRun.named} named: website=${areaRun.withWeb} phone=${areaRun.withPhone} social=${areaRun.withSocial}`);
  }
  if (areaRun && bboxRun) {
    log('area filter is safe to prefer', areaRun.count > 0,
      `area+bbox=${areaRun.count} vs bboxOnly=${bboxRun.count} (if area ever returns 0, bbox fallback is required)`);
  }

  await new Promise((r) => setTimeout(r, 1500));
  const dead = await overpass('bogus-area', MIRRORS[1], buildQuery({ areaId: 3600999999, bbox: BBOX }));
  if (dead) log('bogus area id returns 0 (fallback premise holds)', dead.count === 0, `count=${dead.count}`);
}

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
if (failed.length) {
  console.log('\nFailed:');
  for (const f of failed) console.log(`  - ${f.name}`);
  process.exitCode = 1;
}
