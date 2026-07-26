// EINMALIGER Per-Run-Wrapper fuer P15 (Lead, 2026-07-26).
// Identisch zu .claude/workflows/phase-impl-lean.js, mit EINEM Unterschied: die Phase ist
// HART GEPINNT statt aus args gelesen (Memory [[phase-impl-workflow-args]] - args-Misfires
// haben in dieser Kette schon zweimal die falsche Phase gebaut). Zusaetzlich "Regel 0":
// der Worktree wird gegen den erwarteten Basis-Commit geprueft, weil isolation:worktree die
// Worktrees NICHT zuverlaessig auf master anlegt (Memory [[workflow-worktree-stale-base]]).

export const meta = {
  name: "p15-run",
  description:
    "P15 Sprachreinheits-Rest (E2E-06): Plan -> Impl (Worktree) -> dualer Review -> Self-Fix bis PASS -> Report. Phase hart gepinnt.",
  phases: [
    {
      title: "Plan",
      detail: "Code-gegroundeter Umsetzungsplan (clean-code.md + PLAN-I18N-FIX + p15-spec + Code)",
    },
    { title: "Implementieren", detail: "Umsetzung im Worktree, npm test + test:gates, commit" },
    { title: "Review", detail: "Safety/Verhalten (opus/xhigh) + Clean-Code-Auditor (parallel)" },
    { title: "Self-Fix", detail: "S1/S2/Safety-Blocker fixen + Re-Review, bis PASS oder 2 Runden" },
    { title: "Report", detail: "Detailbericht in tasks/p15-report.md (Lead liest ihn nicht)" },
  ],
};

const REPO =
  typeof process !== "undefined" && process.env && process.env.OCLAW_REPO
    ? process.env.OCLAW_REPO
    : typeof process !== "undefined" && typeof process.cwd === "function"
      ? process.cwd()
      : ".";
const NODE_MODULES = `${REPO}/node_modules`;

// HART GEPINNT - bewusst KEIN args-Lesen.
const PHASE = "P15";
const PHASE_TITLE = "Sprachreinheits-Rest (E2E-06)";
const BRANCH = "phase/i18n-p15-sprachreinheit";
const BASE = "master";
const BASE_COMMIT = "18556df";
const PLAN_DOC = "PLAN-I18N-FIX.md";
const SPEC_FILE = "tasks/p15-spec.md";
const MAX_FIX_ROUNDS = 2;
const REPORT_PATH = "tasks/p15-report.md";

// MODELL-POLITIK (Memory [[workflow-model-policy]]): jeder agent() explizit gepinnt.
// P15 fasst src/telephony/outbound-gates.js an - die Datei, in der die Safety-Gates
// entscheiden. Deshalb HIGH_STAKES: Impl auf opus, Safety-Review eine Stufe schaerfer.
const PLAN_AGENT = { model: "opus", effort: "high" };
const IMPL_AGENT = { model: "opus", effort: "high" };
const SAFETY_AGENT = { model: "opus", effort: "xhigh" };
const CLEANCODE_AGENT = { model: "sonnet", effort: "medium" };
const FIX_AGENT = { model: "sonnet", effort: "medium" };
const REPORT_AGENT = { model: "sonnet", effort: "low" };

const REGEL_0 = `REGEL 0 (Basis pruefen, bevor du irgendetwas tust): nach dem Anlegen des Branches "git log --oneline -1" und "git merge-base --is-ancestor ${BASE_COMMIT} HEAD" ausfuehren. Ist ${BASE_COMMIT} KEIN Vorfahre, sitzt du auf einem veralteten Worktree-Stand: dann "git fetch . ${BASE}:${BASE}" bzw. neu von origin-losem lokalem ${BASE} auschecken und erneut pruefen. Erst danach implementieren.`;

const CLEAN_CODE_REQ = `CLEAN-CODE (PFLICHT): Lies "${REPO}/.claude/refs/clean-code.md" (verbindlicher Prueftkatalog) und befolge ihn bei JEDER Code-Entscheidung. Insbesondere: keine Duplizierung (G5/S2, gemeinsame Logik extrahieren); keine Magic Numbers ausser 0/1/-1 (G25, benannte Konstante, in config.js wenn konfigurierbar G35); kein toter/auskommentierter Code (C5/G9), keine ungenutzten Imports (G12); intentions-ausdrueckende Namen, Nebeneffekte im Namen sichtbar (N7); eine Aufgabe + eine Abstraktionsebene pro Funktion (G30/G34), <=3 Argumente (F1, sonst Objekt); Lazy-Init-Antipattern vermeiden (P15-Regel des Katalogs); keine brittle Datei:Zeile-Kommentare (C2); ESM, kein Build-Step, kein TypeScript, Kommentare deutsch OHNE Umlaute (ue/oe/ae); neues Verhalten braucht einen automatisierten Test (P11/T-Serie), reiner Refactor laesst die Bestandssuite OHNE Test-Aenderung gruen.`;

const ABS_RULES = `ABSOLUTE REGELN (unantastbar, siehe CLAUDE.md):
- Safety-Gates (numberGateError: Denylist/Land/Stundenlimit/Budget/Max-Dauer) NIE entfernen/aufweichen/per-Default umgehen. In P15 wird in outbound-gates.js AUSSCHLIESSLICH der Anzeigetext einer bereits gefallenen Ablehnung veraendert - keine Bedingung, keine Schwelle, keine Reihenfolge, kein Grund-Schluessel.
- Disclosure-Satz (disclosureSentence, claude.js + bridge.js) bleibt fest verdrahtet, unveraendert.
- Auth fail-closed: Signaturpruefung (/voice), Dashboard/API-Auth, MCP-Auth - timing-sichere Vergleiche (safeEqual). Neue Endpunkte standardmaessig hinter Auth.
- Secrets nur via env, nie loggen/in Responses oder MCP-Ausgaben leaken. Audio nie durch MCP.
- SCOPE: NUR diese Phase, exakt nach tasks/p15-spec.md Abschnitt 1. Abschnitt 2 der Spec ("Ausdruecklich NICHT Teil") ist bindend - insbesondere: KEIN convo-bench (kostet echtes Geld), KEIN Deploy/Push, keine neue npm-Dependency, keine neue Env-Variable.`;

// ---------- Phase 1: Plan ----------
phase("Plan");
const plan = await agent(
  `Du erstellst den DETAILLIERTEN, code-gegroundeten, CLEAN-CODE-KONFORMEN Umsetzungsplan fuer Phase ${PHASE} ${PHASE_TITLE} im Repo "${REPO}". NUR PLANEN, NICHTS aendern.
1. Lies "${REPO}/${SPEC_FILE}" VOLLSTAENDIG - das ist die AUTORITATIVE Scope-/Design-/Invarianten-/Abgrenzungs-Definition dieser Phase (verbindlich vor dem Plan-Doc).
2. Lies in "${REPO}/${PLAN_DOC}" den Abschnitt "### P15 - Sprachreinheits-Rest" sowie die Owner-Zeile **O14** in Abschnitt 3 (bindend) und Auflage **A3** in Abschnitt 4. Lies "${REPO}/.claude/refs/clean-code.md".
3. Lies den ECHTEN Code auf Basis "${BASE}" (${BASE_COMMIT}): mindestens test/e2e-06-en-purity-aggregate.test.js, src/telephony/outbound-gates.js, src/mcp-tools.js, src/i18n/mcp-texts.js, public/tenant.html, package.json (config.i18nCatalogPattern). Grep gezielt nach den relevanten Symbolen/Call-Sites - KEINE Zeilennummern uebernehmen (sie rotten).
4. Kernfrage, die dein Plan beantworten MUSS: aus welcher EINEN Quelle bekommt outbound-gates.js die Tenant-Sprache, ohne eine zweite Aufloesungsregel einzufuehren? Belege am Code, wer die Gate-Ablehnung heute an den Nutzer ausliefert (REST/MCP) und wo dort bereits ein aufgeloestes Locale vorliegt.
${CLEAN_CODE_REQ}
${ABS_RULES}
LIEFERE: (1) neue Dateien inkl. Funktionssignaturen + Inhalts-Skizze; (2) pro bestehender Datei die exakten Edits (Vorher/Nachher); (3) neue/angepasste Tests inkl. der Pin-Tests aus den Spec-Invarianten (Grund-Schluessel, Emphase-Marker); (4) das deterministisch pruefbare Ergebnis (Befehl + erwartete Ausgabe) gemaess Spec Abschnitt 3. Kleiner Blast-Radius. Deine Rueckgabe IST der Plan.`,
  { label: `${PHASE}-plan`, phase: "Plan", ...PLAN_AGENT },
);

// ---------- Phase 2: Implementieren (Worktree) ----------
phase("Implementieren");
const IMPL_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    headCommit: { type: "string" },
    filesCreated: { type: "array", items: { type: "string" } },
    filesEdited: { type: "array", items: { type: "string" } },
    testsAddedOrChanged: { type: "array", items: { type: "string" } },
    nodeCheckPass: { type: "boolean" },
    testsPass: { type: "boolean" },
    testPassCount: { type: "number" },
    testFailCount: { type: "number" },
    gatesRedIds: {
      type: "array",
      items: { type: "string" },
      description: "Katalog-IDs, die in npm run test:gates NACH der Umsetzung noch rot sind",
    },
    smokePass: { type: "boolean" },
    smokeNote: { type: "string" },
    cleanCodeSelfCheck: { type: "string" },
    committed: { type: "boolean" },
    deviations: { type: "array", items: { type: "string" } },
    summary: { type: "string" },
  },
  required: [
    "headCommit",
    "nodeCheckPass",
    "testsPass",
    "testPassCount",
    "testFailCount",
    "gatesRedIds",
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
3. ${REGEL_0}
4. Lies "${REPO}/${SPEC_FILE}" selbst - der Plan ist die Umsetzung, die Spec ist der Vertrag. Bei Widerspruch gewinnt die Spec.
5. Implementiere EXAKT gemaess Plan. ${CLEAN_CODE_REQ}
6. node --check auf JEDE neue/geaenderte .js-Datei.
7. npm test (beide Backends: json-Default + pglite-in-process) MUSS gruen sein (Vorher-Wert auf ${BASE_COMMIT}: 3271/3271/0).
8. npm run test:gates fahren - das ist das ABNAHMEKRITERIUM dieser Phase. Vorher 4 rot (E2E-06, GAP-05, GAP-15 x2), erwartet nachher 3 rot OHNE E2E-06. Trage die noch roten Katalog-IDs in gatesRedIds ein - ehrlich, auch wenn es nicht die erwarteten sind.
9. Smoke (best-effort): Server auf freiem Port mit SKIP_TWILIO_SIGNATURE_CHECK=true + Dummy-Env, ein abgelehnter Outbound eines EN-Tenants via curl; zu flaky -> smokePass=false + Grund (kein Blocker).
10. node_modules-Symlink NICHT committen. git add (nur die betroffenen src/test/public/doc-Dateien) && git commit. headCommit = git rev-parse HEAD.
${ABS_RULES}
EHRLICH fuellen. Tests nicht gruen / blockiert -> testsPass=false + deviations, nicht schoenen. NIEMALS einen Testfall abschwaechen, um gruen zu werden (Spec Abschnitt 1, T4-Verbotsliste).`,
  {
    label: `${PHASE}-implement`,
    phase: "Implementieren",
    schema: IMPL_SCHEMA,
    isolation: "worktree",
    ...IMPL_AGENT,
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
    testWeakened: {
      type: "boolean",
      description: "true, wenn eine Testerwartung gesenkt statt der Code gefixt wurde (T4-Verbot)",
    },
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
    "testWeakened",
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
3. npm test selbst (beide Backends) -> testsPassIndependently + Zahlen. Zusaetzlich npm run test:gates: es duerfen NUR noch GAP-05 und GAP-15 rot sein.
4. git diff ${BASE} ${target} gegen die absoluten Regeln pruefen. Lies "${REPO}/${SPEC_FILE}" als Vertrag.
PRUEFE BESONDERS (das sind die Todesursachen dieser Phase):
- outbound-gates.js: wurde AUSSCHLIESSLICH Anzeigetext veraendert? Ist JEDE Gate-Bedingung, Schwelle, Reihenfolge und jeder reason/grund-Schluessel byte-identisch zur Basis? Ein verschobener Grund-Schluessel ist ein BLOCKER (die Betriebs-Forensik unterscheidet grund=reserve von grund=budget).
- testWeakened: wurde E2E-06 gruen gemacht, indem GERMAN_STOPWORDS aufgeweicht, ein Kanal entfernt, TOTAL_CHECKED_LABELS gesenkt oder die Erwartung abgeschwaecht wurde? Erlaubt ist NUR die in der Spec (T4) beschriebene Eingrenzung auf tenant-sichtbaren Text. Alles andere ist ein BLOCKER.
- O14: die MCP-Tool-Beschreibungen muessen EINSPRACHIG ENGLISCH sein, ohne Sprachverzweigung. Und sie muessen die Emphase des deutschen Originals tragen (Grossschreib-Marker, Negationen, Negativ-Beispiele). Eine weichgespuelte Uebersetzung ist ein Befund.
- DE-Byte-Identitaet: sieht ein DE-Tenant exakt dieselben Texte wie vorher?
Weiter: scopeRespected (nur ${PHASE}, keine Extras, kein ungefragter npm-Dep, kein convo-bench-Lauf), safetyGatesIntact, disclosureIntact, authFailClosedIntact, noSecretsLeaked, behaviorAsIntended.
${ABS_RULES}
approved=true NUR wenn alles erfuellt UND deine Tests gruen UND testWeakened=false. Im Zweifel blockieren. Rueckgabe IST das Urteil.`,
        {
          label: `${PHASE}-review-safety${suffix}`,
          phase: "Review",
          schema: SAFETY_SCHEMA,
          isolation: "worktree",
          ...SAFETY_AGENT,
        },
      ),
    () =>
      agent(
        `CLEAN-CODE-AUDITOR. Pruefe den Diff der Phase ${PHASE} (Branch "${target}", Basis "${BASE}") streng gegen den Katalog.
1. Lies "${REPO}/.claude/refs/clean-code.md" VOLLSTAENDIG (definiert S1-S4 + Audit-Regeln: nur gesehenen Code bewerten, nicht raten).
2. git diff ${BASE} ${target} ; neue Dateien per git show ${target}:<pfad>.
3. Kategorie fuer Kategorie. Pro FLAG: "ID · Datei · Verstoss · Fix" + Schweregrad (S1 Tests/Sicherheit/Korrektheit, S2 Duplizierung, S3 Ausdrucksstaerke, S4 Struktur/Anzahl). S3/S4 gebuendelt.
Achte besonders auf G5/S2: die Sprachaufloesung fuer die Gate-Texte darf KEINE zweite Kopie der bestehenden Locale-Aufloesung sein, und die Locale-Tabellen (de/en/fr) muessen vollstaendig sein - ein fehlender Schluessel, der still auf undefined faellt, ist S1.
blocker=true wenn s1 ODER s2 nicht leer. passNotes: was sauber ist. topTodos: 1-3 wichtigste. Erfinde nichts.`,
        {
          label: `${PHASE}-review-cleancode${suffix}`,
          phase: "Review",
          schema: CC_SCHEMA,
          isolation: "worktree",
          ...CLEANCODE_AGENT,
        },
      ),
  ]);
}

const gateOk = (s, c) => !!(s && s.approved && !s.testWeakened && c && !c.blocker);
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
4. node --check + npm test (beide Backends) gruen + npm run test:gates (nur GAP-05/GAP-15 duerfen rot sein). node_modules NICHT committen. git add (betroffene Dateien) && git commit -m "fix(p15): Review-Blocker beheben (Runde ${round})". headCommit = git rev-parse HEAD.
EHRLICH: was du NICHT loesen konntest, in summary nennen. NIEMALS einen Test abschwaechen, um einen Blocker verschwinden zu lassen.`,
    {
      label: `${PHASE}-fix-r${round}`,
      phase: "Self-Fix",
      schema: FIX_SCHEMA,
      isolation: "worktree",
      ...FIX_AGENT,
    },
  );
  fixSummaries.push(
    `r${round}: ${fix && fix.summary ? fix.summary.slice(0, 300) : "(kein Ergebnis)"}`,
  );
  if (!fix || !fix.committed || !fix.headCommit) {
    fixSummaries.push(
      `r${round}: ABBRUCH - kein Commit vom Fix-Agenten (Branch ${fixBranch} existiert nicht). Self-Fix-Schleife beendet, Blocker der Runde ${round - 1 || "Erstreview"} bleiben stehen.`,
    );
    break;
  }
  reviewTarget = fixBranch;
  [safety, cc] = await runReview(reviewTarget, `-r${round}`);
}

const approved = gateOk(safety, cc);

// ---------- Phase 5: Report-Datei (Lead liest sie NICHT) ----------
phase("Report");
let reportPath = "";
try {
  const reportAgent = await agent(
    `Schreibe einen Detailbericht der Phase ${PHASE} in die Datei "${REPO}/${REPORT_PATH}" (im Haupt-Repo, NICHT in einem Worktree). NICHTS am Code aendern, KEIN git-Commit.
Inhalt (Markdown): Phase ${PHASE} ${PHASE_TITLE}; Gate=${approved ? "PASS" : "BLOCKED"}; finalBranch=${reviewTarget}; Plan (gekuerzt); Impl-Zusammenfassung + deviations + die noch roten Gate-IDs; Safety-Urteil; Clean-Code-Audit (s1-s4); Fix-Runden. Nenne die R5-Korrektur am E2E-06-Testkanal ausdruecklich als solche, mit Begruendung. Quelle:
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
Antworte NUR mit dem geschriebenen Dateipfad.`,
    { label: `${PHASE}-report`, phase: "Report", ...REPORT_AGENT },
  );
  reportPath = (reportAgent || "").toString().trim().slice(0, 300) || REPORT_PATH;
} catch {
  reportPath = "(Report fehlgeschlagen)";
}

return {
  phaseId: PHASE,
  finalBranch: reviewTarget,
  baseBranch: BASE,
  gate: approved ? "PASS" : "BLOCKED",
  approved,
  headCommit: (round > 0 ? null : impl && impl.headCommit) || null,
  testPassCount: (impl && impl.testPassCount) || null,
  gatesRedIds: (impl && impl.gatesRedIds) || [],
  filesTouched: [
    ...((impl && impl.filesCreated) || []),
    ...((impl && impl.filesEdited) || []),
  ].slice(0, 40),
  fixRounds: round,
  fixSummaries,
  remainingBlockers: approved ? [] : blockerList(safety, cc),
  reportPath,
  summary: impl && impl.summary ? impl.summary.slice(0, 600) : "",
};
