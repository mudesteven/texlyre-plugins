// extras/backup/google-drive/GoogleDriveStatusIndicator.tsx
import { t } from '@/i18n';
import React, { useState } from 'react';
import GoogleDriveModal from './GoogleDriveModal';
import { googleDriveService } from './GoogleDriveService';

interface GoogleDriveStatusIndicatorProps {
	className?: string;
	currentProjectId?: string | null;
	isInEditor?: boolean;
}

const GoogleDriveStatusIndicator: React.FC<GoogleDriveStatusIndicatorProps> = ({
	className = '',
	currentProjectId,
	isInEditor = false,
}) => {
	const [status, setStatus] = useState(googleDriveService.getStatus());
	const [showModal, setShowModal] = useState(false);

	React.useEffect(() => {
		const unsubscribe = googleDriveService.addStatusListener(setStatus);
		return () => unsubscribe();
	}, []);

	const getStatusColor = () => {
		if (!status.isConnected) return '#666';
		if (status.status === 'error') return '#dc3545';
		if (status.status === 'syncing') return '#ffc107';
		return '#28a745';
	};

	const getStatusText = () => {
		if (!status.isConnected) return t('Google Drive not connected');
		if (status.status === 'error') return t('Google Drive error');
		if (status.status === 'syncing') return t('Syncing…');
		if (status.lastSync) {
			return t('Last Sync: {time}', {
				time: new Date(status.lastSync).toLocaleTimeString(),
			});
		}
		return t('Connected to Google Drive');
	};

	return (
		<>
			<div
				className={`backup-status-indicator main-button single-service ${className} ${status.isConnected ? 'connected' : 'disconnected'}`}
				onClick={() => setShowModal(true)}
				title={getStatusText()}
			>
				<div
					className="status-dot"
					style={{ backgroundColor: getStatusColor() }}
				/>
				<span className="backup-label">{t('Drive')}</span>
			</div>

			<GoogleDriveModal
				isOpen={showModal}
				onClose={() => setShowModal(false)}
				currentProjectId={currentProjectId}
				isInEditor={isInEditor}
			/>
		</>
	);
};

export default GoogleDriveStatusIndicator;
