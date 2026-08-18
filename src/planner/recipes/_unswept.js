/**
 * The verification policy, in one place because hand-maintaining it drifted.
 *
 * `unverified: true` means ONE thing: nobody has watched this selector resolve
 * on the screen it targets. It does not mean "guessed" — every selector in this
 * library was read out of the template that renders it. Confidence about source
 * and evidence from a live page are different claims, and the second is the one
 * Part 2 and Part 3 need, because a selector that is right in the source and
 * absent from the DOM (wrong screen, feature flag off, conditional block) fails
 * exactly like a wrong one.
 *
 * What has been swept, against a running local moonbeam:
 *   Data Sources     #guide-create-new-data-src-btn, #guide-create-new-audit
 *   Advanced editor  audit-editor-header-name-control input,
 *                    audit-setup-starting-urls-textarea textarea,
 *                    audit-tab-standards, standards-tab-{rules,
 *                    consent-categories,alerts}
 *   Sidebar          sidebar-standards-rules,
 *                    sidebar-standards-consent-categories
 *   Rules library    button[aria-label="Create Rule"]
 *   Rule builder     rule-name-control input, rule-setup-continue-btn ("Next"),
 *                    rule-setup-save-btn ("Save") — both footer buttons are
 *                    visible at once, so nothing gates Save on finishing the
 *                    conditions step
 *   CC library       button[aria-label="CREATE"], and the open create menu
 *   CC create form   cc-name, cc-create-without-report ("Create without
 *                    selecting a report" — the only enabled primary there)
 *   CC create menu   cc-create-new-category ("Create a New Consent Category") and
 *                    cc-import-onetrust ("Import Consent Categories") — both echoed
 *                    back the right label, which is the check that matters here
 *                    given note 1 below
 *   OneTrust modal   cc-onetrust-url, cc-onetrust-location ("USA, Utah"),
 *                    cc-onetrust-detect ("Detect Your Consent Categories"),
 *                    cc-onetrust-sync ("Sync Categorized Cookies"). All seven
 *                    selectors added upstream for this flow resolve, to the right
 *                    elements. Note Sync is visible BEFORE the detect runs, so it
 *                    is not gated — which is why the detect step waits on
 *                    .options-selected-container rather than on Sync appearing.
 *
 * TWO SWEEP RESULTS WORTH KEEPING, because neither was findable by reading:
 *
 * 1. A ✓ can be the wrong element. On the CC create menu,
 *    `.mat-menu-op-button-2021 button[mat-menu-item]` reported VISIBLE while
 *    pointing at "Import Category Data from Template" instead of "Create a New
 *    Consent Category". So a tick is necessary and not sufficient — read the text
 *    the checker echoes back. That is what the echo is for.
 *
 * 2. "in DOM but hidden" is a finding, not a near miss. cc-create-next and
 *    cc-create-save both came back hidden on the consent-category create screen.
 *    That was not a timing problem: initFooterButtons() hides five of the eight
 *    footer buttons on the create path, and the step we wanted was a third
 *    button entirely. cc-create-save was also on TWO buttons, so it resolved to
 *    the hidden one. Reading the template found all eight buttons; only the
 *    sweep said which one was on screen.
 *
 * Still unlooked-at: report widgets, the alert quick-create dialog, the whole Quick
 * Audit screen, the rule conditions grid, the alert designer, and — inside the
 * otherwise-confirmed OneTrust flow — the location overlay's search box and option
 * rows, plus .options-selected-container, which only exists after a detect completes.
 *
 * 3. A SWEEP CAN INVENT EVIDENCE, and did. Two of the OneTrust sweeps reported
 *    `button[mat-menu-item] >> text=Audits` as "in DOM but hidden" on the consent
 *    category create menu. There is no Audits item on that menu. The hidden-fallback
 *    was matching the CSS part with the operators stripped, so ANY menu item on the
 *    page satisfied it. Fixed in content/index.js — the fallback now applies the
 *    operators too — but the lesson generalises: a ✓ or a · is a claim, and the echoed
 *    text is the only thing that substantiates it.
 *
 * 4. THE SWEEP ONLY SEES THE BRANCH IT ASKS FOR. allKnownSelectors() used to build
 *    every recipe with no parameters, which returns the DEGENERATE branch — the
 *    shortest one. The first OneTrust sweep therefore confirmed the location picker
 *    and never looked at the search box or the option row inside it, because with no
 *    location named the recipe emits one "pick yours" step instead of three. The two
 *    selectors most in need of verification were the two it could not see. It now
 *    plans with each parameter's `example`.
 *
 * Plus one that is awkward rather than unvisited — the consent-category menu row
 * exists only while the menu is open, a state that lasts between two steps. It is
 * catchable (an earlier sweep caught the row, which is how we learned the
 * selector was wrong), it just needs Check screen pressed with the menu still up.
 *
 * To clear a flag: stand on the screen, press Check screen, and if it resolves
 * — to the RIGHT element, per note 1 — drop its id from the call and add the
 * selector to the list above. Do not clear one because the code looks right.
 *
 * @param {Array} steps
 * @param {string[]} [ids] flag only these step ids. Omit to flag all of them.
 *   Sweeping proceeds a screen at a time, so the swept and unswept steps end up
 *   interleaved — create_first_consent_category is confirmed either side of s3.
 *   An id list says that in one place; splitting the array around each gap says
 *   it in three and drifts.
 */
export const unswept = (steps, ids) =>
  steps.map(step => (!ids || ids.includes(step.id) ? { ...step, unverified: true } : step))
