export default function Header({ token, email, scope }: any) {
  return (
    <header className="sticky top-0 z-50 bg-[#0a0a0f]/95 border-b border-slate-800 backdrop-blur">
      <div className="flex items-center justify-between px-3 py-2">
        
        <div className="flex items-center gap-2 font-mono text-xs tracking-wider">
          <span className="text-slate-500">CORE</span>
          <span className="text-slate-700">//</span>
          <span className="text-amber-500">AUDIT</span>
          <span className="text-slate-700">/</span>
          <span className="text-cyan-400">
            AWS-{scope?.toUpperCase() || "S3"}
          </span>
        </div>

        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2">
            <span className="relative flex h-2 w-2">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75"></span>
              <span className="relative inline-flex rounded-full h-2 w-2 bg-red-500"></span>
            </span>
            <span className="font-mono text-[10px] text-slate-400">
              LIVE-SYNC
            </span>
          </div>

          <span className={`text-[10px] font-mono ${token ? 'text-emerald-500' : 'text-slate-500'}`}>
            {token ? `AUTH: ${email.split("@")[0].toUpperCase()}` : "AUTH: NONE"}
          </span>
        </div>
      </div>
    </header>
  );
}
