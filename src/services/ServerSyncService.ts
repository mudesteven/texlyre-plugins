// src/services/ServerSyncService.ts
// REST client for the /api/* routes exposed by the sync-server Vite plugin.
// All paths are relative — same origin, no CORS.

import type { Project } from '../types/projects';
import type { User } from '../types/auth';

export interface ServerFileMeta {
  path: string;
  modified: number; // ms since epoch
  size: number;
}

class ServerSyncService {
  async ping(): Promise<boolean> {
    try {
      const r = await fetch('/api/ping');
      return r.ok;
    } catch {
      return false;
    }
  }

  // ── Account ──────────────────────────────────────────────────────────────

  async getAccount(): Promise<User | null> {
    try {
      const r = await fetch('/api/account');
      if (!r.ok) return null;
      return r.json() as Promise<User>;
    } catch {
      return null;
    }
  }

  async putAccount(user: User): Promise<void> {
    await fetch('/api/account', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(user),
    });
  }

  // ── Projects ─────────────────────────────────────────────────────────────

  async getProjects(): Promise<Project[]> {
    try {
      const r = await fetch('/api/projects');
      if (!r.ok) return [];
      return r.json() as Promise<Project[]>;
    } catch {
      return [];
    }
  }

  async putProjects(projects: Project[]): Promise<void> {
    await fetch('/api/projects', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(projects),
    });
  }

  // ── Files ─────────────────────────────────────────────────────────────────

  async listFiles(projectId: string): Promise<ServerFileMeta[]> {
    try {
      const r = await fetch(`/api/files/${projectId}`);
      if (!r.ok) return [];
      return r.json() as Promise<ServerFileMeta[]>;
    } catch {
      return [];
    }
  }

  async getFile(projectId: string, filePath: string): Promise<ArrayBuffer | null> {
    try {
      const p = filePath.replace(/^\/+/, '');
      const r = await fetch(`/api/files/${projectId}/${p}`);
      if (!r.ok) return null;
      return r.arrayBuffer();
    } catch {
      return null;
    }
  }

  async putFile(projectId: string, filePath: string, content: string | ArrayBuffer): Promise<{ modified: number } | null> {
    try {
      const p = filePath.replace(/^\/+/, '');
      const body = typeof content === 'string' ? new TextEncoder().encode(content) : content;
      const r = await fetch(`/api/files/${projectId}/${p}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/octet-stream' },
        body,
      });
      if (!r.ok) return null;
      return r.json() as Promise<{ modified: number }>;
    } catch {
      return null;
    }
  }

  async deleteFile(projectId: string, filePath: string): Promise<void> {
    const p = filePath.replace(/^\/+/, '');
    await fetch(`/api/files/${projectId}/${p}`, { method: 'DELETE' }).catch(() => {});
  }
}

export const serverSyncService = new ServerSyncService();
