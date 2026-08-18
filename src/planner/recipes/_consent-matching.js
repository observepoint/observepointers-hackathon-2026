/**
 * Which consent category should this audit attach?
 *
 * Its own module because THREE files need it now: the dedicated consent recipe, the
 * combined one, and the edit-an-existing-audit one. It got there by being imported
 * into _audit-standards.js, which closed a cycle — audit-with-consent-categories.js
 * imports SELECTORS from there, and the cycle broke at module-eval time with
 * "Cannot access 'SELECTORS' before initialization". The logic never belonged to one
 * recipe anyway; it answers a question about the account, not about a walkthrough.
 *
 * THE PROBLEM THIS SOLVES
 *
 * A OneTrust-fed account does not have "a consent category for gap.com". It has 79 of
 * them — one per domain per geography — named "Analytical Cookies | gap.com | USA,
 * Alabama". So "attach the consent category" is not a lookup, it is a disambiguation,
 * and the honest answer depends on what the user said:
 *
 *   several match, no region named   search the COUNTRY, let them pick the state
 *   several match, region named      search what they said, if it is specific enough
 *   one matches                      search its full name; nothing to choose
 *
 * Never a two-letter code. "US" typed into a picker that matches on substring hit 67
 * of 79 categories in a live account.
 */

import { rankForSite } from '../account.js'
import { hostFrom } from '../naming.js'

export function matchesFor(context) {
  const categories = context?.account?.consentCategories
  if (!Array.isArray(categories)) return null

  return rankForSite(categories, hostFrom(context.parameters?.siteUrl)).filter(c => c.matches)
}

/**
 * A CMP-synced account doesn't have "the category for this site" — it has one
 * per geography. A real account here returned 79 matches for observepoint.com,
 * all OneTrust cookie groups differing only by region.
 *
 * Naming the first is arbitrary and quietly wrong: attaching the Alberta group
 * to an audit run from the EU reports the wrong approvals. When we spot that
 * shape, we say so and let the user pick the geo, rather than pretending to
 * know which one they meant.
 */
const GEO_FANOUT_THRESHOLD = 3

export function isGeoFanout(matches) {
  if (matches.length <= GEO_FANOUT_THRESHOLD) return false
  const domains = new Set(matches.map(c => c.cmpDomain).filter(Boolean))
  return domains.size === 1 && matches.filter(c => c.cmpDomain).length === matches.length
}

/**
 * The few places where a person and a CMP reliably disagree on spelling.
 *
 * Everything else is matched against the geo strings in the *account*, on
 * purpose: their CMP already knows how it spells its own regions, so borrowing
 * that vocabulary handles "Alberta", "EMEA" and any internal naming we would
 * never have thought to enumerate — and it cannot match a region they don't
 * have. This table is not a country list and must not grow into one. It exists
 * because "check compliance for gap.com in the United States" matched NOTHING
 * against an account that writes USA, and silently fell through to picking the
 * first of four by ordering.
 *
 * Note the omission: bare "us". It collides with the pronoun in "check our site
 * for us", which is a phrasing this product invites.
 */
const US_NAMES = ['united states of america', 'united states', 'u.s.a.', 'u.s.', 'america']
const GEO_ALIASES = {
  usa: US_NAMES,
  // Some accounts file it as the two-letter code instead. Same names either way.
  us: US_NAMES,
  uk: ['united kingdom', 'great britain', 'britain', 'england', 'scotland', 'wales'],
  gb: ['united kingdom', 'great britain', 'britain', 'england', 'scotland', 'wales'],
  eu: ['european union', 'europe', 'eea'],
  ca: ['canada'],
}

const escapeRe = value => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/**
 * Does `said` name this term?
 *
 * Bounded rather than a bare substring test, which is what makes short geo codes
 * safe to match at all — "EU" as a substring hits "queue" and "reused".
 */
const mentions = (said, term) =>
  new RegExp(`(^|[^a-z0-9])${escapeRe(term.toLowerCase())}([^a-z0-9]|$)`).test(said)

/**
 * A two-letter code has to be WRITTEN as a code.
 *
 * The alias table deliberately omits bare "us" because it collides with the
 * pronoun — but that only guarded one door. An account whose CMP files things under
 * "US" rather than "USA" put the collision straight back: "check our site for
 * privacy compliance. observepoint.com for us" matched 67 of 79 categories on the
 * pronoun, and the plan then offered to filter the picker to "us".
 *
 * So for a two-character part, require it uppercase in the user's own text. "for
 * US" is a region; "for us" is not. Longer names stay case-insensitive, because
 * nobody writes "canada" meaning anything else.
 */
const mentionsCoded = (rawGoal, term) =>
  new RegExp(`(^|[^A-Za-z0-9])${escapeRe(term.toUpperCase())}([^A-Za-z0-9]|$)`).test(rawGoal)

/**
 * A search string has to be long enough to filter. "US" typed into a picker that
 * matches on substring hits every name containing those two letters, which is
 * most of them.
 */
const MIN_SEARCH = 3

/**
 * What to type into the picker's search box.
 *
 * OneTrust-imported names follow one shape — "Analytical Cookies | example.com |
 * Canada, Alberta" — so the country is IN the name, and typing the country is the
 * filter that matches how these are actually organised.
 *
 * Which makes the full name the wrong thing to type when several categories
 * qualify: it narrows to exactly one and takes the choice away, when the whole
 * point of that branch is that we cannot know which region they audit from. So:
 *
 *   one category qualifies   -> its full name; there is nothing to choose
 *   several, region named    -> the region, as the account spells it
 *   region too short to type -> fall back to a full name
 *   no region named          -> the most-used name, as a concrete recommendation
 */
export function searchFor({ exact, stated, pick }) {
  if (exact) return exact.name
  if (stated && stated.term.length >= MIN_SEARCH) return stated.term
  return pick.name
}

/**
 * Did the user name a region? "…observepoint.com for Canada" should pick the
 * Canadian groups rather than shrugging at 79 of them.
 */
export function narrowByStatedGeo(matches, goal) {
  const raw = String(goal ?? '')
  const said = raw.toLowerCase()
  if (!said) return null

  // Any comma-separated part counts: "Canada, Alberta" should answer to both
  // "for Canada" and "for Alberta".
  // Two-character parts are kept now that matching is bounded — dropping them
  // meant an account that files things under "EU" or "UK" could never be
  // narrowed at all.
  const partsOf = category =>
    (category.cmpGeo ?? '')
      .split(',')
      .map(part => part.trim())
      .filter(part => part.length >= 2)

  // Aliases first, and they are exempt from the uppercase rule. "european union"
  // cannot be a pronoun, so there is nothing to disambiguate — it was only ever the
  // BARE two-letter code that needed writing as a code. Checking the code first
  // broke the alias path entirely: "the European Union" stopped finding an "EU"
  // category, because "European" contains no bounded uppercase "EU".
  const namesPart = part => {
    const aliases = GEO_ALIASES[part.toLowerCase()] ?? []
    if (aliases.some(alias => mentions(said, alias))) return true
    return part.length === 2 ? mentionsCoded(raw, part) : mentions(said, part)
  }

  let term = null
  const hits = matches.filter(category => {
    // Keep the account's own casing and its own spelling. Someone who wrote
    // "United States" gets USA searched for, because USA is what is in the
    // picker — echoing their words back would filter to nothing.
    const hit = partsOf(category).find(namesPart)
    // Keep the most specific term the user actually said, so a follow-up search
    // filters to what they asked for rather than to the whole domain.
    if (hit && (!term || hit.length > term.length)) term = hit
    return Boolean(hit)
  })

  return hits.length && hits.length < matches.length ? { hits, term } : null
}

/**
 * No region stated. The most useful suggestion isn't a guess at geography — it
 * is what their other audits already use. `auditCount` comes back on every
 * category, so the account answers the question itself.
 */
export function mostUsed(matches) {
  const ranked = [...matches].sort((a, b) => (b.auditCount ?? 0) - (a.auditCount ?? 0))
  return ranked[0]?.auditCount > 0 ? ranked[0] : null
}

/**
 * The single best category to prefill a picker search with, for callers that want
 * the account-aware answer without the branching narrative around it.
 *
 * Shared with audit_with_all_standards. Reimplementing the geo handling there
 * would mean two places to get the CMP fan-out wrong.
 *
 * @returns {{name: string, others: number, term: string|null}|null}
 *   null when the account is unreadable or nothing matches.
 */
export function bestCategoryFor(context) {
  const matches = matchesFor(context)
  if (!matches?.length) return null

  if (isGeoFanout(matches)) {
    const stated = narrowByStatedGeo(matches, context.goal)
    // One region named and one category for it: that is an answer. Several, or
    // none named, and the honest move is to filter rather than choose.
    if (stated?.hits.length === 1) {
      const only = stated.hits[0]
      return { name: only.name, search: only.name, others: matches.length - 1, term: stated.term }
    }
    if (stated) {
      const pick = mostUsed(stated.hits) ?? stated.hits[0]
      return {
        name: pick.name,
        // Same rule as the recipe's own steps: type the region when it is long
        // enough to filter, because these names carry the country. A full name
        // would narrow to one and take the choice away.
        search: searchFor({ stated, pick }),
        others: stated.hits.length - 1,
        term: stated.term,
      }
    }

    const popular = mostUsed(matches)
    const fallback = popular?.name ?? hostFrom(context.parameters?.siteUrl)
    return { name: fallback, search: fallback, others: matches.length - 1, term: null }
  }

  return { name: matches[0].name, search: matches[0].name, others: matches.length - 1, term: null }
}
