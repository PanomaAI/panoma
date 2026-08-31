import { mkdir, rename, rm, writeFile } from "node:fs/promises";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { panomaPath } from "./home";

/*
  The lease of the data directory: who has it, stated in files.
  PGlite does not lock your directory — verified: two servers on the same `db/` open and serve
  without a complaint — and two writers corrupt it. The first network against that was the
  `panoma up` stamp, which only knows the servers that that command started; the second, asking
  `lsof` who has the directory open — and `lsof` does not exist in Windows, which is a system
  declared with its column in the CI matrix. In Windows the guardian became completely blind.
  This is the third network, and the only one that works on all three systems: each process that
  opens the database NOTES who it is, and `panoma up` reads the notes before starting. Three
  decisions support the design:
  - **The writer only records, never refuses.** Refusal exists only in `panoma up`. If the one who
  records had to refuse, every test with its temporary `PANOMA_HOME` and every ops script would
  have to manage the conflict — and a lock that gets in the way ends up being removed, which is
  worse than not having it. Recording is free and cannot block anyone.
  - **A directory with one note per process, not a single slot file.** The first version was a
  single file, and the reviewer knocked it down with a specific sequence: server A writes a note;
  a second server B —started manually, bypassing any guard— overwrites A's note; B closes and
  removes "its" note. A is still alive writing, and there is no note to expose it: on Windows, the
  next `panoma up` would start a third writer on top. With one note per pid, no one overwrites
  anyone, each process removes its own BY NAME —without read-and-compare, that is, without that
  race—, and the guard scans whatever notes exist.
  - **Rancio decides by the pid, not by the clock.** A process that died without cleaning leaves
  its note set, and a heartbeat with a timestamp would require a timer on every writer and a
  threshold to discuss. `process.kill(pid, 0)` responds on all three systems if that pid is still
  alive, and that is enough: note of a dead one, note that is ignored — and it is cleared by the
  next one who writes. The known cost is pid recycling — another process inheriting the number —
  which is rare, resolved with the guardian's own message (stop or switch to `PANOMA_HOME` ), and
  it is the same cost already paid by the seal.
  The directory lives NEXT TO `db/`, not inside: the content of `db/` belongs to PostgreSQL and no
  one else.
 */

export interface DatabaseLease {
  pid: number;
  /** How the process was presented when noting: it is what the guardian will be able to teach. */
  command?: string;
  startedAt: string;
}

export function leaseDir(): string {
  return panomaPath("db.lease.d");
}

/** The note of A process. The name carries the pid: removing it does not require reading anything. */
export function leasePath(pid: number = process.pid): string {
  return join(leaseDir(), `${pid}.json`);
}

/** Is that pid still alive? The only question that all three systems answer the same. */
export function pidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    // EPERM is 'alive but from another user': for this guardian, alive.
    return (error as { code?: string }).code === "EPERM";
  }
}

/**
 * The intruder that the notes betray, if they betray any.
 *
 * Pure and with the `alive` injected to be able to test it without killing processes: your own
 * note is not an intruder, a dead person's note isn't either — that one is ignored and will be
 * swept up by the next person who writes. Only that of ANOTHER LIVING process is a denial, and the
 * one with the lowest pid is returned so that two consecutive executions point to the same one.
 */
export function leaseIntruder(
  leases: DatabaseLease[],
  ownPid: number,
  alive: (pid: number) => boolean,
): DatabaseLease | undefined {
  return [...leases]
    .filter((lease) => Number.isInteger(lease.pid) && lease.pid > 0 && lease.pid !== ownPid)
    .sort((a, b) => a.pid - b.pid)
    .find((lease) => alive(lease.pid));
}

/**
 * All the notes are legible. Synchronous because whoever consults them is deciding whether to
 * start, and files of a hundred bytes do not justify a `await` in every path.
 */
export function readLeases(): DatabaseLease[] {
  let names: string[];
  try {
    names = readdirSync(leaseDir());
  } catch {
    return [];
  }

  const leases: DatabaseLease[] = [];
  for (const name of names) {
    // Only the finished notes: a `.tmp` is a writing in flight, still of no one.
    if (!name.endsWith(".json")) continue;
    try {
      const parsed = JSON.parse(readFileSync(join(leaseDir(), name), "utf8")) as {
        pid?: unknown;
        command?: unknown;
        startedAt?: unknown;
      };
      if (!Number.isInteger(parsed.pid)) continue;
      leases.push({
        pid: parsed.pid as number,
        ...(typeof parsed.command === "string" && parsed.command.trim() !== ""
          ? { command: parsed.command }
          : {}),
        startedAt: typeof parsed.startedAt === "string" ? parsed.startedAt : "",
      });
    } catch {
      // An illegible note does not exist: a broken JSON cannot stop a startup.
    }
  }
  return leases;
}

/**
 * Mark this process as the database owner while sweeping up dead leases.
 *
 * It never throws: the note is a net, and a net that drops the trapeze artist is not a net. It is
 * written to a `.tmp` and renamed —the renaming is atomic in the same file system— so that the
 * guardian can never read a half-written note. The sweep of the dead goes by the PID of the NAME,
 * not the content: this way it also takes the unreadable remains of a process that died while
 * writing.
 */
export async function writeLease(): Promise<void> {
  try {
    await mkdir(leaseDir(), { recursive: true });

    for (const name of readdirSync(leaseDir())) {
      const pid = Number(name.replace(/\.json(\.tmp)?$/, ""));
      if (!Number.isInteger(pid) || pid === process.pid || pidAlive(pid)) continue;
      await rm(join(leaseDir(), name), { force: true }).catch(() => undefined);
    }

    const lease: DatabaseLease = {
      pid: process.pid,
      command: process.title || process.argv0,
      startedAt: new Date().toISOString(),
    };
    const tmp = `${leasePath()}.tmp`;
    await writeFile(tmp, `${JSON.stringify(lease)}\n`, "utf8");
    await rename(tmp, leasePath());
  } catch {
    // Without a disk for the note, the catalog works the same: the network is lost, not the turn.
  }
}

/** Remove your own note — by name, so someone else's is neither looked at nor touched. */
export async function clearLease(ownPid: number = process.pid): Promise<void> {
  try {
    await rm(leasePath(ownPid), { force: true });
  } catch {
    // The orphan note doesn't fool anyone: its pid will be dead and it will sweep itself away.
  }
}
