import { useEffect, useRef, type ReactNode } from "react";

type Props = {
  /** Names the dialog: the id of its heading, or a label when the content brings its own heading. */
  name: { labelledBy: string } | { label: string };
  onClose: () => void;
  children: ReactNode;
  /** Room for wide forms such as the actions editor. */
  wide?: boolean;
};

/**
 * A modal dialog shown while mounted. The browser keeps focus inside it and moves focus to its
 * first control; Escape or a click on the dimmed backdrop asks the owner to close it.
 */
export function Dialog({ name, onClose, children, wide = false }: Props) {
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (typeof dialog.showModal === "function") dialog.showModal();
    else dialog.setAttribute("open", "");
    return () => {
      if (dialog.open) dialog.close();
    };
  }, []);

  return <dialog
    ref={ref}
    aria-labelledby={"labelledBy" in name ? name.labelledBy : undefined}
    aria-label={"label" in name ? name.label : undefined}
    className={`m-auto max-h-[calc(100dvh-2rem)] overflow-y-auto overscroll-contain rounded-xl border border-[var(--line)] bg-[var(--ink)] p-0 text-[var(--paper)] shadow-2xl backdrop:bg-black/60 ${wide ? "w-[min(calc(100%-2rem),52rem)]" : "w-[min(calc(100%-2rem),40rem)]"}`}
    onCancel={(event) => {
      event.preventDefault();
      onClose();
    }}
    // The browser may still close it on a repeated Escape; keep the owner's state in step.
    onClose={onClose}
    onClick={(event) => {
      if (event.target === event.currentTarget) onClose();
    }}
  >
    {children}
  </dialog>;
}
