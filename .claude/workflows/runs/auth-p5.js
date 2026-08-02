// PER-RUN-Skript AUTH-P5 (Kopie von auth-p4.js, Phase HART GEPINNT).
// Siehe Memory [[phase-impl-workflow-args]]: die Phase steht hier im Skript, nicht in args.

export const meta = {
  name: "phase-impl-lean",
  description:
    "AUTH-P5: internalOnly vor sieben Routen + Audit-Ersatz fuer abgelehnte Anfragen.",
  phases: [
    { title: "Plan", detail: "Code-gegroundeter Umsetzungsplan (clean-code.md + Spec + echter Code)" },
    { title: "Implementieren", detail: "Umsetzung im Worktree, ein Commit, npm test gruen" },
    { title: "Review", detail: "Safety/Verhalten + Clean-Code-Auditor (parallel)" },
    { title: "Self-Fix", detail: "S1/S2/Safety-Blocker fixen + Re-Review, bis PASS" },
    { title: "Report", detail: "Prozessbericht in tasks/auth-gate-p5-report.md" },
  ],
};

const REPO =
  typeof process !== "undefined" && process.env && process.env.OCLAW_REPO
    ? process.env.OCLAW_REPO
    : typeof process !== "undefined" && typeof process.cwd === "function"
      ? process.cwd()
      : ".";
const NODE_MODULES = `${REPO}/node_modules`;

// PER-RUN HART GEPINNT (Lead): keine args-Abhaengigkeit, kein Misfire moeglich.
const PHASE = "AUTH-P5";
const PHASE_TITLE = "internalOnly + Audit-Ersatz";
const BRANCH = "phase/auth-p5-internal-only";
const BASE = "master";
const PLAN_DOC = "PLAN-AUTH-GATE.md";
const SPEC_FILE = "tasks/auth-gate-p5-spec.md";
const MAX_FIX_ROUNDS = 2;
const REPORT_PATH = "tasks/auth-gate-p5-report.md";

const MODEL_OPUS = "opus";
const MODEL_SONNET = "sonnet";

// Modellpolitik (Memory [[workflow-model-policy]]): Plan und Safety auf opus,
// Impl/Audit/Fix/Report auf sonnet. Pins explizit pro agent(), nie erben lassen.
const PLAN_AGENT = { model: MODEL_OPUS, effort: "high" };
const IMPL_AGENT = { model: MODEL_SONNET, effort: "high" };
const SAFETY_AGENT = { model: MODEL_OPUS, effort: "xhigh" };
const CLEANCODE_AGENT = { model: MODEL_SONNET, effort: "medium" };
const FIX_AGENT = { model: MODEL_SONNET, effort: "medium" };
const REPORT_AGENT = { model: MODEL_SONNET, effort: "low" };

const CLEAN_CODE_REQ = `CLEAN-CODE (PFLICHT): Lies "${REPO}/.claude/refs/clean-code.md" (verbindlicher Pruefkatalog) und befolge ihn bei JEDER Code-Entscheidung. Insbesondere: keine Duplizierung (G5/S2, EINE Quelle fuer eine Zugehoerigkeit); keine Magic Numbers ausser 0/1/-1 (G25); kein toter/auskommentierter Code (C5/G9), keine ungenutzten Imports (G12); intentions-ausdrueckende Namen (N1/N2); eine Aufgabe + eine Abstraktionsebene pro Funktion (G30/G34), <=3 Argumente (F1); keine brittle Datei:Zeile-Kommentare (C2); ESM, kein Build-Step, kein TypeScript. Kommentare deutsch OHNE Umlaute (ue/oe/ae) - wie im Bestand.
BESONDERS HIER: die Grund-Token (reason=no_session|expired|not_admin|not_local) sind eine feste, benannte Menge - benannte Konstanten an EINER Stelle, kein freier Text an vier Aufrufstellen (G25/G5). Und der Audit-Aufruf selbst darf nicht dreimal leicht verschieden dastehen.`;

const ABS_RULES = `ABSOLUTE REGELN (unantastbar, siehe CLAUDE.md):
- Safety-Gates (Denylist/Land/Stundenlimit/pro-Tenant-Kostendecke/Max-Dauer/Signaturpruefung/OUTBOUND_FROZEN/Abo+KYC-Outbound-Permit) NIE entfernen/aufweichen/per-Default umgehen.
- AUTH FAIL-CLOSED: im Zweifel ablehnen. Diese Phase macht Sicherungen ENGER, nie weiter.
- SECRETS (Regel 4): Audit-Eintraege tragen NIEMALS einen Query-String. req.path (ohne Query) ist erlaubt, req.originalUrl NICHT - dort haengen der OAuth-code und die Stripe-session_id dran. Das ist der Kernfehler, den diese Phase per Test ausschliesst.
- Disclosure-Satz (disclosureSentence) bleibt fest verdrahtet und unveraendert.
- SCOPE: NUR diese Phase. Keine ungefragten Extras. Keine neuen npm-Dependencies.`;

const P5_SCOPE = `SCOPE DIESER PHASE (bindend, Spec ist die Autoritaet):
- NEU: src/wiring/internal-only.js mit der BENANNTEN Middleware internalOnly = isTrustedLocalCaller(req) ? next() : 403. isTrustedLocalCaller (src/routes/_tenant.js) ist dieselbe Grenze, die AUTH-P3 nutzt - KEINE neue Trust-Idee, und sie wird an genau EINER Stelle formuliert.
- internalOnly kommt vor GENAU SIEBEN Routen: POST /api/calls, POST /api/calls/:id/cancel, GET /api/calls/:id/consult, POST /api/calls/:id/consult/answer (src/routes/api-calls.js), GET /api/state, GET /api/calls/:id, GET /api/tenant-data/export (src/routes/api-read.js).
- AUDIT-ERSATZ: webAuthGateMiddleware, adminOnlyMiddleware und internalOnly schreiben im Ablehnungszweig audit("auth_failed", req, ...) mit einem groben, PII-freien Grund-Token (reason=no_session|expired|not_admin|not_local). Heute schreibt NUR das Basic-Auth-Gate diesen Eintrag - faellt es in P7, verschwindet sonst der einzige Meldeweg.
- W9 (PFLICHTTEST): der Audit-Eintrag einer abgelehnten Anfrage mit ?session_id=XYZ&code=ABC enthaelt WEDER XYZ NOCH ABC. req.path statt req.originalUrl. Ohne diesen Test ist die Phase nicht fertig.
- MITZUFUEHREN im selben Commit: src/route-policy.js - AUTH_MIDDLEWARE_NAMES bekommt "internalOnly" dazu (P1 hat das ausdruecklich vorgesehen), die sieben Routen fallen aus GATE_ONLY_ROUTES (sie klassifizieren ab jetzt als AUTH). ROUTE_FINGERPRINT bleibt UNVERAENDERT (die Routen existieren weiter).
- DIE ERWARTUNGSTABELLE IN scripts/probe-auth.sh BLEIBT UNVERAENDERT. Der Plantext (H10) sagt, die Erwartung fuer /api/state wechsle in P5 von 401 auf 403 - das stimmt am gemessenen Verhalten NICHT: das Basic-Auth-Gate ist in src/app.js VOR allen /api-Routern gemountet und beantwortet eine Anfrage OHNE Credentials (und genau so laeuft die Probe) mit 401, bevor internalOnly ueberhaupt laeuft. Der 403 wird erst mit P7 sichtbar. Wer die Tabelle hier auf 403 dreht, macht die Probe rot, ohne dass ein Defekt vorliegt. Der 403 wird im TEST nachgewiesen, nicht in der Live-Probe.
- NICHT ANFASSEN: src/wiring/auth-gate.js (P7). KEIN webAuthMw/adminMw vor Betreiber-Routen (P6) - nur der Audit-Zweig dieser beiden Middlewares wird ergaenzt. /api/tenant-data/export bekommt internalOnly, NICHT webAuthMw (Plan-Entscheidung 1, nicht neu aufrollen). KEIN Ersatzwerkzeug fuer den DSGVO-Auskunftsweg (geparkt in PLAN-TENANT-EXPORT.md).
- KEINE neue Env-Variable, KEIN neues Flag, KEINE neue Dependency.
- TEST-IDs: "AUTH-P5-N". NICHT mit einem i18n-Katalog-Praefix beginnen (DID|E2E|FMT|GAP|LANG|LAW|MCP|ORIG|OUT|PAY|PROMPT|UI|VOICE|WEB|WORLD gefolgt von einer Ziffer) - solche Tests landen still im test:gates-Lauf, wo Rot erlaubt ist und nichts meldet.
- NIEMALS "git stash" (refs/stash ist zwischen Worktrees geteilt, eine Parallel-Session verliert sonst Arbeit). NIEMALS "git add -A" - im Repo liegen untrackte Dateien mit Kundendaten. Dateien einzeln adden.
- EIN Commit fuer diese Phase.`;

const specInstruction = `Lies "${REPO}/${SPEC_FILE}" VOLLSTAENDIG - das ist die AUTORITATIVE Definition dieser Phase (verbindlich vor dem Plan-Doc).`;

// Token-Disziplin: PLAN-AUTH-GATE.md ist 65 KB. Gezielt lesen, nicht am Stueck.
const planDocInstruction = `Lies aus "${REPO}/${PLAN_DOC}" GEZIELT (die Datei ist gross - nicht am Stueck lesen): Abschnitt 3 (Routen-Inventar, Klasse (b1)), Abschnitt 5 (stille Fehler, dort W9), Abschnitt 7 den Unterabschnitt "### P5" und Abschnitt 10 (Owner-Entscheidungen, dort Entscheidung 1). Nutze grep -n auf die Ueberschriften. Lies ausserdem "${REPO}/tasks/auth-gate-chain.md" (Kettenstand P1-P4).`;

// ---------- Phase 1: Plan ----------
phase("Plan");
const plan = await agent(
  `Du erstellst den DETAILLIERTEN, code-gegroundeten, CLEAN-CODE-KONFORMEN Umsetzungsplan fuer Phase ${PHASE} (${PHASE_TITLE}) im Repo "${REPO}". NUR PLANEN, NICHTS aendern.
1. ${specInstruction}
2. ${planDocInstruction} Lies ausserdem "${REPO}/.claude/refs/clean-code.md".
3. Lies den ECHTEN Code auf Basis "${BASE}": src/routes/_tenant.js (isTrustedLocalCaller, operatorChannelTenant aus AUTH-P3), src/routes/api-calls.js und src/routes/api-read.js VOLLSTAENDIG (die sieben Routen und ihre bestehenden Handler-Ketten), src/web-auth.js (webAuthWithStatusGate/webAuthGateMiddleware, adminOnlyMiddleware - die Ablehnungszweige), src/util.js (audit: was genau geloggt wird), src/wiring/auth-gate.js (wie der heutige auth_failed-Eintrag aussieht - Vorbild fuer Format und Detailtiefe), src/app.js (Mount-Reihenfolge), src/route-policy.js, test/route-auth-inventory.test.js, src/mcp-tools.js (wie die Tools die sieben Routen rufen), test/helpers.js (BASE_ENV, startServer, wie Spawn-Tests X-Forwarded-For setzen koennen), test/audit.test.js (Muster fuer Audit-Assertions). Grep nach Symbolen - KEINE Zeilennummern uebernehmen.
4. Entwirf internalOnly: Datei, Signatur, wo die 403-Antwort herkommt (Format wie die uebrigen Ablehnungen), und wie sie in die sieben Routen-Ketten kommt, ohne die Fachlogik zu beruehren. Achte darauf, dass der Name im Express-Stack sichtbar bleibt (benannte Funktion, keine anonyme Arrow) - der Inventar-Test aus P1 erkennt sie an handler.name.
5. Entwirf den Audit-Ersatz: welche Grund-Token es gibt, wo sie als Konstanten leben, und an welchen GENAU vier Stellen (webAuth 401, webAuth 403, adminOnly 403, internalOnly 403) sie geschrieben werden. Zeige, dass kein Query-String mitgeht.
6. Entwirf die Tests AUTH-P5-*: (a) je Route ein externer Request (X-Forwarded-For gesetzt) -> 403, OHNE sich auf das Basic-Auth-Gate zu verlassen (im Spawn-Test ist kein DASHBOARD_PASSWORD gesetzt - erklaere, warum der Test damit wirklich internalOnly misst); (b) Loopback ohne XFF -> 200, MCP-Pfad bedient; (c) je Middleware ein Audit-Eintrag mit dem richtigen reason-Token; (d) der W9-Leak-Test mit ?session_id=XYZ&code=ABC.
7. Nenne ausdruecklich, welche Bestandstests kippen koennten (besonders alles, was heute /api/state oder /api/calls extern anspricht) und wie du mit jedem einzelnen umgehst.
${P5_SCOPE}
${CLEAN_CODE_REQ}
${ABS_RULES}
LIEFERE: (1) die exakten Edits je Datei; (2) die Liste der Grund-Token mit ihrem Ort; (3) die neuen Tests AUTH-P5-* mit konkreten Assertions; (4) die Mutationsprobe (internalOnly auf next() gedreht -> welche Tests werden rot); (5) die Liste kippender Bestandstests mit Umgang; (6) eine ausdrueckliche Aussage, ob die Probe-Tabelle geaendert werden muss (mit Begruendung - die Spec sagt NEIN, pruefe es am Code nach). Kleiner Blast-Radius. Deine Rueckgabe IST der Plan.`,
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
    sevenRoutesCovered: {
      type: "string",
      description: "Je Route ein Beleg, dass internalOnly in ihrer Handler-Kette steht",
    },
    auditSites: {
      type: "string",
      description:
        "Die vier Ablehnungsstellen mit ihrem reason-Token und dem Beleg, dass kein Query-String mitgeht",
    },
    w9TestResult: {
      type: "string",
      description:
        "Der Leak-Test mit ?session_id=XYZ&code=ABC: Testname + was er assertiert + Ergebnis",
    },
    probeTableUnchanged: {
      type: "boolean",
      description: "scripts/probe-auth.sh ist unveraendert (git diff leer) - so will es die Spec",
    },
    mcpPathProven: {
      type: "string",
      description: "Womit ist belegt, dass der In-Process-MCP-Pfad weiterlebt? Test-Name, nicht Behauptung",
    },
    nodeCheckPass: { type: "boolean" },
    testsPass: { type: "boolean" },
    testPassCount: { type: "number" },
    testFailCount: { type: "number" },
    gatesRedCount: { type: "number", description: "Rote Tests in npm run test:gates (Baseline 3)" },
    existingTestsAdjusted: {
      type: "array",
      items: { type: "string" },
      description: "Je angepasstem Bestandstest: ID - alte Zusage - neue Zusage - Begruendung",
    },
    mutationProbeResult: {
      type: "string",
      description: "internalOnly testweise auf next() gedreht -> welche Tests rot? Mutation zurueckgenommen?",
    },
    committed: { type: "boolean" },
    deviations: { type: "array", items: { type: "string" } },
    summary: { type: "string" },
  },
  required: [
    "headCommit",
    "sevenRoutesCovered",
    "auditSites",
    "w9TestResult",
    "probeTableUnchanged",
    "mcpPathProven",
    "nodeCheckPass",
    "testsPass",
    "testPassCount",
    "testFailCount",
    "mutationProbeResult",
    "existingTestsAdjusted",
    "committed",
    "summary",
  ],
};
const impl = await agent(
  `Du arbeitest in einem FRISCHEN Git-Worktree (isoliert; Working-Tree des Nutzers NICHT anfassen). Setze Phase ${PHASE} GENAU gemaess Plan um:
=== PLAN ===
${plan || "(Plan fehlt - brich ab, melde es in deviations)"}
=== ENDE PLAN ===
VORGEHEN:
1. ln -s "${NODE_MODULES}" node_modules
2. git checkout -b ${BRANCH} ${BASE}
3. internalOnly + die sieben Routen-Ketten + der Audit-Ersatz an vier Stellen + die Tests AUTH-P5-*. node --check je geaenderter Datei, npm test gruen, dann Dateien EINZELN adden und committen: "feat(auth-p5): internalOnly vor den MCP-Routen + Audit fuer abgelehnte Anfragen".
${P5_SCOPE}
${CLEAN_CODE_REQ}
4. npm test gruen. Kippende Bestandstests: jede Anpassung einzeln in existingTestsAdjusted begruenden. Wer eine Assertion abschwaecht, ohne das dort zu erklaeren, hat die Phase verfehlt.
5. npm run test:gates - Zahl in gatesRedCount (Baseline 3).
6. Mutationsprobe: internalOnly testweise auf next() drehen -> GENAU die neuen 403-Tests muessen rot werden, nicht die halbe Suite. Mutation ZURUECKNEHMEN und npm test erneut gruen fahren. Der finale Diff darf keine Mutation tragen.
7. probeTableUnchanged per git diff belegen (scripts/probe-auth.sh muss unveraendert sein).
8. node_modules-Symlink NICHT committen. Nach dem Lauf pruefen: ps aux | grep "[n]ode src/server.js" - verwaiste Testserver beenden.
${ABS_RULES}
EHRLICH fuellen. Tests nicht gruen -> testsPass=false + deviations, nicht schoenen.`,
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
    allSevenRoutesGuarded: {
      type: "boolean",
      description: "internalOnly steht vor allen sieben Routen - selbst am Routengraph nachgerechnet",
    },
    guardIsFailClosed: {
      type: "boolean",
      description:
        "internalOnly lehnt im Zweifel ab; kein Pfad, auf dem ein externer Aufrufer durchkommt",
    },
    testDoesNotLeanOnGate: {
      type: "boolean",
      description:
        "Die 403-Tests messen internalOnly, nicht das Basic-Auth-Gate - selbst nachgerechnet, welche Schicht antwortet",
    },
    noQueryStringInAudit: {
      type: "boolean",
      description:
        "KEIN Audit-Pfad loggt einen Query-String. Selbst geprueft: req.path, nie req.originalUrl. Regel 4.",
    },
    reasonTokensPiiFree: {
      type: "boolean",
      description: "Die Grund-Token sind eine feste, benannte Menge ohne Nutzerdaten",
    },
    inProcessPathAlive: {
      type: "boolean",
      description: "Der In-Process-MCP-Pfad ist per Test belegt am Leben",
    },
    middlewareNamedInStack: {
      type: "boolean",
      description:
        "internalOnly ist eine BENANNTE Funktion und im Express-Stack sichtbar (sonst ist der P1-Inventar-Test blind)",
    },
    probeTableUnchanged: { type: "boolean" },
    policyUpdatedConsistently: {
      type: "boolean",
      description: "route-policy.js: internalOnly in AUTH_MIDDLEWARE_NAMES, die sieben raus aus GATE_ONLY",
    },
    safetyGatesIntact: { type: "boolean" },
    disclosureIntact: { type: "boolean" },
    existingAssertionsNotWeakened: { type: "boolean" },
    noSecretsLeaked: { type: "boolean" },
    approved: { type: "boolean" },
    blockers: { type: "array", items: { type: "string" } },
    concerns: { type: "array", items: { type: "string" } },
    verdict: { type: "string" },
  },
  required: [
    "approved",
    "testsPassIndependently",
    "allSevenRoutesGuarded",
    "guardIsFailClosed",
    "testDoesNotLeanOnGate",
    "noQueryStringInAudit",
    "reasonTokensPiiFree",
    "inProcessPathAlive",
    "middlewareNamedInStack",
    "probeTableUnchanged",
    "policyUpdatedConsistently",
    "safetyGatesIntact",
    "disclosureIntact",
    "existingAssertionsNotWeakened",
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
        `STRENGER, adversarialer Safety-/Verhaltens-Reviewer in frischem Worktree. Pruefe Phase ${PHASE} auf Branch "${target}". Diese Phase entscheidet, wer Transkripte lesen und echte Anrufe ausloesen darf - und sie fasst den Audit-Pfad an, an dem Secrets leaken koennen. Pruefe entsprechend hart.
1. ln -s "${NODE_MODULES}" node_modules
2. git checkout -b review-${String(PHASE).toLowerCase()}${suffix} ${target}
3. npm test selbst -> testsPassIndependently + Zahlen.
4. git diff ${BASE} ${target} gegen die absoluten Regeln pruefen (nutze die MERGE-BASIS: git diff ${BASE}...${target}, drei Punkte - sonst siehst du fremde Arbeit als Loeschung).
${P5_SCOPE}
PRUEFE BESONDERS, jeweils selbst am Code nachgerechnet:
- noQueryStringInAudit: DAS IST DER SICHERHEITSKRITISCHE PUNKT (W9, Absolute Regel 4). Verfolge JEDEN neuen Audit-Aufruf bis zu dem, was er in die Zeile schreibt. Ein req.originalUrl irgendwo im Audit-Pfad ist ein BLOCKER - dort haengen der OAuth-code (/auth/callback) und die Stripe-session_id (/api/billing/checkout-return) dran. Pruefe auch, ob der Leak-Test wirklich beweist, was er behauptet (schickt er die Parameter, und prueft er den geschriebenen Eintrag - nicht nur die Antwort?).
- allSevenRoutesGuarded + guardIsFailClosed: bau oder lies den Routengraph. Steht internalOnly vor ALLEN sieben? Gibt es einen Pfad, auf dem ein externer Aufrufer (mit X-Forwarded-For) durchkommt? Ein einziger ist ein BLOCKER.
- testDoesNotLeanOnGate: lies die neuen 403-Tests. Wenn sie nur deshalb 401/403 sehen, weil DASHBOARD_PASSWORD gesetzt ist und das Gate vorher antwortet, messen sie die falsche Sicherung und sind wertlos. Das ist die Falle dieser Phase.
- middlewareNamedInStack: ist internalOnly eine BENANNTE Funktion (kein anonymes Arrow)? Sonst steht im Express-Stack "<anonymous>" und der P1-Inventar-Test haelt die Routen faelschlich fuer ungeschuetzt. Pruefe zusaetzlich, dass route-policy.js den Namen kennt.
- probeTableUnchanged: git diff auf scripts/probe-auth.sh MUSS leer sein. Die Spec begruendet das ausfuehrlich (das Gate antwortet weiterhin zuerst). Eine geaenderte Tabelle ist hier ein BLOCKER, kein Fleiss.
- inProcessPathAlive: ist per Test belegt (nicht behauptet), dass ein Loopback-Aufruf ohne X-Forwarded-For weiterhin bedient wird? Wenn nein: BLOCKER - dann waeren die MCP-Tools live tot.
- existingAssertionsNotWeakened: git diff auf test/ genau lesen. Jede geaenderte Assertion braucht eine Begruendung.
${ABS_RULES}
approved=true NUR wenn alles erfuellt UND deine Tests gruen. Im Zweifel blockieren.`,
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
2. git diff ${BASE}...${target} (DREI Punkte, gegen die Merge-Basis - sonst siehst du fremde Arbeit als Loeschung); neue Dateien per git show ${target}:<pfad>.
3. Kategorie fuer Kategorie. Pro FLAG: "ID - Datei - Verstoss - Fix" + Schweregrad (S1 Tests/Sicherheit/Korrektheit, S2 Duplizierung, S3 Ausdrucksstaerke, S4 Struktur/Anzahl). S3/S4 gebuendelt.
Achte besonders auf: (a) die Grund-Token muessen benannte Konstanten an EINER Stelle sein, keine vier Stringliterale (G25/G5); (b) der Audit-Aufruf darf nicht viermal leicht verschieden dastehen - gemeinsame Form extrahieren, wo es die Lesbarkeit nicht verschlechtert (G5/S2); (c) internalOnly: benannte Funktion, Name auf der richtigen Abstraktionsebene (N1/N2), Nebeneffekt (Audit-Schreiben) im Namen oder wenigstens im Kommentar sichtbar (N7); (d) die 403-Antwort sollte dieselbe Form haben wie die uebrigen Ablehnungen im Repo (G11 Konsistenz); (e) die neuen Tests: ein Konzept pro Test (P14), Build-Operate-Check (P13), kein geteilter veraenderlicher Zustand (P12/I).
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
3. Behebe DIESE Blocker, fuer jeden korrektheits-/sicherheitsrelevanten Fix einen Regressionstest:
${JSON.stringify(blockers, null, 1)}
${P5_SCOPE}
${CLEAN_CODE_REQ}
${ABS_RULES}
4. node --check + npm test gruen. Dateien EINZELN adden (nie git add -A), kein git stash. node_modules NICHT committen. git commit -m "fix(auth-p5): Review-Blocker beheben (Runde ${round})". headCommit = git rev-parse HEAD.
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
      `r${round}: ABBRUCH - kein Commit vom Fix-Agenten (Branch ${fixBranch} existiert nicht). Self-Fix-Schleife beendet.`,
    );
    break;
  }
  reviewTarget = fixBranch;
  [safety, cc] = await runReview(reviewTarget, `-r${round}`);
}

const approved = gateOk(safety, cc);

// ---------- Phase 5: Prozessbericht ----------
phase("Report");
let reportPath = "";
try {
  const reportAgent = await agent(
    `Schreibe den Bericht der Phase ${PHASE} in die Datei "${REPO}/${REPORT_PATH}" (im Haupt-Repo, NICHT in einem Worktree). NICHTS am Code aendern, KEIN git-Commit.
EHRLICHKEITSREGEL: dieser Bericht darf KEINEN Gewinn behaupten, der nicht belegt ist. Sag ausdruecklich: (a) am heutigen Deploy aendert sich fuer einen Aufrufer OHNE Credentials nichts - das Basic-Auth-Gate antwortet weiterhin zuerst mit 401; der 403 von internalOnly wird erst mit P7 von aussen sichtbar und ist heute nur im Test belegt. (b) Die Annahme, dass isTrustedLocalCaller in Produktion hinter Render fuer den In-Process-Pfad true liefert, traegt jetzt ein Gate. Abbruchsignal live: MCP-Tools in claude.ai liefern Fehler statt Daten -> sofortiger Rollback. Ein reason=not_local im Render-Log ist dann der Beleg.
Inhalt (Markdown): Phase ${PHASE} ${PHASE_TITLE}; Gate=${approved ? "PASS" : "BLOCKED"}; finalBranch=${reviewTarget}; Commit-Hash; die sieben Routen mit Beleg; die vier Audit-Stellen mit ihren Grund-Token; der W9-Leak-Test; die Mutationsprobe; angepasste Bestandstests mit Begruendung; warum die Probe-Tabelle NICHT geaendert wurde; Safety-Urteil; Clean-Code-Audit (s1-s4); Fix-Runden; ein Abschnitt "Was diese Phase NICHT belegt". Quelle:
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
  headCommit: (impl && impl.headCommit) || null,
  testPassCount: (impl && impl.testPassCount) || null,
  gatesRedCount: (impl && impl.gatesRedCount) ?? null,
  sevenRoutesCovered: (impl && impl.sevenRoutesCovered) || "",
  auditSites: (impl && impl.auditSites) || "",
  w9TestResult: (impl && impl.w9TestResult) || "",
  probeTableUnchanged: impl ? impl.probeTableUnchanged === true : false,
  mcpPathProven: (impl && impl.mcpPathProven) || "",
  mutationProbeResult: (impl && impl.mutationProbeResult) || "",
  existingTestsAdjusted: (impl && impl.existingTestsAdjusted) || [],
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
