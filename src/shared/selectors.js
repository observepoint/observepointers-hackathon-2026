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

  // --- App shell -----------------------------------------------------------
  // Everything inside #application is gated on @if (user), so it is absent on the
  // login/signup routes and for a beat after load while the user resolves.
  appRoot: 'div#application',

  // --- Left nav ------------------------------------------------------------
  // MUST stay scoped to global-sidebar. <mobile-sidebar> is instantiated at the
  // same time and duplicates every one of these ids; an unscoped getElementById
  // returns whichever comes first in document order.
  navCreateNew: 'global-sidebar #guide-left-nav-create-new',
  navReports: 'global-sidebar #guide-left-nav-reports',
  navDataSources: 'global-sidebar #guide-left-nav-data-sources',
  navTriggeredAlerts: 'global-sidebar #guide-left-nav-triggered-alerts',
  navStandards: 'global-sidebar #guide-left-nav-standards',
  navConfigs: 'global-sidebar #guide-left-nav-configs',
  navUsage: 'global-sidebar #guide-left-nav-usage',

  // Left nav sub-items, via the opLinkSelectorMap in sidebar.constants.ts.
  // Deliberately omitted: 'notification center', 'folders', 'subfolders',
  // 'labels', 'shared links', 'alerts' and 'custom headers' are looked up by
  // getOpLinkAttr() but missing from that map, so they render op-selector="".
  navAuditsJourneys: 'global-sidebar [op-selector="sidebar-data-sources-audits-journeys"]',
  navRules: 'global-sidebar [op-selector="sidebar-standards-rules"]',
  navConsentPreferences: 'global-sidebar [op-selector="sidebar-standards-consent-preferences"]',
  navActionSets: 'global-sidebar [op-selector="sidebar-configurations-action-sets"]',
  navDataLayers: 'global-sidebar [op-selector="sidebar-data-layers"]',
  navEmailInboxes: 'global-sidebar [op-selector="sidebar-email-inboxes"]',

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
}

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
