import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { AlertTriangle, Check, CheckCircle2, ChevronRight, Copy, Info, Loader2, X, XCircle } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { copyToClipboard, cx } from '../lib/utils';
import { useApp, type ToastLevel } from '../state/AppState';

export function Logo({ size = 24 }: { size?: number }): React.JSX.Element {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" fill="none" aria-hidden>
      <defs>
        <linearGradient id="gitpp-mark" x1="6" y1="3" x2="26" y2="29" gradientUnits="userSpaceOnUse">
          <stop stopColor="#8EA7FF" />
          <stop offset="0.55" stopColor="#6D7CFF" />
          <stop offset="1" stopColor="#4FD1C5" />
        </linearGradient>
      </defs>
      <rect x="1" y="1" width="30" height="30" rx="8" fill="url(#gitpp-mark)" />
      <path d="M10 23V13.5C10 11.6 11.6 10 13.5 10H18" stroke="white" strokeWidth="2.1" strokeLinecap="round" />
      <circle cx="10" cy="24.5" r="2.2" fill="white" />
      <circle cx="19.5" cy="10" r="2.2" fill="white" />
      <path d="M22.2 17.2v7M18.7 20.7h7" stroke="white" strokeWidth="2.3" strokeLinecap="round" />
      <path d="M22.2 11.6v2.2M21.1 12.7h2.2" stroke="white" strokeWidth="1.4" strokeLinecap="round" opacity="0.85" />
    </svg>
  );
}

export function BrandWordmark(): React.JSX.Element {
  return (
    <span className="brand-name">
      Git<span>++</span>
    </span>
  );
}

export function EmptyState({
  icon: Icon,
  title,
  description,
  actions,
}: {
  icon: LucideIcon;
  title: string;
  description: React.ReactNode;
  actions?: React.ReactNode;
}): React.JSX.Element {
  return (
    <div className="empty-state">
      <div className="empty-icon"><Icon size={22} strokeWidth={1.8} /></div>
      <h2>{title}</h2>
      <p>{description}</p>
      {actions ? <div className="empty-actions">{actions}</div> : null}
    </div>
  );
}

export function Spinner({ large = false }: { large?: boolean }): React.JSX.Element {
  return <span className={cx('spinner', large && 'lg')} aria-label="Loading" />;
}

export function LoadingState({ label = 'Loading…' }: { label?: string }): React.JSX.Element {
  return (
    <div className="loading-state">
      <Spinner />
      <span>{label}</span>
    </div>
  );
}

export function Modal({
  title,
  description,
  children,
  footer,
  onClose,
  width = 'normal',
}: {
  title: string;
  description?: React.ReactNode;
  children: React.ReactNode;
  footer?: React.ReactNode;
  onClose: () => void;
  width?: 'normal' | 'wide' | 'narrow';
}): React.JSX.Element {
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        onClose();
      }
    };
    document.addEventListener('keydown', onKey);
    const previous = document.activeElement as HTMLElement | null;
    const firstField = panelRef.current?.querySelector<HTMLElement>('input, textarea, select, button');
    firstField?.focus();
    return () => {
      document.removeEventListener('keydown', onKey);
      previous?.focus?.();
    };
  }, [onClose]);

  return createPortal(
    <div className="overlay" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <div className={cx('modal', width === 'wide' && 'wide', width === 'narrow' && 'narrow')} role="dialog" aria-modal="true" aria-label={title} ref={panelRef}>
        <div className="modal-header">
          <div>
            <h3>{title}</h3>
            {description ? <p>{description}</p> : null}
          </div>
          <button className="modal-close" onClick={onClose} aria-label="Close"><X size={16} /></button>
        </div>
        <div className="modal-body">{children}</div>
        {footer ? <div className="modal-footer">{footer}</div> : null}
      </div>
    </div>,
    document.body,
  );
}

export function ConfirmDialog({
  title,
  description,
  confirmLabel,
  danger = false,
  onConfirm,
  onClose,
  busy = false,
  consequences,
  confirmPhrase,
  children,
}: {
  title: string;
  description: React.ReactNode;
  confirmLabel: string;
  danger?: boolean;
  onConfirm: () => void | Promise<void>;
  onClose: () => void;
  busy?: boolean;
  consequences?: string[];
  confirmPhrase?: string;
  children?: React.ReactNode;
}): React.JSX.Element {
  const [phrase, setPhrase] = useState('');
  const [working, setWorking] = useState(false);
  const disabled = busy || working || (confirmPhrase ? phrase.trim() !== confirmPhrase : false);

  return (
    <Modal
      title={title}
      description={description}
      onClose={onClose}
      width="narrow"
      footer={
        <>
          <button className="btn ghost" onClick={onClose} disabled={working}>Cancel</button>
          <button
            className={cx('btn', danger ? 'danger' : 'primary')}
            disabled={disabled}
            onClick={async () => {
              setWorking(true);
              try {
                await onConfirm();
              } finally {
                setWorking(false);
              }
            }}
          >
            {working || busy ? <Spinner /> : null}
            {confirmLabel}
          </button>
        </>
      }
    >
      {consequences && consequences.length > 0 ? (
        <div className="stack" style={{ gap: 8 }}>
          <span className="section-title" style={{ margin: 0 }}>What this will do</span>
          <div className="risk-list">
            {consequences.map((item) => (
              <div className="risk-item" key={item}>
                <ChevronRight size={13} />
                <span>{item}</span>
              </div>
            ))}
          </div>
        </div>
      ) : null}
      {children}
      {confirmPhrase ? (
        <div className="field">
          <label htmlFor="confirm-phrase">Type <span className="inline-code">{confirmPhrase}</span> to confirm</label>
          <input id="confirm-phrase" className="input" value={phrase} onChange={(event) => setPhrase(event.target.value)} autoComplete="off" spellCheck={false} />
        </div>
      ) : null}
    </Modal>
  );
}

export function CopyButton({ value, label = 'Copy', className }: { value: string; label?: string; className?: string }): React.JSX.Element {
  const [copied, setCopied] = useState(false);
  return (
    <button
      className={cx('btn ghost icon', className)}
      title={copied ? 'Copied' : label}
      aria-label={label}
      onClick={async () => {
        if (await copyToClipboard(value)) {
          setCopied(true);
          window.setTimeout(() => setCopied(false), 1200);
        }
      }}
    >
      {copied ? <Check size={13} /> : <Copy size={13} />}
    </button>
  );
}

export function Field({ label, help, children, htmlFor }: { label: string; help?: React.ReactNode; children: React.ReactNode; htmlFor?: string }): React.JSX.Element {
  return (
    <div className="field">
      <label htmlFor={htmlFor}>{label}</label>
      {children}
      {help ? <span className="help">{help}</span> : null}
    </div>
  );
}

export function Segmented<T extends string>({ value, options, onChange }: { value: T; options: Array<{ value: T; label: string }>; onChange: (value: T) => void }): React.JSX.Element {
  return (
    <div className="segmented" role="group">
      {options.map((option) => (
        <button key={option.value} type="button" className={cx(value === option.value && 'active')} onClick={() => onChange(option.value)}>
          {option.label}
        </button>
      ))}
    </div>
  );
}

const TOAST_ICON: Record<ToastLevel, LucideIcon> = {
  success: CheckCircle2,
  error: XCircle,
  warning: AlertTriangle,
  info: Info,
};

export function Toasts(): React.JSX.Element {
  const { toasts, dismissToast } = useApp();
  return (
    <div className="toast-stack" aria-live="polite">
      {toasts.map((toast) => {
        const Icon = TOAST_ICON[toast.level];
        return (
          <div className={cx('toast', toast.level)} key={toast.id} role={toast.level === 'error' ? 'alert' : 'status'}>
            <Icon className="toast-icon" size={16} />
            <div className="toast-body">
              <div className="toast-title">{toast.title}</div>
              {toast.detail ? <div className="toast-detail">{toast.detail}</div> : null}
            </div>
            {toast.detail ? <CopyButton value={`${toast.title}\n${toast.detail}`} label="Copy error details" /> : null}
            <button className="toast-close" onClick={() => dismissToast(toast.id)} aria-label="Dismiss"><X size={13} /></button>
          </div>
        );
      })}
    </div>
  );
}

export function BusyBar(): React.JSX.Element | null {
  const { busyLabel } = useApp();
  if (!busyLabel) return null;
  return (
    <div className="op-row" style={{ marginBottom: 'var(--space-3)' }} role="status">
      <Loader2 size={14} className="spinner" style={{ animation: 'spin 0.9s linear infinite', border: 'none', width: 14, height: 14 }} />
      <span className="op-label">{busyLabel}</span>
      <div className="spacer" />
      <div className="op-progress" style={{ width: 90 }}><div /></div>
    </div>
  );
}

void CheckCircle2;
