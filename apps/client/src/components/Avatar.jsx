export function Avatar({ person, size = "md", showPresence = false }) {
  const initials = person?.initials || person?.sender_initials || "?";
  const color = person?.avatar_color || person?.sender_color || "#596579";
  return (
    <span className={`avatar avatar-${size}`} style={{ "--avatar": color }} aria-label={person?.full_name || person?.sender_name}>
      {initials}
      {showPresence && person?.presence && <i className={`presence presence-${person.presence}`} />}
    </span>
  );
}

