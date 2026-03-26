// extras/backup/google-drive/GoogleDrivePlugin.ts
import type { BackupPlugin } from '@/plugins/PluginInterface';
import { GoogleDriveIcon } from './GoogleDriveIcon';
import GoogleDriveModal from './GoogleDriveModal';
import { googleDriveService } from './GoogleDriveService';
import GoogleDriveStatusIndicator from './GoogleDriveStatusIndicator';
import { getGoogleDriveBackupSettings } from './settings';

const googleDriveBackupPlugin: BackupPlugin = {
	id: 'google-drive-backup',
	name: 'Google Drive',
	version: '1.0.0',
	type: 'backup',
	icon: GoogleDriveIcon,
	get settings() {
		return getGoogleDriveBackupSettings();
	},

	canHandle: (backupType: string): boolean => {
		return backupType === 'google-drive';
	},

	renderStatusIndicator: GoogleDriveStatusIndicator,
	renderModal: GoogleDriveModal,
	getService: () => googleDriveService,
};

export default googleDriveBackupPlugin;
