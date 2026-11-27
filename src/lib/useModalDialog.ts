import { useEffect, useId, useRef } from 'react';

const focusable = 'button:not([disabled]), a[href], input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/** Shared keyboard/focus behavior without changing the existing modal layout. */
export function useModalDialog(open: boolean, onClose: () => void) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!open || !dialog) return;
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const background: Array<{ element: HTMLElement; inert: boolean }> = [];
    let node: HTMLElement = dialog;
    while (node.parentElement) {
      for (const sibling of node.parentElement.children) {
        if (sibling !== node && sibling instanceof HTMLElement) {
          background.push({ element: sibling, inert: sibling.inert });
          sibling.inert = true;
        }
      }
      node = node.parentElement;
      if (node === document.body) break;
    }
    const controls = () => Array.from(dialog.querySelectorAll<HTMLElement>(focusable)).filter((element) => {
      const style = getComputedStyle(element);
      return !element.closest('[hidden], [inert]') && style.display !== 'none' && style.visibility !== 'hidden';
    });
    const initial = dialog.querySelector<HTMLElement>('[data-autofocus]') ?? controls()[0] ?? dialog;
    initial.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        closeRef.current();
      } else if (event.key === 'Tab') {
        const elements = controls();
        const first = elements[0];
        const last = elements[elements.length - 1];
        if (!first) { event.preventDefault(); dialog.focus(); }
        else if (event.shiftKey && (document.activeElement === first || !dialog.contains(document.activeElement))) {
          event.preventDefault(); last.focus();
        } else if (!event.shiftKey && (document.activeElement === last || !dialog.contains(document.activeElement))) {
          event.preventDefault(); first.focus();
        }
      }
    };
    const onFocus = (event: FocusEvent) => {
      if (!dialog.contains(event.target as Node)) (controls()[0] ?? dialog).focus();
    };
    document.addEventListener('keydown', onKeyDown, true);
    document.addEventListener('focusin', onFocus);
    return () => {
      document.removeEventListener('keydown', onKeyDown, true);
      document.removeEventListener('focusin', onFocus);
      background.forEach(({ element, inert }) => { element.inert = inert; });
      document.body.style.overflow = previousOverflow;
      if (previousFocus?.isConnected) previousFocus.focus();
    };
  }, [open]);

  return { dialogRef, titleId };
}
