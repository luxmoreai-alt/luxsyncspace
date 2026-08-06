import { addDays, addWeeks, format, isSameDay, isSameMonth, startOfWeek, subWeeks } from "date-fns";
import { Ban, CalendarDays, ChevronLeft, ChevronRight, Clock, MapPin, Plus, Video } from "lucide-react";
import { useState } from "react";
import { eventTime } from "../lib/format";
import { Avatar } from "../components/Avatar";

export function Calendar({ events, onNewEvent, onJoinMeeting }) {
  const [weekStart, setWeekStart] = useState(() => startOfWeek(new Date(), { weekStartsOn: 1 }));
  const days = Array.from({ length: 5 }, (_, index) => addDays(weekStart, index));
  const hours = Array.from({ length: 10 }, (_, index) => index + 8);
  const weekEnd = days[days.length - 1];
  const weekLabel = isSameMonth(weekStart, weekEnd)
    ? format(weekStart, "MMMM yyyy")
    : `${format(weekStart, "MMM yyyy")} – ${format(weekEnd, "MMM yyyy")}`;
  const upcomingEvents = events
    .filter((event) => new Date(event.ends_at) > new Date())
    .slice(0, 5);

  function showToday() {
    setWeekStart(startOfWeek(new Date(), { weekStartsOn: 1 }));
  }

  return (
    <div className="calendar-page page-pad">
      <header className="page-header">
        <div><span className="eyebrow">CALENDAR</span><h1>Your week</h1><p>Plan focused time and stay in sync with your team.</p></div>
        <button className="button button-primary" onClick={onNewEvent}><Plus size={18} /> New event</button>
      </header>
      <div className="calendar-layout">
        <section className="calendar-main panel">
          <header className="calendar-toolbar">
            <div><button className="button button-secondary button-small calendar-today" onClick={showToday}>Today</button><button className="icon-button" onClick={() => setWeekStart((current) => subWeeks(current, 1))} aria-label="Previous week" title="Previous week"><ChevronLeft size={19} /></button><button className="icon-button" onClick={() => setWeekStart((current) => addWeeks(current, 1))} aria-label="Next week" title="Next week"><ChevronRight size={19} /></button><h2>{weekLabel}</h2></div>
            <button className="view-select">Work week <ChevronRight size={15} /></button>
          </header>
          <div className="week-grid">
            <div className="time-head" />
            {days.map((day) => <div className={`day-head ${isSameDay(day, new Date()) ? "today" : ""}`} key={day.toISOString()}><span>{format(day, "EEE").toUpperCase()}</span><b>{format(day, "d")}</b></div>)}
            <div className="time-column">{hours.map((hour) => <span key={hour}>{format(new Date().setHours(hour, 0), "h a")}</span>)}</div>
            {days.map((day) => (
              <div className={`day-column ${isSameDay(day, new Date()) ? "today-col" : ""}`} key={day.toISOString()}>
                {hours.map((hour) => <div className="hour-cell" key={hour} />)}
                {events.filter((event) => isSameDay(new Date(event.starts_at), day)).map((event) => {
                  const start = new Date(event.starts_at);
                  const end = new Date(event.ends_at);
                  const unavailable = Boolean(event.cancelled_at || event.ended_at);
                  const top = ((start.getHours() - 8) * 60 + start.getMinutes()) / 60 * 64;
                  const height = Math.max(42, (end - start) / 3600000 * 64);
                  return <button className={`calendar-event ${event.cancelled_at ? "cancelled" : event.ended_at ? "ended" : ""}`} disabled={unavailable} onClick={() => onJoinMeeting(event)} key={event.id} style={{ top, height, "--event": event.color }}><b>{event.cancelled_at ? `Cancelled: ${event.title}` : event.ended_at ? `Ended: ${event.title}` : event.title}</b><small>{event.cancelled_at ? event.cancellation_reason || "Cancelled by organizer" : event.ended_at ? "Ended by organizer" : eventTime(event.starts_at)}</small></button>;
                })}
              </div>
            ))}
          </div>
          <div className="mobile-calendar-days">
            {days.map((day) => {
              const dayEvents = events.filter((event) => isSameDay(new Date(event.starts_at), day));
              return <section className={isSameDay(day, new Date()) ? "today" : ""} key={day.toISOString()}>
                <header><span>{format(day, "EEE")}</span><b>{format(day, "d")}</b><small>{format(day, "MMMM")}</small></header>
                <div>
                  {dayEvents.map((event) => <button className={event.cancelled_at ? "cancelled" : event.ended_at ? "ended" : ""} disabled={Boolean(event.cancelled_at || event.ended_at)} onClick={() => onJoinMeeting(event)} key={event.id} style={{ "--event": event.color }}>
                    <time>{eventTime(event.starts_at)}</time>
                    <span><b>{event.cancelled_at ? `Cancelled: ${event.title}` : event.ended_at ? `Ended: ${event.title}` : event.title}</b><small>{event.cancelled_at ? event.cancellation_reason || "Cancelled by organizer" : event.ended_at ? "Ended by organizer" : event.location || (event.is_online ? "LuxSyncspace meeting" : "No location")}</small></span>
                    {event.cancelled_at || event.ended_at ? <span className="calendar-cancelled-mark">×</span> : event.is_online && <Video size={17} />}
                  </button>)}
                  {!dayEvents.length && <p>No events scheduled</p>}
                </div>
              </section>;
            })}
          </div>
        </section>
        <aside className="agenda-panel panel">
          <header><span className="metric-icon blue"><CalendarDays size={19} /></span><div><h2>Up next</h2><p>{format(new Date(), "EEEE, MMMM d")}</p></div></header>
          <div className="agenda-list">
            {upcomingEvents.map((event) => {
              const unavailable = Boolean(event.cancelled_at || event.ended_at);
              return <article className={event.cancelled_at ? "cancelled" : event.ended_at ? "ended" : ""} key={event.id} style={{ "--event": event.color }}>
                <span className="agenda-time">{eventTime(event.starts_at)}</span>
                <div>
                  {unavailable && <span className="agenda-status"><Ban size={12} /> {event.cancelled_at ? "Cancelled" : "Ended"}</span>}
                  <h3>{event.title}</h3>
                  <p><Clock size={14} /> {eventTime(event.starts_at)} – {eventTime(event.ends_at)}</p>
                  <p><MapPin size={14} /> {event.cancelled_at ? event.cancellation_reason || "Cancelled by organizer" : event.ended_at ? "Ended by organizer" : event.location}</p>
                  <div className="attendee-stack">{event.attendees?.slice(0, 4).map((person) => <Avatar person={{ initials: person.initials, avatar_color: person.color }} size="xxs" key={person.id} />)}<small>{event.attendees?.length || 0} attending</small></div>
                  {event.is_online && !unavailable && <button className="button button-primary button-small" onClick={() => onJoinMeeting(event)}><Video size={15} /> Join meeting</button>}
                </div>
              </article>;
            })}
          </div>
        </aside>
      </div>
    </div>
  );
}
