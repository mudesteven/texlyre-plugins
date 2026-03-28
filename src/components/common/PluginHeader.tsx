// src/components/common/PluginHeader.tsx
import { useState, useRef, useEffect, useLayoutEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import type React from 'react';

import type { Awareness } from 'y-protocols/awareness';
import CollaboratorAvatars from './CollaboratorAvatars';

interface PluginHeaderProps {
	fileName: string;
	filePath?: string;
	pluginName: string;
	pluginVersion: string;
	tooltipInfo: string | string[];
	controls: React.ReactNode;
	onNavigateToLinkedFile?: () => void;
	linkedFileInfo?: {
		fileName?: string;
		filePath?: string;
		fileId?: string;
	} | null;
	awareness?: Awareness | null;
}
interface PluginControlGroupProps {
	children: React.ReactNode;
	className?: string;
}

export const PluginControlGroup: React.FC<PluginControlGroupProps> = ({
	children,
	className = '',
}) => {
	return <div className={`control-group ${className}`}>{children}</div>;
};

export const PluginHeader: React.FC<PluginHeaderProps> = ({
	controls,
	awareness,
}) => {
	const [isOverflowing, setIsOverflowing] = useState(false);
	const [overflowOpen, setOverflowOpen] = useState(false);
	const barRef = useRef<HTMLDivElement>(null);
	const btnRef = useRef<HTMLButtonElement>(null);
	const dropdownRef = useRef<HTMLDivElement>(null);

	// Detect overflow in the controls bar
	useEffect(() => {
		const bar = barRef.current;
		if (!bar) return;
		const observer = new ResizeObserver(() => {
			setIsOverflowing(bar.scrollWidth > bar.clientWidth + 2);
		});
		observer.observe(bar);
		return () => observer.disconnect();
	}, []);

	// Sync padding-right on the toolbar so toolbar buttons don't slide under the controls
	useLayoutEffect(() => {
		const controls = barRef.current?.closest('.plugin-controls') as HTMLElement | null;
		if (!controls) return;
		// Set immediately so the toolbar has correct padding before first paint
		document.documentElement.style.setProperty('--plugin-controls-width', `${controls.offsetWidth + 12}px`);
		const observer = new ResizeObserver(() => {
			document.documentElement.style.setProperty('--plugin-controls-width', `${controls.offsetWidth + 12}px`);
		});
		observer.observe(controls);
		return () => {
			observer.disconnect();
			document.documentElement.style.removeProperty('--plugin-controls-width');
		};
	}, []);

	// Close overflow dropdown on outside click
	useEffect(() => {
		if (!overflowOpen) return;
		const handler = (e: MouseEvent) => {
			if (
				dropdownRef.current && !dropdownRef.current.contains(e.target as Node) &&
				btnRef.current && !btnRef.current.contains(e.target as Node)
			) {
				setOverflowOpen(false);
			}
		};
		document.addEventListener('mousedown', handler);
		return () => document.removeEventListener('mousedown', handler);
	}, [overflowOpen]);

	const getDropdownPos = useCallback(() => {
		if (!btnRef.current) return { top: 64, right: 8 };
		const rect = btnRef.current.getBoundingClientRect();
		return { top: rect.bottom + 4, right: window.innerWidth - rect.right };
	}, []);

	const dropdownPos = overflowOpen ? getDropdownPos() : null;

	return (
		<div className="plugin-header">
			<div className="plugin-controls">
				{awareness && <CollaboratorAvatars awareness={awareness} />}
				{/* Visible bar — clips on overflow */}
				<div className="plugin-controls-bar" ref={barRef}>
					{controls}
				</div>
				{/* Overflow button — shown when bar clips */}
				{isOverflowing && (
					<button
						ref={btnRef}
						className="plugin-overflow-btn"
						onClick={() => setOverflowOpen(o => !o)}
						title="More actions"
					>
						···
					</button>
				)}
			</div>

			{overflowOpen && dropdownPos && createPortal(
				<div
					ref={dropdownRef}
					className="plugin-overflow-dropdown"
					style={{
						position: 'fixed',
						top: dropdownPos.top,
						right: dropdownPos.right,
					}}
				>
					{controls}
				</div>,
				document.body
			)}
		</div>
	);
};
