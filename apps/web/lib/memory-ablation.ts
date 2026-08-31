/*
  The scale, half web: deciding the arm of a memory delivery.
  The entire experiment can be summed up in one sentence: half of the visits are served the
  project’s memory and the other half are withheld it, and then the corrections are compared. What
  this file ensures is that this distribution is **auditable**: the assignment is not decided by a
  die but by a hash of (agent, project, day), so the same visit always falls into the same group,
  the distribution can be recalculated afterward, and no one can wonder if the scale cheated.
  Two design decisions that are the ethical contract of the instrument:
  1. **Factory-off.** Retaining memory that the person healed is the system deciding over the
  person, and here it doesn't happen on its own: `PANOMA_MEMORY_ABLATION=1` turns it on, taking it
  off turns it off, and the book (`servings`) records each retention. With the ablation off, the
  book continues recording the deliveries — that record is not from the experiment: it is the
  substrate to know if a note was ever of any use.
  2. **Agent-only channel.** The ablation exists in both installments of the report —
  `/api/agent/context` and the re-reading of `/api/agent/notes` —; the file, the “Memory” card,
  and everything a person reads are left out. The obedience of the agent is measured, nothing is
  hidden from anyone. The re-reading is included intentionally: without it, it was the side door
  through which an agent from the restrained arm would fully recover the memory that the
  experiment believed to be retained.
  And a written border, because the audit asked: **the dormant channel does not enter the scale.**
  The note that wakes up when an agent is about to touch its route (`panoma signal`) is always
  served — it is the traffic signal at the accident site, and holding knowledge tied to a specific
  route to measure obedience would be measuring at the cost of causing the accident. Furthermore,
  the hook does not carry the agent's identity on purpose, so there would be no arm to calculate.
  The scale weighs the report; whatever the dormant channel weighs will be told by its own book
  the day it has it.
  The day is UTC on purpose: it is the same day for all the machine agents, it does not depend on
  the process's time zone, and it makes the hash reproducible from anywhere.
 */

/** The ablation is on only if the environment says it with all the letters. */
export function ablationEnabled(value: string | undefined = process.env["PANOMA_MEMORY_ABLATION"]): boolean {
  return value === "1" || value === "on";
}

/**
 * The arm of this visit: deterministic, stable during the day, and ~50/50 between visits.
 *
 * 32-bit FNV-1a over `agente:proyecto:día`, with the final murmur3 avalanche before keeping a bit.
 * Nothing cryptographic is needed — nobody gains anything guessing its arm — but the chosen bit
 * should depend on the entire key.
 */
export function ablationArm(input: {
  agentId: string;
  projectId: string;
  /** The moment of the visit; only its UTC date is used. */
  at: Date;
  enabled: boolean;
}): "served" | "withheld" {
  if (!input.enabled) return "served";

  const day = input.at.toISOString().slice(0, 10);
  const key = `${input.agentId}:${input.projectId}:${day}`;

  let hash = 0x811c9dc5;
  for (let i = 0; i < key.length; i++) {
    hash ^= key.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }

  /*
    The avalanche (fmix32 of murmur3), and it's not for decoration: FNV's cousin is odd, so bit 0
    of the state is a LINEAR function of the low bits of the input — a parity predictor hit the
    arm in 5000 out of 5000 keys during the audit, the same pair alternated arms almost every day,
    and two projects with IDs of the same parity always shared an arm. That wasn't a distribution:
    it was a schedule. Mixing before choosing makes the final bit depend on the entire key, and
    the test that fixes it runs exactly the predictor that broke the previous version.
   */
  hash ^= hash >>> 16;
  hash = Math.imul(hash, 0x85ebca6b);
  hash ^= hash >>> 13;
  hash = Math.imul(hash, 0xc2b2ae35);
  hash ^= hash >>> 16;

  return (hash >>> 0) % 2 === 0 ? "served" : "withheld";
}
