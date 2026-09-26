export interface Migration {
  version: number;
  name: string;
  up: string;
}

export const MIGRATIONS: Migration[] = [
  {
    version: 1,
    name: 'core schema',
    up: `
-- ---------------------------------------------------------------- settings
CREATE TABLE settings (
  key        TEXT PRIMARY KEY,
  value      TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);

-- ---------------------------------------------------------------- geo cache
-- One row per distinct location string. Nominatim's policy forbids bulk geocoding
-- and requires caching, so a location string is geocoded at most once, ever.
CREATE TABLE geocode_cache (
  location_key  TEXT PRIMARY KEY,
  location_text TEXT NOT NULL,
  display_name  TEXT,
  country_code  TEXT,
  lat REAL, lon REAL,
  bbox_south REAL, bbox_west REAL, bbox_north REAL, bbox_east REAL,
  osm_type TEXT, osm_id INTEGER, area_id INTEGER,
  osm_category TEXT,
  fetched_at INTEGER NOT NULL,
  fetch_state TEXT NOT NULL DEFAULT 'ok',
  error TEXT
);

-- ---------------------------------------------------------------- discovery
CREATE TABLE discovery_query (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  location_text TEXT NOT NULL,
  location_key  TEXT NOT NULL,
  display_name  TEXT,
  country_code  TEXT,
  bbox_south REAL, bbox_west REAL, bbox_north REAL, bbox_east REAL,
  area_id INTEGER,
  categories TEXT NOT NULL DEFAULT '[]',
  keyword TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  tiles_total INTEGER NOT NULL DEFAULT 0,
  tiles_done  INTEGER NOT NULL DEFAULT 0,
  pois_found  INTEGER NOT NULL DEFAULT 0,
  used_area_filter INTEGER NOT NULL DEFAULT 0,
  coverage_verified INTEGER NOT NULL DEFAULT 0,
  mirror TEXT,
  osm_base TEXT,
  error TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX idx_dq_created ON discovery_query(created_at DESC);
CREATE INDEX idx_dq_location ON discovery_query(location_key);

CREATE TABLE discovery_tile (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  query_id INTEGER NOT NULL REFERENCES discovery_query(id) ON DELETE CASCADE,
  tile_index INTEGER NOT NULL,
  depth INTEGER NOT NULL DEFAULT 0,
  south REAL NOT NULL, west REAL NOT NULL, north REAL NOT NULL, east REAL NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  overpass_mirror TEXT,
  attempts INTEGER NOT NULL DEFAULT 0,
  element_count INTEGER NOT NULL DEFAULT 0,
  duration_ms INTEGER,
  used_area_filter INTEGER NOT NULL DEFAULT 0,
  error TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE UNIQUE INDEX uq_tile ON discovery_tile(query_id, tile_index);
CREATE INDEX idx_tile_status ON discovery_tile(query_id, status);

-- ---------------------------------------------------------------- business
CREATE TABLE business (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  osm_key TEXT NOT NULL,
  osm_type TEXT NOT NULL,
  osm_id INTEGER NOT NULL,
  name TEXT NOT NULL,
  name_normalized TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT 'other',
  category_label TEXT,
  osm_tags TEXT NOT NULL DEFAULT '{}',

  lat REAL, lon REAL,
  country_code TEXT,
  address_line TEXT, street TEXT, house_number TEXT, city TEXT, postcode TEXT, state TEXT,

  phone_raw TEXT, phone_e164 TEXT,
  email TEXT COLLATE NOCASE,
  email_state TEXT NOT NULL DEFAULT 'unknown',

  website_url TEXT,
  website_domain TEXT COLLATE NOCASE,
  dedupe_key TEXT COLLATE NOCASE,
  site_state TEXT NOT NULL DEFAULT 'unknown',
  http_status INTEGER,
  final_url TEXT,
  has_website INTEGER NOT NULL DEFAULT 0,
  has_ssl INTEGER NOT NULL DEFAULT 0,
  platform TEXT,
  has_video INTEGER NOT NULL DEFAULT 0,
  parking_evidence TEXT NOT NULL DEFAULT '[]',
  site_title TEXT,

  enrichment_stage TEXT NOT NULL DEFAULT 'none',
  enrichment_state TEXT NOT NULL DEFAULT 'pending',
  last_error_stage TEXT,
  last_error TEXT,
  next_retry_at INTEGER,
  enriched_at INTEGER,

  score INTEGER NOT NULL DEFAULT 0,
  score_version INTEGER NOT NULL DEFAULT 1,
  score_reasons TEXT NOT NULL DEFAULT '[]',
  scored_at INTEGER,
  confidence_factor REAL NOT NULL DEFAULT 0.7,

  has_phone INTEGER NOT NULL DEFAULT 0,
  has_email INTEGER NOT NULL DEFAULT 0,
  has_social INTEGER NOT NULL DEFAULT 0,
  social_magnitude_tier TEXT NOT NULL DEFAULT 'unknown',
  followers_known INTEGER NOT NULL DEFAULT 0,
  followers_total INTEGER,
  video_platforms INTEGER NOT NULL DEFAULT 0,

  pipeline_stage TEXT NOT NULL DEFAULT 'new',
  assignee TEXT,
  notes TEXT,

  first_seen_at INTEGER NOT NULL,
  last_seen_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE UNIQUE INDEX uq_business_osm_key ON business(osm_key);
-- Deliberately NOT unique: franchises share domains and free-host subdomains are
-- separate businesses. A unique index here would silently merge real leads.
CREATE INDEX idx_business_dedupe ON business(dedupe_key);
CREATE INDEX idx_business_feed ON business(category, has_website, score DESC);
CREATE INDEX idx_business_score ON business(score DESC);
CREATE INDEX idx_business_geo ON business(lat, lon);
CREATE INDEX idx_business_pipeline ON business(pipeline_stage, score DESC);
CREATE INDEX idx_business_retry ON business(enrichment_state, next_retry_at);
CREATE INDEX idx_business_domain ON business(website_domain);
CREATE INDEX idx_business_name_norm ON business(name_normalized);
CREATE INDEX idx_business_country ON business(country_code, score DESC);

CREATE TABLE business_discovery (
  business_id INTEGER NOT NULL REFERENCES business(id) ON DELETE CASCADE,
  discovery_query_id INTEGER NOT NULL REFERENCES discovery_query(id) ON DELETE CASCADE,
  first_seen_at INTEGER NOT NULL,
  PRIMARY KEY (business_id, discovery_query_id)
);
CREATE INDEX idx_bd_query ON business_discovery(discovery_query_id);

CREATE TABLE business_phone (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  business_id INTEGER NOT NULL REFERENCES business(id) ON DELETE CASCADE,
  raw TEXT NOT NULL,
  e164 TEXT,
  is_whatsapp INTEGER NOT NULL DEFAULT 0,
  is_mobile INTEGER NOT NULL DEFAULT 0,
  extension TEXT,
  source TEXT NOT NULL,
  source_url TEXT,
  confidence REAL NOT NULL DEFAULT 0.5,
  reject_reason TEXT,
  created_at INTEGER NOT NULL
);
CREATE UNIQUE INDEX uq_phone_e164 ON business_phone(business_id, e164) WHERE e164 IS NOT NULL;
CREATE INDEX idx_phone_business ON business_phone(business_id);

CREATE TABLE business_email (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  business_id INTEGER NOT NULL REFERENCES business(id) ON DELETE CASCADE,
  address TEXT NOT NULL COLLATE NOCASE,
  domain TEXT COLLATE NOCASE,
  kind TEXT NOT NULL DEFAULT 'role',
  source TEXT NOT NULL,
  source_url TEXT,
  confidence REAL NOT NULL DEFAULT 0.5,
  created_at INTEGER NOT NULL
);
CREATE UNIQUE INDEX uq_email_address ON business_email(business_id, address);
CREATE INDEX idx_email_business ON business_email(business_id);

CREATE TABLE social_account (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  business_id INTEGER NOT NULL REFERENCES business(id) ON DELETE CASCADE,
  platform TEXT NOT NULL,
  url TEXT NOT NULL,
  handle TEXT,
  handle_normalized TEXT NOT NULL DEFAULT '',
  profile_id TEXT,
  followers INTEGER,
  followers_state TEXT NOT NULL DEFAULT 'not_attempted',
  followers_reason TEXT,
  followers_source TEXT,
  manual_override INTEGER,
  manual_override_at INTEGER,
  has_video INTEGER NOT NULL DEFAULT 0,
  last_checked_at INTEGER,
  check_status TEXT,
  discovery_source TEXT NOT NULL DEFAULT 'site',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE UNIQUE INDEX uq_social ON social_account(business_id, platform, handle_normalized);
CREATE INDEX idx_social_platform ON social_account(platform, followers_state);
CREATE INDEX idx_social_handle ON social_account(platform, handle_normalized);

-- Search index. Maintained explicitly on the upsert path rather than by triggers:
-- an external-content fts5 table would need an AFTER UPDATE trigger that fires on
-- every score write, thrashing the index during bulk rescores.
CREATE VIRTUAL TABLE business_fts USING fts5(
  name, address_line, tokenize='unicode61 remove_diacritics 2'
);

-- ---------------------------------------------------------------- crm
CREATE TABLE outreach_task (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  business_id INTEGER REFERENCES business(id) ON DELETE SET NULL,
  title TEXT NOT NULL,
  note TEXT,
  due_date TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open',
  channel TEXT,
  position INTEGER NOT NULL DEFAULT 0,
  done_at INTEGER,
  snooze_until INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX idx_task_open_due ON outreach_task(due_date) WHERE status = 'open';
CREATE INDEX idx_task_due_status ON outreach_task(due_date, status);
CREATE INDEX idx_task_business ON outreach_task(business_id);
CREATE INDEX idx_task_done_at ON outreach_task(done_at) WHERE done_at IS NOT NULL;

CREATE TABLE pipeline_event (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  business_id INTEGER NOT NULL REFERENCES business(id) ON DELETE CASCADE,
  from_stage TEXT,
  to_stage TEXT NOT NULL,
  note TEXT,
  at INTEGER NOT NULL
);
CREATE INDEX idx_pipe_business ON pipeline_event(business_id, at);

CREATE TABLE activity_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  kind TEXT NOT NULL,
  business_id INTEGER,
  task_id INTEGER,
  at INTEGER NOT NULL,
  day TEXT NOT NULL,
  meta TEXT NOT NULL DEFAULT '{}'
);
CREATE INDEX idx_activity_kind_at ON activity_log(kind, at);
CREATE INDEX idx_activity_day ON activity_log(day);
CREATE INDEX idx_activity_at ON activity_log(at DESC);

CREATE TABLE daily_stat (
  day TEXT PRIMARY KEY,
  tasks_created INTEGER NOT NULL DEFAULT 0,
  tasks_done INTEGER NOT NULL DEFAULT 0,
  businesses_added INTEGER NOT NULL DEFAULT 0,
  contacted INTEGER NOT NULL DEFAULT 0,
  replied INTEGER NOT NULL DEFAULT 0,
  won INTEGER NOT NULL DEFAULT 0,
  lost INTEGER NOT NULL DEFAULT 0,
  leads_found INTEGER NOT NULL DEFAULT 0
);

-- ---------------------------------------------------------------- http cache
CREATE TABLE http_cache (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  url_key TEXT NOT NULL,
  domain TEXT NOT NULL COLLATE NOCASE,
  kind TEXT NOT NULL DEFAULT 'page',
  status_code INTEGER,
  final_url TEXT,
  content_type TEXT,
  size_bytes INTEGER,
  etag TEXT,
  last_modified TEXT,
  fetch_state TEXT NOT NULL DEFAULT 'ok',
  error_kind TEXT,
  attempts INTEGER NOT NULL DEFAULT 0,
  fetched_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  ttl_seconds INTEGER NOT NULL
);
CREATE UNIQUE INDEX uq_http_url ON http_cache(url_key);
CREATE INDEX idx_http_expires ON http_cache(expires_at);
CREATE INDEX idx_http_domain ON http_cache(domain, fetched_at);

-- Bodies are separate so metadata scans never drag blobs through the page cache,
-- and so thousands of cache entries are not thousands of files on disk.
CREATE TABLE http_body (
  http_cache_id INTEGER PRIMARY KEY REFERENCES http_cache(id) ON DELETE CASCADE,
  body_gz BLOB
);

CREATE TABLE robots_cache (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  domain TEXT NOT NULL COLLATE NOCASE,
  fetched_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  status_code INTEGER,
  fetch_state TEXT NOT NULL DEFAULT 'ok',
  crawl_delay_ms INTEGER,
  sitemaps TEXT NOT NULL DEFAULT '[]',
  rules TEXT NOT NULL DEFAULT '[]'
);
CREATE UNIQUE INDEX uq_robots_domain ON robots_cache(domain);

-- ---------------------------------------------------------------- job queue
CREATE TABLE job (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  type TEXT NOT NULL,
  payload TEXT NOT NULL DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'queued',
  priority INTEGER NOT NULL DEFAULT 5,
  run_at INTEGER NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  max_attempts INTEGER NOT NULL DEFAULT 3,
  last_error TEXT,
  locked_at INTEGER,
  locked_by TEXT,
  dedupe_key TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE UNIQUE INDEX uq_job_dedupe ON job(dedupe_key) WHERE dedupe_key IS NOT NULL;
CREATE INDEX idx_job_queue ON job(run_at, priority) WHERE status = 'queued';
CREATE INDEX idx_job_stale ON job(status, locked_at);
CREATE INDEX idx_job_type ON job(type, status);

-- ---------------------------------------------------------------- duplicates
-- Read-only. Never auto-merges: a wrong merge destroys a real lead, so a human decides.
CREATE VIEW possible_duplicate AS
SELECT
  a.id AS business_a,
  b.id AS business_b,
  CASE
    WHEN a.dedupe_key IS NOT NULL AND a.dedupe_key = b.dedupe_key THEN 'same_domain'
    ELSE 'same_name_nearby'
  END AS reason,
  a.name AS name_a,
  b.name AS name_b,
  a.website_domain AS domain_a,
  b.website_domain AS domain_b,
  a.score AS score_a,
  b.score AS score_b
FROM business a
JOIN business b
  ON a.id < b.id
 AND (
      (a.dedupe_key IS NOT NULL AND a.dedupe_key = b.dedupe_key)
   OR (a.name_normalized = b.name_normalized
       AND a.lat IS NOT NULL AND b.lat IS NOT NULL
       AND ABS(a.lat - b.lat) < 0.0005
       AND ABS(a.lon - b.lon) < 0.0005)
 );
`,
  },
];
