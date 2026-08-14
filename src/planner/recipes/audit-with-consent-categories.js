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
  id: 's7',
  actor: 'user',
  targetSelector: SELECTORS.subTabConsentCategories,
  say: 'Open Consent Categories.',
  targetFallback: { description: 'the "Consent Categories" sub-tab' },
  unverified: true,
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
    unverified: true,
    completion: { type: 'dom_event', value: 'input' },
  },
  {
    id: 's9',
    actor: 'user',
    targetSelector: SELECTORS.standardsAddAll,
    say: 'Attach it.',
    targetFallback: { description: 'the "add all" button in the consent categories picker' },
    unverified: true,
    completion: { type: 'dom_event', value: 'click' },
  },
]

/** null = we can't see the account; [] = we looked and nothing matched. */
function matchesFor(context) {
  const categories = context?.account?.consentCategories
  if (!Array.isArray(categories) || !categories.length) return null

  return rankForSite(categories, hostFrom(context.parameters?.siteUrl)).filter(c => c.matches)
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
          unverified: true,
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
          unverified: true,
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
        unverified: true,
        completion: { type: 'dom_event', value: 'click' },
      },
      {
        id: 's9',
        actor: 'user',
        targetSelector: SELECTORS.standardsCreateNew,
        say: 'Name it after the site, then list the tags and cookies you approve of.',
        targetFallback: { description: 'the new consent category form' },
        unverified: true,
        completion: { type: 'dom_event', value: 'change' },
      },
    ]
  },
}
