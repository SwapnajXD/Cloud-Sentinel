'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { Terminal } from 'xterm';
import { WebLinksAddon } from 'xterm-addon-web-links';
import { fetchJson } from '@/lib/api';

interface EC2Instance {
  id: string;
  name: string;
  state: string;
  type: string;
  publicIp?: string;
  launchTime?: string;
}

interface TerminalShellProps {
  token: string;
}

export function TerminalShell({ token }: TerminalShellProps) {
  const [instances, setInstances] = useState<EC2Instance[]>([]);
  const [selectedInstance, setSelectedInstance] = useState<string>('');
  const [loading, setLoading] = useState(true);
  const [sessionActive, setSessionActive] = useState(false);
  const [command, setCommand] = useState('');
  const [output, setOutput] = useState('');
  const [mode, setMode] = useState<'list' | 'terminal' | 'exec'>('list');
  const terminalRef = useRef<HTMLDivElement>(null);
  const terminalInstanceRef = useRef<Terminal | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Fetch EC2 instances
  useEffect(() => {
    const fetchInstances = async () => {
      try {
        const data = await fetchJson<{ instances?: EC2Instance[] }>('/api/terminal/instances', {
          headers: { Authorization: `Bearer ${token}` }
        });
        const fetchedInstances = data.instances || [];
        setInstances(fetchedInstances);
        if (fetchedInstances.length > 0) {
          setSelectedInstance(fetchedInstances[0].id);
        }
      } catch (err) {
        console.error('Failed to fetch instances', err);
        setOutput('Error: Failed to fetch instances');
      } finally {
        setLoading(false);
      }
    };

    fetchInstances();
  }, [token]);

  // Initialize terminal
  useEffect(() => {
    if (mode === 'terminal' && terminalRef.current && !terminalInstanceRef.current) {
      const term = new Terminal({
        rows: 20,
        cols: 100,
        fontFamily: 'Monaco, Courier New, monospace',
        fontSize: 12
      });

      const webLinksAddon = new WebLinksAddon();
      term.loadAddon(webLinksAddon);
      term.open(terminalRef.current);
      term.writeln('🔌 AWS Systems Manager Session');
      term.writeln(`Instance: ${selectedInstance}`);
      term.writeln('Type "help" for available commands\r\n');

      terminalInstanceRef.current = term;
    }

    return () => {
      if (mode !== 'terminal' && terminalInstanceRef.current) {
        terminalInstanceRef.current.dispose();
        terminalInstanceRef.current = null;
      }
    };
  }, [mode, selectedInstance]);

  // Start SSM session
  const startSession = async () => {
    if (!selectedInstance) {
      setOutput('Error: Please select an instance');
      return;
    }

    try {
      setMode('terminal');
      setSessionActive(true);
    } catch (err) {
      setOutput('Error: Failed to start session');
      console.error(err);
    }
  };

  // Execute AWS CLI command
  const executeCommand = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!command.trim()) return;

    try {
      const res = await fetch('/api/terminal/exec', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({ command })
      });

      const text = await res.text();
      const data = text.trim() ? JSON.parse(text) : {};
      if (res.ok) {
        setOutput(data.output || 'Command executed successfully');
      } else {
        setOutput(`Error: ${data.error}`);
      }
    } catch (err) {
      setOutput(`Error: ${err instanceof Error ? err.message : 'Unknown error'}`);
    } finally {
      setCommand('');
      inputRef.current?.focus();
    }
  };

  if (loading) {
    return <div style={{ padding: '1rem' }}>Loading instances...</div>;
  }

  return (
    <div className="terminal-shell">
      <style>{`
        .terminal-shell {
          border: 4px solid #000;
          background: #fff;
          padding: 1rem;
          margin-bottom: 2rem;
        }
        .terminal-shell h3 {
          margin-top: 0;
          font-weight: 900;
          letter-spacing: 2px;
        }
        .terminal-controls {
          display: flex;
          gap: 0.5rem;
          margin-bottom: 1rem;
          flex-wrap: wrap;
        }
        .terminal-controls select,
        .terminal-controls button,
        .terminal-controls input {
          padding: 0.5rem;
          border: 2px solid #000;
          background: #fff;
          font-weight: 600;
          cursor: pointer;
          font-size: 0.9rem;
        }
        .terminal-controls button:hover {
          background: #000;
          color: #fff;
        }
        .terminal-controls button.active {
          background: #000;
          color: #fff;
        }
        .terminal-mode-buttons {
          display: flex;
          gap: 0.5rem;
        }
        .terminal-mode-buttons button {
          flex: 1;
          padding: 0.5rem;
        }
        .terminal-output {
          background: #1e1e1e;
          color: #d4d4d4;
          padding: 1rem;
          border: 2px solid #000;
          min-height: 300px;
          max-height: 500px;
          overflow-y: auto;
          margin-bottom: 1rem;
          font-family: 'Monaco', 'Courier New', monospace;
          font-size: 12px;
          line-height: 1.5;
          white-space: pre-wrap;
          word-break: break-word;
        }
        .terminal-input-group {
          display: flex;
          gap: 0.5rem;
          margin-bottom: 1rem;
        }
        .terminal-input-group input {
          flex: 1;
          padding: 0.5rem;
          border: 2px solid #000;
          font-family: 'Monaco', 'Courier New', monospace;
        }
        .terminal-input-group button {
          padding: 0.5rem 1rem;
          border: 2px solid #000;
          background: #fff;
          font-weight: 600;
          cursor: pointer;
        }
        .terminal-input-group button:hover {
          background: #000;
          color: #fff;
        }
        .instance-list {
          margin-top: 1rem;
          max-height: 200px;
          overflow-y: auto;
          border: 2px solid #000;
          padding: 0.5rem;
        }
        .instance-item {
          padding: 0.5rem;
          border-bottom: 1px solid #ddd;
          font-size: 0.9rem;
          cursor: pointer;
        }
        .instance-item:hover {
          background: #f0f0f0;
        }
        .instance-item.selected {
          background: #000;
          color: #fff;
          font-weight: 600;
        }
        .status-badge {
          display: inline-block;
          padding: 2px 6px;
          background: #28a745;
          color: white;
          border-radius: 3px;
          font-size: 0.8rem;
          font-weight: 600;
        }
      `}</style>

      <h3>🖥️ Terminal Access</h3>
      <p>Execute AWS CLI commands or connect to EC2 instances via SSM Session Manager.</p>

      <div className="terminal-controls">
        <select value={selectedInstance} onChange={(e) => setSelectedInstance(e.target.value)}>
          <option value="">Select Instance...</option>
          {instances.map(inst => (
            <option key={inst.id} value={inst.id}>
              {inst.name} ({inst.type}) - {inst.publicIp || 'No public IP'}
            </option>
          ))}
        </select>

        <div className="terminal-mode-buttons">
          <button
            onClick={() => setMode('exec')}
            className={mode === 'exec' ? 'active' : ''}
          >
            Execute Command
          </button>
          <button
            onClick={() => setMode('terminal')}
            className={mode === 'terminal' ? 'active' : ''}
            disabled={!selectedInstance}
          >
            Start Session
          </button>
        </div>
      </div>

      {instances.length === 0 && (
        <div className="terminal-output">
          ℹ️  No running EC2 instances found. Create and run an instance to use terminal access.
        </div>
      )}

      {mode === 'exec' && (
        <>
          <form onSubmit={executeCommand} className="terminal-input-group">
            <input
              ref={inputRef}
              type="text"
              placeholder="AWS CLI command (e.g., aws ec2 describe-instances)"
              value={command}
              onChange={(e) => setCommand(e.target.value)}
            />
            <button type="submit">Execute</button>
          </form>
          {output && <div className="terminal-output">{output}</div>}
        </>
      )}

      {mode === 'terminal' && (
        <>
          <div ref={terminalRef} style={{ marginBottom: '1rem' }} />
          <div style={{ fontSize: '0.9rem', color: '#666' }}>
            💡 SSM Session Manager provides secure shell access without SSH keys.
            <br />
            Requires AWS Systems Manager Agent installed on the instance.
          </div>
        </>
      )}

      {instances.length > 0 && (
        <details style={{ marginTop: '1rem' }}>
          <summary style={{ fontWeight: 'bold', cursor: 'pointer', padding: '0.5rem' }}>
            📋 Running Instances ({instances.length})
          </summary>
          <div className="instance-list">
            {instances.map(inst => (
              <div
                key={inst.id}
                className={`instance-item ${selectedInstance === inst.id ? 'selected' : ''}`}
                onClick={() => {
                  setSelectedInstance(inst.id);
                  setMode('exec');
                }}
              >
                <strong>{inst.name}</strong>
                <br />
                <small>
                  ID: {inst.id} | Type: {inst.type}
                  {inst.publicIp && ` | IP: ${inst.publicIp}`}
                  <span className="status-badge" style={{ marginLeft: '0.5rem' }}>
                    {inst.state}
                  </span>
                </small>
              </div>
            ))}
          </div>
        </details>
      )}
    </div>
  );
}
