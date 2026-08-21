// SCHLANKES, SELBST-FIXENDES Phasen-Workflow (Lead bleibt duenn).
// Kopie der Vorlage .claude/workflows/runs/oc-p3.js, Phase HART GEPINNT auf INBOX-P1.

export const meta = {
  name: "phase-impl-lean-inbox-p1",
  description:
    "INBOX-P1: Der Eintrag entsteht (Praedikat src/inbox-entry.js, zwei nullable Marker in beiden Store-Backends, finishCall-Verdrahtung im finally). Plan -> Impl (Worktree) -> dualer Review -> Self-Fix -> Report.",
  phases: [
    { title: "Plan", detail: "Umsetzung code-gegroundet planen (Spec: PLAN-ANRUF-INBOX.md, Etappe INBOX-P1)", model: "opus" },
    { title: "Implementieren", detail: "Umsetzung im Worktree, npm test gruen", model: "sonnet" },
    { title: "Review", detail: "Safety/Abnahme + Clean-Code-Auditor (parallel, beide Opus)", model: "opus" },
    { title: "Self-Fix", detail: "S1/S2/Safety-Blocker fixen + Re-Review, bis PASS", model: "sonnet" },
    { title: "Report", detail: "Detailbericht in tasks/inbox-p1-report.md (Lead liest ihn nicht)", model: "sonnet" },
  ],
};

// HART GEPINNT auf das Haupt-Repo (Symlink-Falle, C-P4).
const REPO = "/Users/antonio/Mein Unternehmen/MCP/vodafone-agent";
const NODE_MODULES = `${REPO}/node_modules`;

// PER-RUN-SKRIPT INBOX-P1: Phase HART GEPINNT.
const RUN = {
  phaseId: "INBOX-P1",
  phaseTitle:
    "Der Eintrag entsteht: Praedikat, zwei nullable Marker in beiden Store-Backends, finishCall-Verdrahtung im finally",
  branch: "phase/inbox-p1-eintrag",
  baseBranch: "master",
  planDoc: "PLAN-ANRUF-INBOX.md",
  maxFixRounds: 2,
};

const PHASE = RUN.phaseId;
const PHASE_TITLE = RUN.phaseTitle;
const BRANCH = RUN.branch;
const BASE = RUN.baseBranch;
const PLAN_DOC = RUN.planDoc;
const MAX_FIX_ROUNDS = Number.isInteger(RUN.maxFixRounds) ? RUN.maxFixRounds : 2;
const REPORT_PATH = "tasks/inbox-p1-report.md";

// MODELL-POLITIK: Urteilen=Opus, Ausfuehren=Sonnet; Pins pro agent() (Memory [[workflow-model-policy]]).
const PLAN_AGENT = { model: "opus", effort: "high" };
const IMPL_AGENT = { model: "sonnet", effort: "high" };
const SAFETY_AGENT = { model: "opus", effort: "xhigh" };
const CLEANCODE_AGENT = { model: "opus", effort: "high" };
const FIX_AGENT = { model: "sonnet", effort: "medium" };
const REPORT_AGENT = { model: "sonnet", effort: "low" };

// Suite-Anker: der Plan-Agent misst den ECHTEN Stand auf master und pinnt ihn;
// absolute Untergrenze ist der Stand vor der OC-Kette.
const TEST_CMD = `LLM_PROVIDER=anthropic npm test`;
const TEST_FLOOR = 4909;

const CLEAN_CODE_REQ = `CLEAN-CODE (PFLICHT): Lies "${REPO}/.claude/refs/clean-code.md" und befolge ihn bei JEDER Entscheidung. Fuer diese Phase besonders: das Qualifikations-Praedikat lebt in GENAU EINEM Modul (src/inbox-entry.js) - keine zweite Kopie der Regel in call-finish.js oder im Store (G5/S2); die Inbox-Schwellen sind BENANNTE Modul-Konstanten OHNE Env-Knopf (Muster MAX_OPEN_POLLS_PER_CALL); kein toter Code; Kommentare deutsch OHNE Umlaute; keine neuen eslint-Ausnahmen (die gepinnten Lint-Zahlen werden GEMESSEN, nicht geschaetzt). Neues Verhalten braucht Tests.`;

const LEAD_DECISIONS = `BINDENDE LEAD-ENTSCHEIDUNGEN - nicht neu aufrollen, nicht umdeuten:
1. "${PLAN_DOC}" ist AUTORITATIV (Revision 2, alle Pre-Mortem-Blocker R-1..R-3 und Clean-Code-S2 eingearbeitet). Umzusetzen ist NUR Etappe ${PHASE}; die dort getroffenen Annahmen aus .fortschritt/entscheidungen.md gelten. Echte Widersprueche Spec vs Ist-Code in deviations melden, Ist-Code respektieren.
2. KEINE neue Entitaet: der Eintrag ist eine Projektion; ${PHASE} baut NUR die zwei nullable ISO-Marker am Call (inboxEntryAt, inboxSeenAt) in BEIDEN Backends (json + pg: DDL beim Boot, rowToCall-Hydrierung, ON CONFLICT DO UPDATE SET, Reopen-Round-Trip mit null statt undefined) plus das Praedikat plus die finishCall-Verdrahtung. KEIN Endpunkt, KEIN MCP-Werkzeug (das sind P2/P3).
3. R-1 (bindend): qualifiesAsInboxEntry(call, settings) wird VOR summarizeCall ausgewertet; die Markierung steht in einem finally, das auch nach einer summarizeCall-Exception und nach dem fruehen Return im Purge-Pfad laeuft. allowSummaries=false -> KEIN Eintrag; technischer Summary-Fehler -> Eintrag entsteht trotzdem (summary bleibt leer, Kennzeichnung folgt in P3).
4. R-2 (bindend): eigene benannte Inbox-Regel ueber der GETEILTEN Primitive isSubstantialCallerText: INBOX_MIN_CALLER_TURNS=2 ODER INBOX_MIN_CALLER_CHARS=12, Modul-Konstanten in src/inbox-entry.js, KEIN Env-Knopf. callerHasSpoken ist ausdruecklich das FALSCHE Praedikat (zaehlt Rausch-Fragmente).
5. Nie angekommen = KEIN Eintrag, fail-closed: kein Marker fuer Anrufe ohne substanzielle Anrufer-Zeile (Begruessung ist eine Agent-Zeile VOR dem Gather; answeredAt ist fuer Inbound sofort gesetzt - beides taugt NICHT als Beleg). Bestandscalls haben inboxEntryAt=null und bleiben unsichtbar - KEIN Backfill.
6. Marker wird VOR purgeTranscript gesetzt (Reihenfolge-Test), publicCall strippt BEIDE neuen Felder (/api/state bleibt byte-identisch fuer die Read-Parity-Tests).
7. KEINE neue Env-Variable. PII: keine Rufnummern und keine Gespraechsinhalte in Logs; Fixtures nur erkennbar fiktiv im Bestandsstil (+15005550006, +4915112345678, "Jonas Beispiel").`;

const ABS_RULES = `ABSOLUTE REGELN (unantastbar, siehe CLAUDE.md):
- Safety-Gates NIE anfassen (Outbound-Permit, OUTBOUND_FROZEN, Kostendecke, Signaturpruefung). Offenlegungs-Mechanik NICHT beruehren. Auth fail-closed (route-auth-inventory gruen). Secrets nur via env.
- KEINE echten Anrufe/SMS, KEINE Provider-Schreibzugriffe, KEIN Deploy. Offline gegen Attrappen.
- SCOPE: NUR ${PHASE} gemaess "${PLAN_DOC}". Kein src/bridge.js, keine Routen, kein mcp-tools.js.`;

// ---------- Phase 1: Plan ----------
phase("Plan");
const plan = await agent(
  `Du erstellst den DETAILLIERTEN, code-gegroundeten Umsetzungsplan fuer Phase ${PHASE} (${PHASE_TITLE}) im Repo "${REPO}". NUR PLANEN, NICHTS aendern.
1. Lies aus "${REPO}/${PLAN_DOC}" VOLLSTAENDIG: die Entwurfsentscheidungen (E-1..E-6 + Revision), Abschnitt 2.x (Praedikat/Schwellen), die Etappe ${PHASE} samt Abnahmekatalog, Pre-Mortem-Abschnitt und "Bewusst akzeptierte Risiken". AUTORITATIV.
2. Lies "${REPO}/.claude/refs/clean-code.md".
3. Lies den ECHTEN Code auf Basis "${BASE}" an allen Stellen, die die Etappe nennt (src/telephony/call-finish.js finishCall inkl. Purge-Pfad und Exception-Verhalten, src/store/state-ops.js, src/store/json.js, src/store/pg.js rowToCall/Upsert, src/store/views.js publicCall-Umgebung, src/config.js isSubstantialCallerText-Umfeld, eslint-legacy-exceptions.json). Miss selbst: ${TEST_CMD} auf ${BASE} (pass-Zahl = Anker, in den Plan schreiben) und npx eslint src/telephony/call-finish.js (gepinnte complexity-Zahl notieren). Grep gezielt; KEINE Zeilennummer ungeprueft uebernehmen.
${LEAD_DECISIONS}
${CLEAN_CODE_REQ}
${ABS_RULES}
DEINE WICHTIGSTEN ZWEI AUFGABEN:
(a) **Die finally-Verdrahtung exakt belegen:** wo genau in finishCall greift das Praedikat, wie ueberlebt die Markierung Exception UND fruehen Return, und mit welchem Test wird jede der drei Bedingungen (reihenfolge-vor-purge, summary-exception-setzt-marker, allowSummaries-false-kein-marker) einzeln bewiesen?
(b) **Store-Paritaet beweisbar machen:** exakte Aenderungen in json.js UND pg.js (DDL, Hydrierung, Upsert-Spalten), Reopen-Round-Trip gegen pglite fuer BEIDE Marker mit null statt undefined.
LIEFERE: exakte Edits je Datei (Vorher/Nachher), neue Tests inkl. Sabotage-Gegenprobe (Praedikat so sabotiert, dass ein nie angekommener Anruf qualifiziert -> Test MUSS rot), je Abnahmepunkt der Etappe Kommando + erwartete Ausgabe. Deine Rueckgabe IST der Plan.`,
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
    finallyProof: {
      type: "string",
      description:
        "Beweis: Marker ueberlebt summarizeCall-Exception UND fruehen Purge-Return; Reihenfolge vor purgeTranscript. Kommando + Ausgabe",
    },
    failClosedProof: {
      type: "string",
      description:
        "AUSGEFUEHRTE Sabotage-Gegenprobe: nie angekommener Anruf qualifiziert -> Test rot -> wiederhergestellt. Woertlich",
    },
    parityProof: {
      type: "string",
      description: "json+pg Reopen-Round-Trip beider Marker (null statt undefined). Kommando + Ausgabe",
    },
    lintPinProof: {
      type: "string",
      description: "npx eslint src/telephony/call-finish.js: complexity finishCall unveraendert, identisch zu eslint-legacy-exceptions.json. Woertlich",
    },
    abnahmeProofs: { type: "string", description: "JEDER Abnahmepunkt der Etappe: Kommando + Ausgabe" },
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
    "finallyProof",
    "failClosedProof",
    "parityProof",
    "lintPinProof",
    "abnahmeProofs",
    "committed",
    "summary",
  ],
};
const impl = await agent(
  `Du arbeitest in einem FRISCHEN Git-Worktree (isoliert). Setze Phase ${PHASE} (${PHASE_TITLE}) GENAU gemaess Plan um:
=== PLAN ===
${plan || "(Plan fehlt - brich ab, melde es in deviations)"}
=== ENDE PLAN ===
VORGEHEN:
1. ln -s "${NODE_MODULES}" node_modules
2. git checkout -b ${BRANCH} ${BASE}
3. Lies die Etappe ${PHASE} in "${REPO}/${PLAN_DOC}" SELBST. Implementiere EXAKT gemaess Plan+Spec. ${CLEAN_CODE_REQ}
${LEAD_DECISIONS}
4. node --check auf JEDE geaenderte .js-Datei.
5. ${TEST_CMD} - pass MUSS >= ${TEST_FLOOR} sein und fail == 0 (Einzel-Flake nur nach isolierter Wiederholung werten; SINKEN unter den vom Plan gemessenen ${BASE}-Anker ist ein Blocker).
6. **DREI BEWEISE (alle Pflicht, alle AUSFUEHREN):** finallyProof, failClosedProof (Sabotage-Gegenprobe), parityProof - Kommando+Ausgabe woertlich. Dazu lintPinProof (gemessen, nicht geschaetzt).
7. JEDEN Abnahmepunkt der Etappe einzeln abarbeiten; Kommando+Ausgabe nach abnahmeProofs.
8. node_modules NICHT committen. git add (betroffene Dateien EINZELN, nie git add -A) && git commit (Botschaft deutsch). headCommit = git rev-parse HEAD.
${ABS_RULES}
EHRLICH fuellen; Offenes offen nennen, nicht schoenen.`,
  {
    label: `${PHASE}-implement`,
    phase: "Implementieren",
    schema: IMPL_SCHEMA,
    isolation: "worktree",
    ...IMPL_AGENT,
  },
);

// ---------- Phase 3: Dualer Review ----------
const SAFETY_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    testsPassIndependently: { type: "boolean" },
    independentTestSummary: { type: "string" },
    testCountNotShrunk: { type: "boolean", description: `pass >= ${TEST_FLOOR}, fail 0, nicht unter dem Plan-Anker` },
    markerFailClosed: {
      type: "boolean",
      description: "SELBST gesehen: nie angekommener Anruf erzeugt KEINEN Marker; Sabotage-Gegenprobe selbst rot gesehen",
    },
    markerInFinally: {
      type: "boolean",
      description: "SELBST gefahren: Marker ueberlebt summarizeCall-Exception + fruehen Purge-Return; Reihenfolge vor purge",
    },
    storeParityBothBackends: {
      type: "boolean",
      description: "json+pg Reopen-Round-Trip beider Marker SELBST gefahren (null statt undefined)",
    },
    publicCallStripsNewFields: { type: "boolean", description: "/api/state-Sicht enthaelt KEINEN der neuen Marker" },
    lintPinsUnchanged: { type: "boolean", description: "npx eslint SELBST gemessen; Zahlen identisch zu eslint-legacy-exceptions.json" },
    noNewEnvVars: { type: "boolean" },
    piiClean: { type: "boolean", description: "keine Klarnummern/Gespraechsinhalte in Logs/Fixtures; nur Bestands-Fakes" },
    routeAuthIntact: { type: "boolean" },
    safetyGatesIntact: { type: "boolean" },
    noSecretsLeaked: { type: "boolean" },
    scopeRespected: { type: "boolean", description: "KEIN Endpunkt, KEIN mcp-tools.js, kein bridge.js" },
    approved: { type: "boolean" },
    blockers: { type: "array", items: { type: "string" } },
    concerns: { type: "array", items: { type: "string" } },
    verdict: { type: "string" },
  },
  required: [
    "approved",
    "testsPassIndependently",
    "testCountNotShrunk",
    "markerFailClosed",
    "markerInFinally",
    "storeParityBothBackends",
    "publicCallStripsNewFields",
    "lintPinsUnchanged",
    "noNewEnvVars",
    "piiClean",
    "routeAuthIntact",
    "safetyGatesIntact",
    "noSecretsLeaked",
    "scopeRespected",
    "blockers",
    "verdict",
  ],
};
const CC_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    s1: { type: "array", items: { type: "string" } },
    s2: { type: "array", items: { type: "string" } },
    s3: { type: "array", items: { type: "string" } },
    s4: { type: "array", items: { type: "string" } },
    blocker: { type: "boolean" },
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
        `STRENGER, adversarialer Safety-/Abnahme-Reviewer in frischem Worktree. Pruefe Phase ${PHASE} auf Branch "${target}". Ein Eintrag fuer einen nie angekommenen Anruf oder ein verlorener Eintrag fuer ein echtes Gespraech bricht das Kernversprechen - im Zweifel blockieren.
1. ln -s "${NODE_MODULES}" node_modules
2. git checkout -b review-inbox-p1${suffix} ${target}
3. ${TEST_CMD} SELBST (pass >= ${TEST_FLOOR}, fail 0; Einzel-Flake isoliert wiederholen).
4. Lies die Etappe ${PHASE} + Entwurfsentscheidungen + Pre-Mortem in "${REPO}/${PLAN_DOC}".
5. JEDEN Abnahmepunkt der Etappe EINZELN selbst fahren; keine Impl-Behauptung uebernehmen:
   - **markerFailClosed:** Sabotage-Gegenprobe SELBST ausfuehren (Praedikat sabotieren -> Test MUSS rot -> wiederherstellen).
   - **markerInFinally:** die drei Faelle (reihenfolge-vor-purge, summary-exception-setzt-marker, allowSummaries-false-kein-marker) selbst fahren; dabei pruefen, dass die Tests den SOLL-Zustand pinnen und nicht das Ist schoenreden.
   - **storeParityBothBackends:** Reopen-Round-Trip gegen pglite selbst fahren; null statt undefined fuer BEIDE Marker.
   - **publicCallStripsNewFields** + **lintPinsUnchanged** (npx eslint selbst, Zahlen gegen eslint-legacy-exceptions.json).
   - **piiClean:** git diff ${BASE}..${target} nach Klarnummern/Inhalten in Logs und Fixtures absuchen; nur Bestands-Fakes zulaessig.
6. git diff ${BASE}..${target} -- src/bridge.js src/mcp-tools.js src/routes MUSS leer sein (Scope P1).
${LEAD_DECISIONS}
${ABS_RULES}
approved=true NUR wenn alle Punkte selbst gesehen. Rueckgabe IST das Urteil.`,
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
1. Lies "${REPO}/.claude/refs/clean-code.md" VOLLSTAENDIG.
2. git diff ${BASE} ${target} ; neue Dateien per git show ${target}:<pfad>.
3. Kategorie fuer Kategorie. Pro FLAG: "ID · Datei · Verstoss · Fix" + Schweregrad. S3/S4 gebuendelt.
BESONDERS ACHTEN:
 - **G5/S2:** das Qualifikations-Praedikat existiert GENAU EINMAL (src/inbox-entry.js); keine Regel-Kopie in call-finish.js/Store; geteilte Primitive statt geliehener Fremd-Schwellen.
 - **Magic Numbers:** Schwellen als benannte Konstanten; keine neuen eslint-Ausnahmen, keine Suppressions.
 - **P11/T-Serie:** AUSGEFUEHRTE Gegenproben, sonst S1; Tests pinnen den SOLL-Zustand.
 - Kommentare deutsch OHNE Umlaute; kein toter Code.
blocker=true wenn s1 ODER s2 nicht leer. Erfinde nichts.`,
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

const gateOk = (sa, cca) => !!(sa && sa.approved && cca && !cca.blocker);
const blockerList = (sa, cca) => [
  ...((sa && sa.blockers) || []),
  ...((cca && cca.s1) || []),
  ...((cca && cca.s2) || []),
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
3. Behebe DIESE Blocker sauber und minimal; fuer jeden korrektheits-/sicherheitsrelevanten Fix einen Regressionstest:
${JSON.stringify(blockers, null, 1)}
${LEAD_DECISIONS}
${CLEAN_CODE_REQ}
${ABS_RULES}
4. node --check + ${TEST_CMD} gruen, pass >= ${TEST_FLOOR}. node_modules NICHT committen. git add (betroffene Dateien einzeln) && git commit -m "fix(inbox-p1): Review-Blocker beheben (Runde ${round})". headCommit = git rev-parse HEAD.
EHRLICH: was du NICHT loesen konntest, in summary nennen.`,
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
      `r${round}: ABBRUCH - kein Commit vom Fix-Agenten (Branch ${fixBranch} existiert nicht). Blocker bleiben stehen.`,
    );
    break;
  }
  reviewTarget = fixBranch;
  [safety, cc] = await runReview(reviewTarget, `-r${round}`);
}

const approved = gateOk(safety, cc);

// ---------- Phase 5: Report ----------
phase("Report");
let reportPath = "";
try {
  const reportAgent = await agent(
    `Schreibe einen Detailbericht der Phase ${PHASE} in die Datei "${REPO}/${REPORT_PATH}" (im Haupt-Repo, NICHT in einem Worktree). NICHTS am Code aendern, KEIN git-Commit.
Inhalt (Markdown, deutsch OHNE Umlaute): Phase ${PHASE} ${PHASE_TITLE}; Gate=${approved ? "PASS" : "BLOCKED"}; finalBranch=${reviewTarget}; die Verdrahtungsstellen einzeln; die Abnahmepunkte einzeln mit Urteil+Kommando; die ausgefuehrten Gegenproben woertlich; Impl-Zusammenfassung + deviations; Safety-Urteil; Clean-Code-Audit; Fix-Runden. Quelle:
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

// ---------- POSTAGE-STAMP-RETURN ----------
return {
  phaseId: PHASE,
  finalBranch: reviewTarget,
  baseBranch: BASE,
  gate: approved ? "PASS" : "BLOCKED",
  approved,
  headCommit: (round > 0 ? null : impl && impl.headCommit) || null,
  testPassCount: (impl && impl.testPassCount) || null,
  markerFailClosed: (safety && safety.markerFailClosed) || false,
  markerInFinally: (safety && safety.markerInFinally) || false,
  storeParityBothBackends: (safety && safety.storeParityBothBackends) || false,
  publicCallStripsNewFields: (safety && safety.publicCallStripsNewFields) || false,
  lintPinsUnchanged: (safety && safety.lintPinsUnchanged) || false,
  piiClean: (safety && safety.piiClean) || false,
  routeAuthIntact: (safety && safety.routeAuthIntact) || false,
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
