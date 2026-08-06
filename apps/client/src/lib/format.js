import { format, formatDistanceToNow, isToday, isYesterday } from "date-fns";

export function smartDate(value) {
  const date = new Date(value);
  if (isToday(date)) return format(date, "h:mm a");
  if (isYesterday(date)) return "Yesterday";
  return format(date, "MMM d");
}

export function relativeDate(value) {
  return formatDistanceToNow(new Date(value), { addSuffix: true });
}

export function eventTime(value) {
  return format(new Date(value), "h:mm a");
}

export function dateHeading(value) {
  return format(new Date(value), "EEEE, MMMM d");
}

