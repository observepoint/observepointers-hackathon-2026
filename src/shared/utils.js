function createStorageArea(areaName) {
  const area = chrome.storage[areaName]

  const get = key =>
    new Promise((resolve, reject) => {
      area.get([key], result => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message))
          return
        }

        resolve(result[key])
      })
    })

  const set = (key, value) =>
    new Promise((resolve, reject) => {
      area.set({ [key]: value }, () => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message))
          return
        }

        resolve()
      })
    })

  return {
    get,
    set,
    getMany: keys =>
      new Promise((resolve, reject) => {
        area.get(keys, result => {
          if (chrome.runtime.lastError) {
            reject(new Error(chrome.runtime.lastError.message))
            return
          }

          resolve(result)
        })
      }),
    remove: key =>
      new Promise((resolve, reject) => {
        area.remove(key, () => {
          if (chrome.runtime.lastError) {
            reject(new Error(chrome.runtime.lastError.message))
            return
          }

          resolve()
        })
      }),
    // Read-modify-write, for accumulating progress and trigger state. It
    // must tolerate an absent key: `fn` receives undefined on first write.
    update: async (key, fn) => {
      const next = fn(await get(key))
      await set(key, next)
      return next
    },
    // Fires only for this area and key. Returns an unsubscribe function.
    subscribe: (key, callback) => {
      const listener = (changes, changedArea) => {
        if (changedArea !== areaName) return
        if (!Object.prototype.hasOwnProperty.call(changes, key)) return

        callback(changes[key].newValue, changes[key].oldValue)
      }

      chrome.storage.onChanged.addListener(listener)
      return () => chrome.storage.onChanged.removeListener(listener)
    },
  }
}

export const storage = {
  sync: createStorageArea('sync'),
  local: createStorageArea('local'),
}

/** Storage keys, in one place so nothing drifts between contexts. */
export const KEYS = {
  // storage.sync — onboarding answers. Travels with the user across machines.
  PROFILE: 'op_wt_profile',
  // storage.local — RESERVED FOR THE PAGE LAYER (Person 3). The active walkthrough:
  // whatever it needs to resume at the right step after a hard reload. Nothing on this
  // side reads or writes it; it's named here only so the key can't collide.
  SESSION: 'op_wt_session',
  // storage.local — completed recipes and trigger suppression state.
  PROGRESS: 'op_wt_progress',
}

/**
 * Session ids only need to be unique within a browser profile and readable in a
 * log line, so a timestamp plus a short random suffix beats a real UUID here.
 */
export function newSessionId() {
  return `wt_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
}
