import { SELECTORS, stepsToStandardsTab, auditParameters } from './_audit-standards.js'

/**
 * Privacy / consent compliance. Consent Categories are how ObservePoint decides
 * whether a tag, cookie, geo or request domain was *approved* to be there — so
 * an audit without one has no opinion about privacy at all.
 *
 * Worth knowing for the `say` copy: moonbeam ships three privacy banners
 * (privacy-banner-ccs-not-run, privacy-banner-no-ccs-applied,
 * privacy-banner-needs-reprocess). The middle one exists precisely because
 * people run privacy audits with no consent categories attached and then wonder
 * why the report is empty. That is the mistake this recipe prevents.
 *
 * The consent-category sub-tab only renders when `privacyEnabled` — it is
 * feature/permission gated (standards-tab.component.html). If the sub-tab is
 * missing the account doesn't have privacy enabled, which is worth saying out
 * loud rather than letting the pointer hunt for something that isn't there.
 */
export default {
  id: 'audit_with_consent_categories',
  title: 'Audit a site for consent / privacy compliance',
  verified: false,
  intent: {
    description:
      'Create a web audit and attach Consent Categories, so the audit reports which tags, ' +
      'cookies, geolocations and request domains are approved versus unapproved. Use for GDPR / ' +
      'CCPA / cookie-consent questions, or any "are we allowed to be running this" concern.',
    examples: [
      'check our site for privacy compliance',
      'audit example.com for GDPR',
      'I want to know which cookies are dropping before consent',
      'set up a consent category audit',
      'are we running any unapproved tags',
    ],
    keywords: [
      'consent category',
      'consent categories',
      'consent',
      'privacy',
      'gdpr',
      'ccpa',
      'cookie compliance',
      'unapproved',
      'approved tags',
      'before consent',
      'cmp',
    ],
  },
  parameters: auditParameters('Consent & privacy'),
  summaryTemplate:
    'We\'ll create an audit called "{{parameters.auditName}}" against {{parameters.siteUrl}} and attach ' +
    'Consent Categories under Standards. Without one attached, a privacy audit runs but reports nothing — ' +
    'the category is what defines "approved".',
  steps: [
    ...stepsToStandardsTab(),
    {
      id: 's7',
      actor: 'user',
      targetSelector: SELECTORS.subTabConsentCategories,
      say: 'Open Consent Categories.',
      targetFallback: { description: 'the "Consent Categories" sub-tab' },
      unverified: true,
      completion: {
        type: 'dom_mutation',
        condition: 'visible',
        targetSelector: '.op-standards-selector',
      },
    },
    {
      id: 's8',
      actor: 'user',
      targetSelector: SELECTORS.standardsSearch,
      say: 'Search for the category that covers this site.',
      targetFallback: { description: 'the search box in the consent categories picker' },
      unverified: true,
      completion: { type: 'dom_event', value: 'input' },
    },
    {
      id: 's9',
      actor: 'user',
      targetSelector: SELECTORS.standardsAddAll,
      say: 'Attach it.',
      targetFallback: { description: 'the "add all" button in the consent categories picker' },
      unverified: true,
      completion: { type: 'dom_event', value: 'click' },
    },
    {
      id: 's10',
      actor: 'user',
      targetSelector: SELECTORS.standardsCreateNew,
      say: 'Nothing matched? Create a category here instead.',
      targetFallback: { description: 'the "Create New Consent Category" button' },
      unverified: true,
      completion: { type: 'dom_event', value: 'click' },
    },
  ],
}
