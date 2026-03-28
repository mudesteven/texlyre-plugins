// src/extensions/codemirror/activeEditorView.ts
// Tracks the most recently active EditorView so the menubar can dispatch commands.
import type { EditorView } from '@codemirror/view';

let _view: EditorView | null = null;
let _fileType: 'latex' | 'typst' = 'latex';

export const setActiveEditorView = (
    view: EditorView | null,
    fileType: 'latex' | 'typst' = 'latex',
): void => {
    _view = view;
    if (view) _fileType = fileType;
};

export const getActiveEditorView = (): EditorView | null => _view;
export const getActiveFileType = (): 'latex' | 'typst' => _fileType;
