// src/hooks/useServerSync.ts
// Drives server sync when running against the Vite sync-server plugin.
// - Pushes every saved file to server via texlyre:file-stored event
// - Pushes account + projects when user state changes
// - Exposes syncProjectFiles() for callers to trigger a per-project LWW pull

import { useCallback, useEffect } from 'react';
import { authService } from '../services/AuthService';
import { fileStorageService } from '../services/FileStorageService';
import { serverSyncService } from '../services/ServerSyncService';
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
      if (file.excludeFromSync) return;
      await serverSyncService.putFile(projectId, path, file.content as string | ArrayBuffer);
    };

    window.addEventListener('texlyre:file-stored', handler);
    return () => window.removeEventListener('texlyre:file-stored', handler);
  }, [isServerMode]);

  // ── LWW pull for a specific project ───────────────────────────────────
  const syncProjectFiles = useCallback(async (projectId: string) => {
    if (!isServerMode) {
      console.log('[ServerSync] skipped — not in server mode');
      return;
    }

    console.log('[ServerSync] ── starting sync for project:', projectId);

    const [serverFiles, localFiles] = await Promise.all([
      serverSyncService.listFiles(projectId),
      fileStorageService.getAllFiles(false),
    ]);

    // Normalize: server paths have no leading slash, local paths always have one.
    const normalize = (p: string) => p.replace(/^\/+/, '');
    const toLocalPath = (serverPath: string) => `/${serverPath}`;

    console.log(`[ServerSync] server files (${serverFiles.length}):`);
    for (const sf of serverFiles) {
      console.log(`  server: ${sf.path}  (modified ${new Date(sf.modified).toISOString()})`);
    }
    console.log(`[ServerSync] local files (${localFiles.length}):`);
    for (const lf of localFiles) {
      if (lf.type === 'file' && !lf.isDeleted) {
        console.log(`  local:  ${lf.path}  (modified ${new Date(lf.lastModified).toISOString()})`);
      }
    }

    // Map local files by normalized path (no leading slash) for lookup.
    const localMap = new Map(localFiles.map((f) => [normalize(f.path), f]));

    // Track IDs deleted during flat-path cleanup so we don't re-push them.
    const deletedLocalIds = new Set<string>();

    // ── Phase 1: pull from server ──────────────────────────────────────────
    console.log('[ServerSync] ── phase 1: server → local');
    for (const sf of serverFiles) {
      const normalizedSfPath = normalize(sf.path);
      const local = localMap.get(normalizedSfPath);
      const serverMs = sf.modified;

      if (local && local.lastModified >= serverMs - 1000) {
        if (local.lastModified > serverMs + 1000) {
          // Local is newer — push back (handled in phase 2 via server path check)
          console.log(`  PUSH-BACK  ${sf.path}  (local newer by ${local.lastModified - serverMs}ms)`);
        } else {
          console.log(`  UP-TO-DATE ${sf.path}`);
        }
        continue;
      }

      // Server is newer (or file missing locally) — pull.
      if (!local) {
        // If the server file lives in a subdir (e.g. images/foo.png) but local
        // only has a flat copy (foo.png at root), delete the flat copy first.
        const sfBasename = sf.path.split('/').pop() ?? sf.path;
        if (sf.path.includes('/')) {
          const flatLocal = localMap.get(sfBasename);
          if (flatLocal) {
            console.log(`  DEL-FLAT   ${flatLocal.path}  → will be replaced by ${sf.path}`);
            await fileStorageService.deleteFile(flatLocal.id, {
              hardDelete: true,
              showDeleteDialog: false,
              allowLinkedFileDelete: true,
            });
            deletedLocalIds.add(flatLocal.id);
          }
        }
      }

      const buf = await serverSyncService.getFile(projectId, sf.path);
      if (!buf) {
        console.log(`  FETCH-FAIL ${sf.path}`);
        continue;
      }

      const isBin = isBinaryPath(sf.path);
      const content: string | ArrayBuffer = isBin ? buf : new TextDecoder().decode(buf);

      if (local) {
        console.log(`  UPDATE     ${sf.path}  (server newer by ${serverMs - local.lastModified}ms)`);
        await fileStorageService.updateFileContent(local.id, content, {
          showConflictDialog: false,
          preserveTimestamp: true,
        });
      } else {
        const localPath = toLocalPath(sf.path);
        const name = sf.path.split('/').pop() ?? sf.path;
        console.log(`  PULL-NEW   ${sf.path}  → stored at ${localPath}`);
        // Ensure parent directory entries exist in IDB so buildFileTree nests correctly.
        await fileStorageService.createDirectoryPath(localPath);
        await fileStorageService.storeFile(
          {
            id: `srv-${Date.now()}-${Math.random().toString(36).slice(2)}`,
            name,
            path: localPath,
            type: 'file',
            content,
            lastModified: serverMs,
            isBinary: isBin,
          } as FileNode,
          { showConflictDialog: false, preserveTimestamp: true },
        );
      }
    }

    // ── Phase 2: push local-only files to server ───────────────────────────
    console.log('[ServerSync] ── phase 2: local → server');
    const serverNormalizedPaths = new Set(serverFiles.map((f) => normalize(f.path)));
    const serverBasenamesInSubdirs = new Set(
      serverFiles
        .filter((f) => f.path.includes('/'))
        .map((f) => f.path.split('/').pop() ?? f.path),
    );
    for (const local of localFiles) {
      if (local.type !== 'file' || local.isDeleted) continue;
      if (deletedLocalIds.has(local.id)) continue;
      if (local.content === undefined) continue;
      const localNorm = normalize(local.path);
      if (serverNormalizedPaths.has(localNorm)) {
        // Already handled: push-back case from phase 1
        if (local.lastModified > (serverFiles.find(f => normalize(f.path) === localNorm)?.modified ?? 0) + 1000) {
          console.log(`  PUSH       ${local.path}  (local newer)`);
          const content = typeof local.content === 'string' ? local.content : (local.content as ArrayBuffer);
          await serverSyncService.putFile(projectId, localNorm, content);
        }
        continue;
      }
      // Don't push a flat-root file if the server already has it under a subdir.
      const localBasename = localNorm.split('/').pop() ?? localNorm;
      if (!localNorm.includes('/') && serverBasenamesInSubdirs.has(localBasename)) {
        console.log(`  SKIP-FLAT  ${local.path}  (server has it at a subdir path)`);
        continue;
      }
      console.log(`  PUSH-NEW   ${local.path}  (not on server)`);
      const content = typeof local.content === 'string' ? local.content : (local.content as ArrayBuffer);
      await serverSyncService.putFile(projectId, local.path, content);
    }

    console.log('[ServerSync] ── sync complete');
  }, [isServerMode]);

  return { syncProjectFiles, pushAccount };
}
