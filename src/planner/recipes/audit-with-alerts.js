import { SELECTORS, stepsToStandardsTab, auditParameters } from './_audit-standards.js'

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
  parameters: auditParameters('Alerting'),
  summaryTemplate:
    'We\'ll create an audit called "{{parameters.auditName}}" against {{parameters.siteUrl}} and attach ' +
    'alerts under Standards. Alerts watch report data, so nothing fires until the first run finishes.',
  buildSteps(context) {
    return [
      ...stepsToStandardsTab({ advanced: context.account?.advancedAuditMode !== false }),
      {
        id: 's7',
        actor: 'user',
        targetSelector: SELECTORS.subTabAlerts,
        say: 'Open Alerts.',
        targetFallback: { description: 'the "Alerts" sub-tab' },
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
        say: 'Search your alerts.',
        targetFallback: { description: 'the search box in the alerts picker' },
        completion: { type: 'dom_event', value: 'input' },
      },
      {
        id: 's9',
        actor: 'user',
        targetSelector: SELECTORS.standardsAddAll,
        say: 'Attach them.',
        targetFallback: { description: 'the "add all" button in the alerts picker' },
        completion: { type: 'dom_event', value: 'click' },
      },
      {
        id: 's10',
        actor: 'user',
        targetSelector: SELECTORS.standardsCreateNew,
        say: 'Nothing fits? Create an alert here instead.',
        targetFallback: { description: 'the "Create New Alert" button' },
        completion: { type: 'dom_event', value: 'click' },
      },
    ]
  },
}
