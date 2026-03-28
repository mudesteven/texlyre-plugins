# TeXlyre Sync Server Plan

## Overview

A self-hostable OCaml HTTP/WebSocket server that stores all user data and project files on a
Google-Drive-FUSE-mounted directory. Gives users:
- Same email+password login from any device (no re-import)
- Real-time two-way file sync across tabs/devices
- Full offline fallback (IndexedDB as local cache)
- Toggle on/off in Settings

The server itself is dumb: it just reads/writes to a filesystem path that happens to be backed
by `google-drive-ocamlfuse`. No Google SDK, no OAuth in the server — the admin mounts the drive
once and the server runs forever.

---

## Architecture

```
Browser A ──WS──┐                    ┌── /mnt/gdrive/texlyre/
Browser B ──WS──┤── OCaml server ────┤     users/{id}/profile.json
Browser C ──WS──┘    (Dream)         └── projects/{id}/files/...
                     HTTP REST
```

### Directory layout on FUSE mount

```
{storage_root}/
  users/
    {userId}/
      profile.json          ← email, password hash (bcrypt), name, color, avatar
      sessions.json         ← active session tokens
  projects/
    {projectId}/
      meta.json             ← title, owner, type (latex/typst), tags, created/updated
      files/
        main.typ            ← raw source files
        chapters/intro.typ
        output/main.pdf     ← compiled PDFs
```

---

## Backend: OCaml (Dream)

### New repo: `texlyre-sync-server/`

**Stack:**
- `dream` — HTTP + WebSocket server
- `yojson` — JSON
- `bcrypt` — password hashing
- `uuidm` — UUID generation
- `inotify` (Linux) / `fsevents` (macOS) — watch for external filesystem changes (Drive sync)
- `cohttp-lwt` for any outbound requests if needed

**`bin/main.ml`** — entry point, reads config from env vars:
```
STORAGE_ROOT=/mnt/gdrive/texlyre
PORT=7331
JWT_SECRET=<random>
ALLOWED_ORIGINS=http://localhost:5173,https://yourdomain.com
```

### REST API

```
POST /auth/register          body: {email, password, name}  → {token, user}
POST /auth/login             body: {email, password}         → {token, user}
POST /auth/logout            header: Bearer token            → 200
GET  /auth/me                                                 → {user}
PUT  /auth/profile           body: {name?, color?, avatar?}  → {user}
PUT  /auth/password          body: {currentPassword, newPassword} → 200

GET  /projects               → [{meta}]
POST /projects               body: {title, type, tags?}      → {meta}
GET  /projects/:id           → {meta}
PUT  /projects/:id           body: {title?, tags?}           → {meta}
DELETE /projects/:id                                          → 200

GET  /projects/:id/files     → [{path, size, modified}]
GET  /projects/:id/files/*path  → file content (raw bytes)
PUT  /projects/:id/files/*path  body: raw bytes → {modified}
DELETE /projects/:id/files/*path → 200
POST /projects/:id/import    body: multipart files           → 200
GET  /projects/:id/export    → zip
```

### WebSocket: `GET /ws?token=<jwt>`

One persistent connection per browser tab. Messages are JSON.

**Client → Server:**
```json
{ "type": "subscribe",    "projectId": "xxx" }
{ "type": "unsubscribe",  "projectId": "xxx" }
{ "type": "file_write",   "projectId": "xxx", "path": "main.typ", "content": "<base64>" }
{ "type": "file_delete",  "projectId": "xxx", "path": "main.typ" }
{ "type": "ping" }
```

**Server → Client:**
```json
{ "type": "file_changed", "projectId": "xxx", "path": "main.typ", "content": "<base64>", "by": "userId or external" }
{ "type": "file_deleted", "projectId": "xxx", "path": "main.typ" }
{ "type": "project_meta", "projectId": "xxx", "meta": {...} }
{ "type": "pong" }
{ "type": "error",        "message": "..." }
```

**Server-side inotify loop:**
- Watch `{storage_root}/projects/` recursively
- On `IN_CLOSE_WRITE` / `IN_DELETE`: determine `projectId` + `path` from the changed filesystem path
- Broadcast to all subscribers of that `projectId` **except** the connection that just wrote it
  (use a per-write `changeId` echoed back so the sender can suppress the echo)

---

## Frontend Changes

### New files

**`src/services/SyncServerService.ts`**
- `configure(url)` — set server base URL
- `login(email, password)` → stores JWT in IndexedDB/localStorage
- `register(email, password, name)` → same
- `logout()`
- `getMe()` → `User`
- `updateProfile(patch)` → `User`
- `listProjects()` → `Project[]`
- `createProject(...)` → `Project`
- `deleteProject(id)`
- `getFile(projectId, path)` → `Uint8Array`
- `putFile(projectId, path, content: Uint8Array)`
- `deleteFile(projectId, path)`
- `connect()` → opens WebSocket, returns `SyncConnection`

**`src/services/SyncConnection.ts`**
- Wraps a single WebSocket
- `subscribe(projectId)` / `unsubscribe(projectId)`
- `sendFileWrite(projectId, path, content)`
- `sendFileDelete(projectId, path)`
- `on('file_changed', handler)` / `on('file_deleted', handler)`
- Auto-reconnect with exponential back-off (1s, 2s, 4s … 30s)
- Heartbeat ping every 30s

**`src/hooks/useSyncServer.ts`**
- Reads `sync-server-url` and `sync-server-enabled` settings
- Connects when enabled + user logged in
- Subscribes to active project on project open
- On `file_changed` from server: calls `fileStorageService.updateFileContent()` locally (skip if same content hash)
- Listens to `texlyre:file-saved` DOM event → `syncConnection.sendFileWrite()`
- Exports: `syncStatus: 'disabled' | 'connecting' | 'connected' | 'error'`

**`src/components/common/SyncStatusIndicator.tsx`**
- Small icon in header (cloud + dot, similar to BackupStatusIndicator)
- Green = connected, amber = connecting/error, grey = disabled

### Modified files

**`src/contexts/AuthContext.tsx`**
- Add `syncServerLogin(email, password)` and `syncServerRegister(...)` to allow cross-device login
- On `login()`: if sync enabled, attempt `syncServerService.login()` in background; on success, merge server profile over local
- On `logout()`: call `syncServerService.logout()`
- Add `syncServerStatus: 'disconnected' | 'connected' | 'error'` to context

**`src/contexts/EditorContext.tsx`**
- Call `useSyncServer()` hook

**`src/contexts/SettingsContext.tsx`** (via `registerSetting`)
- `sync-server-enabled` (boolean, default: false)
- `sync-server-url` (string, default: `http://localhost:7331`)

**`src/components/settings/SyncServerSettings.tsx`** (new panel)
- Toggle enable/disable
- URL input
- Login/register form (separate from local auth — links to existing local account)
- Connection status + last sync time
- "Sync now" button (push all local files → server)
- "Pull from server" button (server → local, for initial setup on new device)

**`src/components/app/EditorApp.tsx`**
- Add `<SyncStatusIndicator />`

**`src/components/app/ProjectApp.tsx`**
- Same

---

## Two-Way Sync Details

### Conflict resolution strategy (simple, LWW)
- **Last Write Wins** by `modified` timestamp
- Server is authoritative for external changes (Drive synced from another machine)
- Client is authoritative for local edits (they just typed it)
- On `file_changed` from server: compare server `modified` vs local `modified`; skip if local is newer (user is actively editing)

### Initial sync on connect
1. Client sends `subscribe` for active project
2. Server responds with full file listing `{ path, modified, size }[]`
3. Client diffs against local IndexedDB timestamps
4. Client pulls files newer on server; pushes files newer locally
5. Conflicts (same path, within 1s of each other): server wins (simpler UX, avoids dialog spam)

### Import existing local project to server
- "Upload to sync server" action in project kebab menu
- Iterates all files via `fileStorageService`, calls `syncServerService.putFile()` for each
- Sets `project.syncServerId` in local IndexedDB

---

## Phases

### Phase 1 — OCaml server scaffold (new repo)
- [ ] Dream HTTP server with JWT middleware
- [ ] File-based user store (bcrypt passwords)
- [ ] `/auth/*` endpoints
- [ ] `/projects/*` REST endpoints (no WebSocket yet)
- [ ] Dockerfile + docker-compose with volume mount

### Phase 2 — WebSocket + inotify
- [ ] `/ws` endpoint, connection registry, subscribe/broadcast
- [ ] inotify watcher → broadcast on external file change
- [ ] Integration test: two clients, one writes, other receives

### Phase 3 — Frontend `SyncServerService` + `SyncConnection`
- [ ] REST methods
- [ ] WebSocket wrapper with auto-reconnect
- [ ] Unit tests with mock server

### Phase 4 — `useSyncServer` hook + settings
- [ ] Register settings
- [ ] Hook wires DOM events → WS send
- [ ] Hook handles incoming WS messages → IndexedDB update
- [ ] Initial sync diff on subscribe

### Phase 5 — UI
- [ ] `SyncStatusIndicator`
- [ ] `SyncServerSettings` panel
- [ ] "Upload project" / "Pull from server" actions
- [ ] Profile sync on login

### Phase 6 — Cross-device account login
- [ ] On login: if sync server enabled + server has matching email → pull profile
- [ ] `upgradeGuestAccount` flow respects sync server profile
- [ ] Settings panel login form

### Phase 7 — QA
- [ ] Two browser windows on same machine: edit in A, see in B
- [ ] Stop/restart server: reconnect, re-sync
- [ ] Disconnect internet (Drive unreachable): local edits queue, flush on reconnect
- [ ] New device: login with email/password, pull all projects
- [ ] Large project (100 files, 5MB): sync < 5s
- [ ] PDF upload (10MB binary): verify no corruption

---

## Security Notes
- JWT with short expiry (1h) + refresh token (7d) stored in `HttpOnly` cookie or server-side sessions file
- bcrypt cost factor ≥ 12
- CORS restricted to `ALLOWED_ORIGINS` env var
- File paths sanitized: reject `..` path traversal
- Rate limiting on `/auth/*` endpoints (10 req/min)
- HTTPS required in production (reverse proxy: Caddy/nginx)

---

## Google Drive FUSE Setup (admin, one-time)
```bash
# install google-drive-ocamlfuse
sudo apt install google-drive-ocamlfuse   # or build from source
google-drive-ocamlfuse /mnt/gdrive        # first run: opens browser OAuth
# automount on boot via /etc/fuse.conf + systemd unit
mkdir -p /mnt/gdrive/texlyre
export STORAGE_ROOT=/mnt/gdrive/texlyre
```
The server has zero knowledge of Google — it just sees a normal filesystem.

---

## File Summary

### New (backend repo `texlyre-sync-server/`)
- `bin/main.ml`
- `lib/auth.ml` — login/register/JWT
- `lib/file_store.ml` — read/write/list on STORAGE_ROOT
- `lib/ws_hub.ml` — connection registry + broadcast
- `lib/watcher.ml` — inotify loop
- `lib/routes.ml` — Dream router
- `Dockerfile`, `docker-compose.yml`
- `texlyre-sync-server.opam`

### New (frontend)
- `src/services/SyncServerService.ts`
- `src/services/SyncConnection.ts`
- `src/hooks/useSyncServer.ts`
- `src/components/common/SyncStatusIndicator.tsx`
- `src/components/settings/SyncServerSettings.tsx`
- `src/styles/components/sync-server.css`

### Modified (frontend)
- `src/contexts/AuthContext.tsx` — sync server login/logout
- `src/contexts/EditorContext.tsx` — call `useSyncServer()`
- `src/contexts/SettingsContext.tsx` — register sync settings
- `src/components/app/EditorApp.tsx` — add indicator
- `src/components/app/ProjectApp.tsx` — add indicator
- `src/types/auth.ts` — add `syncServerId?` to User
- `src/types/projects.ts` — add `syncServerId?`, `syncServerLastSync?` to Project
