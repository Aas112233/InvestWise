import { useEffect, useCallback } from 'react';

/**
 * useKeyboardShortcuts Hook
 * Adds global keyboard shortcut support
 */

export interface KeyboardShortcut {
 key: string;
 ctrlKey?: boolean;
 shiftKey?: boolean;
 altKey?: boolean;
 metaKey?: boolean;
 handler: () => void;
 preventDefault?: boolean;
 description?: string;
}

export const useKeyboardShortcuts = (
 shortcuts: KeyboardShortcut[],
 enabled: boolean = true
) => {
 const handleKeyDown = useCallback((event: KeyboardEvent) => {
 if (!enabled) return;

 // Don't trigger shortcuts when typing in inputs
 const target = event.target as HTMLElement;
 const isInputField = ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName) ||
 target.isContentEditable;

 for (const shortcut of shortcuts) {
 const {
 key,
 ctrlKey = false,
 shiftKey = false,
 altKey = false,
 metaKey = false,
 handler,
 preventDefault = true
 } = shortcut;

 // Check if the key matches
 if (event.key.toLowerCase() === key.toLowerCase()) {
 // Check modifier keys
 const modifiersMatch =
 event.ctrlKey === ctrlKey &&
 event.shiftKey === shiftKey &&
 event.altKey === altKey &&
 (event.metaKey === metaKey || ctrlKey === metaKey); // Support Cmd on Mac

 if (modifiersMatch) {
 // Allow shortcuts in input fields only if explicitly allowed
 if (isInputField && !shortcut.preventDefault) {
 return;
 }

 if (preventDefault) {
 event.preventDefault();
 }

 handler();
 return;
 }
 }
 }
 }, [shortcuts, enabled]);

 useEffect(() => {
 if (!enabled) return;

 window.addEventListener('keydown', handleKeyDown);

 return () => {
 window.removeEventListener('keydown', handleKeyDown);
 };
 }, [handleKeyDown, enabled]);
};

/**
 * Common keyboard shortcuts for forms
 */
export const useFormShortcuts = (options: {
 onSave?: () => void;
 onCancel?: () => void;
 onSearch?: () => void;
 enabled?: boolean;
}) => {
 const { onSave, onCancel, onSearch, enabled = true } = options;

 const shortcuts: KeyboardShortcut[] = [];

 if (onSave) {
 shortcuts.push({
 key: 's',
 ctrlKey: true,
 handler: onSave,
 description: 'Save form'
 });
 }

 if (onCancel) {
 shortcuts.push({
 key: 'Escape',
 handler: onCancel,
 description: 'Cancel/Close'
 });
 }

 if (onSearch) {
 shortcuts.push({
 key: 'f',
 ctrlKey: true,
 handler: onSearch,
 description: 'Focus search'
 });
 }

 useKeyboardShortcuts(shortcuts, enabled);
};

/**
 * Common keyboard shortcuts for navigation
 */
export const useNavigationShortcuts = (options: {
 onGoHome?: () => void;
 onGoBack?: () => void;
 onToggleTheme?: () => void;
 enabled?: boolean;
}) => {
 const { onGoHome, onGoBack, onToggleTheme, enabled = true } = options;

 const shortcuts: KeyboardShortcut[] = [];

 if (onGoHome) {
 shortcuts.push({
 key: 'g',
 handler: onGoHome,
 description: 'Go to dashboard'
 });
 }

 if (onGoBack) {
 shortcuts.push({
 key: 'Backspace',
 altKey: true,
 handler: onGoBack,
 description: 'Go back'
 });
 }

 if (onToggleTheme) {
 shortcuts.push({
 key: 'd',
 altKey: true,
 handler: onToggleTheme,
 description: 'Toggle dark mode'
 });
 }

 useKeyboardShortcuts(shortcuts, enabled);
};

/**
 * Keyboard shortcut help dialog
 * Shows available shortcuts to users
 */
export const getShortcutHelp = (shortcuts: KeyboardShortcut[]) => {
 return shortcuts.map(s => {
 const modifiers = [];
 if (s.ctrlKey) modifiers.push('Ctrl');
 if (s.shiftKey) modifiers.push('Shift');
 if (s.altKey) modifiers.push('Alt');
 if (s.metaKey) modifiers.push('⌘');

 const keyCombo = [...modifiers, s.key.toUpperCase()].join(' + ');

 return {
 shortcut: keyCombo,
 description: s.description || 'No description'
 };
 });
};

export default useKeyboardShortcuts;
