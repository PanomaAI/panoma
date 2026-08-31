/**
 * The seven days shown on the chart of the record, from the oldest to today's.
 *
 * The daily count is done by git (`commitsPerDay` in @panoma/core) and comes with the local date
 * as a key —`2026-08-19`—. Here, only which seven days are shown and which day of the week each is
 * labeled with are chosen.
 *
 * The day of the week travels together with the number and is not recalculated in the browser on
 * purpose: if the server renders at 11:59 PM and the client hydrates at 12:01 AM, both would make
 * their own list of "the last seven days" and they would be off by one slot — numbers of one day
 * under the label of another, without any warning. Counted once, there are no two versions.
 */
export function commitWeek(
  perDay: Record<string, number>,
  today: Date = new Date(),
): { weekday: number; value: number }[] {
  const start = new Date(today);
  start.setHours(0, 0, 0, 0);

  return Array.from({ length: 7 }, (_, index) => {
    const date = new Date(start);
    date.setDate(start.getDate() - (6 - index));
    return { weekday: date.getDay(), value: perDay[dayKey(date)] ?? 0 };
  });
}

/**
 * The same key that git writes with `--date=format-local:%Y-%m-%d`.
 *
 * With local components and not with `toISOString()`, which goes to UTC: here it is eight in the
 * evening on the 19th and that ISO already says 20. Just the error that makes the commits of one
 * evening appear on the next day.
 */
function dayKey(date: Date): string {
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
}
