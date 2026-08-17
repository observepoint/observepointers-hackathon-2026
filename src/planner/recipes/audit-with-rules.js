import {
  SELECTORS,
  stepsToStandardsTab,
  standardsPickerSteps,
  standardsPickerSummary,
  saveAuditStep,
  auditParameters,
} from './_audit-standards.js'

/**
 * The bread-and-butter flow: an audit that checks tag & variable rules on every
 * run. This is what someone means by "make sure our tags keep working".
 *
 * PLANS AGAINST THE LIVE ACCOUNT, like the consent recipe does.
 *
 * The generic version said "search your rule library" and "add the rules you want",
 * which is the assistant admitting it does not know what is in there. A rule has no
 * site to match on — it is about a tag, not a domain — so the ranking signal is
 * usage: the rule the account's other audits already check. That is a genuinely good
 * recommendation and it needs no guessing.
 */
const RULES_PICKER = context => ({
  items: context?.account?.rules,
  kind: 'rule',
  plural: 'rules',
  weight: r => r.usageCount ?? 0,
})

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
  buildSummary(context) {
    return (
      'We\'ll create an audit called "{{parameters.auditName}}" against {{parameters.siteUrl}} and ' +
      'attach Tag & Variable Rules under Standards, so every run reports pass/fail against them.' +
      standardsPickerSummary(RULES_PICKER(context))
    )
  },

  buildSteps(context) {
    const picker = standardsPickerSteps({ ...RULES_PICKER(context), startId: 9 })
    return [
      ...stepsToStandardsTab(),
      {
        id: 's8',
        actor: 'user',
        targetSelector: SELECTORS.subTabRules,
        say: 'Open Tag & Variable Rules.',
        targetFallback: { description: 'the "Tag & Variable Rules" sub-tab' },
        // See the note in audit-with-consent-categories.js: the standards picker is
        // already on screen when Standards opens, so a visibility completion fires
        // instantly and the user never clicks this tab.
        completion: { type: 'dom_event', value: 'click' },
      },
      ...picker,
      saveAuditStep(`s${9 + picker.length}`),
    ]
  },
}
