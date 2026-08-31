/**
 * The bytes in the unit in which they are read.
 *
 * It lives here and not inside `components/primitives.tsx` for the same reason as
 * `relative-date.ts`: it can be tested. The tests on this website do not transform `.tsx` —it's on
 * purpose— and this is rendered by half the application.
 *
 * There were THREE copies of this function and they had stopped saying the same thing. The one on
 * the disk screen rounded the megabytes without decimals; the one for unused resources didn't have
 * a gigabyte step, so for two gigabytes it answered "2048.0 MB," which is not a figure anyone can
 * read at a glance. None of the three had been tested, because all three lived in `.tsx`.
 *
 * The gig step was missing and it wasn't noticeable while this only measured projects, which are
 * megas. The permission screen measures histories: "1573.0 MB" is the figure on which one has to
 * decide whether to open the year-and-a-half conversation with a work tool.
 *
 * And the decimal in the megabytes remains: it's what distinguishes 4.2 MB from 4.9 MB, which in a
 * project is double the unused resources.
 */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 ** 2) return `${Math.round(bytes / 1024)} KB`;
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
}
