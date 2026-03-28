// TeXlyre sync server — no auth (single-user, local network)
// Run: node server.js   (reads .env automatically)

'use strict';
const { createServer }    = require('http');
const { WebSocketServer } = require('../node_modules/ws');
const chokidar            = require('../node_modules/chokidar');
const { readFile, writeFile, mkdir, unlink, stat, readdir, cp } = require('fs/promises');
const { mkdirSync, readFileSync }                               = require('fs');
const { randomBytes }                                           = require('crypto');
const path = require('path');

// ── Load .env ─────────────────────────────────────────────────────────
try {
  const env = readFileSync(path.join(__dirname, '.env'), 'utf8');
  for (const line of env.split('\n')) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const eq = t.indexOf('=');
    if (eq === -1) continue;
    const k = t.slice(0, eq).trim();
    const v = t.slice(eq + 1).trim().replace(/^["']|["']$/g, '');
    if (!(k in process.env)) process.env[k] = v;
  }
} catch {}

// ── Config ────────────────────────────────────────────────────────────
const LOCAL_ROOT      = process.env.LOCAL_ROOT   || '/var/lib/texlyre';
const FUSE_ROOT       = process.env.FUSE_ROOT    || null;
const PORT            = parseInt(process.env.PORT || '7331');
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || 'http://localhost:5173').split(',').map(s => s.trim());

console.log('TeXlyre sync server');
console.log('  LOCAL_ROOT:', LOCAL_ROOT);
console.log('  FUSE_ROOT: ', FUSE_ROOT || '(not configured)');
console.log('  PORT:      ', PORT);
mkdirSync(LOCAL_ROOT, { recursive: true });


// ── Filesystem helpers ────────────────────────────────────────────────
const sanitize = p => p.split('/').filter(s => s && s !== '.' && s !== '..').join('/');
const ensureDir = dir => mkdir(dir, { recursive: true });

const readJson = async file => {
  try { return JSON.parse(await readFile(file, 'utf8')); }
  catch { return null; }
};
const writeJson = async (file, data) => {
  await ensureDir(path.dirname(file));
  await writeFile(file, JSON.stringify(data, null, 2));
};

const walkDir = async (dir, base) => {
  base = base || dir;
  const results = [];
  try {
    const entries = await readdir(dir, { withFileTypes: true });
    for (const e of entries) {
      const abs = path.join(dir, e.name);
      if (e.isDirectory()) results.push(...await walkDir(abs, base));
      else if (e.isFile()) {
        const s = await stat(abs).catch(() => null);
        if (s) results.push({ rel: path.relative(base, abs).replace(/\\/g, '/'), abs, mtime: s.mtimeMs });
      }
    }
  } catch {}
  return results;
};

// ── Path helpers ──────────────────────────────────────────────────────
const projectsDir = root             => path.join(root, 'projects');
const metaPath    = (root, pid)      => path.join(root, 'projects', pid, 'meta.json');
const filesDir    = (root, pid)      => path.join(root, 'projects', pid, 'files');
const filePath    = (root, pid, rel) => path.join(filesDir(root, pid), sanitize(rel));

// ── WebSocket hub ─────────────────────────────────────────────────────
const connections = new Map();
const broadcast = (projectId, msg, exceptId) => {
  const text = JSON.stringify(msg);
  for (const [id, conn] of connections)
    if (id !== exceptId && conn.subscriptions.has(projectId) && conn.ws.readyState === 1)
      conn.ws.send(text);
};

// ── FUSE → LOCAL watcher ──────────────────────────────────────────────
const mirrorToFuse = (localAbs, relFromRoot) => {
  if (!FUSE_ROOT) return;
  const dst = path.join(FUSE_ROOT, relFromRoot);
  ensureDir(path.dirname(dst)).then(() => cp(localAbs, dst)).catch(() => {});
};

if (FUSE_ROOT) {
  mkdirSync(path.join(FUSE_ROOT, 'projects'), { recursive: true });
  const watchPath = path.join(FUSE_ROOT, 'projects');
  const watcher = chokidar.watch(watchPath, {
    ignoreInitial: true,
    persistent: true,
    awaitWriteFinish: { stabilityThreshold: 1500, pollInterval: 200 },
  });
  const handleFuseChange = async absPath => {
    const rel   = path.relative(FUSE_ROOT, absPath).replace(/\\/g, '/');
    const parts = rel.split('/');
    if (parts[0] !== 'projects' || parts[2] !== 'files' || parts.length < 4) return;
    const projectId = parts[1], fileRel = parts.slice(3).join('/');
    const dst = filePath(LOCAL_ROOT, projectId, fileRel);
    await ensureDir(path.dirname(dst));
    await cp(absPath, dst).catch(() => {});
    const content = await readFile(dst).catch(() => null);
    if (content) broadcast(projectId, { type: 'file_changed', project_id: projectId, path: fileRel, content: content.toString('base64'), by: 'external' });
  };
  watcher.on('add', handleFuseChange).on('change', handleFuseChange);
  watcher.on('unlink', async absPath => {
    const rel = path.relative(FUSE_ROOT, absPath).replace(/\\/g, '/');
    const parts = rel.split('/');
    if (parts[0] !== 'projects' || parts[2] !== 'files' || parts.length < 4) return;
    const projectId = parts[1], fileRel = parts.slice(3).join('/');
    await unlink(filePath(LOCAL_ROOT, projectId, fileRel)).catch(() => {});
    broadcast(projectId, { type: 'file_deleted', project_id: projectId, path: fileRel });
  });
  console.log(`  Watching FUSE: ${watchPath}`);
}

// ── HTTP ──────────────────────────────────────────────────────────────
const parseBody = req => new Promise((resolve, reject) => {
  const chunks = [];
  req.on('data', c => chunks.push(c));
  req.on('end', () => resolve(Buffer.concat(chunks)));
  req.on('error', reject);
});
const send = (res, status, body) => {
  const data = JSON.stringify(body);
  res.writeHead(status, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) });
  res.end(data);
};

const httpServer = createServer(async (req, res) => {
  const origin = req.headers.origin || '';
  if (ALLOWED_ORIGINS.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Access-Control-Allow-Credentials', 'true');
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization');
  }
  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

  const urlObj = new URL(req.url, 'http://localhost');
  const parts  = urlObj.pathname.split('/').filter(Boolean);

  try {
    // ── Projects ──
    if (req.method === 'GET' && urlObj.pathname === '/projects') {
      const ids = await readdir(projectsDir(LOCAL_ROOT)).catch(() => []);
      const metas = (await Promise.all(ids.map(id => readJson(metaPath(LOCAL_ROOT, id))))).filter(Boolean);
      return send(res, 200, metas);
    }
    if (req.method === 'POST' && urlObj.pathname === '/projects') {
      const { title, type = 'typst', tags = [] } = JSON.parse(await parseBody(req));
      const id = randomBytes(16).toString('hex'), now = Date.now();
      const meta = { id, title, type, tags, created_at: now, updated_at: now };
      await writeJson(metaPath(LOCAL_ROOT, id), meta);
      mirrorToFuse(metaPath(LOCAL_ROOT, id), `projects/${id}/meta.json`);
      return send(res, 200, meta);
    }
    if (req.method === 'GET' && parts.length === 2 && parts[0] === 'projects') {
      const meta = await readJson(metaPath(LOCAL_ROOT, parts[1]));
      return meta ? send(res, 200, meta) : send(res, 404, { error: 'not_found' });
    }
    if (req.method === 'PUT' && parts.length === 2 && parts[0] === 'projects') {
      const meta = await readJson(metaPath(LOCAL_ROOT, parts[1]));
      if (!meta) return send(res, 404, { error: 'not_found' });
      const patch = JSON.parse(await parseBody(req));
      if (patch.title) meta.title = patch.title;
      if (patch.tags)  meta.tags  = patch.tags;
      meta.updated_at = Date.now();
      await writeJson(metaPath(LOCAL_ROOT, parts[1]), meta);
      return send(res, 200, meta);
    }
    if (req.method === 'DELETE' && parts.length === 2 && parts[0] === 'projects') {
      await unlink(metaPath(LOCAL_ROOT, parts[1])).catch(() => {});
      return send(res, 200, { ok: true });
    }

    // ── Files ──
    if (req.method === 'GET' && parts[0] === 'projects' && parts[2] === 'files' && parts.length === 3) {
      const files = await walkDir(filesDir(LOCAL_ROOT, parts[1]));
      return send(res, 200, files.map(f => ({ path: f.rel, modified: f.mtime / 1000, size: 0 })));
    }
    if (req.method === 'GET' && parts[0] === 'projects' && parts[2] === 'file') {
      const rel = parts.slice(3).join('/');
      const data = await readFile(filePath(LOCAL_ROOT, parts[1], rel)).catch(() => null);
      if (!data) return send(res, 404, { error: 'not_found' });
      res.writeHead(200, { 'Content-Type': 'application/octet-stream', 'Content-Length': data.length });
      res.end(data);
      return;
    }
    if (req.method === 'PUT' && parts[0] === 'projects' && parts[2] === 'file') {
      const rel = parts.slice(3).join('/');
      const abs = filePath(LOCAL_ROOT, parts[1], rel);
      await ensureDir(path.dirname(abs));
      await writeFile(abs, await parseBody(req));
      mirrorToFuse(abs, `projects/${parts[1]}/files/${sanitize(rel)}`);
      const s = await stat(abs);
      return send(res, 200, { modified: s.mtimeMs / 1000 });
    }
    if (req.method === 'DELETE' && parts[0] === 'projects' && parts[2] === 'file') {
      const rel = parts.slice(3).join('/');
      await unlink(filePath(LOCAL_ROOT, parts[1], rel)).catch(() => {});
      if (FUSE_ROOT) unlink(path.join(FUSE_ROOT, 'projects', parts[1], 'files', sanitize(rel))).catch(() => {});
      return send(res, 200, { ok: true });
    }

    send(res, 404, { error: 'not_found' });
  } catch (e) {
    console.error(e);
    send(res, 500, { error: 'internal_error' });
  }
});

// ── WebSocket ─────────────────────────────────────────────────────────
const wss = new WebSocketServer({ server: httpServer });

wss.on('connection', (ws) => {
  const connId = randomBytes(8).toString('hex');
  connections.set(connId, { ws, subscriptions: new Set() });

  ws.on('message', async raw => {
    let msg; try { msg = JSON.parse(raw.toString()); } catch { return; }
    const conn = connections.get(connId); if (!conn) return;

    if (msg.type === 'ping')        { ws.send(JSON.stringify({ type: 'pong' })); return; }
    if (msg.type === 'unsubscribe') { conn.subscriptions.delete(msg.project_id); return; }
    if (msg.type === 'subscribe') {
      conn.subscriptions.add(msg.project_id);
      const files = await walkDir(filesDir(LOCAL_ROOT, msg.project_id));
      ws.send(JSON.stringify({ type: 'subscribed', project_id: msg.project_id, files: files.map(f => ({ path: f.rel, modified: f.mtime / 1000, size: 0 })) }));
      return;
    }
    if (msg.type === 'file_write') {
      const abs = filePath(LOCAL_ROOT, msg.project_id, msg.path);
      await ensureDir(path.dirname(abs));
      await writeFile(abs, Buffer.from(msg.content, 'base64'));
      mirrorToFuse(abs, `projects/${msg.project_id}/files/${sanitize(msg.path)}`);
      broadcast(msg.project_id, { type: 'file_changed', project_id: msg.project_id, path: msg.path, content: msg.content, by: connId }, connId);
      return;
    }
    if (msg.type === 'file_delete') {
      await unlink(filePath(LOCAL_ROOT, msg.project_id, msg.path)).catch(() => {});
      if (FUSE_ROOT) unlink(path.join(FUSE_ROOT, 'projects', msg.project_id, 'files', sanitize(msg.path))).catch(() => {});
      broadcast(msg.project_id, { type: 'file_deleted', project_id: msg.project_id, path: msg.path }, connId);
      return;
    }
  });
  ws.on('close', () => connections.delete(connId));
});

httpServer.listen(PORT, () => console.log(`Listening on http://0.0.0.0:${PORT}`));
