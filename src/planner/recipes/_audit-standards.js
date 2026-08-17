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
 *   Weak — the tab strips. op-tabs renders [attr.op-selector]="tab.opSelector",
 *     but neither audit-editor nor standards-tab sets opSelector upstream. A
 *     local moonbeam patch adds five of them; the selectors below work with or
 *     without it, so nothing here depends on that patch landing. See the
 *     comments on urlSourcesTab / standardsTab for why one gets a positional
 *     fallback and the sub-tabs deliberately do not.
 */

import { auditNameFor, normalizeSiteUrl } from '../naming.js'

export const SELECTORS = {
  // The sidebar, which is reachable from every screen in the app — including the
  // Data Sources page, so this replaces rather than supplements the entry below.
  //
  // NOT '#guide-left-nav-create-new'. global-sidebar.component.ts sets an `id` on
  // its link objects but global-sidebar-link.component.html never binds one, so
  // those ids exist only in the TypeScript. The op-selector is bound and real.
  sidebarCreateNew: '[op-selector="sidebar-create-new"]',
  newDataAudit: '[op-selector="new-data-option-audit"]',

  // Data Sources page. Kept because alert_from_report still starts there — it has
  // to pick an existing audit — and because Check screen uses them as landmarks.
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

  // The three sub-tabs below resolve to nothing without the moonbeam patch, and
  // Part 3 falls back to targetFallback.description, which matches the tab's
  // visible text. That is deliberate — see the note under them.
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

  // The editor footer. op-modal-footer-buttons binds op-selector straight onto the
  // <button>, so no descend. Label is literally "Save Audit"
  // (audit-editor.component.ts:155), and "Save Changes & Run Now" is the sibling.
  saveAudit: '[op-selector="web-audit-create-save"]',

  // op-standards-selector — identical markup for all three standard types.
  standardsSearch: '.op-standards-selector .search-input',
  standardsCreateNew: '.op-standards-selector .create-new-btn',
  standardsAddAll: '.op-standards-selector .add-all-standards-btn',
}

/**
 * Sidebar → create the audit → Standards tab. All the audit recipes start here, so
 * fixing this path fixes all of them at once.
 *
 * STARTS FROM THE SIDEBAR, NOT FROM DATA SOURCES.
 *
 * It used to open the Data Sources page's Create button, scoped to `/sources`. That
 * made a plan begun from anywhere else stop and tell the user to navigate — the
 * walkthrough's first act was a chore. The sidebar's Create New opens the same
 * NewDataModalComponent from every screen, so the navigation step is gone rather
 * than explained.
 *
 * One behavioural difference worth knowing: new-data-modal's createAudit() branches
 * on `useAdvancedAuditMode()` ALONE, where manage-cards' createWebAudit() also
 * opens Quick Audit when the account has no data sources. So this route reaches the
 * advanced editor more often. The optional switch-to-advanced step below covers
 * both either way, which is exactly why it is optional rather than predicted.
 *
 * ONE PATH, BOTH ENTRY POINTS.
 *
 * This used to branch. createWebAudit() opens Quick Audit when
 * `totalCardsCount === 0 || useAdvancedAuditMode() !== true`, so we read the
 * audit count and the stored preference, predicted which modal would appear, and
 * emitted one of two step lists. That worked and it was the wrong shape:
 *
 *   · It needed an extra API call per boot purely to guess.
 *   · The guess used the count of ALL data source cards, which we approximated
 *     with the audit count — so an account with journeys and no audits got the
 *     wrong branch.
 *   · A wrong guess is not a degraded walkthrough, it is a walkthrough pointing
 *     at a modal that never opened.
 *
 * Now there is no guess. "Switch to Advanced Setup" is marked `optional`, so the
 * runtime skips it when it isn't on screen. In Quick Audit it resolves and the
 * user clicks it; in the advanced editor it is absent and the run moves on.
 * Every step after it is the advanced editor either way, which is what makes one
 * list sufficient.
 *
 * Two facts make this safe rather than lucky:
 *   · switchToAdvancedView() carries the URL across
 *     (`url: quickAuditForm.get('scanURL')?.value`), so nothing typed is lost.
 *   · Quick Audit auto-names the audit "Simple Audit - <date>"
 *     (quick-audit.component.ts:124), so naming AFTER the switch is correct for
 *     both routes — it either sets the name or replaces that default.
 *
 * VERIFIED against a running local moonbeam except the switch step itself, which
 * needs an account with no data sources or advanced mode turned off.
 */
export function stepsToStandardsTab({ startId = 1 } = {}) {
  const id = n => `s${startId + n}`

  return [
    {
      id: id(0),
      actor: 'user',
      // No navContext. This used to be scoped to /sources and start from the Data
      // Sources page's own Create button, which meant a plan begun anywhere else
      // stopped to tell the user to navigate first — a prerequisite popup standing
      // between them and the thing they asked for.
      //
      // The sidebar's Create New opens the same modal from any screen, so the
      // navigation step disappears rather than being explained. It also survives a
      // collapsed sidebar: only `always-expanded-body` is gated on that, and this
      // is a top-level item.
      navContext: '*',
      targetSelector: SELECTORS.sidebarCreateNew,
      say: 'Click Create New in the left sidebar.',
      targetFallback: { description: 'the "Create New" button in the left sidebar' },
      completion: {
        type: 'dom_mutation',
        condition: 'visible',
        targetSelector: SELECTORS.newDataAudit,
      },
    },
    {
      id: id(1),
      actor: 'user',
      targetSelector: SELECTORS.newDataAudit,
      say: 'Choose Audit.',
      targetFallback: { description: 'the "Audit" option in the Create New dialog' },
      completion: {
        type: 'dom_mutation',
        condition: 'visible',
        // Either modal satisfies this. A comma list is safe when the halves are
        // mutually exclusive, and exactly one of these two opens.
        targetSelector: `${SELECTORS.auditEditor}, ${SELECTORS.quickAuditModal}`,
      },
    },
    {
      id: id(2),
      actor: 'user',
      optional: true,
      targetSelector: SELECTORS.switchToAdvanced,
      say: 'If you landed on the quick setup, switch to Advanced Setup — Standards lives there.',
      targetFallback: { description: 'the "Switch to Advanced Setup" button' },
      unverified: true,
      completion: {
        type: 'dom_mutation',
        condition: 'visible',
        targetSelector: SELECTORS.auditEditor,
      },
    },
    {
      id: id(3),
      actor: 'ai',
      targetSelector: SELECTORS.advancedName,
      say: 'Naming it "{{parameters.auditName}}".',
      targetFallback: { description: 'the audit name field in the editor header' },
      action: { type: 'fill_text', value: '{{parameters.auditName}}' },
      completion: { type: 'dom_event', value: 'change' },
    },
    {
      id: id(4),
      actor: 'user',
      targetSelector: SELECTORS.urlSourcesTab,
      say: 'Open URL Sources.',
      targetFallback: { description: 'the URL Sources tab in the audit editor' },
      completion: { type: 'dom_event', value: 'click' },
    },
    {
      id: id(5),
      actor: 'ai',
      targetSelector: SELECTORS.startingUrls,
      say: 'Setting the starting URL.',
      targetFallback: { description: 'the "URLs to Scan" box on the URL Sources tab' },
      action: { type: 'fill_text', value: '{{parameters.siteUrl}}' },
      completion: { type: 'dom_event', value: 'change' },
    },
    {
      id: id(6),
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
 * The last step every audit recipe was missing.
 *
 * All four of them ended on "attach it" — which configures an audit and never
 * creates one. The walkthrough then reported Complete, having produced nothing:
 * the editor is a modal, so closing it discards everything. That is the worst
 * possible ending, because it looks like it worked.
 *
 * Stays `actor: 'user'`. The standing rule on this project is that the copilot
 * fills fields and the person commits the change; if there is one button that must
 * never be clicked on someone's behalf, it is the one that creates the object.
 *
 * "Save Changes & Run Now" is mentioned rather than targeted. It is the more
 * satisfying ending and it spends real crawl budget, so it should be a deliberate
 * choice rather than the step we point at.
 */
export const saveAuditStep = id => ({
  id,
  actor: 'user',
  targetSelector: SELECTORS.saveAudit,
  say: 'Save Audit — nothing exists until you do. "Save Changes & Run Now" next to it also kicks off the first run.',
  targetFallback: { description: 'the "Save Audit" button at the bottom of the editor' },
  completion: { type: 'dom_event', value: 'click' },
})

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
