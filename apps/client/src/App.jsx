import { useCallback, useEffect, useState } from "react";
import { api, authStore } from "./lib/api";
import { Login } from "./pages/Login";
import { Shell } from "./components/Shell";
import { Home } from "./pages/Home";
import { Chat } from "./pages/Chat";
import { Calendar } from "./pages/Calendar";
import { People } from "./pages/People";
import { Settings } from "./pages/Settings";
import { ChangePassword } from "./pages/ChangePassword";
import { HelpSupport } from "./pages/HelpSupport";
import { MeetingRoom } from "./pages/MeetingRoom";
import { NotificationBridge } from "./components/NotificationBridge";
import { NewEvent } from "./components/NewEvent";
import { Toast } from "./components/Toast";
import { Meetings } from "./pages/Meetings";
import { IncomingCall } from "./components/IncomingCall";
import { InAppNotification } from "./components/InAppNotification";

export default function App() {
  const [user, setUser] = useState(null);
  const [data, setData] = useState({ people: [], channels: [], events: [], announcements: [] });
  const [active, setActive] = useState(() => new URLSearchParams(window.location.search).get("channel") ? "chat" : "home");
  const [meetingId, setMeetingId] = useState(() => new URLSearchParams(window.location.search).get("meeting"));
  const [activeMeeting, setActiveMeeting] = useState(null);
  const [loading, setLoading] = useState(Boolean(authStore.get()));
  const [newEvent, setNewEvent] = useState(false);
  const [toast, setToast] = useState("");
  const [incomingCall, setIncomingCall] = useState(null);
  const [notification, setNotification] = useState(null);

  useEffect(() => {
    if (!authStore.get()) return;
    Promise.all([api("/auth/me"), api("/bootstrap")])
      .then(([me, workspace]) => { setUser(me.user); setData(workspace); })
      .catch(() => authStore.clear())
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(""), 3500);
    return () => clearTimeout(timer);
  }, [toast]);

  useEffect(() => {
    if (!notification) return;
    const timer = setTimeout(() => setNotification(null), 5200);
    return () => clearTimeout(timer);
  }, [notification]);

  useEffect(() => {
    const handleUnauthorized = () => {
      setUser(null);
      setActive("home");
      setToast("");
      setLoading(false);
    };
    window.addEventListener("luxsyncspace:unauthorized", handleUnauthorized);
    return () => window.removeEventListener("luxsyncspace:unauthorized", handleUnauthorized);
  }, []);

  async function login(email, password) {
    const result = await api("/auth/login", { method: "POST", body: JSON.stringify({ email, password }) });
    authStore.set(result.token);
    const workspace = await api("/bootstrap");
    setUser(result.user);
    setData(workspace);
  }

  function logout() {
    authStore.clear();
    setUser(null);
    setActive("home");
  }

  async function saveEvent(event) {
    await api("/events", { method: "POST", body: JSON.stringify(event) });
    const workspace = await api("/bootstrap");
    setData(workspace);
    setNewEvent(false);
    setToast("Event added to your calendar");
  }

  async function cancelEvent(event, reason = "") {
    const result = await api(`/events/${event.id}`, {
      method: "DELETE",
      body: JSON.stringify({ reason })
    });
    await refreshWorkspace();
    setToast(result.message);
  }

  const refreshWorkspace = useCallback(async () => {
    const workspace = await api("/bootstrap");
    setData(workspace);
    return workspace;
  }, []);

  function joinMeeting(event) {
    const url = new URL(window.location.href);
    url.searchParams.delete("channel");
    url.searchParams.set("meeting", event.id);
    window.history.pushState({}, "", url);
    setActiveMeeting(event);
    setMeetingId(event.id);
  }

  function leaveMeeting() {
    const url = new URL(window.location.href);
    url.searchParams.delete("meeting");
    window.history.pushState({}, "", url);
    setMeetingId(null);
    setActiveMeeting(null);
    refreshWorkspace().catch(() => {});
  }

  async function startInstantMeeting(options = {}) {
    try {
      const meeting = await api("/meetings/instant", {
        method: "POST",
        body: JSON.stringify({
          title: options.title || `${user.full_name}'s meeting`,
          attendeeIds: options.attendeeIds || [],
          mode: options.mode || "video",
          isCall: Boolean(options.isCall)
        })
      });
      await refreshWorkspace();
      joinMeeting(meeting);
    } catch (error) { setToast(error.message); }
  }

  async function startCall(person, mode) {
    await startInstantMeeting({
      title: `${user.full_name} and ${person.full_name}`,
      attendeeIds: [person.id],
      mode,
      isCall: true
    });
  }

  if (loading) return <div className="app-loading"><span className="loading-logo">S</span><p>Opening your workspace…</p></div>;
  if (!user) return <Login onLogin={login} />;
  if (user.must_change_password) return <ChangePassword user={user} onLogout={logout} onChanged={() => { setUser((current) => ({ ...current, must_change_password: false })); setToast("Password updated successfully"); }} />;
  if (meetingId) {
    const meeting = activeMeeting || data.events.find((event) => event.id === meetingId) || { id: meetingId, title: "LuxSyncspace meeting", meeting_mode: "video" };
    return <><MeetingRoom meeting={meeting} user={user} onLeave={leaveMeeting} onToast={setToast} /><Toast message={toast} onClose={() => setToast("")} /></>;
  }

  const pageProps = { user, data, navigate: setActive, onNewEvent: () => setNewEvent(true), onRefresh: refreshWorkspace, onToast: setToast, onJoinMeeting: joinMeeting, onStartMeeting: startInstantMeeting };
  return (
    <>
      <Shell user={user} active={active} setActive={setActive} onLogout={logout}>
        {active === "home" && <Home {...pageProps} />}
        {active === "chat" && <Chat user={user} channels={data.channels} people={data.people} onRefresh={refreshWorkspace} onToast={setToast} initialChannelId={new URLSearchParams(window.location.search).get("channel")} onStartCall={startCall} />}
        {active === "meetings" && <Meetings user={user} events={data.events} people={data.people} onJoinMeeting={joinMeeting} onStartMeeting={startInstantMeeting} onScheduleMeeting={() => setNewEvent(true)} onCancelEvent={cancelEvent} onToast={setToast} />}
        {active === "calendar" && <Calendar events={data.events} onNewEvent={() => setNewEvent(true)} onJoinMeeting={joinMeeting} />}
        {active === "people" && <People user={user} people={data.people} onStartChat={() => setActive("chat")} onInvite={() => setActive("settings")} />}
        {active === "settings" && <Settings user={user} people={data.people} onToast={setToast} onRefresh={refreshWorkspace} />}
        {active === "help" && <HelpSupport user={user} onToast={setToast} />}
        {!["home", "chat", "meetings", "calendar", "people", "settings", "help"].includes(active) && <Home {...pageProps} />}
      </Shell>
      <NotificationBridge user={user} channels={data.channels} onRefresh={refreshWorkspace} onIncomingCall={setIncomingCall} onNotification={setNotification} />
      <IncomingCall call={incomingCall} onDecline={() => setIncomingCall(null)} onAccept={() => { const call = incomingCall; setIncomingCall(null); joinMeeting(call.meeting); }} />
      <InAppNotification notification={notification} onClose={() => setNotification(null)} />
      {newEvent && <NewEvent people={data.people.filter((p) => p.id !== user.id)} onSave={saveEvent} onClose={() => setNewEvent(false)} />}
      <Toast message={toast} onClose={() => setToast("")} />
    </>
  );
}
