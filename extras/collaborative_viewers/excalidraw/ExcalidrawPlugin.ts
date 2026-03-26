// extras/collaborative_viewers/excalidraw/ExcalidrawPlugin.ts
import type { CollaborativeViewerPlugin } from '@/plugins/PluginInterface';
import ExcalidrawViewer from './ExcalidrawViewer';

const EXCALIDRAW_EXTENSIONS = ['excalidraw', 'excalidraw.json'];
const EXCALIDRAW_MIMETYPES = ['application/json'];

const excalidrawPlugin: CollaborativeViewerPlugin = {
	id: 'excalidraw-collaborative-viewer',
	name: 'Excalidraw Collaborative Viewer',
	version: '1.0.0',
	type: 'collaborative-viewer',

	canHandle: (fileName: string, mimeType?: string): boolean => {
		// Handle .excalidraw.json (double extension)
		if (fileName.endsWith('.excalidraw.json') || fileName.endsWith('.excalidraw')) {
			return true;
		}
		// Check single extension
		const extension = fileName.split('.').pop()?.toLowerCase();
		if (extension && EXCALIDRAW_EXTENSIONS.includes(extension)) {
			return true;
		}
		// Narrow mimeType check — only if accompanied by excalidraw filename hint
		if (mimeType && EXCALIDRAW_MIMETYPES.includes(mimeType)) {
			return false; // too broad; rely on extension only
		}
		return false;
	},

	renderViewer: ExcalidrawViewer,
};

export default excalidrawPlugin;
