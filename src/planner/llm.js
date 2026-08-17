/**
 * Gemini client.
 *
 * Two deliberate choices:
 *
 * 1. Raw REST, no SDK. One fewer dependency to version-pin, and the request
 *    shape is stable.
 * 2. The model name is DISCOVERED, not hard-coded. Google retires model names
 *    on a schedule (the 2.5 family shuts down in October 2026), so any constant
 *    shipped here rots and 404s for no reason. We ask the key what it can reach
 *    and pick the newest flash-class chat model.
 *
 * The API key lives in chrome.storage (set it on the Options page). That is
 * fine for a hackathon build everyone runs locally; it would NOT be acceptable
 * in a published extension, where anyone can unpack the crx and read it. The
 * real fix is a backend proxy — see PART1.md.
 */

const HOST = 'https://generativelanguage.googleapis.com/v1beta'

/**
 * Why there is a timeout at all.
 *
 * createPlan() already degrades to keyword matching when the model fails — and
 * that works: a live session hit "This model is currently experiencing high
 * demand", fell back, and produced a usable plan. But that path only runs on a
 * THROWN error. A hang throws nothing. The panel sits on "Working out the
 * steps…" forever and the fallback we wrote never fires, which on stage reads as
 * frozen rather than as degraded.
 *
 * Eight seconds is chosen against the demo, not against the API: past that the
 * keyword matcher's instant answer is worth more than a better match.
 */
export const TIMEOUT_MS = 8000

/**
 * fetch with a deadline, and an error message that says which call gave up.
 *
 * AbortError's own message is "The operation was aborted", which tells whoever
 * reads the warning line nothing about what happened. This turns it into
 * something that names the cause.
 */
async function fetchWithTimeout(url, options, what) {
  try {
    return await fetch(url, { ...options, signal: AbortSignal.timeout(TIMEOUT_MS) })
  } catch (error) {
    if (error?.name === 'TimeoutError' || error?.name === 'AbortError') {
      throw new Error(`Gemini ${what} timed out after ${TIMEOUT_MS / 1000}s`, { cause: error })
    }
    throw error
  }
}
const NOT_CHAT = /embedding|aqa|imagen|veo|tts|audio|image|live|gemma|learnlm/i

/** Newest first, flash before pro (latency matters here), stable over preview. */
export function rankModels(models = []) {
  return models
    .filter(m => m.supportedGenerationMethods?.includes('generateContent'))
    .map(m => m.name.replace(/^models\//, ''))
    .filter(id => !NOT_CHAT.test(id))
    .map(id => {
      const v = id.match(/gemini-(\d+)(?:\.(\d+))?/)
      let score = (v ? Number(v[1]) * 100 + Number(v[2] || 0) : 0) * 100
      if (/flash/i.test(id)) score += 30
      else if (/pro/i.test(id)) score += 20
      if (/lite/i.test(id)) score -= 15
      if (/preview|exp/i.test(id)) score -= 10
      if (/-\d{3,}$/.test(id)) score -= 5
      return { id, score }
    })
    .sort((a, b) => b.score - a.score || a.id.localeCompare(b.id))
    .map(m => m.id)
}

export class GeminiClient {
  constructor(apiKey, { model = null } = {}) {
    if (!apiKey) throw new Error('No Gemini API key. Add one on the extension Options page.')
    this.apiKey = apiKey
    this.model = model
  }

  async listModels() {
    const res = await fetchWithTimeout(
      `${HOST}/models?pageSize=200`,
      { headers: { 'x-goog-api-key': this.apiKey } },
      'model discovery',
    )
    const data = await res.json()
    if (!res.ok) throw new Error(data?.error?.message || `HTTP ${res.status}`)
    return data.models || []
  }

  async resolveModel() {
    if (this.model) return this.model
    const ranked = rankModels(await this.listModels())
    if (!ranked.length) throw new Error('This API key can reach no chat-capable Gemini models.')
    this.model = ranked[0]
    return this.model
  }

  /**
   * Ask for JSON matching `schema`. responseSchema makes Gemini emit valid JSON
   * rather than prose-wrapped JSON, so there is no fenced-code-block stripping
   * or half-parsed output to defend against.
   */
  async generateJson(prompt, schema) {
    const model = await this.resolveModel()

    const res = await fetchWithTimeout(
      `${HOST}/models/${model}:generateContent`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-goog-api-key': this.apiKey },
        body: JSON.stringify({
          contents: [{ role: 'user', parts: [{ text: prompt }] }],
          generationConfig: {
            responseMimeType: 'application/json',
            responseSchema: schema,
            maxOutputTokens: 2048,
          },
        }),
      },
      'generation',
    )

    const data = await res.json()

    if (!res.ok) {
      const detail = data?.error?.message || `HTTP ${res.status}`
      if (res.status === 404) {
        const ranked = rankModels(await this.listModels().catch(() => []))
        throw new Error(
          `Gemini rejected model "${model}". ${detail}` +
            (ranked.length ? `\nAvailable: ${ranked.slice(0, 5).join(', ')}` : ''),
        )
      }
      throw new Error(`Gemini: ${detail}`)
    }

    const candidate = data.candidates?.[0]
    if (data.promptFeedback?.blockReason || candidate?.finishReason === 'SAFETY') {
      throw new Error('Gemini declined that request.')
    }

    const text = candidate?.content?.parts?.map(p => p.text).join('') || ''
    try {
      return JSON.parse(text)
    } catch {
      throw new Error(`Gemini returned unparseable JSON: ${text.slice(0, 200)}`)
    }
  }
}

const KEY_STORAGE = 'geminiApiKey'

export async function getStoredApiKey() {
  if (typeof chrome === 'undefined' || !chrome.storage) return null
  const stored = await chrome.storage.sync.get(KEY_STORAGE)
  return stored?.[KEY_STORAGE] || null
}

export async function setStoredApiKey(key) {
  await chrome.storage.sync.set({ [KEY_STORAGE]: key })
}
