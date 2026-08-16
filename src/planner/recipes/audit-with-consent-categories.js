import {
  SELECTORS,
  stepsToStandardsTab,
  usesAdvancedPath,
  auditParameters,
} from './_audit-standards.js'
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
  id: 's7',
  actor: 'user',
  targetSelector: SELECTORS.subTabConsentCategories,
  say: 'Open Consent Categories.',
  targetFallback: { description: 'the "Consent Categories" sub-tab' },
  completion: {
    type: 'dom_mutation',
    condition: 'visible',
    targetSelector: '.op-standards-selector',
  },
}

/** What we say when we cannot see the account. */
const genericEnding = [
  {
    id: 's8',
    actor: 'user',
    targetSelector: SELECTORS.standardsSearch,
    say: 'Search for the category that covers this site.',
    targetFallback: { description: 'the search box in the consent categories picker' },
    completion: { type: 'dom_event', value: 'input' },
  },
  {
    id: 's9',
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
function matchesFor(context) {
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
 * Did the user name a region? "…observepoint.com for Canada" should pick the
 * Canadian groups rather than shrugging at 79 of them.
 *
 * Matched against the geo strings in *their* account rather than a hardcoded
 * country list. Their CMP already knows how it spells its regions, so borrowing
 * that vocabulary handles "Alberta", "EMEA" or any internal naming we'd never
 * have thought to enumerate — and it can't match a region they don't have.
 */
function narrowByStatedGeo(matches, goal) {
  const said = String(goal ?? '').toLowerCase()
  if (!said) return null

  // Any comma-separated part counts: "Canada, Alberta" should answer to both
  // "for Canada" and "for Alberta".
  // Keep the account's own casing — echoing "canada" back at someone who wrote
  // "Canada" looks like a bug even though the match is right.
  const partsOf = category =>
    (category.cmpGeo ?? '')
      .split(',')
      .map(part => part.trim())
      .filter(part => part.length > 2)

  let term = null
  const hits = matches.filter(category => {
    const hit = partsOf(category).find(part => said.includes(part.toLowerCase()))
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

export default {
  id: 'audit_with_consent_categories',
  title: 'Audit a site for consent / privacy compliance',
  verified: false,
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
    const start = [
      ...stepsToStandardsTab({ advanced: usesAdvancedPath(context.account) }),
      openSubTab,
    ]
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
      const popular = stated ? null : mostUsed(matches)

      const searchFor = exact ? exact.name : (stated?.term ?? host)

      let attachSay
      if (exact) attachSay = 'Attach it.'
      else if (stated) {
        attachSay = `Pick which of the ${stated.hits.length} ${stated.term} categories you want and attach it.`
      } else if (popular) {
        attachSay = `Pick your region and attach it — not all of them. "${popular.name}" is what your other audits use.`
      } else attachSay = 'Pick the region you audit from and attach it — not all of them.'

      return [
        ...start,
        {
          id: 's8',
          actor: 'ai',
          targetSelector: SELECTORS.standardsSearch,
          say: exact
            ? `Searching for "${exact.name}".`
            : stated
              ? `Filtering to ${stated.term}.`
              : `Filtering to ${host} — ${matches.length} categories, one per geography.`,
          action: { type: 'fill_text', value: searchFor },
          completion: { type: 'dom_event', value: 'input' },
        },
        {
          id: 's9',
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
          id: 's8',
          actor: 'ai',
          targetSelector: SELECTORS.standardsSearch,
          say: `Searching for "${best.name}".`,
          action: { type: 'fill_text', value: best.name },
          completion: { type: 'dom_event', value: 'input' },
        },
        {
          id: 's9',
          actor: 'user',
          targetSelector: SELECTORS.standardsAddAll,
          say: others
            ? `Attach it. ${others} other categor${others === 1 ? 'y' : 'ies'} also cover this site if you need more than one.`
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
        id: 's8',
        actor: 'user',
        targetSelector: SELECTORS.standardsCreateNew,
        say: 'None of your categories cover this site, so create one here.',
        targetFallback: { description: 'the "Create New Consent Category" button' },
        completion: { type: 'dom_event', value: 'click' },
      },
      {
        id: 's9',
        actor: 'user',
        targetSelector: SELECTORS.standardsCreateNew,
        say: 'Name it after the site, then list the tags and cookies you approve of.',
        targetFallback: { description: 'the new consent category form' },
        completion: { type: 'dom_event', value: 'change' },
      },
    ]
  },
}
