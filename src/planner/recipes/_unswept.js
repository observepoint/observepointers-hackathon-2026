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
 *   Location overlay input.mat-select-search-input:not(.mat-select-search-hidden) —
 *                    the :not() earns its keep, the library renders two inputs with
 *                    that class and the first is a spacer — and
 *                    `mat-option.loc-autocomplete >> text=USA, Utah`, which resolved
 *                    to "USA, Utah". FIRST LIVE PROOF OF LABEL-MATCHING, and the
 *                    reason to believe the rule and alert recipes, which address
 *                    every menu they touch that way.
 *   Post-detect      .options-selected-container -> "Detected with observepoint.com,
 *                    USA, Uta[h]". The wait is real and lands on the right element.
 *
 * import_consent_from_onetrust is therefore swept END TO END — nine targets and every
 * completion, including the three states that only exist mid-flow. It is the only
 * recipe in the library that can say that.
 *
 *   Alert designer   ALL 16 STEPS, across four screens.
 *                    button[aria-label="Create Alert"]; alert-name-control input;
 *                    input[aria-label="Select report metric"]; the whole metric menu
 *                    — "Audits" [1 of 24], "Tag & Variable Rules" [5 of 24], "Rule
 *                    Failures" [18 of 24]; the operator select and its option; the
 *                    threshold; input[aria-label="Search by URL"]; and Next.
 *
                     Plus the subscriber field on Notification and Save on Preview.
 *
 *                    NEXT AND SAVE SWAP, which contradicted what the recipe claimed.
 *                    updateButtons() reads `saveButton.hidden = isEditMode ? false :
 *                    currentStep !== Preview` and `nextButton.hidden = currentStep
 *                    === Preview`, and the sweep saw both halves: Save hidden on
 *                    Logic, Next hidden on Preview. Neither button is present
 *                    throughout. The recipe was right by accident — three Nexts land
 *                    on Preview before anything points at Save — and its comment said
 *                    the opposite.
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
 *   Rule builder     ALL 30 STEPS, across four passes. button[aria-label="Add
 *                    condition"]; Filter By and its "Tag" option; the Operator that
 *                    follows ("equals"); the tag autocomplete and `mat-option
 *                    .tag-id-option >> text=Google Universal Analytics` -> "Google
 *                    Universal AnalyticsWeb Analytics"; rule-when-add-variable and
 *                    rule-expect-add-variable; every grid cell in BOTH halves,
 *                    including their `>> last` forms; and `.grid-select-panel
 *                    mat-option >> text=is set`.
 *
 *   ORDERING, learned from using the screen rather than reading it: "Add Variable"
 *                    sets pointer-events: none while the row above is invalid. You
 *                    cannot add a second row before finishing the first, and a row
 *                    with only a name is still invalid because the default operator
 *                    ("equals") wants a value. So the recipe fills AND sets the
 *                    operator before adding the next row — reordering it would point
 *                    at an unclickable element and wait forever.
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
 *   Rule builder     button[aria-label="Add condition"]; Filter By
 *                    (if-condition mat-select[formControlName="type"]) and its "Tag"
 *                    option; the Operator that follows, reading "equals"; the tag
 *                    autocomplete and `mat-option.tag-id-option >> text=Google
 *                    Universal Analytics` -> "Google Universal AnalyticsWeb
 *                    Analytics"; rule-when-add-variable and rule-expect-add-variable,
 *                    both "Add Variable"; and every WHEN grid cell including its
 *                    `>> last` form — variable, the REGEX checkbox, OPERATOR
 *                    ("equals"), SELECTOR and VALUE.
 *
 *                    Plus the EXPECT half: then-condition's tag field, its
 *                    add-variable link, and both `>> last` grid cells there.
 *
 *                    `>> last` has not yet been checked against a grid with more than
 *                    one row, so the mechanism is confirmed and its discrimination is
 *                    not. The sweep now reports "matched N of M" for any selector
 *                    carrying an operator, which is what would settle it.

 *   ORDERING, learned from using the screen rather than reading it: "Add Variable"
 *                    sets pointer-events: none while the row above is invalid. You
 *                    cannot add a second row before finishing the first, and a row
 *                    with only a name is still invalid because the default operator
 *                    ("equals") wants a value. So the recipe fills AND sets the
 *                    operator before adding the next row — reordering it would point
 *                    at an unclickable element and wait forever.
 *
 * Still unlooked-at: report widgets, the alert quick-create dialog, the whole Quick
 * Audit screen, and the three steps that get from Data Sources into an EXISTING audit's
 * editor — the Audits & Journeys sidebar link, the card's overflow menu, and its Edit
 * item. Everything edit_audit_add_standards does after that is shared with the create
 * path and was swept there.
 *
 * Worth knowing about that path, because reading found it and nothing else would:
 * clicking an audit card opens its REPORT. The editor is behind the card's ⋮ menu, and
 * editAudit() opens AuditEditorComponent with panelClass 'op-audit-editor' — the same
 * advanced editor the create flow lands in, which is why the Standards half transfers
 * unchanged. The card's own selector embeds its id (sources-view-card-audit-1234), so
 * it can only be reached by prefix and the copy names the audit rather than pretending
 * to point at it. That is the entire remainder: alert_from_report needs an audit
 * with a completed run, and the Quick Audit branch needs an account with no data
 * sources. Everything else in the library has been watched resolve.
 *
 * 7. A LABEL THAT IS A PREFIX OF ANOTHER LABEL WILL SILENTLY PICK THE WRONG ONE, and
 *    the alert operator sweep is the proof that including the sign prevents it.
 *    `.alert-operator-selector mat-option >> text=Greater than (>)` resolved at
 *    position 2 of 13; the unfiltered `.alert-operator-selector mat-option` resolved
 *    at position 1, "Greater than or equal to (≥)". Matching "Greater than" on the
 *    words alone would have chosen the wrong operator, with a tick and no complaint.
 *    When a label is a prefix of a sibling, carry whatever distinguishes them.
 *
 * 6. THE SELECTOR LANGUAGE DISCRIMINATES — evidenced, not assumed. Every earlier tick
 *    on a `>> last` selector came from a grid with ONE row, where "the last one" and
 *    "the only one" are the same element, so all of them were equally consistent with
 *    the operator being ignored. Against three EXPECT rows it reported "matched 3 of
 *    3", and `>> text=is set` reported "matched 9 of 13" reading "is set" — the ninth
 *    entry in TagVariableOperators. That is why the sweep reports position at all: a
 *    tick proves a selector resolves, and only the position proves it resolved to the
 *    element that was asked for.
 *
 * 5. AN UNSCOPED OPTION SELECTOR WILL FIND THE WRONG OVERLAY, and did. Checked while
 *    the TAG autocomplete was open, `mat-option >> text=Tag` resolved to "Adobe DTMTag
 *    Management" — no option in that panel reads exactly "Tag", so it fell through to
 *    contains, and "DTMTag" contains it. Harmless in the real run, where only the
 *    Filter By panel is open at that step, and a plain warning about what a three
 *    letter label can reach.
 *
 *    Tightening the contains rule is NOT the fix: tag options render their category
 *    inline ("Google Universal AnalyticsWeb Analytics"), so exact matching alone could
 *    never find a tag. Scoping is. Material 22 gives every panel a type class
 *    (.mat-mdc-select-panel, .mat-mdc-autocomplete-panel) and this app supplies its own
 *    where it matters — .grid-select-panel, .alert-operator-selector.
 *
 *    Note the type class is shared by every select panel, so the Filter By scope also
 *    matches the grid's operator panel. Harmless — Material closes one overlay before
 *    opening another — and left alone rather than swapped for a panelClass added
 *    upstream, because the current selector is proven on a live page and a new one
 *    would not be. That trade is worth making the other way after the demo, not
 *    before it.
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
