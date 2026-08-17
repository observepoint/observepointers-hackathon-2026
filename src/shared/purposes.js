// Answers to onboarding question 2: "What is your purpose for using ObservePoint?"
//
// These are ObservePoint's own use cases, taken from the Use Case Library
// categories and the Recommended Alerts groupings -- not invented labels. Using
// the product's real terminology matters: a walkthrough that calls things by
// different names than the UI does is worse than no walkthrough.
//
// `recipeIds` drives two things: which walkthroughs the picker surfaces first, and
// the chain that onboarding queues up once the user has answered.

export const PURPOSES = [
  {
    id: 'analytics-validation',
    label: 'Analytics Validation',
    blurb: 'Confirm your tags fire with the right variables on every page.',
    recipeIds: ['create-first-audit', 'audit-report-network-requests'],
  },
  {
    id: 'web-privacy',
    label: 'Web Privacy',
    blurb: 'Find unapproved cookies, tags, and data transfers across your site.',
    recipeIds: ['privacy-consent-categories', 'audit-report-network-requests'],
  },
  {
    id: 'consent-management',
    label: 'Consent Management Validation',
    blurb: 'Verify your CMP actually blocks tags and cookies before consent.',
    recipeIds: ['privacy-consent-categories'],
  },
  {
    id: 'user-flow-validation',
    label: 'User Flow Validation',
    blurb: 'Test checkout, forms, and funnels end to end with Journeys.',
    recipeIds: ['journey-cookies'],
  },
  {
    id: 'tag-cookie-inventory',
    label: 'Tag & Cookie Inventory',
    blurb: 'See every tag and cookie on your site, and what set it.',
    recipeIds: ['audit-report-network-requests', 'create-first-audit'],
  },
  {
    id: 'data-layer-validation',
    label: 'Data Layer Validation',
    blurb: 'Confirm data layer objects and variable mapping are correct.',
    recipeIds: ['create-first-audit'],
  },
  {
    id: 'landing-page-validation',
    label: 'Landing Page Validation',
    blurb: 'Check campaign pages, redirects, and query parameters.',
    recipeIds: ['create-first-audit'],
  },
  {
    id: 'accessibility',
    label: 'WCAG Accessibility',
    blurb: 'Automated WCAG 2.1 and 2.2 testing across your pages.',
    recipeIds: ['create-first-audit'],
  },
  {
    id: 'email-link-validation',
    label: 'Email Link Validation',
    blurb: 'Validate the links in marketing emails before you send.',
    recipeIds: [],
  },
]

const BY_ID = new Map(PURPOSES.map(p => [p.id, p]))

export function getPurpose(id) {
  return BY_ID.get(id)
}

/**
 * Build the ordered recipe chain for a set of selected purposes.
 *
 * Everyone starts with the left-nav orientation, then we append each purpose's
 * recipes in the order the purposes are listed above, de-duplicated so overlapping
 * selections (Web Privacy and Consent Management both want the consent recipe)
 * don't queue the same walkthrough twice.
 */
export function buildChain(purposeIds, { includeOrientation = true } = {}) {
  const chain = includeOrientation ? ['orientation-left-nav'] : []
  const selected = new Set(purposeIds)

  for (const purpose of PURPOSES) {
    if (!selected.has(purpose.id)) continue

    for (const recipeId of purpose.recipeIds) if (!chain.includes(recipeId)) chain.push(recipeId)
  }

  return chain
}
