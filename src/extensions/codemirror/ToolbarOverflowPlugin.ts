// src/extensions/codemirror/ToolbarOverflowPlugin.ts
// Shows a "···" overflow button when the toolbar is too narrow to display all items.
// Clicking it shows a dropdown with all toolbar commands.
import { ViewPlugin, type EditorView } from '@codemirror/view';
import type { Extension } from '@codemirror/state';
import type { ToolbarItem } from 'codemirror-toolbar';

export function createToolbarOverflowPlugin(items: ToolbarItem[]): Extension {
    return ViewPlugin.fromClass(
        class {
            private toolbar: HTMLElement | null = null;
            private btn: HTMLButtonElement;
            private panel: HTMLDivElement;
            private observer: ResizeObserver;
            private panelOpen = false;
            private closeHandler: (e: MouseEvent) => void;
            private keyHandler: (e: KeyboardEvent) => void;

            constructor(private view: EditorView) {
                // Create overflow button
                this.btn = document.createElement('button');
                this.btn.className = 'toolbar-overflow-btn';
                this.btn.title = 'More';
                this.btn.innerHTML = '<svg viewBox="0 0 16 16" width="16" height="16" fill="currentColor"><circle cx="3" cy="8" r="1.5"/><circle cx="8" cy="8" r="1.5"/><circle cx="13" cy="8" r="1.5"/></svg>';
                this.btn.style.display = 'none';
                this.btn.addEventListener('mousedown', (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    this.togglePanel();
                });

                // Create overflow dropdown panel
                this.panel = document.createElement('div');
                this.panel.className = 'toolbar-overflow-panel';
                this.panel.style.display = 'none';

                for (const item of items) {
                    const el = document.createElement('button');
                    el.className = 'toolbar-overflow-item';
                    el.title = item.label;
                    el.innerHTML = `<span class="toolbar-overflow-item-icon">${item.icon}</span>`;
                    el.addEventListener('mousedown', (e) => {
                        e.preventDefault();
                        this.closePanel();
                        item.command(this.view);
                    });
                    this.panel.appendChild(el);
                }
                document.body.appendChild(this.panel);

                this.observer = new ResizeObserver(() => this.checkOverflow());

                this.closeHandler = (e: MouseEvent) => {
                    if (!this.panel.contains(e.target as Node) && e.target !== this.btn) {
                        this.closePanel();
                    }
                };
                this.keyHandler = (e: KeyboardEvent) => {
                    if (e.key === 'Escape') this.closePanel();
                };

                requestAnimationFrame(() => this.mount());
            }

            private mount() {
                const editorEl = this.view.dom;
                this.toolbar = editorEl.querySelector('.codemirror-toolbar');
                if (!this.toolbar) return;
                this.toolbar.insertAdjacentElement('afterend', this.btn);
                this.observer.observe(this.toolbar);
                this.checkOverflow();
            }

            private checkOverflow() {
                if (!this.toolbar) return;
                const overflowing = this.toolbar.scrollWidth > this.toolbar.clientWidth + 4;
                this.btn.style.display = overflowing ? '' : 'none';
                if (!overflowing) this.closePanel();
            }

            private togglePanel() {
                if (this.panelOpen) {
                    this.closePanel();
                } else {
                    this.openPanel();
                }
            }

            private openPanel() {
                // Show to measure size
                this.panel.style.display = '';
                const rect = this.btn.getBoundingClientRect();
                const panelWidth = this.panel.offsetWidth;
                let left = rect.right - panelWidth;
                if (left < 8) left = 8;
                this.panel.style.top = `${rect.bottom + 4}px`;
                this.panel.style.left = `${left}px`;
                this.panelOpen = true;
                document.addEventListener('mousedown', this.closeHandler);
                document.addEventListener('keydown', this.keyHandler);
            }

            private closePanel() {
                this.panel.style.display = 'none';
                this.panelOpen = false;
                document.removeEventListener('mousedown', this.closeHandler);
                document.removeEventListener('keydown', this.keyHandler);
            }

            destroy() {
                this.closePanel();
                this.observer.disconnect();
                this.btn.remove();
                this.panel.remove();
            }
        }
    );
}
