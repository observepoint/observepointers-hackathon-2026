import { SELECTORS, stepsToStandardsTab, auditParameters } from './_audit-standards.js'

/**
 * The bread-and-butter flow: an audit that checks tag & variable rules on every
 * run. This is what someone means by "make sure our tags keep working".
 */
export default {
  id: 'audit_with_rules',
  title: 'Create an audit that checks your tag rules',
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
  parameters: auditParameters('Tag & variable rules'),
  summaryTemplate:
    'We\'ll create an audit called "{{parameters.auditName}}" against {{parameters.siteUrl}}, then attach ' +
    'your Tag & Variable Rules under Standards so every run reports pass/fail against them.',
  steps: [
    ...stepsToStandardsTab(),
    {
      id: 's8',
      actor: 'user',
      targetSelector: SELECTORS.subTabRules,
      say: 'Open Tag & Variable Rules.',
      targetFallback: { description: 'the "Tag & Variable Rules" sub-tab' },
      completion: {
        type: 'dom_mutation',
        condition: 'visible',
        targetSelector: '.op-standards-selector',
      },
    },
    {
      id: 's9',
      actor: 'user',
      targetSelector: SELECTORS.standardsSearch,
      say: 'Search your rule library.',
      targetFallback: { description: 'the search box in the rules picker' },
      completion: { type: 'dom_event', value: 'input' },
    },
    {
      id: 's10',
      actor: 'user',
      targetSelector: SELECTORS.standardsAddAll,
      say: 'Add the rules you want.',
      targetFallback: { description: 'the "add all" button in the rules picker' },
      completion: { type: 'dom_event', value: 'click' },
    },
    {
      id: 's11',
      actor: 'user',
      targetSelector: SELECTORS.standardsCreateNew,
      say: 'Nothing fits? Create a rule here instead.',
      targetFallback: { description: 'the "Create New Rule" button' },
      completion: { type: 'dom_event', value: 'click' },
    },
  ],
}
