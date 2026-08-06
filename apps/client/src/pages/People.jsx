import { Building2, Copy, Grid2X2, List, MessageSquareText, MoreHorizontal, Pencil, Search, SlidersHorizontal, UserCheck, UserMinus, UserPlus, Users, UserX } from "lucide-react";
import { useMemo, useState } from "react";
import { Avatar } from "../components/Avatar";
import { Modal } from "../components/Modal";
import { api } from "../lib/api";

export function People({ user, people, onStartChat, onInvite, onManage, onRefresh, onToast }) {
  const [query, setQuery] = useState("");
  const [department, setDepartment] = useState("All");
  const [menuId, setMenuId] = useState(null);
  const [pendingAction, setPendingAction] = useState(null);
  const [busy, setBusy] = useState(false);
  const departments = ["All", ...new Set(people.map((p) => p.department))];
  const filtered = useMemo(() => people.filter((person) =>
    (department === "All" || person.department === department) &&
    `${person.full_name} ${person.title} ${person.department}`.toLowerCase().includes(query.toLowerCase())
  ), [people, query, department]);
  const canInvite = ["hr", "manager", "senior_leader"].includes(user.role);
  const canManageEmployment = ["hr", "senior_leader"].includes(user.role);
  const activePeople = people.filter((person) => (person.employment_status || "active") === "active");

  async function updateEmployment() {
    if (!pendingAction) return;
    setBusy(true);
    try {
      const result = await api(`/employees/${pendingAction.person.id}/employment`, {
        method: "PATCH",
        body: JSON.stringify({ status: pendingAction.status })
      });
      await onRefresh();
      onToast(result.message);
      setPendingAction(null);
      setMenuId(null);
    } catch (error) { onToast(error.message); }
    finally { setBusy(false); }
  }

  function copyEmail(person) {
    navigator.clipboard.writeText(person.email).then(() => onToast("Employee email copied")).catch(() => onToast("Could not copy the email address"));
    setMenuId(null);
  }

  return (
    <div className="people-page page-pad">
      <header className="page-header">
        <div><span className="eyebrow">DIRECTORY</span><h1>People</h1><p>Find and connect with everyone in your organization.</p></div>
        {canInvite && <button className="button button-primary" onClick={onInvite}><UserPlus size={17} /> Invite employee</button>}
      </header>
      <section className="directory-stats">
        <div><span className="metric-icon blue"><Users size={20} /></span><span><b>{activePeople.length}</b><small>Active people</small></span></div>
        <div><span className="metric-icon green"><Building2 size={20} /></span><span><b>{departments.length - 1}</b><small>Departments</small></span></div>
        <div><span className="presence-large" /><span><b>{activePeople.filter((p) => p.presence === "online").length}</b><small>Online now</small></span></div>
      </section>
      <section className="directory-panel panel">
        <div className="directory-tools">
          <label className="section-search"><Search size={17} /><input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search people by name, role, or team" /></label>
          <select value={department} onChange={(e) => setDepartment(e.target.value)}><option value="All">All departments</option>{departments.slice(1).map((item) => <option key={item}>{item}</option>)}</select>
          <button className="icon-button"><SlidersHorizontal size={19} /></button>
          <div className="view-toggle"><button className="active"><Grid2X2 size={17} /></button><button><List size={18} /></button></div>
        </div>
        <div className="people-grid">
          {filtered.map((person) => <article className={`person-card employment-${person.employment_status || "active"}`} key={person.id}>
            <button className="person-more" onClick={() => setMenuId(menuId === person.id ? null : person.id)} aria-label={`Actions for ${person.full_name}`} aria-expanded={menuId === person.id}><MoreHorizontal size={17} /></button>
            {menuId === person.id && <div className="person-menu">
              {(person.employment_status || "active") === "active" && person.id !== user.id && <button onClick={() => { onStartChat(person); setMenuId(null); }}><MessageSquareText size={15} /> Start conversation</button>}
              {person.email && <button onClick={() => copyEmail(person)}><Copy size={15} /> Copy email</button>}
              {canInvite && <button onClick={() => { onManage(person); setMenuId(null); }}><Pencil size={15} /> Edit employee details</button>}
              {canManageEmployment && person.id !== user.id && (person.employment_status || "active") === "active" && <>
                <button onClick={() => setPendingAction({ person, status: "offboarded" })}><UserMinus size={15} /> Offboard employee</button>
                <button className="danger" onClick={() => setPendingAction({ person, status: "deleted" })}><UserX size={15} /> Delete employee</button>
              </>}
              {canManageEmployment && person.id !== user.id && person.employment_status !== "active" && <button onClick={() => setPendingAction({ person, status: "active" })}><UserCheck size={15} /> Reactivate employee</button>}
            </div>}
            <Avatar person={person} size="xl" showPresence />
            <h3>{person.full_name}</h3><p>{person.title}</p><div className="person-card-pills"><span className="department-pill">{person.department}</span>{person.employment_status && person.employment_status !== "active" && <span className={`employment-pill ${person.employment_status}`}>{person.employment_status === "offboarded" ? "Offboarded" : "Deleted"}</span>}</div>
            <div className="person-actions person-actions-single"><button onClick={() => onStartChat(person)} disabled={(person.employment_status || "active") !== "active"}><MessageSquareText size={17} /> {(person.employment_status || "active") === "active" ? "Start conversation" : "Account inactive"}</button></div>
          </article>)}
        </div>
        {!filtered.length && <div className="empty-state"><Users size={30} /><h3>No people found</h3><p>Try changing your search or department filter.</p></div>}
      </section>
      {pendingAction && <Modal title={`${pendingAction.status === "active" ? "Reactivate" : pendingAction.status === "offboarded" ? "Offboard" : "Delete"} ${pendingAction.person.full_name}?`} subtitle="Employee account management" onClose={() => !busy && setPendingAction(null)}>
        <div className="employment-confirm">
          {pendingAction.status === "active" ? <UserCheck size={30} /> : pendingAction.status === "offboarded" ? <UserMinus size={30} /> : <UserX size={30} />}
          <h3>{pendingAction.status === "active" ? "Restore account access" : pendingAction.status === "offboarded" ? "Disable account access" : "Deactivate and mark as deleted"}</h3>
          <p>{pendingAction.status === "active" ? "The employee will be able to sign in and use workspace features again." : "The employee will be signed out and will no longer be able to access the workspace. Existing conversations and records will be preserved."}</p>
          <div className="modal-actions"><button className="button button-secondary" onClick={() => setPendingAction(null)} disabled={busy}>Cancel</button><button className={`button ${pendingAction.status === "active" ? "button-primary" : "button-danger"}`} onClick={updateEmployment} disabled={busy}>{busy ? "Updating…" : "Confirm"}</button></div>
        </div>
      </Modal>}
    </div>
  );
}
