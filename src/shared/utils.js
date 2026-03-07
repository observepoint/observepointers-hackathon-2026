function createStorageArea(areaName) {
    const area = chrome.storage[areaName];

    return {
        get: (key) => new Promise((resolve, reject) => {
            area.get([key], (result) => {
                if (chrome.runtime.lastError) {
                    reject(new Error(chrome.runtime.lastError.message));
                    return;
                }

                resolve(result[key]);
            });
        }),
        set: (key, value) => new Promise((resolve, reject) => {
            area.set({ [key]: value }, () => {
                if (chrome.runtime.lastError) {
                    reject(new Error(chrome.runtime.lastError.message));
                    return;
                }

                resolve();
            });
        }),
    };
}

export const storage = {
    sync: createStorageArea('sync'),
    local: createStorageArea('local'),
};
