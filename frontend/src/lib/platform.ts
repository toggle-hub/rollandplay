/** Apple keyboards use ⌘ where other systems use Ctrl. */
export const isApplePlatform = typeof navigator !== "undefined"
  && /Mac|iPhone|iPad|iPod/i.test(navigator.platform || navigator.userAgent);

const appleSymbols: Record<string, string> = { mod: "⌘", shift: "⇧", alt: "⌥" };
const otherNames: Record<string, string> = { mod: "Ctrl", shift: "Shift", alt: "Alt" };
const keyNames: Record<string, string> = { del: "Del", esc: "Esc", enter: "Enter", space: "Space", backspace: "Backspace", left: "←", right: "→", up: "↑", down: "↓" };

/**
 * Formats a shortcut such as "mod+shift+z" for the user's keyboard: "⌘⇧Z" on Apple devices,
 * "Ctrl+Shift+Z" elsewhere.
 */
export function shortcutLabel(keys: string, apple = isApplePlatform): string {
  const parts = keys.split("+").map((part) => {
    const lower = part.toLowerCase();
    const modifier = (apple ? appleSymbols : otherNames)[lower];
    if (modifier) return modifier;
    return keyNames[lower] ?? part.toUpperCase();
  });
  return apple ? parts.join("") : parts.join("+");
}

/** The name of the key that turns snapping off: Option on Apple keyboards, Alt elsewhere. */
export const altKeyName = isApplePlatform ? "Option" : "Alt";
