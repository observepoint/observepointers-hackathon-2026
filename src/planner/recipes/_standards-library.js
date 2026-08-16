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
 * 3. Standards is a mat-expansion-panel. Its sub-links are not in the DOM until
 *    the section header is clicked, which is why every flow here opens the
 *    section first rather than jumping straight at the link.
 */

export const NAV = {
  // Section header. Collapsed by default, and its children don't exist until
  // it is open.
  standardsSection: '[op-selector="sidebar-standards"]',
  rulesLink: '[op-selector="sidebar-standards-rules"]',
  consentCategoriesLink: '[op-selector="sidebar-standards-consent-categories"]',
  alertsLink: '[op-selector="sidebar-alerts"]',
}

/**
 * Open the Standards section, then the library you want.
 *
 * @param {object} options
 * @param {string} options.link    one of NAV's library links
 * @param {string} options.label   what the link says, for the text fallback
 * @param {string} options.route   the URL it lands on, for the completion
 */
export function stepsToLibrary({ link, label, route, startId = 1 }) {
  const id = n => `s${startId + n}`

  return [
    {
      id: id(0),
      actor: 'user',
      targetSelector: NAV.standardsSection,
      say: 'Open Standards in the sidebar.',
      targetFallback: { description: 'the "Standards" section in the left sidebar' },
      completion: {
        type: 'dom_mutation',
        condition: 'visible',
        targetSelector: link,
      },
    },
    {
      id: id(1),
      actor: 'user',
      targetSelector: link,
      say: `Go to ${label}.`,
      targetFallback: { description: `the "${label}" link under Standards` },
      completion: { type: 'url_change', value: route },
    },
  ]
}
