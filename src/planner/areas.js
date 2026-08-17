/**
 * "Did the user mention this part of the product at all?"
 *
 * Deliberately separate from the recipes' own keyword lists, which answer a
 * different question. A recipe's keywords decide "should this recipe win". These
 * decide "was this area in scope", and the two are not the same: audit_with_rules
 * claims "set up an audit" so a bare audit request lands somewhere sensible, but
 * that phrase says nothing about rules, and counting it here would read "set up an
 * audit and alert me if something breaks" as two areas when it is plainly one.
 *
 * Used for two things:
 *   - routing, in match.js — two areas named means the combined audit, not
 *     whichever single-standard recipe happened to score highest
 *   - chaining, in the recipes — "import our consent categories, then audit the site
 *     with tag rules and alert me if anything breaks" is four walkthroughs, and this
 *     is what tells the first one that the other three were asked for
 *
 * Its own module because both callers need it and neither can import the other:
 * match.js imports the recipe registry, so a recipe importing match.js would close
 * a cycle.
 *
 * Kept small. If it grows past a line per area, the honest move is a model call, not
 * a longer regex.
 */

export const AREA_SIGNALS = {
  rules: /tag rules|variable rules|validate tags|check(ing)? tags|tags? (still )?fir/,
  consent: /consent|gdpr|ccpa|approved (tags|cookies)|cookie compliance|unapproved|\bcmp\b/,
  alerts: /alert|notify me|email me|tell me when|threshold/,
}

export const AREAS = Object.keys(AREA_SIGNALS)

/** @param {'rules'|'consent'|'alerts'} area */
export function mentionsArea(goal, area) {
  return AREA_SIGNALS[area].test(String(goal ?? '').toLowerCase())
}

export function areasMentioned(goal) {
  return AREAS.filter(area => mentionsArea(goal, area))
}

/**
 * Did they ask for the thing to be CHECKED, not just set up?
 *
 * The distinction matters for chaining. "import our OneTrust consent categories" is
 * finished when they are imported. "import them, then audit the site against them"
 * is not, and queueing an audit onto the first would be inventing work.
 */
const AUDIT_VERBS = /\baudit(s|ing|ed)?\b|\bscan(s|ning|ned)?\b|\bcrawl\b|\bmonitor\b|\bcheck\b/i

export function wantsAudit(goal) {
  return AUDIT_VERBS.test(String(goal ?? ''))
}
