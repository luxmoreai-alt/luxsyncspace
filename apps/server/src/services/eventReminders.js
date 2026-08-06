import { sql } from "../db/client.js";
import { sendPushToUser } from "./push.js";

export function startEventReminderScheduler(io) {
  let running = false;

  async function sendDueReminders() {
    if (running) return;
    running = true;
    try {
      const events = await sql`
        UPDATE events
        SET reminder_sent_at = NOW()
        WHERE reminder_sent_at IS NULL
          AND starts_at > NOW()
          AND starts_at <= NOW() + INTERVAL '30 minutes'
        RETURNING id, title, location, starts_at
      `;
      for (const event of events) {
        const attendees = await sql`SELECT user_id FROM event_attendees WHERE event_id = ${event.id}`;
        const payload = {
          title: `Upcoming event: ${event.title}`,
          body: `Starts in 30 minutes${event.location ? ` · ${event.location}` : ""}`,
          tag: `event-reminder-${event.id}`,
          url: `/?meeting=${event.id}`
        };
        for (const attendee of attendees) {
          io.to(`user:${attendee.user_id}`).emit("event:reminder", { ...payload, event_id: event.id });
          sendPushToUser(attendee.user_id, payload).catch(console.error);
        }
      }
    } catch (error) {
      console.error("Event reminder check failed", error);
    } finally {
      running = false;
    }
  }

  const initialTimer = setTimeout(sendDueReminders, 3000);
  const interval = setInterval(sendDueReminders, 60_000);
  initialTimer.unref?.();
  interval.unref?.();
  return () => {
    clearTimeout(initialTimer);
    clearInterval(interval);
  };
}
