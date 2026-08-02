// PER-RUN-Skript AUTH-P4 (Kopie von auth-p3.js, Phase HART GEPINNT).
// Siehe Memory [[phase-impl-workflow-args]]: die Phase steht hier im Skript, nicht in args.

export const meta = {
  name: "phase-impl-lean",
  description:
    "AUTH-P4: tote, aber scharfe Routen loeschen - das anonyme Schreibfenster faellt vor dem Gate.",
  phases: [
    { title: "Plan", detail: "Code-gegroundeter Umsetzungsplan (clean-code.md + Spec + echter Code)" },
    { title: "Implementieren", detail: "Umsetzung im Worktree, ein Commit, npm test gruen" },
    { title: "Review", detail: "Safety/Verhalten + Clean-Code-Auditor (parallel)" },
    { title: "Self-Fix", detail: "S1/S2/Safety-Blocker fixen + Re-Review, bis PASS" },
    { title: "Report", detail: "Prozessbericht in tasks/auth-gate-p4-report.md" },
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
const PHASE = "AUTH-P4";
const PHASE_TITLE = "Tote, aber scharfe Routen loeschen (B1)";
const BRANCH = "phase/auth-p4-tote-routen-loeschen";
const BASE = "master";
const PLAN_DOC = "PLAN-AUTH-GATE.md";
const SPEC_FILE = "tasks/auth-gate-p4-spec.md";
const MAX_FIX_ROUNDS = 2;
const REPORT_PATH = "tasks/auth-gate-p4-report.md";

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
BESONDERS HIER: eine Loesch-Phase ist die Gelegenheit, Reste zu hinterlassen. Ungenutzte Importe, verwaiste Helfer, tote Testfixtures und Kommentare, die auf geloeschte Routen zeigen - all das ist G12/C2/G9 und faellt in dieser Phase mit.`;

const ABS_RULES = `ABSOLUTE REGELN (unantastbar, siehe CLAUDE.md):
- Safety-Gates (Denylist/Land/Stundenlimit/pro-Tenant-Kostendecke/Max-Dauer/Signaturpruefung/OUTBOUND_FROZEN/Abo+KYC-Outbound-Permit) NIE entfernen/aufweichen/per-Default umgehen.
- AUTH FAIL-CLOSED: im Zweifel ablehnen.
- Disclosure-Satz (disclosureSentence) bleibt fest verdrahtet und unveraendert.
- Secrets nur via env, nie loggen/leaken.
- SCOPE: NUR diese Phase. Keine ungefragten Extras. Keine neuen npm-Dependencies.`;

const P4_SCOPE = `SCOPE DIESER PHASE (bindend, Spec ist die Autoritaet):
- GENAU SECHS Routen fallen ersatzlos: POST /api/settings, POST /api/action-items/:id/toggle, POST /api/calendar (alle in src/routes/api-tenant-write.js) sowie GET /api/profiles, POST /api/profiles, DELETE /api/profiles/:tenantId (src/routes/api-profiles.js). Beide Dateien entfallen VOLLSTAENDIG, ebenso ihre Mounts und Importe in src/app.js.
- PFLICHT-UMZUG, sonst bricht der Boot: validIdentity und IDENTITY_MAX_LEN werden von src/routes/api-onboard.js aus api-profiles.js importiert. Sie ziehen nach src/routes/_validation.js (neue Datei, Namenskonvention wie _tenant.js). Import in api-onboard.js nachziehen.
- IM SELBEN COMMIT mitfuehren (H10 - die Erwartung wandert mit der Phase), sonst widersprechen sich die Sicherungen:
  (1) src/route-policy.js: die sechs Eintraege aus GATE_ONLY_ROUTES ENTFERNEN. Sie wandern NICHT nach PUBLIC_ROUTES.
  (2) test/route-auth-inventory.test.js: ROUTE_FINGERPRINT um die sechs Zeilen kuerzen.
  (3) scripts/probe-auth.sh: die sechs Tabellenzeilen von ART "sitzung" auf "fehlt" drehen. ERWARTETER STATUS BLEIBT 401 und ANTWORTET BLEIBT "gate" - das Basic-Auth-Gate haengt vor dem 404-Handler und maskiert die geloeschte Route am heutigen Deploy weiterhin mit 401. Erst P7 dreht sie auf 404. Die Zeilen werden NICHT geloescht: als Negativkontrolle sind sie mehr wert denn je.
  (4) docs/RUNBOOK-AUTH-REVIEW.md nur, falls dort eine der Routen namentlich steht.
  test/probe-auth-table.test.js haelt (1) und (3) zusammen - wird eine Stelle vergessen, ist npm test rot. Das ist der Mechanismus, kein Hindernis.
- PFLICHTSCHRITT: vollstaendige Enumeration der AUFRUFER der sechs Routen (grep ueber src/, scripts/, apps/web/src/, public/, test/, src/mcp-tools.js). Ein gefundener LEBENDER Aufrufer ausserhalb von Tests ist ein BLOCKER - dann stimmt die Praemisse "tot" nicht und der Owner entscheidet neu. Die Enumeration gehoert in die Rueckgabe.
- NICHT ANFASSEN: src/wiring/auth-gate.js (das ist P7), src/routes/_tenant.js (P3 ist fertig), der Profil-MECHANISMUS (resolveProfile, PROFILES_JSON, src/outbound-gates.js) - es faellt NUR die HTTP-Schreibflaeche. POST /api/billing/setup-checkout und GET /api/billing/checkout-return bleiben STEHEN (die fallen erst in P9, nach 30 Tagen Karenz wegen offener Stripe-Sessions).
- KEIN internalOnly (P5), KEIN webAuthMw/adminMw (P6).
- Owner-Entscheidung, NICHT neu aufrollen: mit POST /api/settings faellt die einzige HTTP-Schreibflaeche fuer Settings-Felder ausserhalb der Self-Service-Whitelist. Der Owner hat das ausdruecklich akzeptiert.
- TEST-IDs: "AUTH-P4-N". NICHT mit einem i18n-Katalog-Praefix beginnen (DID|E2E|FMT|GAP|LANG|LAW|MCP|ORIG|OUT|PAY|PROMPT|UI|VOICE|WEB|WORLD gefolgt von einer Ziffer) - solche Tests landen still im test:gates-Lauf, wo Rot erlaubt ist und nichts meldet.
- NIEMALS "git stash" (refs/stash ist zwischen Worktrees geteilt, eine Parallel-Session verliert sonst Arbeit). NIEMALS "git add -A" - im Repo liegen untrackte Dateien mit Kundendaten. Dateien einzeln adden, geloeschte mit "git rm".
- EIN Commit fuer diese Phase.`;

const specInstruction = `Lies "${REPO}/${SPEC_FILE}" VOLLSTAENDIG - das ist die AUTORITATIVE Definition dieser Phase (verbindlich vor dem Plan-Doc).`;

// Token-Disziplin: PLAN-AUTH-GATE.md ist 65 KB. Gezielt lesen, nicht am Stueck.
const planDocInstruction = `Lies aus "${REPO}/${PLAN_DOC}" GEZIELT (die Datei ist gross - nicht am Stueck lesen): Abschnitt 3 (Routen-Inventar, dort besonders die Klasse (b2) mit den Belegen, warum diese Routen als tot gelten), Abschnitt 5 (stille Fehler) und Abschnitt 7 den Unterabschnitt "### P4". Nutze grep -n auf die Ueberschriften. Lies ausserdem "${REPO}/tasks/auth-gate-chain.md" (Kettenstand: was P1-P3 gebaut haben).`;

// ---------- Phase 1: Plan ----------
phase("Plan");
const plan = await agent(
  `Du erstellst den DETAILLIERTEN, code-gegroundeten, CLEAN-CODE-KONFORMEN Umsetzungsplan fuer Phase ${PHASE} (${PHASE_TITLE}) im Repo "${REPO}". NUR PLANEN, NICHTS aendern.
1. ${specInstruction}
2. ${planDocInstruction} Lies ausserdem "${REPO}/.claude/refs/clean-code.md".
3. Lies den ECHTEN Code auf Basis "${BASE}": src/routes/api-tenant-write.js und src/routes/api-profiles.js VOLLSTAENDIG, src/routes/api-onboard.js (der Import von validIdentity/IDENTITY_MAX_LEN und jede Nutzung), src/app.js (die beiden Mounts + Importe + die umgebenden Kommentare), src/route-policy.js, test/route-auth-inventory.test.js (ROUTE_FINGERPRINT), scripts/probe-auth.sh (die Erwartungstabelle), test/probe-auth-table.test.js (welche Invarianten es haelt), src/outbound-gates.js (wie resolveProfile/unrestricted konsumiert wird - der Mechanismus BLEIBT), src/self-service.js (die Whitelist, die den Settings-Schreibpfad ersetzt). Grep nach Symbolen - KEINE Zeilennummern uebernehmen (sie rotten).
4. FUEHRE DIE AUFRUFER-ENUMERATION AUS (Pflichtschritt der Spec): grep nach jedem der sechs Routenpfade UND nach den Fabriknamen (makeTenantWriteRoutes, makeProfileRoutes) ueber src/, scripts/, apps/web/src/, public/, test/, src/mcp-tools.js, docs/. Liefere die Trefferliste MIT Fundstelle und je Treffer das Urteil: toter Verweis / lebender Aufrufer / Test / Doku. Ein lebender Aufrufer ausserhalb von Tests ist ein BLOCKER - sag das dann deutlich, statt zu loeschen.
5. Entwirf den Umzug von validIdentity/IDENTITY_MAX_LEN nach src/routes/_validation.js: was genau wandert, wer importiert danach woher, und warum die neue Datei so heisst.
6. Entwirf die vier Mitzieh-Stellen (route-policy, Fingerprint, Probe-Tabelle, Runbook) EXAKT: welche Zeile wird wie. Fuer die Probe-Tabelle: ART sitzung -> fehlt, STATUS bleibt 401, ANTWORTET bleibt gate. Begruende in einem Satz, warum 401 und nicht 404.
7. Entwirf die Tests AUTH-P4-*: je Route ein 404-Nachweis im Spawn-Test (dort ist kein DASHBOARD_PASSWORD gesetzt, das Gate ruft next() - erklaere, warum der Test damit wirklich die Abwesenheit der Route misst), plus ein Test, dass POST /api/onboard nach dem Umzug unveraendert funktioniert.
8. Nenne ausdruecklich, welche Bestandstests entfallen bzw. umgestellt werden und warum das kein Verlust an Zusage ist.
${P4_SCOPE}
${CLEAN_CODE_REQ}
${ABS_RULES}
LIEFERE: (1) die Aufrufer-Enumeration mit Urteil je Treffer; (2) die exakten Edits je Datei (inkl. der vier Mitzieh-Stellen); (3) den Umzugsplan fuer validIdentity; (4) die neuen Tests AUTH-P4-* mit konkreten Assertions; (5) die Liste entfallender/umgestellter Bestandstests mit Begruendung; (6) eine Aussage, was am heutigen Deploy von aussen sichtbar anders wird (mit Begruendung). Kleiner Blast-Radius. Deine Rueckgabe IST der Plan.`,
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
    filesDeleted: { type: "array", items: { type: "string" } },
    testsAddedOrChanged: { type: "array", items: { type: "string" } },
    callerEnumeration: {
      type: "array",
      items: { type: "string" },
      description:
        "Je Treffer eine Zeile: Fundstelle - Urteil (toter Verweis/lebender Aufrufer/Test/Doku) - Begruendung",
    },
    liveCallerFound: {
      type: "boolean",
      description:
        "Wurde ein LEBENDER Aufrufer ausserhalb von Tests gefunden? true = die Praemisse 'tot' stimmt nicht",
    },
    fourSitesUpdated: {
      type: "string",
      description:
        "Beleg je Mitzieh-Stelle: route-policy.js, ROUTE_FINGERPRINT, probe-auth.sh-Tabelle, Runbook - was genau geaendert wurde",
    },
    validIdentityMove: {
      type: "string",
      description: "Wohin validIdentity/IDENTITY_MAX_LEN gewandert sind und wer sie danach importiert",
    },
    bootProven: {
      type: "string",
      description:
        "Womit ist belegt, dass der Server nach dem Loeschen ohne Import-Fehler bootet? Test-Name, nicht Behauptung",
    },
    nodeCheckPass: { type: "boolean" },
    testsPass: { type: "boolean" },
    testPassCount: { type: "number" },
    testFailCount: { type: "number" },
    gatesRedCount: { type: "number", description: "Rote Tests in npm run test:gates" },
    existingTestsAdjusted: {
      type: "array",
      items: { type: "string" },
      description: "Je entfallenem/umgestelltem Bestandstest: ID - alte Zusage - Umgang - Begruendung",
    },
    externalVisibleChange: {
      type: "string",
      description: "Was wird am heutigen Deploy von aussen sichtbar anders? Begruendung.",
    },
    profileMechanismUntouched: {
      type: "boolean",
      description: "resolveProfile, PROFILES_JSON und src/outbound-gates.js sind unveraendert",
    },
    committed: { type: "boolean" },
    deviations: { type: "array", items: { type: "string" } },
    summary: { type: "string" },
  },
  required: [
    "headCommit",
    "callerEnumeration",
    "liveCallerFound",
    "fourSitesUpdated",
    "validIdentityMove",
    "bootProven",
    "nodeCheckPass",
    "testsPass",
    "testPassCount",
    "testFailCount",
    "externalVisibleChange",
    "profileMechanismUntouched",
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
3. ZUERST die Aufrufer-Enumeration selbst fahren (nicht dem Plan glauben - greppen). Findest du einen LEBENDEN Aufrufer ausserhalb von Tests: NICHT loeschen, liveCallerFound=true setzen, in deviations begruenden und die Phase mit dem abschliessen, was sicher ist.
4. Dann: Umzug von validIdentity/IDENTITY_MAX_LEN, Loeschen der beiden Route-Dateien (git rm), Mounts und Importe aus src/app.js entfernen, die vier Mitzieh-Stellen nachziehen, Tests AUTH-P4-*. node --check je geaenderter Datei, npm test gruen, dann Dateien EINZELN adden und committen: "feat(auth-p4): tote Schreibrouten loeschen - anonymes Schreibfenster vor dem Gate-Wegfall".
${P4_SCOPE}
${CLEAN_CODE_REQ}
5. npm test gruen. Entfallende/umgestellte Bestandstests: jeden einzeln in existingTestsAdjusted begruenden. Wer einen Test loescht, ohne dass seine Zusage mit der Route entfaellt, hat die Phase verfehlt.
6. npm run test:gates - Zahl in gatesRedCount.
7. bootProven: es reicht NICHT, node --check zu fahren. Ein Spawn-Test MUSS den Server wirklich starten (sonst faellt ein kaputter Import erst live auf). Nenne den Test.
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
    allSixRoutesGone: {
      type: "boolean",
      description: "Alle sechs Routen sind wirklich weg - selbst am Routengraph nachgerechnet",
    },
    noLiveCallerBroken: {
      type: "boolean",
      description:
        "Selbst gegreppt: kein lebender Aufrufer ausserhalb von Tests zeigt noch auf eine der sechs Routen",
    },
    bootIntact: {
      type: "boolean",
      description: "Der Server startet ohne Import-Fehler - per Spawn-Test belegt, nicht per node --check",
    },
    fourSitesConsistent: {
      type: "boolean",
      description:
        "route-policy.js, ROUTE_FINGERPRINT und die Probe-Tabelle sagen dasselbe",
    },
    probeRowsKeptAsNegativeControl: {
      type: "boolean",
      description:
        "Die sechs Probe-Zeilen sind auf ART 'fehlt' gedreht (STATUS 401, ANTWORTET gate) und NICHT geloescht",
    },
    profileMechanismUntouched: {
      type: "boolean",
      description: "resolveProfile, PROFILES_JSON, src/outbound-gates.js unveraendert",
    },
    legacyCheckoutPairKept: {
      type: "boolean",
      description: "POST /api/billing/setup-checkout und GET /api/billing/checkout-return stehen noch (P9)",
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
    "allSixRoutesGone",
    "noLiveCallerBroken",
    "bootIntact",
    "fourSitesConsistent",
    "probeRowsKeptAsNegativeControl",
    "profileMechanismUntouched",
    "legacyCheckoutPairKept",
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
        `STRENGER, adversarialer Safety-/Verhaltens-Reviewer in frischem Worktree. Pruefe Phase ${PHASE} auf Branch "${target}". Diese Phase LOESCHT Routen aus einem Dienst, der echte Anrufe fuehrt - ein uebersehener lebender Aufrufer bricht Betrieb, eine uebersehene Route laesst ein anonymes Schreibfenster offen. Pruefe entsprechend hart.
1. ln -s "${NODE_MODULES}" node_modules
2. git checkout -b review-${String(PHASE).toLowerCase()}${suffix} ${target}
3. npm test selbst -> testsPassIndependently + Zahlen.
4. git diff ${BASE} ${target} gegen die absoluten Regeln pruefen.
${P4_SCOPE}
PRUEFE BESONDERS, jeweils selbst am Code nachgerechnet:
- allSixRoutesGone: verlass dich NICHT auf den Fingerprint. Bau oder lies den Routengraph und weise nach, dass keine der sechs Routen mehr registriert ist. Eine noch registrierte Route ist ein BLOCKER.
- noLiveCallerBroken: greppe SELBST ueber src/, scripts/, apps/web/src/, public/, src/mcp-tools.js nach den sechs Pfaden und nach makeTenantWriteRoutes/makeProfileRoutes. Ein lebender Aufrufer ausserhalb von Tests ist ein BLOCKER - dann war die Praemisse "tot" falsch.
- bootIntact: DAS IST DIE FALLE DIESER PHASE. validIdentity/IDENTITY_MAX_LEN wurden von api-onboard.js aus der geloeschten Datei importiert. Weise per SPAWN-Test (Server startet wirklich) nach, dass der Boot durchlaeuft. node --check allein reicht NICHT - es faengt keinen fehlenden Export.
- fourSitesConsistent + probeRowsKeptAsNegativeControl: lies src/route-policy.js, den ROUTE_FINGERPRINT und die Tabelle in scripts/probe-auth.sh NEBENEINANDER. Sagen sie dasselbe? Sind die sechs Probe-Zeilen auf "fehlt" gedreht (STATUS 401, ANTWORTET gate) und NICHT geloescht? Ein geloeschter Eintrag statt einer gedrehten Zeile ist eine verlorene Negativkontrolle - bei mehreren ein Blocker.
- profileMechanismUntouched: git diff auf src/outbound-gates.js, resolveProfile, PROFILES_JSON. Jede Aenderung dort ist scope-fremd und ein BLOCKER - es sollte NUR die HTTP-Flaeche fallen.
- legacyCheckoutPairKept: stehen POST /api/billing/setup-checkout und GET /api/billing/checkout-return noch? Sie duerfen hier NICHT mitfallen (P9, 30 Tage Karenz wegen offener Stripe-Sessions).
- existingAssertionsNotWeakened: git diff auf test/ genau lesen. Ein geloeschter Test ist nur dann in Ordnung, wenn seine Zusage mit der Route entfaellt. Ein geloeschter Test, dessen Zusage weiterlebt, ist ein BLOCKER.
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
Achte besonders auf die typischen Reste einer LOESCH-Phase: (a) ungenutzte Importe und verwaiste Helfer in src/app.js und anderswo (G12); (b) Kommentare, die noch auf geloeschte Routen/Dateien zeigen (C2 - besonders die Modulkommentare in src/app.js, die die Mount-Reihenfolge beschreiben); (c) tote Testfixtures/Helfer, die nur diese Routen bedient haben (G9/F4); (d) die neue Datei src/routes/_validation.js: traegt sie genau das Umgezogene und nichts sonst, ist der Name auf der richtigen Abstraktionsebene (N2), und wurde beim Umzug nichts dupliziert statt verschoben (G5/S2); (e) die neuen Tests: ein Konzept pro Test (P14), keine geteilten veraenderlichen Zustaende (P12/I).
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
${P4_SCOPE}
${CLEAN_CODE_REQ}
${ABS_RULES}
4. node --check + npm test gruen. Dateien EINZELN adden (nie git add -A), kein git stash. node_modules NICHT committen. git commit -m "fix(auth-p4): Review-Blocker beheben (Runde ${round})". headCommit = git rev-parse HEAD.
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
EHRLICHKEITSREGEL: dieser Bericht darf KEINEN Gewinn behaupten, der nicht belegt ist. Sag ausdruecklich, worauf die Praemisse "diese Routen sind tot" beruht (die Enumeration - mit ihrem Umfang UND ihrer Grenze: ein Aufrufer AUSSERHALB des Repos, etwa ein Betreiber-curl oder ein Bookmark, ist per grep nicht auffindbar). Sag auch, was am heutigen Deploy von aussen sichtbar wird und was nicht (das Basic-Auth-Gate maskiert geloeschte Routen weiterhin mit 401 statt 404).
Inhalt (Markdown): Phase ${PHASE} ${PHASE_TITLE}; Gate=${approved ? "PASS" : "BLOCKED"}; finalBranch=${reviewTarget}; Commit-Hash; die Aufrufer-Enumeration als Tabelle; der Umzug von validIdentity; die vier Mitzieh-Stellen mit Vorher/Nachher; die neuen Tests mit Assertions; entfallene/umgestellte Bestandstests mit Begruendung; der Boot-Nachweis; Safety-Urteil; Clean-Code-Audit (s1-s4); Fix-Runden; ein Abschnitt "Was diese Phase NICHT belegt". Quelle:
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
  callerEnumeration: (impl && impl.callerEnumeration) || [],
  liveCallerFound: impl ? impl.liveCallerFound === true : null,
  fourSitesUpdated: (impl && impl.fourSitesUpdated) || "",
  validIdentityMove: (impl && impl.validIdentityMove) || "",
  bootProven: (impl && impl.bootProven) || "",
  externalVisibleChange: (impl && impl.externalVisibleChange) || "",
  profileMechanismUntouched: impl ? impl.profileMechanismUntouched === true : false,
  existingTestsAdjusted: (impl && impl.existingTestsAdjusted) || [],
  filesTouched: [
    ...((impl && impl.filesCreated) || []),
    ...((impl && impl.filesEdited) || []),
    ...((impl && impl.filesDeleted) || []),
  ].slice(0, 40),
  fixRounds: round,
  fixSummaries,
  remainingBlockers: approved ? [] : blockerList(safety, cc),
  reportPath,
  summary: impl && impl.summary ? impl.summary.slice(0, 600) : "",
};
