import { Building2, Grid2X2, List, MessageSquareText, MoreHorizontal, Search, SlidersHorizontal, UserPlus, Users } from "lucide-react";
import { useMemo, useState } from "react";
import { Avatar } from "../components/Avatar";

export function People({ user, people, onStartChat, onInvite }) {
  const [query, setQuery] = useState("");
  const [department, setDepartment] = useState("All");
  const departments = ["All", ...new Set(people.map((p) => p.department))];
  const filtered = useMemo(() => people.filter((person) =>
    (department === "All" || person.department === department) &&
    `${person.full_name} ${person.title} ${person.department}`.toLowerCase().includes(query.toLowerCase())
  ), [people, query, department]);
  const canInvite = ["hr", "manager", "senior_leader"].includes(user.role);

  return (
    <div className="people-page page-pad">
      <header className="page-header">
        <div><span className="eyebrow">DIRECTORY</span><h1>People</h1><p>Find and connect with everyone in your organization.</p></div>
        {canInvite && <button className="button button-primary" onClick={onInvite}><UserPlus size={17} /> Invite employee</button>}
      </header>
      <section className="directory-stats">
        <div><span className="metric-icon blue"><Users size={20} /></span><span><b>{people.length}</b><small>People</small></span></div>
        <div><span className="metric-icon green"><Building2 size={20} /></span><span><b>{departments.length - 1}</b><small>Departments</small></span></div>
        <div><span className="presence-large" /><span><b>{people.filter((p) => p.presence === "online").length}</b><small>Online now</small></span></div>
      </section>
      <section className="directory-panel panel">
        <div className="directory-tools">
          <label className="section-search"><Search size={17} /><input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search people by name, role, or team" /></label>
          <select value={department} onChange={(e) => setDepartment(e.target.value)}><option value="All">All departments</option>{departments.slice(1).map((item) => <option key={item}>{item}</option>)}</select>
          <button className="icon-button"><SlidersHorizontal size={19} /></button>
          <div className="view-toggle"><button className="active"><Grid2X2 size={17} /></button><button><List size={18} /></button></div>
        </div>
        <div className="people-grid">
          {filtered.map((person) => <article className="person-card" key={person.id}>
            <button className="person-more"><MoreHorizontal size={17} /></button>
            <Avatar person={person} size="xl" showPresence />
            <h3>{person.full_name}</h3><p>{person.title}</p><span className="department-pill">{person.department}</span>
            <div className="person-actions person-actions-single"><button onClick={onStartChat}><MessageSquareText size={17} /> Start conversation</button></div>
          </article>)}
        </div>
        {!filtered.length && <div className="empty-state"><Users size={30} /><h3>No people found</h3><p>Try changing your search or department filter.</p></div>}
      </section>
    </div>
  );
}
