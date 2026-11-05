// Korean-time day and month helpers for 5.1 · 5.3.
const kstOffsetMs = 9 * 60 * 60 * 1000;
const dayMs = 24 * 60 * 60 * 1000;

// YYYY-MM-DD in Korea.
export const kstDay = (value: string | Date) =>
  new Date(new Date(value).getTime() + kstOffsetMs).toISOString().slice(0, 10);
export const kstMonth = (value: string | Date) => kstDay(value).slice(0, 7);

const toDate = (day: string) => new Date(`${day}T00:00:00Z`);
export const addDays = (day: string, days: number) =>
  new Date(toDate(day).getTime() + days * dayMs).toISOString().slice(0, 10);
export const shiftMonth = (month: string, months: number) => {
  const date = toDate(`${month}-01`);
  date.setUTCMonth(date.getUTCMonth() + months);
  return date.toISOString().slice(0, 7);
};
export const mondayOf = (day: string) =>
  addDays(day, -((toDate(day).getUTCDay() + 6) % 7));

// 10.05, like the dates on each run.
export const shortDay = (day: string) =>
  `${Number(day.slice(5, 7))}.${day.slice(8)}`;
