# Chrome Extension Skeleton (Vite + CRXJS)

A modern, production-ready skeleton for building Chrome Extensions using **Vite**, **CRXJS**, and **Manifest V3**.

## Features

- ⚡ **Instant HMR** (Hot Module Replacement) for all extension parts.
- 📦 **Manifest V3** compliant.
- 🛠 **Vite** powered build system.
- 🧩 **Examples included**:
  - **Popup**: Interactivity & State.
  - **Options**: Settings page with storage sync.
  - **Background**: Service Worker with alarms & context menus.
  - **Content Script**: Page injection & DOM manipulation.
  - **Side Panel**: Persistent side view (Chrome 114+).

## Project Structure

```text
src/
├── action/           # Popup (Action)
├── options/          # Options Page
├── background/       # Service Workers
├── content/          # Content Scripts
├── sidepanel/        # Side Panel
└── shared/           # Shared utilities
```

## Getting Started

### 1. Install Dependencies

```bash
npm install
```

### 2. Development Mode

```bash
npm run dev
```

This will start the Vite dev server.

- Open Chrome and go to `chrome://extensions`.
- Enable **Developer mode**.
- Drag and drop the `dist` folder into the extensions page (Note: CRXJS usually loads directly from memory or a specific path, check console output if needed, but standard `npm run dev` with CRXJS usually requires loading the `dist` folder once).
- **CRXJS Note**: When using `npm run dev`, load the `dist` folder. Vite will watch for changes and reload the extension automatically.

### 3. Build for Production

```bash
npm run build
```

Generates a production-ready build in the `dist` folder.

## Demos & Usage

- **Popup**: Click the extension icon to see a counter. It saves state to `chrome.storage.sync`.
- **Options**: Right-click the extension > Options. Change the preferred color to test settings storage.
- **Content Script**: Visit any website. You should see a small "Extension Active" overlay in the bottom right.
- **Background**: Open the extension `service worker` console to see "Alarm trigger" logs every minute.
- **Side Panel**: Enable the side panel in your browser to see the demo.

## Documentation Links

- [Chrome Extensions Documentation](https://developer.chrome.com/docs/extensions/)
- [Vite Documentation](https://vitejs.dev/)
- [CRXJS Vite Plugin](https://crxjs.dev/vite-plugin)
