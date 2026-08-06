import { useState } from "react";
import { Megaphone } from "lucide-react";
import { Modal } from "./Modal";

export function CreateAnnouncement({ onCreate, onClose }) {
  const [form, setForm] = useState({ title: "", body: "", priority: "normal" });
  const [busy, setBusy] = useState(false);
  const update = (key, value) => setForm((current) => ({ ...current, [key]: value }));
  async function submit(event) {
    event.preventDefault();
    setBusy(true);
    try { await onCreate(form); } finally { setBusy(false); }
  }
  return (
    <Modal title="Company announcement" subtitle="Publish an official update to everyone" onClose={onClose}>
      <form className="event-form" onSubmit={submit}>
        <label><span>Headline</span><input value={form.title} onChange={(e) => update("title", e.target.value)} placeholder="Announcement title" required /></label>
        <label><span>Message</span><textarea className="announcement-textarea" value={form.body} onChange={(e) => update("body", e.target.value)} placeholder="Share the update and any action employees need to take…" required /></label>
        <label><span>Priority</span><select value={form.priority} onChange={(e) => update("priority", e.target.value)}><option value="normal">Standard update</option><option value="important">Important — highlight for everyone</option></select></label>
        <footer className="modal-actions"><button type="button" className="button button-secondary" onClick={onClose}>Cancel</button><button className="button button-primary" disabled={busy}><Megaphone size={17} /> {busy ? "Publishing…" : "Publish announcement"}</button></footer>
      </form>
    </Modal>
  );
}

