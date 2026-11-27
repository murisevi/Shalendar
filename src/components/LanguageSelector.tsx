import { Globe } from 'lucide-react';
import type { Language } from '../../shared/types';
import { useI18n } from '../lib/i18n';

interface LanguageSelectorProps {
  variant?: 'pill' | 'rounded';
}

const LANGUAGES: Array<{ code: Language; label: string; fullName: string }> = [
  { code: 'es', label: 'ES', fullName: 'Español' },
  { code: 'en', label: 'EN', fullName: 'English' },
];

export function LanguageSelector({ variant = 'rounded' }: LanguageSelectorProps) {
  const { language, setLanguage, t } = useI18n();
  const outerRadius = variant === 'pill' ? 'rounded-full' : 'rounded-xl';
  const itemRadius = variant === 'pill' ? 'rounded-full' : 'rounded-lg';

  return (
    <div
      role="group"
      aria-label={t.common.languageSelectorLabel}
      className={`inline-flex h-9 items-center gap-0.5 border border-stone-200 dark:border-slate-700 bg-white dark:bg-slate-800/80 p-0.5 ${outerRadius}`}
    >
      <Globe className="ml-1.5 mr-0.5 hidden sm:block h-3.5 w-3.5 text-stone-400 dark:text-slate-400 shrink-0" />
      {LANGUAGES.map((item) => {
        const active = language === item.code;
        return (
          <button
            key={item.code}
            type="button"
            onClick={() => setLanguage(item.code)}
            aria-pressed={active}
            title={item.fullName}
            className={`px-2 py-1 text-[11px] font-bold tracking-wide transition cursor-pointer ${itemRadius} ${
              active
                ? 'bg-teal-600 text-white shadow-2xs'
                : 'text-stone-500 dark:text-slate-300 hover:text-stone-900 dark:hover:text-white hover:bg-stone-100 dark:hover:bg-slate-700/70'
            }`}
          >
            {item.label}
          </button>
        );
      })}
    </div>
  );
}
