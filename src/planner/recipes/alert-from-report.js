/**
 * "Alert me when X breaks" — the flow the whole pitch is built on.
 *
 * The important discovery: ObservePoint alerts are not free-form "watch this
 * website" monitors. They are thresholds on **report widget data**
 * (alerts-library.component.html says so in its own info text: "Alerts are
 * based on report widget data"). So the natural way to create one is not from
 * the Alerts Library at all — it is the bell icon on the widget you care about,
 * which pre-fills the metric and the filters for you.
 *
 * That's why this recipe starts from a report rather than from the library: the
 * library route makes you describe the metric from scratch, and a user who
 * could do that wouldn't need us.
 *
 * The prerequisite is real and worth stating up front: alerts watch report
 * data, so the audit has to have run at least once. Pointing someone at an
 * empty report is a worse failure than telling them to wait.
 *
 * SELECTORS
 *   Solid — QuickCreateOpSelectors (alert/alert-quick-create/…constants.ts)
 *   Weak  — .create-new-alert-icon, the bell on op-widget-bell. Class only, no
 *           op-selector; and there is one bell per widget, so which one matters.
 */
import { alertNameFrom } from '../naming.js'

export default {
  id: 'alert_from_report',
  title: 'Get alerted when something breaks',
  verified: false,
  intent: {
    description:
      'Create an alert from an audit report widget, so a threshold breach emails someone. ' +
      'This is the "tell me when the site stops doing X" request. Requires an audit that has ' +
      'already run, because alerts watch report data.',
    examples: [
      'I want to be alerted when this website fails to fire the purchase tag',
      'notify me if checkout breaks',
      'email me when our analytics stops working on the pricing page',
      'tell me when a tag goes missing',
      'alert me if broken pages go above 10',
    ],
    keywords: [
      'alert me when',
      'notify me when',
      'tell me when',
      'email me when',
      'alert when',
      'stops working',
      'goes missing',
      'fails to fire',
      'breaks',
      'threshold',
      'create alert',
    ],
  },
  parameters: [
    {
      name: 'conditionSummary',
      description: 'What should trigger the alert, in your own words',
      required: true,
      example: 'the purchase tag stops firing',
    },
    {
      name: 'notifyEmail',
      description: 'Who should be notified',
      required: false,
      default: 'your account email',
    },
    {
      name: 'alertName',
      description: 'A name for the alert',
      required: false,
      derive: alertNameFrom,
    },
  ],
  summaryTemplate:
    'Alerts watch a number on a report widget, so the audit needs at least one completed run first. ' +
    'We\'ll open its report, find the widget showing "{{parameters.conditionSummary}}", and create the ' +
    'alert from its bell — that pre-fills the metric and filters. Notifications go to ' +
    '{{parameters.notifyEmail}}.',
  steps: [
    {
      id: 's1',
      actor: 'user',
      navContext: '/sources',
      targetSelector: '[op-selector="cards-view-container"]',
      say: 'Open the audit you want to watch.',
      targetFallback: { description: 'the audit card on the Data Sources page' },
      unverified: true,
      completion: { type: 'url_change', value: '/audit' },
    },
    {
      id: 's2',
      actor: 'user',
      targetSelector: '.create-new-alert-icon',
      say: 'Click the bell on the widget showing "{{parameters.conditionSummary}}".',
      targetFallback: { description: 'the bell icon on the report widget' },
      unverified: true,
      completion: {
        type: 'dom_mutation',
        condition: 'visible',
        targetSelector: '[op-selector="quick-create-name"]',
      },
    },
    {
      id: 's3',
      actor: 'ai',
      targetSelector: '[op-selector="quick-create-name"] input',
      say: 'Naming it "{{parameters.alertName}}".',
      action: { type: 'fill_text', value: '{{parameters.alertName}}' },
      completion: { type: 'dom_event', value: 'change' },
    },
    {
      id: 's4',
      actor: 'ai',
      targetSelector: '[op-selector="quick-create-emails"] input',
      say: 'Notifying {{parameters.notifyEmail}}.',
      action: { type: 'fill_text', value: '{{parameters.notifyEmail}}' },
      completion: { type: 'dom_event', value: 'change' },
    },
    {
      id: 's5',
      actor: 'user',
      targetSelector: '[op-selector="quick-create-customize-link"]',
      say: 'Adjust the threshold if you need a specific number.',
      completion: { type: 'dom_event', value: 'click' },
    },
    {
      id: 's6',
      actor: 'user',
      targetSelector: '[op-selector="quick-create-save-button"] button',
      say: 'Save it.',
      targetFallback: { description: 'the save button in the alert quick-create dialog' },
      completion: { type: 'dom_event', value: 'click' },
    },
  ],
}
