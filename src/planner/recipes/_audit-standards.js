/**
 * Shared building blocks for the audit Standards flows.
 *
 * WHAT I FOUND IN MOONBEAM
 *
 * 1. Rules, Consent Categories and Alerts are not three destinations — they are
 *    three sub-tabs of ONE "Standards" tab in the audit editor
 *    (components/shared/components/standards-tab/), all rendering the same
 *    `op-standards-selector`: same search box, same "add all", same
 *    "Create New". So the three recipes share almost everything, which is why
 *    the path lives here rather than being copy-pasted and drifting.
 *
 * 2. "Create → Web Audit" does NOT open the editor with the Standards tab.
 *    manage-cards.component.ts::createWebAudit() opens **Quick Audit** unless
 *    the user has previously opted into advanced mode — and a new user, which
 *    is exactly who this product is for, always lands in Quick Audit. Quick
 *    Audit has no Standards at all. Every one of these recipes therefore has to
 *    walk through "Switch to Advanced Setup" or it dead-ends on a screen that
 *    does not contain what we promised.
 *
 * 3. Both are modals, not routes (`audit-setup-modal` → `op-audit-editor`).
 *    Nothing here changes the URL, so `completion` is dom_mutation / dom_event
 *    throughout. A `url_change` step in these flows would wait forever.
 *
 * SELECTOR RELIABILITY
 *   Solid — sourced from moonbeam constants, not guessed:
 *     EAuditSetupOpSelectors  (audit-setup-form.constants.ts)
 *     'web-audit-switch-to-advanced-setup' — quick-audit.component.ts even does
 *       document.querySelector('[op-selector="web-audit-switch-to-advanced-setup"]')
 *       itself, so the attribute form is confirmed
 *     #guide-create-new-data-src-btn / #guide-create-new-audit — moonbeam
 *       already tags these for a guide tool; the `guide-` prefix isn't ours
 *   Weak — positional:
 *     the two tab strips. op-tabs renders [attr.op-selector]="tab.opSelector",
 *     but neither audit-editor nor standards-tab sets opSelector on its tab
 *     definitions, so nothing is emitted and we fall back to :nth-child.
 *
 * THE ONE MOONBEAM CHANGE WORTH MAKING (4 lines, makes all three recipes solid):
 *   audit-editor.component.ts   generateTabs()  → opSelector: 'audit-tab-standards'
 *   standards-tab.component.ts  this.tabs = []  → opSelector: 'standards-tab-rules'
 *                                                 / 'standards-tab-consent-categories'
 *                                                 / 'standards-tab-alerts'
 * Then swap the positional selectors below and mark these recipes verified.
 */

import { auditNameFor } from '../naming.js'

export const SELECTORS = {
  // Data Sources page
  createDataSource: '#guide-create-new-data-src-btn',
  createWebAudit: '#guide-create-new-audit',

  // Quick Audit (the default landing modal)
  quickAuditModal: '.audit-setup-modal',
  auditName: '[op-selector="audit-setup-name"] input',
  startingUrls: '[op-selector="audit-setup-starting-urls-textarea"] textarea',
  switchToAdvanced: '[op-selector="web-audit-switch-to-advanced-setup"]',

  // Advanced audit editor
  auditEditor: '.op-audit-editor',
  // Tabs: Scenario, URL Sources, Schedule, Standards, Pre-Audit, On-Page.
  standardsTab: '.op-audit-editor .op-tabs:not(.sub-menu) .op-tab:nth-child(4)',

  // Standards sub-tabs, in the order standards-tab.component.ts builds them.
  subTabRules: '.op-audit-editor .op-tabs.sub-menu .op-tab:nth-child(1)',
  subTabConsentCategories: '.op-audit-editor .op-tabs.sub-menu .op-tab:nth-child(2)',
  subTabAlerts: '.op-audit-editor .op-tabs.sub-menu .op-tab:nth-child(3)',

  // op-standards-selector — identical markup for all three standard types.
  standardsSearch: '.op-standards-selector .search-input',
  standardsCreateNew: '.op-standards-selector .create-new-btn',
  standardsAddAll: '.op-standards-selector .add-all-standards-btn',
}

/**
 * Data Sources → name the audit → switch to Advanced → Standards tab.
 * Every one of the three recipes starts here, so fixing this path fixes all
 * three at once.
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
        targetSelector: SELECTORS.quickAuditModal,
      },
    },
    {
      id: id(2),
      actor: 'ai',
      targetSelector: SELECTORS.auditName,
      say: 'Naming it "{{parameters.auditName}}".',
      action: { type: 'fill_text', value: '{{parameters.auditName}}' },
      completion: { type: 'dom_event', value: 'change' },
    },
    {
      id: id(3),
      actor: 'ai',
      targetSelector: SELECTORS.startingUrls,
      say: 'This is where the crawl starts. One URL per line if you want several.',
      action: { type: 'fill_text', value: '{{parameters.siteUrl}}' },
      completion: { type: 'dom_event', value: 'change' },
    },
    {
      id: id(4),
      actor: 'user',
      targetSelector: SELECTORS.switchToAdvanced,
      say: 'Quick setup has no Standards section, so switch to Advanced Setup — that is where rules, consent categories and alerts are attached.',
      completion: {
        type: 'dom_mutation',
        condition: 'visible',
        targetSelector: SELECTORS.auditEditor,
      },
    },
    {
      id: id(5),
      actor: 'user',
      targetSelector: SELECTORS.standardsTab,
      say: 'Open the Standards tab.',
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

/**
 * Every recipe here needs these two. `purpose` is what the audit name says it
 * checks — the point of a default name is to be recognisable in a long list, so
 * it leads with the site and names the thing: "gap.com — Consent & privacy".
 */
export const auditParameters = purpose => [
  {
    name: 'siteUrl',
    description: 'The site or starting URL to audit',
    required: true,
    example: 'https://www.example.com',
  },
  {
    name: 'auditName',
    description: 'A name for the audit',
    required: false,
    derive: auditNameFor(purpose),
  },
]
