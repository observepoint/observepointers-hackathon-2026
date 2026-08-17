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
 *   Swept — cc-name, bound onto the <input matInput> itself, so no descend.
 *   Swept — cc-create-without-report, echoed back as "Create without selecting a
 *           report", visible and enabled once the name is filled.
 *   Were wrong, both caught by sweeping rather than by reading:
 *           · the menu item resolved to the wrong ROW (see s3)
 *           · cc-create-next and cc-create-save are both HIDDEN on the create
 *             path (see s5), and cc-create-save was on two buttons at once
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
  // Everything is swept except s3, and s3 is awkward for a structural reason
  // rather than an unvisited one: the menu row only exists while the menu is
  // open, which is the transient state between s2 and s4. Check screen can catch
  // it — an earlier sweep did — it just needs someone to press the button with
  // the menu still up.
  steps: unswept(
    [
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
        targetSelector:
          'button[aria-label="Create a consent category"], button[aria-label="CREATE"]',
        say: 'Open the create menu.',
        targetFallback: { description: 'the create button on the Consent Categories page' },
        completion: {
          type: 'dom_mutation',
          condition: 'visible',
          targetSelector: '.mat-menu-op-button-2021',
        },
      },
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
        // Not cc-create-next, and not cc-create-save. A sweep reported both
        // "in DOM but hidden", and cc-create.component.ts::initFooterButtons()
        // says why: on the create path (not editing, not skipCreate) it hides
        // Prev, Next, "Create & Close" and the selection button, leaving only
        // "Create without selecting a report" and "Pull In Data From Selected
        // Report". There is no Next step to walk — the modal is a wizard only
        // once you pick a report to seed from.
        //
        // cc-create-save was doubly wrong: moonbeam had it on TWO buttons, so it
        // resolved to the hidden "Create & Close" rather than the visible one.
        // Fixed upstream on the hackathon branch; irrelevant here now that we
        // target neither.
        //
        // Enabled as soon as the name is non-empty and no report is selected
        // (cc-create.component.ts:1072), which is exactly the state s4 leaves.
        targetSelector: '[op-selector="cc-create-without-report"]',
        say: 'Create it. You add the approved tags and cookies afterwards — that list is the policy, so it is yours to set.',
        targetFallback: { description: 'the "Create without selecting a report" button' },
        completion: { type: 'dom_event', value: 'click' },
      },
    ],
    ['s3'],
  ),
}
