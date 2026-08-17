import { SELECTORS, stepsToStandardsTab, auditParameters } from './_audit-standards.js'
import { rankForSite } from '../account.js'
import { hostFrom } from '../naming.js'

/**
 * Privacy / consent compliance. Consent Categories are how ObservePoint decides
 * whether a tag, cookie, geo or request domain was *approved* to be there — so
 * an audit without one has no opinion about privacy at all.
 *
 * THIS RECIPE PLANS AGAINST THE LIVE ACCOUNT.
 *
 * Without account state it can only hedge, and the hedge was three steps that
 * contradicted each other: "search for the category", "attach it", "or create
 * one instead". Those aren't a sequence, they're a branch — the plan
 * apologising for not knowing what is in the account.
 *
 * With the account read, we know. One of two endings gets built:
 *   · something matches  → attach it by name; no searching, no branch
 *   · nothing matches    → go straight to creating one, and say so in the
 *     summary rather than burying it as a footnote on the last step
 *
 * If the account cannot be read (no ObservePoint tab, signed out) it falls back
 * to the generic steps, so the recipe still works — it just can't be specific.
 *
 * The sub-tab is gated on `privacyEnabled` in standards-tab.component.html. If
 * it is missing, the account lacks privacy — which the runtime can detect and
 * say at the time, rather than us warning about it on every single run.
 */

const openSubTab = {
  id: 's8',
  actor: 'user',
  targetSelector: SELECTORS.subTabConsentCategories,
  say: 'Open Consent Categories.',
  targetFallback: { description: 'the "Consent Categories" sub-tab' },
  // A click, not a mutation. The obvious completion for "open the Consent
  // Categories sub-tab" is "the standards picker became visible" — and it is wrong,
  // because the picker is ALREADY visible. createTabs() builds the sub-tabs with
  // unshift(), so the rendered order is Alerts, Consent Categories, Rules, and
  // Alerts is selected when Standards opens. .op-standards-selector was therefore
  // on screen before this step began: it completed instantly, the user never clicked
  // anything, and the next step typed its search into the ALERTS picker.
  //
  // The click is what we are actually waiting for. Nothing else on this screen
  // distinguishes "the picker I want" from "a picker".
  completion: { type: 'dom_event', value: 'click' },
}

/** What we say when we cannot see the account. */
const genericEnding = [
  {
    id: 's9',
    actor: 'user',
    targetSelector: SELECTORS.standardsSearch,
    say: 'Search for the category that covers this site.',
    targetFallback: { description: 'the search box in the consent categories picker' },
    completion: { type: 'dom_event', value: 'input' },
  },
  {
    id: 's10',
    actor: 'user',
    targetSelector: SELECTORS.standardsAddAll,
    say: 'Attach it.',
    targetFallback: { description: 'the "add all" button in the consent categories picker' },
    completion: { type: 'dom_event', value: 'click' },
  },
]

/**
 * null = we can't see the account; [] = we looked and nothing matched.
 *
 * An account with zero categories used to fall into the null branch and get the
 * generic "search for it, or create one" hedge — the one case where we know for
 * certain that searching is pointless. A missing list means unread; an empty
 * array means empty, and the two get different plans.
 */
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

function isGeoFanout(matches) {
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
 * Did the user name a region? "…observepoint.com for Canada" should pick the
 * Canadian groups rather than shrugging at 79 of them.
 */
function narrowByStatedGeo(matches, goal) {
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
function mostUsed(matches) {
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
      return { name: stated.hits[0].name, others: matches.length - 1, term: stated.term }
    }
    // Same rule as the recipe's own steps: a region token is not a search term. Pick
    // a real category from among the ones covering the region they named.
    if (stated) {
      const pick = mostUsed(stated.hits) ?? stated.hits[0]
      return { name: pick.name, others: stated.hits.length - 1, term: stated.term }
    }

    const popular = mostUsed(matches)
    return popular
      ? { name: popular.name, others: matches.length - 1, term: null }
      : { name: hostFrom(context.parameters?.siteUrl), others: matches.length - 1, term: null }
  }

  return { name: matches[0].name, others: matches.length - 1, term: null }
}

export default {
  id: 'audit_with_consent_categories',
  title: 'Audit a site for consent / privacy compliance',
  intent: {
    description:
      'Create a web audit and attach Consent Categories, so the audit reports which tags, ' +
      'cookies, geolocations and request domains are approved versus unapproved. Use for GDPR / ' +
      'CCPA / cookie-consent questions, or any "are we allowed to be running this" concern.',
    examples: [
      'check our site for privacy compliance',
      'audit example.com for GDPR',
      'I want to know which cookies are dropping before consent',
      'set up a consent category audit',
      'are we running any unapproved tags',
    ],
    keywords: [
      'consent category',
      'consent categories',
      'consent',
      'privacy',
      'gdpr',
      'ccpa',
      'cookie compliance',
      'unapproved',
      'approved tags',
      'before consent',
      'cmp',
    ],
  },
  parameters: auditParameters('Consent & privacy'),

  buildSummary(context) {
    const matches = matchesFor(context)

    const generic =
      'We\'ll create an audit called "{{parameters.auditName}}" against {{parameters.siteUrl}} and attach ' +
      'Consent Categories under Standards. Without one attached, a privacy audit runs but reports nothing.'

    if (matches === null) return generic

    if (isGeoFanout(matches)) {
      const stated = narrowByStatedGeo(matches, context.goal)
      if (stated) {
        return stated.hits.length === 1
          ? `"${stated.hits[0].name}" is the one matching the region you named, so we'll create the audit and attach that.`
          : `${stated.hits.length} of your ${matches.length} categories for {{parameters.siteUrl}} cover ${stated.term} — we'll filter the picker to those so you can pick between them.`
      }

      const popular = mostUsed(matches)
      const suggestion = popular
        ? ` Your other audits mostly use "${popular.name}" (${popular.auditCount} of them), so that's the safe default unless you audit from elsewhere.`
        : ' Tell me the region and I can pick it for you.'

      return (
        `Your account has ${matches.length} consent categories for {{parameters.siteUrl}} — CMP groups, one ` +
        `per geography, so there's no single right answer.${suggestion}`
      )
    }

    if (matches.length) {
      const names = matches
        .slice(0, 2)
        .map(c => `"${c.name}"`)
        .join(' and ')
      const extra = matches.length > 2 ? ` (and ${matches.length - 2} more)` : ''
      return (
        `${names}${extra} in your account already covers {{parameters.siteUrl}}, so we'll create the audit ` +
        'and attach that rather than starting a new category.'
      )
    }

    return (
      "Nothing in your account covers {{parameters.siteUrl}} yet, so we'll create the audit and then build " +
      'a consent category for it — that category is what defines "approved".'
    )
  },

  buildSteps(context) {
    const start = [...stepsToStandardsTab(), openSubTab]
    const matches = matchesFor(context)

    if (matches === null) return [...start, ...genericEnding]

    // Many geo variants: filter the picker to the site, then it's the user's
    // call. Searching a specific name here would silently choose for them.
    if (isGeoFanout(matches)) {
      const host = hostFrom(context.parameters?.siteUrl)
      const stated = narrowByStatedGeo(matches, context.goal)

      // A named region is an instruction; the most-used one is only a
      // suggestion. Never offer the second when we have the first — that reads
      // as the assistant contradicting itself.
      const exact = stated?.hits.length === 1 ? stated.hits[0] : null

      // ALWAYS SEARCH A REAL CATEGORY NAME, never a region token.
      //
      // This used to type stated.term, which produced `fill_text: "us"` — two
      // characters, matching 67 of 79 categories by substring. Useless as a filter
      // and it reads as the assistant not knowing the answer. The picker searches
      // names, so give it a name: the most-used category among the ones covering
      // the region they named, and say how many others share it. Precise prefill,
      // region still respected, and the user still chooses.
      const within = stated?.hits ?? matches
      const pick = exact ?? mostUsed(within) ?? within[0]
      const others = within.length - 1

      let attachSay
      if (exact) attachSay = 'Attach it.'
      else if (stated) {
        attachSay = `Attach it, or pick another — ${others} more ${
          others === 1 ? 'category covers' : 'categories cover'
        } ${stated.term}.`
      } else if (pick?.auditCount > 0) {
        attachSay = `Attach it — it is what your other audits use. ${others} others cover this site if you audit from elsewhere.`
      } else attachSay = `Pick the region you audit from and attach it — not all ${within.length}.`

      return [
        ...start,
        {
          id: 's9',
          actor: 'ai',
          targetSelector: SELECTORS.standardsSearch,
          say: exact
            ? `Searching for "${pick.name}".`
            : stated
              ? `Filtering to "${pick.name}" — one of ${stated.hits.length} covering ${stated.term}.`
              : `Filtering to "${pick.name}" — ${matches.length} categories cover ${host}, one per geography.`,
          action: { type: 'fill_text', value: pick.name },
          completion: { type: 'dom_event', value: 'input' },
        },
        {
          id: 's10',
          actor: 'user',
          targetSelector: SELECTORS.standardsAddAll,
          say: attachSay,
          targetFallback: { description: 'the consent categories picker' },
          completion: { type: 'dom_event', value: 'click' },
        },
      ]
    }

    if (matches.length) {
      const [best] = matches
      const others = matches.length - 1

      return [
        ...start,
        {
          id: 's9',
          actor: 'ai',
          targetSelector: SELECTORS.standardsSearch,
          say: `Searching for "${best.name}".`,
          action: { type: 'fill_text', value: best.name },
          completion: { type: 'dom_event', value: 'input' },
        },
        {
          id: 's10',
          actor: 'user',
          targetSelector: SELECTORS.standardsAddAll,
          say: others
            ? `Attach it. ${others} other categor${others === 1 ? 'y covers' : 'ies cover'} this site if you need more than one.`
            : 'Attach it.',
          targetFallback: { description: 'the "add all" button in the consent categories picker' },
          completion: { type: 'dom_event', value: 'click' },
        },
      ]
    }

    // Nothing matched — creating one IS the plan, not a footnote on it.
    return [
      ...start,
      {
        id: 's9',
        actor: 'user',
        targetSelector: SELECTORS.standardsCreateNew,
        say: 'None of your categories cover this site, so create one here.',
        targetFallback: { description: 'the "Create New Consent Category" button' },
        completion: { type: 'dom_event', value: 'click' },
      },
      {
        id: 's10',
        actor: 'user',
        targetSelector: SELECTORS.standardsCreateNew,
        say: 'Name it after the site, then list the tags and cookies you approve of.',
        targetFallback: { description: 'the new consent category form' },
        completion: { type: 'dom_event', value: 'change' },
      },
    ]
  },
}
