import { useState } from "react";
import { Eye, EyeOff, KeyRound, ShieldCheck, Sparkles } from "lucide-react";
import { api } from "../lib/api";

export function ChangePassword({ user, onChanged, onLogout }) {
  const [form, setForm] = useState({ currentPassword: "", newPassword: "", confirmPassword: "" });
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [visible, setVisible] = useState({ current: false, next: false, confirm: false });
  const update = (key, value) => setForm((current) => ({ ...current, [key]: value }));

  async function submit(event) {
    event.preventDefault();
    setError("");
    if (form.newPassword !== form.confirmPassword) return setError("New passwords do not match");
    setBusy(true);
    try {
      await api("/auth/change-password", {
        method: "POST",
        body: JSON.stringify({ currentPassword: form.currentPassword, newPassword: form.newPassword })
      });
      onChanged();
    } catch (err) { setError(err.message); }
    finally { setBusy(false); }
  }

  return (
    <main className="password-page">
      <section className="password-card">
        <div className="login-brand invite-brand"><span className="logo-mark"><Sparkles size={20} /></span><span>LuxSyncspace</span></div>
        <span className="invite-check"><KeyRound size={24} /></span>
        <span className="eyebrow">SECURITY REQUIRED</span>
        <h1>Create your private password</h1>
        <p>Welcome, {user.full_name}. The password in your invitation email is temporary and can only be used for initial access.</p>
        <form className="event-form invite-form" onSubmit={submit}>
          <label><span>Temporary password</span><PasswordControl visible={visible.current} onToggle={() => setVisible({ ...visible, current: !visible.current })} value={form.currentPassword} onChange={(e) => update("currentPassword", e.target.value)} /></label>
          <label><span>New password</span><PasswordControl visible={visible.next} onToggle={() => setVisible({ ...visible, next: !visible.next })} value={form.newPassword} onChange={(e) => update("newPassword", e.target.value)} minLength={12} /><small>At least 12 characters with uppercase, lowercase, number, and special character.</small></label>
          <label><span>Confirm new password</span><PasswordControl visible={visible.confirm} onToggle={() => setVisible({ ...visible, confirm: !visible.confirm })} value={form.confirmPassword} onChange={(e) => update("confirmPassword", e.target.value)} minLength={12} /></label>
          {error && <p className="form-error">{error}</p>}
          <button className="button button-primary" disabled={busy}><ShieldCheck size={17} /> {busy ? "Securing account…" : "Save password and continue"}</button>
          <button type="button" className="link-button password-logout" onClick={onLogout}>Sign in with another account</button>
        </form>
      </section>
    </main>
  );
}

function PasswordControl({ visible, onToggle, ...inputProps }) {
  return <div className="password-input"><input {...inputProps} type={visible ? "text" : "password"} required /><button type="button" onClick={onToggle} aria-label={visible ? "Hide password" : "Show password"}>{visible ? <EyeOff size={17} /> : <Eye size={17} />}</button></div>;
}
