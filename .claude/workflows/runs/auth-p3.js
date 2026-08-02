// PER-RUN-Skript AUTH-P3 (Kopie von al-d3.js, Phase HART GEPINNT).
// Siehe Memory [[phase-impl-workflow-args]]: die Phase steht hier im Skript, nicht in args.

export const meta = {
  name: "phase-impl-lean",
  description:
    "AUTH-P3: Bootstrap-Fallback fail-closed - eine fehlende Identitaet ist nicht mehr der Owner.",
  phases: [
    { title: "Plan", detail: "Code-gegroundeter Umsetzungsplan (clean-code.md + Spec + echter Code)" },
    { title: "Implementieren", detail: "Umsetzung im Worktree, ein Commit, npm test gruen" },
    { title: "Review", detail: "Safety/Verhalten + Clean-Code-Auditor (parallel)" },
    { title: "Self-Fix", detail: "S1/S2/Safety-Blocker fixen + Re-Review, bis PASS" },
    { title: "Report", detail: "Prozessbericht in tasks/auth-gate-p3-report.md" },
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
const PHASE = "AUTH-P3";
const PHASE_TITLE = "Bootstrap-Fallback fail-closed (B2, der offene Boden)";
const BRANCH = "phase/auth-p3-bootstrap-fail-closed";
const BASE = "master";
const PLAN_DOC = "PLAN-AUTH-GATE.md";
const SPEC_FILE = "tasks/auth-gate-p3-spec.md";
const MAX_FIX_ROUNDS = 2;
const REPORT_PATH = "tasks/auth-gate-p3-report.md";

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

const CLEAN_CODE_REQ = `CLEAN-CODE (PFLICHT): Lies "${REPO}/.claude/refs/clean-code.md" (verbindlicher Pruefkatalog) und befolge ihn bei JEDER Code-Entscheidung. Insbesondere: keine Duplizierung (G5/S2, EINE Quelle fuer eine Zugehoerigkeit); keine Magic Numbers ausser 0/1/-1 (G25); kein toter/auskommentierter Code (C5/G9), keine ungenutzten Imports (G12); intentions-ausdrueckende Namen, Nebeneffekte im Namen sichtbar (N7); eine Aufgabe + eine Abstraktionsebene pro Funktion (G30/G34), <=3 Argumente (F1); keine brittle Datei:Zeile-Kommentare (C2); ESM, kein Build-Step, kein TypeScript. Kommentare deutsch OHNE Umlaute (ue/oe/ae) - wie im Bestand.`;

const ABS_RULES = `ABSOLUTE REGELN (unantastbar, siehe CLAUDE.md):
- Safety-Gates (Denylist/Land/Stundenlimit/pro-Tenant-Kostendecke/Max-Dauer/Signaturpruefung/OUTBOUND_FROZEN/Abo+KYC-Outbound-Permit) NIE entfernen/aufweichen/per-Default umgehen.
- AUTH FAIL-CLOSED: im Zweifel ablehnen. Diese Phase macht eine Sicherung ENGER, nie weiter. Wenn du unsicher bist, ob ein Aufrufer vertrauenswuerdig ist, ist er es NICHT.
- Disclosure-Satz (disclosureSentence) bleibt fest verdrahtet und unveraendert.
- Secrets nur via env, nie loggen/leaken. Audit-Eintraege tragen NIE Query-Strings (kein OAuth-code, keine session_id).
- SCOPE: NUR diese Phase. Keine ungefragten Extras. Keine neuen npm-Dependencies.`;

const P3_SCOPE = `SCOPE DIESER PHASE (bindend, Spec ist die Autoritaet):
- GENAU EINE Verhaltensaenderung: der Bootstrap-Fallback in src/routes/_tenant.js gilt nur noch fuer isTrustedLocalCaller. BEIDE Stellen (der MULTI_TENANT=false-Zweig UND der Fallback in requestTenant).
- KEINE neue Vertrauensquelle. isTrustedLocalCaller ist die vorhandene, security-reviewte Grenze (echtes Loopback UND kein X-Forwarded-For). Kein neuer Header, kein Env-Flag, keine IP-Liste. Wer eine zweite Trust-Idee einfuehrt, hat die Phase verfehlt.
- NICHT ANFASSEN: src/wiring/auth-gate.js (das ist P7), src/route-policy.js, scripts/probe-auth.sh, src/store/defaults.js (BOOTSTRAP_TENANT_ID bleibt), src/config.js, .env.example, render.yaml.
- KEIN internalOnly (P5), KEIN Loeschen toter Routen (P4), KEIN webAuthMw/adminMw vor Betreiber-Routen (P6). Diese Phase macht NUR den Boden zu.
- PFLICHTSCHRITT: vollstaendige Enumeration der Konsumenten des Fallbacks (alle requestTenant-/requireTenant-Aufrufer je Route, scripts/*, src/mcp-tools.js, Tests ohne Identitaet). Ein still sterbender Konsument ist ein BLOCKER. Die Enumeration gehoert in die Rueckgabe.
- TEST-IDs: "AUTH-P3-N". NICHT mit einem i18n-Katalog-Praefix beginnen (DID|E2E|FMT|GAP|LANG|LAW|MCP|ORIG|OUT|PAY|PROMPT|UI|VOICE|WEB|WORLD gefolgt von einer Ziffer) - solche Tests landen still im test:gates-Lauf, wo Rot erlaubt ist und nichts meldet.
- BASE_ENV in test/helpers.js: nur anfassen, wenn eine NEUE config-Env-Variable dazukommt - in dieser Phase kommt keine. (Repo-Lehre test-base-env-drift.)
- NIEMALS "git stash" (refs/stash ist zwischen Worktrees geteilt, eine Parallel-Session verliert sonst Arbeit). NIEMALS "git add -A" - im Repo liegen untrackte Dateien mit Kundendaten. Dateien einzeln adden.
- EIN Commit fuer diese Phase.`;

const specInstruction = `Lies "${REPO}/${SPEC_FILE}" VOLLSTAENDIG - das ist die AUTORITATIVE Definition dieser Phase (verbindlich vor dem Plan-Doc).`;

// Token-Disziplin: PLAN-AUTH-GATE.md ist 65 KB. Gezielt lesen, nicht am Stueck.
const planDocInstruction = `Lies aus "${REPO}/${PLAN_DOC}" GEZIELT (die Datei ist gross - nicht am Stueck lesen): Abschnitt 1 (der empirische Befund, auf dem diese Phase steht), Abschnitt 3 (Routen-Inventar, dort die Klassen (b1)/(b2)), Abschnitt 5 (stille Fehler) und Abschnitt 7 den Unterabschnitt "### P3". Nutze grep -n auf die Ueberschriften.`;

// ---------- Phase 1: Plan ----------
phase("Plan");
const plan = await agent(
  `Du erstellst den DETAILLIERTEN, code-gegroundeten, CLEAN-CODE-KONFORMEN Umsetzungsplan fuer Phase ${PHASE} (${PHASE_TITLE}) im Repo "${REPO}". NUR PLANEN, NICHTS aendern.
1. ${specInstruction}
2. ${planDocInstruction} Lies ausserdem "${REPO}/.claude/refs/clean-code.md".
3. Lies den ECHTEN Code auf Basis "${BASE}": src/routes/_tenant.js VOLLSTAENDIG (isTrustedLocalCaller, isLocalSocket, isProxyForwarded, requestTenant, requireTenant, TENANT_REJECT, der MULTI_TENANT-Zweig), src/store/defaults.js (BOOTSTRAP_TENANT_ID), src/mcp-tools.js (wie die Tools die eigene API rufen, X-Internal-Tenant), src/routes/api-read.js, src/routes/api-calls.js, src/routes/api-tenant-write.js, src/routes/api-billing.js (wer requestTenant/requireTenant ruft und was bei TENANT_REJECT passiert), src/app.js (Mount-Reihenfolge), test/helpers.js (BASE_ENV, startServer, wie Spawn-Tests Requests stellen). Grep nach Symbolen - KEINE Zeilennummern uebernehmen (sie rotten).
4. FUEHRE DIE KONSUMENTEN-ENUMERATION AUS (Pflichtschritt der Spec): grep alle Aufrufer von requestTenant/requireTenant, alles unter scripts/, das die eigene REST-API ruft, und alle Tests, die ohne Identitaet gegen tenant-gebundene Routen fahren. Liefere die Liste MIT Fundstelle und je Eintrag das Urteil: bleibt vertrauenswuerdig / stirbt / unklar. "Unklar" ist ein zulaessiges Urteil und besser als eine Behauptung.
5. Entwirf die Aenderung an BEIDEN Stellen so, dass die Bedingung EINMAL formuliert ist (G5) und ihr Name sagt, was sie bedeutet - nicht "if (local)". Nenne den Vorher/Nachher-Code exakt.
6. Entwirf die Tests: (a) externer Request mit X-Forwarded-For auf /api/state -> 403, und zwar OHNE sich auf das Basic-Auth-Gate zu verlassen (sonst misst der Test die falsche Sicherung - beschreibe genau, wie du das im Spawn-Test erreichst); (b) Loopback ohne X-Forwarded-For -> 200; (c) je ein Fall fuer MULTI_TENANT=false und =true; (d) der In-Process-MCP-Pfad bleibt bedient. Nenne je Test die konkrete Assertion.
7. Nenne ausdruecklich, welche Bestandstests kippen koennten und wie du mit jedem einzelnen umgehst.
${P3_SCOPE}
${CLEAN_CODE_REQ}
${ABS_RULES}
LIEFERE: (1) die Konsumenten-Enumeration mit Urteil je Eintrag; (2) die exakten Edits je Datei (Vorher/Nachher); (3) die neuen Tests AUTH-P3-* mit konkreten Assertions; (4) die Mutationsprobe (wie zeigst du, dass die neuen Tests den alten Zustand rot faerben); (5) die Liste kippender Bestandstests mit Umgang; (6) eine ausdrueckliche Aussage, ob diese Phase von aussen sichtbares Verhalten am heutigen Deploy aendert (Begruendung). Kleiner Blast-Radius. Deine Rueckgabe IST der Plan.`,
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
    consumerEnumeration: {
      type: "array",
      items: { type: "string" },
      description:
        "Je Konsument des Bootstrap-Fallbacks eine Zeile: Fundstelle - Urteil (bleibt/stirbt/unklar) - Begruendung",
    },
    existingTestsAdjusted: {
      type: "array",
      items: { type: "string" },
      description: "Je angepasstem Bestandstest: ID - alte Zusage - neue Zusage - Begruendung",
    },
    externalVisibleChange: {
      type: "string",
      description:
        "Aendert diese Phase von aussen sichtbares Verhalten am heutigen Deploy (Gate steht noch)? Begruendung.",
    },
    mcpPathProven: {
      type: "string",
      description:
        "Womit ist belegt, dass der In-Process-MCP-Pfad weiterlebt? Test-Name + Assertion, nicht Behauptung.",
    },
    nodeCheckPass: { type: "boolean" },
    testsPass: { type: "boolean" },
    testPassCount: { type: "number" },
    testFailCount: { type: "number" },
    gatesRedCount: { type: "number", description: "Rote Tests in npm run test:gates" },
    mutationProbeResult: {
      type: "string",
      description:
        "Bedingung testweise auf den alten Fallback zurueckgedreht -> welche Tests wurden rot? Mutation zurueckgenommen?",
    },
    policyFilesUntouched: {
      type: "boolean",
      description:
        "src/route-policy.js, scripts/probe-auth.sh und src/wiring/auth-gate.js sind unveraendert",
    },
    committed: { type: "boolean" },
    deviations: { type: "array", items: { type: "string" } },
    summary: { type: "string" },
  },
  required: [
    "headCommit",
    "consumerEnumeration",
    "externalVisibleChange",
    "mcpPathProven",
    "nodeCheckPass",
    "testsPass",
    "testPassCount",
    "testFailCount",
    "mutationProbeResult",
    "policyFilesUntouched",
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
3. Die Aenderung an BEIDEN Stellen in src/routes/_tenant.js + die neuen Tests AUTH-P3-*. node --check je geaenderter Datei, npm test gruen, dann Dateien EINZELN adden und committen: "feat(auth-p3): Bootstrap-Fallback fail-closed - anonym ist nicht mehr Owner".
${P3_SCOPE}
${CLEAN_CODE_REQ}
4. npm test gruen. Kippende Bestandstests: jede Anpassung einzeln in existingTestsAdjusted begruenden (ID, alte Zusage, neue Zusage, warum das die Absicht ist). Wer eine Assertion abschwaecht, ohne das dort zu erklaeren, hat die Phase verfehlt.
5. npm run test:gates - Zahl in gatesRedCount. Mehr rot als in der Baseline = deine Aenderung, in deviations.
6. Mutationsprobe: die neue Bedingung testweise auf den alten unkonditionalen Fallback zuruecknehmen -> GENAU die neuen AUTH-P3-Tests muessen rot werden, nicht die halbe Suite. Mutation ZURUECKNEHMEN und npm test erneut gruen fahren. Der finale Diff darf keine Mutation tragen.
7. policyFilesUntouched per git diff belegen (src/route-policy.js, scripts/probe-auth.sh, src/wiring/auth-gate.js).
8. node_modules-Symlink NICHT committen. Nach dem Lauf pruefen: ps aux | grep "[n]ode src/server.js" - verwaiste Testserver beenden.
${ABS_RULES}
EHRLICH fuellen. Tests nicht gruen -> testsPass=false + deviations, nicht schoenen. consumerEnumeration ist keine Floskel: entweder du hast gegreppt (sag was) oder nicht (sag das).`,
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
    failClosedForAnonymous: {
      type: "boolean",
      description:
        "Eine anonyme EXTERNE Anfrage erhaelt nachweislich KEINEN Tenant mehr - selbst wenn das Basic-Auth-Gate entfernt waere",
    },
    bothCallSitesCovered: {
      type: "boolean",
      description: "BEIDE Stellen (MULTI_TENANT=false-Zweig und requestTenant-Fallback) sind gedeckt",
    },
    noNewTrustSource: {
      type: "boolean",
      description:
        "Keine zweite Vertrauensquelle eingefuehrt (kein neuer Header, kein Env-Flag, keine IP-Liste)",
    },
    inProcessPathAlive: {
      type: "boolean",
      description: "Der In-Process-MCP-Pfad (Loopback ohne X-Forwarded-For) ist per Test belegt am Leben",
    },
    testDoesNotLeanOnGate: {
      type: "boolean",
      description:
        "Der 403-Test misst den Resolver, nicht das Basic-Auth-Gate - selbst nachgerechnet, nicht geglaubt",
    },
    policyFilesUntouched: { type: "boolean" },
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
    "failClosedForAnonymous",
    "bothCallSitesCovered",
    "noNewTrustSource",
    "inProcessPathAlive",
    "testDoesNotLeanOnGate",
    "policyFilesUntouched",
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
        `STRENGER, adversarialer Safety-/Verhaltens-Reviewer in frischem Worktree. Pruefe Phase ${PHASE} auf Branch "${target}". Diese Phase entscheidet, WEM der Dienst eine Tenant-Identitaet zuspricht - an ihr haengen Transkripte, Kosten und die Faehigkeit, echte Anrufe auszuloesen. Pruefe entsprechend hart.
1. ln -s "${NODE_MODULES}" node_modules
2. git checkout -b review-${String(PHASE).toLowerCase()}${suffix} ${target}
3. npm test selbst -> testsPassIndependently + Zahlen.
4. git diff ${BASE} ${target} gegen die absoluten Regeln pruefen.
${P3_SCOPE}
PRUEFE BESONDERS, jeweils selbst am Code nachgerechnet:
- failClosedForAnonymous: DAS IST DER WICHTIGSTE PUNKT. Nimm an, das Basic-Auth-Gate waere bereits entfernt (P7). Kann eine anonyme Anfrage von aussen dann noch eine Tenant-Identitaet bekommen? Verfolge JEDEN Pfad durch requestTenant/requireTenant. Ein einziger Pfad, der ohne Identitaet auf den Bootstrap-Tenant faellt, ist ein BLOCKER.
- bothCallSitesCovered: der MULTI_TENANT=false-Zweig UND der Fallback in requestTenant. Eine gedeckte und eine offene Stelle ist ein BLOCKER - der Plan nennt beide ausdruecklich.
- testDoesNotLeanOnGate: lies den neuen 403-Test. Wenn er nur deshalb 403/401 sieht, weil DASHBOARD_PASSWORD gesetzt ist und das Gate vorher antwortet, misst er die falsche Sicherung und ist wertlos. Rechne selbst nach, welche Schicht im Test antwortet. Das ist die Falle dieser Phase.
- noNewTrustSource: git diff nach neuen Headern, Env-Lookups, IP-Listen. isTrustedLocalCaller darf genutzt, aber nicht aufgeweicht werden. Jede Aufweichung ist ein BLOCKER.
- inProcessPathAlive: ist per Test belegt (nicht behauptet), dass ein Loopback-Aufruf ohne X-Forwarded-For weiterhin bedient wird? Wenn nein: concern, und wenn die Konsumenten-Enumeration fehlt, BLOCKER.
- policyFilesUntouched: git diff auf src/route-policy.js, scripts/probe-auth.sh, src/wiring/auth-gate.js, src/config.js, .env.example, render.yaml, src/store/defaults.js. Alles MUSS unveraendert sein.
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
2. git diff ${BASE} ${target} ; neue Dateien per git show ${target}:<pfad>.
3. Kategorie fuer Kategorie. Pro FLAG: "ID - Datei - Verstoss - Fix" + Schweregrad (S1 Tests/Sicherheit/Korrektheit, S2 Duplizierung, S3 Ausdrucksstaerke, S4 Struktur/Anzahl). S3/S4 gebuendelt.
Achte besonders auf: (a) die Bedingung darf nicht an zwei Stellen ausformuliert sein - EINE benannte Quelle (G5/S2); (b) der Name der Bedingung/Hilfsfunktion muss die Absicht tragen, nicht die Mechanik (N1/N2/G20); (c) keine nackten Zahlen oder Magic Strings (G25); (d) Kommentare deutsch OHNE Umlaute, keine Datei:Zeile-Referenzen (C2); (e) die neuen Tests: ein Konzept pro Test (P14), Build-Operate-Check (P13), Grenzfaelle abgedeckt (T5) - und sie duerfen sich keinen gemeinsamen veraenderlichen Zustand teilen (P12/I).
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
${P3_SCOPE}
${CLEAN_CODE_REQ}
${ABS_RULES}
4. node --check + npm test gruen. Dateien EINZELN adden (nie git add -A), kein git stash. node_modules NICHT committen. git commit -m "fix(auth-p3): Review-Blocker beheben (Runde ${round})". headCommit = git rev-parse HEAD.
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
EHRLICHKEITSREGEL: dieser Bericht darf KEINEN Gewinn behaupten, der nicht gemessen wurde. Diese Phase aendert am heutigen Deploy vermutlich KEIN von aussen sichtbares Verhalten (das Basic-Auth-Gate antwortet weiterhin zuerst) - sie zieht den Boden ein, auf dem P7 stehen wird. Sag das ausdruecklich, nicht als Fussnote. Nenne auch, was NICHT belegt ist: ob isTrustedLocalCaller in Produktion hinter Render fuer den In-Process-Pfad wirklich true liefert, ist eine Annahme, die erst der Live-Deploy zeigt (Abbruchsignal: MCP-Tools in claude.ai liefern Fehler statt Daten).
Inhalt (Markdown): Phase ${PHASE} ${PHASE_TITLE}; Gate=${approved ? "PASS" : "BLOCKED"}; finalBranch=${reviewTarget}; Commit-Hash; die Konsumenten-Enumeration als Tabelle; die exakte Aenderung an beiden Stellen; die neuen Tests mit ihren Assertions; die Mutationsprobe mit Ergebnis; angepasste Bestandstests mit Begruendung; Safety-Urteil; Clean-Code-Audit (s1-s4); Fix-Runden; ein Abschnitt "Was diese Phase NICHT belegt". Quelle:
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
  consumerEnumeration: (impl && impl.consumerEnumeration) || [],
  externalVisibleChange: (impl && impl.externalVisibleChange) || "",
  mcpPathProven: (impl && impl.mcpPathProven) || "",
  mutationProbeResult: (impl && impl.mutationProbeResult) || "",
  policyFilesUntouched: impl ? impl.policyFilesUntouched === true : false,
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
