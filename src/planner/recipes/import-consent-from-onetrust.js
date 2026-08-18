import { NAV, stepsToLibrary } from './_standards-library.js'
import { normalizeSiteUrl } from '../naming.js'
import { mentionsArea, wantsAudit, editsExistingAudit } from '../areas.js'

/**
 * Import consent categories from OneTrust, for one site and one location.
 *
 * WHY THIS IS THE REAL FIRST STEP FOR MOST ACCOUNTS
 *
 * `create_first_consent_category` builds one by hand, which means typing out every
 * approved tag and cookie. Almost nobody does that. If the account's CMP is OneTrust
 * — and the accounts we have looked at are full of "Analytical Cookies | example.com
 * | USA, Alabama" — the categories already exist over there, one per domain and
 * geography, and importing them is a four-field form rather than a policy exercise.
 *
 * That is also where the 79-categories-for-one-domain shape comes from, which the
 * audit recipes then have to disambiguate. So this is upstream of the interesting
 * problem rather than a footnote to it.
 *
 * ONE LOCATION AT A TIME, AND THAT IS THE APP'S CHOICE NOT OURS
 *
 * The modal takes a single URL and a single location, then detects and imports. Its
 * own copy says so: "To import or update consent categories for multiple domains
 * and/or locations, simply rerun this process". So the plan asks for one location and
 * says it is repeatable, rather than pretending a state-by-state import is one step.
 *
 * THE LOCATION: WE TYPE THE SEARCH, THE USER PICKS THE ROW
 *
 * `ctlLocation` is a mat-select whose overlay holds an ngx-mat-select-search box and
 * one option per OneTrust locale. Typing the search term is safe and saves scrolling
 * a list of hundreds. Choosing from the filtered result is not ours to do: the names
 * are the tenant's, and "Utah" narrows to "USA, Utah" here and might be "United
 * States - Utah" elsewhere. So we filter and the user confirms which row.
 *
 * When no location was named we skip both and just open the picker. A step that says
 * "search for Utah" when nobody mentioned Utah is worse than one that says "pick
 * yours".
 *
 * WAITING FOR THE DETECT
 *
 * Detect takes 10-30 seconds, and the honest completion is not the click — it is the
 * result appearing. `.options-selected-container` renders on
 * `detectDomain && !detectingCategories`, which is exactly "the detect finished", so
 * the step waits on that rather than advancing into a spinner.
 *
 * SELECTORS
 *   Added upstream — cc-import-onetrust, cc-onetrust-{url,location,detect,sync}. The
 *     modal had no op-selectors at all before this.
 *   The library's own — input.mat-select-search-input and mat-option.loc-autocomplete
 *     come from ngx-mat-select-search and the modal's template respectively, so they
 *     need no patch. The `:not(.mat-select-search-hidden)` matters: the library
 *     renders TWO inputs with that class and the first is a spacer.
 *
 *   ALL OF IT IS NOW SWEPT — nine targets and every completion, on a live local
 *   moonbeam, each echoing back the element it should. This is the only recipe in the
 *   library that has been verified end to end including the states that only exist
 *   mid-flow: the open create menu, the open location overlay, and the post-detect
 *   result row. Two things it settled that reading could not:
 *
 *     - `mat-option.loc-autocomplete >> text=USA, Utah` resolves, to "USA, Utah".
 *       That is the first live proof of label-matching, which is how the rule and
 *       alert recipes address every menu they touch.
 *     - `.options-selected-container` resolves after the detect, to "Detected with
 *       observepoint.com, USA, Uta[h]". So the wait is real and lands on the right
 *       thing — which matters because Sync is visible from the start and waiting on
 *       it instead would have advanced straight into the spinner.
 */

const SELECTORS = {
  createMenu: 'button[aria-label="Create a consent category"], button[aria-label="CREATE"]',
  importOneTrust: '[op-selector="cc-import-onetrust"]',
  url: '[op-selector="cc-onetrust-url"]',
  location: '[op-selector="cc-onetrust-location"]',
  locationSearch: 'input.mat-select-search-input:not(.mat-select-search-hidden)',
  locationOption: 'mat-option.loc-autocomplete',
  detect: '[op-selector="cc-onetrust-detect"]',
  detected: '.options-selected-container',
  sync: '[op-selector="cc-onetrust-sync"]',
}

/** The default is prose ("the location you need"), not a name we can search for. */
const NAMED_DEFAULT = 'the location you need'
const namedLocation = value =>
  value && value !== NAMED_DEFAULT && /[A-Za-z]{2}/.test(value) ? value : null

/** Ids are assigned last, because the location leg is one step or three. */
const numbered = steps => steps.map((step, i) => ({ ...step, id: `s${i + 1}` }))

export default {
  id: 'import_consent_from_onetrust',
  title: 'Import consent categories from OneTrust',
  intent: {
    description:
      'Import Consent Categories from a OneTrust CMP for one site and one location, rather than ' +
      'building them by hand. Use whenever OneTrust is mentioned, or when someone wants their ' +
      'existing consent setup pulled into ObservePoint instead of retyping it. OneTrust organises ' +
      'these per domain and per geography, so this runs once per location.',
    examples: [
      'import our consent categories from OneTrust',
      'pull in the OneTrust consent categories for gap.com',
      'we use OneTrust — get our approved cookies in',
      'sync OneTrust consent categories for USA, Utah',
      'import consent categories from our CMP',
    ],
    keywords: [
      'import from onetrust',
      'import our consent categories from onetrust',
      'onetrust consent categories',
      'sync onetrust',
      'from onetrust',
      'onetrust',
      'import consent categories',
      'import consent',
      'pull in consent categories',
      'from our cmp',
    ],
  },
  parameters: [
    {
      name: 'siteUrl',
      description: 'Which site is the consent banner on',
      required: true,
      example: 'https://www.example.com',
      normalize: normalizeSiteUrl,
    },
    {
      name: 'location',
      // Not required: the picker is the authority on what its options are called, so
      // an unnamed location becomes "pick yours" rather than a blocking question.
      description: 'Which OneTrust location to import',
      required: false,
      default: NAMED_DEFAULT,
      // Not just documentation: allKnownSelectors() plans with examples so the sweep
      // sees the named-location branch, which is where the search box and the option
      // row live. With only the default it emits one "pick yours" step and those two
      // selectors are invisible to verification.
      example: 'USA, Utah',
    },
  ],
  summaryTemplate:
    'OneTrust already has your approved tags and cookies, one set per domain and location, so this ' +
    "imports rather than rebuilds. We'll pull {{parameters.siteUrl}} for {{parameters.location}} — " +
    'rerun it per location if you need more than one.',

  buildSteps(context) {
    const named = namedLocation(context.parameters?.location)

    const locationLeg = named
      ? [
          {
            actor: 'user',
            targetSelector: SELECTORS.location,
            say: 'Open the location list.',
            // The picker itself is swept; the overlay it opens is not.

            targetFallback: { description: 'the "From Which Location?" dropdown' },
            completion: {
              type: 'dom_mutation',
              condition: 'visible',
              targetSelector: SELECTORS.locationSearch,
            },
          },
          {
            actor: 'ai',
            targetSelector: SELECTORS.locationSearch,
            say: `Filtering the list to "${named}".`,
            targetFallback: { description: 'the search box at the top of the location list' },
            action: { type: 'fill_text', value: named },
            completion: { type: 'dom_event', value: 'input' },
          },
          {
            actor: 'user',
            // Matched on the visible label: the locale names are OneTrust's and
            // differ between tenants.
            targetSelector: `${SELECTORS.locationOption} >> text=${named}`,
            say: `Choose the ${named} row.`,
            targetFallback: { description: `the ${named} option in the location list` },
            completion: { type: 'dom_event', value: 'click' },
          },
        ]
      : [
          {
            actor: 'user',
            targetSelector: SELECTORS.location,
            say: 'Pick your location — the list is searchable.',
            targetFallback: { description: 'the "From Which Location?" dropdown' },
            completion: { type: 'dom_event', value: 'click' },
          },
        ]

    return numbered([
      ...stepsToLibrary({
        link: NAV.consentCategoriesLink,
        label: 'Consent Categories',
        route: '/consent-categories',
      }).map(({ id: _id, ...step }) => step),
      {
        actor: 'user',
        targetSelector: SELECTORS.createMenu,
        say: 'Open the create menu.',
        targetFallback: { description: 'the create button on the Consent Categories page' },
        completion: {
          type: 'dom_mutation',
          condition: 'visible',
          targetSelector: SELECTORS.importOneTrust,
        },
      },
      {
        actor: 'user',
        targetSelector: SELECTORS.importOneTrust,
        say: 'Choose the OneTrust import.',
        targetFallback: { description: '"Import Consent Categories" with the OneTrust logo' },
        completion: {
          type: 'dom_mutation',
          condition: 'visible',
          targetSelector: SELECTORS.url,
        },
      },
      {
        actor: 'ai',
        targetSelector: SELECTORS.url,
        say: 'Setting the site to read the banner from.',
        targetFallback: { description: 'the "Where can the consent banner be found?" field' },
        action: { type: 'fill_text', value: '{{parameters.siteUrl}}' },
        completion: { type: 'dom_event', value: 'change' },
      },
      ...locationLeg,
      {
        actor: 'user',
        targetSelector: SELECTORS.detect,
        say: 'Detect the categories. It takes 10–30 seconds.',
        targetFallback: { description: 'the "Detect Your Consent Categories" button' },
        // The click is not the end of this step — the detect is. Waiting on the
        // result row means the next step never lands mid-spinner.
        completion: {
          type: 'dom_mutation',
          condition: 'visible',
          targetSelector: SELECTORS.detected,
        },
      },
      {
        actor: 'user',
        targetSelector: SELECTORS.sync,
        say: 'Import them. Rerun this per location if you need more.',
        targetFallback: { description: 'the "Sync Categorized Cookies" button' },
        completion: { type: 'dom_event', value: 'click' },
      },
    ])
  },

  /**
   * What follows, decided from the request rather than fixed.
   *
   * "Import our OneTrust consent categories" is finished when they are imported.
   * "observepoint.com uses OneTrust — import our consent categories for Utah, then
   * audit the site against them with tag rules and alert me if anything breaks" is
   * four walkthroughs, and the import is only the first. Queueing an audit onto the
   * first phrasing would be inventing work; dropping three quarters of the second
   * would be the bug audit_with_all_standards was written to fix, one level up.
   *
   * Order is prerequisites-first, because that is the actual dependency: the audit's
   * Standards picker can only attach a rule or an alert that already exists.
   */
  buildChain(context) {
    if (!wantsAudit(context.goal)) return null

    const links = []
    if (mentionsArea(context.goal, 'rules')) links.push('create_tag_variable_rule')
    if (mentionsArea(context.goal, 'alerts')) links.push('create_first_alert')

    // Edit the audit that exists, or build one. The create path types a name and a
    // starting URL, so running it against an existing audit overwrites two fields
    // nobody asked about and leaves the account with two audits.
    links.push(
      editsExistingAudit(context.goal) ? 'edit_audit_add_standards' : 'audit_with_all_standards',
    )
    return links
  },
}
