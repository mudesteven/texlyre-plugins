// extras/backup/google-drive/GoogleDriveModal.tsx
import { t } from '@/i18n';
import type React from 'react';
import { useEffect, useState } from 'react';
import {
	DisconnectIcon,
	ImportIcon,
	GitPushIcon,
	SettingsIcon,
	TrashIcon,
} from '@/components/common/Icons';
import Modal from '@/components/common/Modal';
import SettingsModal from '@/components/settings/SettingsModal';
import { useSettings } from '@/hooks/useSettings';
import { formatDate } from '@/utils/dateUtils';
import { googleDriveService } from './GoogleDriveService';
import { GoogleDriveIcon } from './GoogleDriveIcon';

interface GoogleDriveModalProps {
	isOpen: boolean;
	onClose: () => void;
	currentProjectId?: string | null;
	isInEditor?: boolean;
}

const GoogleDriveModal: React.FC<GoogleDriveModalProps> = ({
	isOpen,
	onClose,
	currentProjectId,
	isInEditor = false,
}) => {
	const [showSettings, setShowSettings] = useState(false);
	const [status, setStatus] = useState(googleDriveService.getStatus());
	const [activities, setActivities] = useState(
		googleDriveService.getActivities(),
	);
	const [syncScope, setSyncScope] = useState<'current' | 'all'>('current');
	const [isOperating, setIsOperating] = useState(false);

	const { getSetting } = useSettings();

	// Sync settings into the service whenever they change
	useEffect(() => {
		const clientId =
			(getSetting('google-drive-backup-client-id')?.value as string) ?? '';
		const folderName =
			(getSetting('google-drive-backup-folder-name')?.value as string) ??
			'TeXlyre Backups';
		const activityHistoryLimit =
			(getSetting(
				'google-drive-backup-activity-history-limit',
			)?.value as number) ?? 50;

		googleDriveService.setSettings({ clientId, folderName, activityHistoryLimit });
	}, [getSetting]);

	useEffect(() => {
		const unsubscribeStatus = googleDriveService.addStatusListener(setStatus);
		const unsubscribeActivities =
			googleDriveService.addActivityListener(setActivities);
		return () => {
			unsubscribeStatus();
			unsubscribeActivities();
		};
	}, []);

	const handleAsyncOperation = async (op: () => Promise<void>) => {
		if (isOperating) return;
		setIsOperating(true);
		try {
			await op();
		} catch (err) {
			alert(
				`${t('Operation failed')}: ${err instanceof Error ? err.message : String(err)}`,
			);
		} finally {
			setIsOperating(false);
		}
	};

	const getScopedProjectId = () =>
		isInEditor && syncScope === 'current' ? currentProjectId : undefined;

	const handleConnect = () =>
		handleAsyncOperation(async () => {
			const result = await googleDriveService.requestAccess();
			if (!result.success) {
				alert(result.error ?? t('Failed to connect to Google Drive.'));
			}
		});

	const handleExport = () =>
		handleAsyncOperation(() =>
			googleDriveService.exportData(getScopedProjectId() ?? undefined),
		);

	const handleImport = () =>
		handleAsyncOperation(() =>
			googleDriveService.importChanges(getScopedProjectId() ?? undefined),
		);

	const handleDisconnect = () =>
		handleAsyncOperation(() => googleDriveService.disconnect());

	const getActivityIcon = (type: string) =>
		({
			backup_error: '❌',
			import_error: '❌',
			backup_complete: '✅',
			import_complete: '✅',
			backup_start: '📤',
			import_start: '📥',
		})[type] ?? 'ℹ️';

	const getActivityColor = (type: string) =>
		({
			backup_error: '#dc3545',
			import_error: '#dc3545',
			backup_complete: '#28a745',
			import_complete: '#28a745',
			backup_start: '#007bff',
			import_start: '#6f42c1',
		})[type] ?? '#6c757d';

	return (
		<>
			<Modal
				isOpen={isOpen}
				onClose={onClose}
				title={t('Google Drive Backup')}
				icon={GoogleDriveIcon}
				size="medium"
				headerActions={
					<button
						className="modal-close-button"
						onClick={() => setShowSettings(true)}
						title={t('Google Drive Backup Settings')}
					>
						<SettingsIcon />
					</button>
				}
			>
				<div className="backup-modal">
					<div className="backup-status">
						<div className="backup-controls">
							{!status.isConnected ? (
								<button
									className="button primary"
									onClick={handleConnect}
									disabled={isOperating}
								>
									{isOperating
										? t('Connecting…')
										: t('Connect to Google Drive')}
								</button>
							) : (
								<>
									{isInEditor && (
										<div className="sync-scope-selector">
											<label>{t('Backup Scope:')}</label>
											<div>
												<label>
													<input
														type="radio"
														name="gdriveSyncScope"
														value="current"
														checked={syncScope === 'current'}
														onChange={(e) =>
															setSyncScope(
																e.target.value as 'current' | 'all',
															)
														}
														disabled={isOperating}
													/>
													<span>{t('Current Project')}</span>
												</label>
												<label>
													<input
														type="radio"
														name="gdriveSyncScope"
														value="all"
														checked={syncScope === 'all'}
														onChange={(e) =>
															setSyncScope(
																e.target.value as 'current' | 'all',
															)
														}
														disabled={isOperating}
													/>
													<span>{t('All projects')}</span>
												</label>
											</div>
										</div>
									)}

									<div className="backup-toolbar">
										<div className="primary-actions">
											<button
												className="button secondary"
												onClick={handleExport}
												disabled={status.status === 'syncing' || isOperating}
											>
												<GitPushIcon />
												{status.status === 'syncing' || isOperating
													? t('Uploading…')
													: t('Upload to Drive')}
											</button>
											<button
												className="button secondary"
												onClick={handleImport}
												disabled={status.status === 'syncing' || isOperating}
											>
												<ImportIcon />
												{status.status === 'syncing' || isOperating
													? t('Downloading…')
													: t('Download from Drive')}
											</button>
										</div>
										<div className="secondary-actions">
											<button
												className="button secondary icon-only"
												onClick={handleDisconnect}
												disabled={isOperating}
												title={t('Disconnect from Google Drive')}
											>
												<DisconnectIcon />
											</button>
										</div>
									</div>
								</>
							)}
						</div>

						<div className="status-info">
							<div className="status-item">
								<strong>{t('Google Drive:')}</strong>{' '}
								{status.isConnected ? t('Connected') : t('Disconnected')}
							</div>
							{status.lastSync && (
								<div className="status-item">
									<strong>{t('Last Sync:')}</strong>{' '}
									{formatDate(status.lastSync)}
								</div>
							)}
							{status.error && (
								<div className="error-message">{status.error}</div>
							)}
						</div>
					</div>

					{activities.length > 0 && (
						<div className="backup-activities">
							<div className="activities-header">
								<h3>{t('Recent Activity')}</h3>
								<button
									className="button small secondary"
									onClick={() => googleDriveService.clearAllActivities()}
									title={t('Clear all activities')}
									disabled={isOperating}
								>
									<TrashIcon />
									{t('Clear All')}
								</button>
							</div>
							<div className="activities-list">
								{activities
									.slice(0, 10)
									.map((activity) => (
										<div
											key={activity.id}
											className="activity-item"
											style={{ borderLeftColor: getActivityColor(activity.type) }}
										>
											<div className="activity-content">
												<div className="activity-header">
													<span className="activity-icon">
														{getActivityIcon(activity.type)}
													</span>
													<span className="activity-message">
														{activity.message}
													</span>
													<button
														className="activity-close"
														onClick={() =>
															googleDriveService.clearActivity(activity.id)
														}
														title={t('Dismiss')}
														disabled={isOperating}
													>
														×
													</button>
												</div>
												<div className="activity-time">
													{formatDate(activity.timestamp)}
												</div>
											</div>
										</div>
									))}
							</div>
						</div>
					)}

					<div className="backup-info">
						<h3>{t('How Google Drive Backup Works')}</h3>
						<div className="info-content">
							<p>
								{t(
									'Google Drive backup stores your TeXlyre data in your personal Google Drive:',
								)}
							</p>
							<ul>
								<li>
									<strong>{t('Upload: ')}</strong>
									{t('Pushes local data to Drive as a JSON file')}
								</li>
								<li>
									<strong>{t('Download: ')}</strong>
									{t('Fetches the latest backup from Drive')}
								</li>
								<li>
									{t(
										'Files are stored in a folder named after your configured folder name',
									)}
								</li>
								<li>
									{t(
										'Requires a Google Cloud Console OAuth2 Client ID — see settings',
									)}
								</li>
							</ul>
						</div>
					</div>
				</div>
			</Modal>

			<SettingsModal
				isOpen={showSettings}
				onClose={() => setShowSettings(false)}
				initialCategory={t('Backup')}
				initialSubcategory={t('Google Drive')}
			/>
		</>
	);
};

export default GoogleDriveModal;
