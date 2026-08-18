import {
  stepsToStandardsTab,
  standardsSubTabSteps,
  saveAuditStep,
  auditParameters,
} from './_audit-standards.js'
import { bestCategoryFor } from './_consent-matching.js'

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
  parameters: [
    ...auditParameters('All standards'),
    // Optional, and only ever set by a chain: the walkthrough before this one
    // created them, so they are newer than any account snapshot we could read.
    {
      name: 'ruleName',
      description: 'A rule to attach by name, if one was just created',
      required: false,
      default: '',
    },
    {
      name: 'alertName',
      description: 'An alert to attach by name, if one was just created',
      required: false,
      default: '',
    },
  ],

  buildSummary(context) {
    const best = bestCategoryFor(context)
    const found = [
      Array.isArray(context?.account?.rules) && context.account.rules.length
        ? `${context.account.rules.length} rules`
        : null,
      best ? 'a matching consent category' : null,
      Array.isArray(context?.account?.alerts) && context.account.alerts.length
        ? `${context.account.alerts.length} alerts`
        : null,
    ].filter(Boolean)

    const named = found.length
      ? ` Your account has ${found.join(', ')} — we'll name the ones to attach as we go.`
      : ''

    return (
      'Rules, Consent Categories and Alerts are three sub-tabs of one Standards screen, so this ' +
      'is a single audit rather than three. We\'ll create "{{parameters.auditName}}" against ' +
      `{{parameters.siteUrl}} and attach all three.${named}`
    )
  },

  buildSteps(context) {
    // The three legs live in _audit-standards.js, because edit_audit_add_standards
    // needs exactly them and nothing else. From the Standards tab onward the two
    // recipes are the same walkthrough; they differ only in how they get there.
    const stripId = ({ id: _id, ...step }) => step

    return numbered([
      ...stepsToStandardsTab().map(stripId),
      ...standardsSubTabSteps(context).map(stripId),
      saveAuditStep(null),
    ])
  },
}
