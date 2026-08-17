import { NAV, stepsToLibrary } from './_standards-library.js'
import { alertNameFrom } from '../naming.js'
import { unswept } from './_unswept.js'

/**
 * The empty-account case for alerting — and the weakest of the three starters, for a
 * reason worth stating rather than hiding.
 *
 * THERE ARE TWO WAYS TO CREATE AN ALERT, AND THIS IS THE HARDER ONE
 *
 * `alert_from_report` starts from the bell on a report widget, which pre-fills the
 * metric and the filters because the widget already knows them. That is the better
 * path by a wide margin, and it is what "alert me when checkout breaks" should reach.
 * It needs an audit with a completed run.
 *
 * This recipe is the other door: the Alerts Library, for someone who has no run to
 * point at yet. The catch is in the library's own info text — "Alerts are based on
 * report widget data" — so from here you have to describe the metric from scratch in
 * a four-step designer (Logic → Notification → DataSources → Preview). We cannot fill
 * that in: which number matters, and what counts as too many, is the thing the user
 * knows and we do not.
 *
 * So it names the alert, points at each step, and gets out of the way. If you have a
 * report, use the bell instead — the summary says so.
 *
 * SELECTORS
 *   Sourced — sidebar-alerts (opLinkSelectorMap); alert-name-control input, the same
 *             element-tag pattern as rule-name-control, which is swept and works;
 *             alert-designer-{continue,save}-btn, added upstream because
 *             AlertComponent had no op-selectors at all.
 *   Sourced — button[aria-label="Create Alert"], from op-button-2021's labelText.
 *   Nothing here is swept.
 */
export default {
  id: 'create_first_alert',
  title: 'Create your first alert',
  intent: {
    description:
      'Create an Alert from the Alerts Library, from scratch, for an account with no alerts yet. ' +
      'An alert is a threshold on a number in an audit report — it emails someone when that number ' +
      'goes out of bounds. Prefer creating one from a report widget when a report exists, because ' +
      'the widget pre-fills the metric; use this when there is no run to point at.',
    examples: [
      'create an alert',
      'I want to set up an alert from scratch',
      'we have no alerts yet, help me make one',
      'add a new alert to the library',
      'build an alert threshold',
    ],
    keywords: [
      'create an alert',
      'create alert from scratch',
      'new alert',
      'first alert',
      'no alerts',
      'alerts library',
      'add an alert',
      'build an alert',
    ],
  },
  parameters: [
    {
      name: 'conditionSummary',
      // Phrased as a question: questionFor() appends "?" to this.
      description: 'What should this alert watch for',
      required: true,
      example: 'broken pages go above 10',
    },
    {
      name: 'alertName',
      description: 'A name for the alert',
      required: false,
      derive: alertNameFrom,
    },
  ],
  summaryTemplate:
    'Alerts are thresholds on report data, so the Library makes you describe the metric from scratch. ' +
    'If you already have an audit that has run, the bell on its report widget is easier — it fills the ' +
    'metric in for you. Otherwise: we\'ll start one called "{{parameters.alertName}}" and you set the number.',
  steps: unswept([
    ...stepsToLibrary({
      link: NAV.alertsLink,
      label: 'Alerts',
      route: '/alerts',
    }),
    {
      id: 's2',
      actor: 'user',
      targetSelector: 'button[aria-label="Create Alert"]',
      say: 'Start a new alert.',
      targetFallback: { description: 'the "Create Alert" button' },
      completion: {
        type: 'dom_mutation',
        condition: 'visible',
        targetSelector: 'alert-name-control input',
      },
    },
    {
      id: 's3',
      actor: 'ai',
      targetSelector: 'alert-name-control input',
      say: 'Naming it "{{parameters.alertName}}".',
      targetFallback: { description: 'the alert name field at the top of the designer' },
      action: { type: 'fill_text', value: '{{parameters.alertName}}' },
      completion: { type: 'dom_event', value: 'change' },
    },
    {
      id: 's4',
      actor: 'user',
      targetSelector: '[op-selector="alert-designer-continue-btn"]',
      say: 'Pick the report and metric to watch, set the threshold, then continue.',
      targetFallback: { description: 'the Next button in the alert designer' },
      completion: { type: 'dom_event', value: 'click' },
    },
    {
      id: 's5',
      actor: 'user',
      targetSelector: '[op-selector="alert-designer-continue-btn"]',
      say: 'Add who should be notified, then continue.',
      targetFallback: { description: 'the Next button in the alert designer' },
      completion: { type: 'dom_event', value: 'click' },
    },
    {
      id: 's6',
      actor: 'user',
      targetSelector: '[op-selector="alert-designer-save-btn"]',
      say: 'Choose the audits it applies to, then Save.',
      targetFallback: { description: 'the Save button in the alert designer' },
      completion: { type: 'dom_event', value: 'click' },
    },
  ]),
}
