// SCHLANKES, SELBST-FIXENDES Phasen-Workflow (Lead bleibt duenn).
// Unterschiede zum kanonischen phase-impl.js:
//  1) ARGS-DRIVEN + FAIL-CLOSED: die Phase kommt ueber args (phaseId/specFile), NICHT
//     ueber einen hartkodierten A-Fallback. Fehlt args.phaseId -> sofortiger Abbruch
//     (KEIN Default-Phase-Bau -> kein "baut versehentlich eine gemergte Phase"-Unfall,
//     siehe Memory [[phase-impl-workflow-args]]).
//  2) SELF-FIX-LOOP: ist der Gate BLOCKED (Safety nicht approved ODER Clean-Code S1/S2),
//     fixt ein Fix-Agent die Blocker im Worktree und der Review laeuft erneut - bis PASS
//     oder MAX_FIX_ROUNDS erschoepft. So muss der Lead NIE einen Diff lesen/fixen.
//  3) POSTAGE-STAMP-RETURN: der Workflow gibt nur eine kleine Zusammenfassung zurueck
//     (gate/finalBranch/testPassCount/blocker-Kurztitel) - NICHT plan/diff/volle Reviews.
//     Die Details schreibt ein Report-Agent in tasks/<phase>-report.md (Lead liest sie NICHT).
//
// AUFRUF (Lead): Workflow({ scriptPath: ".../phase-impl-lean.js", args: {
//   phaseId:"P6b2", phaseTitle:"...", branch:"phase/p6b2-async-worker", baseBranch:"master",
//   planDoc:"PLAN-MULTI-TENANT-TELNYX.md", specFile:"tasks/p6-rest-chain.md", maxFixRounds:2 } })
// KEIN resume. Der Lead merged danach den ZURUECKGEGEBENEN finalBranch (kann BRANCH oder
// BRANCH-fixN sein), NICHT blind BRANCH.

export const meta = {
  name: "phase-impl-lean",
  description:
    "Schlankes selbst-fixendes Phasen-Workflow: Plan -> Impl (Worktree) -> dualer Review -> Self-Fix bis PASS -> kompakter Return + Report-Datei. Lead bleibt duenn.",
  phases: [
    {
      title: "Plan",
      detail:
        "Code-gegroundeter Umsetzungsplan (clean-code.md + Plan-Doku + specFile + echter Code)",
    },
    { title: "Implementieren", detail: "Umsetzung im Worktree, npm test gruen, commit" },
    { title: "Review", detail: "Safety/Verhalten + Clean-Code-Auditor (parallel)" },
    {
      title: "Self-Fix",
      detail: "S1/S2/Safety-Blocker fixen + Re-Review, bis PASS oder maxFixRounds",
    },
    { title: "Report", detail: "Detailbericht in tasks/<phase>-report.md (Lead liest ihn nicht)" },
  ],
};

// Spawn-fest: im ACP-/Spawn-Kontext gibt es kein process-Global. Dann faellt REPO
// auf '.' zurueck (Spawn-cwd ist der Worktree-Root, relative Pfade greifen korrekt).
const REPO =
  typeof process !== "undefined" && process.env && process.env.OCLAW_REPO
    ? process.env.OCLAW_REPO
    : typeof process !== "undefined" && typeof process.cwd === "function"
      ? process.cwd()
      : ".";
const NODE_MODULES = `${REPO}/node_modules`;

// HART GEPINNT (Lehre [[phase-impl-workflow-args]]): die Phase kommt NICHT ueber args,
// sondern steht als Literal in dieser per-run Datei. args wird bewusst IGNORIERT.
const A = {
  phaseId: "P8",
  phaseTitle: "Pre-Call-Briefing (starkes Modell fuellt call.context)",
  sectionHeading: "### P8 — Pre-Call-Briefing (starkes Modell füllt `call.context`)",
  sectionLines: "1350-1394",
  branch: "phase/cq-p8-briefing",
  extraNote:
    "WICHTIG P8: Anhang B beschreibt die beiden Seiten des Briefing-Dialogs (## 6. Anhang B, etwa Zeilen 1602-1672) - lies ihn mit. P8 setzt auf P7a auf (per-Modell-Preise sind gemergt): jedes zusaetzliche Modell, das du hier aufrufst, MUSS mit seiner Modell-ID in config.llm.modelPricesUsd stehen, sonst rechnet das Budget-Gate es fail-closed zum teuersten Preis ab. Der Budget-Guard (Absolute Regel 1) gilt fuer den Briefing-Aufruf genauso wie fuer Gespraechs-Turns - ein Briefing-LLM-Call ohne Kostenverbuchung waere ein Loch im Gate. Owner-Entscheidung E1 bleibt bindend: kein Buchen, kein Kalender. Das Feature gehoert hinter ein Flag (Fail-Soft), und flag-off muss byte-identisches Bestandsverhalten liefern. Es gibt KEINE Bench-Baseline; Bench-Messlaeufe und Probeanrufe mit echten Kosten sind KEIN Agenten-Schritt.",
};

const PHASE = A.phaseId;
const PHASE_TITLE = A.phaseTitle;
const SECTION_HEADING = A.sectionHeading;
const SECTION_LINES = A.sectionLines;
const BRANCH = A.branch;
const BASE = "master";
const PLAN_DOC = "PLAN-CONVERSATION-QUALITY-V2.md";
const MAX_FIX_ROUNDS = 2;
const REPORT_PATH = `tasks/cq-${String(PHASE).toLowerCase()}-report.md`;

// Modell-Pins (Lehre [[workflow-model-policy]]): Subagenten erben NIE das Lead-Modell.
const M_PLAN = "opus";
const M_IMPL = "sonnet";
const M_SAFETY = "opus";
const M_AUDIT = "sonnet";
const M_FIX = "sonnet";
const M_REPORT = "sonnet";

const CLEAN_CODE_REQ = `CLEAN-CODE (PFLICHT): Lies "${REPO}/.claude/refs/clean-code.md" (verbindlicher Prueftkatalog) und befolge ihn bei JEDER Code-Entscheidung. Insbesondere: keine Duplizierung (G5/S2, gemeinsame Logik extrahieren); keine Magic Numbers ausser 0/1/-1 (G25, benannte Konstante, in config.js wenn konfigurierbar G35); kein toter/auskommentierter Code (C5/G9), keine ungenutzten Imports (G12); intentions-ausdrueckende Namen, Nebeneffekte im Namen sichtbar (N7); eine Aufgabe + eine Abstraktionsebene pro Funktion (G30/G34), <=3 Argumente (F1, sonst Objekt); Lazy-Init-Antipattern vermeiden (P15); keine brittle Datei:Zeile-Kommentare (C2); ESM, kein Build-Step, kein TypeScript, Kommentare deutsch OHNE Umlaute (ue/oe/ae); neues Verhalten braucht einen automatisierten Test (P11/T-Serie), reiner Refactor laesst die Bestandssuite OHNE Test-Aenderung gruen.`;

const ABS_RULES = `ABSOLUTE REGELN (unantastbar, siehe CLAUDE.md):
- Safety-Gates (numberGateError: Denylist/Allowlist/Land/Stundenlimit/Budget/Max-Dauer) NIE entfernen/aufweichen/per-Default umgehen. Neue Endpunkte, die Calls/SMS/Geld ausloesen, brauchen dieselben Gates.
- Disclosure-Satz (disclosureSentence, claude.js + bridge.js) bleibt fest verdrahtet, unveraendert.
- Auth fail-closed: Twilio-Signaturpruefung (/voice), Basic-Auth (Dashboard/API), MCP-Auth - timing-sichere Vergleiche (safeEqual). Neue Endpunkte standardmaessig hinter Auth.
- Secrets nur via env, nie loggen/in Responses oder MCP-Ausgaben leaken. Audio nie durch MCP.
- SCOPE: NUR diese Phase. Keine ungefragten Extras. Keine neuen npm-Dependencies ohne explizite Freigabe in der Spec.`;

const specInstruction = `Lies in "${REPO}/${PLAN_DOC}" den Abschnitt "${SECTION_HEADING}" (etwa Zeilen ${SECTION_LINES}; verifiziere die Grenzen selbst per grep -n "^### P", Zeilennummern koennen driften). Das ist die AUTORITATIVE Scope-/Design-/Invarianten-/Abgrenzungs-Definition dieser Phase. Lies ZUSAETZLICH "## 0. Owner-Entscheidungen" (etwa Zeilen 31-58) - E1/E2/E3 sind bindend und stehen ueber jeder Analyse im restlichen Dokument. Setze NUR ${PHASE} um, KEINE andere Phase.${A.extraNote ? `\n${A.extraNote}` : ""}`;

const OWNER_WORK = `NICHT-AGENTEN-ARBEIT (Konvention aus Plan-§0): Schritte, die der Plan als "NICHT-AGENTEN-ARBEIT" oder mit einem Verbots-Symbol markiert (echte Probeanrufe, Render-Dashboard-Flips, Bench-Laeufe mit echten API-Kosten, Aenderungen an apps/web bzw. der Datenschutzerklaerung), NICHT versuchen, NICHT umgehen, NICHT mocken - und NICHT als Fehlschlag werten. Sie sind KEIN Teil des Abnahmekriteriums. Nenne sie als offene Owner-/Deploy-Auflage. Die Phase gilt als abgeschlossen, wenn ihr Agenten-Anteil gruen ist.
KEIN git push (weder origin noch upstream). KEIN git stash. KEIN git add -A (im Haupt-Tree liegen unrelated lokale Aenderungen). Neue config-Env-Var? IMMER in .env.example UND in test/helpers.js BASE_ENV nachziehen.
FLAKE-PROTOKOLL: test/p5-gate-proof hat ~12% Voll-Last-Flake. Rot gilt nur als echt, wenn die Datei ISOLIERT (node --test test/<datei>.test.js) rot bleibt.
TEST-PINS: Pin-Listen des Plans ueber Testnamen und Treffer aufloesen, NIE ueber die dort genannten Zeilennummern.`;

// ---------- Phase 1: Plan ----------
phase("Plan");
const plan = await agent(
  `Du erstellst den DETAILLIERTEN, code-gegroundeten, CLEAN-CODE-KONFORMEN Umsetzungsplan fuer Phase ${PHASE} ${PHASE_TITLE} im Repo "${REPO}". NUR PLANEN, NICHTS aendern.
1. ${specInstruction}
2. Lies "${REPO}/${PLAN_DOC}" als Umbrella-Kontext und "${REPO}/.claude/refs/clean-code.md".
3. Lies den ECHTEN Code auf Basis "${BASE}" (Arbeitsbaum bzw. git show ${BASE}:<pfad>). Grep gezielt nach den relevanten Symbolen/Call-Sites - KEINE Zeilennummern uebernehmen (sie rotten).
${CLEAN_CODE_REQ}
${ABS_RULES}
${OWNER_WORK}
LIEFERE: (1) neue Dateien inkl. Funktionssignaturen + Inhalts-Skizze; (2) pro bestehender Datei die exakten Edits (Vorher/Nachher); (3) neue/angepasste Tests (oder Begruendung, warum die Bestandssuite reicht); (4) das deterministisch pruefbare Ergebnis (Befehl + erwartete Ausgabe); (5) die offenen Owner-/Deploy-Auflagen. Kleiner Blast-Radius. Deine Rueckgabe IST der Plan.`,
  { label: `${PHASE}-plan`, phase: "Plan", model: M_PLAN },
);

// ---------- Phase 2: Implementieren (Worktree) ----------
phase("Implementieren");
const IMPL_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    headCommit: { type: "string", description: "git rev-parse HEAD nach dem Commit" },
    filesCreated: { type: "array", items: { type: "string" } },
    filesEdited: { type: "array", items: { type: "string" } },
    testsAddedOrChanged: { type: "array", items: { type: "string" } },
    nodeCheckPass: { type: "boolean" },
    testsPass: { type: "boolean" },
    testPassCount: { type: "number" },
    testFailCount: { type: "number" },
    smokePass: { type: "boolean" },
    smokeNote: { type: "string" },
    cleanCodeSelfCheck: { type: "string" },
    committed: { type: "boolean" },
    deviations: { type: "array", items: { type: "string" } },
    ownerTodo: {
      type: "array",
      items: { type: "string" },
      description:
        "Offene NICHT-AGENTEN-ARBEIT / Owner-/Deploy-Auflagen dieser Phase (Probeanruf, Render-Flip, Bench-Lauf, Datenschutz-Text, Bestandsdaten-Umstellung). Leeres Array, wenn keine.",
    },
    summary: { type: "string" },
  },
  required: [
    "headCommit",
    "nodeCheckPass",
    "testsPass",
    "testPassCount",
    "testFailCount",
    "committed",
    "summary",
  ],
};
const impl = await agent(
  `Du arbeitest in einem FRISCHEN Git-Worktree (isoliert; Working-Tree des Nutzers NICHT anfassen). Setze Phase ${PHASE} ${PHASE_TITLE} GENAU gemaess Plan um:
=== PLAN ===
${plan || "(Plan fehlt - brich ab, melde es in deviations)"}
=== ENDE PLAN ===
VORGEHEN:
1. ln -s "${NODE_MODULES}" node_modules
2. git checkout -b ${BRANCH} ${BASE}
3. Implementiere EXAKT gemaess Plan. ${CLEAN_CODE_REQ}
4. node --check auf JEDE neue/geaenderte .js-Datei.
5. npm test (beide Backends: json-Default + pglite-in-process). Bestandstests nur bei bewusster Verhaltens-/Signatur-Aenderung anpassen (im Plan begruendet); neues Verhalten -> neuer Test.
6. Smoke (best-effort): Server auf freiem Port mit SKIP_TWILIO_SIGNATURE_CHECK=true + Dummy-Env, betroffene Route via curl; zu flaky -> smokePass=false + Grund (kein Blocker).
7. node_modules-Symlink NICHT committen. git add (nur die betroffenen src/test/config/doc-Dateien) && git commit. headCommit = git rev-parse HEAD.
${ABS_RULES}
${OWNER_WORK}
EHRLICH fuellen. Tests nicht gruen / blockiert -> testsPass=false + deviations, nicht schoenen.`,
  {
    label: `${PHASE}-implement`,
    phase: "Implementieren",
    schema: IMPL_SCHEMA,
    isolation: "worktree",
    model: M_IMPL,
  },
);

// ---------- Phase 3: Dualer Review (parallel, wiederholbar) ----------
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
  required: [
    "approved",
    "testsPassIndependently",
    "safetyGatesIntact",
    "disclosureIntact",
    "blockers",
    "verdict",
  ],
};
const CC_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    s1: {
      type: "array",
      items: { type: "string" },
      description: 'Tests/Sicherheit/Korrektheit - "ID · Datei · Verstoss · Fix"',
    },
    s2: { type: "array", items: { type: "string" }, description: "Duplizierung" },
    s3: { type: "array", items: { type: "string" } },
    s4: { type: "array", items: { type: "string" } },
    blocker: { type: "boolean", description: "true wenn s1 oder s2 nicht leer" },
    passNotes: { type: "string" },
    topTodos: { type: "array", items: { type: "string" } },
    verdict: { type: "string" },
  },
  required: ["s1", "s2", "s3", "s4", "blocker", "verdict"],
};

async function runReview(target, suffix) {
  return await parallel([
    () =>
      agent(
        `STRENGER, adversarialer Safety-/Verhaltens-Reviewer in frischem Worktree. Pruefe Phase ${PHASE} auf Branch "${target}".
1. ln -s "${NODE_MODULES}" node_modules
2. git checkout -b review-${String(PHASE).toLowerCase()}${suffix} ${target}
3. npm test selbst (beide Backends) -> testsPassIndependently + Zahlen.
4. git diff ${BASE} ${target} gegen die absoluten Regeln pruefen.
PRUEFE: scopeRespected (nur ${PHASE}, keine Extras, kein ungefragter npm-Dep), safetyGatesIntact, disclosureIntact (claude.js+bridge.js), authFailClosedIntact, noSecretsLeaked, behaviorAsIntended (flag-off byte-identisch, Invarianten wie in der Spec).
${ABS_RULES}
approved=true NUR wenn alles erfuellt UND deine Tests gruen. Im Zweifel blockieren. Rueckgabe IST das Urteil.`,
        {
          label: `${PHASE}-review-safety${suffix}`,
          phase: "Review",
          schema: SAFETY_SCHEMA,
          isolation: "worktree",
          model: M_SAFETY,
        },
      ),
    () =>
      agent(
        `CLEAN-CODE-AUDITOR. Pruefe den Diff der Phase ${PHASE} (Branch "${target}", Basis "${BASE}") streng gegen den Katalog.
1. Lies "${REPO}/.claude/refs/clean-code.md" VOLLSTAENDIG (definiert S1-S4 + Audit-Regeln: nur gesehenen Code bewerten, nicht raten).
2. git diff ${BASE} ${target} ; neue Dateien per git show ${target}:<pfad>.
3. Kategorie fuer Kategorie. Pro FLAG: "ID · Datei · Verstoss · Fix" + Schweregrad (S1 Tests/Sicherheit/Korrektheit, S2 Duplizierung, S3 Ausdrucksstaerke, S4 Struktur/Anzahl). S3/S4 gebuendelt.
blocker=true wenn s1 ODER s2 nicht leer. passNotes: was sauber ist. topTodos: 1-3 wichtigste. Erfinde nichts.`,
        {
          label: `${PHASE}-review-cleancode${suffix}`,
          phase: "Review",
          schema: CC_SCHEMA,
          isolation: "worktree",
          model: M_AUDIT,
        },
      ),
  ]);
}

const gateOk = (s, c) => !!(s && s.approved && c && !c.blocker);
const blockerList = (s, c) => [
  ...((s && s.blockers) || []),
  ...((c && c.s1) || []),
  ...((c && c.s2) || []),
];

phase("Review");
let reviewTarget = BRANCH;
let [safety, cc] = await runReview(reviewTarget, "");

// ---------- Phase 4: Self-Fix-Loop ----------
const FIX_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    headCommit: { type: "string" },
    addressed: { type: "array", items: { type: "string" } },
    filesTouched: { type: "array", items: { type: "string" } },
    testsPass: { type: "boolean" },
    testPassCount: { type: "number" },
    testFailCount: { type: "number" },
    committed: { type: "boolean" },
    summary: { type: "string" },
  },
  required: ["headCommit", "testsPass", "committed", "summary"],
};
let round = 0;
const fixSummaries = [];
while (!gateOk(safety, cc) && round < MAX_FIX_ROUNDS) {
  round++;
  phase("Self-Fix");
  const fixBranch = `${BRANCH}-fix${round}`;
  const blockers = blockerList(safety, cc);
  const fix = await agent(
    `Du behebst die REVIEW-BLOCKER der Phase ${PHASE} in einem frischen Worktree. NUR die Blocker fixen, kein Scope-Drift.
1. ln -s "${NODE_MODULES}" node_modules
2. git checkout -b ${fixBranch} ${reviewTarget}
3. Behebe DIESE Blocker (S1 Korrektheit/Sicherheit + S2 Duplizierung + Safety-Blocker) sauber und minimal; fuer jeden korrektheits-/sicherheitsrelevanten Fix einen Regressionstest:
${JSON.stringify(blockers, null, 1)}
${CLEAN_CODE_REQ}
${ABS_RULES}
4. node --check + npm test (beide Backends) gruen. node_modules NICHT committen. git add (betroffene Dateien) && git commit -m "fix(${String(PHASE).toLowerCase()}): Review-Blocker beheben (Runde ${round})". headCommit = git rev-parse HEAD.
EHRLICH: was du NICHT loesen konntest, in summary nennen.`,
    {
      label: `${PHASE}-fix-r${round}`,
      phase: "Self-Fix",
      schema: FIX_SCHEMA,
      isolation: "worktree",
      model: M_FIX,
    },
  );
  fixSummaries.push(
    `r${round}: ${fix && fix.summary ? fix.summary.slice(0, 300) : "(kein Ergebnis)"}`,
  );
  reviewTarget = fixBranch;
  [safety, cc] = await runReview(reviewTarget, `-r${round}`);
}

const approved = gateOk(safety, cc);

// ---------- Phase 5: Report-Datei (Lead liest sie NICHT) ----------
phase("Report");
let reportPath = "";
try {
  const reportAgent = await agent(
    `Schreibe einen Detailbericht der Phase ${PHASE} in die Datei "${REPO}/${REPORT_PATH}" (im Haupt-Repo, NICHT in einem Worktree; lege tasks/ an, falls noetig). NICHTS am Code aendern, KEIN git-Commit.
Inhalt (Markdown): Phase ${PHASE} ${PHASE_TITLE}; Gate=${approved ? "PASS" : "BLOCKED"}; finalBranch=${reviewTarget}; Plan (gekuerzt); Impl-Zusammenfassung + deviations; Safety-Urteil; Clean-Code-Audit (s1-s4); Fix-Runden. Quelle:
=== PLAN ===
${plan || ""}
=== IMPL ===
${JSON.stringify(impl, null, 1)}
=== SAFETY (final) ===
${JSON.stringify(safety, null, 1)}
=== CLEANCODE (final) ===
${JSON.stringify(cc, null, 1)}
=== FIXES ===
${fixSummaries.join("\n")}
Nenne im Report eine eigene Sektion "Offene Owner-/Deploy-Auflagen" (NICHT-AGENTEN-ARBEIT, Restrisiken, Bestandsdaten-Auflagen).
Antworte NUR mit dem geschriebenen Dateipfad.`,
    { label: `${PHASE}-report`, phase: "Report", model: M_REPORT },
  );
  reportPath = (reportAgent || "").toString().trim().slice(0, 300) || REPORT_PATH;
} catch {
  reportPath = "(Report fehlgeschlagen)";
}

// ---------- POSTAGE-STAMP-RETURN (klein, damit der Lead duenn bleibt) ----------
return {
  phaseId: PHASE,
  finalBranch: reviewTarget,
  baseBranch: BASE,
  gate: approved ? "PASS" : "BLOCKED",
  approved,
  headCommit: (round > 0 ? null : impl && impl.headCommit) || null,
  testPassCount: (impl && impl.testPassCount) || null,
  filesTouched: [
    ...((impl && impl.filesCreated) || []),
    ...((impl && impl.filesEdited) || []),
  ].slice(0, 40),
  fixRounds: round,
  fixSummaries,
  remainingBlockers: approved ? [] : blockerList(safety, cc),
  ownerTodo: (impl && impl.ownerTodo) || [],
  testsFailed: (impl && impl.testFailCount) ?? null,
  reportPath,
  summary: impl && impl.summary ? impl.summary.slice(0, 600) : "",
};
