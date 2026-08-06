import { useState } from "react";
import { BookOpen, CheckCircle2, ExternalLink, LifeBuoy, Mail, Send, ShieldCheck } from "lucide-react";
import { api } from "../lib/api";

const SUPPORT_EMAIL = "Luxmor.syncspace@luxmorai.com";

export function HelpSupport({ user, onToast }) {
  const [form, setForm] = useState({ category: "Technical issue", subject: "", message: "" });
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);

  async function submit(event) {
    event.preventDefault();
    setBusy(true);
    try {
      const result = await api("/support", { method: "POST", body: JSON.stringify(form) });
      setSent(true);
      setForm({ category: "Technical issue", subject: "", message: "" });
      onToast(result.message);
    } catch (error) { onToast(error.message); }
    finally { setBusy(false); }
  }

  return (
    <div className="help-page page-pad">
      <header className="page-header">
        <div><span className="eyebrow">HELP CENTER</span><h1>How can we help?</h1><p>Get support with your account, conversations, meetings, or LuxSyncspace access.</p></div>
      </header>
      <div className="help-layout">
        <section className="panel support-form-panel">
          <header className="settings-section-head"><div><h2>Send a support request</h2><p>Our support team will receive your employee and account details with this request.</p></div></header>
          {sent ? <div className="support-success"><span><CheckCircle2 size={28} /></span><h2>Request sent</h2><p>We received your message and will reply to {user.email}.</p><button className="button button-secondary" onClick={() => setSent(false)}>Send another request</button></div> :
          <form className="event-form support-form" onSubmit={submit}>
            <label><span>What do you need help with?</span><select value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })}><option>Technical issue</option><option>Account access</option><option>Feature request</option><option>General help</option></select></label>
            <label><span>Subject</span><input value={form.subject} onChange={(e) => setForm({ ...form, subject: e.target.value })} placeholder="Briefly describe the issue" required /></label>
            <label><span>Details</span><textarea value={form.message} onChange={(e) => setForm({ ...form, message: e.target.value })} placeholder="Tell us what happened, what you expected, and any steps that help us reproduce it…" required /></label>
            <div className="support-identity"><ShieldCheck size={17} /><span>Sending as <b>{user.full_name}</b> · {user.employee_id}</span></div>
            <button className="button button-primary" disabled={busy}><Send size={17} /> {busy ? "Sending request…" : "Send to support"}</button>
          </form>}
        </section>
        <aside className="help-side">
          <section className="panel support-contact-card">
            <span className="support-card-icon"><Mail size={22} /></span>
            <h2>Email support</h2>
            <p>You can also contact the LuxSyncspace support team directly.</p>
            <a href={`mailto:${SUPPORT_EMAIL}?subject=LuxSyncspace support request`}>{SUPPORT_EMAIL}<ExternalLink size={14} /></a>
          </section>
          <section className="panel quick-help-card">
            <h2>Quick help</h2>
            <div><LifeBuoy size={18} /><span><b>Account access</b><small>Temporary passwords and sign-in support</small></span></div>
            <div><BookOpen size={18} /><span><b>Using LuxSyncspace</b><small>Chat, groups, calendar, and notifications</small></span></div>
          </section>
        </aside>
      </div>
    </div>
  );
}
