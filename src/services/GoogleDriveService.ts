// src/services/GoogleDriveService.ts
import { authService } from './AuthService';
import { googleAuthService } from './GoogleAuthService';
import type { DriveFileMapEntry } from '../types/auth';

const DRIVE_API = 'https://www.googleapis.com/drive/v3';
const DRIVE_UPLOAD_API = 'https://www.googleapis.com/upload/drive/v3';
const ROOT_FOLDER_NAME = 'TeXlyre';

export interface RawFileEntry {
	path: string;           // relative path, e.g. 'src/main.typ'
	content: string | Uint8Array;
	mimeType: string;
	modifiedAt?: number;
}

export interface SyncResult {
	uploaded: string[];
	updated: string[];
	failed: Array<{ path: string; error: string }>;
	timestamp: number;
}

const MIME_MAP: Record<string, string> = {
	typ: 'text/plain',
	tex: 'text/x-tex',
	bib: 'text/plain',
	pdf: 'application/pdf',
	png: 'image/png',
	jpg: 'image/jpeg',
	jpeg: 'image/jpeg',
	svg: 'image/svg+xml',
	json: 'application/json',
	md: 'text/markdown',
	txt: 'text/plain',
};

export function mimeTypeForPath(path: string): string {
	const ext = path.split('.').pop()?.toLowerCase() ?? '';
	return MIME_MAP[ext] ?? 'application/octet-stream';
}

/** Short 6-char suffix from a UUID for human-readable folder names */
function shortId(id: string): string {
	return id.replace(/-/g, '').slice(0, 6);
}

class GoogleDriveService {
	// ── Internal helpers ──────────────────────────────────────────────────────

	private async getToken(userId: string): Promise<string> {
		const token = await googleAuthService.getValidToken(userId);
		if (!token) throw new Error('No valid Google token. Please re-connect your Google account.');
		return token;
	}

	private async driveRequest(token: string, url: string, options: RequestInit = {}): Promise<Response> {
		const res = await fetch(url, {
			...options,
			headers: {
				Authorization: `Bearer ${token}`,
				...(options.headers ?? {}),
			},
		});
		if (!res.ok) {
			const body = await res.text().catch(() => '');
			throw new Error(`Drive API error ${res.status}: ${body}`);
		}
		return res;
	}

	private async findFolder(token: string, name: string, parentId?: string): Promise<string | null> {
		const parentQuery = parentId ? ` and '${parentId}' in parents` : " and 'root' in parents";
		const q = `mimeType='application/vnd.google-apps.folder' and name='${name}'${parentQuery} and trashed=false`;
		const url = `${DRIVE_API}/files?q=${encodeURIComponent(q)}&fields=files(id,name)`;
		const res = await this.driveRequest(token, url);
		const data = await res.json();
		return data.files?.[0]?.id ?? null;
	}

	private async createFolder(token: string, name: string, parentId?: string): Promise<string> {
		const metadata: Record<string, unknown> = {
			name,
			mimeType: 'application/vnd.google-apps.folder',
		};
		if (parentId) metadata.parents = [parentId];

		const res = await this.driveRequest(token, `${DRIVE_API}/files?fields=id`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify(metadata),
		});
		const data = await res.json();
		return data.id;
	}

	private async ensureFolder(token: string, name: string, parentId?: string): Promise<string> {
		const existing = await this.findFolder(token, name, parentId);
		return existing ?? this.createFolder(token, name, parentId);
	}

	private async ensureRootFolder(token: string): Promise<string> {
		return this.ensureFolder(token, ROOT_FOLDER_NAME);
	}

	private async ensureProjectFolder(token: string, rootId: string, projectId: string, projectName: string): Promise<string> {
		const folderName = `${projectName.replace(/[/\\?%*:|"<>]/g, '-')}-${shortId(projectId)}`;
		return this.ensureFolder(token, folderName, rootId);
	}

	private async ensureSubFolder(token: string, parentId: string, name: string): Promise<string> {
		return this.ensureFolder(token, name, parentId);
	}

	private contentToBlob(content: string | Uint8Array, mimeType: string): Blob {
		if (typeof content === 'string') {
			return new Blob([content], { type: mimeType });
		}
		// Copy into a plain ArrayBuffer to satisfy strict Blob typing
		const plain = new Uint8Array(content).buffer as ArrayBuffer;
		return new Blob([plain], { type: mimeType });
	}

	private async uploadFileMultipart(
		token: string,
		folderId: string,
		fileName: string,
		content: string | Uint8Array,
		mimeType: string,
	): Promise<string> {
		const metadata = JSON.stringify({ name: fileName, parents: [folderId] });
		const blob = this.contentToBlob(content, mimeType);

		const form = new FormData();
		form.append('metadata', new Blob([metadata], { type: 'application/json' }));
		form.append('file', blob);

		const res = await this.driveRequest(token, `${DRIVE_UPLOAD_API}/files?uploadType=multipart&fields=id`, {
			method: 'POST',
			body: form,
		});
		const data = await res.json();
		return data.id;
	}

	private async updateFileContent(
		token: string,
		fileId: string,
		content: string | Uint8Array,
		mimeType: string,
	): Promise<void> {
		const blob = this.contentToBlob(content, mimeType);
		await this.driveRequest(token, `${DRIVE_UPLOAD_API}/files/${fileId}?uploadType=media`, {
			method: 'PATCH',
			headers: { 'Content-Type': mimeType },
			body: blob,
		});
	}

	// ── Public API ────────────────────────────────────────────────────────────

	/**
	 * Sync a set of source files for a project to Google Drive.
	 * Uses the drive_file_map to update existing files and only create new ones.
	 */
	async syncRawFiles(userId: string, projectId: string, files: RawFileEntry[]): Promise<SyncResult> {
		const project = await authService.getProjectById(projectId);
		if (!project) throw new Error(`Project not found: ${projectId}`);

		const token = await this.getToken(userId);
		const rootId = await this.ensureRootFolder(token);
		const projectFolderId = await this.ensureProjectFolder(token, rootId, project.id, project.name);

		// Pre-load the full file map for this project
		const existingEntries = await authService.getDriveFileMapForProject(userId, project.id);
		const entryMap = new Map<string, DriveFileMapEntry>(existingEntries.map(e => [e.path, e]));

		const result: SyncResult = { uploaded: [], updated: [], failed: [], timestamp: Date.now() };

		for (const file of files) {
			try {
				const mimeType = file.mimeType || mimeTypeForPath(file.path);
				const fileName = file.path.split('/').pop() ?? file.path;
				// Ensure sub-folder exists (e.g. 'src', 'output')
				const parts = file.path.split('/');
				let parentId = projectFolderId;
				for (let i = 0; i < parts.length - 1; i++) {
					parentId = await this.ensureSubFolder(token, parentId, parts[i]);
				}

				const existing = entryMap.get(file.path);
				let driveFileId: string;

				if (existing) {
					await this.updateFileContent(token, existing.driveFileId, file.content, mimeType);
					driveFileId = existing.driveFileId;
					result.updated.push(file.path);
				} else {
					driveFileId = await this.uploadFileMultipart(token, parentId, fileName, file.content, mimeType);
					result.uploaded.push(file.path);
				}

				await authService.putDriveFileMapEntry({
					userId,
					projectId: project.id,
					path: file.path,
					driveFileId,
					lastSynced: result.timestamp,
				});
			} catch (err) {
				const error = err instanceof Error ? err.message : String(err);
				result.failed.push({ path: file.path, error });
				console.error(`[GoogleDriveService] Failed to sync ${file.path}:`, err);
			}
		}

		return result;
	}

	/**
	 * Upload a compiled PDF to the project's output/ folder in Drive.
	 */
	async uploadPdf(userId: string, projectId: string, pdfBytes: Uint8Array, fileName: string): Promise<void> {
		const file: RawFileEntry = {
			path: `output/${fileName}`,
			content: pdfBytes,
			mimeType: 'application/pdf',
		};
		await this.syncRawFiles(userId, projectId, [file]);
	}

	/**
	 * Download all source files for a project from Drive.
	 * Returns an array of RawFileEntry objects for import.
	 */
	async downloadRawFiles(userId: string, projectId: string): Promise<RawFileEntry[]> {
		const token = await this.getToken(userId);
		const entries = await authService.getDriveFileMapForProject(userId, projectId);
		const results: RawFileEntry[] = [];

		for (const entry of entries) {
			try {
				const res = await this.driveRequest(token, `${DRIVE_API}/files/${entry.driveFileId}?alt=media`);
				const mimeType = mimeTypeForPath(entry.path);
				if (mimeType.startsWith('text/') || mimeType === 'application/json') {
					const text = await res.text();
					results.push({ path: entry.path, content: text, mimeType });
				} else {
					const buffer = await res.arrayBuffer();
					results.push({ path: entry.path, content: new Uint8Array(buffer), mimeType });
				}
			} catch (err) {
				console.error(`[GoogleDriveService] Failed to download ${entry.path}:`, err);
			}
		}

		return results;
	}

	/**
	 * Remove all Drive file map entries for a deleted project.
	 * Does NOT delete the files from Drive (user keeps their copy).
	 */
	async clearProjectFileMap(userId: string, projectId: string): Promise<void> {
		await authService.deleteDriveFileMapForProject(userId, projectId);
	}
}

export const googleDriveService = new GoogleDriveService();
