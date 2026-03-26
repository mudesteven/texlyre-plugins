// extras/collaborative_viewers/excalidraw/ExcalidrawViewer.tsx
// NOTE: Requires @excalidraw/excalidraw to be installed.
// Run: npm install @excalidraw/excalidraw
// See README.md for full setup instructions.
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { CollaborativeViewerProps } from '@/plugins/PluginInterface';

// Module-level cache so we only load once across renders
let _ExcalidrawComponent: React.ComponentType<any> | null = null;
let _loadError: string | null = null;
let _loadPromise: Promise<void> | null = null;

function loadExcalidraw(): Promise<void> {
	if (_loadPromise) return _loadPromise;
	// eslint-disable-next-line @typescript-eslint/ban-ts-comment
	// @ts-ignore
	_loadPromise = import(/* @vite-ignore */ '@excalidraw/excalidraw') // skipcq
		.then((mod) => {
			_ExcalidrawComponent =
				mod.Excalidraw ?? mod.default?.Excalidraw ?? null;
		})
		.catch(() => {
			_loadError =
				'@excalidraw/excalidraw is not installed. Run: npm install @excalidraw/excalidraw';
		});
	return _loadPromise;
}

const DEBOUNCE_MS = 500;

const ExcalidrawViewer: React.FC<CollaborativeViewerProps> = ({
	content,
	onUpdateContent,
}) => {
	const [ready, setReady] = useState(
		_ExcalidrawComponent !== null || _loadError !== null,
	);
	const debounceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

	useEffect(() => {
		if (ready) return;
		loadExcalidraw().then(() => setReady(true));
	}, [ready]);

	useEffect(() => {
		return () => {
			if (debounceTimer.current) clearTimeout(debounceTimer.current);
		};
	}, []);

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
							viewBackgroundColor:
								appState.viewBackgroundColor ?? '#ffffff',
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

	if (!ready) {
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
				<p>Loading Excalidraw…</p>
			</div>
		);
	}

	if (_loadError) {
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

	if (!_ExcalidrawComponent) {
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

	const ExcalidrawComponent = _ExcalidrawComponent;

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
