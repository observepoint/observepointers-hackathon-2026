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
 *   CC create form   cc-name
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
 * Still unlooked-at: the two consent-category selectors that changed after the
 * sweep above (the menu row and the create button), report widgets, the alert
 * quick-create dialog, and the whole Quick Audit screen.
 *
 * To clear a flag: stand on the screen, press Check screen, and if it resolves
 * — to the RIGHT element, per note 1 — drop its id from the call and add the
 * selector to the list above. Do not clear one because the code looks right.
 *
 * @param {Array} steps
 * @param {string[]} [ids] flag only these step ids. Omit to flag all of them.
 *   Sweeping proceeds a screen at a time, so the swept and unswept steps end up
 *   interleaved — create_first_consent_category has s3 and s5 outstanding with a
 *   confirmed s4 between them. An id list says that in one place; splitting the
 *   array around each gap says it in three and drifts.
 */
export const unswept = (steps, ids) =>
  steps.map(step => (!ids || ids.includes(step.id) ? { ...step, unverified: true } : step))
