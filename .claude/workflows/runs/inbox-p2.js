// SCHLANKES, SELBST-FIXENDES Phasen-Workflow (Lead bleibt duenn).
// Kopie der Vorlage .claude/workflows/runs/inbox-p1.js, Phase HART GEPINNT auf INBOX-P2.

export const meta = {
  name: "phase-impl-lean-inbox-p2",
  description:
    "INBOX-P2: Konsum-Endpunkt POST /api/inbox/poll (eigene Factory makeInboxRoutes, takeInboxEntries als EINE pure Store-Operation, resultCardView-Umzug nach src/call-result.js). Plan -> Impl (Worktree) -> dualer Review -> Self-Fix -> Report.",
  phases: [
    { title: "Plan", detail: "Umsetzung code-gegroundet planen (Spec: PLAN-ANRUF-INBOX.md, Etappe INBOX-P2)", model: "opus" },
    { title: "Implementieren", detail: "Umsetzung im Worktree, npm test gruen, eslint . 0 Fehler", model: "sonnet" },
    { title: "Review", detail: "Safety/Abnahme + Clean-Code-Auditor (parallel, beide Opus)", model: "opus" },
    { title: "Self-Fix", detail: "S1/S2/Safety-Blocker fixen + Re-Review, bis PASS", model: "sonnet" },
    { title: "Report", detail: "Detailbericht in tasks/inbox-p2-report.md (Lead liest ihn nicht)", model: "sonnet" },
  ],
};

// HART GEPINNT auf das Haupt-Repo (Symlink-Falle, C-P4).
const REPO = "/Users/antonio/Mein Unternehmen/MCP/vodafone-agent";
const NODE_MODULES = `${REPO}/node_modules`;

// PER-RUN-SKRIPT INBOX-P2: Phase HART GEPINNT.
const RUN = {
  phaseId: "INBOX-P2",
  phaseTitle:
    "Konsum-Endpunkt POST /api/inbox/poll: eigene Factory makeInboxRoutes, takeInboxEntries als EINE pure Store-Operation, resultCardView-Umzug nach src/call-result.js",
  branch: "phase/inbox-p2-poll",
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
const REPORT_PATH = "tasks/inbox-p2-report.md";

// MODELL-POLITIK: Urteilen=Opus, Ausfuehren=Sonnet; Pins pro agent() (Memory [[workflow-model-policy]]).
const PLAN_AGENT = { model: "opus", effort: "high" };
const IMPL_AGENT = { model: "sonnet", effort: "high" };
const SAFETY_AGENT = { model: "opus", effort: "xhigh" };
const CLEANCODE_AGENT = { model: "opus", effort: "high" };
const FIX_AGENT = { model: "sonnet", effort: "medium" };
const REPORT_AGENT = { model: "sonnet", effort: "low" };

// Suite-Anker: master nach INBOX-P1-Merge (935b7f4) = 5074 pass. Der Plan-Agent
// misst selbst nach und pinnt den ECHTEN Stand; SINKEN ist ein Blocker.
const TEST_CMD = `LLM_PROVIDER=anthropic npm test`;
const TEST_FLOOR = 5074;

const LINT_REGEL = `LINT-PFLICHT (P1-Lehre, tasks/lessons.md 2026-08-21): npm run lint (eslint ., volles Repo im Worktree) MUSS "0 errors" melden - nicht nur die Zieldateien linten. eslint-suppressions.json und eslint-legacy-exceptions.json duerfen NUR Eintraege von Dateien aendern, die im eigenen Diff stehen; Eintraege UNBETEILIGTER Dateien sind TABU (kein Regenerieren der Gesamtdatei). Der Bestands-Pin "complexity resultCardView 11" wird UMGEHAENGT (mcp-tools.js -> call-result.js), nicht neu angelegt; alle Pin-Zahlen GEMESSEN, nicht geschaetzt.`;

const CLEAN_CODE_REQ = `CLEAN-CODE (PFLICHT): Lies "${REPO}/.claude/refs/clean-code.md" und befolge ihn bei JEDER Entscheidung. Fuer diese Phase besonders: die Antwort-Whitelist existiert GENAU EINMAL (resultCardView zieht nach src/call-result.js und wird von mcp-tools.js importiert - keine Kopie, G5/S2); die Eintrags-Projektion inboxEntryView lebt ALLEIN in state-ops.js; takeInboxEntries ist EINE pure Store-Operation (Projektion + Markierung synchron, kein await dazwischen); kein toter Code; Kommentare deutsch OHNE Umlaute. Neues Verhalten braucht Tests. ${LINT_REGEL}`;

const LEAD_DECISIONS = `BINDENDE LEAD-ENTSCHEIDUNGEN - nicht neu aufrollen, nicht umdeuten:
1. "${PLAN_DOC}" ist AUTORITATIV. Umzusetzen ist NUR Etappe ${PHASE}; INBOX-P1 ist auf ${BASE} bereits gemergt (Praedikat src/inbox-entry.js, Marker inboxEntryAt/inboxSeenAt existieren in beiden Backends). Echte Widersprueche Spec vs Ist-Code in deviations melden, Ist-Code respektieren.
2. R-3 (bindend): takeInboxEntries liefert die Eintraege UND 'marked' (Anzahl markierter Calls); die Backend-Wrapper (json+pg) machen if (marked) save()/flush; der Route-Handler ruft KEIN save(). Leer-Poll = 0 save()-Aufrufe (der json-Store macht sonst einen synchronen Voll-Rewrite mit fsync, der pg-Store einen Voll-Flush aller Tenants).
3. E-3b (bindend): Als-gesehen-Markierung IMPLIZIT beim Abruf (inboxSeenAt setzen), Projektion und Markierung synchron ohne await dazwischen - beim Race zweier Sitzungen bekommt genau EINE die Eintraege. KEIN zweites Bestaetigungs-Werkzeug.
4. E-4 (bindend): POST (nicht GET - der Endpunkt verbraucht Zustand), eigene Factory makeInboxRoutes in src/routes/api-inbox.js (Muster makeCallRoutes/makeBillingRoutes), Mount in app.js, hinter benanntem internalOnly + requireTenant. /api/state bleibt UNANGETASTET; route-policy/ROUTE_FINGERPRINT/scripts/probe-auth.sh gemaess Plan-Dokument nachziehen, sonst ist route-auth-inventory rot.
5. S2-1 (bindend): resultCardView zieht von src/mcp-tools.js nach src/call-result.js (Blatt-Modul, wird von state-ops.js bereits importiert - kein Zyklus) und wird exportiert; mcp-tools.js importiert ihn. KEIN neues MCP-Werkzeug in dieser Etappe (das ist P3).
6. PII (bindend): Audit woertlich audit('inbox_poll', req, 'neu=<n> rest=<m>') - NUR Zaehler; keine Rufnummern, keine Inhalte, keine Call-IDs in Logs. Fixtures nur erkennbar fiktiv im Bestandsstil (+15005550006, +4915112345678, "Jonas Beispiel").
7. KEINE neue Env-Variable.`;

const ABS_RULES = `ABSOLUTE REGELN (unantastbar, siehe CLAUDE.md):
- Safety-Gates NIE anfassen (Outbound-Permit, OUTBOUND_FROZEN, Kostendecke, Signaturpruefung). Offenlegungs-Mechanik NICHT beruehren. Auth fail-closed: der neue Endpunkt ist hinter internalOnly + requireTenant; route-auth-inventory und probe-auth-table MUESSEN gruen sein. Secrets nur via env.
- KEINE echten Anrufe/SMS, KEINE Provider-Schreibzugriffe, KEIN Deploy. Offline gegen Attrappen.
- SCOPE: NUR ${PHASE} gemaess "${PLAN_DOC}". Kein src/bridge.js; mcp-tools.js NUR der resultCardView-Umzug (Import statt lokaler Funktion), KEIN neues Werkzeug.`;

// ---------- Phase 1: Plan ----------
phase("Plan");
const plan = await agent(
  `Du erstellst den DETAILLIERTEN, code-gegroundeten Umsetzungsplan fuer Phase ${PHASE} (${PHASE_TITLE}) im Repo "${REPO}". NUR PLANEN, NICHTS aendern.
1. Lies aus "${REPO}/${PLAN_DOC}" VOLLSTAENDIG: Entwurfsentscheidungen (E-3b, E-4, E-5, R-3, S2-1, S2-3), die Etappe ${PHASE} samt Abnahmekatalog und Dateitabelle, Pre-Mortem + "Bewusst akzeptierte Risiken". AUTORITATIV.
2. Lies "${REPO}/.claude/refs/clean-code.md".
3. Lies den ECHTEN Code auf Basis "${BASE}" (INBOX-P1 ist gemergt!): src/store/state-ops.js (Marker, inboxEntryView-Zielort), src/store.js-Fassade, src/store/json.js + pg.js (save/flush-Semantik - beleg die Leer-Poll-Kosten), src/routes/ (Bestands-Factories als Muster, app.js-Mounts), src/route-policy.js + test/route-auth-inventory.test.js + test/probe-auth-table.test.js + scripts/probe-auth.sh (was ein neuer Endpunkt ALLES braucht), src/mcp-tools.js resultCardView + src/call-result.js (existiert seit AL-P11? pruefe!), src/audit-store.js (audit-Signatur), eslint-legacy-exceptions.json (resultCardView-Pin). Miss selbst: ${TEST_CMD} auf ${BASE} (pass-Zahl = Anker) und npm run lint (MUSS 0 Fehler sein - sonst STOPP und melden).
${LEAD_DECISIONS}
${CLEAN_CODE_REQ}
${ABS_RULES}
DEINE WICHTIGSTEN ZWEI AUFGABEN:
(a) **Die Konsum-Semantik beweisbar machen:** exakter Aufbau von takeInboxEntries (Projektion + inboxSeenAt-Markierung synchron, 'marked' im Rueckgabewert), die drei Tests inbox-poll-route/-flush/-race einzeln entwerfen (erster Poll genau ein Eintrag, zweiter leer; Leer-Poll 0 save()-Aufrufe - wie wird save() gezaehlt?; Race zweier gleichzeitiger Polls: genau einer bekommt den Eintrag).
(b) **Die Auth-Kette lueckenlos:** jede Stelle benennen, die der neue Endpunkt braucht (Factory, Mount, route-policy, ROUTE_FINGERPRINT, probe-auth.sh, X-Forwarded-For-403), mit Bestandsbeispiel als Vorbild.
LIEFERE: exakte Edits je Datei (Vorher/Nachher), neue Tests inkl. Sabotage-Gegenprobe (requireTenant/Tenant-Scoping sabotiert -> Cross-Tenant-Test MUSS rot), je Abnahmepunkt der Etappe Kommando + erwartete Ausgabe. Deine Rueckgabe IST der Plan.`,
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
    pollProof: {
      type: "string",
      description: "Beweis: erster Poll liefert genau den Eintrag, zweiter Poll leer; Race genau-einmal. Kommando + Ausgabe",
    },
    noSaveProof: {
      type: "string",
      description: "Beweis: Leer-Poll = 0 save()-Aufrufe (json UND pg-Wrapper). Kommando + Ausgabe",
    },
    failClosedProof: {
      type: "string",
      description: "AUSGEFUEHRTE Sabotage-Gegenprobe: Tenant-Scoping sabotiert -> Cross-Tenant-Test rot -> wiederhergestellt. Woertlich",
    },
    auditProof: {
      type: "string",
      description: "Beweis: Audit-Zeile matcht /^neu=\\d+ rest=\\d+$/, keine Nummern/IDs/Inhalte. Kommando + Ausgabe",
    },
    lintProof: {
      type: "string",
      description: "npm run lint (eslint ., VOLL) = 0 Fehler; resultCardView-Pin umgehaengt, Zahlen gemessen. Woertlich",
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
    "pollProof",
    "noSaveProof",
    "failClosedProof",
    "auditProof",
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
5. ${TEST_CMD} - pass MUSS >= ${TEST_FLOOR} sein und fail == 0 (Einzel-Flake nur nach isolierter Wiederholung werten; SINKEN unter den vom Plan gemessenen ${BASE}-Anker ist ein Blocker). DAZU npm run lint = 0 Fehler (VOLL, nicht nur Zieldateien).
6. **VIER BEWEISE (alle Pflicht, alle AUSFUEHREN):** pollProof, noSaveProof, failClosedProof (Sabotage-Gegenprobe), auditProof - Kommando+Ausgabe woertlich. Dazu lintProof.
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
    pollConsumesExactlyOnce: {
      type: "boolean",
      description: "SELBST gefahren: erster Poll liefert, zweiter leer; Race zweier Polls liefert genau einmal",
    },
    emptyPollNoSave: { type: "boolean", description: "SELBST gefahren: Leer-Poll = 0 save()-Aufrufe (json und pg)" },
    crossTenantIsolated: {
      type: "boolean",
      description: "SELBST gesehen: Tenant A sieht NIE Eintraege von B; Sabotage-Gegenprobe selbst rot gesehen",
    },
    auditCountersOnly: {
      type: "boolean",
      description: "Audit matcht /^neu=\\d+ rest=\\d+$/; keine Nummern, keine Inhalte, keine Call-IDs in Logs",
    },
    whitelistSingleSource: {
      type: "boolean",
      description: "resultCardView existiert NUR in src/call-result.js; mcp-tools.js importiert; Pin umgehaengt statt neu",
    },
    fullLintZeroErrors: { type: "boolean", description: "npm run lint (eslint ., VOLL) SELBST gemessen = 0 Fehler; Suppressions nur eigene Diff-Dateien" },
    stateRouteUntouched: { type: "boolean", description: "/api/state-Antwort byte-identisch zu ${BASE} (Read-Parity)" },
    noNewEnvVars: { type: "boolean" },
    piiClean: { type: "boolean", description: "keine Klarnummern/Gespraechsinhalte in Logs/Fixtures; nur Bestands-Fakes" },
    routeAuthIntact: { type: "boolean", description: "route-auth-inventory + probe-auth-table gruen; X-Forwarded-For 403 selbst gesehen" },
    safetyGatesIntact: { type: "boolean" },
    noSecretsLeaked: { type: "boolean" },
    scopeRespected: { type: "boolean", description: "kein bridge.js; mcp-tools.js nur Umzugs-Import, kein neues Werkzeug" },
    approved: { type: "boolean" },
    blockers: { type: "array", items: { type: "string" } },
    concerns: { type: "array", items: { type: "string" } },
    verdict: { type: "string" },
  },
  required: [
    "approved",
    "testsPassIndependently",
    "testCountNotShrunk",
    "pollConsumesExactlyOnce",
    "emptyPollNoSave",
    "crossTenantIsolated",
    "auditCountersOnly",
    "whitelistSingleSource",
    "fullLintZeroErrors",
    "stateRouteUntouched",
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
        `STRENGER, adversarialer Safety-/Abnahme-Reviewer in frischem Worktree. Pruefe Phase ${PHASE} auf Branch "${target}". Ein Cross-Tenant-Leck, ein doppelt oder nie ausgelieferter Eintrag oder PII im Log bricht das Kernversprechen - im Zweifel blockieren.
1. ln -s "${NODE_MODULES}" node_modules
2. git checkout -b review-inbox-p2${suffix} ${target}
3. ${TEST_CMD} SELBST (pass >= ${TEST_FLOOR}, fail 0; Einzel-Flake isoliert wiederholen). DAZU npm run lint SELBST (VOLL) = 0 Fehler.
4. Lies die Etappe ${PHASE} + Entwurfsentscheidungen + Pre-Mortem in "${REPO}/${PLAN_DOC}".
5. JEDEN Abnahmepunkt der Etappe EINZELN selbst fahren; keine Impl-Behauptung uebernehmen:
   - **pollConsumesExactlyOnce** + **emptyPollNoSave** + **crossTenantIsolated** (inkl. Sabotage-Gegenprobe SELBST: Tenant-Scoping sabotieren -> Test MUSS rot -> wiederherstellen).
   - **auditCountersOnly:** Audit-Zeilen gegen /^neu=\\d+ rest=\\d+$/; git diff nach console.log/logger-Aufrufen mit Nummern/Inhalten absuchen.
   - **whitelistSingleSource:** grep, dass resultCardView genau EINMAL definiert ist; Pin in eslint-legacy-exceptions.json umgehaengt, nicht dupliziert; Suppression-Eintraege UNBETEILIGTER Dateien unveraendert (git diff der beiden Suppression-Dateien Zeile fuer Zeile!).
   - **stateRouteUntouched:** /api/state-Sicht byte-identisch zu ${BASE} (Read-Parity-Test oder Fixture-Diff selbst fahren).
   - **routeAuthIntact:** route-auth-inventory + probe-auth-table gruen; X-Forwarded-For-403 selbst ausgeloest.
6. git diff ${BASE}..${target} -- src/bridge.js MUSS leer sein; mcp-tools.js-Diff NUR der Umzugs-Import.
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
 - **G5/S2:** resultCardView existiert GENAU EINMAL (call-result.js); inboxEntryView ALLEIN in state-ops.js; keine zweite Konsum-/Markierungslogik.
 - **R-3-Disziplin:** takeInboxEntries pur, 'marked'-Rueckgabe, Wrapper-flush nur bei marked>0, Route ohne save().
 - **Suppression-Tabu (P1-Lehre):** eslint-Suppression-Dateien nur fuer Diff-eigene Dateien geaendert; volles Lint 0 Fehler; sonst S1.
 - **P11/T-Serie:** AUSGEFUEHRTE Gegenproben, sonst S1; Tests pinnen den SOLL-Zustand.
 - Kommentare deutsch OHNE Umlaute; kein toter Code; Factory-Muster des Bestands respektiert.
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
4. node --check + ${TEST_CMD} gruen, pass >= ${TEST_FLOOR}, npm run lint (VOLL) 0 Fehler. node_modules NICHT committen. git add (betroffene Dateien einzeln) && git commit -m "fix(inbox-p2): Review-Blocker beheben (Runde ${round})". headCommit = git rev-parse HEAD.
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
  pollConsumesExactlyOnce: (safety && safety.pollConsumesExactlyOnce) || false,
  emptyPollNoSave: (safety && safety.emptyPollNoSave) || false,
  crossTenantIsolated: (safety && safety.crossTenantIsolated) || false,
  auditCountersOnly: (safety && safety.auditCountersOnly) || false,
  whitelistSingleSource: (safety && safety.whitelistSingleSource) || false,
  fullLintZeroErrors: (safety && safety.fullLintZeroErrors) || false,
  stateRouteUntouched: (safety && safety.stateRouteUntouched) || false,
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
