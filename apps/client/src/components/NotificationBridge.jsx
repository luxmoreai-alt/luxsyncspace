import { useEffect } from "react";
import { io } from "socket.io-client";
import { SOCKET_URL, socketOptions } from "../lib/api";
import { primeNotificationAudio, showWorkspaceNotification } from "../lib/notifications";

export function NotificationBridge({ user, channels, onRefresh, onIncomingCall, onNotification }) {
  useEffect(() => {
    const unlockAudio = () => { primeNotificationAudio().catch(() => {}); };
    window.addEventListener("pointerdown", unlockAudio, { once: true });
    window.addEventListener("keydown", unlockAudio, { once: true });
    const socket = io(SOCKET_URL, socketOptions());
    const notify = (title, body, tag, sound = "message") => {
      onNotification?.({ title, body, tag, sound, id: crypto.randomUUID() });
      showWorkspaceNotification(title, body, tag, sound);
    };
    socket.on("direct:message", (message) => {
      if (message.sender_id === user.id) return;
      if (/^(Voice|Video) call:/.test(message.body || "")) return;
      if (/^Meeting cancelled:/.test(message.body || "")) return;
      const isMeetingInvitation = /^Meeting invitation:/.test(message.body || "");
      notify(
        isMeetingInvitation ? `Meeting invitation from ${message.sender_name}` : `Message from ${message.sender_name}`,
        message.body || `Shared ${message.file_name || "a file"}`,
        `direct-${message.sender_id}`,
        isMeetingInvitation ? "meeting" : "message"
      );
    });
    socket.on("channel:message", (message) => {
      if (message.sender_id === user.id) return;
      const channel = channels.find((item) => item.id === message.channel_id);
      if (channel?.muted) return;
      notify(`${message.sender_name} in #${channel?.name || "group"}`, message.body || `Shared ${message.file_name || "a file"}`, `channel-${message.channel_id}`);
    });
    socket.on("announcement:new", (announcement) => {
      notify(`Company announcement: ${announcement.title}`, announcement.body, `announcement-${announcement.id}`);
    });
    socket.on("event:created", (event) => {
      notify(event.title, event.body, event.tag, "meeting");
    });
    socket.on("event:reminder", (event) => {
      notify(event.title, event.body, event.tag, "meeting");
    });
    socket.on("event:cancelled", (event) => {
      notify(event.title, event.body, event.tag, "meeting");
      onRefresh();
    });
    socket.on("channel:membership-updated", () => {
      onRefresh();
    });
    socket.on("call:incoming", (call) => {
      onIncomingCall(call);
    });
    return () => {
      window.removeEventListener("pointerdown", unlockAudio);
      window.removeEventListener("keydown", unlockAudio);
      socket.disconnect();
    };
  }, [user.id, channels, onRefresh, onIncomingCall, onNotification]);

  return null;
}
