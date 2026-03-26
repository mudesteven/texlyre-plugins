// extras/backup/google-drive/GoogleDriveService.ts
import { t } from '@/i18n';
import type { BackupServiceInterface } from '@/plugins/PluginInterface';
import type { BackupStatus } from '@/types/backup';

interface BackupActivity {
	id: string;
	type:
		| 'backup_start'
		| 'backup_complete'
		| 'backup_error'
		| 'import_start'
		| 'import_complete'
		| 'import_error';
	message: string;
	timestamp: number;
}

// Augment the window type for Google Identity Services
declare global {
	interface Window {
		google?: {
			accounts: {
				oauth2: {
					initTokenClient(config: {
						client_id: string;
						scope: string;
						callback: (response: { access_token?: string; error?: string }) => void;
					}): { requestAccessToken(): void };
					revoke(token: string, done: () => void): void;
				};
			};
		};
	}
}

const GIS_SCRIPT_URL = 'https://accounts.google.com/gsi/client';
const DRIVE_API_BASE = 'https://www.googleapis.com/drive/v3';
const DRIVE_UPLOAD_BASE = 'https://www.googleapis.com/upload/drive/v3';
const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.file';
const BACKUP_MIME = 'application/json';

export class GoogleDriveService implements BackupServiceInterface {
	private status: BackupStatus = {
		isConnected: false,
		isEnabled: false,
		lastSync: null,
		status: 'idle',
	};
	private listeners: Array<(status: BackupStatus) => void> = [];
	private activities: BackupActivity[] = [];
	private activityListeners: Array<(activities: BackupActivity[]) => void> = [];

	private accessToken: string | null = null;
	private clientId = '';
	private folderName = 'TeXlyre Backups';
	private folderId: string | null = null;
	private activityHistoryLimit = 50;

	// ─── Settings ───────────────────────────────────────────────────────────────

	setSettings(settings: {
		clientId?: string;
		folderName?: string;
		activityHistoryLimit?: number;
	}): void {
		if (settings.clientId !== undefined) this.clientId = settings.clientId;
		if (settings.folderName !== undefined) this.folderName = settings.folderName;
		if (settings.activityHistoryLimit !== undefined)
			this.activityHistoryLimit = settings.activityHistoryLimit;
	}

	// ─── Status helpers ──────────────────────────────────────────────────────────

	getStatus(): BackupStatus {
		return { ...this.status };
	}

	private updateStatus(patch: Partial<BackupStatus>): void {
		this.status = { ...this.status, ...patch };
		for (const listener of this.listeners) listener(this.getStatus());
	}

	addStatusListener(callback: (status: BackupStatus) => void): () => void {
		this.listeners.push(callback);
		return () => {
			this.listeners = this.listeners.filter((l) => l !== callback);
		};
	}

	// ─── Activity helpers ────────────────────────────────────────────────────────

	getActivities(): BackupActivity[] {
		return [...this.activities];
	}

	addActivityListener(
		callback: (activities: BackupActivity[]) => void,
	): () => void {
		this.activityListeners.push(callback);
		return () => {
			this.activityListeners = this.activityListeners.filter(
				(l) => l !== callback,
			);
		};
	}

	clearActivity(id: string): void {
		this.activities = this.activities.filter((a) => a.id !== id);
		this.notifyActivityListeners();
	}

	clearAllActivities(): void {
		this.activities = [];
		this.notifyActivityListeners();
	}

	private addActivity(
		type: BackupActivity['type'],
		message: string,
	): void {
		const activity: BackupActivity = {
			id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
			type,
			message,
			timestamp: Date.now(),
		};
		this.activities.unshift(activity);
		if (this.activities.length > this.activityHistoryLimit) {
			this.activities = this.activities.slice(0, this.activityHistoryLimit);
		}
		this.notifyActivityListeners();
	}

	private notifyActivityListeners(): void {
		for (const listener of this.activityListeners)
			listener(this.getActivities());
	}

	// ─── GIS script loading ──────────────────────────────────────────────────────

	private gisLoaded = false;
	private gisLoading: Promise<void> | null = null;

	private loadGIS(): Promise<void> {
		if (this.gisLoaded) return Promise.resolve();
		if (this.gisLoading) return this.gisLoading;

		this.gisLoading = new Promise<void>((resolve, reject) => {
			const existing = document.querySelector(
				`script[src="${GIS_SCRIPT_URL}"]`,
			);
			if (existing) {
				// Script already injected — wait for load or check if already loaded
				if (window.google?.accounts) {
					this.gisLoaded = true;
					resolve();
					return;
				}
				existing.addEventListener('load', () => {
					this.gisLoaded = true;
					resolve();
				});
				existing.addEventListener('error', () =>
					reject(new Error('Failed to load Google Identity Services')),
				);
				return;
			}

			const script = document.createElement('script');
			script.src = GIS_SCRIPT_URL;
			script.async = true;
			script.defer = true;
			script.onload = () => {
				this.gisLoaded = true;
				resolve();
			};
			script.onerror = () =>
				reject(new Error('Failed to load Google Identity Services'));
			document.head.appendChild(script);
		});

		return this.gisLoading;
	}

	// ─── OAuth2 token acquisition ────────────────────────────────────────────────

	private acquireToken(): Promise<string> {
		return new Promise(async (resolve, reject) => {
			if (!this.clientId) {
				reject(
					new Error(
						t(
							'Google Drive Client ID is not configured. Set it in Backup → Google Drive settings.',
						),
					),
				);
				return;
			}

			try {
				await this.loadGIS();
			} catch (err) {
				reject(err);
				return;
			}

			if (!window.google?.accounts?.oauth2) {
				reject(new Error('Google Identity Services failed to initialise'));
				return;
			}

			const tokenClient = window.google.accounts.oauth2.initTokenClient({
				client_id: this.clientId,
				scope: DRIVE_SCOPE,
				callback: (response) => {
					if (response.access_token) {
						this.accessToken = response.access_token;
						resolve(response.access_token);
					} else {
						reject(
							new Error(response.error ?? 'Failed to obtain access token'),
						);
					}
				},
			});

			tokenClient.requestAccessToken();
		});
	}

	// ─── BackupServiceInterface ──────────────────────────────────────────────────

	async requestAccess(): Promise<{ success: boolean; error?: string }> {
		try {
			await this.acquireToken();
			this.updateStatus({ isConnected: true, isEnabled: true });
			return { success: true };
		} catch (err) {
			const error = err instanceof Error ? err.message : String(err);
			this.updateStatus({ isConnected: false, error });
			return { success: false, error };
		}
	}

	async disconnect(): Promise<void> {
		if (this.accessToken && window.google?.accounts?.oauth2) {
			window.google.accounts.oauth2.revoke(this.accessToken, () => {});
		}
		this.accessToken = null;
		this.folderId = null;
		this.updateStatus({
			isConnected: false,
			isEnabled: false,
			lastSync: null,
			status: 'idle',
			error: undefined,
		});
	}

	async synchronize(projectId?: string): Promise<void> {
		await this.exportData(projectId);
	}

	async exportData(projectId?: string): Promise<void> {
		this.updateStatus({ status: 'syncing' });
		this.addActivity('backup_start', t('Starting Google Drive backup…'));

		try {
			const token = await this.ensureToken();
			const folderId = await this.ensureFolder(token);

			// Serialize project data
			// TODO: Hook into TeXlyre's ProjectDataService/UnifiedDataStructureService
			// to get the real project data. For now this exports a stub with metadata.
			const payload = await this.serializeProject(projectId);

			const fileName = projectId
				? `texlyre-backup-${projectId}.json`
				: 'texlyre-backup-all.json';

			// Check if file already exists in the folder
			const existingId = await this.findFileInFolder(token, folderId, fileName);

			if (existingId) {
				await this.updateDriveFile(token, existingId, payload);
			} else {
				await this.createDriveFile(token, folderId, fileName, payload);
			}

			this.updateStatus({ status: 'idle', lastSync: Date.now(), error: undefined });
			this.addActivity('backup_complete', t('Backup to Google Drive complete.'));
		} catch (err) {
			const error = err instanceof Error ? err.message : String(err);
			this.updateStatus({ status: 'error', error });
			this.addActivity('backup_error', `${t('Backup failed')}: ${error}`);
			throw err;
		}
	}

	async importChanges(projectId?: string): Promise<void> {
		this.updateStatus({ status: 'syncing' });
		this.addActivity('import_start', t('Starting Google Drive import…'));

		try {
			const token = await this.ensureToken();
			const folderId = await this.ensureFolder(token);

			const fileName = projectId
				? `texlyre-backup-${projectId}.json`
				: 'texlyre-backup-all.json';

			const fileId = await this.findFileInFolder(token, folderId, fileName);
			if (!fileId) {
				throw new Error(
					t('No backup file found in Google Drive folder "{name}".').replace(
						'{name}',
						this.folderName,
					),
				);
			}

			const data = await this.downloadDriveFile(token, fileId);

			// TODO: Hook into TeXlyre's ProjectImportService to apply the imported data.
			// For now we log the payload and stub the import.
			console.info('[GoogleDriveService] Import payload received:', data);

			this.updateStatus({ status: 'idle', lastSync: Date.now(), error: undefined });
			this.addActivity(
				'import_complete',
				t('Import from Google Drive complete.'),
			);
		} catch (err) {
			const error = err instanceof Error ? err.message : String(err);
			this.updateStatus({ status: 'error', error });
			this.addActivity('import_error', `${t('Import failed')}: ${error}`);
			throw err;
		}
	}

	// ─── Internal helpers ────────────────────────────────────────────────────────

	private async ensureToken(): Promise<string> {
		if (this.accessToken) return this.accessToken;
		return this.acquireToken();
	}

	/**
	 * Serialize the current project(s) to a JSON string.
	 * TODO: Replace with a call to TeXlyre's UnifiedDataStructureService or
	 * ProjectDataService to obtain the full project export.
	 */
	private async serializeProject(projectId?: string): Promise<string> {
		return JSON.stringify({
			exportedAt: new Date().toISOString(),
			source: 'texlyre',
			projectId: projectId ?? 'all',
			// Replace the stub below with actual project data:
			data: null,
		});
	}

	/** Ensure the target Drive folder exists and return its ID. */
	private async ensureFolder(token: string): Promise<string> {
		if (this.folderId) return this.folderId;

		// Search for existing folder
		const query = encodeURIComponent(
			`mimeType='application/vnd.google-apps.folder' and name='${this.folderName}' and trashed=false`,
		);
		const res = await this.driveRequest(
			token,
			`${DRIVE_API_BASE}/files?q=${query}&fields=files(id,name)`,
		);
		const json = await res.json();

		if (json.files && json.files.length > 0) {
			this.folderId = json.files[0].id as string;
			return this.folderId;
		}

		// Create folder
		const createRes = await this.driveRequest(token, `${DRIVE_API_BASE}/files`, {
			method: 'POST',
			headers: { 'Content-Type': BACKUP_MIME },
			body: JSON.stringify({
				name: this.folderName,
				mimeType: 'application/vnd.google-apps.folder',
			}),
		});
		const created = await createRes.json();
		this.folderId = created.id as string;
		return this.folderId;
	}

	private async findFileInFolder(
		token: string,
		folderId: string,
		fileName: string,
	): Promise<string | null> {
		const query = encodeURIComponent(
			`name='${fileName}' and '${folderId}' in parents and trashed=false`,
		);
		const res = await this.driveRequest(
			token,
			`${DRIVE_API_BASE}/files?q=${query}&fields=files(id,name)`,
		);
		const json = await res.json();
		return json.files && json.files.length > 0
			? (json.files[0].id as string)
			: null;
	}

	private async createDriveFile(
		token: string,
		folderId: string,
		fileName: string,
		content: string,
	): Promise<void> {
		const metadata = { name: fileName, parents: [folderId] };
		const form = new FormData();
		form.append(
			'metadata',
			new Blob([JSON.stringify(metadata)], { type: BACKUP_MIME }),
		);
		form.append('file', new Blob([content], { type: BACKUP_MIME }));

		await this.driveRequest(
			token,
			`${DRIVE_UPLOAD_BASE}/files?uploadType=multipart`,
			{ method: 'POST', body: form },
		);
	}

	private async updateDriveFile(
		token: string,
		fileId: string,
		content: string,
	): Promise<void> {
		await this.driveRequest(
			token,
			`${DRIVE_UPLOAD_BASE}/files/${fileId}?uploadType=media`,
			{
				method: 'PATCH',
				headers: { 'Content-Type': BACKUP_MIME },
				body: content,
			},
		);
	}

	private async downloadDriveFile(
		token: string,
		fileId: string,
	): Promise<unknown> {
		const res = await this.driveRequest(
			token,
			`${DRIVE_API_BASE}/files/${fileId}?alt=media`,
		);
		return res.json();
	}

	private async driveRequest(
		token: string,
		url: string,
		options: RequestInit = {},
	): Promise<Response> {
		const headers: HeadersInit = {
			Authorization: `Bearer ${token}`,
			...(options.headers as Record<string, string> | undefined),
		};
		const res = await fetch(url, { ...options, headers });
		if (!res.ok) {
			const text = await res.text().catch(() => res.statusText);
			throw new Error(`Drive API error ${res.status}: ${text}`);
		}
		return res;
	}
}

export const googleDriveService = new GoogleDriveService();
