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
      default: 'Copilot alert',
    },
  ],
  summaryTemplate:
    "Alerts in ObservePoint watch a number on a report widget, so we'll open the audit report, find the " +
    'widget that shows "{{parameters.conditionSummary}}", and create the alert from its bell icon — that ' +
    'pre-fills the metric and filters. Notifications go to {{parameters.notifyEmail}}.',
  steps: [
    {
      id: 's1',
      actor: 'user',
      navContext: '/data-sources',
      targetSelector: '[op-selector="cards-view-container"]',
      say: 'Open the audit whose report you want to watch. It needs at least one completed run — alerts read report data, so there is nothing to threshold until then.',
      targetFallback: { description: 'the audit card on the Data Sources page' },
      unverified: true,
      completion: { type: 'url_change', value: '/audit' },
    },
    {
      id: 's2',
      actor: 'user',
      targetSelector: '.create-new-alert-icon',
      say: 'Find the widget showing "{{parameters.conditionSummary}}" and click its bell. Creating the alert from the widget means the metric and filters are filled in for you.',
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
      say: 'Naming it "{{parameters.alertName}}" — this is what appears in the notification, so make it obvious at 3am.',
      action: { type: 'fill_text', value: '{{parameters.alertName}}' },
      completion: { type: 'dom_event', value: 'change' },
    },
    {
      id: 's4',
      actor: 'ai',
      targetSelector: '[op-selector="quick-create-emails"] input',
      say: 'Sending notifications to {{parameters.notifyEmail}}.',
      action: { type: 'fill_text', value: '{{parameters.notifyEmail}}' },
      completion: { type: 'dom_event', value: 'change' },
    },
    {
      id: 's5',
      actor: 'user',
      targetSelector: '[op-selector="quick-create-customize-link"]',
      say: 'The default threshold is a sensible starting point. Customize it if "{{parameters.conditionSummary}}" needs a specific number rather than any change.',
      completion: { type: 'dom_event', value: 'click' },
    },
    {
      id: 's6',
      actor: 'user',
      targetSelector: '[op-selector="quick-create-save-button"] button',
      say: 'Save it. It evaluates after each run of this audit from now on.',
      targetFallback: { description: 'the save button in the alert quick-create dialog' },
      completion: { type: 'dom_event', value: 'click' },
    },
  ],
}
