'use client';
import Link from 'next/link';
import { useState } from 'react';
import { useAuth } from '@/lib/auth-context';
import { apiRequest, DeadLetterTask, dismissDeadLetterTask } from '@/lib/api';
import { accountName, formatDate, shortId } from '@/lib/presentation';
import { Badge, Button, EmptyState, Loading, Notice, PageHeading, Panel, Tabs } from './primitives';
import { useScopedData } from './overview';
import { StartScanButton } from './shell';
export default function Scans() {
  const { tasks, connections, loading } = useScopedData(); const { token } = useAuth();
  const [tab, setTab] = useState('All scans'); const [dead, setDead] = useState<DeadLetterTask[] | null>(null); const [error, setError] = useState('');
  if (loading) return <Loading/>;
  const shown = tasks.filter(t => tab === 'All scans' || tab === 'In progress' && ['queued', 'running'].includes(t.status) || tab === 'Completed' && ['done', 'partial'].includes(t.status) || tab === 'Failed' && t.status === 'error');
  async function inspect() { if (!token) return; try { const result = await apiRequest<{ tasks: DeadLetterTask[] }>('/api/dead-letter', {}, token); setDead(result.tasks); } catch (err) { setError(String(err)); } }
  return <><PageHeading eyebrow="EXECUTION" title="Scans" description="Every assessment, from durable queue to completed evidence." action={<StartScanButton/>}/>
    <Notice>Scans continue in the worker when you leave this page. Status refreshes every 10 seconds. Progress describes the current stage, not an estimated completion percentage.</Notice>
    {error && <Notice tone="error">{error}</Notice>}<Tabs items={['All scans', 'In progress', 'Completed', 'Failed']} value={tab} onChange={setTab}/>
    <Panel>{shown.length ? <div className="table-scroll"><table><thead><tr><th>Scan / scope</th><th>Connection</th><th>Status</th><th>Progress</th><th>Requested</th><th/></tr></thead><tbody>{shown.map(task => <tr key={task.task_id}><td><strong className="mono">{shortId(task.task_id)}</strong><small>{task.mode.toUpperCase()} · {task.payload.region || 'Not recorded'}</small><small>{task.payload.services?.join(', ')}</small></td><td>{accountName(task.connection_id, connections)}</td><td><Badge value={task.status}/></td><td className="progress-cell">{task.status === 'running' && <span className="spinner small-spinner"/>}{task.progress}<small>{task.error || `${task.attempts} attempt${task.attempts === 1 ? '' : 's'}`}</small></td><td>{formatDate(task.created_at)}<small>Updated {formatDate(task.updated_at)}</small></td><td>{task.report_id && <Link className="inline-link" href={`/reports/${task.report_id}`}>View report →</Link>}</td></tr>)}</tbody></table></div> : <EmptyState title="No scans in this view">Start an assessment or choose another status filter.</EmptyState>}</Panel>
    <Panel title="Failed task review" action={<Button variant="secondary" onClick={() => void inspect()}>Load failures</Button>}><div className="panel-body"><p className="muted">Tasks that exhaust retries stay available for inspection. Dismissing an alert preserves its scan history.</p>{dead && (dead.length ? dead.map(task => <div className="failure-row" key={task.task_id}><div><strong className="mono">{shortId(task.task_id)}</strong><p>{task.final_error}</p></div><Button variant="secondary" onClick={async () => { try { await dismissDeadLetterTask(token!, task.task_id); setDead(dead.filter(t => t.task_id !== task.task_id)); } catch (err) { setError(String(err)); } }}>Dismiss alert</Button></div>) : <p>No undismissed failures.</p>)}</div></Panel>
  </>;
}
