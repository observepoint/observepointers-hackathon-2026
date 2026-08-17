import { SELECTORS, stepsToStandardsTab, auditParameters } from './_audit-standards.js'
import { bestCategoryFor } from './audit-with-consent-categories.js'

/**
 * One audit, all three Standards.
 *
 * WHY THIS EXISTS
 *
 * Ask for all three and you used to get one. "set up an audit for gap.com with
 * rules, consent categories and alerts" matched audit_with_rules; "attach all
 * three standards" matched audit_with_alerts; "rules, consent and alerts" matched
 * consent categories. Whichever recipe happened to score highest won and the
 * other two requests were dropped silently — no warning, no mention, a plan that
 * quietly did a third of what was asked.
 *
 * WHY IT IS CHEAP
 *
 * Because of the thing that took longest to work out about this screen: Rules,
 * Consent Categories and Alerts are not three flows. They are three sub-tabs of
 * ONE Standards tab, all rendering the same `op-standards-selector` — same search
 * box, same "add all", same "Create New". So the expensive part (Data Sources →
 * create → name → URLs → Standards) happens once, and the three legs are two
 * steps each on top of it.
 *
 * That is also the most useful thing to show someone: not three walkthroughs, but
 * one screen they did not know had three tabs on it.
 *
 * THE CONSENT LEG STAYS ACCOUNT-AWARE
 *
 * It would be easy to make the combined recipe the generic one and leave the
 * naming of real categories to audit_with_consent_categories. That gives up the
 * only thing here no product tour can do, in exactly the flow most likely to be
 * demonstrated. So the consent leg calls the same bestCategoryFor() the dedicated
 * recipe uses, and prefills the picker search with a category the account really
 * has.
 *
 * SELECTORS: all shared with the three single-standard recipes, so this adds no
 * new selector risk. Verified where they are.
 */

/** Ids are assigned at the end, because the consent leg has a variable length. */
function numbered(steps, startId = 1) {
  return steps.map((step, i) => ({ ...step, id: `s${startId + i}` }))
}

const openSubTab = (selector, label) => ({
  actor: 'user',
  targetSelector: selector,
  say: `Open ${label}.`,
  targetFallback: { description: `the "${label}" sub-tab under Standards` },
  // Click, not visibility — see the note in audit-with-consent-categories.js. This
  // recipe walks all three sub-tabs in turn, so a visibility completion would have
  // been wrong for two of three legs and accidentally right for the third.
  completion: { type: 'dom_event', value: 'click' },
})

const attach = say => ({
  actor: 'user',
  targetSelector: SELECTORS.standardsAddAll,
  say,
  targetFallback: { description: 'the "add all" button in the picker' },
  completion: { type: 'dom_event', value: 'click' },
})

export default {
  id: 'audit_with_all_standards',
  title: 'Audit a site against rules, consent categories and alerts',
  intent: {
    description:
      'Create one web audit and attach ALL THREE Standards to it — Tag & Variable Rules, ' +
      'Consent Categories and Alerts — in a single pass. Use when someone asks for more than one ' +
      'of the three, or for "everything", rather than naming a single concern. In ObservePoint ' +
      'these are three sub-tabs of one Standards screen, so one audit covers all of them.',
    examples: [
      'set up an audit for example.com with rules, consent categories and alerts',
      'audit our site against all three standards',
      'full audit — tags, privacy and alerting',
      'I want rules and alerts on the same audit',
      'attach everything under Standards',
    ],
    keywords: [
      // Long and specific on purpose: these have to outscore the three
      // single-standard recipes, each of which legitimately matches part of the
      // phrase. Scoring weights keyword length, so a five-word match wins.
      'rules consent categories and alerts',
      'rules, consent categories and alerts',
      'rules consent and alerts',
      'rules, consent and alerts',
      'rules and alerts',
      'all three standards',
      'all of the standards',
      'all standards',
      'everything under standards',
      'every standard',
      'tags privacy and alerting',
    ],
  },
  parameters: auditParameters('All standards'),

  buildSummary(context) {
    const best = bestCategoryFor(context)
    const named = best
      ? ` For privacy we'll attach "${best.name}", which your account already has.`
      : ''

    return (
      'Rules, Consent Categories and Alerts are three sub-tabs of one Standards screen, so this ' +
      'is a single audit rather than three. We\'ll create "{{parameters.auditName}}" against ' +
      `{{parameters.siteUrl}} and attach all three.${named}`
    )
  },

  buildSteps(context) {
    const best = bestCategoryFor(context)

    const consentLeg = [openSubTab(SELECTORS.subTabConsentCategories, 'Consent Categories')]
    if (best) {
      consentLeg.push({
        actor: 'ai',
        targetSelector: SELECTORS.standardsSearch,
        say: `Filtering to "${best.name}".`,
        targetFallback: { description: 'the search box in the consent categories picker' },
        action: { type: 'fill_text', value: best.name },
        completion: { type: 'dom_event', value: 'input' },
      })
      consentLeg.push(
        attach(
          best.others
            ? `Attach it. ${best.others} other categor${best.others === 1 ? 'y covers' : 'ies cover'} this site if you need more than one.`
            : 'Attach it.',
        ),
      )
    } else {
      consentLeg.push(attach('Search for the category that covers this site, then attach it.'))
    }

    return numbered([
      ...stepsToStandardsTab().map(({ id: _id, ...step }) => step),
      openSubTab(SELECTORS.subTabRules, 'Tag & Variable Rules'),
      attach('Add the rules this audit should check.'),
      ...consentLeg,
      openSubTab(SELECTORS.subTabAlerts, 'Alerts'),
      attach('Add the alerts that should fire when a run breaches them.'),
    ])
  },
}
