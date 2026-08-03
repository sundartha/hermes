// PER-RUN-Skript KV-P0 (Kopie von al-d3.js, Phase HART GEPINNT).
// Siehe Memory [[phase-impl-workflow-args]]: die Phase steht hier im Skript, nicht in args.

export const meta = {
  name: "phase-impl-lean",
  description:
    "KV-P0: Flush-Stichtag - die 138 nie gemeldeten usage_event-Altzeilen koennen nicht mehr per Ein-Klick an Stripe gehen.",
  phases: [
    { title: "Plan", detail: "Code-gegroundeter Umsetzungsplan (clean-code.md + Plan-Doc + echter Code)" },
    { title: "Implementieren", detail: "Umsetzung im Worktree, npm test gruen" },
    { title: "Review", detail: "Safety/Verhalten + Clean-Code-Auditor (parallel)" },
    { title: "Self-Fix", detail: "S1/S2/Safety-Blocker fixen + Re-Review, bis PASS" },
    { title: "Report", detail: "Prozessbericht in tasks/kv-p0-report.md" },
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
const PHASE = "KV-P0";
const PHASE_TITLE = "Flush-Stichtag: die Altzeilen koennen nicht mehr abgerechnet werden";
const BRANCH = "phase/kv-p0-flush-stichtag";
const BASE = "master";
const PLAN_DOC = "tasks/PLAN-KOSTEN-VOLLSTAENDIGKEIT.md";
const MAX_FIX_ROUNDS = 2;
const REPORT_PATH = "tasks/kv-p0-report.md";

const MODEL_OPUS = "opus";
const MODEL_SONNET = "sonnet";

// Modellpolitik (Kickoff KV-Kette): KV-P0 beruehrt Absolute Regel 1 (Geld-Pfad) ->
// Plan und Safety auf Opus/high, Impl/Audit/Fix/Report auf Sonnet.
// Pins explizit pro agent(), nie erben lassen (Memory [[workflow-model-policy]]).
const PLAN_AGENT = { model: MODEL_OPUS, effort: "high" };
const IMPL_AGENT = { model: MODEL_SONNET };
const SAFETY_AGENT = { model: MODEL_OPUS, effort: "high" };
const CLEANCODE_AGENT = { model: MODEL_SONNET, effort: "medium" };
const FIX_AGENT = { model: MODEL_SONNET, effort: "medium" };
const REPORT_AGENT = { model: MODEL_SONNET, effort: "low" };

const CLEAN_CODE_REQ = `CLEAN-CODE (PFLICHT): Lies "${REPO}/.claude/refs/clean-code.md" (verbindlicher Pruefkatalog) und befolge ihn bei JEDER Code-Entscheidung. Insbesondere: keine Duplizierung (G5/S2, EINE Quelle fuer eine Zugehoerigkeit); keine Magic Numbers ausser 0/1/-1 (G25, benannte Konstante); kein toter/auskommentierter Code (C5/G9), keine ungenutzten Imports (G12); intentions-ausdrueckende Namen, Nebeneffekte im Namen sichtbar (N7); eine Aufgabe + eine Abstraktionsebene pro Funktion (G30/G34), <=3 Argumente (F1); keine brittle Datei:Zeile-Kommentare (C2); Geld NIE als Fliesskomma (G26/S1); konfigurierbare Werte gehoeren nach src/config.js (G35); ESM, kein Build-Step, kein TypeScript.
UMLAUT-REGEL: Kommentare und Identifier OHNE Umlaute (ue/oe/ae) - wie im Bestand. Gesprochene/angezeigte deutsche Nutzertexte tragen dagegen korrekte Umlaute; in dieser Phase entsteht aber kein gesprochener Text.`;

const ABS_RULES = `ABSOLUTE REGELN (unantastbar, siehe CLAUDE.md):
- Safety-Gates (Denylist/Land/Stundenlimit/pro-Tenant-Kostendecke/Max-Dauer/Signaturpruefung/OUTBOUND_FROZEN, Abo+KYC als Outbound-Permit) NIE entfernen/aufweichen/per-Default umgehen. Diese Phase FUEGT eine Sicherung HINZU.
- AUTH FAIL-CLOSED: der Flush-Endpunkt bleibt hinter seiner bestehenden Absicherung. Keine neue oeffentliche Route, kein Eintrag in src/route-policy.js.
- Disclosure-Satz (disclosureSentence) bleibt unberuehrt.
- SECRETS nur via env, nie loggen/leaken - insbesondere keine Stripe-Keys in Logs, Tests oder Fehlermeldungen.
- SCOPE: NUR diese Phase. Keine ungefragten Extras. Keine neuen npm-Dependencies.`;

const KV_P0_SCOPE = `SCOPE DIESER PHASE (bindend):
ZIEL: \`flushMeters\` meldet ausschliesslich Verbrauchsereignisse mit \`occurredAt >= BILLING_FLUSH_EPOCH\` an Stripe. Fehlt der Wert, wird NICHTS gemeldet (fail-closed). Die Fail-Richtung ist "meldet nichts", NIEMALS "meldet alles" - das ist der ganze Zweck der Phase.

HINTERGRUND (belegt, nicht neu zu erheben): In Prod liegen 138 von 138 \`usage_event\`-Zeilen mit \`stripe_meter_sent = false\`. POST /api/billing/flush-meters hat heute keinen Ausloeser, ist aber scharf (PAYMENT_ENABLED ist live true) und wuerde bei EINEM Aufruf alles auf einmal melden - darunter zwei Inbound-Minuten zum alten 300-ct-Worst-Case-Tarif und zwei als \`number_month\` etikettierte Einrichtungsgebuehren. Das ist ein Ein-Klick-Fehlbetrag gegenueber echten Kunden.

TEIL 1 - Der Stichtag:
- Neue Env-Variable \`BILLING_FLUSH_EPOCH\` (ISO-8601-Zeitstempel), zentralisiert in src/config.js im passenden Billing-Namespace, dokumentiert in .env.example mit Erklaerung der Fail-Richtung. render.yaml pruefen und - falls dort andere Billing-Keys gefuehrt werden - konsistent ergaenzen.
- \`flushMeters\` filtert die Kandidaten auf \`occurredAt >= epoch\`. Ist der Wert nicht gesetzt oder nicht parsebar, wird NICHTS gemeldet und der Grund ist im Log/Rueckgabewert erkennbar (kein stiller 0-Erfolg, der wie "nichts zu tun" aussieht).
- \`sent\` zaehlt die tatsaechlich gemeldete Zahl. Kein Datenschreiben in Prod, kein Backfill, keine Aenderung an \`stripe_meter_sent\`-Semantik.

TEIL 2 - Dokumentationspflicht (Owner-Entscheidung 2a, Teil der Definition of Done):
- README.md fuehrt den Flush-Pfad und \`stripe_meter_sent\` ausdruecklich als "gebaut, bewusst inaktiv": es gibt KEINE nutzungsbasierte Weiterbelastung an Stripe, der Abo-Preis ist endgueltig. Ein Mechanismus, der so aussieht, als liefe er, ist schlimmer als keiner. Kurz, sachlich, an der Stelle, an der README die bewussten Vereinfachungen/Abweichungen fuehrt.
- PLAN-SECURITY.md bekommt den neuen Riegel eingetragen (Definition of Done dieser Phase).

TEST-BASE_ENV (Repo-Lehre, hier kritisch): jede neue config-Env-Variable MUSS in BASE_ENV in test/helpers.js gepinnt werden, sonst leakt die lokale .env in die Spawn-Tests und die Suite misst etwas anderes als sie behauptet. Der gepinnte Default ist der fail-closed-Zustand (nicht gesetzt).

TEST-IDs: "KV-P0-N". NICHT mit einem i18n-Katalog-Praefix beginnen (DID|E2E|FMT|GAP|LANG|LAW|MCP|ORIG|OUT|PAY|PROMPT|UI|VOICE|WEB|WORLD gefolgt von einer Ziffer) - solche Tests landen still im test:gates-Lauf, wo Rot erlaubt ist.

PFLICHT-ABNAHME (aus dem Plan, woertlich):
(1) Test: Ledger mit Zeilen VOR und NACH dem Stichtag -> flushMeters meldet ausschliesslich die spaeteren; \`sent\` zaehlt die richtige Zahl.
(2) Test: ohne gesetzten Stichtag ist \`sent === 0\` und es geht KEIN Ereignis raus.
(3) Grenzfall: ein Ereignis GENAU auf dem Stichtag (>= ist inklusiv) - eigener Fall, nicht mit (1) vermischt.
(4) Mutationsprobe: Stichtag-Filter entfernen -> genau die zugehoerigen Tests rot, nicht die halbe Suite. Mutation ZURUECKNEHMEN, npm test wieder gruen.
KEIN echter Stripe-Aufruf in Tests - der Stripe-Client wird gestellt/gefaked, wie es der Bestand fuer Billing-Tests bereits tut.

NICHT-ZIELE (ausdruecklich):
- KEIN Ausloeser fuer den Flush wird gebaut: kein Cron, kein Sweep-Hook, kein Timer. KV-P9 (Stripe-Weiterbelastung) ist GESTRICHEN.
- Die 138 Altzeilen werden NICHT geloescht, NICHT umetikettiert, NICHT nachgebucht. Sie bleiben stehen und werden durch den Stichtag lediglich unerreichbar fuer den Flush.
- KEINE Aenderung an der Gate-Achse (\`usage.costCents\`/\`spendMonthCostCents\`), an \`bookCents\`, an \`budgetExceeded\`, an der Sofortbuchung oder am Ist-Abgleich. Das ist Sache spaeterer Phasen dieser Kette.
- KEINE neue DB-Spalte, KEIN Backfill.
- KEINE Aenderung am Abo-Preis, am Tarif oder am Preismodell.
- NIEMALS "git stash" (refs/stash ist zwischen Worktrees geteilt). NIEMALS "git add -A" - im Repo liegen untrackte Dateien mit Kundendaten. Dateien EINZELN adden.`;

// ---------- Phase 1: Plan ----------
phase("Plan");
const plan = await agent(
  `Du erstellst den DETAILLIERTEN, code-gegroundeten, CLEAN-CODE-KONFORMEN Umsetzungsplan fuer Phase ${PHASE} (${PHASE_TITLE}) im Repo "${REPO}". NUR PLANEN, NICHTS aendern.
1. Lies "${REPO}/${PLAN_DOC}" - zuerst den Abschnitt "KV-P0", dann "Befund", "Die gemeinsame Wurzel", das Pre-Mortem (besonders TOD 3) und die Owner-Entscheidungen 2 und 7. Das Dokument ist die Autoritaet dieser Phase. Die Owner-Entscheidungen sind BEANTWORTET und nicht neu zu verhandeln.
2. Lies "${REPO}/.claude/refs/clean-code.md" und "${REPO}/CLAUDE.md" (Absolute Regeln, Konventionen).
3. Lies den ECHTEN Code auf Basis "${BASE}" - grep nach Symbolen, uebernimm KEINE Zeilennummern aus dem Plan-Doc (sie rotten): src/routes/api-billing.js (der Flush-Endpunkt und seine Absicherung), src/billing/ (metering.js, stripe.js und was \`flushMeters\` tatsaechlich implementiert - folge dem Aufrufpfad selbst), src/store/state-ops.js (\`recordUsageEvent\`, die usageEvents-Struktur, das Feld \`occurredAt\`, \`stripe_meter_sent\`/\`stripeMeterSent\`), src/store/pg.js + src/store/json.js (wie Verbrauchsereignisse in BEIDEN Backends gelesen/als gemeldet markiert werden - der Filter muss in beiden korrekt wirken), src/config.js (Billing-Namespace, wie Env-Werte deklariert/validiert werden, Muster fuer Pflicht-/Optionalwerte und \`assertConfig\`), .env.example, render.yaml, test/helpers.js (BASE_ENV), und die BESTEHENDEN Billing-Tests (grep test/ nach flushMeters/flush-meters/stripe) - sie zeigen dir, wie der Stripe-Client im Test gestellt wird.
4. ENTSCHEIDE UND BEGRUENDE: (a) Wo genau sitzt der Filter - im Store-Query, in \`flushMeters\`, oder an der Route? Waehle die Stelle, an der er NICHT umgehbar ist, wenn spaeter ein zweiter Aufrufer entsteht (das ist die Wurzel-Lehre dieses Plans: der Filter gehoert an die Entstehung, nicht an eine von mehreren Aufrufstellen). (b) Was passiert bei fehlendem/unparsebarem Wert - wie wird "nichts gemeldet, weil kein Stichtag" von "nichts zu melden" unterscheidbar? (c) Wirkt der Filter in BEIDEN Store-Backends (json + pg) identisch, und wie belegst du das im Test? (d) Zeitzonen/Typen: \`occurredAt\` liegt als was vor (ISO-String, Date, Zeitstempel)? Ein Vergleich zwischen String und Date ist ein Korrektheitsfehler - nenne den exakten Vergleichstyp.
5. Formuliere den README-Absatz (Teil 2) und den PLAN-SECURITY.md-Eintrag AUSFORMULIERT, nicht als Stichwort.
6. Nenne ausdruecklich, welche Bestandstests kippen koennten und wie du mit jedem umgehst.
7. PRE-MORTEM dieser Phase: ein Jahr spaeter ist der Stichtag falsch gebaut. Was ist passiert? Nenne mindestens: der Filter greift nur in einem Backend; der Stichtag wurde als "alles vor jetzt" statt als fester Zeitpunkt gelesen; jemand setzt die Env-Variable auf einen alten Wert und haelt sie fuer harmlos; die Fail-Richtung kippt bei einem leeren String auf "meldet alles". Fuer jedes: die Gegenmassnahme im Bauplan.
${KV_P0_SCOPE}
${CLEAN_CODE_REQ}
${ABS_RULES}
LIEFERE: (1) die exakten Edits je Datei (Vorher/Nachher-Skizze); (2) die Config-Deklaration inkl. Validierung und Fail-Richtung; (3) die Tests KV-P0-* mit konkreten Assertions (inkl. Grenzfall "genau auf dem Stichtag" als EIGENEM Fall und dem Zwei-Backend-Beleg); (4) die Mutationsproben; (5) den README- und PLAN-SECURITY-Text ausformuliert; (6) das Pre-Mortem mit Gegenmassnahmen. Kleiner Blast-Radius. Deine Rueckgabe IST der Plan.`,
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
    existingTestsAdjusted: {
      type: "array",
      items: { type: "string" },
      description: "Je angepasstem Bestandstest: ID - alte Zusage - neue Zusage - Begruendung",
    },
    filterLocation: {
      type: "string",
      description:
        "Wo sitzt der Stichtag-Filter genau (Datei + Funktion) und warum ist er dort nicht umgehbar, wenn ein zweiter Aufrufer entsteht?",
    },
    failClosedProof: {
      type: "string",
      description:
        "Womit ist belegt, dass fehlender/leerer/unparsebarer Stichtag zu 'meldet NICHTS' fuehrt - und nicht zu 'meldet alles'? Welcher Test, welche Eingaben (inkl. leerer String)?",
    },
    bothBackendsProof: {
      type: "string",
      description:
        "Wirkt der Filter in json- UND pg-Backend? Womit belegt (Test, gemeinsame Quelle, oder ehrlich: nicht belegt)?",
    },
    comparisonTypeNote: {
      type: "string",
      description: "Exakter Vergleichstyp fuer occurredAt vs. Stichtag (String/Date/ms) und warum er korrekt ist",
    },
    envVarWiring: {
      type: "string",
      description:
        "BILLING_FLUSH_EPOCH: in src/config.js deklariert (wo), in .env.example dokumentiert, render.yaml geprueft, in BASE_ENV (test/helpers.js) gepinnt - je mit Ja/Nein und Fundstelle",
    },
    readmeUpdated: { type: "boolean", description: "README fuehrt den Flush-Pfad als 'gebaut, bewusst inaktiv'" },
    planSecurityUpdated: { type: "boolean" },
    noTriggerBuilt: {
      type: "boolean",
      description: "MUSS true sein: kein Cron/Sweep-Hook/Timer fuer den Flush gebaut",
    },
    nodeCheckPass: { type: "boolean" },
    testsPass: { type: "boolean" },
    testPassCount: { type: "number" },
    testFailCount: { type: "number" },
    gatesRedCount: { type: "number", description: "Rote Tests in npm run test:gates" },
    mutationProbeResult: { type: "string" },
    committed: { type: "boolean" },
    deviations: { type: "array", items: { type: "string" } },
    summary: { type: "string" },
  },
  required: [
    "headCommit",
    "filterLocation",
    "failClosedProof",
    "bothBackendsProof",
    "comparisonTypeNote",
    "envVarWiring",
    "readmeUpdated",
    "planSecurityUpdated",
    "noTriggerBuilt",
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
2. REGEL 0: ZUERST \`git checkout -b ${BRANCH} ${BASE}\`, DANN erst lesen. Nicht auf einem alten Stand arbeiten.
3. Umsetzung: Stichtag-Filter, Config-Verdrahtung, BASE_ENV-Pin, Tests KV-P0-*, README-Absatz, PLAN-SECURITY.md-Eintrag.
4. node --check auf jede geaenderte src-Datei, dann npm test gruen. Dateien EINZELN adden, committen: "feat(kv-p0): Flush-Stichtag - Altzeilen fail-closed von der Stripe-Meldung ausschliessen".
${KV_P0_SCOPE}
${CLEAN_CODE_REQ}
5. npm test MUSS gruen sein. Kippende Bestandstests: jede Anpassung einzeln in existingTestsAdjusted begruenden (ID, alte Zusage, neue Zusage, warum das die Absicht ist). Wer eine Assertion abschwaecht, ohne das dort zu erklaeren, hat die Phase verfehlt.
6. npm run test:gates zusaetzlich fahren (DARF rot sein - Launch-Katalog, kein Regressionsfang). Zahl in gatesRedCount, und ob deine Aenderung sie erhoeht hat.
7. Mutationsprobe: den Stichtag-Filter entfernen -> GENAU die zugehoerigen KV-P0-Tests rot, nicht die halbe Suite. Zusaetzlich: Stichtag auf leeren String setzen -> es darf NICHTS gemeldet werden. Jede Mutation ZURUECKNEHMEN und npm test erneut gruen fahren. Der finale Diff darf keine Mutation tragen.
8. node_modules-Symlink NICHT committen. Nach dem Lauf: ps aux | grep "[n]ode src/server.js" - verwaiste Testserver beenden.
${ABS_RULES}
EHRLICH fuellen. Tests nicht gruen -> testsPass=false + deviations, nicht schoenen. failClosedProof und bothBackendsProof sind keine Floskeln: entweder du hast es am Code/Test nachgerechnet (sag wie) oder nicht (sag das).`,
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
    failClosedVerified: {
      type: "boolean",
      description:
        "Selbst nachgerechnet: fehlender, leerer, unparsebarer Stichtag -> NICHTS wird gemeldet. Kein Pfad kippt auf 'meldet alles'.",
    },
    filterNotBypassable: {
      type: "boolean",
      description:
        "Der Filter sitzt so, dass ein zweiter Aufrufer von flushMeters ihn nicht umgehen kann; grep nach allen Aufrufern selbst durchgefuehrt",
    },
    bothBackendsCovered: {
      type: "boolean",
      description: "Der Filter wirkt in json- UND pg-Backend; selbst am Code geprueft",
    },
    noProdDataWritten: {
      type: "boolean",
      description: "Kein Backfill, kein Loeschen/Umetikettieren der 138 Altzeilen, keine DB-Migration",
    },
    noTriggerBuilt: { type: "boolean", description: "Kein Cron/Sweep-Hook/Timer fuer den Flush gebaut" },
    gateAxisUntouched: {
      type: "boolean",
      description:
        "usage.costCents/spendMonthCostCents, bookCents, budgetExceeded, Sofortbuchung und Ist-Abgleich sind unveraendert",
    },
    authIntact: {
      type: "boolean",
      description: "Der Flush-Endpunkt bleibt hinter seiner Absicherung; keine neue oeffentliche Route, route-policy.js unveraendert",
    },
    envWiringComplete: {
      type: "boolean",
      description: "config.js + .env.example + render.yaml geprueft + BASE_ENV in test/helpers.js gepinnt",
    },
    docsUpdated: {
      type: "boolean",
      description: "README fuehrt den Flush-Pfad als 'gebaut, bewusst inaktiv'; PLAN-SECURITY.md traegt den Riegel",
    },
    noSecretsLeaked: { type: "boolean" },
    existingAssertionsNotWeakened: { type: "boolean" },
    disclosureIntact: { type: "boolean" },
    safetyGatesIntact: { type: "boolean" },
    approved: { type: "boolean" },
    blockers: { type: "array", items: { type: "string" } },
    concerns: { type: "array", items: { type: "string" } },
    verdict: { type: "string" },
  },
  required: [
    "approved",
    "testsPassIndependently",
    "scopeRespected",
    "failClosedVerified",
    "filterNotBypassable",
    "bothBackendsCovered",
    "noProdDataWritten",
    "noTriggerBuilt",
    "gateAxisUntouched",
    "authIntact",
    "envWiringComplete",
    "docsUpdated",
    "noSecretsLeaked",
    "existingAssertionsNotWeakened",
    "disclosureIntact",
    "safetyGatesIntact",
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
        `STRENGER, adversarialer Safety-/Verhaltens-Reviewer in frischem Worktree. Pruefe Phase ${PHASE} auf Branch "${target}". Diese Phase entscheidet, ob 138 historische Verbrauchsereignisse per EINEM Endpunkt-Aufruf bei echten Kunden abgerechnet werden koennen - pruefe entsprechend hart.
1. ln -s "${NODE_MODULES}" node_modules
2. git checkout -b review-${String(PHASE).toLowerCase()}${suffix} ${target}
3. npm test selbst -> testsPassIndependently + Zahlen.
4. git diff ${BASE} ${target} gegen die absoluten Regeln pruefen.
${KV_P0_SCOPE}
PRUEFE BESONDERS, jeweils SELBST am Code nachgerechnet - nicht dem Impl-Bericht glauben:
- failClosedVerified: DAS IST DER WICHTIGSTE PUNKT. Gehe die Faelle einzeln durch: Env-Variable fehlt / ist leerer String / ist Whitespace / ist ein unparsebarer Text / ist ein gueltiger Zeitstempel. In JEDEM der ersten vier Faelle darf KEIN Ereignis gemeldet werden. Findest du auch nur einen Pfad, auf dem ein fehlender Wert zu "alles melden" oder "Filter uebersprungen" fuehrt, ist das ein BLOCKER. Achte auf JavaScript-Fallen: \`new Date("")\` ist Invalid Date, ein NaN-Vergleich ist IMMER false - pruefe, in welche Richtung ein NaN-Vergleich hier faellt.
- filterNotBypassable: grep repo-weit nach allen Aufrufern des Flush-Pfads und nach der Stelle, an der Kandidaten fuer die Stripe-Meldung ausgewaehlt werden. Sitzt der Filter an der Auswahl (unumgehbar) oder nur an einer von mehreren Aufrufstellen? Letzteres ist genau die Wurzel, die dieser Plan behebt - dann concern oder Blocker, je nach Umgehbarkeit.
- bothBackendsCovered: lies src/store/json.js und src/store/pg.js. Wirkt der Filter in beiden identisch? Ein Filter, der nur im json-Backend greift, ist in Prod (Postgres) wirkungslos - BLOCKER.
- Zeitvergleich: pruefe den Typ von occurredAt an der Vergleichsstelle. String-vs-Date, lokale Zeit vs. UTC, Zeitzonen-lose Strings - jeder falsche Vergleich ist ein Korrektheitsfehler (S1) und hier ein BLOCKER, weil er den Stichtag verschieben kann.
- noProdDataWritten + noTriggerBuilt: git diff nach Migrationen, Backfill-Code, Cron-/Timer-Registrierungen, Aenderungen an boot.js-Intervallen. Ein gebauter Ausloeser ist ein Kosten-/Scope-Verstoss und BLOCKER.
- gateAxisUntouched: git diff auf src/store/state-ops.js, src/billing/metering.js, src/billing/cost-truing.js. Wurde bookCents, budgetExceeded, die Sofortbuchung oder der Ist-Abgleich angefasst? Das ist Sache spaeterer Phasen - jede Aenderung dort ist scope-fremd.
- authIntact: git diff auf src/routes/api-billing.js und src/route-policy.js. Wurde die Absicherung des Endpunkts angefasst oder gelockert? BLOCKER.
- envWiringComplete: git diff auf src/config.js, .env.example, render.yaml, test/helpers.js. Fehlt der BASE_ENV-Pin, leakt die lokale .env in Spawn-Tests und die Suite misst etwas anderes als sie behauptet - das ist ein bekannter Repo-Fehler und hier mindestens eine concern.
- docsUpdated: README fuehrt den Flush-Pfad ausdruecklich als "gebaut, bewusst inaktiv" (Owner-Entscheidung: KEINE nutzungsbasierte Weiterbelastung)? PLAN-SECURITY.md traegt den neuen Riegel? Beides ist Definition of Done - fehlt eines, ist das ein Blocker.
- noSecretsLeaked: keine Stripe-Keys/Tokens in Logs, Tests, Fehlermeldungen oder Fixtures.
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
Achte besonders auf: (a) der Stichtag-Vergleich darf nicht an zwei Stellen unabhaengig implementiert sein (G5/S2) - EINE Quelle; (b) der Zeitvergleich als benannte, intentions-ausdrueckende Funktion statt Inline-Ausdruck (G19/G28); (c) keine Magic Numbers/Zeitkonstanten ohne Namen (G25); (d) Geld nie als Fliesskomma (G26/S1); (e) die neuen Tests: ein Konzept pro Test (P14), Grenzfall als EIGENER Fall (T5), Build-Operate-Check (P13), keine geteilte veraenderliche Fixture zwischen Tests (P12/I); (f) gleiche Fixture-Werte in verschiedenen Faellen testen nichts (Repo-Lehre) - tragen die Vorher-/Nachher-Zeilen unterscheidbare Zeitstempel? (g) Kommentare deutsch OHNE Umlaute; (h) toter Code / auskommentierter Code / ungenutzte Imports (C5/G9/G12).
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
${KV_P0_SCOPE}
${CLEAN_CODE_REQ}
${ABS_RULES}
4. node --check + npm test gruen. Dateien EINZELN adden (nie git add -A), kein git stash. node_modules NICHT committen. git commit -m "fix(kv-p0): Review-Blocker beheben (Runde ${round})". headCommit = git rev-parse HEAD.
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
EHRLICHKEITSREGEL: dieser Bericht darf KEINEN Schutz behaupten, der nicht am Code belegt ist. Was NICHT gemessen wurde, steht ausdruecklich als offen drin - insbesondere: der Riegel ist gegen die LIVE-Datenbank nicht verifiziert (kein Prod-Zugriff in dieser Phase), und die 138 Altzeilen bleiben unveraendert stehen.
Inhalt (Markdown): Phase ${PHASE} ${PHASE_TITLE}; Gate=${approved ? "PASS" : "BLOCKED"}; finalBranch=${reviewTarget}; was gebaut wurde; wo der Filter sitzt und warum dort (filterLocation); der Fail-closed-Beleg (failClosedProof) und der Zwei-Backend-Beleg (bothBackendsProof); der Zeitvergleichstyp; die Env-Verdrahtung inkl. BASE_ENV-Pin; welche Doku-Zeilen entstanden sind (README "gebaut, bewusst inaktiv", PLAN-SECURITY.md); Mutationsproben mit Ergebnis; angepasste Bestandstests mit Begruendung; Safety-Urteil; Clean-Code-Audit (s1-s4); Fix-Runden; ein Abschnitt "Was diese Phase NICHT tut" (kein Ausloeser gebaut, keine Altzeile angefasst, keine Gate-Achse beruehrt, KV-P9 gestrichen) und ein Abschnitt "Was der Lead nach dem Merge tun muss" (BILLING_FLUSH_EPOCH in Render setzen - und was passiert, wenn er es NICHT tut). Quelle:
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
  gatesRedCount: (impl && impl.gatesRedCount) ?? null,
  filterLocation: (impl && impl.filterLocation) || "",
  failClosedProof: (impl && impl.failClosedProof) || "",
  bothBackendsProof: (impl && impl.bothBackendsProof) || "",
  comparisonTypeNote: (impl && impl.comparisonTypeNote) || "",
  envVarWiring: (impl && impl.envVarWiring) || "",
  readmeUpdated: impl ? impl.readmeUpdated === true : false,
  planSecurityUpdated: impl ? impl.planSecurityUpdated === true : false,
  noTriggerBuilt: impl ? impl.noTriggerBuilt === true : false,
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
