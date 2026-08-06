import { useEffect, useRef, useState } from "react";
import {
  Bell, CalendarDays, ChevronDown, CircleHelp, Command, LayoutDashboard,
  Menu, MessageSquareText, Search, Settings, Users, Video, X
} from "lucide-react";
import { Avatar } from "./Avatar";
import { api } from "../lib/api";

const nav = [
  ["home", "Home", LayoutDashboard],
  ["chat", "Chat", MessageSquareText],
  ["meetings", "Meetings", Video],
  ["calendar", "Calendar", CalendarDays],
  ["people", "People", Users]
];

export function Shell({ user, active, setActive, children, onLogout }) {
  const [mobileOpen, setMobileOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState(null);
  const searchRef = useRef();

  useEffect(() => {
    if (query.trim().length < 2) { setResults(null); return; }
    const timer = setTimeout(() => api(`/search?q=${encodeURIComponent(query)}`).then(setResults).catch(() => {}), 250);
    return () => clearTimeout(timer);
  }, [query]);

  useEffect(() => {
    const handle = (event) => {
      if ((event.metaKey || event.ctrlKey) && event.key === "k") {
        event.preventDefault(); searchRef.current?.focus();
      }
    };
    window.addEventListener("keydown", handle);
    return () => window.removeEventListener("keydown", handle);
  }, []);

  function navigate(view) {
    setActive(view);
    setMobileOpen(false);
    setQuery("");
    setResults(null);
  }

  return (
    <div className="app-shell">
      <aside className={`sidebar ${mobileOpen ? "sidebar-open" : ""}`}>
        <div className="brand"><img className="brand-logo-shell" src="/luxmor-logo.jpeg" alt="Luxmor AI Technologies" /><button className="mobile-close" onClick={() => setMobileOpen(false)}><X /></button></div>
        <nav className="primary-nav">
          <span className="nav-label">WORKSPACE</span>
          {nav.map(([id, label, Icon]) => (
            <button className={active === id ? "active" : ""} onClick={() => navigate(id)} key={id}>
              <Icon size={20} strokeWidth={1.8} /><span>{label}</span>
            </button>
          ))}
        </nav>
        <div className="sidebar-spacer" />
        <nav className="secondary-nav">
          <button className={active === "settings" ? "active" : ""} onClick={() => navigate("settings")}><Settings size={19} /><span>Settings</span></button>
          <button className={active === "help" ? "active" : ""} onClick={() => navigate("help")}><CircleHelp size={19} /><span>Help & support</span></button>
        </nav>
        <button className="sidebar-user" onClick={() => setProfileOpen(!profileOpen)}>
          <Avatar person={user} showPresence />
          <span><b>{user.full_name}</b><small>{user.title}</small></span>
          <ChevronDown size={16} />
        </button>
      </aside>
      <div className="shell-main">
        <header className="topbar">
          <button className="menu-button" onClick={() => setMobileOpen(true)}><Menu size={22} /></button>
          <div className="global-search">
            <Search size={18} />
            <input ref={searchRef} value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search people, messages, and channels" />
            <kbd><Command size={12} /> K</kbd>
            {results && <SearchResults results={results} onNavigate={navigate} onClose={() => { setQuery(""); setResults(null); }} />}
          </div>
          <div className="top-actions">
            <button className="icon-button notification-button" onClick={() => navigate("settings")} title="Notification settings"><Bell size={20} /><i /></button>
            <button className="top-user" onClick={() => setProfileOpen(!profileOpen)}><Avatar person={user} size="sm" /><ChevronDown size={15} /></button>
          </div>
          {profileOpen && (
            <div className="profile-menu">
              <div><Avatar person={user} /><span><b>{user.full_name}</b><small>{user.email}</small></span></div>
              <button className="profile-link" onClick={() => { navigate("settings"); setProfileOpen(false); }}>View profile & settings</button>
              <button onClick={onLogout}>Sign out</button>
            </div>
          )}
        </header>
        <main className="workspace">{children}</main>
        <nav className="mobile-bottom-nav" aria-label="Mobile navigation">
          {[...nav, ["settings", "Settings", Settings]].map(([id, label, Icon]) => (
            <button className={active === id ? "active" : ""} onClick={() => navigate(id)} key={id}><Icon size={20} /><span>{label}</span></button>
          ))}
        </nav>
      </div>
      {mobileOpen && <div className="sidebar-scrim" onClick={() => setMobileOpen(false)} />}
    </div>
  );
}

function SearchResults({ results, onNavigate, onClose }) {
  const people = results.people || [];
  const channels = results.channels || [];
  const empty = !people.length && !channels.length;
  return (
    <div className="search-results">
      <div className="search-results-head"><span>Search results</span><button onClick={onClose}><X size={15} /></button></div>
      {empty && <p className="search-empty">No results found. Try another phrase.</p>}
      {!!people.length && <section><small>PEOPLE</small>{people.map((p) => <button onClick={() => onNavigate("chat")} key={p.id}><Avatar person={p} size="xs" /><span><b>{p.full_name}</b><em>{p.title}</em></span></button>)}</section>}
      {!!channels.length && <section><small>CHANNELS</small>{channels.map((c) => <button onClick={() => onNavigate("chat")} key={c.id}><MessageSquareText size={17} /><span><b># {c.name}</b><em>{c.description}</em></span></button>)}</section>}
    </div>
  );
}
