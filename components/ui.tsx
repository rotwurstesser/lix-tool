// Shared class names and small parts, so every screen uses the same theme tokens.

export const card = 'bg-surface rounded-xl shadow-card border border-line';
export const focusRing =
  'focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-surface';
export const primary = `px-5 py-2.5 bg-accent hover:bg-accent-hover text-on-accent font-medium rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${focusRing}`;
export const secondary = `px-5 py-2.5 bg-surface-2 hover:bg-line text-fg border border-line rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${focusRing}`;
export const danger = `px-5 py-2.5 bg-danger-strong hover:opacity-90 text-white font-medium rounded-lg transition-opacity ${focusRing}`;

export function Spinner({ className = 'w-5 h-5' }: { className?: string }) {
  return (
    <svg className={`${className} animate-spin text-accent shrink-0`} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="12" cy="12" r="10" stroke="currentColor" strokeOpacity="0.25" strokeWidth="3" />
      <path d="M22 12a10 10 0 0 0-10-10" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}

export function ProgressBar({ percent }: { percent: number }) {
  return (
    <div
      className="h-3 w-full bg-surface-2 border border-line rounded-full overflow-hidden"
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(percent)}
    >
      <div className="h-full bg-accent transition-[width] duration-500" style={{ width: `${percent}%` }} />
    </div>
  );
}
