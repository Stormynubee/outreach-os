import {
  BASE_SITE_POINTS,
  CONFIDENCE,
  CONTACT_CAP,
  CONTACT_POINTS,
  PRESENCE,
  type SiteState,
} from '@outreach/shared';

/**
 * The scoring SQL is generated from the same constants the TypeScript scorer uses,
 * so the numbers cannot drift. The test suite still asserts that the SQL arithmetic
 * (caps, rounding, clamping) matches scoreLead() exactly.
 *
 * The expression references these identifiers, which resolve either to `business`
 * columns (in an UPDATE) or to bound parameters aliased in a subselect (in tests):
 *   site_state, has_phone, has_email, has_social, social_magnitude_tier,
 *   website_probed, contacts_extracted, socials_checked
 * plus the named params :p_no_tag and :p_social_only for the per-preset values.
 */

const OVERRIDABLE: SiteState[] = ['no_tag', 'social_only'];

const siteCase = [
  `CASE site_state`,
  `WHEN 'no_tag' THEN :p_no_tag`,
  `WHEN 'social_only' THEN :p_social_only`,
  ...Object.entries(BASE_SITE_POINTS)
    .filter(([k]) => !OVERRIDABLE.includes(k as SiteState))
    .map(([k, v]) => `WHEN '${k}' THEN ${v}`),
  `ELSE ${BASE_SITE_POINTS.unknown} END`,
].join(' ');

const flag = (col: string, points: number) => `(CASE WHEN ${col} = 1 THEN ${points} ELSE 0 END)`;

const contactExpr =
  `MIN(${CONTACT_CAP}, ${flag('has_phone', CONTACT_POINTS.phone)}` +
  ` + ${flag('has_email', CONTACT_POINTS.email)}` +
  ` + ${flag('has_social', CONTACT_POINTS.social)})`;

const magnitudeCase = [
  `CASE social_magnitude_tier`,
  `WHEN 'under500' THEN ${PRESENCE.magnitude.under500}`,
  `WHEN 'under2k' THEN ${PRESENCE.magnitude.under2k}`,
  `WHEN 'under10k' THEN ${PRESENCE.magnitude.under10k}`,
  `WHEN 'atLeast10k' THEN ${PRESENCE.magnitude.atLeast10k}`,
  `ELSE 0 END`,
].join(' ');

const presenceExpr = `MIN(${PRESENCE.cap}, ${flag('has_social', PRESENCE.hasSocial)} + (${magnitudeCase}))`;

// Coverage is derived from real columns, never stored: one canonical definition
// that both the bulk rescore and the retrieval path agree on.
export const WEBSITE_PROBED_SQL = `(CASE WHEN site_state NOT IN ('unknown','has_tag_unprobed') THEN 1 ELSE 0 END)`;
export const CONTACTS_EXTRACTED_SQL = `(CASE WHEN enrichment_stage IN ('contacts','socials','done') THEN 1 ELSE 0 END)`;
export const SOCIALS_CHECKED_SQL = `(CASE WHEN enrichment_stage IN ('socials','done') THEN 1 ELSE 0 END)`;

const w = CONFIDENCE.weights;
export const CONFIDENCE_SQL =
  `(${CONFIDENCE.floor} + ${CONFIDENCE.range} * (` +
  `${WEBSITE_PROBED_SQL} * ${w.website}` +
  ` + ${CONTACTS_EXTRACTED_SQL} * ${w.contacts}` +
  ` + ${SOCIALS_CHECKED_SQL} * ${w.socials}))`;

/** Single flat expression — valid in both SELECT and UPDATE contexts. */
export const SCORE_SQL =
  `MAX(0, MIN(100, CAST(ROUND((${siteCase} + ${contactExpr} + ${presenceExpr}) * ${CONFIDENCE_SQL}) AS INTEGER)))`;

/**
 * Human-readable explanation of the score, built in SQL so a bulk rescore keeps it
 * in step with the number. The WHERE filters NULLs out of the array.
 */
export const REASONS_SQL = `(
  SELECT json_group_array(reason) FROM (
    SELECT 1 AS ord, CASE site_state
      WHEN 'no_tag' THEN 'no website found'
      WHEN 'social_only' THEN 'social profile used instead of a website'
      WHEN 'dead' THEN 'website is unreachable'
      WHEN 'server_down' THEN 'website is unreachable'
      WHEN 'parked' THEN 'domain is parked / for sale'
      WHEN 'live_weak' THEN 'website is live but very thin'
      WHEN 'live_insecure' THEN 'website has no valid SSL'
      WHEN 'blocked' THEN 'website blocks automated visits'
      WHEN 'has_tag_unprobed' THEN 'website listed in OSM but not yet checked'
      WHEN 'live' THEN 'has a working website'
      ELSE 'website state unknown' END AS reason
    UNION ALL SELECT 2, CASE WHEN has_phone = 1 THEN 'phone found' END
    UNION ALL SELECT 3, CASE WHEN has_email = 1 THEN 'email found' END
    UNION ALL SELECT 4, CASE WHEN has_social = 1 THEN 'social presence found' END
    UNION ALL SELECT 5, CASE WHEN social_magnitude_tier = 'unknown' THEN 'follower count not available' END
    UNION ALL SELECT 6, CASE WHEN ${CONFIDENCE_SQL} < 1 THEN 'partially checked' END
  ) WHERE reason IS NOT NULL ORDER BY ord
)`;

/** Coverage flags derived from real columns, mirrored by the test harness. */
export const coverageFrom = (siteState: string, enrichmentStage: string) => ({
  websiteProbed: !['unknown', 'has_tag_unprobed'].includes(siteState),
  contactsExtracted: ['contacts', 'socials', 'done'].includes(enrichmentStage),
  socialsChecked: ['socials', 'done'].includes(enrichmentStage),
});

export const RESCORE_ONE_SQL = `
UPDATE business SET
  score = ${SCORE_SQL},
  confidence_factor = ${CONFIDENCE_SQL},
  score_reasons = ${REASONS_SQL},
  score_version = :score_version,
  scored_at = :now,
  updated_at = :now
WHERE id = :id`;

/** Chunked bulk rescore — every row in the database. */
export const RESCORE_ALL_SQL = `
UPDATE business SET
  score = ${SCORE_SQL},
  confidence_factor = ${CONFIDENCE_SQL},
  score_reasons = ${REASONS_SQL},
  score_version = :score_version,
  scored_at = :now,
  updated_at = :now
WHERE id IN (SELECT id FROM business ORDER BY id LIMIT :limit OFFSET :offset)`;

/** Blocking SQL count of businesses that need a rescore. */
export const countUnscoredSql = (version: number) =>
  `SELECT COUNT(*) AS n FROM business WHERE score_version IS NOT ${version} OR scored_at IS NULL`;
