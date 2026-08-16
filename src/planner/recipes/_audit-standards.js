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
 * 2. "Create → Web Audit" opens one of two different screens.
 *    manage-cards.component.ts::createWebAudit():
 *        totalCardsCount === 0 || useAdvancedAuditMode() !== true
 *          ? openQuickAudit() : openAdvancedAudit()
 *    Advanced mode defaults to ON (storage.service.ts returns `value ?? true`),
 *    so an established account goes straight to the editor — but an account
 *    with no data sources gets Quick Audit regardless, and that is exactly the
 *    account this product exists for. Both paths are built; see
 *    stepsToStandardsTab's `advanced` flag.
 *
 *    Quick Audit is not a subset of the editor. It has one text field
 *    (#scanURL) and no name field, auto-naming the audit "Simple Audit -
 *    <date>". So its path fills the URL, switches to advanced, and renames
 *    there. Both switchToAdvancedView() and the editor carry the URL over.
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

import { auditNameFor, normalizeSiteUrl } from '../naming.js'

export const SELECTORS = {
  // Data Sources page
  createDataSource: '#guide-create-new-data-src-btn',
  createWebAudit: '#guide-create-new-audit',

  // Quick Audit. A different screen from the advanced editor, not a subset of
  // it — it has ONE text field and no name field at all:
  //   quick-audit.component.html   <input #urlInput id="scanURL" …>
  //   quick-audit.component.ts:124 auditHeaderValue.name = DEFAULT_AUDIT_NAME
  // so the audit is auto-named "Simple Audit - <date>" and gets renamed after
  // the switch to advanced. An earlier version of this file pointed at
  // audit-setup-name and audit-setup-starting-urls-textarea here; neither
  // exists on this screen.
  quickAuditModal: '.audit-setup-modal', // panelClass, audit-modal.helpers.ts:21
  quickAuditUrl: '#scanURL',
  // opSelector on the footer button itself (op-modal-footer-buttons binds
  // [attr.op-selector] straight onto <button>), so no descend.
  switchToAdvanced: '[op-selector="web-audit-switch-to-advanced-setup"]',

  // Advanced editor. The name lives in a header component with no op-selector,
  // so we target the component's own element name — Angular renders it as a
  // real tag, which makes it as stable as an attribute would be.
  advancedName: 'audit-editor-header-name-control input',

  // Comma lists, so these work with or without the moonbeam op-selector patch.
  //
  // Safe here specifically because both halves resolve to the SAME element: the
  // attribute, when present, sits on the very tab the positional selector
  // picks. querySelector returns the first match in document order, so either
  // way you get that tab. This is not a general trick — a comma list whose
  // halves can match different elements is a coin toss.
  //
  // Reliable because generateTabs() emits all six audit tabs unconditionally
  // (the `hidden` flags nearby are on buttons, not tabs), so Scenario, URL
  // Sources, Schedule, Standards, Pre-Audit, On-Page are always positions 1-6.
  urlSourcesTab:
    '[op-selector="audit-tab-url-sources"], .op-audit-editor .op-tabs:not(.sub-menu) .op-tab:nth-child(2)',
  startingUrls: '[op-selector="audit-setup-starting-urls-textarea"] textarea',

  // Advanced audit editor
  auditEditor: '.op-audit-editor',

  // These four need the moonbeam change described at the top of this file.
  // Until it lands they resolve to nothing and Part 3 falls back to
  // targetFallback.description, which matches the tab's visible text.
  //
  // They replaced :nth-child() selectors, and it is worth knowing why rather
  // than reinventing them. standards-tab.component.ts::createTabs() builds the
  // list with unshift():
  //     tabs = [Rules]
  //     if (privacyEnabled)      unshift(ConsentCategories)
  //     if (productType===AUDIT) unshift(Alerts)
  // so the rendered order is Alerts, Consent Categories, Rules — the reverse of
  // the reading order in the file. Two of the three positional selectors here
  // pointed at the wrong tab. Worse, the order is conditional: without privacy
  // there is no Consent tab and every index shifts. Positional selectors were
  // never going to survive that.
  standardsTab:
    '[op-selector="audit-tab-standards"], .op-audit-editor .op-tabs:not(.sub-menu) .op-tab:nth-child(4)',
  // No positional fallback for these three. createTabs() builds them with
  // unshift() and drops Consent Categories when privacy is off, so there is no
  // index that is correct in both layouts — a fallback would confidently point
  // at the wrong tab, which is worse than pointing at nothing. If the attribute
  // is missing, targetFallback's text match is the honest answer.
  subTabRules: '[op-selector="standards-tab-rules"]',
  subTabConsentCategories: '[op-selector="standards-tab-consent-categories"]',
  subTabAlerts: '[op-selector="standards-tab-alerts"]',

  // op-standards-selector — identical markup for all three standard types.
  standardsSearch: '.op-standards-selector .search-input',
  standardsCreateNew: '.op-standards-selector .create-new-btn',
  standardsAddAll: '.op-standards-selector .add-all-standards-btn',
}

/**
 * Data Sources → create the audit → Standards tab. All three audit recipes
 * start here, so fixing this path fixes all three at once.
 *
 * The advanced branch is VERIFIED against a running local moonbeam
 * (2026-08-16). The quick branch is source-accurate but unswept — it needs an
 * account with no data sources, or advanced mode turned off in user settings.
 *
 * Both branches emit s1..s6, so callers can append s7 onward either way.
 */
/**
 * Which of the two screens will Create → Audit open?
 *
 * Mirrors manage-cards.component.ts::createWebAudit() exactly, including the
 * order of the two conditions. Both signals are optional: a list we never read
 * cannot say "empty", so an unread account falls through to the advanced
 * default, which is what an established account gets.
 */
export function usesAdvancedPath(account) {
  if (Array.isArray(account?.webAudits) && account.webAudits.length === 0) return false
  return account?.advancedAuditMode !== false
}

export function stepsToStandardsTab({ startId = 1, advanced = true } = {}) {
  const id = n => `s${startId + n}`

  const entry = [
    {
      id: id(0),
      actor: 'user',
      navContext: '/sources',
      targetSelector: SELECTORS.createDataSource,
      say: 'Open the create menu.',
      targetFallback: { description: 'the Create button on the Data Sources page' },
      completion: { type: 'dom_event', value: 'click' },
    },
    {
      id: id(1),
      actor: 'user',
      targetSelector: SELECTORS.createWebAudit,
      say: 'Choose Audit.',
      targetFallback: { description: 'the Audit item in the create menu' },
      completion: {
        type: 'dom_mutation',
        condition: 'visible',
        targetSelector: advanced ? SELECTORS.auditEditor : SELECTORS.quickAuditModal,
      },
    },
  ]

  if (advanced) {
    return [
      ...entry,
      {
        id: id(2),
        actor: 'ai',
        targetSelector: SELECTORS.advancedName,
        say: 'Naming it "{{parameters.auditName}}".',
        action: { type: 'fill_text', value: '{{parameters.auditName}}' },
        completion: { type: 'dom_event', value: 'change' },
      },
      {
        id: id(3),
        actor: 'user',
        targetSelector: SELECTORS.urlSourcesTab,
        say: 'Open URL Sources.',
        targetFallback: { description: 'the URL Sources tab in the audit editor' },
        completion: { type: 'dom_event', value: 'click' },
      },
      {
        id: id(4),
        actor: 'ai',
        targetSelector: SELECTORS.startingUrls,
        say: 'Setting the starting URL.',
        action: { type: 'fill_text', value: '{{parameters.siteUrl}}' },
        completion: { type: 'dom_event', value: 'change' },
      },
      {
        id: id(5),
        actor: 'user',
        targetSelector: SELECTORS.standardsTab,
        say: 'Open the Standards tab.',
        targetFallback: { description: 'the Standards tab in the audit editor' },
        completion: {
          type: 'dom_mutation',
          condition: 'visible',
          targetSelector: '.op-tabs.sub-menu',
        },
      },
    ]
  }

  // Quick Audit's only field is the URL, and switchToAdvancedView() passes it
  // through (`url: quickAuditForm.get('scanURL')?.value`), so it is worth
  // filling before the switch rather than after. The name is not worth filling
  // here — there is nowhere to put it — so it lands on the advanced header,
  // replacing the auto-generated "Simple Audit - <date>".
  return [
    ...entry,
    {
      id: id(2),
      actor: 'ai',
      targetSelector: SELECTORS.quickAuditUrl,
      say: 'Setting the site to scan.',
      action: { type: 'fill_text', value: '{{parameters.siteUrl}}' },
      unverified: true,
      completion: { type: 'dom_event', value: 'change' },
    },
    {
      id: id(3),
      actor: 'user',
      targetSelector: SELECTORS.switchToAdvanced,
      say: 'Switch to Advanced Setup — Quick Audit has no Standards section.',
      targetFallback: { description: 'the "Switch to Advanced Setup" button' },
      unverified: true,
      completion: {
        type: 'dom_mutation',
        condition: 'visible',
        targetSelector: SELECTORS.auditEditor,
      },
    },
    {
      id: id(4),
      actor: 'ai',
      targetSelector: SELECTORS.advancedName,
      say: 'Renaming it "{{parameters.auditName}}" — it came through as "Simple Audit".',
      action: { type: 'fill_text', value: '{{parameters.auditName}}' },
      completion: { type: 'dom_event', value: 'change' },
    },
    {
      id: id(5),
      actor: 'user',
      targetSelector: SELECTORS.standardsTab,
      say: 'Open the Standards tab.',
      targetFallback: { description: 'the Standards tab in the audit editor' },
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
    normalize: normalizeSiteUrl,
  },
  {
    name: 'auditName',
    description: 'A name for the audit',
    required: false,
    derive: auditNameFor(purpose),
  },
]
