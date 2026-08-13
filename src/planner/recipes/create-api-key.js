/**
 * VERIFIED — every selector below was read out of moonbeam's source, not guessed.
 *   nav:    components/navigation/.../top-nav-*  -> top-nav-api-keys
 *   page:   components/api-keys/api-keys.component.html
 *   modal:  components/api-keys/api-keys-create-modal/api-keys-create-modal.component.html
 *
 * Selector convention: op-selector sits on ObservePoint's wrapper components
 * (op-text-input, op-button, op-textarea), NOT on the native control — so a
 * fill_text step has to descend to the real `input`/`textarea`, and a click has
 * to hit the real `button` (op-button binds Angular's (buttonClick), which a
 * synthetic click on the host will not fire).
 */
export default {
  id: 'create_api_key',
  title: 'Create an API key',
  verified: true,
  intent: {
    description:
      'Create a new API key so a script, CI job, or integration can call the ObservePoint API.',
    examples: [
      'I need an API key',
      'how do I create a token for the API',
      'set up API access for our CI pipeline',
      'generate a key so I can call the API from a script',
    ],
    keywords: ['api key', 'api token', 'token', 'api access', 'credential', 'integration key'],
  },
  parameters: [
    {
      name: 'keyName',
      description: 'Short name for the key, so it is recognisable in the list later',
      required: true,
      example: 'CI pipeline key',
    },
    {
      name: 'keyDescription',
      description: 'What the key is for — optional but recommended',
      required: false,
      default: 'Created with the ObservePoint Copilot',
    },
  ],
  summaryTemplate:
    'We\'ll open API Keys, start a new key called "{{parameters.keyName}}", fill in the details, and create it. Copy the key when it appears — it is only shown once.',
  steps: [
    {
      id: 's1',
      actor: 'user',
      navContext: '/account/api-keys',
      targetSelector: '[op-selector="top-nav-api-keys"]',
      say: 'API keys live under your account menu. Open that page first.',
      completion: { type: 'url_change', value: '/account/api-keys' },
    },
    {
      id: 's2',
      actor: 'user',
      targetSelector: '[op-selector="api-keys-create"] button',
      say: 'Start a new key here.',
      completion: {
        type: 'dom_mutation',
        condition: 'visible',
        targetSelector: '[op-selector="api-keys-create-modal"]',
      },
    },
    {
      id: 's3',
      actor: 'ai',
      targetSelector: '[op-selector="api-keys-create-name"] input',
      say: 'I\'ll name it "{{parameters.keyName}}" so you can find it in the list later.',
      action: { type: 'fill_text', value: '{{parameters.keyName}}' },
      completion: { type: 'dom_event', value: 'change' },
    },
    {
      id: 's4',
      actor: 'ai',
      targetSelector: '[op-selector="api-keys-create-description"] textarea',
      say: 'A short description saves you guessing what this key was for in six months.',
      action: { type: 'fill_text', value: '{{parameters.keyDescription}}' },
      completion: { type: 'dom_event', value: 'change' },
    },
    {
      id: 's5',
      actor: 'user',
      targetSelector: '[op-selector="api-keys-create-expiration"]',
      say: 'Pick how long the key should last. Shorter is safer — you can always make another.',
      completion: { type: 'dom_event', value: 'change' },
    },
    {
      id: 's6',
      actor: 'user',
      targetSelector: '[op-selector="api-keys-create-submit"] button',
      say: 'Create the key. The next screen shows it once and never again, so copy it straight away.',
      completion: {
        type: 'dom_mutation',
        condition: 'visible',
        targetSelector: '[op-selector="api-keys-reveal-modal"]',
      },
    },
    {
      id: 's7',
      actor: 'user',
      targetSelector: '[op-selector="api-keys-reveal-copy"] button',
      say: 'Copy it now and paste it somewhere safe — this is the only time it is shown.',
      completion: { type: 'dom_event', value: 'click' },
    },
  ],
}
