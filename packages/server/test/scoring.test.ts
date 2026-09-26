import { describe, expect, it } from 'vitest';
import {
  CONFIDENCE,
  CONTACT_CAP,
  PRESENCE,
  SITE_STATES,
  magnitudeTier,
  scoreLead,
  sitePoints,
  type OfferPreset,
  type SiteState,
} from '@outreach/shared';
import { CONFIDENCE_SQL, SCORE_SQL, coverageFrom } from '../src/scoring/score-sql.ts';
import { openDb, migrate } from '../src/db/client.ts';

const PRESETS: OfferPreset[] = ['websites', 'social_media', 'balanced'];
const TIERS = ['unknown', 'under500', 'under2k', 'under10k', 'atLeast10k'] as const;
const STAGES = ['none', 'probe', 'scrape', 'contacts', 'socials', 'done'] as const;

function makeDb() {
  const db = openDb(':memory:');
  migrate(db);
  return db;
}

/**
 * Evaluates the production SQL score expression against explicit inputs, so both
 * the arithmetic (caps, rounding, clamping) and the coverage derivation are
 * verified independently of the TypeScript scorer.
 */
function sqlScore(
  db: ReturnType<typeof makeDb>,
  input: {
    siteState: SiteState;
    hasPhone: boolean;
    hasEmail: boolean;
    hasSocial: boolean;
    tier: string;
    enrichmentStage: string;
    preset: OfferPreset;
  },
): number {
  const row = db
    .prepare(
      `SELECT ${SCORE_SQL} AS score, ${CONFIDENCE_SQL} AS confidence
       FROM (SELECT
         :site_state AS site_state,
         :enrichment_stage AS enrichment_stage,
         :has_phone AS has_phone,
         :has_email AS has_email,
         :has_social AS has_social,
         :tier AS social_magnitude_tier)`,
    )
    .get({
      site_state: input.siteState,
      enrichment_stage: input.enrichmentStage,
      has_phone: input.hasPhone ? 1 : 0,
      has_email: input.hasEmail ? 1 : 0,
      has_social: input.hasSocial ? 1 : 0,
      tier: input.tier,
      p_no_tag: sitePoints('no_tag', input.preset),
      p_social_only: sitePoints('social_only', input.preset),
    }) as { score: number; confidence: number };
  return row.score;
}

describe('scoring: SQL twin matches the TypeScript scorer', () => {
  const db = makeDb();

  it('agrees across the full state matrix', { timeout: 60_000 }, () => {
    let checked = 0;
    const mismatches: string[] = [];

    for (const preset of PRESETS) {
      for (const siteState of SITE_STATES) {
        for (const flags of [
          [false, false, false],
          [true, false, false],
          [false, true, false],
          [true, true, false],
          [true, true, true],
          [false, false, true],
        ]) {
          for (const tier of TIERS) {
            for (const stage of STAGES) {
              const coverage = coverageFrom(siteState, stage);
              const input = {
                siteState,
                hasPhone: flags[0]!,
                hasEmail: flags[1]!,
                hasSocial: flags[2]!,
                tier,
                enrichmentStage: stage,
                preset,
              };

              const ts = scoreLead({
                siteState,
                hasPhone: input.hasPhone,
                hasEmail: input.hasEmail,
                hasSocial: input.hasSocial,
                magnitudeTier: tier as never,
                websiteProbed: coverage.websiteProbed,
                contactsExtracted: coverage.contactsExtracted,
                socialsChecked: coverage.socialsChecked,
                preset,
              });

              const sql = sqlScore(db, input);
              if (sql !== ts.score) {
                mismatches.push(
                  `sql=${sql} ts=${ts.score} [${siteState} preset=${preset} phone=${input.hasPhone} email=${input.hasEmail} social=${input.hasSocial} tier=${tier} stage=${stage}]`,
                );
              }
              checked++;
            }
          }
        }
      }
    }

    expect(mismatches.slice(0, 12)).toEqual([]);
    expect(checked).toBe(PRESETS.length * SITE_STATES.length * 6 * TIERS.length * STAGES.length);
  });

  it('computes the confidence factor identically', () => {
    for (const siteState of ['live', 'unknown', 'has_tag_unprobed', 'no_tag'] as SiteState[]) {
      for (const stage of STAGES) {
        const coverage = coverageFrom(siteState, stage);
        const expected =
          CONFIDENCE.floor +
          CONFIDENCE.range *
            ((coverage.websiteProbed ? CONFIDENCE.weights.website : 0) +
              (coverage.contactsExtracted ? CONFIDENCE.weights.contacts : 0) +
              (coverage.socialsChecked ? CONFIDENCE.weights.socials : 0));
        const got = db
          .prepare(
            `SELECT ${CONFIDENCE_SQL} AS c FROM (SELECT :site_state AS site_state, :enrichment_stage AS enrichment_stage)`,
          )
          .get({ site_state: siteState, enrichment_stage: stage }) as { c: number };
        expect(got.c, `${siteState}/${stage}`).toBeCloseTo(expected, 10);
      }
    }
  });
});

describe('scoring: the properties the ranking depends on', () => {
  const base = {
    hasPhone: true,
    hasEmail: true,
    hasSocial: false,
    magnitudeTier: 'unknown' as const,
    websiteProbed: true,
    contactsExtracted: true,
    socialsChecked: true,
  };

  it('ranks a verified no-website business above one with a live site', () => {
    const noSite = scoreLead({ ...base, siteState: 'no_tag' }).score;
    const live = scoreLead({ ...base, siteState: 'live' }).score;
    expect(noSite).toBeGreaterThan(live);
  });

  it('never lets an unprobed business outrank a verified no-website business', () => {
    const verified = scoreLead({ ...base, siteState: 'no_tag' }).score;
    const unprobed = scoreLead({
      siteState: 'has_tag_unprobed',
      hasPhone: true,
      hasEmail: true,
      hasSocial: true,
      magnitudeTier: 'atLeast10k',
      websiteProbed: false,
      contactsExtracted: false,
      socialsChecked: false,
    }).score;
    expect(unprobed).toBeLessThan(verified);
  });

  it('treats an unknown follower count as exactly zero, not a midpoint', () => {
    const unknown = scoreLead({ ...base, siteState: 'live', hasSocial: true, magnitudeTier: 'unknown' }).presence;
    const verified500 = scoreLead({ ...base, siteState: 'live', hasSocial: true, magnitudeTier: 'under500' }).presence;
    expect(unknown).toBe(PRESENCE.hasSocial);
    expect(verified500).toBe(PRESENCE.hasSocial + PRESENCE.magnitude.under500);
  });

  it('caps contactability and presence', () => {
    const r = scoreLead({
      ...base,
      siteState: 'no_tag',
      hasPhone: true,
      hasEmail: true,
      hasSocial: true,
      magnitudeTier: 'atLeast10k',
    });
    expect(r.contactability).toBe(CONTACT_CAP);
    expect(r.presence).toBeLessThanOrEqual(PRESENCE.cap);
  });

  it('orders magnitude tiers monotonically', () => {
    const pts = TIERS.map(
      (t) => scoreLead({ ...base, siteState: 'live', hasSocial: true, magnitudeTier: t }).presence,
    );
    const sorted = [...pts].sort((a, b) => a - b);
    expect(pts).toEqual(sorted);
  });

  it('swaps the top signal between offer presets without breaking the scale', () => {
    const asWebsites = scoreLead({ ...base, siteState: 'social_only', preset: 'websites' }).score;
    const asSocial = scoreLead({ ...base, siteState: 'social_only', preset: 'social_media' }).score;
    expect(asSocial).toBeGreaterThan(asWebsites);
    for (const preset of PRESETS) {
      for (const state of SITE_STATES) {
        const s = scoreLead({ ...base, siteState: state, preset }).score;
        expect(s).toBeGreaterThanOrEqual(0);
        expect(s).toBeLessThanOrEqual(100);
      }
    }
  });

  it('maps follower counts to tiers at the documented boundaries', () => {
    expect(magnitudeTier(499, 'known')).toBe('under500');
    expect(magnitudeTier(500, 'known')).toBe('under2k');
    expect(magnitudeTier(1999, 'known')).toBe('under2k');
    expect(magnitudeTier(2000, 'known')).toBe('under10k');
    expect(magnitudeTier(9999, 'known')).toBe('under10k');
    expect(magnitudeTier(10000, 'known')).toBe('atLeast10k');
    expect(magnitudeTier(50000, 'blocked')).toBe('unknown');
    expect(magnitudeTier(null, 'known')).toBe('unknown');
  });
});
