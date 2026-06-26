export default function Sidebar({
  loginForm,
  setLoginForm,
  handleLogin,
  loadingAction,
}: any) {
  return (
    <aside className="col-span-2 bg-[#0a0a0f] border-r border-slate-800 p-2">
      
      <div className="mb-3">
        <h1 className="font-mono text-sm font-bold tracking-wider text-amber-500">
          SENTINEL
        </h1>
        <p className="text-[10px] text-slate-500 font-mono">
          v1.0.0 // GUARD
        </p>
      </div>

      <div className="mt-6 pt-4 border-t border-slate-800">
        <div className="text-[10px] font-mono text-slate-600 uppercase mb-2 px-2">
          Auth
        </div>

        <form onSubmit={handleLogin} className="space-y-1">
          <input
            type="email"
            placeholder="email"
            value={loginForm.email}
            onChange={(e) =>
              setLoginForm({ ...loginForm, email: e.target.value })
            }
            className="w-full bg-background border border-slate-700 rounded px-2 py-1 text-[10px]"
          />

          <input
            type="password"
            placeholder="pass"
            value={loginForm.password}
            onChange={(e) =>
              setLoginForm({ ...loginForm, password: e.target.value })
            }
            className="w-full bg-background border border-slate-700 rounded px-2 py-1 text-[10px]"
          />

          <button
            type="submit"
            disabled={loadingAction}
            className="w-full bg-amber-600/20 border border-amber-500 text-amber-500 text-[10px] py-1 rounded"
          >
            LOGIN
          </button>
        </form>
      </div>
    </aside>
  );
}