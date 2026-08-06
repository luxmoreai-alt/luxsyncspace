import { CheckCircle2, X } from "lucide-react";

export function Toast({ message, onClose }) {
  if (!message) return null;
  return (
    <div className="toast" role="status">
      <CheckCircle2 size={18} />
      <span>{message}</span>
      <button onClick={onClose} aria-label="Close notification"><X size={16} /></button>
    </div>
  );
}

