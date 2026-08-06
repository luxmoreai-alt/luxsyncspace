import { BellRing, X } from "lucide-react";

export function InAppNotification({ notification, onClose }) {
  if (!notification) return null;
  return (
    <aside className="in-app-notification" role="status" aria-live="polite">
      <span><BellRing size={20} /></span>
      <div><b>{notification.title}</b><p>{notification.body}</p></div>
      <button onClick={onClose} aria-label="Dismiss notification"><X size={17} /></button>
    </aside>
  );
}
