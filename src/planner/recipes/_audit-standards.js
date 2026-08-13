/**
 * Shared building blocks for the audit Standards flows.
 *
 * WHAT I FOUND IN MOONBEAM (components/shared/components/standards-tab/)
 * Rules, Consent Categories and Alerts are not three separate destinations —
 * they are three sub-tabs of ONE "Standards" tab inside the audit editor:
 *
 *   Data Sources → Create/open an audit → Standards tab
 *       ├── Tag & Variable Rules (n)
 *       ├── Consent Categories (n)
 *       └── Alerts (n)
 *
 * All three render the same `op-standards-selector` component — a two-column
 * picker with the same search box, the same "add all", the same "Create New".
 * So the three recipes share almost everything, which is why the steps live here
 * instead of being copy-pasted three times and drifting apart.
 *
 * The audit editor is a MODAL (openFixedSizeModal(AuditEditorComponent, …,
 * 'op-audit-editor')), not a route. Nothing about these flows changes the URL,
 * so `completion` uses dom_mutation / dom_event throughout — a `url_change`
 * step here would wait forever.
 *
 * SELECTOR RELIABILITY
 *   Solid  : #guide-create-new-data-src-btn, #guide-create-new-audit
 *            (moonbeam already tags these for a guide tool — the `guide-`
 *            prefix is not ours, it was there waiting for us)
 *            .op-audit-editor, .audit-editor-form, .op-standards-selector classes
 *   Weak   : the tab strips. op-tabs renders [attr.op-selector]="tab.opSelector",
 *            but neither the audit editor nor the standards tab sets opSelector
 *            on its tab definitions, so nothing is emitted and we fall back to
 *            positional :nth-child.
 *
 * THE ONE MOONBEAM CHANGE WORTH MAKING (~8 lines, makes all three recipes solid):
 *   audit-editor.component.ts   generateTabs()  → add `opSelector: 'audit-tab-standards'` etc.
 *   standards-tab.component.ts  this.tabs = [ ] → add `opSelector: 'standards-tab-rules'`,
 *                                                     'standards-tab-consent-categories',
 *                                                     'standards-tab-alerts'
 * Then swap the positional selectors below for [op-selector="…"] and mark the
 * recipes verified.
 */

export const SELECTORS = {
  createDataSource: '#guide-create-new-data-src-btn',
  createWebAudit: '#guide-create-new-audit',
  auditEditor: '.op-audit-editor',
  auditEditorForm: '.audit-editor-form',

  // Audit editor tabs: Scenario, URL Sources, Schedule, Standards,
  // Pre-Audit Actions, On-Page Actions.
  standardsTab: '.op-audit-editor .op-tabs:not(.sub-menu) .op-tab:nth-child(4)',

  // Standards sub-tabs, in the order standards-tab.component.ts builds them.
  subTabRules: '.op-audit-editor .op-tabs.sub-menu .op-tab:nth-child(1)',
  subTabConsentCategories: '.op-audit-editor .op-tabs.sub-menu .op-tab:nth-child(2)',
  subTabAlerts: '.op-audit-editor .op-tabs.sub-menu .op-tab:nth-child(3)',

  // op-standards-selector — identical markup for all three standard types.
  standardsSearch: '.op-standards-selector .search-input',
  standardsCreateNew: '.op-standards-selector .create-new-btn',
  standardsAddAll: '.op-standards-selector .add-all-standards-btn',
  standardsRemoveAll: '.op-standards-selector .remove-all-btn',
}

/**
 * Data Sources → new audit → Standards tab. Every one of the three recipes
 * starts here, so a fix to this path fixes all of them at once.
 */
export function stepsToStandardsTab({ startId = 1 } = {}) {
  const id = n => `s${startId + n}`

  return [
    {
      id: id(0),
      actor: 'user',
      navContext: '/data-sources',
      targetSelector: SELECTORS.createDataSource,
      say: 'Audits are created from Data Sources. Open the create menu.',
      targetFallback: { description: 'the Create button on the Data Sources page' },
      completion: { type: 'dom_event', value: 'click' },
    },
    {
      id: id(1),
      actor: 'user',
      targetSelector: SELECTORS.createWebAudit,
      say: 'Choose Web Audit.',
      targetFallback: { description: 'the Web Audit item in the create menu' },
      completion: {
        type: 'dom_mutation',
        condition: 'visible',
        targetSelector: SELECTORS.auditEditor,
      },
    },
    {
      id: id(2),
      actor: 'user',
      targetSelector: SELECTORS.standardsTab,
      say: 'Rules, Consent Categories and Alerts all live behind the Standards tab.',
      targetFallback: { description: 'the Standards tab in the audit editor' },
      unverified: true,
      completion: {
        type: 'dom_mutation',
        condition: 'visible',
        targetSelector: '.op-tabs.sub-menu',
      },
    },
  ]
}
