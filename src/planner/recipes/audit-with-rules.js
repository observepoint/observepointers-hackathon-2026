import { SELECTORS, stepsToStandardsTab, AUDIT_PARAMETERS } from './_audit-standards.js'

/**
 * The bread-and-butter flow: an audit that checks tag & variable rules on every
 * run. This is what someone means by "make sure our tags keep working".
 */
export default {
  id: 'audit_with_rules',
  title: 'Create an audit that checks your tag rules',
  verified: false,
  intent: {
    description:
      'Create a web audit and attach Tag & Variable Rules to it, so every run checks whether ' +
      'tags fire correctly and reports pass/fail. Use when someone wants ongoing validation that ' +
      'their analytics or marketing tags are working.',
    examples: [
      'set up an audit that checks my tag rules',
      'I want to audit example.com and validate our tags',
      'create an audit with rules for our checkout pages',
      'make sure our analytics tags keep firing on the site',
    ],
    keywords: [
      'audit with rules',
      'audit rules',
      'tag rules',
      'variable rules',
      'validate tags',
      'check tags',
      'tags firing',
      'create an audit',
      'set up an audit',
      'new audit',
    ],
  },
  parameters: AUDIT_PARAMETERS,
  summaryTemplate:
    'We\'ll create an audit called "{{parameters.auditName}}" against {{parameters.siteUrl}}, then attach ' +
    'your Tag & Variable Rules under Standards so every run reports pass/fail against them.',
  steps: [
    ...stepsToStandardsTab(),
    {
      id: 's7',
      actor: 'user',
      targetSelector: SELECTORS.subTabRules,
      say: 'Tag & Variable Rules is the first sub-tab. This is what makes an audit check things rather than just crawl.',
      targetFallback: { description: 'the "Tag & Variable Rules" sub-tab' },
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
      say: 'Search your rule library for the ones you want. Start narrow — a few rules you trust beats every rule you own, because a noisy audit gets ignored.',
      targetFallback: { description: 'the search box in the rules picker' },
      unverified: true,
      completion: { type: 'dom_event', value: 'input' },
    },
    {
      id: 's9',
      actor: 'user',
      targetSelector: SELECTORS.standardsAddAll,
      say: 'Add the ones you found. Anything on the right-hand side is evaluated on every run of this audit.',
      targetFallback: { description: 'the "add all" button in the rules picker' },
      unverified: true,
      completion: { type: 'dom_event', value: 'click' },
    },
    {
      id: 's10',
      actor: 'user',
      targetSelector: SELECTORS.standardsCreateNew,
      say: 'If no existing rule covers {{parameters.siteUrl}}, create one from here — you will not lose this audit.',
      targetFallback: { description: 'the "Create New Rule" button' },
      unverified: true,
      completion: { type: 'dom_event', value: 'click' },
    },
  ],
}
