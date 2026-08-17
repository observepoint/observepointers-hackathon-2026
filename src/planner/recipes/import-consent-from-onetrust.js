import { NAV, stepsToLibrary } from './_standards-library.js'
import { normalizeSiteUrl } from '../naming.js'
import { unswept } from './_unswept.js'

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
 * THE LOCATION IS A PICK, NOT A FILL
 *
 * `ctlLocation` is a mat-select whose options come from OneTrust and are filtered by
 * a search box inside the overlay. We could try to drive that overlay, but the option
 * list is theirs and the names are theirs — "USA, Utah" here might be "United
 * States - Utah" in another tenant. So the user opens it and picks; the step names
 * what to look for.
 *
 * SELECTORS: all five added upstream; the modal previously had none. Nothing swept.
 */
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
      default: 'the location you need',
    },
  ],
  summaryTemplate:
    'OneTrust already has your approved tags and cookies, one set per domain and location, so this ' +
    "imports rather than rebuilds. We'll pull {{parameters.siteUrl}} for {{parameters.location}} — " +
    'rerun it per location if you need more than one.',
  steps: unswept([
    ...stepsToLibrary({
      link: NAV.consentCategoriesLink,
      label: 'Consent Categories',
      route: '/consent-categories',
    }),
    {
      id: 's2',
      actor: 'user',
      targetSelector: 'button[aria-label="Create a consent category"], button[aria-label="CREATE"]',
      say: 'Open the create menu.',
      targetFallback: { description: 'the create button on the Consent Categories page' },
      completion: {
        type: 'dom_mutation',
        condition: 'visible',
        targetSelector: '[op-selector="cc-import-onetrust"]',
      },
    },
    {
      id: 's3',
      actor: 'user',
      targetSelector: '[op-selector="cc-import-onetrust"]',
      say: 'Choose the OneTrust import.',
      targetFallback: { description: '"Import Consent Categories" with the OneTrust logo' },
      completion: {
        type: 'dom_mutation',
        condition: 'visible',
        targetSelector: '[op-selector="cc-onetrust-url"]',
      },
    },
    {
      id: 's4',
      actor: 'ai',
      targetSelector: '[op-selector="cc-onetrust-url"]',
      say: 'Setting the site to read the banner from.',
      targetFallback: { description: 'the "Where can the consent banner be found?" field' },
      action: { type: 'fill_text', value: '{{parameters.siteUrl}}' },
      completion: { type: 'dom_event', value: 'change' },
    },
    {
      id: 's5',
      actor: 'user',
      targetSelector: '[op-selector="cc-onetrust-location"]',
      say: 'Pick {{parameters.location}} — the list is searchable.',
      targetFallback: { description: 'the "From Which Location?" dropdown' },
      completion: { type: 'dom_event', value: 'click' },
    },
    {
      id: 's6',
      actor: 'user',
      targetSelector: '[op-selector="cc-onetrust-detect"]',
      say: 'Detect the categories. It takes 10–30 seconds.',
      targetFallback: { description: 'the "Detect Your Consent Categories" button' },
      completion: { type: 'dom_event', value: 'click' },
    },
    {
      id: 's7',
      actor: 'user',
      targetSelector: '[op-selector="cc-onetrust-sync"]',
      say: 'Import them. Rerun this per location if you need more.',
      targetFallback: { description: 'the "Sync Categorized Cookies" button' },
      completion: { type: 'dom_event', value: 'click' },
    },
  ]),

  /**
   * What to do next. Part 2's runner takes an array of plans, so a chained recipe
   * continues straight into the audit that uses what was just imported — which is
   * the actual goal; nobody imports consent categories for their own sake.
   */
  chain: 'audit_with_all_standards',

  /** Carried into the chained plan, so it does not re-ask for the site. */
  chainParameters: ['siteUrl'],
}
