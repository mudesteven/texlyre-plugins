// src/components/settings/ThemeToggleButton.tsx
import { t } from '@/i18n';
import type React from 'react';
import { useState } from 'react';

import { SunIcon, MoonIcon } from '../common/Icons';

const STORAGE_KEY = 'texlyre-theme';

export function getStoredTheme(): 'dark' | 'light' {
	return (localStorage.getItem(STORAGE_KEY) as 'dark' | 'light') || 'dark';
}

export function applyTheme(theme: 'dark' | 'light') {
	document.documentElement.setAttribute('data-theme', theme);
	localStorage.setItem(STORAGE_KEY, theme);
}

interface ThemeToggleButtonProps {
	className?: string;
}

const ThemeToggleButton: React.FC<ThemeToggleButtonProps> = ({ className = '' }) => {
	const [isDark, setIsDark] = useState(
		() => document.documentElement.getAttribute('data-theme') !== 'light'
	);

	const toggle = () => {
		const newTheme = isDark ? 'light' : 'dark';
		applyTheme(newTheme);
		setIsDark(!isDark);
	};

	return (
		<button
			className={className}
			onClick={toggle}
			title={t('Switch to {theme}', {
				theme: isDark ? t('Light Theme') : t('Dark Theme')
			})}
		>
			{isDark ? <SunIcon /> : <MoonIcon />}
		</button>
	);
};

export default ThemeToggleButton;
