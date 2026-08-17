import { NAV, stepsToLibrary } from './_standards-library.js'
import { consentCategoryNameFrom, normalizeSiteUrl } from '../naming.js'
import { unswept } from './_unswept.js'

/**
 * The empty-account case for privacy.
 *
 * `audit_with_consent_categories` already handles "nothing in your account
 * covers this site" by ending on the Create New button inside the audit
 * editor. This recipe is the other entry point: someone who has no categories
 * at all and hasn't decided to create an audit yet. Same destination, reached
 * from the sidebar instead of from halfway through an audit setup.
 *
 * WHERE IT STOPS, AND WHY
 *
 * At the named, saved category — before the tag and cookie lists. Those lists
 * *are* the policy: they say which vendors the user's legal team has approved.
 * We cannot know that, and a guess here doesn't produce a wrong report, it
 * produces a confidently wrong compliance answer.
 *
 * SELECTORS
 *   Swept — sidebar-standards-consent-categories, and the CREATE button, which
 *           op-button-2021 gives aria-label="CREATE" from its labelText. The
 *           zero-state variant is in the same comma list; the two are mutually
 *           exclusive, so only one ever exists.
 *   Sourced — cc-name, cc-create-next, cc-create-save
 *           (ConsentCategoriesUIConstants.selectors). cc-name is bound onto the
 *           <input matInput> itself, so it needs no descend.
 *   Was wrong — the menu item. See the note on s3: a sweep found the obvious
 *           selector resolving to the wrong row.
 */
export default {
  id: 'create_first_consent_category',
  title: 'Create your first consent category',
  intent: {
    description:
      'Create a Consent Category from the library, from scratch. A consent category is the list ' +
      'of tags, cookies, geolocations and request domains you approve of — it is what makes a ' +
      'privacy audit able to report "unapproved". Use when the account has none yet, or when ' +
      'someone wants a new one rather than an audit that uses existing ones.',
    examples: [
      'create a consent category',
      'I need to define which cookies are approved',
      'we have no consent categories, help me set one up',
      'make a new consent category for our site',
      'set up our approved tag list',
    ],
    keywords: [
      'create a consent category',
      'create consent category',
      'new consent category',
      'first consent category',
      'approved cookies',
      'approved tags',
      'approved list',
      'define approved',
      'no consent categories',
    ],
  },
  parameters: [
    {
      name: 'siteUrl',
      description: 'Which site should this category cover',
      required: true,
      example: 'https://www.example.com',
      normalize: normalizeSiteUrl,
    },
    {
      name: 'categoryName',
      description: 'A name for the consent category',
      required: false,
      derive: consentCategoryNameFrom,
    },
  ],
  summaryTemplate:
    'A consent category is your definition of "approved" — without one, a privacy audit runs and ' +
    'reports nothing. We\'ll create one called "{{parameters.categoryName}}". You add the tags and ' +
    'cookies you actually allow, because that list is a policy decision, not a technical one.',
  // The sidebar step is swept; nothing past it is. Splitting the wrapper keeps
  // that distinction honest rather than rounding the whole recipe down.
  steps: [
    ...stepsToLibrary({
      link: NAV.consentCategoriesLink,
      label: 'Consent Categories',
      route: '/consent-categories',
    }),
    {
      id: 's2',
      actor: 'user',
      // Two buttons, never both: the page swaps in cc-zero-state when the
      // account has none, and that is exactly the account this recipe is for.
      // A comma list is safe when the halves are mutually exclusive.
      targetSelector: 'button[aria-label="Create a consent category"], button[aria-label="CREATE"]',
      say: 'Open the create menu.',
      targetFallback: { description: 'the create button on the Consent Categories page' },
      completion: {
        type: 'dom_mutation',
        condition: 'visible',
        targetSelector: '.mat-menu-op-button-2021',
      },
    },
    ...unswept([
      {
        id: 's3',
        actor: 'user',
        // A sweep caught this pointing at the WRONG row. The bare
        // button[mat-menu-item] resolved to "Import Category Data from
        // Template" — first of three — and reported itself visible. A selector
        // that resolves to the wrong control is worse than one that misses: the
        // miss falls through to targetFallback, the wrong hit walks someone
        // into an import dialog.
        //
        // buildCreateCCMenu() returns exactly three items, no separators, with
        // createNew last, so :last-child is right today. The attribute half
        // needs a moonbeam patch and sits on that same button, which makes this
        // the safe kind of comma list — both halves are one element either way.
        // Fragile in one direction only: append a fourth item and :last-child
        // moves. The attribute exists so that stops mattering.
        targetSelector:
          '[op-selector="cc-create-new-category"], .mat-menu-op-button-2021 button[mat-menu-item]:last-child',
        say: 'Choose "Create a New Consent Category" — the other two import from a template or OneTrust.',
        targetFallback: { description: '"Create a New Consent Category" in the open menu' },
        completion: {
          type: 'dom_mutation',
          condition: 'visible',
          targetSelector: '[op-selector="cc-name"]',
        },
      },
      {
        id: 's4',
        actor: 'ai',
        targetSelector: '[op-selector="cc-name"]',
        say: 'Naming it "{{parameters.categoryName}}".',
        targetFallback: { description: 'the "Name" field on the consent category form' },
        action: { type: 'fill_text', value: '{{parameters.categoryName}}' },
        completion: { type: 'dom_event', value: 'change' },
      },
      {
        id: 's5',
        actor: 'user',
        targetSelector: '[op-selector="cc-create-next"]',
        say: 'Add the tags and cookies you approve of — that list is what "approved" means here.',
        targetFallback: { description: 'the Next button in the consent category form' },
        completion: { type: 'dom_event', value: 'click' },
      },
      {
        id: 's6',
        actor: 'user',
        targetSelector: '[op-selector="cc-create-save"]',
        say: 'Save it. Any audit can now attach this under Standards.',
        targetFallback: { description: 'the Save button in the consent category form' },
        completion: { type: 'dom_event', value: 'click' },
      },
    ]),
  ],
}
