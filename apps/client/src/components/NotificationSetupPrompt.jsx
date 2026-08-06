import { useEffect, useState } from "react";
import { BellRing, X } from "lucide-react";
import { enableNotifications, notificationsEnabled, notificationsSupported } from "../lib/notifications";

export function NotificationSetupPrompt({ onToast }) {
  const [visible, setVisible] = useState(() => notificationsSupported() && !notificationsEnabled());
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const sync = () => setVisible(notificationsSupported() && !notificationsEnabled());
    window.addEventListener("luxsyncspace:notifications-changed", sync);
    return () => window.removeEventListener("luxsyncspace:notifications-changed", sync);
  }, []);

  if (!visible) return null;

  async function enable() {
    setBusy(true);
    try {
      await enableNotifications();
      setVisible(false);
      onToast("Call, message, and meeting notifications are enabled on this device");
    } catch (error) {
      onToast(error.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <aside className="notification-setup-prompt" role="status">
      <span><BellRing size={21} /></span>
      <div><b>Never miss a call</b><p>Enable ringing and phone notifications for incoming calls and messages.</p></div>
      <button className="button button-primary" onClick={enable} disabled={busy}>{busy ? "Enabling…" : "Enable alerts"}</button>
      <button className="notification-setup-close" onClick={() => setVisible(false)} aria-label="Dismiss notification setup"><X size={16} /></button>
    </aside>
  );
}
