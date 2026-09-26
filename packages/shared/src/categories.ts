export interface TagSelector {
  key: string;
  values: string[];
}

export interface Category {
  key: string;
  label: string;
  emoji: string;
  selectors: TagSelector[];
}

/**
 * OSM tag mappings for the business categories a salesperson actually sells to.
 * Values are real OSM tag values (verified against the wiki), not invented ones.
 */
export const CATEGORIES: Category[] = [
  {
    key: 'food_drink',
    label: 'Food & drink',
    emoji: '🍽️',
    selectors: [
      { key: 'amenity', values: ['restaurant', 'cafe', 'bar', 'pub', 'fast_food', 'ice_cream', 'food_court', 'biergarten'] },
      { key: 'shop', values: ['bakery', 'butcher', 'greengrocer', 'cheese', 'confectionery', 'coffee', 'deli', 'seafood', 'wine', 'pastry'] },
    ],
  },
  {
    key: 'health_beauty',
    label: 'Health & beauty',
    emoji: '💆',
    selectors: [
      { key: 'amenity', values: ['dentist', 'doctors', 'clinic', 'pharmacy', 'veterinary'] },
      { key: 'shop', values: ['hairdresser', 'beauty', 'massage', 'tattoo', 'nails', 'optician', 'hearing_aids', 'cosmetics', 'perfumery'] },
      { key: 'healthcare', values: ['chiropractor', 'physiotherapist', 'optometrist', 'podiatrist', 'psychotherapist', 'alternative', 'midwife', 'occupational_therapist', 'speech_therapist'] },
    ],
  },
  {
    key: 'trades',
    label: 'Trades & home',
    emoji: '🔧',
    selectors: [
      { key: 'craft', values: ['plumber', 'carpenter', 'electrician', 'hvac', 'roofer', 'painter', 'builder', 'gardener', 'locksmith', 'window_construction', 'tiler', 'joiner', 'metal_construction', 'glaziery', 'blacksmith', 'plasterer', 'stonemason'] },
      { key: 'shop', values: ['doityourself', 'hardware', 'trade', 'flooring', 'paint', 'kitchen', 'bathroom_furnishing', 'fireplace', 'garden_centre'] },
    ],
  },
  {
    key: 'retail',
    label: 'Retail',
    emoji: '🛍️',
    selectors: [
      { key: 'shop', values: ['clothes', 'shoes', 'furniture', 'florist', 'jewelry', 'electronics', 'pet', 'toys', 'bicycle', 'gift', 'books', 'convenience', 'mobile_phone', 'sports', 'antiques', 'art', 'musical_instrument', 'photo', 'stationery', 'bag', 'boutique', 'fabric', 'houseware', 'interior_decoration', 'leather', 'optician', 'second_hand', 'variety_store', 'watches'] },
    ],
  },
  {
    key: 'hospitality',
    label: 'Hotels & tourism',
    emoji: '🛎️',
    selectors: [
      { key: 'tourism', values: ['hotel', 'guest_house', 'apartment', 'hostel', 'bed_and_breakfast', 'motel', 'chalet', 'camp_site', 'caravan_site', 'holiday_park'] },
      { key: 'leisure', values: ['spa'] },
      { key: 'amenity', values: ['events_venue', 'nightclub'] },
    ],
  },
  {
    key: 'professional',
    label: 'Professional services',
    emoji: '💼',
    selectors: [
      { key: 'office', values: ['lawyer', 'accountant', 'estate_agent', 'insurance', 'financial', 'financial_advisor', 'advertising_agency', 'it', 'company', 'consulting', 'architect', 'employment_agency', 'tax_advisor', 'travel_agent', 'surveyor', 'engineer', 'notary', 'educational_institution', 'research', 'estate_agent'] },
    ],
  },
  {
    key: 'fitness',
    label: 'Fitness & leisure',
    emoji: '🏋️',
    selectors: [
      { key: 'leisure', values: ['fitness_centre', 'sports_centre', 'dance', 'swimming_pool', 'golf_course', 'bowling_alley', 'climbing', 'horse_riding', 'ice_rink', 'miniature_golf', 'trampoline_park', 'water_park'] },
      { key: 'amenity', values: ['gym', 'dojo', 'dive_centre'] },
    ],
  },
  {
    key: 'auto',
    label: 'Auto & vehicles',
    emoji: '🚗',
    selectors: [
      { key: 'shop', values: ['car_repair', 'tyres', 'car_parts', 'car', 'motorcycle_repair', 'motorcycle', 'caravan', 'truck_repair', 'bicycle_repair'] },
      { key: 'amenity', values: ['car_wash', 'car_rental', 'driving_school', 'motorcycle_rental', 'vehicle_inspection'] },
    ],
  },
  {
    key: 'creative',
    label: 'Media & creative',
    emoji: '🎬',
    selectors: [
      { key: 'craft', values: ['photographer', 'photographic_laboratory', 'sign_maker', 'printer', 'bookbinder', 'engraver'] },
      { key: 'shop', values: ['photo', 'video', 'music', 'camera', 'frame', 'copyshop'] },
      { key: 'amenity', values: ['studio', 'cinema', 'theatre', 'arts_centre', 'recording_studio'] },
      { key: 'office', values: ['advertising_agency', 'graphic_design', 'newspaper', 'radio', 'television'] },
    ],
  },
];

export const CATEGORY_KEYS = CATEGORIES.map((c) => c.key);

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Overpass POSIX-ERE alternation for one selector, anchored to avoid substring matches. */
export function selectorRegex(values: string[]): string {
  return `^(${values.map(escapeRe).join('|')})$`;
}

export function categoriesFor(keys: string[]): Category[] {
  if (!keys.length || keys.includes('all')) return CATEGORIES;
  const wanted = new Set(keys);
  const picked = CATEGORIES.filter((c) => wanted.has(c.key));
  return picked.length ? picked : CATEGORIES;
}

/** Which category a discovered POI belongs to, by the first selector that matches its tags. */
export function classifyTags(tags: Record<string, string>): { key: string; label: string } {
  for (const cat of CATEGORIES) {
    for (const sel of cat.selectors) {
      const v = tags[sel.key];
      if (v && sel.values.includes(v.split(';')[0]!.trim())) return { key: cat.key, label: cat.label };
    }
  }
  return { key: 'other', label: 'Other' };
}

/** Deduplicate selectors that repeat across categories (e.g. advertising_agency). */
export function mergeSelectors(categories: Category[]): TagSelector[] {
  const byKey = new Map<string, Set<string>>();
  for (const cat of categories) {
    for (const sel of cat.selectors) {
      const set = byKey.get(sel.key) ?? new Set<string>();
      for (const v of sel.values) set.add(v);
      byKey.set(sel.key, set);
    }
  }
  return [...byKey.entries()].map(([key, values]) => ({ key, values: [...values] }));
}
