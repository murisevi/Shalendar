import type { Participant } from '../../shared/types';
import { useI18n } from '../lib/i18n';

interface AvatarProps {
  participant: Pick<Participant, 'name' | 'avatarColor' | 'avatarEmoji'>;
  size?: 'xs' | 'sm' | 'md' | 'lg';
  ring?: boolean;
  online?: boolean;
  required?: boolean;
  className?: string;
}

const SIZE_CLASSES = {
  xs: 'h-5 w-5 text-[10px]',
  sm: 'h-7 w-7 text-xs',
  md: 'h-9 w-9 text-sm',
  lg: 'h-11 w-11 text-base',
};

export function Avatar({
  participant,
  size = 'sm',
  ring = false,
  online = false,
  required = false,
  className = '',
}: AvatarProps) {
  const { t } = useI18n();

  return (
    <span className={`relative inline-flex shrink-0 ${className}`}>
      <span
        title={`${participant.name}${online ? t.avatar.onlineSuffix : ''}${required ? t.avatar.requiredSuffix : ''}`}
        style={{ backgroundColor: participant.avatarColor }}
        className={`inline-flex shrink-0 items-center justify-center rounded-full font-semibold text-white shadow-xs select-none ${
          SIZE_CLASSES[size]
        } ${ring ? 'ring-2 ring-white dark:ring-slate-900' : ''}`}
      >
        <span className="leading-none">
          {participant.avatarEmoji || participant.name.charAt(0).toUpperCase()}
        </span>
      </span>
      {online && (
        <span
          aria-label={t.avatar.onlineAria}
          className="absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full bg-emerald-500 ring-2 ring-white dark:ring-slate-900"
        />
      )}
      {required && !online && (
        <span
          aria-label={t.avatar.requiredAria}
          className="absolute -top-1 -right-1 flex h-3.5 w-3.5 items-center justify-center rounded-full bg-amber-400 text-[8px] font-black text-amber-950 ring-1 ring-white dark:ring-slate-900"
        >
          ★
        </span>
      )}
    </span>
  );
}

interface AvatarStackProps {
  participants: Participant[];
  onlineIds?: Set<string>;
  max?: number;
  size?: 'xs' | 'sm' | 'md';
}

export function AvatarStack({
  participants,
  onlineIds,
  max = 5,
  size = 'sm',
}: AvatarStackProps) {
  const shown = participants.slice(0, max);
  const rest = participants.length - shown.length;

  return (
    <div className="flex items-center -space-x-2">
      {shown.map((p) => (
        <Avatar
          key={p.id}
          participant={p}
          size={size}
          ring
          online={onlineIds?.has(p.id) ?? false}
        />
      ))}
      {rest > 0 && (
        <span
          className={`inline-flex items-center justify-center rounded-full bg-stone-200 dark:bg-slate-700 font-semibold text-stone-700 dark:text-slate-200 ring-2 ring-white dark:ring-slate-900 ${SIZE_CLASSES[size]}`}
        >
          +{rest}
        </span>
      )}
    </div>
  );
}
