'use client';
import { createContext, ReactNode, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { useAuth } from '@/lib/auth-context';
import { AwsConnection, getAwsConnections, getReports, getSchedules, getSystem, getTasks, ReportRow, Schedule, SystemStatus, Task } from '@/lib/api';
type Data = { reports: ReportRow[]; tasks: Task[]; schedules: Schedule[]; connections: AwsConnection[]; system: SystemStatus | null };
type Workspace = Data & { loading: boolean; errors: string[]; refresh: () => Promise<void>; selectedConnection: string; setSelectedConnection: (id: string) => void };
const Context = createContext<Workspace | null>(null);
export function WorkspaceProvider({ children }: { children: ReactNode }) {
  const { token } = useAuth();
  const [data, setData] = useState<Data>({ reports: [], tasks: [], schedules: [], connections: [], system: null });
  const [loading, setLoading] = useState(true);
  const [errors, setErrors] = useState<string[]>([]);
  const [selectedConnection, select] = useState('all');
  const busy = useRef(false);
  const tokenRef = useRef(token);
  tokenRef.current = token;
  useEffect(() => { select(localStorage.getItem('sentinel:connection') || 'all'); }, []);
  const setSelectedConnection = (id: string) => { select(id); localStorage.setItem('sentinel:connection', id); };
  const refresh = useCallback(async () => {
    if (!token || busy.current) return;
    busy.current = true;
    try {
      const results = await Promise.allSettled([getReports(token), getTasks(token), getSchedules(token), getAwsConnections(token), getSystem(token)]);
      if (token !== tokenRef.current) return;
      const [reports, tasks, schedules, connections, system] = results;
      setData(old => ({ reports: reports.status === 'fulfilled' ? reports.value.reports : old.reports,
        tasks: tasks.status === 'fulfilled' ? tasks.value.tasks : old.tasks,
        schedules: schedules.status === 'fulfilled' ? schedules.value.schedules : old.schedules,
        connections: connections.status === 'fulfilled' ? connections.value.connections : old.connections,
        system: system.status === 'fulfilled' ? system.value : old.system }));
      setErrors(results.flatMap((result, i) => result.status === 'rejected' ? [`${['Reports', 'Scans', 'Schedules', 'Connections', 'System'][i]}: ${result.reason instanceof Error ? result.reason.message : 'Unavailable'}`] : []));
    } finally { busy.current = false; setLoading(false); }
  }, [token]);
  useEffect(() => {
    void refresh();
    const interval = setInterval(() => { if (document.visibilityState === 'visible') void refresh(); }, 10000);
    const focus = () => { void refresh(); };
    window.addEventListener('focus', focus);
    return () => { clearInterval(interval); window.removeEventListener('focus', focus); };
  }, [refresh]);
  return <Context.Provider value={{ ...data, loading, errors, refresh, selectedConnection, setSelectedConnection }}>{children}</Context.Provider>;
}
export function useWorkspace() { const value = useContext(Context); if (!value) throw new Error('Workspace provider missing'); return value; }
