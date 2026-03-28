// src/hooks/useDriveAutoSync.ts
import { useEffect, useRef } from 'react';

import { useAuth } from './useAuth';
import { useSettings } from './useSettings';
import { googleDriveService, mimeTypeForPath } from '../services/GoogleDriveService';
import { fileStorageService } from '../services/FileStorageService';

/**
 * Listens for file-save events and syncs the saved file to Google Drive
 * after a 10-second debounce. Only active when Google Drive is connected
 * and the 'google-drive-auto-sync-on-save' setting is enabled.
 */
export function useDriveAutoSync(): void {
	const { user, googleStatus } = useAuth();
	const { getSetting, registerSetting } = useSettings();
	const syncTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
	const pendingFilesRef = useRef<Map<string, { fileId: string; content: string }>>(new Map());
	const settingsRegistered = useRef(false);

	useEffect(() => {
		if (settingsRegistered.current) return;
		settingsRegistered.current = true;
		registerSetting({
			id: 'google-drive-auto-sync-on-save',
			category: 'Google',
			subcategory: 'Drive Sync',
			type: 'checkbox',
			label: 'Sync source files to Drive on save',
			description: 'Upload edited source files to Google Drive 10 seconds after the last save.',
			defaultValue: false,
		});
	}, [registerSetting]);

	useEffect(() => {
		if (googleStatus !== 'connected' || !user) return;

		const handleFileSaved = (e: Event) => {
			if (getSetting('google-drive-auto-sync-on-save')?.value === false) return;

			const projectId = window.location.hash.match(/yjs:([^&]+)/)?.[1];
			if (!projectId) return;

			const { fileId, content } = (e as CustomEvent<{ fileId: string; content: string }>).detail;
			pendingFilesRef.current.set(fileId, { fileId, content });

			// Reset the debounce timer
			if (syncTimerRef.current) clearTimeout(syncTimerRef.current);
			syncTimerRef.current = setTimeout(async () => {
				const pending = new Map(pendingFilesRef.current);
				pendingFilesRef.current.clear();

				try {
					const rawFiles = await Promise.all(
						Array.from(pending.values()).map(async ({ fileId: fid, content }) => {
							const fileNode = await fileStorageService.getFile(fid);
							if (!fileNode?.path) return null;
							return {
								path: fileNode.path.replace(/^\//, ''), // strip leading slash
								content,
								mimeType: mimeTypeForPath(fileNode.path),
							};
						}),
					);

					const validFiles = rawFiles.filter(Boolean) as Array<{ path: string; content: string; mimeType: string }>;
					if (!validFiles.length) return;

					await googleDriveService.syncRawFiles(user.id, projectId, validFiles);
					console.log(`[useDriveAutoSync] Synced ${validFiles.length} file(s) to Drive`);
				} catch (err) {
					console.warn('[useDriveAutoSync] Source file sync failed:', err);
				}
			}, 10_000);
		};

		window.addEventListener('texlyre:file-saved', handleFileSaved);
		return () => {
			window.removeEventListener('texlyre:file-saved', handleFileSaved);
			if (syncTimerRef.current) clearTimeout(syncTimerRef.current);
		};
	}, [user, googleStatus, getSetting]);
}
