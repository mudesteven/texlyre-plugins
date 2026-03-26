// extras/collaborative_viewers/excalidraw/ExcalidrawViewer.tsx
// NOTE: Requires @excalidraw/excalidraw to be installed.
// Run: npm install @excalidraw/excalidraw
// See README.md for full setup instructions.
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { CollaborativeViewerProps } from '@/plugins/PluginInterface';

// Dynamic import to avoid hard build failure when package is absent
let ExcalidrawComponent: React.ComponentType<any> | null = null;
let excalidrawImportError: string | null = null;

try {
	// This will be resolved at build time by the bundler
	// eslint-disable-next-line @typescript-eslint/no-require-imports
	const mod = require('@excalidraw/excalidraw');
	ExcalidrawComponent = mod.Excalidraw ?? mod.default?.Excalidraw ?? null;
} catch (e) {
	excalidrawImportError =
		'@excalidraw/excalidraw is not installed. Run: npm install @excalidraw/excalidraw';
}

const DEBOUNCE_MS = 500;

const ExcalidrawViewer: React.FC<CollaborativeViewerProps> = ({
	content,
	onUpdateContent,
}) => {
	const [importError] = useState<string | null>(excalidrawImportError);
	const debounceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

	const initialData = useMemo(() => {
		try {
			if (!content || content.byteLength === 0) return null;
			const text = new TextDecoder('utf-8').decode(content);
			if (!text.trim()) return null;
			const parsed = JSON.parse(text);
			return {
				elements: parsed.elements ?? [],
				appState: parsed.appState ?? {},
				files: parsed.files ?? {},
			};
		} catch {
			return null;
		}
	}, [content]);

	// Cleanup debounce on unmount
	useEffect(() => {
		return () => {
			if (debounceTimer.current) clearTimeout(debounceTimer.current);
		};
	}, []);

	const handleChange = useCallback(
		(elements: readonly any[], appState: any, files: any) => {
			if (debounceTimer.current) clearTimeout(debounceTimer.current);
			debounceTimer.current = setTimeout(() => {
				try {
					const serialized = JSON.stringify({
						type: 'excalidraw',
						version: 2,
						source: 'texlyre',
						elements,
						appState: {
							gridSize: appState.gridSize ?? null,
							viewBackgroundColor: appState.viewBackgroundColor ?? '#ffffff',
						},
						files: files ?? {},
					});
					onUpdateContent(serialized);
				} catch (err) {
					console.error('[ExcalidrawViewer] Failed to serialize canvas:', err);
				}
			}, DEBOUNCE_MS);
		},
		[onUpdateContent],
	);

	if (importError) {
		return (
			<div
				style={{
					display: 'flex',
					alignItems: 'center',
					justifyContent: 'center',
					width: '100%',
					height: '100%',
					padding: '2rem',
					flexDirection: 'column',
					gap: '1rem',
					fontFamily: 'system-ui, sans-serif',
				}}
			>
				<div style={{ fontSize: '2rem' }}>⚠️</div>
				<p style={{ fontWeight: 600, margin: 0 }}>Package not installed</p>
				<code
					style={{
						background: 'rgba(0,0,0,0.08)',
						padding: '0.5rem 1rem',
						borderRadius: '6px',
					}}
				>
					npm install @excalidraw/excalidraw
				</code>
				<p style={{ margin: 0, opacity: 0.7, fontSize: '0.875rem' }}>
					See extras/collaborative_viewers/excalidraw/README.md for details.
				</p>
			</div>
		);
	}

	if (!ExcalidrawComponent) {
		return (
			<div
				style={{
					display: 'flex',
					alignItems: 'center',
					justifyContent: 'center',
					width: '100%',
					height: '100%',
				}}
			>
				<p>Excalidraw component could not be loaded.</p>
			</div>
		);
	}

	return (
		<div style={{ width: '100%', height: '100%' }}>
			<ExcalidrawComponent
				initialData={initialData}
				onChange={handleChange}
			/>
		</div>
	);
};

export default ExcalidrawViewer;
