// src/services/SyncServerService.ts
// REST client for the TeXlyre sync server.

import type { SyncFileMeta, SyncProjectMeta, SyncUser } from '../types/sync';

class SyncServerService {
  private baseUrl = '';
  private token: string | null = null;

  configure(url: string) {
    this.baseUrl = url.replace(/\/$/, '');
  }

  /** Called by useSyncServer with an auto-generated HMAC token. */
  setToken(token: string) {
    this.token = token;
  }

  clearToken() {
    this.token = null;
  }

  /** @deprecated kept for legacy callers; token is now injected via setToken() */
  loadToken() {}

  hasToken(): boolean {
    return !!this.token;
  }

  getToken(): string | null {
    return this.token;
  }

  /** Derive ws:// URL from the configured http:// base URL. */
  wsUrl(): string {
    return this.baseUrl.replace(/^http/, 'ws') + '/ws';
  }

  private async fetch<T>(
    path: string,
    options: RequestInit = {},
  ): Promise<T> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...(options.headers as Record<string, string>),
    };
    if (this.token) {
      headers['Authorization'] = `Bearer ${this.token}`;
    }

    const resp = await fetch(this.baseUrl + path, { ...options, headers });

    if (!resp.ok) {
      let message = resp.statusText;
      try {
        const body = await resp.json();
        message = body.error ?? message;
      } catch {}
      throw new Error(message);
    }

    const ct = resp.headers.get('Content-Type') ?? '';
    if (ct.includes('application/json')) {
      return resp.json() as Promise<T>;
    }
    return resp.text() as unknown as T;
  }

  private async fetchBytes(path: string): Promise<Uint8Array> {
    const headers: Record<string, string> = {};
    if (this.token) headers['Authorization'] = `Bearer ${this.token}`;

    const resp = await fetch(this.baseUrl + path, { headers });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    return new Uint8Array(await resp.arrayBuffer());
  }

  private async putBytes(path: string, data: Uint8Array): Promise<{ modified: number }> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/octet-stream',
    };
    if (this.token) headers['Authorization'] = `Bearer ${this.token}`;

    const resp = await fetch(this.baseUrl + path, {
      method: 'PUT',
      headers,
      body: data.buffer as ArrayBuffer,
    });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    return resp.json();
  }

  // ── Auth ────────────────────────────────────────────────────────────

  async getMe(): Promise<SyncUser> {
    return this.fetch<SyncUser>('/auth/me');
  }

  // ── Projects ────────────────────────────────────────────────────────

  async listProjects(): Promise<SyncProjectMeta[]> {
    return this.fetch<SyncProjectMeta[]>('/projects');
  }

  async createProject(meta: { title: string; type: string; tags?: string[] }): Promise<SyncProjectMeta> {
    return this.fetch<SyncProjectMeta>('/projects', {
      method: 'POST',
      body: JSON.stringify(meta),
    });
  }

  async getProject(id: string): Promise<SyncProjectMeta> {
    return this.fetch<SyncProjectMeta>(`/projects/${id}`);
  }

  async updateProject(id: string, patch: Partial<Pick<SyncProjectMeta, 'title' | 'tags'>>): Promise<SyncProjectMeta> {
    return this.fetch<SyncProjectMeta>(`/projects/${id}`, {
      method: 'PUT',
      body: JSON.stringify(patch),
    });
  }

  async deleteProject(id: string): Promise<void> {
    await this.fetch(`/projects/${id}`, { method: 'DELETE' });
  }

  // ── Files ───────────────────────────────────────────────────────────

  async listFiles(projectId: string): Promise<SyncFileMeta[]> {
    return this.fetch<SyncFileMeta[]>(`/projects/${projectId}/files`);
  }

  async getFile(projectId: string, path: string): Promise<Uint8Array> {
    return this.fetchBytes(`/projects/${projectId}/file/${path}`);
  }

  async putFile(projectId: string, path: string, content: Uint8Array): Promise<void> {
    await this.putBytes(`/projects/${projectId}/file/${path}`, content);
  }

  async putTextFile(projectId: string, path: string, content: string): Promise<void> {
    const enc = new TextEncoder();
    await this.putFile(projectId, path, enc.encode(content));
  }

  async deleteFile(projectId: string, path: string): Promise<void> {
    await this.fetch(`/projects/${projectId}/file/${path}`, { method: 'DELETE' });
  }

  /** Push all files from a map of path→content to the server.
   *  Used for initial "Upload project" action. */
  async uploadProjectFiles(
    projectId: string,
    files: { path: string; content: string | ArrayBuffer }[],
    onProgress?: (done: number, total: number) => void,
  ): Promise<void> {
    const enc = new TextEncoder();
    let done = 0;
    for (const f of files) {
      const bytes =
        typeof f.content === 'string'
          ? enc.encode(f.content)
          : new Uint8Array(f.content);
      await this.putFile(projectId, f.path, bytes);
      done++;
      onProgress?.(done, files.length);
    }
  }
}

export const syncServerService = new SyncServerService();
