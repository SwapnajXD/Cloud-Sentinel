export default function AuditActions({
  registerForm,
  setRegisterForm,
  handleRegister,

  auditScope,
  setAuditScope,
  handleQueueAudit,

  fetchReports,
  handleLogout,

  deletePassword,
  setDeletePassword,
  handleDeleteAccount,

  token,
  loadingAction,
  loadingReports,
}: any) {
  return (
    <div className="grid grid-cols-4 gap-2">

      {/* Register */}
      <div>
        <form onSubmit={handleRegister}>
          <input
            placeholder="email"
            value={registerForm.email}
            onChange={(e) =>
              setRegisterForm({ ...registerForm, email: e.target.value })
            }
          />
          <input
            type="password"
            value={registerForm.password}
            onChange={(e) =>
              setRegisterForm({ ...registerForm, password: e.target.value })
            }
          />
          <button disabled={loadingAction}>REGISTER</button>
        </form>
      </div>

      {/* Queue */}
      <div>
        <input
          value={auditScope}
          onChange={(e) => setAuditScope(e.target.value)}
        />
        <button onClick={handleQueueAudit} disabled={!token}>
          RUN
        </button>
      </div>

      {/* Actions */}
      <div>
        <button onClick={() => fetchReports()}>
          REFRESH
        </button>
        <button onClick={handleLogout}>LOGOUT</button>
      </div>

      {/* Danger */}
      <div>
        <input
          type="password"
          value={deletePassword}
          onChange={(e) => setDeletePassword(e.target.value)}
        />
        <button onClick={handleDeleteAccount}>DELETE</button>
      </div>

    </div>
  );
}