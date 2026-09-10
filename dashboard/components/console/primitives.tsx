'use client';
import { ButtonHTMLAttributes, ReactNode, useEffect, useId, useRef } from 'react';

export function Icon({ name, size = 18 }: { name: string; size?: number }) {
  const paths: Record<string, ReactNode> = {
    overview: <><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/></>,
    scans: <><path d="M5 4h14v16H5zM9 8h6M9 12h3M9 16h6"/></>,
    findings: <><path d="m12 3 10 18H2L12 3Z M12 9v5"/><path d="M12 17h.01"/></>,
    reports: <><path d="M5 3h10l4 4v14H5zM14 3v5h5M9 12h6M9 16h6"/></>,
    accounts: <><path d="M6 17a5 5 0 0 1-1-10 7 7 0 0 1 13-1 5.5 5.5 0 0 1 0 11H6Z"/></>,
    schedules: <><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></>,
    settings: <><path d="M4 7h16M4 17h16"/><circle cx="9" cy="7" r="3"/><circle cx="15" cy="17" r="3"/></>,
    arrow: <path d="M5 12h14m-5-5 5 5-5 5"/>, plus: <path d="M12 5v14M5 12h14"/>,
    refresh: <><path d="M20 7v5h-5M4 17v-5h5"/><path d="M5 8a8 8 0 0 1 13-3l2 3M4 16l2 3a8 8 0 0 0 13-3"/></>,
    close: <path d="m6 6 12 12M6 18 18 6"/>, menu: <path d="M4 6h16M4 12h16M4 18h16"/>,
    shield: <><path d="m12 2 8 4v6c0 5-8 10-8 10S4 17 4 12V6l8-4Z"/><path d="m8 12 3 3 5-6"/></>,
    search: <><circle cx="10" cy="10" r="6"/><path d="m15 15 6 6"/></>,
  };
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.65" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name] || paths.shield}</svg>;
}
export function Button({ children, variant = 'primary', className = '', ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'secondary' | 'danger' | 'ghost' }) {
  return <button type="button" className={`button button-${variant} ${className}`} {...props}>{children}</button>;
}
const labels: Record<string, string> = { queued: 'Queued', running: 'Running', done: 'Completed', partial: 'Partial', error: 'Failed', critical: 'Critical', medium: 'Medium', low: 'Low', info: 'Info', good: 'Pass', UNKNOWN: 'Unknown', SKIPPED: 'Skipped', PASS: 'Pass', FAIL: 'Fail', ok: 'Healthy', unavailable: 'Unavailable', degraded: 'Degraded', active: 'Active', paused: 'Paused' };
export function Badge({ value }: { value: string }) { return <span className={`badge badge-${value.toLowerCase().replace(/[^a-z_]/g, '')}`}><span className="badge-dot"/>{labels[value] || value.replaceAll('_', ' ')}</span>; }
export function PageHeading({ eyebrow, title, description, action }: { eyebrow: string; title: string; description: string; action?: ReactNode }) {
  return <div className="page-heading"><div><div className="eyebrow">{eyebrow}</div><h1>{title}</h1><p>{description}</p></div>{action}</div>;
}
export function Panel({ title, action, children, className = '' }: { title?: string; action?: ReactNode; children: ReactNode; className?: string }) {
  return <section className={`panel ${className}`}>{title && <div className="panel-heading"><h2>{title}</h2>{action}</div>}{children}</section>;
}
export function EmptyState({ title, children, action }: { title: string; children: ReactNode; action?: ReactNode }) {
  return <div className="empty-state"><span className="empty-icon"><Icon name="scans" size={26}/></span><h3>{title}</h3><p>{children}</p>{action}</div>;
}
export function Notice({ children, tone = 'info' }: { children: ReactNode; tone?: 'info' | 'error' | 'warning' }) {
  return <div className={`notice notice-${tone}`} role={tone === 'error' ? 'alert' : 'status'}>{children}</div>;
}
export function Loading() { return <div className="loading-state" role="status"><span className="spinner"/>Loading workspace…</div>; }
export function Dialog({ title, children, onClose, wide = false }: { title: string; children: ReactNode; onClose: () => void; wide?: boolean }) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  useEffect(() => { const dialog = ref.current; dialog?.showModal(); return () => dialog?.close(); }, []);
  return <dialog ref={ref} className={`dialog ${wide ? 'dialog-wide' : ''}`} aria-labelledby={titleId} onCancel={e => { e.preventDefault(); onClose(); }} onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
    <div className="dialog-heading"><h2 id={titleId}>{title}</h2><Button variant="ghost" onClick={onClose} aria-label="Close dialog"><Icon name="close"/></Button></div>{children}
  </dialog>;
}
export function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  return <label className="field"><span>{label}</span>{children}{hint && <small>{hint}</small>}</label>;
}
export function Tabs({ items, value, onChange }: { items: string[]; value: string; onChange: (value: string) => void }) {
  return <div className="tabs" aria-label="View filters">{items.map(item => <button type="button" key={item} aria-pressed={value === item} className={value === item ? 'selected' : ''} onClick={() => onChange(item)}>{item}</button>)}</div>;
}
