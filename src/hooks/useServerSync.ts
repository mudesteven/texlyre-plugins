// src/hooks/useServerSync.ts
// Drives server sync when running against the Vite sync-server plugin.
// - Pushes every saved file to server via texlyre:file-stored event
// - Pushes account + projects when user state changes
// - Exposes syncProjectFiles() for callers to trigger a per-project LWW pull

import { useCallback, useEffect } from 'react';
import { authService } from '../services/AuthService';
import { fileStorageService } from '../services/FileStorageService';
import { serverSyncService } from '../services/ServerSyncService';
import type { User } from '../types/auth';
import type { FileNode } from '../types/files';

interface FileStoredDetail { fileId: string; path: string; projectId: string }

function isBinaryPath(p: string) {
  return /\.(pdf|png|jpg|jpeg|gif|svg|zip|woff2?)$/i.test(p);
}

export function useServerSync(isServerMode: boolean) {

  // ── Push account + projects whenever the user changes ──────────────────
  const pushAccount = useCallback(async () => {
    if (!isServerMode) return;
    const user = authService.getCurrentUser();
    if (!user) return;
    const projects = await authService.getProjects();
    await serverSyncService.putAccount(user);
    await serverSyncService.putProjects(projects);
  }, [isServerMode]);

  useEffect(() => {
    if (!isServerMode) return;
    pushAccount();
  }, [isServerMode, pushAccount]);

  // ── Push file to server on every local save ────────────────────────────
  useEffect(() => {
    if (!isServerMode) return;

    const handler = async (e: Event) => {
      const { fileId, path, projectId } = (e as CustomEvent<FileStoredDetail>).detail;
      if (!projectId || !path) return;
      const file = await fileStorageService.getFile(fileId);
      if (!file || file.type !== 'file' || file.content === undefined) return;
      await serverSyncService.putFile(projectId, path, file.content as string | ArrayBuffer);
    };

    window.addEventListener('texlyre:file-stored', handler);
    return () => window.removeEventListener('texlyre:file-stored', handler);
  }, [isServerMode]);

  // ── LWW pull for a specific project ───────────────────────────────────
  const syncProjectFiles = useCallback(async (projectId: string) => {
    if (!isServerMode) return;

    const [serverFiles, localFiles] = await Promise.all([
      serverSyncService.listFiles(projectId),
      fileStorageService.getAllFiles(false),
    ]);

    const localMap = new Map(localFiles.map((f) => [f.path, f]));
    const enc = new TextEncoder();

    for (const sf of serverFiles) {
      const local = localMap.get(sf.path);
      const serverMs = sf.modified;

      if (!local || local.lastModified < serverMs - 1000) {
        // Server is newer — pull
        const buf = await serverSyncService.getFile(projectId, sf.path);
        if (!buf) continue;

        const isBin = isBinaryPath(sf.path);
        const content: string | ArrayBuffer = isBin ? buf : new TextDecoder().decode(buf);

        if (local) {
          await fileStorageService.updateFileContent(local.id, content, {
            showConflictDialog: false,
            preserveTimestamp: true,
          });
        } else {
          const name = sf.path.split('/').pop() ?? sf.path;
          await fileStorageService.storeFile(
            {
              id: `srv-${Date.now()}-${Math.random().toString(36).slice(2)}`,
              name,
              path: sf.path,
              type: 'file',
              content,
              lastModified: serverMs,
              isBinary: isBin,
            } as FileNode,
            { showConflictDialog: false, preserveTimestamp: true },
          );
        }
      } else if (local.lastModified > serverMs + 1000) {
        // Local is newer — push
        const content = typeof local.content === 'string'
          ? local.content
          : (local.content as ArrayBuffer);
        await serverSyncService.putFile(projectId, sf.path, content);
      }
    }

    // Push any local files the server doesn't have yet
    const serverPaths = new Set(serverFiles.map((f) => f.path));
    for (const local of localFiles) {
      if (local.type !== 'file' || local.isDeleted || serverPaths.has(local.path)) continue;
      if (local.content === undefined) continue;
      const content = typeof local.content === 'string'
        ? local.content
        : (local.content as ArrayBuffer);
      await serverSyncService.putFile(projectId, local.path, content);
    }
  }, [isServerMode]);

  return { syncProjectFiles, pushAccount };
}
