/**
 * PARTIALLY VERIFIED — this is the flow the hackathon pitch is built on
 * ("alert me when this site fails to do X"), and it is the one that most needs
 * a human pass before demo day.
 *
 *   VERIFIED : /alerts-library route, /rules route, [op-selector="rules-tab"],
 *              [op-selector="add-rules-to-configuration-btn"]
 *   GUESSED  : every selector marked `unverified` below. moonbeam has ~163
 *              op-selector attributes and almost all of them are on top-nav,
 *              api-keys, archived-items and report tabs — alert and rule
 *              *creation* screens have none.
 *
 * Two ways to fix a guessed selector, both cheap:
 *   1. Open the screen, inspect the control, paste the real selector here.
 *   2. Better: add an op-selector attribute in moonbeam and use that. It is a
 *      one-line change and it makes the pointer reliable for everyone.
 *
 * `targetFallback` is an ADDITIVE field — Part 2 can ignore it today. It gives
 * Part 3 a human description to match on when the CSS selector misses, which is
 * how the pointer already resolves things ("the button to create an alert").
 */
export default {
  id: 'alert_on_rule_failure',
  title: 'Get alerted when a site stops doing something',
  verified: false,
  intent: {
    description:
      'Set up monitoring that emails or notifies the user when a page stops firing a tag, ' +
      'stops meeting a rule, or otherwise breaks. Combines a rule (what "broken" means) ' +
      'with an alert (who gets told).',
    examples: [
      'I want to be alerted when this website fails to fire the purchase tag',
      'notify me if checkout breaks',
      'email me when our analytics stops working on the pricing page',
      'tell me when a tag goes missing',
    ],
    keywords: [
      'alert',
      'notify',
      'email me',
      'tell me when',
      'monitor',
      'watch',
      'fails',
      'breaks',
      'stops working',
    ],
  },
  parameters: [
    {
      name: 'siteUrl',
      description: 'The page or site to watch',
      required: true,
      example: 'https://www.example.com/checkout',
    },
    {
      name: 'conditionSummary',
      description: 'What counts as "broken", in the user\'s own words',
      required: true,
      example: 'the purchase tag does not fire',
    },
    {
      name: 'ruleName',
      description: 'Name for the rule that detects the failure',
      required: false,
      default: 'Copilot: failure check',
    },
    {
      name: 'notifyEmail',
      description: 'Who to notify',
      required: false,
      default: 'your account email',
    },
  ],
  summaryTemplate:
    'Two things have to exist: a rule that defines "{{parameters.conditionSummary}}" as a failure, ' +
    "and an alert that watches it. We'll build the rule first, then attach the alert, then point it at {{parameters.siteUrl}}.",
  steps: [
    {
      id: 's1',
      actor: 'user',
      navContext: '/rules',
      targetSelector: '[op-selector="top-nav-search-trigger"]',
      say: 'Start with the rule — that is the part that actually detects the failure. Search is the quickest way to the Rule Library.',
      targetFallback: { description: 'the global search box in the top nav' },
      completion: { type: 'dom_event', value: 'click' },
    },
    {
      id: 's2',
      actor: 'ai',
      targetSelector: '[op-selector="top-nav-search-input"] input',
      say: 'Jumping to the Rule Library.',
      action: { type: 'fill_text', value: 'Rule Library' },
      completion: { type: 'url_change', value: '/rules' },
      unverified: true,
    },
    {
      id: 's3',
      actor: 'user',
      targetSelector: '[data-testid="create-rule"]',
      say: 'Create a new rule. This is where you say what "{{parameters.conditionSummary}}" means in ObservePoint terms.',
      targetFallback: { description: 'the button to create a new rule' },
      completion: { type: 'url_change', value: '/rules' },
      unverified: true,
    },
    {
      id: 's4',
      actor: 'ai',
      targetSelector: 'input[formcontrolname="name"]',
      say: 'Naming it "{{parameters.ruleName}}" — this is the name you\'ll see in the alert email, so make it obvious.',
      action: { type: 'fill_text', value: '{{parameters.ruleName}}' },
      completion: { type: 'dom_event', value: 'change' },
      unverified: true,
    },
    {
      id: 's5',
      actor: 'user',
      targetSelector: '[data-testid="rule-condition-add"]',
      say: 'Add the condition itself: {{parameters.conditionSummary}}. Pick the tag you care about and set it to alert when it is missing.',
      targetFallback: { description: 'the button to add a rule condition' },
      completion: { type: 'dom_event', value: 'click' },
      unverified: true,
    },
    {
      id: 's6',
      actor: 'user',
      navContext: '/alerts-library',
      targetSelector: '[data-testid="nav-alerts"]',
      say: 'Rule saved. Now the alert — that is what decides who hears about it.',
      targetFallback: { description: 'the Alerts Library nav item' },
      completion: { type: 'url_change', value: '/alerts-library' },
      unverified: true,
    },
    {
      id: 's7',
      actor: 'user',
      targetSelector: '[data-testid="create-alert"]',
      say: 'Create the alert and point it at the rule you just made, watching {{parameters.siteUrl}}. Notifications go to {{parameters.notifyEmail}}.',
      targetFallback: { description: 'the button to create a new alert' },
      completion: { type: 'dom_event', value: 'click' },
      unverified: true,
    },
  ],
}
