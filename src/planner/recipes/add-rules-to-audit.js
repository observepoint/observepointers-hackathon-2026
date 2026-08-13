/**
 * PARTIALLY VERIFIED.
 *   VERIFIED : [op-selector="rules-tab"], [op-selector="add-rules-to-configuration-btn"],
 *              [op-selector="add-all-btn"], [op-selector="add-btn"]
 *              (components/audit-reports/..., components/actions/...)
 *   GUESSED  : how the user gets to a specific audit's configuration. That
 *              depends on which audit they're on, so it's left as a nav step
 *              the user drives.
 */
export default {
  id: 'add_rules_to_audit',
  title: 'Attach rules to an audit',
  verified: false,
  intent: {
    description:
      'Apply existing rules to an audit so the audit reports pass/fail against them. ' +
      'Use when the user already has rules and wants an audit to evaluate them.',
    examples: [
      'how do I add rules to my audit',
      'apply my tag rules to this audit',
      'I want this audit to check my rules',
    ],
    keywords: ['add rules', 'attach rules', 'apply rules', 'rules to audit', 'rule to audit'],
  },
  parameters: [
    {
      name: 'auditName',
      description: 'Which audit to add the rules to',
      required: true,
      example: 'Q3 Production Audit',
    },
  ],
  summaryTemplate:
    'Open "{{parameters.auditName}}", switch to its Rules tab, and add the rules you want it to evaluate on every run.',
  steps: [
    {
      id: 's1',
      actor: 'user',
      navContext: '/data-sources',
      targetSelector: '[op-selector="top-nav-search-trigger"]',
      say: 'Find "{{parameters.auditName}}" — search is faster than browsing the folder tree.',
      targetFallback: { description: 'the global search box in the top nav' },
      completion: { type: 'dom_event', value: 'click' },
    },
    {
      id: 's2',
      actor: 'ai',
      targetSelector: '[op-selector="top-nav-search-input"] input',
      say: 'Searching for it.',
      action: { type: 'fill_text', value: '{{parameters.auditName}}' },
      completion: {
        type: 'dom_mutation',
        condition: 'visible',
        targetSelector: '[op-selector="top-nav-search-result"]',
      },
    },
    {
      id: 's3',
      actor: 'user',
      targetSelector: '[op-selector="top-nav-search-result"]',
      say: 'Open it.',
      completion: { type: 'url_change', value: '/audit' },
    },
    {
      id: 's4',
      actor: 'user',
      targetSelector: '[op-selector="rules-tab"]',
      say: "The Rules tab is where an audit's rule set lives.",
      completion: { type: 'dom_event', value: 'click' },
    },
    {
      id: 's5',
      actor: 'user',
      targetSelector: '[op-selector="add-rules-to-configuration-btn"]',
      say: 'Add rules here. Anything you attach gets evaluated on every run of this audit from now on.',
      completion: { type: 'dom_event', value: 'click' },
    },
    {
      id: 's6',
      actor: 'user',
      targetSelector: '[op-selector="add-btn"]',
      say: 'Pick the rules you want, then add them. Start narrow — you can always attach more later.',
      completion: { type: 'dom_event', value: 'click' },
    },
  ],
}
