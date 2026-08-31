import { readFile } from "node:fs/promises";
import { readShots, type Shot } from "@panoma/core";
import { sha256 } from "@/lib/look-run";

/*
  Choose a capture from the mailbox without the name ever becoming a path.
  It is the piece the critic was missing to have a screen. From the terminal, the capture is read
  from the disk and already travels in base64: the process that sends it is the one that opens it,
  and the path is written by a person. From the browser, that does not exist — the page cannot
  read `~/Documents/algo/.panoma/shots/home.png`, and uploading four megabytes through the form
  for the server to receive them back when the file is on its own disk is paying for two trips for
  nothing.
  So the body brings a **name**, and that name is never used to build a path. The mailbox is
  listed—a folder that comes out of the catalog by the slug, never from the client—and the entry
  that is called that is looked for. What is returned is the path that `readShots` placed, not one
  composed here. The difference is the one that separates 'choosing from a list' from 'opening
  what they tell me': a `../../.ssh/id_rsa` does not match any entry in the list, and not matching
  is all that has to happen to it.
  That is why a path sanitizer is not needed either —neither `normalize`, nor checking that the
  result hangs from the root—. Those filters are necessary when the path is composed; here no path
  is being composed. An extra filter on something that is already safe invites the belief that it
  is the defense, and the day someone removes it, they take away what actually was.
 */

/**
 * The capture of the mailbox that is called that, or nothing.
 *
 * No limit on deliberately reading the mailbox: `readShots` already trims to `MAX_FILES` and what
 * is being sought may not be the most recent. Trimming here to the ten shown on the screen would
 * make choosing the eleventh respond 'does not exist' for a file that is there.
 */
export async function pickShot(root: string, name: string): Promise<Shot | undefined> {
  const inbox = await readShots(root);
  return inbox.shots.find((shot) => shot.name === name);
}

/**
 * The digest of a capture of the disc, or nothing if it is no longer there.
 *
 * It is the same question that `digestOf` asks about the image uploaded by whoever is watching,
 * and that is why it goes through the same function: what identifies a delivery is its content,
 * and two ways of calculating it are two ways of not recognizing the same image.
 *
 * The entire file is read, which is what this costs. The screen does it for each capture it
 * displays — to be able to say 'this one has already been checked' — and the watcher for the one
 * that has just appeared, so the cost is bounded by what is in a mailbox, not by the disk.
 */
export async function shotDigest(path: string): Promise<string | undefined> {
  const bytes = await readFile(path).catch(() => undefined);
  return bytes === undefined ? undefined : sha256(bytes);
}
