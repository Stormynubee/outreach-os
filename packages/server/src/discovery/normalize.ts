import { classifyTags, type SocialPlatform } from '@outreach/shared';
import { normalizeName, normalizeUrl } from '../lib/urls.ts';
import type { OverpassElement } from '../providers/overpass.ts';

export interface TagSocial {
  platform: SocialPlatform;
  url: string;
  handle: string | null;
  dedupeKey: string | null;
}

export interface NormalizedPoi {
  osmKey: string;
  osmType: string;
  osmId: number;
  name: string;
  nameNormalized: string;
  category: string;
  categoryLabel: string;
  lat: number | null;
  lon: number | null;
  countryCode: string | null;
  addressLine: string | null;
  street: string | null;
  houseNumber: string | null;
  city: string | null;
  postcode: string | null;
  state: string | null;
  website: string | null;
  websiteNormalized: ReturnType<typeof normalizeUrl>;
  phones: string[];
  emails: string[];
  socials: TagSocial[];
  osmTags: Record<string, string>;
}

/** OSM values are sometimes a semicolon-separated list; take each entry. */
function multi(value: string | undefined): string[] {
  if (!value) return [];
  return value
    .split(';')
    .map((v) => v.trim())
    .filter(Boolean);
}

function firstTag(tags: Record<string, string>, keys: string[]): string | null {
  for (const key of keys) {
    const value = tags[key];
    if (value && value.trim()) return value.trim();
  }
  return null;
}

const SOCIAL_TAG_KEYS: Array<[string[], SocialPlatform]> = [
  [['contact:instagram', 'instagram'], 'instagram'],
  [['contact:facebook', 'facebook'], 'facebook'],
  [['contact:tiktok', 'tiktok'], 'tiktok'],
  [['contact:twitter', 'twitter'], 'twitter'],
  [['contact:x', 'x'], 'twitter'],
  [['contact:youtube', 'youtube'], 'youtube'],
  [['contact:linkedin', 'linkedin'], 'linkedin'],
  [['contact:pinterest', 'pinterest'], 'pinterest'],
  [['contact:threads', 'threads'], 'threads'],
  [['contact:telegram', 'telegram'], 'telegram'],
  [['contact:whatsapp', 'whatsapp'], 'whatsapp'],
];

/** Lifecycle prefixes that mean the business is not operating here. */
const DEAD_TAG_PREFIXES = ['disused:', 'abandoned:', 'construction:', 'was:', 'demolished:', 'proposed:', 'razed:', 'removed:'];
/** Bare lifecycle keys, e.g. `disused=yes` with no colon. */
const DEAD_TAG_KEYS = ['disused', 'abandoned', 'construction', 'demolished', 'proposed', 'razed', 'removed'];

export function normalizePoi(el: OverpassElement): NormalizedPoi | null {
  const tags = el.tags ?? {};
  const name = tags.name?.trim();
  if (!name) return null;

  const starved =
    Object.keys(tags).some((k) => DEAD_TAG_PREFIXES.some((p) => k.startsWith(p))) ||
    DEAD_TAG_KEYS.some((k) => {
      const value = tags[k];
      return value !== undefined && !/^(no|false|0)$/i.test(value.trim());
    });
  const lifecycle = tags.lifecycle;
  if (starved || (lifecycle && /disused|abandoned|demolished|construction/i.test(lifecycle))) return null;

  const lat = typeof el.lat === 'number' ? el.lat : el.center?.lat ?? null;
  const lon = typeof el.lon === 'number' ? el.lon : el.center?.lon ?? null;

  const websiteRaw = firstTag(tags, ['contact:website', 'website', 'url', 'contact:url', 'website:en']);
  const websiteList = multi(websiteRaw ?? undefined);
  const website = websiteList[0] ?? null;
  const websiteNormalized = website ? normalizeUrl(website) : null;

  const phones = [
    ...multi(tags['contact:phone']),
    ...multi(tags.phone),
    ...multi(tags['contact:mobile']),
    ...multi(tags.mobile),
  ];

  const emails = [...multi(tags['contact:email']), ...multi(tags.email)];

  const socials: TagSocial[] = [];
  for (const [keys, platform] of SOCIAL_TAG_KEYS) {
    for (const raw of multi(firstTag(tags, keys) ?? undefined)) {
      const norm = normalizeUrl(raw);
      if (!norm) continue;
      socials.push({ platform, url: norm.url, handle: norm.handle, dedupeKey: norm.dedupeKey });
    }
  }

  const { key: category, label: categoryLabel } = classifyTags(tags);

  const street = tags['addr:street']?.trim() || null;
  const houseNumber = tags['addr:housenumber']?.trim() || null;
  const addressLine =
    [houseNumber, street].filter(Boolean).join(' ') || tags['addr:full']?.trim() || null;

  return {
    osmKey: `${el.type}/${el.id}`,
    osmType: el.type,
    osmId: el.id,
    name,
    nameNormalized: normalizeName(name),
    category,
    categoryLabel,
    lat,
    lon,
    countryCode: tags['addr:country']?.trim().toLowerCase() ?? null,
    addressLine,
    street,
    houseNumber,
    city: tags['addr:city']?.trim() || tags['addr:town']?.trim() || tags['addr:village']?.trim() || null,
    postcode: tags['addr:postcode']?.trim() || null,
    state: tags['addr:state']?.trim() || null,
    website,
    websiteNormalized,
    phones: [...new Set(phones)],
    emails: [...new Set(emails)],
    socials,
    osmTags: tags,
  };
}
