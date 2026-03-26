// extras/backup/google-drive/settings.ts
import { t } from '@/i18n';
import type { Setting } from '@/contexts/SettingsContext';

export const getGoogleDriveBackupSettings = (): Setting[] => [
	{
		id: 'google-drive-backup-client-id',
		category: t('Backup'),
		subcategory: t('Google Drive'),
		type: 'text',
		label: t('OAuth2 Client ID'),
		description: t(
			'Google Cloud Console OAuth2 client ID. Create one at console.cloud.google.com.',
		),
		defaultValue: '',
	},
	{
		id: 'google-drive-backup-folder-name',
		category: t('Backup'),
		subcategory: t('Google Drive'),
		type: 'text',
		label: t('Drive Folder Name'),
		description: t('Name of the Google Drive folder used to store backups.'),
		defaultValue: 'TeXlyre Backups',
	},
	{
		id: 'google-drive-backup-activity-history-limit',
		category: t('Backup'),
		subcategory: t('Google Drive'),
		type: 'number',
		label: t('Activity History Limit'),
		description: t('Maximum number of activities to keep in history.'),
		defaultValue: 50,
	},
];
