# Excalidraw Collaborative Viewer

This plugin provides collaborative editing for `.excalidraw` and `.excalidraw.json` files using the [Excalidraw](https://excalidraw.com/) library.

## Installation

The `@excalidraw/excalidraw` package is **not bundled** with TeXlyre. You must install it manually:

```bash
npm install @excalidraw/excalidraw
```

## Setup

1. Install the dependency (see above).
2. Ensure the plugin is registered in `texlyre.config.ts` under `plugins.collaborative_viewers`:
   ```ts
   collaborative_viewers: ['bibtex', 'drawio', 'excalidraw'],
   ```
3. Run `npm run generate-configs` to regenerate plugin configuration files.
4. Rebuild the project: `npm run build`.

## Supported File Extensions

- `.excalidraw`
- `.excalidraw.json`

## How It Works

- On open, the file content (ArrayBuffer) is decoded as UTF-8 and parsed as JSON.
- If the file is empty or invalid, Excalidraw opens with a blank canvas.
- Changes are debounced (500 ms) and serialized back to JSON via `onUpdateContent`.
- The serialized format is compatible with the standard Excalidraw file format.

## Notes

- Collaboration (Yjs awareness/cursors) is not yet implemented for this viewer.
- The viewer does not use `docUrl` / `documentId` from `CollaborativeViewerProps`; those props are available for future Yjs integration.
