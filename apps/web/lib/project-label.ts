/**
 * A name for every project that no two projects share.
 *
 * The catalog stores what the folder calls itself, and a disk full of real work does not hand out
 * unique names. On the author's own machine `listProjectRoots` returns twenty rows named
 * `kiosk_new`, fourteen named `leaselab` and four named `pocket_bot` — genuine, distinct folders,
 * most of them copies made with the Finder. Three `<select>` controls on `/twin` rendered that list
 * straight, so choosing the scope of a decision meant picking one of twenty identical lines and
 * hoping. A control whose options cannot be told apart is not a control.
 *
 * The distinguishing information was there the whole time and the label threw it away: the folder
 * on disk is `kiosk_new copy 14`, and `name` is the tidied version that drops the tail. So the
 * rule is to spend exactly as many path segments as it takes:
 *
 * 1. The name, when nothing else carries it.
 * 2. Otherwise the folder itself, which is the word the person sees in their file manager.
 * 3. Otherwise the folder with its parent, then its grandparent, until the group comes apart.
 *
 * Only the rows that collide pay for the collision. A catalog of eighty projects where two are
 * called `kiosk` gets two longer labels and seventy-eight short ones, which is the opposite of
 * what a blanket «always show the path» rule would do to the same list.
 *
 * The comparison is over the WHOLE list and not pairwise, because a label that is unique against
 * one neighbour and not against another is the same bug with a smaller blast radius.
 */

/** What the catalog knows about a project before anyone has to name it on a screen. */
export interface NamedRoot {
  slug: string;
  name: string;
  /** The absolute path on disk. It is what breaks a tie, and the only thing that can. */
  root: string;
}

/** A project as a control may draw it: the same row, plus a label that stands on its own. */
export type LabelledProject<T extends NamedRoot> = T & { label: string };

/**
 * The path split into its parts, last one first, with the empty ones dropped.
 *
 * Trailing slashes and a doubled separator both produce empty segments, and an empty segment would
 * spend a step of the ladder without adding a word.
 */
function segments(root: string): string[] {
  return root.split("/").filter((part) => part.length > 0).reverse();
}

/**
 * The last `depth` segments of a path, in reading order.
 *
 * Beyond the length of the path it returns the whole path, so a group that cannot be separated —
 * two rows recorded at the same root — stops growing instead of looping.
 */
function tail(root: string, depth: number): string {
  const parts = segments(root);
  return parts.slice(0, Math.min(depth, parts.length)).reverse().join("/");
}

/**
 * The same rows, each carrying a label that appears once in the list.
 *
 * Order is preserved: the caller decides how the list is sorted, and a helper that reorders a
 * `<select>` behind the caller's back would move the option under a pointer that was already
 * heading for it.
 */
export function labelProjects<T extends NamedRoot>(rows: readonly T[]): LabelledProject<T>[] {
  const byName = new Map<string, T[]>();
  for (const row of rows) {
    const group = byName.get(row.name);
    if (group) group.push(row);
    else byName.set(row.name, [row]);
  }

  const labels = new Map<string, string>();
  for (const [name, group] of byName) {
    if (group.length === 1 && group[0]) {
      labels.set(group[0].slug, name);
      continue;
    }
    /*
      The deepest path in the group is the ceiling: past it every tail is the whole path and one
      more turn of the loop cannot separate anything that is still together.
     */
    const ceiling = Math.max(...group.map((row) => segments(row.root).length));
    let depth = 1;
    let drawn = group.map((row) => tail(row.root, depth));
    while (depth < ceiling && new Set(drawn).size < group.length) {
      depth += 1;
      drawn = group.map((row) => tail(row.root, depth));
    }
    /*
      And when even the full path repeats — two rows on the same folder, which the catalog allows
      while a rescan is halfway through — the slug closes it. It is not a word anybody chose, but
      it is the one thing here that a unique key guarantees is unique.
     */
    group.forEach((row, index) => {
      const drawnLabel = drawn[index] ?? row.name;
      const shared = drawn.some((other, at) => at !== index && other === drawnLabel);
      labels.set(row.slug, shared ? `${drawnLabel} · ${row.slug}` : drawnLabel);
    });
  }

  return rows.map((row) => ({ ...row, label: labels.get(row.slug) ?? row.name }));
}
