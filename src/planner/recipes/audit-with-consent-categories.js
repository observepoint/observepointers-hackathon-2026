import {
  SELECTORS,
  stepsToStandardsTab,
  saveAuditStep,
  auditParameters,
} from './_audit-standards.js'
import { hostFrom } from '../naming.js'
import {
  matchesFor,
  bestCategoryFor,
  isGeoFanout,
  searchFor,
  narrowByStatedGeo,
  mostUsed,
} from './_consent-matching.js'

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

/**
 * What we say when we cannot see the account.
 *
 * Even here, say what to TYPE. "Search for the category that covers this site" is
 * an instruction with the useful half missing — the user is staring at a search box
 * wondering what this thing is called. We do not know the category name without the
 * account, but we do know the site, and the site is what its name almost always
 * contains. So fill the host: it is a guess about their naming, never about their
 * data, and it beats an empty box.
 */
const genericEnding = context => [
  {
    id: 's9',
    actor: 'ai',
    targetSelector: SELECTORS.standardsSearch,
    say: `Filtering to "${hostFrom(context.parameters?.siteUrl)}" — best guess at the name.`,
    targetFallback: { description: 'the search box in the consent categories picker' },
    action: { type: 'fill_text', value: hostFrom(context.parameters?.siteUrl) },
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
    // Wrapped rather than appended to each branch: there are four endings here and
    // three of them would have been missed.
    return [...this.consentSteps(context), saveAuditStep('s11')]
  },

  consentSteps(context) {
    const start = [...stepsToStandardsTab(), openSubTab]
    const matches = matchesFor(context)

    if (matches === null) return [...start, ...genericEnding(context)]

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

      const search = searchFor({ exact, stated, pick })
      // Did we type the region, or one specific category? It changes what the next
      // step can honestly ask for.
      const filteredToRegion = search === stated?.term

      let attachSay
      if (exact) attachSay = 'Attach it.'
      else if (filteredToRegion) {
        attachSay = `Pick the one for your part of ${stated.term} and attach it — ${stated.hits.length} match.`
      } else if (stated) {
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
            : filteredToRegion
              ? `Filtering to ${stated.term} — ${stated.hits.length} of your ${matches.length} categories cover it.`
              : stated
                ? `Filtering to "${pick.name}" — one of ${stated.hits.length} covering ${stated.term}.`
                : `Filtering to "${pick.name}" — ${matches.length} categories cover ${host}, one per geography.`,
          action: { type: 'fill_text', value: search },
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

// Re-exported for the recipes that were importing them from here.
export { matchesFor, bestCategoryFor }
