export interface RobotsRule {
  type: 'allow' | 'disallow';
  path: string;
}

export interface RobotsGroup {
  agents: string[];
  rules: RobotsRule[];
  crawlDelayMs: number | null;
}

export interface ParsedRobots {
  groups: RobotsGroup[];
  sitemaps: string[];
}

/** Group value that applies to every crawler. */
const WILDCARD = '*';

export function parseRobots(text: string): ParsedRobots {
  const groups: RobotsGroup[] = [];
  const sitemaps: string[] = [];
  let current: RobotsGroup | null = null;
  let lastLineWasAgent = false;

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.split('#')[0]!.trim();
    if (!line) continue;
    const idx = line.indexOf(':');
    if (idx === -1) continue;
    const field = line.slice(0, idx).trim().toLowerCase();
    const value = line.slice(idx + 1).trim();

    if (field === 'user-agent') {
      // Consecutive user-agent lines share one group.
      if (!current || !lastLineWasAgent) {
        current = { agents: [], rules: [], crawlDelayMs: null };
        groups.push(current);
      }
      if (value) current.agents.push(value.toLowerCase());
      lastLineWasAgent = true;
      continue;
    }
    if (field === 'sitemap') {
      if (value) sitemaps.push(value);
      lastLineWasAgent = false;
      continue;
    }
    lastLineWasAgent = false;
    if (!current) continue;

    if (field === 'disallow' || field === 'allow') {
      // "Disallow:" with an empty value means "allow everything" — no rule needed.
      if (!value && field === 'disallow') continue;
      current.rules.push({ type: field, path: value });
    } else if (field === 'crawl-delay') {
      const seconds = Number.parseFloat(value);
      if (Number.isFinite(seconds) && seconds >= 0) current.crawlDelayMs = Math.round(seconds * 1000);
    }
  }
  return { groups, sitemaps };
}

/**
 * All groups that apply to our crawler. RFC 9309 §2.2.1: if several groups match,
 * their rules MUST be combined; a specific match takes precedence over '*'.
 * Returning only the first wildcard group would silently ignore later blocks.
 */
export function selectGroups(parsed: ParsedRobots, productToken: string): RobotsGroup[] {
  const token = productToken.toLowerCase();
  const specific: { group: RobotsGroup; len: number }[] = [];

  for (const group of parsed.groups) {
    for (const agent of group.agents) {
      if (agent === WILDCARD) continue;
      // The User-agent line is matched as a case-insensitive substring of our token.
      if (token.includes(agent) || agent.includes(token)) specific.push({ group, len: agent.length });
    }
  }

  if (specific.length) {
    const longest = Math.max(...specific.map((s) => s.len));
    return specific.filter((s) => s.len === longest).map((s) => s.group);
  }
  return parsed.groups.filter((g) => g.agents.includes(WILDCARD));
}

/** Merged view of every applicable group. */
export function selectGroup(parsed: ParsedRobots, productToken: string): RobotsGroup | null {
  const groups = selectGroups(parsed, productToken);
  if (!groups.length) return null;
  return {
    agents: groups.flatMap((g) => g.agents),
    rules: groups.flatMap((g) => g.rules),
    crawlDelayMs: groups.find((g) => g.crawlDelayMs !== null)?.crawlDelayMs ?? null,
  };
}

/** Convert a robots path pattern (supporting * and $) into a matcher. */
function compile(pattern: string): RegExp {
  const anchored = pattern.endsWith('$');
  const body = anchored ? pattern.slice(0, -1) : pattern;
  const escaped = body.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*');
  return new RegExp(`^${escaped}${anchored ? '$' : ''}`);
}

export interface RobotsDecision {
  allowed: boolean;
  matchedRule: string | null;
  crawlDelayMs: number | null;
  sitemaps: string[];
}

/**
 * Longest-match precedence between Allow and Disallow; Allow wins ties.
 * Returns allowed=true when no rule matches, per the spec.
 */
export function evaluate(parsed: ParsedRobots, productToken: string, path: string): RobotsDecision {
  const group = selectGroup(parsed, productToken);
  const sitemaps = parsed.sitemaps;
  if (!group) return { allowed: true, matchedRule: null, crawlDelayMs: null, sitemaps };

  const target = path || '/';
  let winner: { rule: RobotsRule; length: number } | null = null;

  for (const rule of group.rules) {
    if (!rule.path) continue;
    if (!compile(rule.path).test(target)) continue;
    const length = rule.path.replace(/[*$]/g, '').length;
    if (
      !winner ||
      length > winner.length ||
      // Ties go to Allow, which is the more permissive reading of the spec.
      (length === winner.length && rule.type === 'allow')
    ) {
      winner = { rule, length };
    }
  }

  return {
    allowed: winner ? winner.rule.type === 'allow' : true,
    matchedRule: winner?.rule.path ?? null,
    crawlDelayMs: group.crawlDelayMs,
    sitemaps,
  };
}

/** robots.txt fetch outcomes that are not a normal body. */
export type RobotsFetchState = 'ok' | 'missing' | 'unreachable';

export function parseSitemapUrls(xml: string, limit = 200): string[] {
  const out: string[] = [];
  // Handles both <urlset><url><loc> and <sitemapindex><sitemap><loc>.
  const re = /<loc>\s*([^<\s]+)\s*<\/loc>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml)) && out.length < limit) {
    const value = m[1]!.replace(/&amp;/g, '&');
    if (/^https?:\/\//i.test(value)) out.push(value);
  }
  return out;
}
