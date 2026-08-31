#!/usr/bin/env node
/*
  The retrospective mining of the quorum: the death test of the family plane.
  The study that preceded this piece wrote that the rise by quorum —a note that
  moves from project to family when it appears independently in two members— is not built by
  faith: first, the number of real instances is counted. If there are fewer than five genuine
  candidates throughout the machine, the family plane is a theorem without instances and is killed
  here, with the numbers in front.
  What does it measure, on a COPY of the catalog (the live one is open on the server and PGlite is
  single-writer):
  1. Copy families with two or more members — the relationship that the catalog models.
  2. Overlap of knowledge between siblings: pairs of log entries (and notes, if any) from DISTINCT
  members that say the same thing — Jaccard on the significant tokens, the same 'simple' spirit of
  migration 0042's index: without lemmatizer, what is written is what is compared.
  3. As a separate diagnosis, the machine plane: similar pairs between projects WITHOUT kinship,
  which is where a machine memory would live if it ever wins.
  Usage: node ops/quorum-mining.mjs <PANOMA_HOME-copy>
 */

import { resolve } from "node:path";

const home = process.argv[2];
if (!home) {
  process.stderr.write("Usage: node ops/quorum-mining.mjs <copy-of-PANOMA_HOME>\n");
  process.exit(1);
}
process.env.PANOMA_HOME = resolve(home);

const { openDatabase } = await import("../packages/db/dist/client.js");
const { schema: t } = await import("../packages/db/dist/index.js");
const { db, close } = await openDatabase();

/**
 * Tokens with meat: lowercase, without punctuation, three letters or more, without git noise.
 *
 * Three and not four, with a separate list of short acronyms: the audit measured that cutting into
 * four exactly took the tokens that bear the most load in this repository — git, npm, db, cli, mcp
 * — and the miner undercounted by design.
 */
const NOISE = new Set(["para", "with", "from", "that", "this", "commit", "file", "files", "update", "updated", "cambio", "cambios", "arreglo", "added", "wired", "the", "and", "los", "las", "una", "con", "por", "que"]);
const TECH = new Set(["db", "ci", "ui", "api", "sql", "wal", "npm", "git", "cli", "mcp"]);
function tokens(text) {
  return new Set(
    text
      .toLowerCase()
      .replace(/[^\p{L}\p{N}\s/._-]/gu, " ")
      .split(/\s+/)
      .filter((word) => (word.length >= 3 || TECH.has(word)) && !NOISE.has(word)),
  );
}

/**
 * How many distinct FACTS are there behind a list of pairs: connected components of the similarity
 * graph. The written threshold says 'five genuine candidates,' and counting raw pairs inflated it
 * — the same fact repeated in four members are six pairs and a single candidate.
 */
function distinctFacts(pairs) {
  const parent = new Map();
  const find = (key) => {
    let node = key;
    while (parent.get(node) !== node) node = parent.get(node);
    parent.set(key, node);
    return node;
  };
  for (const pair of pairs) {
    const a = `${pair.pa}|${pair.a.text}`;
    const b = `${pair.pb}|${pair.b.text}`;
    if (!parent.has(a)) parent.set(a, a);
    if (!parent.has(b)) parent.set(b, b);
    parent.set(find(a), find(b));
  }
  const roots = new Set();
  for (const key of parent.keys()) roots.add(find(key));
  return roots.size;
}

function jaccard(a, b) {
  if (a.size === 0 || b.size === 0) return 0;
  let shared = 0;
  for (const token of a) if (b.has(token)) shared++;
  return shared / (a.size + b.size - shared);
}

/* The raw material: logbook and notes by project, with their text already tokenized. */
const activities = await db
  .select({
    projectId: t.agentActivities.projectId,
    summary: t.agentActivities.summary,
    details: t.agentActivities.details,
  })
  .from(t.agentActivities);
const notes = (
  await db.select({ projectId: t.notes.projectId, body: t.notes.body, status: t.notes.status }).from(t.notes)
).filter((row) => row.status === "approved" || row.status === "proposed");

const byProject = new Map();
function push(projectId, kind, text) {
  const set = tokens(text);
  if (set.size < 3) return;
  const list = byProject.get(projectId) ?? [];
  list.push({ kind, text: text.slice(0, 140), set });
  byProject.set(projectId, list);
}
for (const row of activities) push(row.projectId, "journal", `${row.summary} ${row.details ?? ""}`);
for (const row of notes) push(row.projectId, "note", row.body);

const projectNames = new Map(
  (await db.select({ id: t.projects.id, name: t.projects.name }).from(t.projects)).map((p) => [p.id, p.name]),
);

/* 1) Families with possible quorum. */
const members = await db
  .select({ familyId: t.familyMembers.familyId, projectId: t.familyMembers.projectId })
  .from(t.familyMembers);
const familyNames = new Map(
  (await db.select({ id: t.families.id, name: t.families.name }).from(t.families)).map((f) => [f.id, f.name]),
);
const byFamily = new Map();
for (const row of members) {
  const list = byFamily.get(row.familyId) ?? [];
  list.push(row.projectId);
  byFamily.set(row.familyId, list);
}

const THRESHOLD = 0.5;

function crossPairs(projectIds) {
  const pairs = [];
  for (let i = 0; i < projectIds.length; i++) {
    for (let j = i + 1; j < projectIds.length; j++) {
      const a = byProject.get(projectIds[i]) ?? [];
      const b = byProject.get(projectIds[j]) ?? [];
      for (const itemA of a) {
        for (const itemB of b) {
          const score = jaccard(itemA.set, itemB.set);
          if (score >= THRESHOLD) {
            pairs.push({ score, a: itemA, b: itemB, pa: projectIds[i], pb: projectIds[j] });
          }
        }
      }
    }
  }
  return pairs.sort((x, y) => y.score - x.score);
}

let familyCandidates = 0;
const familyPairs = [];
console.log("═══ Familias (copias del mismo proyecto) ═══");
for (const [familyId, projectIds] of byFamily) {
  if (projectIds.length < 2) continue;
  const withVoice = projectIds.filter((id) => (byProject.get(id) ?? []).length > 0);
  const pairs = crossPairs(projectIds);
  familyCandidates += pairs.length;
  familyPairs.push(...pairs);
  console.log(
    `\n· ${familyNames.get(familyId) ?? familyId} — ${projectIds.length} miembros, ${withVoice.length} con bitácora, ${pairs.length} pares ≥${THRESHOLD}`,
  );
  for (const pair of pairs.slice(0, 5)) {
    console.log(`   ${pair.score.toFixed(2)} [${pair.a.kind}/${pair.b.kind}]`);
    console.log(`     A(${projectNames.get(pair.pa)}): ${pair.a.text}`);
    console.log(`     B(${projectNames.get(pair.pb)}): ${pair.b.text}`);
  }
}

/* 3) The machine plane: projects without kinship that still say the same thing. */
const family = new Map();
for (const row of members) family.set(row.projectId, row.familyId);
const allIds = [...byProject.keys()];
const machinePairs = [];
for (let i = 0; i < allIds.length; i++) {
  for (let j = i + 1; j < allIds.length; j++) {
    const fa = family.get(allIds[i]);
    if (fa !== undefined && fa === family.get(allIds[j])) continue;
    for (const itemA of byProject.get(allIds[i]) ?? []) {
      for (const itemB of byProject.get(allIds[j]) ?? []) {
        const score = jaccard(itemA.set, itemB.set);
        if (score >= THRESHOLD) machinePairs.push({ score, a: itemA, b: itemB, pa: allIds[i], pb: allIds[j] });
      }
    }
  }
}
machinePairs.sort((x, y) => y.score - x.score);
console.log(`\n═══ Plano máquina (sin parentesco) — ${machinePairs.length} pares ≥${THRESHOLD} ═══`);
for (const pair of machinePairs.slice(0, 10)) {
  console.log(`   ${pair.score.toFixed(2)} A(${projectNames.get(pair.pa)}): ${pair.a.text}`);
  console.log(`        B(${projectNames.get(pair.pb)}): ${pair.b.text}`);
}

/*
  The verdict, with the threshold that the border wrote: DISTINCT facts, not raw pairs — the same
  fact in four copies are six pairs and a single candidate.
 */
const familyFacts = distinctFacts(familyPairs);
const stats = {
  proyectos: projectNames.size,
  conBitacora: byProject.size,
  entradas: activities.length,
  notas: notes.length,
  familias2mas: [...byFamily.values()].filter((ids) => ids.length >= 2).length,
  paresFamilia: familyCandidates,
  hechosFamilia: familyFacts,
  paresMaquina: machinePairs.length,
};
console.log("\n═══ Veredicto ═══");
console.log(JSON.stringify(stats, null, 2));
console.log(
  familyFacts >= 5
    ? "≥5 hechos de familia: el plano familiar tiene instancias — se construye."
    : "<5 hechos de familia: el teorema no tiene instancias hoy — no se construye todavía.",
);
console.log(
  "Nota del instrumento: dos hermanos que escriben el mismo hecho en idiomas distintos son " +
    "invisibles para este Jaccard — no traduce. Con un veredicto al filo del umbral, revisar a mano.",
);

await close();
