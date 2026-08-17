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
 *
 * Still unlooked-at: the consent-category library and form, report widgets, the
 * alert quick-create dialog, and the whole Quick Audit screen. Those steps go
 * through unswept().
 *
 * To clear a flag: stand on the screen, press Check screen, and if it resolves,
 * drop the step out of the wrapper and add the screen to the list above. Do not
 * clear one because the code looks right.
 */
export const unswept = steps => steps.map(step => ({ ...step, unverified: true }))
