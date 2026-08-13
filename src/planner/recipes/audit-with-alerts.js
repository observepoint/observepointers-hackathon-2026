import { SELECTORS, stepsToStandardsTab, AUDIT_PARAMETERS } from './_audit-standards.js'

/**
 * Attach existing alerts to an audit, so a run that goes out of compliance
 * notifies someone instead of sitting in a report nobody opens.
 *
 * Note the ordering constraint this recipe encodes: alerts are attached to an
 * audit the same way rules and consent categories are — from the Standards tab
 * — and they fire on *report widget data*. So an alert is only meaningful once
 * the audit produces the data it watches. Attaching alerts to a brand-new audit
 * is legitimate, but nothing fires until the first run completes.
 */
export default {
  id: 'audit_with_alerts',
  title: 'Attach alerts to an audit',
  verified: false,
  intent: {
    description:
      'Create a web audit and attach existing alerts under Standards, so runs that breach a ' +
      'threshold notify someone. Use when the user wants to be told about problems rather than ' +
      'having to go and look.',
    examples: [
      'set up an audit and alert me if something breaks',
      'add alerts to my audit',
      'I want to be notified when the audit finds problems',
      'audit example.com and email me the failures',
    ],
    keywords: [
      'attach alert',
      'add alert',
      'alerts to audit',
      'audit and alert',
      'notify me',
      'email me',
      'tell me when',
      'be alerted',
      'alert me',
    ],
  },
  parameters: AUDIT_PARAMETERS,
  summaryTemplate:
    'We\'ll create an audit called "{{parameters.auditName}}" against {{parameters.siteUrl}} and attach ' +
    'alerts under Standards. Alerts watch report data, so nothing fires until the first run finishes.',
  steps: [
    ...stepsToStandardsTab(),
    {
      id: 's7',
      actor: 'user',
      targetSelector: SELECTORS.subTabAlerts,
      say: 'Alerts is the third sub-tab.',
      targetFallback: { description: 'the "Alerts" sub-tab' },
      unverified: true,
      completion: {
        type: 'dom_mutation',
        condition: 'visible',
        targetSelector: '.op-standards-selector',
      },
    },
    {
      id: 's8',
      actor: 'user',
      targetSelector: SELECTORS.standardsSearch,
      say: 'Find the alerts you want on this audit.',
      targetFallback: { description: 'the search box in the alerts picker' },
      unverified: true,
      completion: { type: 'dom_event', value: 'input' },
    },
    {
      id: 's9',
      actor: 'user',
      targetSelector: SELECTORS.standardsAddAll,
      say: "Attach them. They evaluate against this audit's report data after each run — so expect the first notification only once a run has finished.",
      targetFallback: { description: 'the "add all" button in the alerts picker' },
      unverified: true,
      completion: { type: 'dom_event', value: 'click' },
    },
    {
      id: 's10',
      actor: 'user',
      targetSelector: SELECTORS.standardsCreateNew,
      say: 'No alert fits? Create one here. It is usually easier to run the audit once first and create the alert from the report widget you actually care about.',
      targetFallback: { description: 'the "Create New Alert" button' },
      unverified: true,
      completion: { type: 'dom_event', value: 'click' },
    },
  ],
}
