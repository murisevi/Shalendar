import { useEffect, useRef, useState, type ReactNode } from 'react';
import { X } from 'lucide-react';
import { useI18n } from '../lib/i18n';

interface BottomSheetProps {
  open: boolean;
  onClose: () => void;
  children: ReactNode;
  title?: ReactNode;
  /** Accessible label when no visible title is rendered. */
  ariaLabel?: string;
  className?: string;
}

const DISMISS_THRESHOLD_PX = 90;

/**
 * Mobile bottom sheet: slides up from the bottom, can be dismissed by tapping
 * the backdrop, pressing Escape or dragging the grab handle down.
 */
export function BottomSheet({ open, onClose, children, title, ariaLabel, className = '' }: BottomSheetProps) {
  const { t } = useI18n();
  const [dragOffset, setDragOffset] = useState(0);
  const dragStartRef = useRef<number | null>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (!open) return;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCloseRef.current();
    };
    window.addEventListener('keydown', onKey);
    return () => {
      document.body.style.overflow = prevOverflow;
      window.removeEventListener('keydown', onKey);
    };
  }, [open]);

  useEffect(() => {
    if (!open) setDragOffset(0);
  }, [open]);

  if (!open) return null;

  function handlePointerDown(e: React.PointerEvent<HTMLDivElement>) {
    dragStartRef.current = e.clientY;
    e.currentTarget.setPointerCapture(e.pointerId);
  }

  function handlePointerMove(e: React.PointerEvent<HTMLDivElement>) {
    if (dragStartRef.current === null) return;
    setDragOffset(Math.max(0, e.clientY - dragStartRef.current));
  }

  function handlePointerUp() {
    if (dragStartRef.current === null) return;
    dragStartRef.current = null;
    if (dragOffset > DISMISS_THRESHOLD_PX) {
      onClose();
    }
    setDragOffset(0);
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-stone-950/45 backdrop-blur-[2px] animate-fade-in"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={ariaLabel}
        onClick={(e) => e.stopPropagation()}
        style={dragOffset > 0 ? { transform: `translateY(${dragOffset}px)`, transition: 'none' } : undefined}
        className={`relative flex w-full max-w-lg max-h-[88dvh] flex-col rounded-t-[28px] border-t border-stone-200/80 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-2xl animate-sheet transition-transform duration-200 ${className}`}
      >
        {/* Grab handle (drag down to dismiss) */}
        <div
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerCancel={handlePointerUp}
          className="flex shrink-0 cursor-grab touch-none justify-center pt-2.5 pb-1.5"
        >
          <span className="h-1.5 w-10 rounded-full bg-stone-300 dark:bg-slate-700" />
        </div>

        {title !== undefined && (
          <div className="flex shrink-0 items-center justify-between gap-3 px-5 pb-2">
            <div className="min-w-0 flex-1">{title}</div>
            <button
              type="button"
              onClick={onClose}
              aria-label={t.common.close}
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-stone-100 dark:bg-slate-800 text-stone-500 dark:text-slate-400 cursor-pointer"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        )}

        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 pb-[max(1.25rem,env(safe-area-inset-bottom))]">
          {children}
        </div>
      </div>
    </div>
  );
}
