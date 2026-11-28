import { CalendarCheck, Vote } from 'lucide-react';
import { useI18n } from '../lib/i18n';

interface PlanIntroModalProps {
  open: boolean;
  planEmoji: string;
  onClose: () => void;
}

/** Tiny first-visit tutorial: 1) mark the days you can, 2) vote for a day. */
export function PlanIntroModal({ open, planEmoji, onClose }: PlanIntroModalProps) {
  const { t } = useI18n();
  if (!open) return null;

  const steps = [
    { icon: CalendarCheck, title: t.intro.step1Title, desc: t.intro.step1Desc },
    { icon: Vote, title: t.intro.step2Title, desc: t.intro.step2Desc },
  ];

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-stone-950/60 backdrop-blur-sm sm:p-4 animate-fade-in"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="plan-intro-title"
        onClick={(e) => e.stopPropagation()}
        className="relative w-full max-w-sm rounded-t-[28px] sm:rounded-3xl border border-stone-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-6 sm:p-7 pb-[max(1.5rem,env(safe-area-inset-bottom))] sm:pb-7 shadow-2xl space-y-5 animate-sheet-sm-pop"
      >
        <div className="text-center space-y-2">
          <span className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-teal-50 dark:bg-teal-950/60 text-3xl">
            {planEmoji}
          </span>
          <p className="text-[11px] font-bold uppercase tracking-wider text-teal-700 dark:text-teal-300">
            {t.intro.eyebrow}
          </p>
          <h2
            id="plan-intro-title"
            className="font-display text-xl font-extrabold tracking-tight text-stone-900 dark:text-white"
          >
            {t.intro.title}
          </h2>
        </div>

        <ol className="space-y-3">
          {steps.map((step, i) => {
            const Icon = step.icon;
            return (
              <li
                key={step.title}
                className="flex items-start gap-3 rounded-2xl border border-stone-200/80 dark:border-slate-800 bg-stone-50/70 dark:bg-slate-800/50 p-3.5"
              >
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-teal-600 text-sm font-extrabold text-white">
                  {i + 1}
                </span>
                <div className="min-w-0">
                  <p className="flex items-center gap-1.5 text-sm font-bold text-stone-900 dark:text-white">
                    <Icon className="h-4 w-4 text-teal-600 dark:text-teal-400 shrink-0" />
                    {step.title}
                  </p>
                  <p className="mt-0.5 text-xs leading-relaxed text-stone-600 dark:text-slate-300">
                    {step.desc}
                  </p>
                </div>
              </li>
            );
          })}
        </ol>

        <button
          type="button"
          autoFocus
          onClick={onClose}
          className="w-full rounded-xl bg-teal-600 hover:bg-teal-700 py-3 text-sm font-bold text-white shadow-sm transition cursor-pointer"
        >
          {t.intro.cta}
        </button>
      </div>
    </div>
  );
}
