// plugins/sync-server.ts
// Vite plugin that exposes the server filesystem over /api/* routes.
// Set SYNC_ROOT in .env to the folder you want to sync to (e.g. FUSE mount path).
// No extra dependencies — pure Node.js builtins only.

import type { Plugin } from 'vite';
import { mkdir, readFile, readdir, stat, unlink, writeFile } from 'node:fs/promises';
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { IncomingMessage, ServerResponse } from 'node:http';

// Read lazily so vite.config.ts has time to load .env first
const getSyncRoot = () => process.env.SYNC_ROOT ?? null;

// ── Helpers ──────────────────────────────────────────────────────────────────

function parseBody(req: IncomingMessage): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

function json(res: ServerResponse, status: number, body: unknown) {
  const data = JSON.stringify(body);
  res.writeHead(status, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) });
  res.end(data);
}

/** Strip path traversal and collapse slashes. */
const sanitize = (p: string) =>
  p.split('/').filter((s) => s && s !== '.' && s !== '..').join('/');

async function ensureDir(dir: string) {
  await mkdir(dir, { recursive: true });
}

interface FileMeta { path: string; modified: number; size: number }

async function walkDir(dir: string): Promise<FileMeta[]> {
  const results: FileMeta[] = [];
  async function walk(cur: string, rel: string) {
    let entries;
    try { entries = await readdir(cur, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      const eRel = rel ? `${rel}/${e.name}` : e.name;
      const eAbs = join(cur, e.name);
      if (e.isDirectory()) {
        await walk(eAbs, eRel);
      } else {
        const s = await stat(eAbs);
        results.push({ path: eRel, modified: s.mtimeMs, size: s.size });
      }
    }
  }
  await walk(dir, '');
  return results;
}

// ── Request handler ───────────────────────────────────────────────────────────

async function handle(req: IncomingMessage, res: ServerResponse): Promise<boolean> {
  if (!req.url?.startsWith('/api/')) return false;

  const SYNC_ROOT = getSyncRoot();
  if (!SYNC_ROOT) {
    json(res, 503, { error: 'SYNC_ROOT not configured in .env' });
    return true;
  }

  const url  = new URL(req.url, 'http://localhost');
  const path = url.pathname;
  const method = req.method ?? 'GET';

  // ── ping ────────────────────────────────────────────────────────────────
  if (path === '/api/ping') {
    json(res, 200, { ok: true });
    return true;
  }

  // ── account ─────────────────────────────────────────────────────────────
  if (path === '/api/account') {
    if (method === 'GET') {
      try {
        const data = await readFile(join(SYNC_ROOT, 'account.json'), 'utf8');
        json(res, 200, JSON.parse(data));
      } catch {
        json(res, 404, { error: 'not_found' });
      }
      return true;
    }
    if (method === 'PUT') {
      await ensureDir(SYNC_ROOT);
      await writeFile(join(SYNC_ROOT, 'account.json'), await parseBody(req));
      json(res, 200, { ok: true });
      return true;
    }
  }

  // ── projects ────────────────────────────────────────────────────────────
  if (path === '/api/projects') {
    if (method === 'GET') {
      try {
        const data = await readFile(join(SYNC_ROOT, 'projects.json'), 'utf8');
        json(res, 200, JSON.parse(data));
      } catch {
        json(res, 200, []);
      }
      return true;
    }
    if (method === 'PUT') {
      await ensureDir(SYNC_ROOT);
      await writeFile(join(SYNC_ROOT, 'projects.json'), await parseBody(req));
      json(res, 200, { ok: true });
      return true;
    }
  }

  // ── files ───────────────────────────────────────────────────────────────
  // /api/files/:projectId          → list
  // /api/files/:projectId/some/path → CRUD
  const filesMatch = path.match(/^\/api\/files\/([^/]+)(\/(.+))?$/);
  if (filesMatch) {
    const projectId  = sanitize(filesMatch[1]);
    const relPath    = filesMatch[3] ? sanitize(filesMatch[3]) : null;
    const projectDir = join(SYNC_ROOT, 'files', projectId);

    if (!relPath) {
      // List files in project
      const files = await walkDir(projectDir);
      json(res, 200, files);
      return true;
    }

    const abs = join(projectDir, relPath);

    if (method === 'GET') {
      try {
        const data = await readFile(abs);
        res.writeHead(200, { 'Content-Type': 'application/octet-stream', 'Content-Length': data.length });
        res.end(data);
      } catch {
        json(res, 404, { error: 'not_found' });
      }
      return true;
    }

    if (method === 'PUT') {
      await ensureDir(dirname(abs));
      await writeFile(abs, await parseBody(req));
      const s = await stat(abs);
      json(res, 200, { modified: s.mtimeMs });
      return true;
    }

    if (method === 'DELETE') {
      await unlink(abs).catch(() => {});
      json(res, 200, { ok: true });
      return true;
    }
  }

  return false;
}

// ── Plugin export ─────────────────────────────────────────────────────────────

export function syncServerPlugin(): Plugin {
  const SYNC_ROOT = getSyncRoot();
  if (!SYNC_ROOT) {
    console.warn('[sync-server] SYNC_ROOT not set — server sync disabled. Add SYNC_ROOT=/your/path to .env');
    return { name: 'texlyre-sync-server' };
  }

  mkdirSync(SYNC_ROOT, { recursive: true });
  console.log(`[sync-server] active — SYNC_ROOT: ${SYNC_ROOT}`);

  return {
    name: 'texlyre-sync-server',
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        try {
          const handled = await handle(req, res);
          if (!handled) next();
        } catch (e) {
          console.error('[sync-server]', e);
          json(res, 500, { error: 'internal_error' });
        }
      });
    },
  };
}
