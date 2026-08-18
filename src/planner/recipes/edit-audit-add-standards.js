import { SELECTORS, saveAuditStep, standardsSubTabSteps } from './_audit-standards.js'
import { bestCategoryFor } from './_consent-matching.js'
import { unswept } from './_unswept.js'

/**
 * Attach Standards to an audit that already exists.
 *
 * WHY THIS IS A SEPARATE RECIPE AND NOT A FLAG
 *
 * audit_with_all_standards creates the audit as part of the same walkthrough: sidebar
 * Create New, choose Audit, name it, give it a starting URL, then Standards. Every one
 * of those steps is wrong when the audit is already there — and the last two are worse
 * than wrong, because re-typing a name and a URL into an existing audit's editor
 * silently edits fields the user did not ask to change.
 *
 * So the divergence is the whole first half of the plan, which is a different recipe
 * rather than a branch. Everything from the Standards tab onward is shared, and that
 * shared half is the part that has been swept.
 *
 * HOW YOU EDIT AN AUDIT, WHICH IS NOT OBVIOUS
 *
 * Not by clicking the card — that opens the report. The editor is behind the card's
 * overflow menu, and `editAudit()` in home-card-list.component.ts opens
 * AuditEditorComponent with panelClass 'op-audit-editor': the SAME advanced editor the
 * create flow lands in. Which is why the Standards half transfers unchanged.
 *
 * PICKING THE RIGHT CARD
 *
 * The card's own selector embeds its id — `sources-view-card-audit-1234` — so it
 * cannot be named in advance. A prefix match on the type gets "the audits", and the
 * copy names the one to open rather than pretending we can point at it. Good enough
 * because the overwhelmingly common shape for this request is an account with one
 * audit; when there are several, the user picks and the step still makes sense.
 *
 * SELECTORS
 *   op-menu's own — button[op-selector="open-menu-options-btn"] is the trigger, and
 *     the items are button.op-menu-item with the label as their text, so "Edit" is
 *     matched the same way every other menu in this library is.
 *   Shared with the create flow, and swept there — the Standards tab, its three
 *     sub-tabs, the picker, and Save Audit.
 *   Unswept: the three steps that get from Data Sources into the editor.
 */

const EDIT = {
  // sidebar.constants.ts maps 'audits & journeys' to this. NOT the guide-* id Part 2's
  // ANCHOR.navDataSources scopes to — global-sidebar-link never binds an id.
  dataSources: '[op-selector="sidebar-data-sources-audits-journeys"]',
  cardMenu: '[op-selector^="sources-view-card-audit-"] button[op-selector="open-menu-options-btn"]',
  editItem: 'button.op-menu-item >> text=Edit',
}

const numbered = steps => steps.map((step, i) => ({ ...step, id: `s${i + 1}` }))

export default {
  id: 'edit_audit_add_standards',
  title: 'Add rules, consent categories and alerts to an existing audit',
  intent: {
    description:
      'Open an audit that already exists and attach Standards to it — Tag & Variable Rules, ' +
      'Consent Categories, Alerts — without creating a new audit. Use when the request names an ' +
      'audit, or says edit, update, or add-to rather than create. Prefer audit_with_all_standards ' +
      'when there is no audit yet.',
    examples: [
      'edit My First Audit to add rules, consent categories and alerts',
      'add a rule and an alert to my existing audit',
      'update the audit I just made with all three standards',
      'attach these to My First Audit',
      'put the new rule on my audit',
    ],
    keywords: [
      'edit my first audit',
      'edit the audit',
      'edit my audit',
      'existing audit',
      'add to my audit',
      'add to the audit',
      'update my audit',
      'update the audit',
      'on my audit',
    ],
  },
  parameters: [
    {
      name: 'auditName',
      description: 'Which audit should we open',
      required: false,
      default: 'your audit',
      example: 'My First Audit',
    },
    {
      name: 'siteUrl',
      // Not to type anywhere — the audit already has its starting URL and we must not
      // touch it. This is only what the consent-category picker searches for, since
      // OneTrust names categories "<something> | <host> | <geo>".
      description: 'Which site this audit covers',
      required: false,
      default: '',
      example: 'https://www.example.com',
    },
  ],

  buildSummary(context) {
    const name = context.parameters?.auditName ?? 'your audit'
    const best = bestCategoryFor(context)
    const found = [
      context?.account?.rules?.length ? `${context.account.rules.length} rules` : null,
      best ? 'a matching consent category' : null,
      context?.account?.alerts?.length ? `${context.account.alerts.length} alerts` : null,
    ].filter(Boolean)

    return (
      `${name} already exists, so this edits it rather than building another one. Rules, Consent ` +
      'Categories and Alerts are three sub-tabs of one Standards screen, so all three go on in ' +
      `one pass.${found.length ? ` Your account has ${found.join(', ')}.` : ''}`
    )
  },

  buildSteps(context) {
    const name = context.parameters?.auditName ?? 'your audit'

    // Only the first three are new. The Standards tab and everything after it is
    // shared with audit_with_all_standards and was swept there.
    const openEditor = [
      {
        actor: 'user',
        navContext: '*',
        targetSelector: EDIT.dataSources,
        say: 'Open Audits & Journeys in the sidebar.',
        targetFallback: { description: 'the "Audits & Journeys" link in the left sidebar' },
        completion: { type: 'url_change', value: '/sources' },
      },
      {
        actor: 'user',
        navContext: '/sources',
        targetSelector: EDIT.cardMenu,
        // Named rather than pointed at: the card's selector embeds its id, so we can
        // reach "an audit card" and not "this one".
        say: `Open the ⋮ menu on ${name}.`,
        targetFallback: { description: `the overflow menu on the ${name} card` },
        completion: {
          type: 'dom_mutation',
          condition: 'visible',
          targetSelector: 'button.op-menu-item',
        },
      },
      {
        actor: 'user',
        navContext: '/sources',
        targetSelector: EDIT.editItem,
        say: 'Choose Edit — that opens the full editor, not the report.',
        targetFallback: { description: '"Edit" in the card menu' },
        completion: {
          type: 'dom_mutation',
          condition: 'visible',
          targetSelector: SELECTORS.auditEditor,
        },
      },
      {
        actor: 'user',
        navContext: '*',
        targetSelector: SELECTORS.standardsTab,
        // The step audit_with_all_standards gets from stepsToStandardsTab(), which this
        // recipe does not call because the rest of that helper creates the audit.
        say: 'Open the Standards tab.',
        targetFallback: { description: 'the "Standards" tab in the audit editor' },
        completion: {
          type: 'dom_mutation',
          condition: 'visible',
          targetSelector: '.op-tabs.sub-menu',
        },
      },
    ]

    // The three steps that get from Data Sources into the editor have never been
    // watched resolve; everything after them has.
    const NEW_STEPS = new Set([EDIT.dataSources, EDIT.cardMenu, EDIT.editItem])
    const built = numbered([
      ...openEditor,
      ...standardsSubTabSteps(context).map(({ id: _id, ...step }) => step),
      saveAuditStep(null),
    ])

    return unswept(
      built,
      built.filter(step => NEW_STEPS.has(step.targetSelector)).map(step => step.id),
    )
  },
}
