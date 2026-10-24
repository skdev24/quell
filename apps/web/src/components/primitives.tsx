import clsx from 'clsx';
import type { ModAction } from '@quell/shared';
import { ACTION_LABEL, ACTION_TONE, authorHue } from '@/lib/verdict';

export function Avatar({ name, size = 26 }: { name: string; size?: number }) {
  const hue = authorHue(name);
  return (
    <span
      aria-hidden
      className="grid shrink-0 place-items-center rounded-full text-[11px] font-semibold"
      style={{
        width: size,
        height: size,
        color: `hsl(${hue} 60% 85%)`,
        background: `hsl(${hue} 35% 28%)`,
      }}
    >
      {name.replace(/[^a-z0-9]/gi, '').charAt(0).toUpperCase() || '·'}
    </span>
  );
}

export function VerdictPill({ action, muted }: { action: ModAction; muted?: boolean }) {
  const tone = ACTION_TONE[action];
  return (
    <span
      className={clsx(
        'inline-flex h-5 items-center gap-1.5 rounded-full px-2 text-[11px] font-semibold',
        tone.text,
        tone.soft,
        muted && 'opacity-60',
      )}
    >
      <span className={clsx('size-1.5 rounded-full', tone.dot)} />
      {ACTION_LABEL[action]}
    </span>
  );
}

/** A Mod View widget: flat panel, small bold uppercase title bar. */
export function Panel({
  title,
  icon,
  meta,
  children,
  className,
}: {
  title: string;
  icon?: React.ReactNode;
  meta?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section className={clsx('flex min-h-0 flex-col overflow-hidden rounded-tw-lg bg-panel', className)}>
      <header className="flex h-10 shrink-0 items-center justify-between border-b border-line px-3">
        <h2 className="label flex items-center gap-2 whitespace-nowrap text-fg">
          {icon}
          {title}
        </h2>
        <div className="flex items-center gap-2 text-[12px] text-dim">{meta}</div>
      </header>
      <div className="min-h-0 flex-1">{children}</div>
    </section>
  );
}

export function Button({
  children,
  onClick,
  variant = 'secondary',
  active,
  disabled,
  pill,
  className,
  title,
}: {
  children: React.ReactNode;
  onClick?: () => void;
  variant?: 'primary' | 'secondary' | 'ghost';
  active?: boolean;
  disabled?: boolean;
  pill?: boolean;
  className?: string;
  title?: string;
}) {
  return (
    <button
      type="button"
      title={title}
      disabled={disabled}
      onClick={onClick}
      className={clsx(
        'inline-flex h-[30px] shrink-0 items-center gap-1.5 whitespace-nowrap px-2.5 text-[13px] font-semibold transition-colors duration-100',
        pill ? 'rounded-full px-3' : 'rounded-tw',
        'disabled:pointer-events-none disabled:opacity-40',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-purple-soft/60',
        variant === 'primary' && 'bg-purple text-white hover:bg-purple-hover',
        variant === 'secondary' && 'bg-white/[0.08] text-fg hover:bg-white/[0.13]',
        variant === 'ghost' && 'text-dim hover:bg-white/[0.08] hover:text-fg',
        active && 'bg-white/[0.13] text-fg',
        className,
      )}
    >
      {children}
    </button>
  );
}

/**
 * Twitch-style tooltip: a small light label above the control, shown on hover
 * after a short delay and straight away on keyboard focus.
 */
export function Tip({
  label,
  align = 'center',
  className,
  children,
}: {
  label: string;
  className?: string;
  /** 'end' keeps a tooltip on the last control of a row inside its panel. */
  align?: 'center' | 'end';
  children: React.ReactNode;
}) {
  return (
    <span className={clsx('group/tip relative inline-flex', className)}>
      {children}
      <span
        role="tooltip"
        className={clsx(
          'pointer-events-none absolute bottom-full z-30 mb-2 whitespace-nowrap',
          align === 'center' ? 'left-1/2 -translate-x-1/2' : 'right-0',
          'rounded-[4px] bg-fg px-2 py-[3px] text-[12px] font-semibold text-bg opacity-0 shadow-lg shadow-black/40 transition-opacity duration-100 group-focus-within/tip:opacity-100 group-hover/tip:opacity-100 group-hover/tip:delay-200',
        )}
      >
        {label}
        <span
          className={clsx(
            'absolute top-full border-4 border-transparent border-t-fg',
            align === 'center' ? 'left-1/2 -translate-x-1/2' : 'right-[10px]',
          )}
        />
      </span>
    </span>
  );
}
