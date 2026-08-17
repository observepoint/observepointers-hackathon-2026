/**
 * Getting to a standards library from anywhere in the app.
 *
 * The three audit recipes attach standards that already exist. These steps are
 * for the other half of the problem: an account that has none yet, where
 * "search your rule library" points at an empty list and the walkthrough
 * quietly wastes the user's time.
 *
 * WHAT I FOUND IN MOONBEAM
 *
 * 1. Rules, Consent Categories and Alerts each have their own top-level library
 *    page, reached from the sidebar's "Standards" section:
 *      /rules/library        rule-library.routes.ts
 *      /consent-categories   consent-categories.constants.ts
 *    These are real routes, unlike the audit editor, so `url_change` is the
 *    honest completion here.
 *
 * 2. Every sidebar link carries a real op-selector. global-sidebar.component.ts
 *    sets `opSelector: this.getOpLinkAttr(name)`, which looks the name up in
 *    opLinkSelectorMap (sidebar.constants.ts), and global-sidebar-link's
 *    template renders it as [attr.op-selector]. So these are as solid as
 *    selectors get in this app — no patch needed, nothing positional.
 *
 * 3. THE SECTIONS ARE ALWAYS EXPANDED. This file originally opened Standards
 *    first, on the assumption that it is a mat-expansion-panel whose children
 *    appear on click. It has that branch — global-sidebar-link.component.html:89
 *    — but nothing reaches it: app.component.ts:149 is
 *    `readonly showTopNavBar = true`, hardcoded, and that feeds
 *    [alwaysExpanded]="showTopNavBar". So the always-expanded branch (line 2)
 *    always wins, and every sub-link is in the DOM from first paint.
 *
 *    That made the opening step worse than redundant. Its completion waited for
 *    `dom_mutation` / visible on a link that was ALREADY visible, and a
 *    mutation observer never fires for an element that does not change — so the
 *    first step of both starter recipes would have sat there forever. Reading
 *    the template found the branch; it took someone saying "Standards is always
 *    expanded" to notice which branch actually runs.
 *
 *    Remaining caveat: `always-expanded-body` is gated on `!sidebarIsClosed`, so
 *    on the collapsed rail the sub-links genuinely are absent. The step copy
 *    says so, because a plan that points at nothing and does not explain itself
 *    is the worst of the options.
 */

export const NAV = {
  // The section header. Present, but there is nothing to click — see note 3.
  // Kept because it is a useful landmark for Part 3 and for Check screen.
  standardsSection: '[op-selector="sidebar-standards"]',
  rulesLink: '[op-selector="sidebar-standards-rules"]',
  consentCategoriesLink: '[op-selector="sidebar-standards-consent-categories"]',
  alertsLink: '[op-selector="sidebar-alerts"]',
  // Only exists while the rail is collapsed, which is the one state where the
  // links above are missing. Not a step — the copy mentions it instead, since a
  // step targeting it would miss in the common case.
  expandNav: '[op-selector="sidebar-expand-nav"]',
}

/**
 * Go straight to the library you want. One step, because the sidebar needs no
 * opening.
 *
 * @param {object} options
 * @param {string} options.link    one of NAV's library links
 * @param {string} options.label   what the link says, for the text fallback
 * @param {string} options.route   the URL it lands on, for the completion
 */
export function stepsToLibrary({ link, label, route, startId = 1 }) {
  return [
    {
      id: `s${startId}`,
      actor: 'user',
      targetSelector: link,
      say: `Open ${label} under Standards in the sidebar.`,
      targetFallback: { description: `the "${label}" link under Standards in the left sidebar` },
      completion: { type: 'url_change', value: route },
    },
  ]
}
