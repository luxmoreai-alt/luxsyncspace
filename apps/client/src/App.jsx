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
import { NotificationSetupPrompt } from "./components/NotificationSetupPrompt";
import { dismissIncomingCallNotification } from "./lib/notifications";

export default function App() {
  const [user, setUser] = useState(null);
  const [data, setData] = useState({ people: [], channels: [], events: [], announcements: [], directUnreadCounts: {} });
  const [active, setActive] = useState(() => new URLSearchParams(window.location.search).get("channel") ? "chat" : "home");
  const [meetingId, setMeetingId] = useState(() => new URLSearchParams(window.location.search).get("meeting"));
  const [activeMeeting, setActiveMeeting] = useState(null);
  const [loading, setLoading] = useState(Boolean(authStore.get()));
  const [newEvent, setNewEvent] = useState(false);
  const [toast, setToast] = useState("");
  const [incomingCall, setIncomingCall] = useState(null);
  const [notification, setNotification] = useState(null);
  const [notifications, setNotifications] = useState([]);

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

  function receiveNotification(item) {
    const notificationItem = { ...item, receivedAt: new Date().toISOString(), unread: true };
    setNotification(notificationItem);
    setNotifications((current) => [notificationItem, ...current.filter((entry) => entry.tag !== item.tag)].slice(0, 30));
  }

  function openNotification(item) {
    setNotification(null);
    setNotifications((current) => current.map((entry) => entry.id === item.id ? { ...entry, unread: false } : entry));
    setActive(item.view || "home");
  }

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

  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    const handleCallAction = (event) => {
      if (event.data?.type !== "luxsyncspace:call-rejected") return;
      setIncomingCall((current) => current?.meeting?.id === event.data.meetingId ? null : current);
    };
    navigator.serviceWorker.addEventListener("message", handleCallAction);
    return () => navigator.serviceWorker.removeEventListener("message", handleCallAction);
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

  const receiveChatMessage = useCallback((type, id) => {
    setData((current) => type === "channel"
      ? { ...current, channels: current.channels.map((channel) => channel.id === id ? { ...channel, unread_count: (channel.unread_count || 0) + 1 } : channel) }
      : { ...current, directUnreadCounts: { ...current.directUnreadCounts, [id]: (current.directUnreadCounts?.[id] || 0) + 1 } }
    );
  }, []);

  const markConversationRead = useCallback((type, id) => {
    setData((current) => type === "channel"
      ? { ...current, channels: current.channels.map((channel) => channel.id === id ? { ...channel, unread_count: 0 } : channel) }
      : { ...current, directUnreadCounts: { ...current.directUnreadCounts, [id]: 0 } }
    );
  }, []);

  const updatePresence = useCallback((presence) => {
    setUser((current) => current?.id === presence.id ? { ...current, ...presence } : current);
    setData((current) => ({
      ...current,
      people: current.people.map((person) => person.id === presence.id ? { ...person, ...presence } : person)
    }));
  }, []);

  async function changeAvailabilityStatus(status) {
    try {
      const presence = await api("/presence", { method: "PATCH", body: JSON.stringify({ status }) });
      updatePresence(presence);
      setToast("Status updated");
    } catch (error) { setToast(error.message); }
  }

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

  async function endMeetingForEveryone(meeting) {
    const result = await api(`/meetings/${meeting.id}/end`, { method: "POST" });
    setToast(result.message || "Meeting ended for everyone");
    leaveMeeting();
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

  function declineIncomingCall() {
    const meetingId = incomingCall?.meeting?.id;
    setIncomingCall(null);
    dismissIncomingCallNotification(meetingId).catch(() => {});
  }

  function acceptIncomingCall() {
    const call = incomingCall;
    if (!call) return;
    setIncomingCall(null);
    dismissIncomingCallNotification(call.meeting?.id).catch(() => {});
    joinMeeting(call.meeting);
  }

  if (loading) return <div className="app-loading"><span className="loading-logo">S</span><p>Opening your workspace…</p></div>;
  if (!user) return <Login onLogin={login} />;
  if (user.must_change_password) return <ChangePassword user={user} onLogout={logout} onChanged={() => { setUser((current) => ({ ...current, must_change_password: false })); setToast("Password updated successfully"); }} />;
  if (meetingId) {
    const meeting = activeMeeting || data.events.find((event) => event.id === meetingId) || { id: meetingId, title: "LuxSyncspace meeting", meeting_mode: "video" };
    return <>
      <MeetingRoom meeting={meeting} user={user} onLeave={leaveMeeting} onEndMeeting={endMeetingForEveryone} onToast={setToast} />
      <NotificationBridge user={user} channels={data.channels} onRefresh={refreshWorkspace} onIncomingCall={setIncomingCall} onNotification={receiveNotification} onChatMessage={receiveChatMessage} onPresenceUpdate={updatePresence} />
      <InAppNotification notification={notification} onOpen={() => setNotification(null)} onClose={() => setNotification(null)} />
      <Toast message={toast} onClose={() => setToast("")} />
    </>;
  }

  const pageProps = { user, data, navigate: setActive, onNewEvent: () => setNewEvent(true), onRefresh: refreshWorkspace, onToast: setToast, onJoinMeeting: joinMeeting, onStartMeeting: startInstantMeeting };
  return (
    <>
      <Shell user={user} active={active} setActive={setActive} onLogout={logout} onStatusChange={changeAvailabilityStatus} notifications={notifications} unreadChatCount={data.channels.reduce((total, channel) => total + (channel.unread_count || 0), 0) + Object.values(data.directUnreadCounts || {}).reduce((total, count) => total + count, 0)} onNotificationsRead={() => setNotifications((current) => current.map((item) => ({ ...item, unread: false })))} onNotificationOpen={openNotification}>
        {active === "home" && <Home {...pageProps} />}
        {active === "chat" && <Chat user={user} channels={data.channels} people={data.people} directUnreadCounts={data.directUnreadCounts || {}} onConversationRead={markConversationRead} onRefresh={refreshWorkspace} onToast={setToast} initialChannelId={new URLSearchParams(window.location.search).get("channel")} onStartCall={startCall} />}
        {active === "meetings" && <Meetings user={user} events={data.events} people={data.people} onJoinMeeting={joinMeeting} onStartMeeting={startInstantMeeting} onScheduleMeeting={() => setNewEvent(true)} onCancelEvent={cancelEvent} onToast={setToast} />}
        {active === "calendar" && <Calendar events={data.events} onNewEvent={() => setNewEvent(true)} onJoinMeeting={joinMeeting} />}
        {active === "people" && <People user={user} people={data.people} onStartChat={() => setActive("chat")} onInvite={() => setActive("settings")} />}
        {active === "settings" && <Settings user={user} people={data.people} onToast={setToast} onRefresh={refreshWorkspace} />}
        {active === "help" && <HelpSupport user={user} onToast={setToast} />}
        {!["home", "chat", "meetings", "calendar", "people", "settings", "help"].includes(active) && <Home {...pageProps} />}
      </Shell>
      <NotificationBridge user={user} channels={data.channels} onRefresh={refreshWorkspace} onIncomingCall={setIncomingCall} onNotification={receiveNotification} onChatMessage={receiveChatMessage} onPresenceUpdate={updatePresence} />
      <IncomingCall call={incomingCall} onDecline={declineIncomingCall} onAccept={acceptIncomingCall} />
      <InAppNotification notification={notification} onOpen={() => openNotification(notification)} onClose={() => setNotification(null)} />
      <NotificationSetupPrompt onToast={setToast} />
      {newEvent && <NewEvent people={data.people.filter((p) => p.id !== user.id)} onSave={saveEvent} onClose={() => setNewEvent(false)} />}
      <Toast message={toast} onClose={() => setToast("")} />
    </>
  );
}
