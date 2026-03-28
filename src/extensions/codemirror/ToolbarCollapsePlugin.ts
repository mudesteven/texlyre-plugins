// src/extensions/codemirror/ToolbarCollapsePlugin.ts
// Adds a chevron toggle that collapses the toolbar to just the basic controls.
import { ViewPlugin, type EditorView } from '@codemirror/view';
import type { Extension } from '@codemirror/state';

const STORAGE_KEY = 'texlyre-toolbar-collapsed';

const BASIC_ITEMS = new Set([
    'latex-bold', 'typst-bold',
    'latex-italic', 'typst-italic',
    'latex-underline', 'typst-underline',
    'latex-textcolor', 'typst-textcolor',
    'latex-highlight', 'typst-highlight',
    'undo', 'redo',
    'fullScreen',
]);

export function createToolbarCollapsePlugin(): Extension {
    return ViewPlugin.fromClass(class {
        private toolbar: HTMLElement | null = null;
        private btn: HTMLButtonElement;
        private collapsed: boolean;

        constructor(private view: EditorView) {
            // Default to collapsed; only expand if user explicitly saved 'false'
        this.collapsed = localStorage.getItem(STORAGE_KEY) !== 'false';

            this.btn = document.createElement('button');
            this.btn.className = 'toolbar-collapse-btn';
            this.btn.title = 'Toggle toolbar';
            this.btn.addEventListener('mousedown', (e) => {
                e.preventDefault();
                this.toggle();
            });

            requestAnimationFrame(() => this.mount());
        }

        private mount() {
            const toolbar = this.view.dom.querySelector('.codemirror-toolbar') as HTMLElement | null;
            if (!toolbar) return;
            this.toolbar = toolbar;
            toolbar.appendChild(this.btn);
            this.apply();
        }

        private toggle() {
            this.collapsed = !this.collapsed;
            localStorage.setItem(STORAGE_KEY, String(this.collapsed));
            this.apply();
        }

        private apply() {
            if (!this.toolbar) return;
            this.toolbar.classList.toggle('is-collapsed', this.collapsed);
            this.btn.innerHTML = this.collapsed
                ? '<svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><polyline points="4,6 8,10 12,6"/></svg>'
                : '<svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><polyline points="4,10 8,6 12,10"/></svg>';
        }

        destroy() {
            this.toolbar?.classList.remove('is-collapsed');
            this.btn.remove();
        }
    });
}

export { BASIC_ITEMS };
