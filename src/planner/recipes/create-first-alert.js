import { NAV, stepsToLibrary } from './_standards-library.js'
import { alertNameFrom, hostFrom } from '../naming.js'
import { unswept } from './_unswept.js'

/**
 * Create an Alert from the Alerts Library, all the way through the designer.
 *
 * WHAT CHANGED, AND WHY IT WAS WORTH CHANGING
 *
 * This recipe used to stop at "Pick the report and metric to watch, set the
 * threshold, then continue" — three screens' worth of work in one sentence. The
 * reasoning was that only the user knows which number matters. That is true of the
 * THRESHOLD and false of everything around it, and the two got conflated.
 *
 * The metric picker is a four-level nested mat-menu (report → section → metric →
 * sub-metric) built from a config array. Nobody finds "Rule Failures" in it by being
 * told to look. But the labels come from constants — AlertReportsToAuditMetrics — so
 * they can be pointed at exactly, which is the difference between a walkthrough and a
 * gesture at a menu.
 *
 * WHY "> 0" IS A DEFAULT AND NOT A GUESS
 *
 * For a rule-failure alert the threshold genuinely is zero: a rule that fails at all
 * has failed. That is not true of "broken pages" or "load time", where the number is
 * a judgement — so the threshold is a parameter, and its default only holds because
 * the default metric is rule failures.
 *
 * TWO FIELDS WE TYPE AND CANNOT COMMIT
 *
 * The URL filter and the subscriber list are both commit-on-Enter — op-filter-bar
 * reads its input on keyup, and the recipients control turns text into a chip on
 * Enter. Setting .value and firing input/change puts the text in the box and does not
 * register it. Rather than fake keystrokes, the copy says to press Enter, and the
 * Continue button means the walkthrough waits until it has been done. Honest about
 * a limitation beats a step that looks like it worked.
 *
 * THE EMAIL IS ASKED FOR UP FRONT
 *
 * `notifyEmail` is required, so an unstated one becomes the planner's single
 * clarifying question before the walkthrough starts — not a stall on step twelve.
 *
 * SELECTORS
 *   Added upstream — alert-designer-{continue,save}-btn. AlertComponent had none.
 *     Both are visible from the first screen (saveButton.hidden is only set in edit
 *     mode), so one pair of selectors covers all four steps.
 *   Semantic, no patch needed — input[aria-label="Select report metric"],
 *     input[aria-label="Search by URL"] (op-filter-bar builds it from
 *     searchByTextPlaceholderSuffix), mat-chip-grid#email-chip-grid input,
 *     and the alert-trigger form controls.
 *   Product vocabulary — the menu path and the operator, matched by label.
 *   Nothing here is swept.
 */

const SELECTORS = {
  createAlert: 'button[aria-label="Create Alert"]',
  name: 'alert-name-control input',
  metric: 'input[aria-label="Select report metric"]',
  menuItem: 'button[mat-menu-item]',
  operator: 'alert-trigger mat-select[formControlName="operator"]',
  // Scoped to the operator select's own panelClass. A bare `mat-option` spans every
  // open overlay, and "Greater than (>)" would be matched against whatever else
  // happened to be on screen -- see the note in create-tag-variable-rule.js, where a
  // sweep caught exactly that resolving to the wrong row.
  option: '.alert-operator-selector mat-option',
  targetValue: 'alert-trigger input[formControlName="targetValue"]',
  urlFilter: 'input[aria-label="Search by URL"]',
  emails: 'mat-chip-grid#email-chip-grid input',
  next: '[op-selector="alert-designer-continue-btn"]',
  save: '[op-selector="alert-designer-save-btn"]',
}

/**
 * The path through the metric menu, as labels.
 *
 * Three levels for this one: the report group, the report, then the metric. Held as a
 * list rather than three parameters so a different metric is a different list and not
 * a different recipe — "Pages → Broken Initial Pages" is two links instead of three
 * and the steps generate themselves either way.
 */
const DEFAULT_METRIC_PATH = ['Audits', 'Tag & Variable Rules', 'Rule Failures']

/**
 * Operator labels include the sign, and they have to.
 *
 * The menu renders "{{title}} ({{sign}})", and "Greater than" is a prefix of "Greater
 * than or equal to" — so matching on the words alone would resolve to whichever came
 * first in the list, which is the wrong one. The sign is what makes it unambiguous.
 */
const DEFAULT_OPERATOR = 'Greater than (>)'

const numbered = steps => steps.map((step, i) => ({ ...step, id: `s${i + 1}` }))

export default {
  id: 'create_first_alert',
  title: 'Create an alert',
  intent: {
    description:
      'Create an Alert from the Alerts Library and set up its whole definition: which report ' +
      'metric to watch, the threshold that trips it, which pages it applies to, and who gets ' +
      'emailed. An alert is a threshold on a number in an audit report. Prefer creating one from ' +
      'a report widget when a report already exists, because the widget pre-fills the metric.',
    examples: [
      'create an alert',
      'alert me if any rules fail',
      'email me when something breaks',
      'we have no alerts yet, help me make one',
      'notify me if rule failures go above zero',
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
      'alert me if',
      'email me when',
    ],
  },
  parameters: [
    {
      name: 'notifyEmail',
      // Required, so it is asked once up front rather than discovered on step twelve.
      description: 'Who should this alert email',
      required: true,
      example: 'you@yourcompany.com',
    },
    {
      name: 'siteUrl',
      description: 'Which site should this alert watch',
      required: false,
      default: '',
      // Gates the URL-filter step, so the sweep needs it. See allKnownSelectors().
      example: 'https://www.example.com',
    },
    {
      name: 'threshold',
      description: 'What number should trip this alert',
      required: false,
      // Right for rule failures — one failure is a failure — and only because that
      // is the default metric.
      default: '0',
    },
    {
      name: 'alertName',
      description: 'A name for the alert',
      required: false,
      derive: alertNameFrom,
    },
  ],

  buildSummary(context) {
    const host = hostFrom(context.parameters?.siteUrl)
    const scope = host ? ` on ${host}` : ''
    return (
      'An alert is a threshold on a number in an audit report. The metric lives four levels down ' +
      "a nested menu, so we'll point at each one: Audits → Tag & Variable Rules → Rule Failures, " +
      `greater than ${context.parameters?.threshold ?? 0}${scope}. You confirm the email.`
    )
  },

  buildSteps(context) {
    const path = DEFAULT_METRIC_PATH
    const host = hostFrom(context.parameters?.siteUrl)

    const steps = [
      ...stepsToLibrary({
        link: NAV.alertsLink,
        label: 'Alerts',
        route: '/alerts',
      }).map(({ id: _id, ...step }) => step),
      {
        actor: 'user',
        targetSelector: SELECTORS.createAlert,
        say: 'Start a new alert.',
        targetFallback: { description: 'the "Create Alert" button' },
        completion: { type: 'dom_mutation', condition: 'visible', targetSelector: SELECTORS.name },
      },
      {
        actor: 'ai',
        targetSelector: SELECTORS.name,
        say: 'Naming it "{{parameters.alertName}}".',
        targetFallback: { description: 'the alert name field at the top of the designer' },
        action: { type: 'fill_text', value: '{{parameters.alertName}}' },
        completion: { type: 'dom_event', value: 'change' },
      },
      {
        actor: 'user',
        targetSelector: SELECTORS.metric,
        say: 'Open Report Metric.',
        targetFallback: { description: 'the "Report Metric" field' },
        completion: {
          type: 'dom_mutation',
          condition: 'visible',
          targetSelector: SELECTORS.menuItem,
        },
      },
    ]

    // One step per level. The last one closes the menu instead of opening another, so
    // it waits on the Operator field appearing rather than on more menu items.
    path.forEach((label, index) => {
      const last = index === path.length - 1
      steps.push({
        actor: 'user',
        targetSelector: `${SELECTORS.menuItem} >> text=${label}`,
        say: last ? `Choose "${label}" — that's the metric.` : `Open "${label}".`,
        targetFallback: { description: `"${label}" in the report metric menu` },
        completion: last
          ? { type: 'dom_mutation', condition: 'visible', targetSelector: SELECTORS.operator }
          : { type: 'dom_event', value: 'click' },
      })
    })

    steps.push(
      {
        actor: 'user',
        targetSelector: SELECTORS.operator,
        say: 'Open Operator.',
        targetFallback: { description: 'the Operator dropdown' },
        completion: {
          type: 'dom_mutation',
          condition: 'visible',
          targetSelector: SELECTORS.option,
        },
      },
      {
        actor: 'user',
        targetSelector: `${SELECTORS.option} >> text=${DEFAULT_OPERATOR}`,
        say: `Choose "${DEFAULT_OPERATOR}".`,
        targetFallback: { description: `the "${DEFAULT_OPERATOR}" option` },
        completion: { type: 'dom_event', value: 'click' },
      },
      {
        actor: 'ai',
        targetSelector: SELECTORS.targetValue,
        say: 'Setting the threshold to {{parameters.threshold}} — one failure is a failure.',
        targetFallback: { description: 'the threshold value field' },
        action: { type: 'fill_text', value: '{{parameters.threshold}}' },
        completion: { type: 'dom_event', value: 'change' },
      },
    )

    if (host) {
      steps.push({
        actor: 'ai',
        targetSelector: SELECTORS.urlFilter,
        say: `Typed "${host}" — press Enter to apply it, then Continue.`,
        targetFallback: { description: 'the "Search By URL" box under FILTER PAGES' },
        action: { type: 'fill_text', value: host },
        completion: { type: 'dom_event', value: 'change' },
      })
    }

    steps.push(
      {
        actor: 'user',
        targetSelector: SELECTORS.next,
        say: 'Next — on to who gets notified.',
        targetFallback: { description: 'the Next button in the alert designer' },
        completion: {
          type: 'dom_mutation',
          condition: 'visible',
          targetSelector: SELECTORS.emails,
        },
      },
      {
        actor: 'ai',
        targetSelector: SELECTORS.emails,
        say: 'Typed {{parameters.notifyEmail}} — press Enter to add it, then Continue.',
        targetFallback: { description: 'the subscribers field' },
        action: { type: 'fill_text', value: '{{parameters.notifyEmail}}' },
        completion: { type: 'dom_event', value: 'change' },
      },
      {
        actor: 'user',
        targetSelector: SELECTORS.next,
        say: 'Next — on to which audits it applies to.',
        targetFallback: { description: 'the Next button in the alert designer' },
        completion: { type: 'dom_event', value: 'click' },
      },
      {
        actor: 'user',
        targetSelector: SELECTORS.next,
        say: 'Next — the preview shows what would have triggered.',
        targetFallback: { description: 'the Next button in the alert designer' },
        completion: { type: 'dom_event', value: 'click' },
      },
      {
        actor: 'user',
        targetSelector: SELECTORS.save,
        say: "Save it. It's now attachable to any audit under Standards.",
        targetFallback: { description: 'the Save button in the alert designer' },
        completion: { type: 'dom_event', value: 'click' },
      },
    )

    return unswept(numbered(steps))
  },
}
