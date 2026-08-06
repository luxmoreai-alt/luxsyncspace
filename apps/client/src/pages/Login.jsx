import { useState } from "react";
import { ArrowRight, CalendarDays, Check, Eye, EyeOff, LockKeyhole, MessageSquareText } from "lucide-react";

export function Login({ onLogin }) {
  const [email, setEmail] = useState("Luxmor@syncspace.com");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  async function submit(event) {
    event.preventDefault();
    setError("");
    setBusy(true);
    try { await onLogin(email, password); }
    catch (err) { setError(err.message); }
    finally { setBusy(false); }
  }

  return (
    <main className="login-page">
      <section className="login-brand-panel">
        <div className="login-brand">
          <img className="brand-logo-login" src="/luxmor-logo.jpeg" alt="Luxmor AI Technologies" />
        </div>
        <div className="login-story">
          <span className="eyebrow eyebrow-light">WORK FLOWS BETTER TOGETHER</span>
          <h1>One place for your people, conversations, and work.</h1>
          <p>Move from conversation to meeting to decision without losing context. LuxSyncspace keeps your company connected and focused.</p>
          <div className="login-features">
            <div><MessageSquareText size={19} /><span><b>Connected conversations</b><small>Direct messages and team channels in one secure workspace</small></span></div>
            <div><CalendarDays size={19} /><span><b>Time that works</b><small>Shared calendars, focused agendas, effortless meetings</small></span></div>
            <div><LockKeyhole size={19} /><span><b>Built for business</b><small>Organization-based access and protected company data</small></span></div>
          </div>
        </div>
        <p className="login-quote">“The best work happens when communication feels effortless.”</p>
      </section>
      <section className="login-form-panel">
        <div className="login-card">
          <span className="mobile-logo"><img src="/luxmor-logo.jpeg" alt="Luxmor AI Technologies" /></span>
          <span className="eyebrow">WELCOME BACK</span>
          <h2>Sign in to your workspace</h2>
          <p className="login-hint">Use your company account to continue.</p>
          <form onSubmit={submit}>
            <label><span>Work email</span><input type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" required /></label>
            <label><span>Password</span><div className="password-input"><input type={showPassword ? "text" : "password"} value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" minLength={8} required /><button type="button" onClick={() => setShowPassword((visible) => !visible)} aria-label={showPassword ? "Hide password" : "Show password"}>{showPassword ? <EyeOff size={17} /> : <Eye size={17} />}</button></div></label>
            <div className="login-options"><label className="check-label"><input type="checkbox" defaultChecked /><span><Check size={12} /></span> Keep me signed in</label><button type="button" className="link-button">Forgot password?</button></div>
            {error && <p className="form-error">{error}</p>}
            <button className="button button-primary login-submit" disabled={busy}>{busy ? "Signing in…" : "Sign in"} <ArrowRight size={18} /></button>
          </form>
          <div className="demo-note"><span>Luxmor AI workspace</span><p>Use the administrator credentials or the temporary password sent to your work email.</p></div>
          <p className="legal">By continuing, you agree to your organization’s acceptable use and privacy policies.</p>
        </div>
      </section>
    </main>
  );
}
