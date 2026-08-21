// SCHLANKES, SELBST-FIXENDES Phasen-Workflow (Lead bleibt duenn).
// Kopie der Vorlage .claude/workflows/runs/inbox-p2.js, Phase HART GEPINNT auf INBOX-P3.

export const meta = {
  name: "phase-impl-lean-inbox-p3",
  description:
    "INBOX-P3: MCP-Werkzeug check_inbox (outputSchema, include_seen, woertlich festgelegte englische Beschreibung samt Negativ-Verbot, zwei neue MCP_TEXTS-Schluessel). Plan -> Impl (Worktree) -> dualer Review -> Self-Fix -> Report.",
  phases: [
    { title: "Plan", detail: "Umsetzung code-gegroundet planen (Spec: PLAN-ANRUF-INBOX.md, Etappe INBOX-P3)", model: "opus" },
    { title: "Implementieren", detail: "Umsetzung im Worktree, npm test gruen, eslint . 0 Fehler", model: "sonnet" },
    { title: "Review", detail: "Safety/Abnahme + Clean-Code-Auditor (parallel, beide Opus)", model: "opus" },
    { title: "Self-Fix", detail: "S1/S2/Safety-Blocker fixen + Re-Review, bis PASS", model: "sonnet" },
    { title: "Report", detail: "Detailbericht in tasks/inbox-p3-report.md (Lead liest ihn nicht)", model: "sonnet" },
  ],
};

// HART GEPINNT auf das Haupt-Repo (Symlink-Falle, C-P4).
const REPO = "/Users/antonio/Mein Unternehmen/MCP/vodafone-agent";
const NODE_MODULES = `${REPO}/node_modules`;

// PER-RUN-SKRIPT INBOX-P3: Phase HART GEPINNT.
const RUN = {
  phaseId: "INBOX-P3",
  phaseTitle:
    "MCP-Werkzeug check_inbox: outputSchema, include_seen, woertlich festgelegte englische Beschreibung samt Negativ-Verbot, zwei neue MCP_TEXTS-Schluessel",
  branch: "phase/inbox-p3-werkzeug",
  baseBranch: "master",
  planDoc: "PLAN-ANRUF-INBOX.md",
  maxFixRounds: 4,
};

const PHASE = RUN.phaseId;
const PHASE_TITLE = RUN.phaseTitle;
const BRANCH = RUN.branch;
const BASE = RUN.baseBranch;
const PLAN_DOC = RUN.planDoc;
const MAX_FIX_ROUNDS = Number.isInteger(RUN.maxFixRounds) ? RUN.maxFixRounds : 2;
const REPORT_PATH = "tasks/inbox-p3-report.md";

// MODELL-POLITIK: Urteilen=Opus, Ausfuehren=Sonnet; Pins pro agent() (Memory [[workflow-model-policy]]).
const PLAN_AGENT = { model: "opus", effort: "high" };
const IMPL_AGENT = { model: "sonnet", effort: "high" };
const SAFETY_AGENT = { model: "opus", effort: "xhigh" };
const CLEANCODE_AGENT = { model: "opus", effort: "high" };
const FIX_AGENT = { model: "sonnet", effort: "medium" };
const REPORT_AGENT = { model: "sonnet", effort: "low" };

// Suite-Anker: master nach INBOX-P2-Merge (fee7fc5) = 5075 pass. Der Plan-Agent
// misst selbst nach und pinnt den ECHTEN Stand; SINKEN ist ein Blocker.
// ZUSAETZLICH Schritt 0: npm run test:gates auf ${BASE} messen (rote Faelle =
// Vorher-Zahl) - P3 darf diese Zahl NICHT erhoehen.
const TEST_CMD = `LLM_PROVIDER=anthropic npm test`;
const TEST_FLOOR = 5075;

const LINT_REGEL = `LINT-PFLICHT (P1-Lehre, tasks/lessons.md 2026-08-21): npm run lint (eslint ., volles Repo im Worktree) MUSS "0 errors" melden - nicht nur die Zieldateien linten. eslint-suppressions.json und eslint-legacy-exceptions.json duerfen NUR Eintraege von Dateien aendern, die im eigenen Diff stehen; Eintraege UNBETEILIGTER Dateien sind TABU (kein Regenerieren der Gesamtdatei). Der Bestands-Pin fuer registerTools (mcp-tools.js) wird bei Bedarf GEMESSEN nachgezogen und einzeln begruendet, nie geschaetzt.`;

const CLEAN_CODE_REQ = `CLEAN-CODE (PFLICHT): Lies "${REPO}/.claude/refs/clean-code.md" und befolge ihn bei JEDER Entscheidung. Fuer diese Phase besonders: das Werkzeug projiziert NICHT erneut (E-5/S2-1: die Whitelist lebt in inboxEntryView/state-ops.js; das Werkzeug ersetzt NUR started_at durch das formatierte at) - keine zweite Feldliste; MCP-Texte in src/i18n/mcp-texts.js nach Bestandsmuster (DE-Texte dort ASCII, weil nie gesprochen; Kopf der Datei belegt das); kein toter Code; Kommentare deutsch OHNE Umlaute. Neues Verhalten braucht Tests. ${LINT_REGEL}`;

const LEAD_DECISIONS = `BINDENDE LEAD-ENTSCHEIDUNGEN - nicht neu aufrollen, nicht umdeuten:
1. "${PLAN_DOC}" ist AUTORITATIV. Umzusetzen ist NUR Etappe ${PHASE}; INBOX-P1+P2 sind auf ${BASE} gemergt (Endpunkt POST /api/inbox/poll existiert, include_seen fail-closed, Deckel 20, takeInboxEntries + inboxEntryView im Store). Echte Widersprueche Spec vs Ist-Code in deviations melden, Ist-Code respektieren.
2. Das Werkzeug heisst check_inbox, ruft ueber api() den Bestands-Endpunkt POST /api/inbox/poll (KEINE neue Route, KEINE Store-Aenderung) und liefert outputSchema gemaess Plan-Dokument. MCP-Schluesselsatz == REST-Schluesselsatz minus started_at plus at (Abnahme b; Test pinnt das per deepEqual ueber Object.keys).
3. Die englische Werkzeug-Beschreibung ist WOERTLICH aus dem Plan-Dokument zu uebernehmen, samt Negativ-Verbot und EXPECTED_MARKERS; p15-mcp-tool-descriptions-en muss gruen bleiben. Antwort bei nichts Neuem: kurz und EINDEUTIG leer (die zwei neuen MCP_TEXTS-Schluessel), niemals erfundene Eintraege.
4. action_required NUR aus offenen Action Items (Abnahme e); summary_unavailable-Zeile fuer Eintraege mit summary=null (Abnahme f); NIE transcript/facts/evidence/Audio im Payload (Abnahme d; Absolute Regel 5: Audio NIEMALS durch MCP).
5. include_seen als Tool-Parameter, durchgereicht an den Endpunkt (fail-closed default false).
6. PII (bindend): keine Rufnummern und keine Gespraechsinhalte in Logs; Fixtures nur erkennbar fiktiv im Bestandsstil (+15005550006, +4915112345678, "Jonas Beispiel").
7. KEINE neue Env-Variable. Schritt 0 (Pflicht, VOR dem ersten Edit): npm run test:gates auf ${BASE} ausfuehren und die Zahl der roten Faelle festhalten - nach der Umsetzung darf sie NICHT hoeher sein.`;

const ABS_RULES = `ABSOLUTE REGELN (unantastbar, siehe CLAUDE.md):
- Safety-Gates NIE anfassen (Outbound-Permit, OUTBOUND_FROZEN, Kostendecke, Signaturpruefung). Offenlegungs-Mechanik NICHT beruehren. Auth fail-closed. Secrets nur via env. AUDIO NIEMALS durch MCP.
- KEINE echten Anrufe/SMS, KEINE Provider-Schreibzugriffe, KEIN Deploy. Offline gegen Attrappen.
- SCOPE: NUR ${PHASE} gemaess "${PLAN_DOC}". Kein src/bridge.js, keine neuen Routen, keine Store-Aenderungen; src/routes/api-inbox.js nur, falls der Plan dort explizit include_seen-Durchreichung nachziehen muss.`;

// ---------- Phase 1: Plan ----------
phase("Plan");
const plan = await agent(
  `Du erstellst den DETAILLIERTEN, code-gegroundeten Umsetzungsplan fuer Phase ${PHASE} (${PHASE_TITLE}) im Repo "${REPO}". NUR PLANEN, NICHTS aendern.
1. Lies aus "${REPO}/${PLAN_DOC}" VOLLSTAENDIG: Entwurfsentscheidungen (E-5, PII-Absatz), die Etappe ${PHASE} samt Abnahmekatalog (inkl. der woertlichen englischen Beschreibung + EXPECTED_MARKERS + outputSchema), Pre-Mortem + "Bewusst akzeptierte Risiken". AUTORITATIV.
2. Lies "${REPO}/.claude/refs/clean-code.md".
3. Lies den ECHTEN Code auf Basis "${BASE}" (INBOX-P1+P2 gemergt!): src/mcp-tools.js (registerTools, api()-Helper, Bestands-Tools mit outputSchema als Muster, structuredContent-Konvention), src/routes/api-inbox.js (was der Endpunkt liefert, include_seen-Verhalten), src/store/state-ops.js inboxEntryView (der REST-Schluesselsatz), src/i18n/mcp-texts.js (Muster + Kopf-Kommentar), test/mcp-transcript-tool.test.js + test/al-p11-result-card.test.js (Test-Muster fuer MCP-Tools inkl. Object.keys-Pin), test/p15-mcp-tool-descriptions-en.test.js + test/mcp-tools-language.test.js + test/mcp-audio-text-only.test.js (was sie erzwingen). Miss selbst: ${TEST_CMD} auf ${BASE} (pass-Zahl = Anker), npm run test:gates auf ${BASE} (rote Faelle = Vorher-Zahl, in den Plan schreiben!), npm run lint (MUSS 0 Fehler sein - sonst STOPP und melden).
${LEAD_DECISIONS}
${CLEAN_CODE_REQ}
${ABS_RULES}
DEINE WICHTIGSTEN ZWEI AUFGABEN:
(a) **Die Werkzeug-Antwort beweisbar machen:** exakter Aufbau von check_inbox (Parameter, outputSchema, structuredContent, Text-Fallback), die Testfaelle b/d/e/f des Abnahmekatalogs einzeln entwerfen, plus der End-zu-End-Fall gegen den lokal gestarteten Server (Spawn-Muster, Temp-DATA_DIR, STORE_BACKEND=json): Eintrag seeden -> check_inbox liefert ihn -> zweiter Aufruf eindeutig leer.
(b) **Die Beschreibungs-/Sprach-Ratchets respektieren:** woertliche EN-Beschreibung aus dem Plan, MCP_TEXTS-Schluessel nach Bestandsmuster, p15/language/audio-Tests bleiben gruen; test:gates-Zahl nicht verschlechtern.
LIEFERE: exakte Edits je Datei (Vorher/Nachher), neue Tests inkl. Sabotage-Gegenprobe (verbotenes Feld wie transcript in die Tool-Antwort geschmuggelt -> Whitelist-Test MUSS rot), je Abnahmepunkt der Etappe Kommando + erwartete Ausgabe. Deine Rueckgabe IST der Plan.`,
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
    toolProof: {
      type: "string",
      description: "End-zu-End-Beweis gegen lokalen Server: erster check_inbox liefert den geseedeten Eintrag, zweiter eindeutig leer. Kommando + Ausgabe",
    },
    payloadWhitelistProof: {
      type: "string",
      description: "Beweis b+d: MCP-Schluessel == REST minus started_at plus at (deepEqual); kein transcript/facts/evidence. Kommando + Ausgabe",
    },
    failClosedProof: {
      type: "string",
      description: "AUSGEFUEHRTE Sabotage-Gegenprobe: verbotenes Feld in die Tool-Antwort -> Test rot -> wiederhergestellt. Woertlich",
    },
    gatesProof: {
      type: "string",
      description: "npm run test:gates: Vorher-Zahl (Schritt 0, auf Basis gemessen) und Nachher-Zahl. Woertlich",
    },
    lintProof: {
      type: "string",
      description: "npm run lint (eslint ., VOLL) = 0 Fehler; Pin-Aenderungen gemessen + nur Diff-eigene Dateien. Woertlich",
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
    "toolProof",
    "payloadWhitelistProof",
    "failClosedProof",
    "gatesProof",
    "lintProof",
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
5. ${TEST_CMD} - pass MUSS >= ${TEST_FLOOR} sein und fail == 0 (Einzel-Flake nur nach isolierter Wiederholung werten; SINKEN unter den vom Plan gemessenen ${BASE}-Anker ist ein Blocker). DAZU npm run lint = 0 Fehler (VOLL) UND npm run test:gates nicht roeter als die Vorher-Zahl.
6. **VIER BEWEISE (alle Pflicht, alle AUSFUEHREN):** toolProof, payloadWhitelistProof, failClosedProof (Sabotage-Gegenprobe), gatesProof - Kommando+Ausgabe woertlich. Dazu lintProof.
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
    toolEndToEnd: {
      type: "boolean",
      description: "SELBST gefahren: check_inbox gegen lokalen Server - erster Aufruf liefert, zweiter eindeutig leer",
    },
    payloadWhitelisted: {
      type: "boolean",
      description: "SELBST geprueft: Schluesselsatz-Pin (b) + kein transcript/facts/evidence/Audio (d); Sabotage-Gegenprobe selbst rot gesehen",
    },
    actionRequiredOnlyOpenItems: { type: "boolean", description: "Abnahme e SELBST gefahren" },
    summaryUnavailableLine: { type: "boolean", description: "Abnahme f SELBST gefahren" },
    descriptionPinned: {
      type: "boolean",
      description: "EN-Beschreibung woertlich wie im Plan-Dokument; p15/language/audio-Tests gruen",
    },
    gatesNotWorse: { type: "boolean", description: "test:gates rote Faelle <= Vorher-Zahl (selbst auf Basis UND Branch gemessen)" },
    fullLintZeroErrors: { type: "boolean", description: "npm run lint (VOLL) SELBST gemessen = 0 Fehler; Suppressions nur Diff-eigene Dateien" },
    noNewEnvVars: { type: "boolean" },
    piiClean: { type: "boolean", description: "keine Klarnummern/Gespraechsinhalte in Logs/Fixtures; nur Bestands-Fakes" },
    routeAuthIntact: { type: "boolean" },
    safetyGatesIntact: { type: "boolean" },
    noSecretsLeaked: { type: "boolean" },
    scopeRespected: { type: "boolean", description: "kein bridge.js, keine neuen Routen, keine Store-Aenderungen" },
    approved: { type: "boolean" },
    blockers: { type: "array", items: { type: "string" } },
    concerns: { type: "array", items: { type: "string" } },
    verdict: { type: "string" },
  },
  required: [
    "approved",
    "testsPassIndependently",
    "testCountNotShrunk",
    "toolEndToEnd",
    "payloadWhitelisted",
    "actionRequiredOnlyOpenItems",
    "summaryUnavailableLine",
    "descriptionPinned",
    "gatesNotWorse",
    "fullLintZeroErrors",
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
        `STRENGER, adversarialer Safety-/Abnahme-Reviewer in frischem Worktree. Pruefe Phase ${PHASE} auf Branch "${target}". PII im Tool-Payload, eine nicht eindeutig leere Leer-Antwort oder ein Ratchet-Bruch (p15/language/audio/gates) bricht das Kernversprechen - im Zweifel blockieren.
1. ln -s "${NODE_MODULES}" node_modules
2. git checkout -b review-inbox-p3${suffix} ${target}
3. ${TEST_CMD} SELBST (pass >= ${TEST_FLOOR}, fail 0; Einzel-Flake isoliert wiederholen). DAZU npm run lint SELBST (VOLL) = 0 Fehler UND npm run test:gates auf ${BASE} UND auf ${target} (Vergleich!).
4. Lies die Etappe ${PHASE} + Entwurfsentscheidungen + Pre-Mortem in "${REPO}/${PLAN_DOC}".
5. JEDEN Abnahmepunkt der Etappe EINZELN selbst fahren; keine Impl-Behauptung uebernehmen:
   - **toolEndToEnd** (lokaler Server, Spawn-Muster) + **payloadWhitelisted** (inkl. Sabotage-Gegenprobe SELBST: verbotenes Feld einschmuggeln -> Test MUSS rot -> wiederherstellen).
   - **actionRequiredOnlyOpenItems** (e) + **summaryUnavailableLine** (f) selbst fahren.
   - **descriptionPinned:** EN-Beschreibung Zeichen fuer Zeichen gegen das Plan-Dokument; p15-mcp-tool-descriptions-en + mcp-tools-language + mcp-audio-text-only gruen.
   - **Suppression-Tabu (P1-Lehre):** git diff der beiden Suppression-Dateien Zeile fuer Zeile - nur Diff-eigene Dateien.
6. git diff ${BASE}..${target} -- src/bridge.js src/store MUSS leer sein (P3 aendert keinen Store); neue Routen verboten.
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
 - **G5/S2:** das Werkzeug projiziert NICHT erneut (nur started_at -> at); keine zweite Feldliste; keine Kopie von Endpunkt-Logik.
 - **Bestandsmuster:** registerTools-Idiome, outputSchema/structuredContent wie Nachbar-Tools, MCP_TEXTS-Muster respektiert.
 - **Suppression-Tabu (P1-Lehre):** Suppression-Dateien nur fuer Diff-eigene Dateien; volles Lint 0 Fehler; sonst S1.
 - **P11/T-Serie:** AUSGEFUEHRTE Gegenproben, sonst S1; Tests pinnen den SOLL-Zustand (Schluesselsatz per deepEqual, nicht Substring).
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
4. node --check + ${TEST_CMD} gruen, pass >= ${TEST_FLOOR}, npm run lint (VOLL) 0 Fehler, test:gates nicht roeter. node_modules NICHT committen. git add (betroffene Dateien einzeln) && git commit -m "fix(inbox-p3): Review-Blocker beheben (Runde ${round})". headCommit = git rev-parse HEAD.
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
  toolEndToEnd: (safety && safety.toolEndToEnd) || false,
  payloadWhitelisted: (safety && safety.payloadWhitelisted) || false,
  actionRequiredOnlyOpenItems: (safety && safety.actionRequiredOnlyOpenItems) || false,
  summaryUnavailableLine: (safety && safety.summaryUnavailableLine) || false,
  descriptionPinned: (safety && safety.descriptionPinned) || false,
  gatesNotWorse: (safety && safety.gatesNotWorse) || false,
  fullLintZeroErrors: (safety && safety.fullLintZeroErrors) || false,
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
