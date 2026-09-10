'use client';
import Link from 'next/link';
import { ReactNode, useEffect, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth-context';
import { WorkspaceProvider, useWorkspace } from './workspace';
import { Badge, Button, Icon, Loading, Notice } from './primitives';
import { ScanDialog } from './scan-form';
const navigation = [['/', 'Overview', 'overview'], ['/scans', 'Scans', 'scans'], ['/findings', 'Findings', 'findings'], ['/reports', 'Reports', 'reports'], ['/accounts', 'AWS accounts', 'accounts'], ['/schedules', 'Schedules', 'schedules'], ['/settings', 'Settings', 'settings']];
export function Shell({ children }: { children: ReactNode }) {
  const { ready, token } = useAuth(); const router = useRouter();
  useEffect(() => { if (ready && !token) router.replace('/login'); }, [ready, token, router]);
  if (!ready || !token) return <Loading/>;
  return <WorkspaceProvider><Frame>{children}</Frame></WorkspaceProvider>;
}
function Frame({ children }: { children: ReactNode }) {
  const { email, signOut } = useAuth();
  const { system, connections, selectedConnection, setSelectedConnection, errors, refresh, tasks } = useWorkspace();
  const path = usePathname(); const [mobile, setMobile] = useState(false); const [scanning, setScanning] = useState(false);
  const title = navigation.find(([href]) => href === '/' ? path === '/' : path.startsWith(href))?.[1] || 'Report';
  const running = tasks.filter(t => t.status === 'running' || t.status === 'queued').length;
  useEffect(() => { setMobile(false); }, [path]);
  return <div className="app-shell"><a className="skip-link" href="#main-content">Skip to content</a>
    {mobile && <button className="sidebar-backdrop" aria-label="Close navigation" onClick={() => setMobile(false)}/>}
    <aside className={`sidebar ${mobile ? 'sidebar-open' : ''}`} aria-label="Main navigation">
      <Link className="brand" href="/"><span className="brand-mark"><Icon name="shield" size={24}/></span><span>cloud<span className="brand-light">sentinel</span><small>SECURITY OPERATIONS</small></span></Link>
      <div className="workspace-label"><span className="workspace-avatar">P</span><div>Personal workspace<small>Single-owner installation</small></div><span className="workspace-dot"/></div>
      <div className="nav-label">WORKSPACE</div><nav>{navigation.map(([href, label, icon]) => <Link key={href} href={href} aria-current={(href === '/' ? path === '/' : path.startsWith(href)) ? 'page' : undefined}><Icon name={icon}/><span>{label}</span>{href === '/scans' && running > 0 && <span className="nav-count">{running}</span>}</Link>)}</nav>
      <div className="sidebar-bottom"><div className="sidebar-system"><span className={`status-dot ${system?.status === 'ok' ? 'healthy' : ''}`}/><span>{system ? system.status === 'ok' ? 'All systems operational' : 'System needs attention' : 'Checking system status'}</span></div><Link href="/settings" className="owner-link"><span className="owner-avatar">{email?.slice(0, 1).toUpperCase() || 'O'}</span><span>Workspace owner<small>{email}</small></span><Icon name="settings" size={16}/></Link></div>
    </aside>
    <div className="main-frame"><header className="topbar"><div className="breadcrumb"><Button variant="ghost" className="mobile-toggle" aria-label="Open navigation" onClick={() => setMobile(true)}><Icon name="menu"/></Button><span className="muted">Workspace</span><span className="breadcrumb-divider">/</span><strong>{title}</strong></div><div className="topbar-actions"><label className="context-select"><span className="sr-only">Account context</span><Icon name="accounts"/><select value={selectedConnection} onChange={e => setSelectedConnection(e.target.value)}><option value="all">All accounts</option><option value="worker">Worker identity</option>{connections.map(c => <option key={c.id} value={c.id}>{c.label || c.role_arn.split(':')[4]}{c.active ? '' : ' (disconnected)'}</option>)}</select></label><Button variant="secondary" onClick={() => void refresh()} aria-label="Refresh workspace"><Icon name="refresh"/></Button><Button onClick={() => setScanning(true)}><Icon name="plus"/>New scan</Button></div></header>
    <main id="main-content" className="main-content">{errors.length > 0 && <Notice tone="error">Some workspace data could not be refreshed. {errors.join(' · ')} <button className="text-button" onClick={() => void refresh()}>Retry</button></Notice>}{children}</main>
    <footer className="app-footer"><span>CloudSentinel <span className="mono">/ {system?.version || '0.2.0'}</span></span><span>Read-only cloud assessment · <button className="text-button" onClick={() => signOut()}>Sign out</button></span></footer></div>
    {scanning && <ScanDialog onClose={() => setScanning(false)}/>}
  </div>;
}
export function StartScanButton() { const [open, setOpen] = useState(false); return <><Button onClick={() => setOpen(true)}><Icon name="plus"/>Start scan</Button>{open && <ScanDialog onClose={() => setOpen(false)}/>}</>; }
export function ScopeNotice() { const { selectedConnection } = useWorkspace(); return selectedConnection === 'all' ? null : <Notice>Account context filters reports and scan activity. Connections and schedules remain visible across your workspace.</Notice>; }
