# Google Drive Backup Plugin

This plugin backs up TeXlyre project data to your personal Google Drive using the official Google Drive API v3 and Google Identity Services (GIS).

## Prerequisites

- A Google account with Google Drive access
- A Google Cloud Console project with the **Google Drive API** enabled
- An **OAuth 2.0 Client ID** (Web application type)

## Setup — Google Cloud Console

1. Go to [console.cloud.google.com](https://console.cloud.google.com/).
2. Create or select a project.
3. Enable the **Google Drive API**:
   - Navigate to **APIs & Services → Library**.
   - Search for "Google Drive API" and click **Enable**.
4. Create an OAuth 2.0 Client ID:
   - Navigate to **APIs & Services → Credentials**.
   - Click **Create Credentials → OAuth client ID**.
   - Set the application type to **Web application**.
   - Under **Authorized JavaScript origins**, add your TeXlyre origin (e.g., `http://localhost:5173` for development or your production domain).
   - Click **Create** and copy the **Client ID**.

## Setup — TeXlyre

1. Open TeXlyre **Settings → Backup → Google Drive**.
2. Paste your **OAuth2 Client ID** into the "OAuth2 Client ID" field.
3. (Optional) Change the **Drive Folder Name** (default: `TeXlyre Backups`).
4. Ensure the plugin is registered in `texlyre.config.ts`:
   ```ts
   backup: ['github', 'gitlab', 'forgejo', 'gitea', 'google-drive'],
   ```
5. Run `npm run generate-configs && npm run build`.

## Usage

1. Click the **Drive** indicator in the toolbar (or open the backup menu).
2. Click **Connect to Google Drive** — a Google sign-in popup will appear.
3. Grant the requested permissions (`drive.file` scope — only files created by this app).
4. Use **Upload to Drive** to back up your projects.
5. Use **Download from Drive** to restore from the latest backup.

## Security Notes

- The plugin requests the `https://www.googleapis.com/auth/drive.file` scope, which grants access **only to files created by this app** — it cannot read or modify other files in your Drive.
- Access tokens are held in memory only and are not persisted to disk.
- Revoking access in your Google Account settings will immediately disconnect the plugin.

## Limitations

- Project import (`importChanges`) currently stubs the data restoration step. Full import requires hooking into TeXlyre's `ProjectImportService`. See the `TODO` comments in `GoogleDriveService.ts`.
- Collaboration/real-time sync is not supported; this is a manual push/pull backup.
