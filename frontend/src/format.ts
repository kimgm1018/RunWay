// Display formats shared by screens. RunWay runs in Korea, so dates are shown in KST
// whatever time zone the device (or emulator) is set to.

const kstOffsetMs = 9 * 60 * 60 * 1000;
const weekdays = ['일', '월', '화', '수', '목', '금', '토'];

function kst(value: string | Date) {
  const date = typeof value === 'string' ? new Date(value) : value;
  const shifted = new Date(date.getTime() + kstOffsetMs);
  return {
    month: shifted.getUTCMonth() + 1,
    day: shifted.getUTCDate(),
    weekday: shifted.getUTCDay(),
    hours: shifted.getUTCHours(),
    minutes: shifted.getUTCMinutes(),
  };
}

const pad = (value: number) => String(value).padStart(2, '0');

// 10월 19일 일요일
export function formatLongDate(value: string | Date) {
  const { month, day, weekday } = kst(value);
  return `${month}월 ${day}일 ${weekdays[weekday]}요일`;
}

// 10월 19일
export function formatMonthDay(value: string | Date) {
  const { month, day } = kst(value);
  return `${month}월 ${day}일`;
}

// 10.15
export function formatDotDate(value: string | Date) {
  const { month, day } = kst(value);
  return `${month}.${pad(day)}`;
}

// 10.15 목
export function formatDotDateWeekday(value: string | Date) {
  const { weekday } = kst(value);
  return `${formatDotDate(value)} ${weekdays[weekday]}`;
}

// 06:42
export function formatClockTime(value: string | Date) {
  const { hours, minutes } = kst(value);
  return `${pad(hours)}:${pad(minutes)}`;
}

// 10월 (from "2026-10")
export function formatMonth(month: string) {
  return `${Number(month.split('-')[1])}월`;
}

// 5′55″
export function formatPace(secondsPerKm: number) {
  const rounded = Math.round(secondsPerKm);
  return `${Math.floor(rounded / 60)}′${pad(rounded % 60)}″`;
}

// 5.02 (km)
export function formatKm(meters: number, digits = 2) {
  return (meters / 1000).toFixed(digits);
}

// 29:41 or 1:05:30
export function formatDuration(totalSeconds: number) {
  const rounded = Math.round(totalSeconds);
  const hours = Math.floor(rounded / 3600);
  const minutes = Math.floor((rounded % 3600) / 60);
  const seconds = pad(rounded % 60);
  return hours > 0
    ? `${hours}:${pad(minutes)}:${seconds}`
    : `${minutes}:${seconds}`;
}

// 3:21 (hours and minutes, for totals)
export function formatHours(totalSeconds: number) {
  const minutes = Math.round(totalSeconds / 60);
  return `${Math.floor(minutes / 60)}:${pad(minutes % 60)}`;
}

// 7h 12m
export function formatSleep(minutes: number) {
  return `${Math.floor(minutes / 60)}h ${pad(minutes % 60)}m`;
}

// 3분 전, 1시간 전, 2일 전
export function formatRelative(value: string, now: Date) {
  const minutes = Math.max(
    0,
    Math.floor((now.getTime() - new Date(value).getTime()) / 60000),
  );
  if (minutes < 1) {
    return '방금 전';
  }
  if (minutes < 60) {
    return `${minutes}분 전`;
  }
  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    return `${hours}시간 전`;
  }
  return `${Math.floor(hours / 24)}일 전`;
}

// Same KST calendar day.
export function isSameDay(a: string | Date, b: string | Date) {
  const x = kst(a);
  const y = kst(b);
  return x.month === y.month && x.day === y.day;
}

// 2.0N: after sunset (about 17:40 in Busan) until sunrise the run screens switch to night.
export function isNight(now: Date) {
  const { hours, minutes } = kst(now);
  const minuteOfDay = hours * 60 + minutes;
  return minuteOfDay >= 17 * 60 + 40 || minuteOfDay < 6 * 60 + 30;
}
