'use client';
import { FormEvent, useState } from 'react';
import { deleteAccount } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import { useWorkspace } from './workspace';
import { Badge, Button, Dialog, Field, Loading, Notice, PageHeading, Panel } from './primitives';
export default function Settings() {
  const { system, loading } = useWorkspace(); const { email, token, signOut } = useAuth();
  const [deleting, setDeleting] = useState(false); const [password, setPassword] = useState(''); const [error, setError] = useState(''); const [busy, setBusy] = useState(false);
  if (loading) return <Loading/>;
  async function remove(event: FormEvent) { event.preventDefault(); setBusy(true); setError(''); try { await deleteAccount(token!, password); signOut(); } catch (err) { setError(err instanceof Error ? err.message : 'Unable to delete account'); } finally { setBusy(false); } }
  return <><PageHeading eyebrow="WORKSPACE CONFIGURATION" title="Settings" description="Application configuration, operational status, and owner access."/>
    <div className="settings-grid"><Panel title="Owner and access"><dl className="settings-list"><div><dt>Owner email</dt><dd>{email}</dd></div><div><dt>Access model</dt><dd>Single user · database-enforced</dd></div><div><dt>Session lifetime</dt><dd>1 hour</dd></div><div><dt>Cloud access</dt><dd>Read-only configuration inspection</dd></div></dl></Panel>
    <Panel title="Runtime configuration"><dl className="settings-list"><div><dt>Default AWS region</dt><dd className="mono">{system?.region || 'Unavailable'}</dd></div><div><dt>Retry limit</dt><dd>{system?.retry_limit ?? '—'} retries with backoff</dd></div><div><dt>Schedule polling</dt><dd>{system?.scheduler_poll_seconds ?? '—'} seconds</dd></div><div><dt>Floci environment</dt><dd>{system?.floci_configured ? 'Configured' : 'Not configured'}</dd></div></dl></Panel>
    <Panel title="Optional AI insights"><div className="panel-body"><Badge value={system?.ai_configured ? 'active' : 'paused'}/><h3>{system?.ai_configured ? 'Gemini insights enabled' : 'Scanner evidence works independently'}</h3><p className="muted">{system?.ai_configured ? 'Generate insights from a report. The report is sent to Gemini only when you request it.' : 'Configure GEMINI_API_KEY on the gateway to enable optional report interpretation. No API key is sent to the browser.'}</p></div></Panel>
    <Panel title="System health"><dl className="settings-list">{Object.entries(system?.checks || {}).map(([name, state]) => <div key={name}><dt>{name}</dt><dd><Badge value={state}/></dd></div>)}<div><dt>Gateway uptime</dt><dd>{system ? `${Math.floor(system.uptime / 60)} minutes` : 'Unavailable'}</dd></div></dl></Panel></div>
    <Notice>Runtime settings are managed in the deployment environment. Restart the relevant service after configuration changes. Credentials and secret values are never returned by this page.</Notice>
    <Panel title="Delete owner account" className="danger-panel"><div className="panel-body danger-content"><div><h3>Permanently remove this workspace’s data</h3><p className="muted">Deletes your owner account, connections, schedules, tasks, and reports. This does not delete AWS resources.</p></div><Button variant="danger" onClick={() => setDeleting(true)}>Delete account</Button></div></Panel>
    {deleting && <Dialog title="Permanently delete account" onClose={() => setDeleting(false)}><form onSubmit={remove} className="dialog-body form-stack"><Notice tone="warning">This cannot be undone. Export any reports you want to keep before continuing.</Notice><Field label="Confirm your password"><input type="password" autoComplete="current-password" required value={password} onChange={e => setPassword(e.target.value)}/></Field>{error && <Notice tone="error">{error}</Notice>}<div className="dialog-actions"><Button variant="secondary" onClick={() => setDeleting(false)}>Keep account</Button><Button variant="danger" type="submit" disabled={busy}>{busy ? 'Deleting…' : 'Delete permanently'}</Button></div></form></Dialog>}
  </>;
}
