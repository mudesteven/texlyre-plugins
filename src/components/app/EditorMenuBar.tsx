// src/components/app/EditorMenuBar.tsx
import { useState, useRef, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import type React from 'react';
import type { EditorView } from '@codemirror/view';
import { undo, redo, selectAll } from '@codemirror/commands';
import { openSearchPanel } from '@codemirror/search';
import { t } from '@/i18n';

import {
    getActiveEditorView,
    getActiveFileType,
} from '../../extensions/codemirror/activeEditorView';
import { wrapSelection, insertText } from '../../extensions/codemirror/toolbar/helpers';
import { getPendingImagePath } from '../../extensions/codemirror/PasteExtension';

// ─── command definitions ──────────────────────────────────────────────────────

type CommandFn = (view: EditorView) => boolean;

const latex = {
    section: (v: EditorView) => {
        const sel = v.state.selection.main;
        const txt = v.state.doc.sliceString(sel.from, sel.to);
        return insertText(v, `\\section{${txt}}\n`, -(txt.length + 2));
    },
    subsection: (v: EditorView) => {
        const sel = v.state.selection.main;
        const txt = v.state.doc.sliceString(sel.from, sel.to);
        return insertText(v, `\\subsection{${txt}}\n`, -(txt.length + 2));
    },
    subsubsection: (v: EditorView) => {
        const sel = v.state.selection.main;
        const txt = v.state.doc.sliceString(sel.from, sel.to);
        return insertText(v, `\\subsubsection{${txt}}\n`, -(txt.length + 2));
    },
    equation: (v: EditorView) =>
        insertText(v, '\\begin{equation}\n\t\n\\end{equation}', -15),
    description: (v: EditorView) =>
        insertText(v, '\\begin{description}\n\t\\item[Term] Description\n\\end{description}', -18),
    verbatim: (v: EditorView) => {
        const sel = v.state.selection.main;
        const txt = v.state.doc.sliceString(sel.from, sel.to);
        return insertText(v, `\\begin{verbatim}\n${txt}\n\\end{verbatim}`, txt ? -(txt.length + 13) : -13);
    },
    lstlisting: (v: EditorView) =>
        insertText(v, '\\begin{lstlisting}\n\t\n\\end{lstlisting}', -18),
    quote: (v: EditorView) => {
        const sel = v.state.selection.main;
        const txt = v.state.doc.sliceString(sel.from, sel.to);
        return insertText(v, `\\begin{quote}\n${txt}\n\\end{quote}`, txt ? -(txt.length + 11) : -11);
    },
    citation: (v: EditorView) => wrapSelection(v, '\\cite{', '}'),
    reference: (v: EditorView) => wrapSelection(v, '\\ref{', '}'),
    label: (v: EditorView) => wrapSelection(v, '\\label{', '}'),
    footnote: (v: EditorView) => wrapSelection(v, '\\footnote{', '}'),
    emph: (v: EditorView) => wrapSelection(v, '\\emph{', '}'),
    typewriter: (v: EditorView) => wrapSelection(v, '\\texttt{', '}'),
    superscript: (v: EditorView) => wrapSelection(v, '\\textsuperscript{', '}'),
    subscript: (v: EditorView) => wrapSelection(v, '\\textsubscript{', '}'),
    figure: (v: EditorView) => {
        const p = getPendingImagePath();
        return insertText(
            v,
            `\\begin{figure}[h]\n\t\\centering\n\t\\includegraphics[width=0.8\\textwidth]{${p || ''}}\n\t\\caption{}\n\t\\label{fig:}\n\\end{figure}`,
            p ? -28 : -40,
        );
    },
};

const typst = {
    heading1: (v: EditorView) => {
        const sel = v.state.selection.main;
        const txt = v.state.doc.sliceString(sel.from, sel.to) || 'Heading';
        return insertText(v, `= ${txt}\n`, -(txt.length + 1));
    },
    heading2: (v: EditorView) => {
        const sel = v.state.selection.main;
        const txt = v.state.doc.sliceString(sel.from, sel.to) || 'Heading';
        return insertText(v, `== ${txt}\n`, -(txt.length + 1));
    },
    heading3: (v: EditorView) => {
        const sel = v.state.selection.main;
        const txt = v.state.doc.sliceString(sel.from, sel.to) || 'Heading';
        return insertText(v, `=== ${txt}\n`, -(txt.length + 1));
    },
    heading4: (v: EditorView) => {
        const sel = v.state.selection.main;
        const txt = v.state.doc.sliceString(sel.from, sel.to) || 'Heading';
        return insertText(v, `==== ${txt}\n`, -(txt.length + 1));
    },
    equation: (v: EditorView) =>
        insertText(v, '#math.equation[\n\t\n]', -2),
    termList: (v: EditorView) =>
        insertText(v, '/ Term: Definition', -11),
    inlineCode: (v: EditorView) => wrapSelection(v, '`', '`'),
    codeBlock: (v: EditorView) => {
        const sel = v.state.selection.main;
        const txt = v.state.doc.sliceString(sel.from, sel.to);
        return insertText(v, `\`\`\`\n${txt}\n\`\`\``, txt ? -(txt.length + 4) : -4);
    },
    quote: (v: EditorView) => {
        const sel = v.state.selection.main;
        const txt = v.state.doc.sliceString(sel.from, sel.to);
        return insertText(v, `#quote[\n${txt}\n]`, txt ? -(txt.length + 2) : -2);
    },
    citation: (v: EditorView) => {
        const sel = v.state.selection.main;
        const txt = v.state.doc.sliceString(sel.from, sel.to);
        return txt ? insertText(v, `@${txt}`, 0) : insertText(v, '#cite(<>)', -2);
    },
    reference: (v: EditorView) => {
        const sel = v.state.selection.main;
        const txt = v.state.doc.sliceString(sel.from, sel.to);
        return txt ? insertText(v, `<${txt}>`, 0) : insertText(v, '#ref(<>)', -2);
    },
    label: (v: EditorView) => {
        const sel = v.state.selection.main;
        const txt = v.state.doc.sliceString(sel.from, sel.to);
        return txt ? insertText(v, `<${txt}>`, 0) : insertText(v, '<label>', -1);
    },
    footnote: (v: EditorView) => wrapSelection(v, '#footnote[', ']'),
    emph: (v: EditorView) => wrapSelection(v, '#emph[', ']'),
    monospace: (v: EditorView) => wrapSelection(v, '`', '`'),
    superscript: (v: EditorView) => wrapSelection(v, '#super[', ']'),
    subscript: (v: EditorView) => wrapSelection(v, '#sub[', ']'),
    figure: (v: EditorView) => {
        const p = getPendingImagePath();
        return insertText(
            v,
            `#figure(\n\timage("${p || ''}", width: 80%),\n\tcaption: []\n)`,
            p ? -3 : -30,
        );
    },
};

// ─── menu definitions ─────────────────────────────────────────────────────────

interface MenuItem {
    label: string;
    command?: CommandFn;
    /** Optional short hint shown on the right */
    hint?: string;
    /** If true, item is a separator */
    separator?: boolean;
    /** Action that doesn't need the editor view */
    action?: () => void;
}

interface MenuSection {
    heading?: string;
    items: MenuItem[];
}

function getInsertMenuSections(fileType: 'latex' | 'typst'): MenuSection[] {
    if (fileType === 'latex') {
        return [
            {
                heading: t('Sections'),
                items: [
                    { label: t('Section'), command: latex.section, hint: '\\section' },
                    { label: t('Subsection'), command: latex.subsection, hint: '\\subsection' },
                    { label: t('Subsubsection'), command: latex.subsubsection, hint: '\\subsubsection' },
                ],
            },
            {
                heading: t('Math'),
                items: [
                    { label: t('Equation'), command: latex.equation, hint: '\\begin{equation}' },
                ],
            },
            {
                heading: t('Lists'),
                items: [
                    { label: t('Description List'), command: latex.description, hint: '\\begin{description}' },
                ],
            },
            {
                heading: t('Code'),
                items: [
                    { label: t('Verbatim'), command: latex.verbatim, hint: '\\begin{verbatim}' },
                    { label: t('Code Listing'), command: latex.lstlisting, hint: '\\begin{lstlisting}' },
                ],
            },
            {
                heading: t('Cross-references'),
                items: [
                    { label: t('Citation'), command: latex.citation, hint: '\\cite{}' },
                    { label: t('Reference'), command: latex.reference, hint: '\\ref{}' },
                    { label: t('Label'), command: latex.label, hint: '\\label{}' },
                    { label: t('Footnote'), command: latex.footnote, hint: '\\footnote{}' },
                ],
            },
            {
                items: [
                    { label: t('Quote'), command: latex.quote, hint: '\\begin{quote}' },
                    { label: t('Figure'), command: latex.figure, hint: '\\begin{figure}' },
                ],
            },
        ];
    }
    // Typst
    return [
        {
            heading: t('Headings'),
            items: [
                { label: t('Heading 1'), command: typst.heading1, hint: '= …' },
                { label: t('Heading 2'), command: typst.heading2, hint: '== …' },
                { label: t('Heading 3'), command: typst.heading3, hint: '=== …' },
                { label: t('Heading 4'), command: typst.heading4, hint: '==== …' },
            ],
        },
        {
            heading: t('Math'),
            items: [
                { label: t('Equation'), command: typst.equation, hint: '#math.equation' },
            ],
        },
        {
            heading: t('Lists'),
            items: [
                { label: t('Term List'), command: typst.termList, hint: '/ Term: …' },
            ],
        },
        {
            heading: t('Code'),
            items: [
                { label: t('Inline Code'), command: typst.inlineCode, hint: '`…`' },
                { label: t('Code Block'), command: typst.codeBlock, hint: '```…```' },
            ],
        },
        {
            heading: t('Cross-references'),
            items: [
                { label: t('Citation'), command: typst.citation, hint: '@key' },
                { label: t('Reference'), command: typst.reference, hint: '#ref(<>)' },
                { label: t('Label'), command: typst.label, hint: '<label>' },
                { label: t('Footnote'), command: typst.footnote, hint: '#footnote[]' },
            ],
        },
        {
            items: [
                { label: t('Quote'), command: typst.quote, hint: '#quote[]' },
                { label: t('Figure'), command: typst.figure, hint: '#figure()' },
            ],
        },
    ];
}

function getFormatMenuSections(fileType: 'latex' | 'typst'): MenuSection[] {
    if (fileType === 'latex') {
        return [
            {
                items: [
                    { label: t('Emphasize'), command: latex.emph, hint: '\\emph{}' },
                    { label: t('Typewriter'), command: latex.typewriter, hint: '\\texttt{}' },
                ],
            },
            {
                items: [
                    { label: t('Superscript'), command: latex.superscript, hint: '\\textsuperscript{}' },
                    { label: t('Subscript'), command: latex.subscript, hint: '\\textsubscript{}' },
                ],
            },
        ];
    }
    return [
        {
            items: [
                { label: t('Emphasize'), command: typst.emph, hint: '#emph[]' },
                { label: t('Monospace'), command: typst.monospace, hint: '`…`' },
            ],
        },
        {
            items: [
                { label: t('Superscript'), command: typst.superscript, hint: '#super[]' },
                { label: t('Subscript'), command: typst.subscript, hint: '#sub[]' },
            ],
        },
    ];
}

function getFileMenuSections(): MenuSection[] {
    return [
        {
            items: [
                {
                    label: t('New File'),
                    action: () => document.dispatchEvent(new CustomEvent('menu-new-file')),
                },
                {
                    label: t('Rename File…'),
                    action: () => document.dispatchEvent(new CustomEvent('menu-rename-file')),
                },
            ],
        },
        {
            items: [
                {
                    label: t('Export / Download'),
                    action: () => {
                        const btn = document.querySelector<HTMLButtonElement>('.output-export-button button');
                        btn?.click();
                    },
                },
            ],
        },
        {
            items: [
                {
                    label: t('Project Settings…'),
                    action: () => document.dispatchEvent(new CustomEvent('open-project-settings')),
                },
            ],
        },
    ];
}

function getEditMenuSections(): MenuSection[] {
    return [
        {
            items: [
                { label: t('Undo'), command: (v) => undo(v), hint: 'Ctrl+Z' },
                { label: t('Redo'), command: (v) => redo(v), hint: 'Ctrl+Y' },
            ],
        },
        {
            items: [
                { label: t('Find'), command: (v) => { openSearchPanel(v); return true; }, hint: 'Ctrl+F' },
                { label: t('Select All'), command: (v) => selectAll(v), hint: 'Ctrl+A' },
            ],
        },
    ];
}

function getViewMenuSections(): MenuSection[] {
    return [
        {
            items: [
                {
                    label: t('Toggle File Tree'),
                    action: () => document.dispatchEvent(new CustomEvent('toggle-sidebar')),
                },
                {
                    label: t('Toggle Output Panel'),
                    action: () => document.dispatchEvent(new CustomEvent('toggle-output')),
                },
            ],
        },
        {
            items: [
                {
                    label: t('Fullscreen'),
                    action: () => {
                        if (!document.fullscreenElement) {
                            document.documentElement.requestFullscreen?.();
                        } else {
                            document.exitFullscreen?.();
                        }
                    },
                    hint: 'F11',
                },
            ],
        },
    ];
}

function getHelpMenuSections(): MenuSection[] {
    return [
        {
            items: [
                {
                    label: t('Keyboard Shortcuts'),
                    action: () => document.dispatchEvent(new CustomEvent('open-keyboard-shortcuts')),
                    hint: '?',
                },
                {
                    label: t('Documentation'),
                    action: () => window.open('https://texlyre.github.io/docs/intro', '_blank', 'noreferrer'),
                },
            ],
        },
        {
            items: [
                {
                    label: t('Privacy Policy'),
                    action: () => document.dispatchEvent(new CustomEvent('open-privacy')),
                },
                {
                    label: t('Source Code'),
                    action: () => window.open('https://github.com/TeXlyre/texlyre', '_blank', 'noreferrer'),
                },
            ],
        },
    ];
}

// ─── dropdown component ───────────────────────────────────────────────────────

interface DropdownProps {
    sections: MenuSection[];
    anchorEl: HTMLElement;
    onClose: () => void;
}

const MenuDropdown: React.FC<DropdownProps> = ({ sections, anchorEl, onClose }) => {
    const ref = useRef<HTMLDivElement>(null);
    const rect = anchorEl.getBoundingClientRect();
    const pos = { top: rect.bottom + 2, left: rect.left };

    // close on outside click or Escape
    useEffect(() => {
        const handler = (e: MouseEvent) => {
            if (ref.current && !ref.current.contains(e.target as Node) &&
                !anchorEl.contains(e.target as Node)) {
                onClose();
            }
        };
        const keyHandler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
        document.addEventListener('mousedown', handler);
        document.addEventListener('keydown', keyHandler);
        return () => {
            document.removeEventListener('mousedown', handler);
            document.removeEventListener('keydown', keyHandler);
        };
    }, [anchorEl, onClose]);

    const run = useCallback((item: MenuItem) => {
        onClose();
        if (item.action) {
            item.action();
        } else if (item.command) {
            const view = getActiveEditorView();
            if (view) item.command(view);
        }
    }, [onClose]);

    return createPortal(
        <div
            ref={ref}
            className="editor-menu-dropdown"
            style={{ position: 'fixed', top: pos.top, left: pos.left }}
        >
            {sections.map((section, si) => (
                <div key={si}>
                    {si > 0 && <div className="editor-menu-separator" />}
                    {section.heading && (
                        <div className="editor-menu-section-label">{section.heading}</div>
                    )}
                    {section.items.map((item, ii) => (
                        <button
                            key={ii}
                            className="editor-menu-item"
                            onMouseDown={(e) => { e.preventDefault(); run(item); }}
                        >
                            <span className="editor-menu-item-label">{item.label}</span>
                            {item.hint && (
                                <span className="editor-menu-item-hint">{item.hint}</span>
                            )}
                        </button>
                    ))}
                </div>
            ))}
        </div>,
        document.body,
    );
};

// ─── main component ───────────────────────────────────────────────────────────

type MenuId = 'file' | 'edit' | 'insert' | 'view' | 'format' | 'help';

interface EditorMenuBarProps {
    projectType?: 'latex' | 'typst';
}

const EditorMenuBar: React.FC<EditorMenuBarProps> = ({ projectType }) => {
    const [openMenu, setOpenMenu] = useState<MenuId | null>(null);
    const btnRefs = useRef<Partial<Record<MenuId, HTMLButtonElement>>>({});

    const fileType = getActiveFileType() ?? projectType ?? 'latex';

    const close = useCallback(() => setOpenMenu(null), []);

    const toggle = (menu: MenuId) =>
        setOpenMenu(prev => (prev === menu ? null : menu));

    const menus: { id: MenuId; label: string; sections: MenuSection[] }[] = [
        { id: 'file', label: t('File'), sections: getFileMenuSections() },
        { id: 'edit', label: t('Edit'), sections: getEditMenuSections() },
        { id: 'insert', label: t('Insert'), sections: getInsertMenuSections(fileType) },
        { id: 'format', label: t('Format'), sections: getFormatMenuSections(fileType) },
        { id: 'view', label: t('View'), sections: getViewMenuSections() },
        { id: 'help', label: t('Help'), sections: getHelpMenuSections() },
    ];

    return (
        <>
            {menus.map(({ id, label, sections }) => (
                <button
                    key={id}
                    ref={(el) => { if (el) btnRefs.current[id] = el; }}
                    className={`editor-menu-btn${openMenu === id ? ' open' : ''}`}
                    onClick={() => toggle(id)}
                >
                    {label}
                </button>
            ))}

            {openMenu && btnRefs.current[openMenu] && (
                <MenuDropdown
                    sections={menus.find(m => m.id === openMenu)!.sections}
                    anchorEl={btnRefs.current[openMenu]!}
                    onClose={close}
                />
            )}
        </>
    );
};

export default EditorMenuBar;
