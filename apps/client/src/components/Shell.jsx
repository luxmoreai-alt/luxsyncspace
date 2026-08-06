import { useEffect, useRef, useState } from "react";
import {
  Bell, CalendarDays, Check, CheckCheck, ChevronDown, CircleHelp, Command, LayoutDashboard,
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

const availabilityOptions = [
  ["online", "Online"],
  ["break", "On a break"],
  ["lunch", "At lunch"],
  ["unavailable", "Unavailable"],
  ["meeting", "In a meeting"],
  ["offline", "Appear offline"]
];

export function Shell({ user, active, setActive, children, onLogout, onStatusChange, notifications = [], unreadChatCount = 0, onNotificationsRead, onNotificationOpen }) {
  const [mobileOpen, setMobileOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [statusOpen, setStatusOpen] = useState(false);
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
    setNotificationsOpen(false);
    setStatusOpen(false);
  }

  function toggleNotifications() {
    setProfileOpen(false);
    setStatusOpen(false);
    setNotificationsOpen((open) => {
      if (!open) onNotificationsRead?.();
      return !open;
    });
  }

  return (
    <div className="app-shell">
      <aside className={`sidebar ${mobileOpen ? "sidebar-open" : ""}`}>
        <div className="brand"><img className="brand-logo-shell" src="/luxmor-logo.jpeg" alt="Luxmor AI Technologies" /><button className="mobile-close" onClick={() => setMobileOpen(false)}><X /></button></div>
        <nav className="primary-nav">
          <span className="nav-label">WORKSPACE</span>
          {nav.map(([id, label, Icon]) => (
            <button className={active === id ? "active" : ""} onClick={() => navigate(id)} key={id}>
              <Icon size={20} strokeWidth={1.8} /><span>{label}</span>{id === "chat" && unreadChatCount > 0 && <b className="nav-badge">{unreadChatCount > 99 ? "99+" : unreadChatCount}</b>}
            </button>
          ))}
        </nav>
        <div className="sidebar-spacer" />
        <nav className="secondary-nav">
          <button className={active === "settings" ? "active" : ""} onClick={() => navigate("settings")}><Settings size={19} /><span>Settings</span></button>
          <button className={active === "help" ? "active" : ""} onClick={() => navigate("help")}><CircleHelp size={19} /><span>Help & support</span></button>
        </nav>
        <button className="sidebar-user" onClick={() => { setStatusOpen(false); setNotificationsOpen(false); setProfileOpen(!profileOpen); }}>
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
            <button className="availability-button" onClick={() => { setNotificationsOpen(false); setProfileOpen(false); setStatusOpen((open) => !open); }} title="Change your status" aria-label="Change your status" aria-expanded={statusOpen}>
              <i className={`availability-dot status-${user.availability_status || user.presence || "offline"}`} /><span>{availabilityOptions.find(([value]) => value === (user.availability_status || user.presence))?.[1] || "Offline"}</span><ChevronDown size={14} />
            </button>
            <button className="icon-button notification-button" onClick={toggleNotifications} title="Notifications" aria-label="Open notifications" aria-expanded={notificationsOpen}><Bell size={20} />{notifications.some((item) => item.unread) && <i />}</button>
            <button className="top-user" onClick={() => { setNotificationsOpen(false); setStatusOpen(false); setProfileOpen(!profileOpen); }}><Avatar person={user} size="sm" /><ChevronDown size={15} /></button>
          </div>
          {statusOpen && <div className="availability-menu">
            <header><b>Set your status</b><small>Let coworkers know when you are available.</small></header>
            {availabilityOptions.map(([value, label]) => <button key={value} onClick={async () => { await onStatusChange?.(value); setStatusOpen(false); }}>
              <i className={`availability-dot status-${value}`} /><span>{label}</span>{(user.availability_status || user.presence) === value && <Check size={15} />}
            </button>)}
          </div>}
          {notificationsOpen && <div className="notification-menu">
            <header><div><b>Notifications</b><small>{notifications.length ? `${notifications.length} recent` : "You’re all caught up"}</small></div>{notifications.length > 0 && <span><CheckCheck size={15} /> Read</span>}</header>
            <div className="notification-menu-list">
              {notifications.map((item) => <button key={item.id} onClick={() => { onNotificationOpen?.(item); setNotificationsOpen(false); }}>
                <span className={`notification-menu-icon notification-${item.sound || "message"}`}><Bell size={16} /></span>
                <span><b>{item.title}</b><small>{item.body}</small><time>{new Date(item.receivedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</time></span>
              </button>)}
              {!notifications.length && <div className="notification-menu-empty"><Bell size={24} /><b>No notifications yet</b><p>New messages, meetings, and announcements will appear here.</p></div>}
            </div>
          </div>}
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
            <button className={active === id ? "active" : ""} onClick={() => navigate(id)} key={id}><Icon size={20} /><span>{label}</span>{id === "chat" && unreadChatCount > 0 && <b className="mobile-nav-badge">{unreadChatCount > 99 ? "99+" : unreadChatCount}</b>}</button>
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
