import { useEffect } from 'preact/hooks';

// Bit flags indicating modifiers required by a shortcut or pressed in a key event.
const modifiers = {
  alt: 1,
  ctrl: 2,
  meta: 4,
  shift: 8,
};

/**
 * Match a `shortcut` key sequence against a keydown event.
 *
 * A shortcut key sequence is a string of "+"-separated keyboard modifiers and
 * keys. The list may contain zero or more modifiers and must contain exactly
 * one non-modifier key. The key and modifier names are case-insensitive.
 * For example "Ctrl+Enter", "shift+a". Key names are matched against `KeyboardEvent.key`.
 *
 * @param {KeyboardEvent} event
 * @param {string} shortcut
 * @return {boolean}
 */
export function matchShortcut(event, shortcut) {
  const parts = shortcut.split('+').map(p => p.toLowerCase());

  let requiredModifiers = 0;
  let requiredKey = null;

  for (let part of parts) {
    const modifierFlag = modifiers[part];
    if (modifierFlag) {
      requiredModifiers |= modifierFlag;
    } else {
      requiredKey = part;
    }
  }

  if (!requiredKey) {
    throw new Error(`Invalid shortcut: ${shortcut}`);
  }

  const actualModifiers =
    (event.ctrlKey && modifiers.ctrl) |
    (event.metaKey && modifiers.meta) |
    (event.altKey && modifiers.alt) |
    (event.shiftKey && modifiers.shift);

  return (
    actualModifiers === requiredModifiers &&
    event.key.toLowerCase() === requiredKey
  );
}

/**
 * @typedef ShortcutOptions
 * @prop {HTMLElement} rootElement -
 *   Element on which the key event listener should be installed. Defaults to
 *   `document.body`.
 */

/**
 * Install a shortcut key listener on the document.
 *
 * This can be used directly outside of a component. To use within a Preact
 * component, you probably want the `useShortcut` hook.
 *
 * @param {string} shortcut - Shortcut key sequence. See `matchShortcut`.
 * @param {(e: KeyboardEvent) => any} onPress - A function to call when the shortcut matches
 * @param {ShortcutOptions} [options]
 * @return {() => void} A function that removes the shortcut
 */
export function installShortcut(
  shortcut,
  onPress,
  { rootElement = document.body } = {}
) {
  const onKeydown = event => {
    if (matchShortcut(event, shortcut)) {
      onPress(event);
    }
  };
  rootElement.addEventListener('keydown', onKeydown);
  return () => rootElement.removeEventListener('keydown', onKeydown);
}

/**
 * An effect hook that installs a shortcut using `installShortcut` and removes
 * it when the component is unmounted.
 *
 * This provides a convenient way to enable a shortcut while a component is
 * rendered. To conditionally disable the shortcut, set `shortcut` to `null`.
 *
 * @param {string|null} shortcut -
 *   A shortcut key sequence to match or `null` to disable. See `matchShortcut`.
 * @param {(e: KeyboardEvent) => any} onPress - A function to call when the shortcut matches
 * @param {ShortcutOptions} [options]
 */
export function useShortcut(
  shortcut,
  onPress,
  { rootElement = document.body } = {}
) {
  useEffect(() => {
    if (!shortcut) {
      return null;
    }
    return installShortcut(shortcut, onPress, { rootElement });
  }, [shortcut, onPress, rootElement]);
}
