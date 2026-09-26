import dns from 'node:dns/promises';
dns.setDefaultResultOrder('ipv4first');

const UA = `LeadOutreachBot/0.1 (mirror-check; contact: ${process.env.OUTREACH_CONTACT ?? 'unset'})`;

const MIRRORS = [
  ['private.coffee', 'https://overpass.private.coffee/api/interpreter'],
  ['overpass-api.de', 'https://overpass-api.de/api/interpreter'],
  ['mail.ru', 'https://maps.mail.ru/osm/tools/overpass/api/interpreter'],
  ['maprva.org', 'https://overpass.maprva.org/api/interpreter'],
  ['osm.ch', 'https://overpass.osm.ch/api/interpreter'],
];

const BBOX = [51.370, -2.375, 51.392, -2.345];

const buildQuery = ({ areaId, bbox }) => {
  const [s, w, n, e] = bbox;
  const area = areaId ? `area(${areaId})->.a;\n` : '';
  const scope = areaId ? '(area.a)' : '';
  return `[out:json][timeout:25];
${area}(
  nwr["amenity"~"^(restaurant|cafe|bar|fast_food|pub)$"]["name"]${scope}(${s},${w},${n},${e});
  nwr["shop"~"^(bakery|hairdresser|beauty)$"]["name"]${scope}(${s},${w},${n},${e});
);
out tags center 500;`;
};

async function run(name, url, query, timeoutMs) {
  const t0 = Date.now();
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'User-Agent': UA, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: `data=${encodeURIComponent(query)}`,
      signal: AbortSignal.timeout(timeoutMs),
    });
    const text = await res.text();
    const ms = Date.now() - t0;
    let json;
    try { json = JSON.parse(text); } catch {
      return console.log(`   ${name.padEnd(16)} HTTP ${res.status} ${ms}ms  NON-JSON (${text.length}b): ${text.slice(0, 60).replace(/\s+/g, ' ')}`);
    }
    if (!Array.isArray(json.elements)) {
      return console.log(`   ${name.padEnd(16)} HTTP ${res.status} ${ms}ms  JSON but no elements  remark=${json.remark ?? '-'}`);
    }
    const ways = json.elements.filter((e) => e.type === 'way');
    const centered = ways.filter((e) => typeof e.center?.lat === 'number').length;
    const notes = [];
    if (json.remark) notes.push(`remark="${String(json.remark).slice(0, 60)}"`);
    const base = json.osm3s?.timestamp_osm_base;
    console.log(`   ${name.padEnd(16)} HTTP ${res.status} ${ms}ms  elements=${String(json.elements.length).padStart(4)} ways=${ways.length}/${centered}centered  base=${base ?? '-'} ${notes.join(' ')}`);
  } catch (e) {
    console.log(`   ${name.padEnd(16)} ${e.name} after ${Date.now() - t0}ms`);
  }
}

const AREA = 3605342409;
console.log(`\nReal production query, Bath England bbox ${BBOX.join(',')}  (area+bbox), 45s timeout\n`);
for (const [name, url] of MIRRORS) {
  await run(name, url, buildQuery({ areaId: AREA, bbox: BBOX }), 45000);
}

console.log('\nSame mirrors, bbox-only (no area filter)\n');
for (const [name, url] of MIRRORS) {
  await run(name, url, buildQuery({ areaId: null, bbox: BBOX }), 45000);
}

console.log('\nGlobal-coverage sanity check: New York bbox on the two fastest mirrors\n');
const NYC = [40.740, -73.995, 40.750, -73.980];
for (const name of ['maprva.org', 'private.coffee', 'mail.ru']) {
  const url = MIRRORS.find(([n]) => n === name)[1];
  await run(name, url, buildQuery({ areaId: null, bbox: NYC }), 45000);
}
