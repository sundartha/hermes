// SCHLANKES, SELBST-FIXENDES Phasen-Workflow (Lead bleibt duenn) - GEPINNT fuer MCP-UI P3.
// Muster identisch zu .claude/workflows/mcp-ui-p1.js (args-frei, self-fix, postage-stamp).
// Aufruf: Workflow({ scriptPath: ".claude/workflows/mcp-ui-p3.js" }) - kein args, kein resume.
// Der Lead merged danach den ZURUECKGEGEBENEN finalBranch.

export const meta = {
  name: "mcp-ui-p3",
  description:
    "MCP Rich-UI P3: zweiter Host-Adapter (ChatGPT Apps SDK) hinter demselben UiRenderer-Port; MCP-nativer Kern + Tool-Handler unberuehrt. Gepinnt, Lean: Plan->Impl->dualer Review->Self-Fix bis PASS->Report.",
  phases: [
    {
      title: "Plan",
      detail:
        "Code-gegroundeter Umsetzungsplan (clean-code.md + Strategie-Doc + Ketten-Spec P3 + echter Seam-Code)",
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

const REPO =
  typeof process !== "undefined" && process.env && process.env.OCLAW_REPO
    ? process.env.OCLAW_REPO
    : typeof process !== "undefined" && typeof process.cwd === "function"
      ? process.cwd()
      : ".";
const NODE_MODULES = `${REPO}/node_modules`;

// GEPINNT (MCP-UI P3): Phase hart inline, KEINE args-Abhaengigkeit.
const A = {
  "phaseId": "P3",
  "phaseTitle": "Zweiter Host-Adapter (ChatGPT Apps SDK) hinter dem UiRenderer-Port",
  "branch": "phase/mcp-ui-p3-chatgpt-adapter",
  "baseBranch": "master",
  "planDoc": "docs/mcp-ui-strategy.md",
  "specFile": "tasks/mcp-ui-chain.md",
  "maxFixRounds": 2
};

const PHASE = A.phaseId;
const PHASE_TITLE = A.phaseTitle || "";
const BRANCH = A.branch || `phase/${String(PHASE).toLowerCase()}-impl`;
const BASE = A.baseBranch || "master";
const PLAN_DOC = A.planDoc || "docs/mcp-ui-strategy.md";
const SPEC_FILE = A.specFile || "";
const MAX_FIX_ROUNDS = Number.isInteger(A.maxFixRounds) ? A.maxFixRounds : 2;
const REPORT_PATH = `tasks/mcp-ui-${String(PHASE).toLowerCase()}-report.md`;

const CLEAN_CODE_REQ = `CLEAN-CODE (PFLICHT): Lies "${REPO}/.claude/refs/clean-code.md" (verbindlicher Prueftkatalog) und befolge ihn bei JEDER Code-Entscheidung. Insbesondere: keine Duplizierung (G5/S2, gemeinsame Logik extrahieren); keine Magic Numbers ausser 0/1/-1 (G25, benannte Konstante, in config.js wenn konfigurierbar G35); kein toter/auskommentierter Code (C5/G9), keine ungenutzten Imports (G12); intentions-ausdrueckende Namen, Nebeneffekte im Namen sichtbar (N7); eine Aufgabe + eine Abstraktionsebene pro Funktion (G30/G34), <=3 Argumente (F1, sonst Objekt); Lazy-Init-Antipattern vermeiden (P15); keine brittle Datei:Zeile-Kommentare (C2); ESM, kein Build-Step, kein TypeScript, Kommentare deutsch OHNE Umlaute (ue/oe/ae); neues Verhalten braucht einen automatisierten Test (P11/T-Serie), reiner Refactor laesst die Bestandssuite OHNE Test-Aenderung gruen.`;

const ABS_RULES = `ABSOLUTE REGELN (unantastbar, siehe CLAUDE.md + MCP-UI-Strategie-Doc Abschnitt 3+5):
- P3 ist eine reine HOST-ABSTRAKTIONS-Phase: ein ZWEITER Renderer-Adapter (ChatGPT Apps SDK) hinter dem BESTEHENDEN UiRenderer-Port. Der MCP-NATIVE Adapter (src/ui/adapters/mcp-native.js), der Port (src/ui/ports.js), der Daten-Kontrakt/Whitelist und die TOOL-HANDLER (src/mcp-tools.js: get_call_status/get_transcript) bleiben funktional UNBERUEHRT. KEIN Tool-Handler-Code aendert sich - nur ein neuer Adapter + die Registry-Wahl ueber den Host-Hinweis.
- Fallback fail-closed bleibt: unbekannter/nicht-faehiger Host -> KEINE ui-Resource -> Stufe 0. Bestehende Widgets (call-status, transcript) muessen in BEIDEN Host-Konventionen renderbar sein; der MCP-native Pfad bleibt byte-kompatibel zu P1/P2.
- ChatGPT-Apps-Vertrag (P0-Befund): mimeType "text/html+skybridge", Tool-Ref via _meta["openai/outputTemplate"]. Host-Erkennung Q2 fail-closed: ohne belegten Host-Hinweis -> Stufe 0, NIE fail-open. Registry waehlt GENAU EINEN Adapter pro Host-Hinweis (mcp-native vs. chatgpt), unbekannt -> null.
- Safety-Gates / Disclosure / Call-Pfad UNBERUEHRT (P3 ist read-only Rendering, kein Callback - der ist P4). Auth fail-closed: /mcp bleibt hinter mcpAuth, kein neuer offener Endpunkt, res.on('close')-Cleanup unberuehrt.
- Secrets nur via env, nie in structuredContent/Widget/Log. Audio nie durch MCP. Whitelist-Filter unveraendert (eine Stelle, vor allen Sichten).
- SCOPE: NUR P3 (zweiter Adapter + Registry-Wahl). KEIN Callback/Schreib-Widget (P4), KEINE neuen Widgets, KEIN Token-Sync-CI-Gate (P5). KEIN neuer npm-Dep (Owner-Entscheidung Option A: Vertrag schlank ohne SDK-Dep nachbilden ueber das vorhandene @modelcontextprotocol/sdk - gilt auch fuer den ChatGPT-Skybridge-Vertrag, der nur mimeType + _meta-Schluessel ist).`;

const specInstruction = SPEC_FILE
  ? `Lies "${REPO}/${SPEC_FILE}" Abschnitt **P3** KOMPLETT - das ist die AUTORITATIVE Scope-/Invarianten-Definition dieser Phase (verbindlich vor dem Plan-Doc). Beachte den Abhaengigkeits-Graph (P3 haengt an P1-Seam + P0/Q2).`
  : `(Keine specFile uebergeben - nutze ausschliesslich ${PLAN_DOC}.)`;

// ---------- Phase 1: Plan ----------
phase("Plan");
const plan = await agent(
  `Du erstellst den DETAILLIERTEN, code-gegroundeten, CLEAN-CODE-KONFORMEN Umsetzungsplan fuer Phase ${PHASE} ${PHASE_TITLE} im Repo "${REPO}". NUR PLANEN, NICHTS aendern.
1. ${specInstruction}
2. Lies "${REPO}/${PLAN_DOC}" Abschnitt 3 (Seam-Architektur, Port/Registry/Adapter) + Abschnitt 8 (Q5: ChatGPT-Apps-Adapter ist P3) als Umbrella-Kontext und "${REPO}/.claude/refs/clean-code.md".
3. Lies den ECHTEN Seam-Code auf Basis "${BASE}": src/ui/ports.js (Port-Schnittstelle), src/ui/registry.js (wie der Renderer ueber den Host-Hinweis gewaehlt wird - HIER kommt die 2.-Adapter-Wahl rein), src/ui/contract.js (Daten-Kontrakt/Whitelist), src/ui/adapters/mcp-native.js (der EXISTIERENDE Adapter = Vorlage fuer den neuen, inkl. mimeType/_meta/Widget-Laden), src/ui/widgets/*.html (bestehende Widgets, in beiden Hosts renderbar), src/mcp-tools.js (wie die Tools die Registry aufrufen - das DARF SICH NICHT aendern). Vorbild fuer den Multi-Adapter-Dispatch: src/telephony/registry.js + adapters/{twilio,telnyx}/*. Grep gezielt - KEINE Zeilennummern uebernehmen.
${CLEAN_CODE_REQ}
${ABS_RULES}
LIEFERE: (1) den neuen ChatGPT-Adapter (src/ui/adapters/chatgpt.js o.ae.) inkl. Signaturen (gleicher Port-Vertrag wie mcp-native: supports(hostHint)/renderResource(widgetId, filteredData)) + wie er mimeType "text/html+skybridge" und _meta["openai/outputTemplate"] erzeugt; (2) die exakten Edits an src/ui/registry.js (Adapter-Wahl ueber Host-Hinweis, fail-closed unbekannt->null) - sonst NICHTS am Kern; (3) wie der Host-Hinweis (Q2) zum Renderer kommt, ohne die Tool-Handler-Signaturen zu brechen; (4) Tests: beide bestehenden Widgets rendern in beiden Hosts (mcp-native UND chatgpt), unbekannter Host weiter Stufe 0 fail-closed, mcp-native-Pfad byte-kompatibel zu P1/P2, Whitelist unveraendert in beiden Adaptern; (5) das deterministisch pruefbare Ergebnis (Befehl + erwartete Ausgabe). Kleiner Blast-Radius, KEINE Tool-Handler-Aenderung. Deine Rueckgabe IST der Plan.`,
  { label: `${PHASE}-plan`, phase: "Plan" },
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
    toolHandlersUnchanged: {
      type: "boolean",
      description: "bestaetige: src/mcp-tools.js get_call_status/get_transcript funktional unveraendert",
    },
    mcpNativeUnchanged: {
      type: "boolean",
      description: "bestaetige: src/ui/adapters/mcp-native.js + ports.js funktional unveraendert",
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
5. npm test (beide Backends: json-Default + pglite-in-process). Der mcp-native-Pfad bleibt byte-kompatibel zu P1/P2; neues Verhalten (ChatGPT-Adapter) -> neue Tests. Tool-Handler NICHT anfassen.
6. Smoke (best-effort): Server auf freiem Port mit SKIP_TWILIO_SIGNATURE_CHECK=true + Dummy-Env, get_call_status mit (a) MCP-nativem Host-Hinweis, (b) ChatGPT-Host-Hinweis, (c) unbekanntem Host -> drei verschiedene Resource-Auspraegungen bzw. fail-closed Stufe 0. Zu flaky -> smokePass=false + Grund.
7. node_modules-Symlink NICHT committen. git add (nur betroffene src/test/doc-Dateien) && git commit. headCommit = git rev-parse HEAD.
${ABS_RULES}
EHRLICH fuellen (inkl. toolHandlersUnchanged/mcpNativeUnchanged). Tests nicht gruen / blockiert -> testsPass=false + deviations, nicht schoenen.`,
  {
    label: `${PHASE}-implement`,
    phase: "Implementieren",
    schema: IMPL_SCHEMA,
    isolation: "worktree",
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
    toolHandlersUnchanged: { type: "boolean" },
    mcpNativeCoreUnchanged: { type: "boolean" },
    registryFailClosed: { type: "boolean" },
    bothHostsRender: { type: "boolean" },
    whitelistUnchangedBothAdapters: { type: "boolean" },
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
    "toolHandlersUnchanged",
    "mcpNativeCoreUnchanged",
    "registryFailClosed",
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
        `STRENGER, adversarialer Safety-/Verhaltens-Reviewer in frischem Worktree. Pruefe Phase ${PHASE} (MCP Rich-UI, zweiter Host-Adapter) auf Branch "${target}".
1. ln -s "${NODE_MODULES}" node_modules
2. git checkout -b review-mcp-ui-${String(PHASE).toLowerCase()}${suffix} ${target}
3. npm test selbst (beide Backends) -> testsPassIndependently + Zahlen.
4. git diff ${BASE} ${target} gegen die absoluten Regeln pruefen.
PRUEFE: scopeRespected (nur P3, zweiter Adapter + Registry-Wahl, kein Callback/neue Widgets/Token-Gate, KEIN neuer npm-Dep), toolHandlersUnchanged (src/mcp-tools.js get_call_status/get_transcript funktional unveraendert - das ist der KERN-BEWEIS der Host-Abstraktion), mcpNativeCoreUnchanged (src/ui/adapters/mcp-native.js + ports.js funktional byte-kompatibel zu P1/P2), registryFailClosed (unbekannter Host -> null -> Stufe 0, NIE fail-open), bothHostsRender (beide bestehenden Widgets rendern in mcp-native UND chatgpt; getestet), whitelistUnchangedBothAdapters (Daten-Kontrakt identisch, kein Feld leakt im neuen Adapter), safetyGatesIntact + disclosureIntact (Call-Pfad unberuehrt), authFailClosedIntact (/mcp hinter mcpAuth, kein neuer Endpunkt), noSecretsLeaked (keine Keys/email in structuredContent/Widget/Log).
${ABS_RULES}
approved=true NUR wenn alles erfuellt UND deine Tests gruen. Im Zweifel blockieren. Rueckgabe IST das Urteil.`,
        {
          label: `${PHASE}-review-safety${suffix}`,
          phase: "Review",
          schema: SAFETY_SCHEMA,
          isolation: "worktree",
        },
      ),
    () =>
      agent(
        `CLEAN-CODE-AUDITOR. Pruefe den Diff der Phase ${PHASE} (Branch "${target}", Basis "${BASE}") streng gegen den Katalog.
1. Lies "${REPO}/.claude/refs/clean-code.md" VOLLSTAENDIG (definiert S1-S4 + Audit-Regeln: nur gesehenen Code bewerten, nicht raten).
2. git diff ${BASE} ${target} ; neue Dateien per git show ${target}:<pfad>.
3. Kategorie fuer Kategorie. Pro FLAG: "ID · Datei · Verstoss · Fix" + Schweregrad (S1 Tests/Sicherheit/Korrektheit, S2 Duplizierung, S3 Ausdrucksstaerke, S4 Struktur/Anzahl). S3/S4 gebuendelt. Achte besonders auf: Adapter-Symmetrie (neuer chatgpt-Adapter erfuellt denselben Port-Vertrag wie mcp-native, kein Sonderpfad im Kern), Duplizierung zwischen den beiden Adaptern (gemeinsame Resource-/HTML-Logik extrahieren statt copy-paste = S2), Registry-Dispatch sauber (analog telephony/registry.js, keine if-Kaskade mit Magic-Strings ohne Konstante).
blocker=true wenn s1 ODER s2 nicht leer. passNotes: was sauber ist. topTodos: 1-3 wichtigste. Erfinde nichts.`,
        {
          label: `${PHASE}-review-cleancode${suffix}`,
          phase: "Review",
          schema: CC_SCHEMA,
          isolation: "worktree",
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
4. node --check + npm test (beide Backends) gruen. node_modules NICHT committen. git add (betroffene Dateien) && git commit -m "fix(mcp-ui-${String(PHASE).toLowerCase()}): Review-Blocker beheben (Runde ${round})". headCommit = git rev-parse HEAD.
EHRLICH: was du NICHT loesen konntest, in summary nennen.`,
    {
      label: `${PHASE}-fix-r${round}`,
      phase: "Self-Fix",
      schema: FIX_SCHEMA,
      isolation: "worktree",
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
Antworte NUR mit dem geschriebenen Dateipfad.`,
    { label: `${PHASE}-report`, phase: "Report" },
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
