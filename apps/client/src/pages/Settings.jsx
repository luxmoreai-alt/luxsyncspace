import { useEffect, useState } from "react";
import { Badge, Bell, Building2, CalendarDays, Download, Mail, MapPin, Pencil, Phone, Save, Search, Send, ShieldCheck, Smartphone, UserRound, Users, Volume2 } from "lucide-react";
import { api } from "../lib/api";
import { disableNotifications, enableNotifications, notificationsEnabled, notificationsSupported, playNotificationSound } from "../lib/notifications";
import { Avatar } from "../components/Avatar";
import { Modal } from "../components/Modal";

const emptyInvite = () => ({
  fullName: "",
  employeeId: "",
  email: "",
  title: "",
  department: "Engineering",
  role: "employee",
  phone: "",
  location: "",
  managerId: "",
  joinedAt: new Date().toISOString().slice(0, 10),
  bio: ""
});

export function Settings({ user, people, onToast, onRefresh }) {
  const [tab, setTab] = useState("profile");
  const [selected, setSelected] = useState(null);
  const [editing, setEditing] = useState(null);
  const [query, setQuery] = useState("");
  const [invite, setInvite] = useState(emptyInvite);
  const [busy, setBusy] = useState(false);
  const [notificationsOn, setNotificationsOn] = useState(notificationsEnabled);
  const [installAvailable, setInstallAvailable] = useState(Boolean(window.__luxsyncspaceInstallPrompt));
  const isInstalled = window.matchMedia("(display-mode: standalone)").matches || window.navigator.standalone === true;
  const canInvite = ["hr", "manager", "senior_leader"].includes(user.role);
  const filtered = people.filter((person) => `${person.full_name} ${person.employee_id} ${person.title} ${person.department}`.toLowerCase().includes(query.toLowerCase()));

  useEffect(() => {
    const available = () => setInstallAvailable(true);
    window.addEventListener("luxsyncspace:install-available", available);
    return () => window.removeEventListener("luxsyncspace:install-available", available);
  }, []);

  async function turnOnNotifications() {
    try {
      await enableNotifications();
      setNotificationsOn(true);
      onToast("Notifications and the LuxSyncspace sound are enabled");
    } catch (error) { onToast(error.message); }
  }

  async function turnOffNotifications() {
    try {
      await disableNotifications();
      setNotificationsOn(false);
      onToast("Notifications disabled on this device");
    } catch (error) { onToast(error.message); }
  }

  async function installApp() {
    const prompt = window.__luxsyncspaceInstallPrompt;
    if (!prompt) return;
    await prompt.prompt();
    const choice = await prompt.userChoice;
    if (choice.outcome === "accepted") {
      window.__luxsyncspaceInstallPrompt = null;
      setInstallAvailable(false);
      onToast("LuxSyncspace installed");
    }
  }

  async function createInvite(event) {
    event.preventDefault();
    setBusy(true);
    try {
      const result = await api("/invitations", { method: "POST", body: JSON.stringify(invite) });
      await onRefresh();
      setInvite(emptyInvite());
      onToast(result.message || "Employee invitation email sent");
    } catch (error) { onToast(error.message); }
    finally { setBusy(false); }
  }

  function startEditing(person) {
    setEditing({
      fullName: person.full_name || "",
      employeeId: person.employee_id || "",
      email: person.email || "",
      title: person.title || "",
      department: person.department || "",
      role: person.role || "employee",
      phone: person.phone || "",
      location: person.location || "",
      managerId: person.manager_id || "",
      joinedAt: person.joined_at ? String(person.joined_at).slice(0, 10) : new Date().toISOString().slice(0, 10),
      bio: person.bio || ""
    });
  }

  async function updateEmployee(event) {
    event.preventDefault();
    setBusy(true);
    try {
      const result = await api(`/employees/${selected.id}`, { method: "PATCH", body: JSON.stringify(editing) });
      setSelected(result.employee);
      setEditing(null);
      await onRefresh();
      onToast(result.message || "Employee details updated");
    } catch (error) { onToast(error.message); }
    finally { setBusy(false); }
  }

  function canEditEmployee(person) {
    if (!canInvite) return false;
    if (user.role === "manager" && ["hr", "senior_leader"].includes(person.role)) return false;
    if (user.role === "hr" && person.role === "senior_leader") return false;
    return true;
  }

  return (
    <div className="settings-page page-pad">
      <header className="page-header"><div><span className="eyebrow">SETTINGS</span><h1>Profile & organization</h1><p>Review employee information and manage workspace access.</p></div></header>
      <div className="settings-layout">
        <aside className="settings-nav panel">
          <button className={tab === "profile" ? "active" : ""} onClick={() => setTab("profile")}><UserRound size={18} /> My profile</button>
          <button className={tab === "employees" ? "active" : ""} onClick={() => setTab("employees")}><Users size={18} /> Employee profiles</button>
          {canInvite && <button className={tab === "invite" ? "active" : ""} onClick={() => setTab("invite")}><Send size={18} /> Invite employees</button>}
          <button className={tab === "app" ? "active" : ""} onClick={() => setTab("app")}><Smartphone size={18} /> App & notifications</button>
        </aside>
        <section className="settings-content panel">
          {tab === "profile" && <ProfileDetails person={user} heading="My employee profile" />}
          {tab === "employees" && <>
            <header className="settings-section-head"><div><h2>Employee profiles</h2><p>View company identity, designation, team, and contact details.</p></div></header>
            <label className="section-search settings-search"><Search size={17} /><input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search by employee ID, name, or designation" /></label>
            <div className="employee-table">
              {filtered.map((person) => <button key={person.id} onClick={() => setSelected(person)}><Avatar person={person} /><span><b>{person.full_name}</b><small>{person.employee_id}</small></span><span><b>{person.title}</b><small>{person.department}</small></span><span className={`role-chip role-${person.role}`}>{person.role.replace("_", " ")}</span>{canEditEmployee(person) && <span className="employee-edit-hint"><Pencil size={13} /> Edit</span>}</button>)}
            </div>
          </>}
          {tab === "invite" && canInvite && <>
            <header className="settings-section-head"><div><h2>Invite a new employee</h2><p>Create the account and email a one-time temporary password through ZeptoMail.</p></div></header>
            <form className="invite-settings-form event-form" onSubmit={createInvite}>
              <div className="form-grid"><label><span>Employee name</span><input value={invite.fullName} onChange={(e) => setInvite({ ...invite, fullName: e.target.value })} placeholder="Full legal name" required /></label><label><span>Work email</span><input type="email" value={invite.email} onChange={(e) => setInvite({ ...invite, email: e.target.value })} placeholder="employee@company.com" required /></label></div>
              <label><span>Employee ID</span><input value={invite.employeeId} onChange={(e) => setInvite({ ...invite, employeeId: e.target.value.toUpperCase() })} placeholder="e.g. LUX-1002 (leave blank to generate automatically)" pattern="[A-Za-z0-9-]{3,30}" /></label>
              <label><span>Designation</span><input value={invite.title} onChange={(e) => setInvite({ ...invite, title: e.target.value })} placeholder="e.g. Software Engineer" required /></label>
              <div className="form-grid"><label><span>Department</span><input value={invite.department} onChange={(e) => setInvite({ ...invite, department: e.target.value })} required /></label><label><span>Access role</span><select value={invite.role} onChange={(e) => setInvite({ ...invite, role: e.target.value })}><option value="employee">Employee</option><option value="team_lead">Team lead</option><option value="manager">Manager</option><option value="hr">HR</option></select></label></div>
              <div className="form-grid"><label><span>Phone number</span><input type="tel" value={invite.phone} onChange={(e) => setInvite({ ...invite, phone: e.target.value })} placeholder="+91 98765 43210" /></label><label><span>Work location</span><input value={invite.location} onChange={(e) => setInvite({ ...invite, location: e.target.value })} placeholder="e.g. Hyderabad, India" /></label></div>
              <div className="form-grid"><label><span>Reporting manager</span><select value={invite.managerId} onChange={(e) => setInvite({ ...invite, managerId: e.target.value })}><option value="">Not assigned</option>{people.map((person) => <option value={person.id} key={person.id}>{person.full_name} · {person.title}</option>)}</select></label><label><span>Joining date</span><input type="date" value={invite.joinedAt} onChange={(e) => setInvite({ ...invite, joinedAt: e.target.value })} required /></label></div>
              <label><span>Employee profile summary</span><textarea value={invite.bio} onChange={(e) => setInvite({ ...invite, bio: e.target.value })} placeholder="Add responsibilities, expertise, or a short professional introduction…" maxLength={1000} /></label>
              <div className="email-delivery-note"><ShieldCheck size={18} /><span><b>Secure email delivery</b><small>The employee will receive their email as username and a generated temporary password. They must replace it after signing in.</small></span></div>
              <button className="button button-primary" disabled={busy}><Send size={17} /> {busy ? "Creating account and sending…" : "Send employee invitation"}</button>
            </form>
          </>}
          {tab === "app" && <>
            <header className="settings-section-head"><div><h2>App & notifications</h2><p>Install LuxSyncspace and choose how you receive new-message alerts.</p></div></header>
            <div className="app-settings-list">
              <section>
                <span className="app-setting-icon"><Download size={21} /></span>
                <div><h3>Install LuxSyncspace</h3><p>Add the app to your phone home screen or desktop. It opens in its own app window and keeps essential files available offline.</p><small>{isInstalled ? "LuxSyncspace is installed on this device." : installAvailable ? "This device is ready to install." : "Use your browser’s Install app or Add to Home Screen menu if the button is unavailable."}</small></div>
                <button className="button button-secondary" onClick={installApp} disabled={isInstalled || !installAvailable}>{isInstalled ? "Installed" : "Install app"}</button>
              </section>
              <section>
                <span className="app-setting-icon"><Bell size={21} /></span>
                <div><h3>Message notifications</h3><p>Receive alerts for direct messages, group messages, and company announcements on laptop and supported mobile devices.</p><small>{!notificationsSupported() ? "This browser does not support PWA notifications." : notificationsOn ? "Notifications are enabled." : "Permission is not enabled yet."}</small></div>
                <button className={`button ${notificationsOn ? "button-secondary" : "button-primary"}`} onClick={notificationsOn ? turnOffNotifications : turnOnNotifications}>{notificationsOn ? "Turn off" : "Enable"}</button>
              </section>
              <section>
                <span className="app-setting-icon"><Volume2 size={21} /></span>
                <div><h3>LuxSyncspace notification sounds</h3><p>Messages use the LuxSyncspace chime, meetings use a separate reminder tone, and incoming calls ring repeatedly until answered or declined. Background notifications use the sound permitted by your operating system.</p></div>
                <div className="sound-test-actions">
                  <button className="button button-secondary" onClick={() => { playNotificationSound("message"); onToast("Playing message sound"); }}>Test message</button>
                  <button className="button button-secondary" onClick={() => { playNotificationSound("meeting"); onToast("Playing meeting reminder sound"); }}>Test meeting</button>
                </div>
              </section>
            </div>
          </>}
        </section>
      </div>
      {selected && !editing && <Modal title="Employee profile" subtitle={selected.employee_id} onClose={() => setSelected(null)}><div className="profile-modal"><ProfileDetails person={selected} />{canEditEmployee(selected) && <div className="employee-profile-actions"><button className="button button-primary" onClick={() => startEditing(selected)}><Pencil size={16} /> Edit details</button></div>}</div></Modal>}
      {selected && editing && <Modal title="Edit employee details" subtitle={selected.employee_id} onClose={() => setEditing(null)}>
        <form className="event-form" onSubmit={updateEmployee}>
          <div className="form-grid"><label><span>Employee name</span><input value={editing.fullName} onChange={(e) => setEditing({ ...editing, fullName: e.target.value })} required /></label><label><span>Work email</span><input type="email" value={editing.email} onChange={(e) => setEditing({ ...editing, email: e.target.value })} required /></label></div>
          <div className="form-grid"><label><span>Employee ID</span><input value={editing.employeeId} onChange={(e) => setEditing({ ...editing, employeeId: e.target.value.toUpperCase() })} pattern="[A-Za-z0-9-]{3,30}" required /></label><label><span>Designation</span><input value={editing.title} onChange={(e) => setEditing({ ...editing, title: e.target.value })} required /></label></div>
          <div className="form-grid"><label><span>Department</span><input value={editing.department} onChange={(e) => setEditing({ ...editing, department: e.target.value })} required /></label><label><span>Access role</span><select value={editing.role} onChange={(e) => setEditing({ ...editing, role: e.target.value })}><option value="employee">Employee</option><option value="team_lead">Team lead</option><option value="manager">Manager</option><option value="hr" disabled={user.role === "manager"}>HR</option>{user.role === "senior_leader" && <option value="senior_leader">Senior leader</option>}</select></label></div>
          <div className="form-grid"><label><span>Phone number</span><input type="tel" value={editing.phone} onChange={(e) => setEditing({ ...editing, phone: e.target.value })} /></label><label><span>Work location</span><input value={editing.location} onChange={(e) => setEditing({ ...editing, location: e.target.value })} /></label></div>
          <div className="form-grid"><label><span>Reporting manager</span><select value={editing.managerId} onChange={(e) => setEditing({ ...editing, managerId: e.target.value })}><option value="">Not assigned</option>{people.filter((person) => person.id !== selected.id).map((person) => <option value={person.id} key={person.id}>{person.full_name} · {person.title}</option>)}</select></label><label><span>Joining date</span><input type="date" value={editing.joinedAt} onChange={(e) => setEditing({ ...editing, joinedAt: e.target.value })} required /></label></div>
          <label><span>Employee profile summary</span><textarea value={editing.bio} onChange={(e) => setEditing({ ...editing, bio: e.target.value })} maxLength={1000} /></label>
          <div className="modal-actions"><button type="button" className="button button-secondary" onClick={() => setEditing(null)} disabled={busy}>Cancel</button><button className="button button-primary" disabled={busy}><Save size={16} /> {busy ? "Saving…" : "Save changes"}</button></div>
        </form>
      </Modal>}
    </div>
  );
}

function ProfileDetails({ person, heading }) {
  const details = [
    [Badge, "Employee ID", person.employee_id || "Pending"],
    [Building2, "Department", person.department],
    [ShieldCheck, "Workspace role", person.role?.replace("_", " ")],
    [Mail, "Work email", person.email],
    [Phone, "Phone", person.phone || "Not provided"],
    [MapPin, "Location", person.location || "Not provided"],
    [UserRound, "Manager", person.manager_name || "Not assigned"],
    [CalendarDays, "Joined", person.joined_at ? new Date(person.joined_at).toLocaleDateString(undefined, { month: "long", day: "numeric", year: "numeric" }) : "Not available"]
  ];
  return <div className="profile-details">
    {heading && <header className="settings-section-head"><div><h2>{heading}</h2><p>Your official information in the company directory.</p></div></header>}
    <div className="profile-hero"><Avatar person={person} size="xl" showPresence /><div><h2>{person.full_name}</h2><p>{person.title}</p><span className={`role-chip role-${person.role}`}>{person.role?.replace("_", " ")}</span></div></div>
    {person.bio && <p className="profile-bio">{person.bio}</p>}
    <div className="profile-detail-grid">{details.map(([Icon, label, value]) => <div key={label}><Icon size={17} /><span><small>{label}</small><b>{value}</b></span></div>)}</div>
  </div>;
}
