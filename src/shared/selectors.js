// Every selector coupled to the ObservePoint app lives here, so there is exactly
// one file to update when the app changes.
//
// We anchor on `guide-*` ids and `op-selector` attributes rather than CSS paths.
// Both already exist in the app -- they were added for Intercom Product Tours, and
// manage-cards.component.html says so explicitly:
//   <!-- NOTE: the id "guide-create-new-audit" is used for the in-app intercom guide. -->
// That makes them the most stable thing we can hold onto.

export const ANCHOR = {
  // --- Top nav -------------------------------------------------------------
  settingsTrigger: 'button[op-selector="top-nav-settings-btn"]',
  topNavRight: 'nav.top-nav .top-nav-right',
  // The Settings menu is an Angular Material mat-menu with [hasBackdrop]="false".
  // Its panel is created in .cdk-overlay-container and destroyed on every close,
  // so we re-inject per open. Note the op-selector="top-nav-settings-menu"
  // attribute sits on the <mat-menu> host in the light DOM, NOT on this panel.
  menuPanel: 'div.mat-mdc-menu-panel.top-nav-menu',
  menuContent: '.mat-mdc-menu-content',
  // The Help and Account menus share the .top-nav-menu panel class. Without
  // excluding them, our item lands in all three.
  menuPanelExclude: ['top-nav-help-menu-panel', 'top-nav-account-menu-panel'],
  // Anchor our item just below Keyboard Shortcuts, above the first divider.
  menuItemAnchor: '[op-selector="top-nav-keyboard-shortcuts"]',
  menuItemSample: 'button.mat-mdc-menu-item',
  // Our own injected "Walkthroughs" item -- content/settings-menu.js puts this
  // op-selector on the clone, so unlike everything else here we own the value. Only
  // exists while the Settings panel is open, hence the orientation tour opening the
  // menu before it points at this.
  settingsWalkthroughsItem: '[op-selector="top-nav-walkthroughs"]',
  // The hamburger. Only rendered in the app's mobile layout, so its VISIBILITY is our
  // narrow-screen test -- no breakpoint constant of our own to drift out of sync with the
  // app's media queries the next time they change them.
  mobileNavToggle: '[op-selector="top-nav-mobile-menu"]',

  // --- App shell -----------------------------------------------------------
  // Everything inside #application is gated on @if (user), so it is absent on the
  // login/signup routes and for a beat after load while the user resolves.
  appRoot: 'div#application',

  // --- Left nav ------------------------------------------------------------
  // Deliberately NOT scoped to global-sidebar, though the ids below ARE duplicated:
  // <mobile-sidebar> is instantiated at the same time and repeats every one of them.
  //
  // page-layer's findVisible() is what disambiguates, by taking the first match with a
  // non-zero bounding rect -- exactly the case it was written for, and the same thing the
  // createNew* and audit-setup selectors already rely on. Scoping to global-sidebar would
  // be stricter but would also make every nav step unresolvable in the app's mobile
  // layout, where global-sidebar is the hidden one and the drawer is what the user sees.
  //
  // The catch: a closed mat-drawer is translated off-screen rather than collapsed, so its
  // children can keep a non-zero rect. The 'nav-available' guard is what keeps us honest
  // there -- it requires the drawer to actually be open before any of these are used.
  navCreateNew: '#guide-left-nav-create-new',
  // The mat-drawer carries this class only while it is open, which is how the guard knows
  // the mobile nav is usable.
  mobileNavOpened: '.mat-drawer-opened',
  // The pin-state probe for the 'nav-pinned' guard in shared/guards.js. Confirmed against
  // the live app: this div is in the DOM while the nav is pinned and REMOVED once it is
  // not, so querySelector returning null is the signal that the nav collapsed. Don't
  // "harden" the guard by ignoring absence -- absence is the whole point.
  navExpanded: '[op-selector="sidebar-collapse-nav"]',
  // Click target for pinning the nav back open. NOT interchangeable with navExpanded above,
  // even though that element also carries class="collapse-wrapper": navExpanded is the state
  // probe (absent when unpinned) and this is the control you click. Keep them separate.
  navPinToggle: '.sidebar .collapse-wrapper[op-selector="sidebar-expand-nav"]',
  navCloseCreateNew: 'op-modal [op-selector="close-btn"]',
  navReports: '#guide-left-nav-reports',
  navDataSources:
    '#guide-left-nav-data-sources [op-selector="sidebar-data-sources-audits-journeys"]',
  navTriggeredAlerts: '#guide-left-nav-triggered-alerts',
  navStandards: '#guide-left-nav-standards',
  navConfigs: '#guide-left-nav-configs',
  navUsage: '#guide-left-nav-usage',

  // Left nav sub-items, via the opLinkSelectorMap in sidebar.constants.ts.
  // Deliberately omitted: 'notification center', 'folders', 'subfolders',
  // 'labels', 'shared links', 'alerts' and 'custom headers' are looked up by
  // getOpLinkAttr() but missing from that map, so they render op-selector="".
  navAuditsJourneys: '[op-selector="sidebar-data-sources-audits-journeys"]',
  navRules: '[op-selector="sidebar-standards-rules"]',
  navConsentPreferences: '[op-selector="sidebar-standards-consent-preferences"]',
  navActionSets: '[op-selector="sidebar-configurations-action-sets"]',
  navDataLayers: '[op-selector="sidebar-data-layers"]',
  navEmailInboxes: '[op-selector="sidebar-email-inboxes"]',

  // --- Data Sources page ---------------------------------------------------
  // The createNew* items only exist while the createNewDataSrcMenu is open, and
  // the trigger is duplicated for desktop/mobile (hidden by media query, so both
  // are in the DOM -- gate on a non-zero bounding rect to pick the right one).
  createNewDataSource: '#guide-create-new-data-src-btn',
  createNewAudit: '#guide-create-new-audit',
  createNewJourney: '#guide-create-new-journey',
  createNewFolder: '#guide-create-new-folder',

  // --- Audit setup form ----------------------------------------------------
  // From EAuditSetupOpSelectors. These land on <mat-form-field> WRAPPERS, not the
  // inputs -- fine for highlighting, but an 'ai' step must drill in to the control.
  auditName: '[op-selector="audit-setup-name"]',
  auditStartingUrls: '[op-selector="audit-setup-starting-urls-textarea"]',
  auditStartingUrlsToggle: '[op-selector="audit-setup-starting-urls-toggle"]',
  auditPageLimit: '[op-selector="audit-setup-page-limit"]',
  auditFrequency: '[op-selector="audit-setup-frequency"]',
  auditSave: '[op-selector="web-audit-create-save"]',
  auditLabels: '[op-selector="audit-setup-labels"]',
  auditGpcToggle: '[op-selector="audit-setup-gpc-toggle"]',
  auditBlockThirdPartyCookies: '[op-selector="audit-setup-block-3rd-party-cookies-toggle"]',
  // 'exlude' is not our typo -- that is the value shipped in the enum.
  auditExcludeList: '[op-selector="audit-setup-exlude-list"]',

  // --- Page Details report tabs -------------------------------------------
  // From EPageDetailsOPSelectors, rendered by the app's own op-tabs component as
  // real, visible, clickable div.op-tab elements. The active one carries .selected.
  pageDetailsPanel: 'div#audit-report-page-details-panel',
  pdTabPageInfo: 'div.op-tab[op-selector="pagedetails-tab-pageinfo"]',
  pdTabTags: 'div.op-tab[op-selector="pagedetails-tab-tags"]',
  pdTabCookies: 'div.op-tab[op-selector="pagedetails-tab-cookies"]',
  // The "Network Requests" tab. The selector value says requestlog because
  // "Request Log" is the legacy name, still used for the audit export.
  pdTabNetworkRequests: 'div.op-tab[op-selector="pagedetails-tab-requestlog"]',
  pdTabConsoleLog: 'div.op-tab[op-selector="pagedetails-tab-consolelog"]',
  pdTabInitiators: 'div.op-tab[op-selector="pagedetails-tab-taginitiators"]',
  pdTabRules: 'div.op-tab[op-selector="pagedetails-tab-rules"]',
  pdTabAccessibility: 'div.op-tab[op-selector="pagedetails-tab-accessibility"]',

  // --- Journey report tabs -------------------------------------------------
  // These op-selectors sit on <mat-tab> HOST elements, which are not the clickable
  // labels: Material renders those separately as div.mat-mdc-tab in mat-tab-header.
  // Map host -> label by index within the mat-tab-group. Never target these
  // directly for clicks.
  journeyTabHostActionDetails: 'mat-tab[op-selector="details-tab"]',
  journeyTabHostTagPresence: 'mat-tab[op-selector="tag-comparison-tab"]',
  journeyTabHostVariableSummary: 'mat-tab[op-selector="tags-tab"]',
  journeyTabHostCookies: 'mat-tab[op-selector="cookies-tab"]',
  journeyTabHostRules: 'mat-tab[op-selector="rules-tab"]',
  matTabLabel: 'div.mat-mdc-tab',
  matTabLabelText: '.mdc-tab__text-label',

  // --- Audit setup tabs ----------------------------------------------------
  // These use namespaced keys resolved by findOpTab() in page-layer.js via
  // OP_TAB_MAP, not direct CSS selectors.
  auditTabUrlSources: 'audit-tab:url-sources',
  auditTabSchedule: 'audit-tab:schedule',
}

/**
 * Every anchor that lives inside the left nav.
 *
 * Exists so the 'nav-available' guard can tell which steps depend on the sidebar. That used
 * to be a substring test for 'global-sidebar', which broke the moment those selectors were
 * unscoped -- the guard silently stopped applying to anything. An explicit set can't rot that
 * way: add a nav anchor above without adding it here and the guard just won't cover it, which
 * is at least visible from this list.
 */
export const SIDEBAR_ANCHORS = new Set([
  ANCHOR.navCreateNew,
  ANCHOR.navReports,
  ANCHOR.navDataSources,
  ANCHOR.navTriggeredAlerts,
  ANCHOR.navStandards,
  ANCHOR.navConfigs,
  ANCHOR.navUsage,
  ANCHOR.navAuditsJourneys,
  ANCHOR.navRules,
  ANCHOR.navConsentPreferences,
  ANCHOR.navActionSets,
  ANCHOR.navDataLayers,
  ANCHOR.navEmailInboxes,
])

// Route patterns, matched against location.pathname. The app uses
// PathLocationStrategy (pushState, no hash routing) with <base href="/">.
export const ROUTE = {
  start: /^\/start/,
  reports: /^\/reports/,
  dataSources: /^\/sources/,
  auditReport: /^\/audit\/\d+\/run\/\d+\/report\//,
  pageDetails: /^\/audit\/\d+\/run\/\d+\/.*page-details/,
  auditExports: /^\/audit\/\d+\/run\/\d+\/audit-exports/,
  journeyResults: /^\/web-journey\/\d+\/run\/\d+\/results/,
  rules: /^\/rules/,
  consentCategories: /^\/consent-categories/,
  alertsLibrary: /^\/alerts-library/,
  actionSets: /^\/action-set-library/,
  emailInboxes: /^\/email-inboxes/,
  usage: /^\/usage/,
}

/** Marker attribute on everything we inject, so injection stays idempotent. */
export const INJECTED_ATTR = 'data-op-wt'

/**
 * Our UI must clear the app's z-index ceiling (99999) AND Intercom's injected
 * iframes, which sit around 2147483000. Material's own .cdk-overlay-container is
 * pinned far below at 1150.
 */
export const Z_INDEX = {
  HOST: 2147483000,
  END_BUTTON: 2147483001,
}
