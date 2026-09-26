/**
 * Small pieces of local UI state that must survive a page switch
 * (the category chip rail on Home feeds the Leads filter).
 */

const CATEGORY_KEY = 'outreach-os:leads-category';
const GUIDE_KEY = 'outreach-os:guide-seen';

export const ALL_CATEGORIES = 'all';

export function readCategoryPref(): string {
  try {
    return window.localStorage.getItem(CATEGORY_KEY) ?? ALL_CATEGORIES;
  } catch {
    return ALL_CATEGORIES;
  }
}

export function writeCategoryPref(value: string): void {
  try {
    window.localStorage.setItem(CATEGORY_KEY, value);
  } catch {
    // Private mode / storage disabled — the filter still works for this visit.
  }
}

/** The guide opens itself once, then only when asked for. */
export function hasSeenGuide(): boolean {
  try {
    return window.localStorage.getItem(GUIDE_KEY) === '1';
  } catch {
    // Storage unavailable: treat it as seen so it cannot open on every reload.
    return true;
  }
}

export function markGuideSeen(): void {
  try {
    window.localStorage.setItem(GUIDE_KEY, '1');
  } catch {
    /* nothing to do */
  }
}

export function resetGuide(): void {
  try {
    window.localStorage.removeItem(GUIDE_KEY);
  } catch {
    /* nothing to do */
  }
}
