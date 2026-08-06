import { useEffect, useRef } from "react";
import { io } from "socket.io-client";
import { SOCKET_URL, socketOptions } from "../lib/api";
import { primeNotificationAudio, refreshNotificationSubscription, showIncomingCallNotification, showWorkspaceNotification } from "../lib/notifications";

export function NotificationBridge({ user, channels, onRefresh, onIncomingCall, onNotification }) {
  const channelsRef = useRef(channels);
  const callbacksRef = useRef({ onRefresh, onIncomingCall, onNotification });

  useEffect(() => {
    channelsRef.current = channels;
    callbacksRef.current = { onRefresh, onIncomingCall, onNotification };
  }, [channels, onRefresh, onIncomingCall, onNotification]);

  useEffect(() => {
    let lastSubscriptionRefresh = 0;
    const prepareDevice = () => {
      primeNotificationAudio().catch(() => {});
      if (Date.now() - lastSubscriptionRefresh > 15 * 60_000) {
        lastSubscriptionRefresh = Date.now();
        refreshNotificationSubscription().catch(() => {});
      }
    };
    const handleVisibility = () => {
      if (document.visibilityState === "visible") prepareDevice();
    };
    window.addEventListener("pointerdown", prepareDevice, { passive: true });
    window.addEventListener("touchend", prepareDevice, { passive: true });
    window.addEventListener("keydown", prepareDevice);
    document.addEventListener("visibilitychange", handleVisibility);
    prepareDevice();

    const socket = io(SOCKET_URL, socketOptions());
    const notify = (title, body, tag, sound = "message") => {
      callbacksRef.current.onNotification?.({ title, body, tag, sound, id: crypto.randomUUID() });
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
      const channel = channelsRef.current.find((item) => item.id === message.channel_id);
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
      callbacksRef.current.onRefresh();
    });
    socket.on("channel:membership-updated", () => {
      callbacksRef.current.onRefresh();
    });
    socket.on("call:incoming", (call) => {
      callbacksRef.current.onIncomingCall(call);
      showIncomingCallNotification(call).catch(() => {});
    });
    return () => {
      window.removeEventListener("pointerdown", prepareDevice);
      window.removeEventListener("touchend", prepareDevice);
      window.removeEventListener("keydown", prepareDevice);
      document.removeEventListener("visibilitychange", handleVisibility);
      socket.disconnect();
    };
  }, [user.id]);

  return null;
}
