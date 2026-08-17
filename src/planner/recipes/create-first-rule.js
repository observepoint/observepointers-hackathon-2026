import { NAV, stepsToLibrary } from './_standards-library.js'
import { unswept } from './_unswept.js'
import { ruleNameFrom } from '../naming.js'

/**
 * The empty-account case for tag validation.
 *
 * `audit_with_rules` says "search your rule library and add the rules you
 * want". On an account with no rules that step points at an empty list, and the
 * walkthrough has walked someone into a dead end. This is the recipe that fills
 * the library first.
 *
 * WHERE IT STOPS, AND WHY
 *
 * At the rule builder's first screen, with the rule named. It does not try to
 * drive the conditions grid — rule-setup-conditions-tab is a tag/variable
 * matrix whose right answer depends on which analytics stack the user runs and
 * what they consider correct. Filling it from a one-line description would
 * produce a rule that passes or fails for reasons nobody intended, which is
 * worse than an empty one.
 *
 * SELECTORS — every one read out of the template that renders it, and NOT ONE
 * of them swept. `unverified` means "nobody has watched this resolve", so all
 * five carry it until someone stands on these screens and presses Check screen.
 * Being confident about source is not the same as having looked.
 *   Sourced — sidebar links (opLinkSelectorMap), rule-setup-continue-btn and
 *             rule-setup-save-btn (RuleSetupOpSelectors, rendered straight onto
 *             the <button> by op-modal-footer-buttons)
 *   Sourced — button[aria-label="Create Rule"]. op-button-2021 binds
 *             [attr.aria-label]="ariaLabel || labelText", and rule-library's
 *             template sets labelText="Create Rule". Semantic, not positional.
 *   Sourced — rule-name-control input. Same component-tag trick as the audit
 *             editor's name field; Angular renders the tag for real.
 */
export default {
  id: 'create_first_rule',
  title: 'Create your first tag & variable rule',
  verified: false,
  intent: {
    description:
      'Create a Tag & Variable Rule in the rule library, from scratch. Use when the account has ' +
      'no rules yet, or when someone wants a new rule rather than an audit that uses existing ' +
      'ones. A rule defines what "correct" means for a tag — an audit is what checks it.',
    examples: [
      'create a rule',
      'I want to make a tag rule',
      'set up a rule that checks Google Analytics fires',
      'we have no rules yet, help me start',
      'add a new tag and variable rule',
    ],
    keywords: [
      'create a rule',
      'create rule',
      'new rule',
      'make a rule',
      'add a rule',
      'first rule',
      'rule library',
      'no rules',
    ],
  },
  parameters: [
    {
      name: 'ruleSubject',
      // Phrased as a question, because questionFor() just appends "?" to this.
      description: 'What should this rule check',
      required: true,
      example: 'Google Analytics fires on every page',
    },
    {
      name: 'ruleName',
      description: 'A name for the rule',
      required: false,
      derive: ruleNameFrom,
    },
  ],
  summaryTemplate:
    'A rule defines what "correct" looks like; an audit is what checks it — so this comes first. ' +
    'We\'ll open the rule library and start one called "{{parameters.ruleName}}". You set the ' +
    'conditions, since only you know which tags and values count as right.',
  steps: unswept([
    ...stepsToLibrary({
      link: NAV.rulesLink,
      label: 'Tag & Variable Rules',
      route: '/rules/library',
    }),
    {
      id: 's2',
      actor: 'user',
      targetSelector: 'button[aria-label="Create Rule"]',
      say: 'Start a new rule.',
      targetFallback: { description: 'the "Create Rule" button' },
      completion: {
        type: 'dom_mutation',
        condition: 'visible',
        targetSelector: 'rule-name-control input',
      },
    },
    {
      id: 's3',
      actor: 'ai',
      targetSelector: 'rule-name-control input',
      say: 'Naming it "{{parameters.ruleName}}".',
      targetFallback: { description: 'the rule name field at the top of the builder' },
      action: { type: 'fill_text', value: '{{parameters.ruleName}}' },
      completion: { type: 'dom_event', value: 'change' },
    },
    {
      id: 's4',
      actor: 'user',
      targetSelector: '[op-selector="rule-setup-continue-btn"]',
      say: 'Pick the tag and the condition that make this rule pass, then continue.',
      targetFallback: { description: 'the Next button in the rule builder' },
      completion: { type: 'dom_event', value: 'click' },
    },
    {
      id: 's5',
      actor: 'user',
      targetSelector: '[op-selector="rule-setup-save-btn"]',
      say: "Save it. It's now attachable to any audit under Standards.",
      targetFallback: { description: 'the Save button in the rule builder' },
      completion: { type: 'dom_event', value: 'click' },
    },
  ]),
}
