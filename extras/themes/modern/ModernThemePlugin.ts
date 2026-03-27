// extras/themes/modern/ModernThemePlugin.ts
import { t } from '@/i18n';
import type {
	ThemeLayout,
	ThemePlugin,
	ThemeVariant,
} from '@/plugins/PluginInterface';
import { themes } from './colors';
import './styles/index';

const createModernTheme = (): ThemePlugin => {
	let currentThemeId = 'modern-light';

	const layout: ThemeLayout = {
		id: 'modern',
		name: 'Modern Theme',
		containerClass: 'modern-theme-container',
		defaultFileExplorerWidth: 280,
		minFileExplorerWidth: 180,
		maxFileExplorerWidth: 600,
		stylesheetPath: './styles/base.css',
	};

	const applyThemeColors = (themeId: string) => {
		const colors = themes[themeId as keyof typeof themes];
		if (!colors) return;

		Object.entries(colors).forEach(([key, value]) => {
			document.documentElement.style.setProperty(
				`--pico-${key}`,
				value as string,
			);
		});
		document.documentElement.style.setProperty('color', colors.color);
		document.documentElement.style.setProperty('--text-color', colors.color);
	};

	return {
		id: 'modern-theme',
		name: t('Modern Theme'),
		version: '1.0.0',
		type: 'theme',
		themes: [
			{ id: 'modern-nord', name: t('Modern Nord'), isDark: true },
			{ id: 'modern-nord-light', name: t('Modern Nord Light'), isDark: false },
			{ id: 'modern-dark', name: t('Modern Dark (Rosé Pine)'), isDark: true },
			{ id: 'modern-everforest', name: t('Modern Everforest'), isDark: true },
			{ id: 'modern-light', name: t('Modern Light (Flexoki)'), isDark: false },
		],

		applyTheme(variantId: string): void {
			const theme = this.themes.find((t) => t.id === variantId);
			if (!theme) return;

			currentThemeId = variantId;
			applyThemeColors(variantId);

			document.documentElement.setAttribute('data-theme', variantId);
			document.documentElement.setAttribute('data-theme-plugin', 'modern');
			document.documentElement.setAttribute(
				'data-theme-mode',
				theme.isDark ? 'dark' : 'light',
			);
		},

		getThemeVariants(): ThemeVariant[] {
			return this.themes;
		},

		getCurrentTheme(): ThemeVariant {
			return this.themes.find((t) => t.id === currentThemeId) || this.themes[0];
		},

		getLayout(): ThemeLayout {
			return layout;
		},

		applyLayout(): void {
			document.documentElement.setAttribute('data-layout', layout.id);
		},
	};
};

const modernTheme = createModernTheme();

export default modernTheme;
