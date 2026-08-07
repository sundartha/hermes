// Wiederverwendbarer Phasen-Workflow: Plan -> Implementieren (isolierter Worktree) -> dualer
// Review (Safety/Verhalten + dedizierter Clean-Code-Auditor gegen .claude/refs/clean-code.md).
// Clean-Code S1/S2 = hartes Gate (Blocker).
//
// Aufruf (Workflow-Tool) - args ENTWEDER Objekt ODER String:
//   args = { phaseId:"P1", phaseTitle:"...", branch:"phase/p1-...", baseBranch:"master",
//            planDoc:"PLAN-X.md", extraNotes:"..." }   // volle Kontrolle
//   args = "Implementiere ... (freies Mandat)"          // String -> wird zu extraNotes,
//                                                        // generischer Branch, kein planDoc
// Fehlt args komplett -> der Lauf bricht LAUT ab (kein stiller Default-Task; das war der Bug,
// der eine fremde Phase still ausfuehrte).

export const meta = {
  name: "phase-impl",
  description:
    "Eine Umbau-Phase umsetzen: Plan -> Implementieren (Worktree) -> dualer Review (Safety/Verhalten + Clean-Code-Auditor). Clean-Code (.claude/refs/clean-code.md) ist hartes Gate (S1/S2 = Blocker).",
  phases: [
    { title: "Plan", detail: "Regelkonformer Umsetzungsplan (liest clean-code.md + Plan-Doku/Mandat + echten Code)" },
    { title: "Implementieren", detail: "Umsetzung im Worktree, clean-code-konform, npm test gruen" },
    { title: "Review", detail: "Safety/Verhalten-Reviewer + dedizierter Clean-Code-Auditor (parallel)" },
  ],
};

// Portabel (kein maschinen-spezifischer Hardcode mehr - das war der antonio-Pfad-Bug):
// OCLAW_REPO falls gesetzt, sonst "." (Spawn-cwd ist der Repo-/Worktree-Root, relative Pfade greifen).
const REPO =
  typeof process !== "undefined" && process.env && process.env.OCLAW_REPO
    ? process.env.OCLAW_REPO
    : ".";
const NODE_MODULES = `${REPO}/node_modules`;

// args normalisieren: Objekt (volle Kontrolle) ODER nicht-leerer String (freies Mandat) ODER
// LAUTER Abbruch. KEIN stiller Default-Task mehr.
const A =
  args && typeof args === "object"
    ? args
    : typeof args === "string" && args.trim()
      ? {
          phaseId: "TASK",
          phaseTitle: "(freies Mandat - siehe Auftrag unten)",
          branch: "phase/task-impl",
          baseBranch: "master",
          planDoc: "",
          extraNotes: args,
        }
      : (() => {
          throw new Error(
            "phase-impl benoetigt args: ein Objekt { phaseId, phaseTitle, branch, baseBranch, planDoc, extraNotes } ODER einen nicht-leeren String (freies Mandat). Es gibt bewusst KEINEN Default-Task.",
          );
        })();

const PHASE = A.phaseId || "TASK";
const PHASE_TITLE = A.phaseTitle || "";
const BRANCH = A.branch || `phase/${String(PHASE).toLowerCase()}-impl`;
const BASE = A.baseBranch || "master";
const EXTRA = A.extraNotes ? `\nAUFTRAG / ZUSATZ-HINWEISE DES AUFTRAGGEBERS:\n${A.extraNotes}\n` : "";
const PLAN_DOC = A.planDoc || ""; // leer = kein Plan-Doc; der Auftrag steht dann in EXTRA

const CLEAN_CODE_REQ = `CLEAN-CODE (PFLICHT, kein Optional): Lies "${REPO}/.claude/refs/clean-code.md" - der verbindliche Prueftkatalog dieses Repos - und befolge ihn bei JEDER Entscheidung. Keine Duplizierung (G5/S2) - gemeinsame Logik extrahieren. Keine Magic Numbers ausser 0/1/-1 (G25); Konfigurierbares in config.js (G35). Kein toter/auskommentierter Code (C5/G9), keine ungenutzten Imports/Variablen (G12). Intentions-ausdrueckende Namen (N-Serie), Nebeneffekte im Namen sichtbar (N7). Eine Aufgabe/Abstraktionsebene pro Funktion (G30/G34), <=3 Argumente (F1). Kein brittle Datei:Zeile-Verweis in Kommentaren (C2). Bestands-Konventionen (G24/G11): ESM, kein Build-Step, kein TypeScript, Kommentare deutsch OHNE Umlaute (ue/oe/ae). Neues Verhalten braucht automatisierten Test (P11/T-Serie); reiner Refactor -> Bestandssuite OHNE Test-Aenderung gruen.`;

const ABS_RULES = `ABSOLUTE REGELN (unantastbar, siehe CLAUDE.md):
- Safety-Gates (numberGateError: Denylist/Allowlist/Land/Stundenlimit/Budget/Max-Dauer/KYC/Subscriber/Minuten) NIE entfernen/aufweichen/per-Default umgehen. Neue Endpunkte, die Calls/SMS ausloesen, brauchen dieselben Gates.
- Disclosure-Satz (disclosureSentence, claude.js + bridge.js) bleibt fest verdrahtet, unveraendert.
- Auth fail-closed: Provider-Signaturpruefung /voice (Telnyx Ed25519; die Twilio-HMAC-Pruefung ist seit C-P3 per Owner-Entscheidung entfernt, ihr Fehlen ist KEIN Befund), Browser-Session (webAuthMw/adminMw) bzw. internalOnly, MCP-Auth - timing-sichere Vergleiche (safeEqual). Neue Endpunkte standardmaessig hinter Auth.
- Secrets nur via env, nie loggen/in Responses oder MCP-Ausgaben leaken. Audio nie durch MCP.
- SCOPE: NUR diese Phase. Keine ungefragten Extras.`;

const PLAN_DOC_STEP = PLAN_DOC
  ? `1. Lies "${REPO}/${PLAN_DOC}" und finde den Abschnitt "**${PHASE} — ...**" (Ziel, betroffene Dateien, deterministisch pruefbares Ergebnis, Risiko). Das ist der Auftrag dieser Phase.`
  : `1. Es gibt KEIN Plan-Doc - der Auftrag steht vollstaendig in den ZUSATZ-HINWEISEN unten. Lies sie als verbindliche Spec.`;

// ---------- Phase 1: Plan ----------
phase("Plan");
const plan = await agent(
  `Du erstellst den DETAILLIERTEN, code-gegroundeten und CLEAN-CODE-KONFORMEN Umsetzungsplan fuer Phase ${PHASE} ${PHASE_TITLE} im Repo "${REPO}". NUR PLANEN, NICHTS aendern.

${PLAN_DOC_STEP}
2. Lies "${REPO}/.claude/refs/clean-code.md" (Prueftkatalog) - dein Plan muss regelkonform sein.
3. Lies den ECHTEN Code auf Basis-Branch "${BASE}": grep gezielt nach den relevanten Symbolen/Call-Sites; bestaetige das Ist-Verhalten SELBST (Plan-Doc kann gedriftet sein, KEINE Zeilennummern blind glauben).

${CLEAN_CODE_REQ}
${ABS_RULES}${EXTRA}

LIEFERE: (1) exakte Liste neuer Dateien inkl. Funktionssignaturen + Inhalts-Skizze; (2) pro bestehender Datei die exakten Edits als Vorher/Nachher (Datei + Symbol, KEINE brittle Zeilennummern); (3) welche Tests neu/angepasst werden (oder Begruendung, warum die Bestandssuite reicht); (4) das deterministisch pruefbare Ergebnis dieser Phase als konkreten Check (Befehl + erwartete Ausgabe). Halte den Blast-Radius klein. Deine Rueckgabe IST der Plan.`,
  { label: `${PHASE}-plan`, phase: "Plan" },
);

// ---------- Phase 2: Implementieren + Verifizieren (Worktree) ----------
phase("Implementieren");
const IMPL_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    branch: { type: "string" },
    baseBranch: { type: "string" },
    filesCreated: { type: "array", items: { type: "string" } },
    filesEdited: { type: "array", items: { type: "string" } },
    testsAddedOrChanged: { type: "array", items: { type: "string" } },
    nodeCheckPass: { type: "boolean" },
    testsPass: { type: "boolean" },
    testPassCount: { type: "number" },
    testFailCount: { type: "number" },
    smokePass: { type: "boolean" },
    smokeNote: { type: "string" },
    cleanCodeSelfCheck: { type: "string", description: "kurze Selbstpruefung gegen clean-code.md" },
    committed: { type: "boolean" },
    deviations: { type: "array", items: { type: "string" } },
    diff: { type: "string", description: `voller git diff ${BASE} HEAD` },
    summary: { type: "string" },
  },
  required: ["branch", "nodeCheckPass", "testsPass", "testPassCount", "testFailCount", "committed", "diff", "summary"],
};
const impl = await agent(
  `Du arbeitest in einem FRISCHEN Git-Worktree (isoliert - du fasst den Working-Tree des Nutzers NICHT an). Setze Phase ${PHASE} ${PHASE_TITLE} GENAU gemaess diesem Plan um:

=== PLAN ===
${plan || "(Plan fehlt - brich ab und melde es in deviations)"}
=== ENDE PLAN ===

VORGEHEN:
1. node_modules fehlt im Worktree. ZUERST symlinken: ln -s "${NODE_MODULES}" node_modules
2. Branch von der Basis anlegen: git checkout -b ${BRANCH} ${BASE}
3. Implementiere EXAKT gemaess Plan. ${CLEAN_CODE_REQ}
4. node --check auf JEDE neue/geaenderte .js-Datei.
5. npm test (BEIDE Backends, json-Default + pglite). Bestehende Tests nur anpassen, wenn die Phase bewusst Verhalten aendert (im Plan begruendet); reiner Refactor -> Suite OHNE Test-Aenderung gruen. Neues Verhalten -> neuer Test im selben Lauf.
6. Smoke (best-effort): Server auf freiem Port mit SKIP_TWILIO_SIGNATURE_CHECK=true + Dummy-Env starten, betroffene Route via curl pruefen, Server killen. Zu flaky -> smokePass=false + Grund, KEIN Blocker.
7. node_modules-Symlink NICHT committen (git rm --cached node_modules falls gestaged). Dann: git add src/ test/ && git commit.
8. cleanCodeSelfCheck: eigenen Diff kurz gegen clean-code.md pruefen.
9. git diff ${BASE} HEAD vollstaendig im Feld diff erfassen.

${ABS_RULES}

Fuelle das Ergebnis EHRLICH. Tests nicht gruen oder blockiert -> testsPass=false + ehrliche deviations, NICHT schoenen.`,
  { label: `${PHASE}-implement`, phase: "Implementieren", schema: IMPL_SCHEMA, isolation: "worktree" },
);

// ---------- Phase 3: Dualer Review (parallel) ----------
phase("Review");
const SAFETY_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    testsPassIndependently: { type: "boolean" },
    independentTestSummary: { type: "string" },
    scopeRespected: { type: "boolean" },
    safetyGatesIntact: { type: "boolean" },
    disclosureIntact: { type: "boolean" },
    authFailClosedIntact: { type: "boolean" },
    noSecretsLeaked: { type: "boolean" },
    behaviorAsIntended: { type: "boolean" },
    approved: { type: "boolean" },
    blockers: { type: "array", items: { type: "string" } },
    concerns: { type: "array", items: { type: "string" } },
    verdict: { type: "string" },
  },
  required: ["approved", "testsPassIndependently", "safetyGatesIntact", "disclosureIntact", "blockers", "verdict"],
};
const CC_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    s1: { type: "array", items: { type: "string" }, description: 'Tests/Sicherheit/Korrektheit - "ID · Datei:Symbol · Verstoss · Fix"' },
    s2: { type: "array", items: { type: "string" }, description: "Duplizierung" },
    s3: { type: "array", items: { type: "string" }, description: "Ausdrucksstaerke/Namen/Kommentare" },
    s4: { type: "array", items: { type: "string" }, description: "Struktur/Anzahl" },
    blocker: { type: "boolean", description: "true wenn s1 oder s2 nicht leer" },
    passNotes: { type: "string" },
    topTodos: { type: "array", items: { type: "string" } },
    verdict: { type: "string" },
  },
  required: ["s1", "s2", "s3", "s4", "blocker", "verdict"],
};

const reviews = await parallel([
  () => agent(
    `Du bist ein STRENGER, adversarialer Safety-/Verhaltens-Reviewer in einem frischen Worktree. Pruefe Phase ${PHASE} auf Branch "${BRANCH}".
UNABHAENGIGE VERIFIKATION (selbst ausfuehren):
1. ln -s "${NODE_MODULES}" node_modules
2. git checkout -b review-${String(PHASE).toLowerCase()} ${BRANCH}
3. npm test selbst laufen lassen -> testsPassIndependently + Zahlen.
4. git diff ${BASE} ${BRANCH} lesen und gegen die absoluten Regeln pruefen.
PRUEFE: scopeRespected (nur ${PHASE}, keine Extras), safetyGatesIntact (numberGateError/Allowlist/Budget/Max-Dauer/KYC/Subscriber/Minuten), disclosureIntact (claude.js+bridge.js), authFailClosedIntact, noSecretsLeaked, behaviorAsIntended.
${ABS_RULES}
approved=true NUR wenn alles erfuellt UND deine eigenen Tests gruen. Sei skeptisch; im Zweifel blockieren. Rueckgabe IST das Urteil.`,
    { label: `${PHASE}-review-safety`, phase: "Review", schema: SAFETY_SCHEMA, isolation: "worktree" },
  ),
  () => agent(
    `Du bist der CLEAN-CODE-AUDITOR. Pruefe den Diff der Phase ${PHASE} (Branch "${BRANCH}", Basis "${BASE}") streng gegen den Prueftkatalog.
1. Lies "${REPO}/.claude/refs/clean-code.md" VOLLSTAENDIG (definiert S1-S4 + Audit-Regeln: nur gesehenen Code bewerten, nicht raten).
2. Lies den geaenderten Code: git diff ${BASE} ${BRANCH}; neue Dateien per git show ${BRANCH}:<pfad>.
3. Kategorie fuer Kategorie. Pro FLAG: "ID · Datei:Symbol · Verstoss · Fix" + Schweregrad (S1 Tests/Sicherheit/Korrektheit, S2 Duplizierung, S3 Ausdruck, S4 Struktur). S3/S4 gebuendelt.
blocker=true, wenn s1 ODER s2 nicht leer ist. passNotes: was sauber ist. topTodos: die 1-3 wichtigsten. Erfinde nichts (Audit-Regel 1).`,
    { label: `${PHASE}-review-cleancode`, phase: "Review", schema: CC_SCHEMA, isolation: "worktree" },
  ),
]);

const safetyReview = reviews[0];
const cleanCodeAudit = reviews[1];
const approved = !!(safetyReview && safetyReview.approved && cleanCodeAudit && !cleanCodeAudit.blocker);

return {
  phaseId: PHASE,
  branch: BRANCH,
  baseBranch: BASE,
  approved,
  gate: approved ? "PASS" : "BLOCKED (Safety nicht approved ODER Clean-Code S1/S2)",
  plan,
  impl,
  safetyReview,
  cleanCodeAudit,
};
