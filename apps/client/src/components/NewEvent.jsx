import { useState } from "react";
import { CalendarPlus, Check, Search, Send, Video } from "lucide-react";
import { Modal } from "./Modal";
import { Avatar } from "./Avatar";

function localInput(date) {
  const d = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  return d.toISOString().slice(0, 16);
}

export function NewEvent({ people, onSave, onClose }) {
  const initialStart = new Date(); initialStart.setMinutes(0, 0, 0); initialStart.setHours(initialStart.getHours() + 1);
  const initialEnd = new Date(initialStart.getTime() + 60 * 60 * 1000);
  const [form, setForm] = useState({
    title: "", description: "", location: "LuxSyncspace meeting",
    startsAt: localInput(initialStart), endsAt: localInput(initialEnd), attendeeIds: []
  });
  const [busy, setBusy] = useState(false);
  const [attendeeQuery, setAttendeeQuery] = useState("");
  const update = (key, value) => setForm((current) => ({ ...current, [key]: value }));
  const filteredPeople = people.filter((person) => `${person.full_name} ${person.title} ${person.department}`.toLowerCase().includes(attendeeQuery.toLowerCase()));
  const toggleAttendee = (personId) => update("attendeeIds", form.attendeeIds.includes(personId) ? form.attendeeIds.filter((id) => id !== personId) : [...form.attendeeIds, personId]);

  async function submit(event) {
    event.preventDefault();
    setBusy(true);
    try {
      await onSave({ ...form, startsAt: new Date(form.startsAt).toISOString(), endsAt: new Date(form.endsAt).toISOString() });
    } finally { setBusy(false); }
  }

  return (
    <Modal title="Schedule an event" subtitle="Bring the right people together" onClose={onClose}>
      <form className="event-form" onSubmit={submit}>
        <label><span>Event title</span><input value={form.title} onChange={(e) => update("title", e.target.value)} placeholder="e.g. Project kickoff" required /></label>
        <div className="form-grid">
          <label><span>Starts</span><input type="datetime-local" value={form.startsAt} onChange={(e) => update("startsAt", e.target.value)} required /></label>
          <label><span>Ends</span><input type="datetime-local" value={form.endsAt} onChange={(e) => update("endsAt", e.target.value)} required /></label>
        </div>
        <label><span>Location</span><div className="input-icon"><Video size={17} /><input value={form.location} onChange={(e) => update("location", e.target.value)} /></div></label>
        <div className="group-members-field">
          <div className="group-members-label"><span>Invite employees</span><small>{form.attendeeIds.length} selected</small></div>
          <label className="group-member-search"><Search size={16} /><input value={attendeeQuery} onChange={(event) => setAttendeeQuery(event.target.value)} placeholder="Search employees" /></label>
          <div className="group-member-list meeting-attendee-list">
            {filteredPeople.map((person) => {
              const selected = form.attendeeIds.includes(person.id);
              return <button type="button" className={selected ? "selected" : ""} onClick={() => toggleAttendee(person.id)} key={person.id}>
                <Avatar person={person} size="xs" /><span><b>{person.full_name}</b><small>{person.title} · {person.department}</small></span><i>{selected && <Check size={14} />}</i>
              </button>;
            })}
          </div>
          <div className="meeting-share-note"><Send size={15} /><span>Selected employees receive the meeting link in direct chat and as a notification.</span></div>
        </div>
        <label><span>Notes</span><textarea value={form.description} onChange={(e) => update("description", e.target.value)} placeholder="Add an agenda or context…" /></label>
        <footer className="modal-actions">
          <button type="button" className="button button-secondary" onClick={onClose}>Cancel</button>
          <button className="button button-primary" disabled={busy}><CalendarPlus size={17} /> {busy ? "Scheduling…" : "Schedule event"}</button>
        </footer>
      </form>
    </Modal>
  );
}
