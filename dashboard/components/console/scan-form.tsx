'use client';
import { FormEvent, useState } from 'react';
import { useRouter } from 'next/navigation';
import { queueAudit, ScanInput } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import { useWorkspace } from './workspace';
import { accountName } from '@/lib/presentation';
import { Button, Dialog, Field, Notice } from './primitives';
export function ScopeFields({ value, onChange }: { value: ScanInput; onChange: (input: ScanInput) => void }) {
  const { connections, system } = useWorkspace();
  return <>
    <div className="form-grid"><Field label="Scan environment"><select value={value.mode} onChange={e => onChange({ ...value, mode: e.target.value as 'aws' | 'floci', connection_id: null })}><option value="aws">AWS cloud</option>{system?.floci_configured && <option value="floci">Floci · local emulator</option>}</select></Field>
    <Field label="AWS connection"><select value={value.connection_id ?? ''} disabled={value.mode === 'floci'} onChange={e => {
      const connection = connections.find(c => c.id === Number(e.target.value));
      onChange({ ...value, connection_id: e.target.value ? Number(e.target.value) : null, region: connection?.region || value.region });
    }}><option value="">Worker identity · configured on server</option>{connections.filter(c => c.active).map(c => <option key={c.id} value={c.id}>{accountName(c.id, connections)} · {c.role_arn.split(':')[4]}</option>)}</select></Field></div>
    <Field label="AWS region" hint="EC2, RDS and Lambda are regional. IAM is account-wide; S3 covers all buckets and records their actual regions."><input required pattern="[a-z]{2}(-[a-z]+)+-[0-9]+" value={value.region} onChange={e => onChange({ ...value, region: e.target.value })} placeholder="us-east-1"/></Field>
    <fieldset className="service-selector"><legend>Services to assess</legend>{['s3', 'ec2', 'iam', 'rds', 'lambda'].map(service => <label key={service}><input type="checkbox" checked={value.services.includes(service)} onChange={e => onChange({ ...value, services: e.target.checked ? [...value.services, service] : value.services.filter(s => s !== service) })}/><span>{service.toUpperCase()}</span></label>)}</fieldset>
  </>;
}
export function useDefaultScope(): ScanInput {
  const { system, selectedConnection, connections } = useWorkspace();
  const connection = connections.find(c => String(c.id) === selectedConnection && c.active);
  return { mode: 'aws', connection_id: connection?.id ?? null, region: connection?.region || system?.region || 'us-east-1', services: ['s3', 'ec2', 'iam', 'rds', 'lambda'] };
}
export function ScanDialog({ onClose }: { onClose: () => void }) {
  const initial = useDefaultScope();
  const [input, setInput] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const { token } = useAuth();
  const { refresh, connections } = useWorkspace();
  const router = useRouter();
  async function submit(event: FormEvent) {
    event.preventDefault(); if (!token) return;
    setBusy(true); setError('');
    try { await queueAudit(token, input); await refresh(); router.push('/scans'); onClose(); }
    catch (err) { setError(err instanceof Error ? err.message : 'Unable to start scan'); }
    finally { setBusy(false); }
  }
  return <Dialog title="Start a security scan" onClose={onClose}><form onSubmit={submit} className="dialog-body form-stack">
    <p className="muted">Run read-only configuration checks against a clearly defined account and scope.</p>
    <ScopeFields value={input} onChange={setInput}/>
    <div className="scan-confirmation"><span className="eyebrow">Selected target</span><strong>{input.mode === 'floci' ? 'Floci emulator' : accountName(input.connection_id, connections)}</strong><span className="mono">{input.region} / {input.services.length} services</span></div>
    {error && <Notice tone="error">{error}</Notice>}
    <div className="dialog-actions"><Button variant="secondary" onClick={onClose} disabled={busy}>Cancel</Button><Button type="submit" disabled={busy || !input.services.length}>{busy ? 'Submitting…' : 'Start scan'}</Button></div>
  </form></Dialog>;
}
