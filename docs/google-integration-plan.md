# Google Sign-In + Drive Sync — Core Integration Plan

**Status:** Planning
**Date:** 2026-03-28

---

## Overview

Integrate Google Sign-In as a first-class auth method and Google Drive as the primary cross-device sync backend. Replaces the unused `plugins/backup/google-drive/` plugin entirely with core services.

### Goals

- Users can sign in with Google (alongside existing local auth)
- Profile (name, email, avatar) stays in sync with Google account
- Raw source files (`.typ`, `.tex`, etc.) and compiled PDFs are stored as real Drive files — viewable directly in Google Drive
- Auto-sync on compile and on save (debounced)
- Persistent OAuth tokens — no re-auth on every page load

### Non-goals

- Real-time collaborative editing via Drive (Yjs stays as-is)
- Backend server or service worker for token refresh
- Supporting the old JSON-blob backup format from the removed plugin

---

## Cleanup First

Delete `src/plugins/backup/google-drive/` entirely — this plugin was never used and has no users. Starting clean avoids adapter shims and stale settings keys.

---

## Phase 1 — Data Layer & Type Changes

### 1.1 Extend `src/types/auth.ts`

Add Google-specific fields to `User`:

```ts
interface User {
  // ... existing fields unchanged ...
  googleId?: string;         // Google "sub" — stable identifier
  googleEmail?: string;      // Google account email
  googlePicture?: string;    // Avatar URL from Google profile
  googleLinkedAt?: number;   // Epoch ms when account was linked
}
```

Add `GoogleToken` (stored separately in IndexedDB, not on User):

```ts
interface GoogleToken {
  userId: string;            // FK → User.id
  accessToken: string;
  expiresAt: number;         // epoch ms: Date.now() + expires_in * 1000
  scopes: string[];          // ['openid','email','profile','drive.file']
  idToken?: string;          // JWT for profile extraction
}
```

### 1.2 Extend `src/types/projects.ts`

```ts
interface Project {
  // ... existing fields unchanged ...
  driveLastSync?: number;              // epoch ms of last successful raw-file sync
}
```

Drive file ID mappings are stored in a dedicated IndexedDB store (see 1.3) rather than on the Project record to keep Project records lean.

### 1.3 New IndexedDB stores in `AuthService.ts`

Bump DB version +1. Add two stores (purely additive — no existing data touched):

| Store | Key | Purpose |
|---|---|---|
| `google_tokens` | `userId` | One token record per user |
| `drive_file_map` | `[userId, projectId, path]` (compound) | Maps `relativePath → driveFileId` per project |

`drive_file_map` record shape:
```ts
interface DriveFileMapEntry {
  userId: string;
  projectId: string;
  path: string;          // e.g. 'src/main.typ', 'output/main.pdf'
  driveFileId: string;   // Drive file ID for update-vs-create logic
  lastSynced: number;    // epoch ms
}
```

---

## Phase 2 — `GoogleAuthService` (new file)

**Location:** `src/services/GoogleAuthService.ts`

Single responsibility: Google Identity Services (GIS) lifecycle — sign-in, token storage, silent refresh, revocation.

### API

```ts
class GoogleAuthService {
  // Initialization — call once on app start in App.tsx
  async initialize(): Promise<void>

  // Sign-in — triggers Google popup/One Tap
  // Returns decoded profile + access token on success
  async signIn(): Promise<{ profile: GoogleProfile; accessToken: string; idToken: string } | null>

  // Request/upgrade Drive scope (incremental auth — separate consent from sign-in)
  async requestDriveAccess(userId: string): Promise<{ success: boolean; error?: string }>

  // Silent refresh — no UI shown; returns null if re-auth needed
  async refreshToken(userId: string): Promise<string | null>

  // Revoke at Google + delete from IndexedDB
  async revokeToken(userId: string): Promise<void>

  // Read stored token; returns null if missing or expired
  async getStoredToken(userId: string): Promise<GoogleToken | null>

  // Write/update token in IndexedDB
  async storeToken(userId: string, token: GoogleToken): Promise<void>
}

interface GoogleProfile {
  sub: string;    // stable Google ID
  email: string;
  name: string;
  picture: string;
}

export const googleAuthService = new GoogleAuthService()
```

### GIS Script Loading

- Load `https://accounts.google.com/gsi/client` once, lazily, on first call
- Cache load promise to prevent double-injection

### Token Expiry Strategy

- Store `expiresAt = Date.now() + expires_in * 1000`
- `getStoredToken` returns null if `Date.now() > expiresAt - 60_000` (1 min buffer)
- On app init, if token within 5 min of expiry → proactively refresh silently
- If silent refresh fails → set internal `needsReauth` flag, emit event for UI banner

### Scopes Requested at Sign-In

Request all scopes in one consent screen (fewer clicks for user):
- `openid`, `email`, `profile`
- `https://www.googleapis.com/auth/drive.file`

Drive scope can also be requested later via `requestDriveAccess()` for users who skip it initially.

---

## Phase 3 — `AuthService.ts` Changes

### New Methods

#### `signInWithGoogle(idToken, accessToken, profile)`

```
1. Decode sub, email, name, picture from profile
2. Query users store by googleId === profile.sub
3. If found → update lastLogin, googlePicture, googleEmail → return user
4. If not found by googleId → query by email
   a. Email match exists → link Google to that account
      (set googleId, googleEmail, googlePicture, googleLinkedAt)
   b. No match → create new User (no passwordHash, isGuest: false)
5. Store token via googleAuthService.storeToken(userId, token)
6. Write userId to localStorage (texlyre-current-user)
7. Return user
```

#### `linkGoogleAccount(userId, profile, accessToken)`

- Called from Profile settings when a logged-in local user connects Google
- Sets google fields on User record; stores token
- Does NOT touch passwordHash (local login still works)

#### `unlinkGoogleAccount(userId)`

- Guard: if user has no passwordHash → throw `'Set a local password before disconnecting Google'`
- Clear googleId, googleEmail, googlePicture, googleLinkedAt from User record
- Call `googleAuthService.revokeToken(userId)`

### Changes to `initialize()`

After loading user from localStorage:
1. If user has `googleId` → call `googleAuthService.refreshToken(userId)` silently
2. Success → store refreshed token, proceed normally
3. Failure → do NOT log out; set `googleStatus = 'needs_reauth'`; local features unaffected

---

## Phase 4 — `AuthContext.tsx` Changes

### New Context Values

```ts
interface AuthContextType {
  // ... existing fields unchanged ...
  googleStatus: 'disconnected' | 'connected' | 'needs_reauth';
  signInWithGoogle: () => Promise<{ success: boolean; error?: string }>;
  linkGoogle: () => Promise<{ success: boolean; error?: string }>;
  unlinkGoogle: () => Promise<{ success: boolean; error?: string }>;
  requestDriveAccess: () => Promise<{ success: boolean; error?: string }>;
}
```

### `googleStatus` Derivation

| Value | Condition |
|---|---|
| `'connected'` | `user.googleId` set + valid unexpired token in `google_tokens` |
| `'needs_reauth'` | `user.googleId` set but token expired and silent refresh failed |
| `'disconnected'` | No `googleId` on user |

---

## Phase 5 — `GoogleDriveService` (new core service)

**Location:** `src/services/GoogleDriveService.ts`

Replaces the deleted plugin service. Not wrapped in `BackupPlugin` interface — it's a core service.

### Drive Folder Structure

```
TeXlyre/
└── Projects/
    └── {project-name}-{shortId}/     ← e.g. "My Thesis-a3f2"
        ├── project.json              ← Project metadata snapshot
        ├── src/
        │   ├── main.typ
        │   └── chapter1.typ
        └── output/
            └── main.pdf
```

### MIME Type Map

| Extension | MIME type |
|---|---|
| `.typ` | `text/plain` |
| `.tex` | `text/x-tex` |
| `.bib` | `text/plain` |
| `.pdf` | `application/pdf` |
| `.png` | `image/png` |
| `.jpg` / `.jpeg` | `image/jpeg` |
| `.svg` | `image/svg+xml` |
| other binary | `application/octet-stream` |

### API

```ts
class GoogleDriveService {
  // Sync source files for a project
  // Uses drive_file_map to update existing files (no duplicates)
  async syncRawFiles(userId: string, projectId: string, files: RawFileEntry[]): Promise<SyncResult>

  // Upload compiled PDF — called from compiler output handler
  async uploadPdf(userId: string, projectId: string, pdfBytes: Uint8Array, fileName: string): Promise<void>

  // Download all raw source files for a project (for import)
  async downloadRawFiles(userId: string, projectId: string): Promise<RawFileEntry[]>

  // Internal helpers
  private async getToken(userId: string): Promise<string>   // throws if no valid token
  private async ensureRootFolder(token: string): Promise<string>
  private async ensureProjectFolder(token: string, rootId: string, project: Project): Promise<string>
  private async ensureSubFolder(token: string, parentId: string, name: string): Promise<string>
  private async upsertFile(token: string, folderId: string, entry: RawFileEntry, existingId?: string): Promise<string>
  private driveRequest(token: string, url: string, options?: RequestInit): Promise<Response>
}

interface RawFileEntry {
  path: string;              // relative: 'src/main.typ'
  content: string | Uint8Array;
  mimeType: string;
  modifiedAt?: number;
}

interface SyncResult {
  uploaded: string[];        // paths of newly created Drive files
  updated: string[];         // paths of updated Drive files
  failed: Array<{ path: string; error: string }>;
  timestamp: number;
}

export const googleDriveService = new GoogleDriveService()
```

### Update-vs-Create Logic

Before any upload, look up `drive_file_map` for `(userId, projectId, path)`:
- Entry found → use `files.update` (PATCH to `/upload/drive/v3/files/{id}`)
- Entry not found → use `files.create` (POST to `/upload/drive/v3/files`)
- After either operation → upsert `drive_file_map` entry with new `driveFileId` and `lastSynced`

---

## Phase 6 — Auto-Sync Hooks

### 6.1 On PDF Compile Success

In the compiler output handler (wherever compiled PDF bytes are returned to the UI):

```ts
if (googleStatus === 'connected' && settings['google-drive-auto-sync-on-compile']) {
  googleDriveService.uploadPdf(userId, projectId, pdfBytes, outputFileName)
    .catch(err => console.warn('Drive PDF upload failed:', err))  // non-blocking
}
```

### 6.2 On Document Save (debounced)

In the autosave/Yjs persistence hook:

```ts
// 10-second debounce — don't upload on every keystroke
debouncedDriveSync(projectId, 10_000, () => {
  if (googleStatus === 'connected' && settings['google-drive-auto-sync-on-save']) {
    googleDriveService.syncRawFiles(userId, projectId, currentFiles)
      .catch(err => console.warn('Drive source sync failed:', err))
  }
})
```

### 6.3 New Settings

| Key | Type | Default | Description |
|---|---|---|---|
| `google-drive-auto-sync-on-save` | checkbox | `false` | Sync source files 10s after last save |
| `google-drive-auto-sync-on-compile` | checkbox | `true` | Upload PDF after successful compile |
| `google-drive-raw-sync-enabled` | checkbox | `true` | Master toggle for raw file sync |

---

## Phase 7 — UI Changes

### 7.1 Login / Register Page

- Add **"Sign in with Google"** button (Google-branded) below the existing form
- After OAuth completes, if the returned email matches an existing local account:
  - Show inline prompt: "Link to your existing TeXlyre account? [Yes, link it] [Create new account]"
  - This prevents silent account duplication

### 7.2 Profile / Account Settings Panel

Add a **"Google Account"** section:
- **Connected state:** Google avatar (32px) + name + email; [Disconnect] button
- **Disconnected state:** [Connect Google] button
- **Drive Sync subsection** (only shown when connected):
  - "Sync source files on save" toggle
  - "Upload PDF on compile" toggle
  - Last sync timestamp + [Sync Now] button

### 7.3 Navbar / Header — Guest Upgrade

- Guest users: show "Sign in with Google" alongside existing "Create Account" prompt
- Google-signed-in users: replace generic user icon with Google avatar (24px circle)

### 7.4 Toolbar Drive Status Indicator

Replaces the old `GoogleDriveStatusIndicator` plugin component.
- Shows Google avatar (20px) when signed in
- Color dot overlay: grey (no Drive), green (synced), amber (syncing), red (error)
- Hover tooltip: last sync time or error message
- Click → opens Drive settings panel

### 7.5 "Re-connect Google" Banner

When `googleStatus === 'needs_reauth'`:
- Thin amber banner directly below the app header
- Text: "Google session expired — [Re-connect]  ✕"
- [Re-connect] triggers `signInWithGoogle()` (interactive popup)
- [✕] dismisses for the session (stores dismissal in `sessionStorage`)

---

## Phase 8 — Migration

- IndexedDB version bump is purely additive: two new stores, zero modifications to existing stores
- Migration runs once on `AuthService.initialize()` at app start
- Existing users: no change, all Google fields are optional
- The deleted plugin's settings keys (`google-drive-backup-*`) are simply abandoned — no users, no migration needed

---

## Wiring in `App.tsx`

```tsx
// Add near top of App component, before AuthProvider
useEffect(() => {
  googleAuthService.initialize()
}, [])
```

Or call it from `AuthService.initialize()` directly since that already runs before React render in `main.tsx`.

---

## File Change Summary

| File | Action |
|---|---|
| `src/plugins/backup/google-drive/` | **Delete entire directory** |
| `src/services/GoogleAuthService.ts` | **New** |
| `src/services/GoogleDriveService.ts` | **New** |
| `src/types/auth.ts` | Extend `User` + add `GoogleToken` |
| `src/types/projects.ts` | Add `driveLastSync` |
| `src/services/AuthService.ts` | New methods, new IndexedDB stores, version bump |
| `src/contexts/AuthContext.tsx` | New context values + actions |
| Login/Register component | Google Sign-In button |
| Profile/Settings component | Google Account section |
| Toolbar status indicator | Replace plugin component with core component |
| `src/styles/components/auth.css` | Google button styles |
| `src/styles/components/plugin-header.css` | Avatar styles |
| `App.tsx` | Wire `googleAuthService.initialize()` |

---

## Recommended Implementation Order

```
Phase 1  →  Types + IndexedDB schema          (foundation everything else builds on)
Phase 2  →  GoogleAuthService                  (GIS token lifecycle)
Phase 3  →  AuthService new methods            (sign-in, link, unlink logic)
Phase 4  →  AuthContext new values             (expose to UI)
Phase 7.1 → Login page Google button           (first end-to-end sign-in flow)
Phase 7.2 → Profile panel Google section       (account management)
Phase 5  →  GoogleDriveService                 (raw file sync)
Phase 6  →  Auto-sync hooks                    (compile + save triggers)
Phase 7.3–7.5 → Remaining UI (avatar, banner, toolbar indicator)
Phase 8  →  Migration + cleanup                (always last)
```

---

## QA / Testing Plan

### Unit Tests

| Test | What to verify |
|---|---|
| `GoogleAuthService.storeToken` | Token written to IndexedDB correctly |
| `GoogleAuthService.getStoredToken` — expired | Returns null |
| `GoogleAuthService.getStoredToken` — valid | Returns token |
| `GoogleAuthService.refreshToken` — GIS succeeds | Returns new access token |
| `GoogleAuthService.refreshToken` — GIS fails | Returns null, does not throw |
| `AuthService.signInWithGoogle` — new user | Creates User with googleId, no duplicate |
| `AuthService.signInWithGoogle` — email match | Links Google to existing account |
| `AuthService.signInWithGoogle` — returning Google user | Updates lastLogin only |
| `AuthService.unlinkGoogle` — no passwordHash | Throws "set a password first" |
| `AuthService.unlinkGoogle` — has passwordHash | Clears google fields, revokes token |
| `GoogleDriveService.syncRawFiles` — first sync | Calls `files.create`, writes to `drive_file_map` |
| `GoogleDriveService.syncRawFiles` — second sync | Calls `files.update`, no new Drive file created |
| `GoogleDriveService.uploadPdf` | Sends `application/pdf` MIME type |
| `ensureProjectFolder` idempotency | Calling twice returns same folder ID, no duplicate created |
| `drive_file_map` round-trip | Entry written after sync, read back correctly on next sync |

### Integration Tests (manual or Playwright)

| Scenario | Steps | Expected |
|---|---|---|
| New Google user sign-in | Click "Sign in with Google", complete OAuth | Account created, avatar shown, Drive indicator active |
| Local user links Google | Settings → Google Account → Connect | Google fields added, token stored, local password unchanged |
| Returning Google user on page reload | Refresh browser | Silent token refresh, Drive reconnected without prompt |
| Expired token on reload | Manually expire token in DevTools IndexedDB | Amber "Re-connect" banner shown; app still fully usable |
| Re-connect from banner | Click [Re-connect] in banner | Interactive popup, token refreshed, banner dismissed |
| Compile → PDF uploaded | Compile a Typst file with auto-sync enabled | PDF appears in Drive `Projects/{name}/output/` with correct name |
| Save → source file synced | Edit and save, wait 10s debounce | `.typ` file updated in Drive `Projects/{name}/src/` |
| Second sync — no duplicates | Sync same project twice | Drive shows one file per path, not two |
| Drive folder structure | Inspect Drive after first sync | `TeXlyre/Projects/{name}/src/` and `/output/` present, correct MIME types |
| Offline compile | Disable network, compile | No error thrown; gracefully skips upload; retries on next online sync |
| Unlink Google | Settings → Disconnect Google | google fields cleared, Drive indicator gone, local auth still works |
| Guest → Google upgrade | Guest session → Sign in with Google | Guest projects transferred to new Google-linked account |
| Email collision prompt | Sign in with Google using email that matches existing local account | Prompt shown: "Link to existing account?" |

### Regression Tests

| Area | Risk |
|---|---|
| Existing local login (username/password) | Must work with zero Google involvement |
| Guest account creation and expiry | 24h expiry, upgrade path must be unaffected |
| Project CRUD | Create/update/delete must not be affected by DB version bump |
| File system backup | Must remain fully independent of Google auth state |
| Settings persistence | All existing settings keys must load correctly after DB migration |
| Yjs document persistence | No interference from new IndexedDB stores |

### Security Checklist

- [ ] Access token never logged, never stored in localStorage, never sent to any endpoint other than `googleapis.com`
- [ ] Token stored in IndexedDB — not accessible via `document.cookie`
- [ ] `drive.file` scope — app can only read/write files it created; cannot browse rest of user's Drive
- [ ] ID token used only for local profile extraction; not forwarded anywhere
- [ ] `unlinkGoogle` always revokes token at Google before clearing local state
- [ ] "Re-connect" flow does not silently request new scopes beyond original consent
- [ ] No token in URL hash (use `response_type: 'token'` with popup, not redirect)
