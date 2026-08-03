// PER-RUN-Skript KV-P6 (Phase HART GEPINNT).
// Schema traegt NUR Skalare mit Laengenlimit (Lehre: 16-KB-Nutzlast toetet den Lauf).

export const meta = {
  name: "phase-impl-lean",
  description:
    "KV-P6: der Ledger fuehrt Geld in Mikro-Cent - die 0-Cent-Zeilen werden zu echten Betraegen, ohne die Gate-Achse zu beruehren.",
  phases: [
    { title: "Plan", detail: "Code-gegroundeter Umsetzungsplan" },
    { title: "Implementieren", detail: "Umsetzung im Worktree, npm test gruen" },
    { title: "Review", detail: "Safety/Verhalten + Clean-Code-Auditor (parallel)" },
    { title: "Self-Fix", detail: "Blocker fixen + Re-Review, bis PASS" },
    { title: "Report", detail: "Prozessbericht in tasks/kv-p6-report.md" },
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
const PHASE = "KV-P6";
const PHASE_TITLE = "Der Ledger fuehrt Geld in Mikro-Cent";
const BRANCH = "phase/kv-p6-ledger-mikro-cent";
const BASE = "master";
const PLAN_DOC = "tasks/PLAN-KOSTEN-VOLLSTAENDIGKEIT.md";
const MAX_FIX_ROUNDS = 2;
const REPORT_PATH = "tasks/kv-p6-report.md";

const MODEL_SONNET = "sonnet";

// Modellpolitik (Kickoff KV-Kette): KV-P6 fuegt eine additiv-nullable Spalte hinzu, die
// die Gate-Achse nachweislich nicht beruehrt -> komplett Sonnet.
const PLAN_AGENT = { model: MODEL_SONNET, effort: "medium" };
const IMPL_AGENT = { model: MODEL_SONNET };
const SAFETY_AGENT = { model: MODEL_SONNET, effort: "medium" };
const CLEANCODE_AGENT = { model: MODEL_SONNET, effort: "medium" };
const FIX_AGENT = { model: MODEL_SONNET, effort: "medium" };
const REPORT_AGENT = { model: MODEL_SONNET, effort: "low" };

const SCHEMA_RULE = `SCHEMA-REGEL (bindend, sonst stirbt der Lauf): JEDES Textfeld deiner StructuredOutput-Antwort bleibt KURZ - hoechstens etwa 400 Zeichen, KEINE Markdown-Tabellen, KEINE Code-Bloecke, KEINE langen eingebetteten Zeilenumbrueche. Alles Umfangreiche schreibst du in eine DATEI und nennst im Feld nur den Pfad plus einen Satz. Ein Vorlauf dieser Kette ist an einer 16-KB-Nutzlast gestorben, nachdem die Arbeit bereits committet war.`;

const CLEAN_CODE_REQ = `CLEAN-CODE (PFLICHT): Lies "${REPO}/.claude/refs/clean-code.md". Insbesondere: **G26/S1 - Geld NIEMALS als Fliesskomma**; Mikro-Cent sind Ganzzahlen, und wo gerundet wird, muss der Rest fortgeschrieben statt verworfen werden - das ist der ganze Zweck dieser Phase; keine Duplizierung (G5/S2 - EINE Stelle rechnet Betrag zu Mikro-Cent, nicht zwei); keine Magic Numbers ausser 0/1/-1 (G25 - der Faktor Cent->Mikro-Cent ist eine benannte Konstante, keine nackte 10000 im Code); N7 - Nebeneffekte im Namen; C2 - ueberholte Kommentare mitziehen; ESM, kein Build-Step, kein TypeScript. Tests: ein Konzept pro Test (P14), Grenzfaelle (T5 - 0, sehr kleine Betraege, sehr grosse Summen), Build-Operate-Check (P13).
PFLICHT VOR JEDEM "EXISTIERT NICHT"-BEFUND: greppe am AUSGECHECKTEN BRANCH, nicht nur im Diff (Repo-Lehre KV-M0).
UMLAUT-REGEL: Kommentare und Identifier OHNE Umlaute (ue/oe/ae).`;

const ABS_RULES = `ABSOLUTE REGELN (unantastbar, siehe CLAUDE.md):
- Die Gate-Achse (usage.costCents / spendMonthCostCents, bookCents, budgetExceeded) wird von dieser Phase NICHT beruehrt. Sie ist von der Rundung nachweislich nicht betroffen - sie fuehrt den Mikro-Cent-Rest bereits. Jede Aenderung dort ist ein BLOCKER.
- Was Stripe bekommt, aendert sich NICHT. Der Melde-Payload traegt die Rohmenge, nicht diesen Wert.
- Alle Safety-Gates unberuehrt. Disclosure-Satz unberuehrt.
- SECRETS nur via env, nie loggen. AUTH FAIL-CLOSED: keine neue Route.
- SCOPE: NUR diese Phase. Keine ungefragten Extras. Keine neuen npm-Dependencies.`;

const KV_P6_SCOPE = `SCOPE DIESER PHASE (bindend):

DER BEFUND: 101 von 101 \`ai_token\`-Ledger-Zeilen tragen \`cost_cents = 0\` bei zusammen ueber 210.000 Tokens. Ursache: die Cent-Umrechnung rundet JE EINZELEREIGNIS mit \`Math.round\`, waehrend die Gate-Achse direkt daneben den Mikro-Cent-Rest fortschreibt und deshalb korrekt bleibt. **Die Gate-Achse ist NICHT betroffen** - relevant wird die 0 erst, sobald ein Bericht diesen Ledger als Kostenquelle liest. Genau das will KV-M4 (die naechste Phase) tun; dann ist die 0 aktive Fehlinformation. Ein weiterer Beleg aus KV-M1: alle 5 \`ai_token\`-Zeilen des vermessenen Anrufs tragen \`cost_cents = 0\`.

TEIL 1 - Die neue Spalte:
- \`usage_event\` bekommt \`cost_micro_cents\` (BIGINT, additiv-nullable). BIGINT, nicht NUMERIC und nicht Float (G26).
- Der Ledger-Schreiber fuellt BEIDE Felder: \`cost_cents\` unveraendert wie bisher, \`cost_micro_cents\` mit dem ungerundeten Ganzzahl-Betrag in Mikro-Cent.
- \`cost_cents\` bleibt in Bedeutung und Wert UNVERAENDERT. Kein Bestandsverbraucher darf sich anders verhalten.

TEIL 2 - Die DB-Regel (Befund N5 des Plans, SELBST VERIFIZIEREN):
Der Plan behauptet, dass DDL beim Boot automatisch laeuft: \`store/pg.js\` ruft \`migrate()\` unbedingt aus \`init()\`, \`init()\` wird awaited, und der Prozess beendet sich mit exit(1), wenn es wirft - also ist \`applySchema\` auf der Live-DB erfolgreich durchgelaufen. \`applySchema\` fuehrt die Schema-Datei als Skript aus, die bereits Dutzende \`ADD COLUMN IF NOT EXISTS\` enthaelt.
**Verifiziere diese Kette SELBST am Code, bevor du dich darauf verlaesst.** Es gibt eine aeltere, gegenteilige Notiz im Projektgedaechtnis ("Migrationen laufen NICHT automatisch"). Wenn die Kette haelt, ist die neue Spalte genau EINE Zeile in der Schema-Datei und KEIN Handgriff. Wenn sie NICHT haelt, ist das der wichtigste Befund dieser Phase und gehoert vor jeder Zeile Code in den Bericht.
Finde den echten Pfad der Schema-Datei selbst (grep, nicht raten).

TEIL 3 - KEIN Backfill:
Die Altzeilen sind mit 0 gebucht und BLEIBEN es. Das gehoert ausdruecklich in den Phasenbericht, damit nicht in einem halben Jahr jemand die 101 Nullen fuer eine Messung haelt. Ein Backfill wuerde Betraege erfinden, die nie erhoben wurden.

DIE PFLICHT-ABNAHMEN:
(1) DER KERNTEST: viele aufeinanderfolgende Buchungen unterhalb eines halben Cents (Groessenordnung 100 Turns) summieren sich in \`cost_micro_cents\` auf **EXAKT** denselben Betrag, den die Gate-Achse gebucht hat. Abweichung 0, nicht "ungefaehr", nicht "gerundet gleich". **Genau diese Gleichheit ist die Eigenschaft, die KV-M4 braucht** - ohne sie vergleicht die Gegenprobe zwei Buecher, die nie gleich sein koennen.
(2) \`cost_cents\` verhaelt sich unveraendert: derselbe Wert wie vor der Phase, bei denselben Eingaben. Ein Bestandstest belegt das.
(3) Grenzfaelle: ein Betrag von exakt 0; ein sehr kleiner Betrag, der auf 0 Cent rundet, aber Mikro-Cent > 0 traegt; eine Summe, die den Ganzzahlbereich strapaziert (BIGINT-Grund).
(4) Beide Store-Backends: die Spalte wird in json UND pg geschrieben und gelesen. Ein Feld, das nur im json-Backend existiert, ist in Prod (Postgres) wirkungslos.
(5) Mutationsprobe: den Mikro-Cent-Wert wieder aus dem gerundeten Cent-Wert ableiten (also die Rundung erneut einbauen) -> der Kerntest MUSS rot werden.

TEST-IDs: "KV-P6-N". NICHT mit einem i18n-Katalog-Praefix beginnen (DID|E2E|FMT|GAP|LANG|LAW|MCP|ORIG|OUT|PAY|PROMPT|UI|VOICE|WEB|WORLD gefolgt von einer Ziffer).

LANDKARTE: Diese Phase kippt KEINE Zeile. \`ai_token\` steht bereits auf ledger=true/gate=true; der Ledger wird genauer, nicht neu verdrahtet. Kein \`ledger\`- oder \`gate\`-Wert darf sich aendern - eine Wertaenderung dort ist ein BLOCKER. Der \`preisquelle\`-Text der betroffenen Zeilen DARF praezisiert werden (die Rundungsaussage stimmt danach nicht mehr, C2).

NICHT-ZIELE (ausdruecklich):
- KEIN Backfill der Altzeilen.
- KEINE Aenderung an der Gate-Achse, an \`bookCents\`, \`trackUsage\`, \`addUsageCostCents\`, \`applyCreditCents\`, \`budgetExceeded\`.
- KEINE Aenderung am Stripe-Payload oder an \`stripe_meter_sent\`.
- KEINE Aenderung an \`cost_cents\` (Wert oder Bedeutung).
- KEINE neue Env-Variable, KEIN neues Flag.
- KEIN Handgriff in psql als "Erledigung" - eine Spalte entsteht in der Schema-Datei, sonst gar nicht.
- NIEMALS "git stash". NIEMALS "git add -A". Dateien EINZELN adden.`;

// ---------- Phase 1: Plan ----------
phase("Plan");
const plan = await agent(
  `Du erstellst den DETAILLIERTEN, code-gegroundeten, CLEAN-CODE-KONFORMEN Umsetzungsplan fuer Phase ${PHASE} (${PHASE_TITLE}) im Repo "${REPO}". NUR PLANEN, NICHTS aendern.
1. Lies "${REPO}/${PLAN_DOC}": den Abschnitt "KV-P6", den Befund N5 (DDL laeuft automatisch, Backfill nicht), die Divergenz-Tabelle unter "Die gemeinsame Wurzel" (die Zeile "KI-Tokens: ja, aber auf 0 gerundet") und den Abschnitt "KV-M4" (die naechste Phase, die diese Gleichheit BRAUCHT).
2. Lies "${REPO}/.claude/refs/clean-code.md" und "${REPO}/CLAUDE.md".
3. Lies den ECHTEN Code auf Basis "${BASE}" - grep nach Symbolen, uebernimm KEINE Zeilennummern:
   - src/store/state-ops.js: \`recordUsageEvent\` (der einzige Ledger-Schreiber), \`aiCostCents\` (die rundende Umrechnung), \`trackUsage\` und der Mikro-Cent-Rest der Gate-Achse (\`costMicroCentsRem\` o.ae.) - verstehe GENAU, warum die Gate-Achse korrekt bleibt und der Ledger nicht
   - die Schema-Datei (grep nach "usage_event" und "ADD COLUMN IF NOT EXISTS") - finde den echten Pfad
   - src/store/pg.js: \`init\`, \`migrate\`, \`applySchema\`, und wie usage_event-Zeilen geschrieben/hydriert werden (welche Spalten werden gelesen?)
   - src/store/json.js: dasselbe fuer das JSON-Backend
   - src/billing/meter.js + src/billing/stripe.js: was genau geht an Stripe? (Beleg, dass cost_cents dort nicht der uebertragene Wert ist)
   - src/billing/cost-ledger-map.js: die preisquelle-Texte, die die Rundung erwaehnen
   - test/: bestehende usage-event-Tests, die Fixture-Muster fuer beide Backends (makePgTestStore o.ae.)
4. ENTSCHEIDE UND BEGRUENDE:
   (a) Wo genau wird der Mikro-Cent-Betrag berechnet, und wie ist ausgeschlossen, dass er an zwei Stellen unabhaengig entsteht (G5)?
   (b) Der Faktor Cent -> Mikro-Cent als benannte Konstante: existiert schon eine im Repo? Grep - wenn ja, wiederverwenden statt neu anlegen.
   (c) Haelt die Automatik-Kette aus N5? Zeig die Belegstellen. Wenn nein: was ist der Handgriff, und was gehoert in den Bericht?
   (d) Wie wird die EXAKTE Gleichheit zwischen Ledger-Summe und Gate-Achse hergestellt - dieselbe Rechenquelle, oder zwei Rechnungen, die zufaellig uebereinstimmen? Nur Ersteres traegt.
   (e) Welche Bestandsverbraucher lesen \`cost_cents\` und duerfen sich NICHT anders verhalten?
5. Nenne ausdruecklich, welche Bestandstests kippen und wie du mit jedem umgehst.
6. PRE-MORTEM: ein Jahr spaeter hat KV-P6 Schaden angerichtet. Was ist passiert? Nenne mindestens: die neue Spalte wurde in Prod nie angelegt, weil die Automatik-Annahme falsch war, und KV-M4 vergleicht gegen NULL; die Mikro-Cent-Summe und die Gate-Achse divergieren, weil sie aus zwei Rechnungen stammen; jemand haelt die 101 Null-Altzeilen fuer eine Messung; die Spalte laeuft irgendwann ueber, weil sie zu klein gewaehlt wurde. Fuer jedes: die Gegenmassnahme.
${KV_P6_SCOPE}
${CLEAN_CODE_REQ}
${ABS_RULES}
LIEFERE: (1) die exakten Edits je Datei; (2) die Schema-Zeile im Wortlaut; (3) die Tests KV-P6-* mit konkreten Assertions, besonders den Kerntest mit EXAKTER Gleichheit; (4) die Mutationsprobe; (5) die Antwort auf N5 mit Belegstellen; (6) das Pre-Mortem. Kleiner Blast-Radius. Deine Rueckgabe IST der Plan.`,
  { label: `${PHASE}-plan`, phase: "Plan", ...PLAN_AGENT },
);

// ---------- Phase 2: Implementieren ----------
phase("Implementieren");
const IMPL_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    headCommit: { type: "string" },
    filesEdited: { type: "array", items: { type: "string" } },
    testsAddedOrChanged: { type: "array", items: { type: "string" } },
    existingTestsAdjusted: {
      type: "array",
      items: { type: "string" },
      description: "Je Bestandstest: ID - alte Zusage - neue Zusage - Begruendung. Je Eintrag hoechstens 250 Zeichen.",
    },
    schemaLine: { type: "string", description: "Die neue Schema-Zeile im Wortlaut + Dateipfad. Hoechstens 250 Zeichen." },
    autoMigrationVerdict: {
      type: "string",
      description:
        "Haelt die Automatik-Kette aus N5 (init->migrate->applySchema)? Belegstellen. Wenn nein: welcher Handgriff noetig? Hoechstens 400 Zeichen.",
    },
    exactEqualityProof: {
      type: "string",
      description:
        "Der Kerntest: wie viele Buchungen, welcher Betrag, Abweichung EXAKT 0? Und: stammen Ledger und Gate-Achse aus DERSELBEN Rechenquelle? Hoechstens 400 Zeichen.",
    },
    microCentConstant: {
      type: "string",
      description: "Name und Fundort der Cent->Mikro-Cent-Konstante; neu angelegt oder wiederverwendet? Hoechstens 250 Zeichen.",
    },
    bothBackends: {
      type: "string",
      description: "Wird die Spalte in json UND pg geschrieben und gelesen? Womit belegt? Hoechstens 300 Zeichen.",
    },
    costCentsUnchanged: {
      type: "boolean",
      description: "cost_cents unveraendert in Wert und Bedeutung; kein Bestandsverbraucher verhaelt sich anders",
    },
    stripePayloadUnchanged: { type: "boolean" },
    gateAxisUntouched: { type: "boolean" },
    noBackfill: { type: "boolean", description: "MUSS true sein: kein Backfill der Altzeilen" },
    noMapValueChanged: { type: "boolean", description: "Kein ledger/gate-Wert geaendert" },
    nodeCheckPass: { type: "boolean" },
    testsPass: { type: "boolean" },
    testPassCount: { type: "number" },
    testFailCount: { type: "number" },
    mutationProbeResult: { type: "string", description: "Hoechstens 400 Zeichen" },
    committed: { type: "boolean" },
    deviations: { type: "array", items: { type: "string" } },
    summary: { type: "string", description: "Hoechstens 500 Zeichen" },
  },
  required: [
    "headCommit",
    "schemaLine",
    "autoMigrationVerdict",
    "exactEqualityProof",
    "microCentConstant",
    "bothBackends",
    "costCentsUnchanged",
    "stripePayloadUnchanged",
    "gateAxisUntouched",
    "noBackfill",
    "noMapValueChanged",
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
  `Du arbeitest in einem FRISCHEN Git-Worktree (isoliert). Setze Phase ${PHASE} GENAU gemaess Plan um:
=== PLAN ===
${plan || "(Plan fehlt - brich ab, melde es in deviations)"}
=== ENDE PLAN ===
VORGEHEN:
1. ln -s "${NODE_MODULES}" node_modules
2. REGEL 0: ZUERST \`git checkout -b ${BRANCH} ${BASE}\`, DANN erst lesen.
3. Umsetzung: Schema-Zeile, Ledger-Schreiber, beide Backends, Tests KV-P6-*.
4. node --check auf jede geaenderte src-Datei, dann npm test gruen. Dateien EINZELN adden, committen: "feat(kv-p6): Ledger fuehrt Geld in Mikro-Cent".
${KV_P6_SCOPE}
${CLEAN_CODE_REQ}
5. npm test MUSS gruen sein. Kippende Bestandstests einzeln in existingTestsAdjusted begruenden.
   HINWEIS ZU FLAKES: test/auth-p9a-cache-headers.test.js und einige Spawn-Tests werden unter Volllast rot, sind isoliert aber gruen (bekanntes Repo-Muster). Wird ein Test rot, fahr ihn ISOLIERT nach (node --test <datei>) und melde beides. Nicht "reparieren", was isoliert gruen ist.
6. npm run test:gates zusaetzlich (DARF rot sein). auth-p9a-cache-headers haengt bekanntermassen unter --test-name-pattern - wenn der Lauf haengt, brich ab und melde es.
7. MUTATIONSPROBE: den Mikro-Cent-Wert aus dem GERUNDETEN Cent-Wert ableiten (Rundung wieder einbauen) -> der Kerntest MUSS rot werden. Zuruecknehmen, npm test erneut gruen. Der finale Diff darf keine Mutation tragen.
8. node_modules-Symlink NICHT committen. Nach dem Lauf: ps aux | grep "[n]ode src/server.js" - verwaiste Testserver beenden.
${SCHEMA_RULE}
${ABS_RULES}
EHRLICH fuellen. exactEqualityProof ist der Kern: "ungefaehr gleich" reicht nicht - KV-M4 vergleicht danach zwei Buecher und braucht exakte Gleichheit, sonst misst die Gegenprobe Rauschen.`,
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
    independentTestSummary: { type: "string", description: "Hoechstens 300 Zeichen" },
    scopeRespected: { type: "boolean" },
    gateAxisUntouched: {
      type: "boolean",
      description: "SELBST geprueft: bookCents/trackUsage/addUsageCostCents/applyCreditCents/budgetExceeded unveraendert",
    },
    costCentsUnchanged: {
      type: "boolean",
      description: "SELBST geprueft: cost_cents traegt bei denselben Eingaben denselben Wert wie vorher",
    },
    stripePayloadUnchanged: { type: "boolean", description: "SELBST geprueft: was an Stripe geht, ist unveraendert" },
    exactEquality: {
      type: "boolean",
      description:
        "SELBST verifiziert: Ledger-Summe in Mikro-Cent == Gate-Achse, Abweichung EXAKT 0 - und beide stammen aus derselben Rechenquelle, nicht aus zwei Rechnungen",
    },
    noFloatMoney: {
      type: "boolean",
      description: "SELBST geprueft: keine Fliesskomma-Arithmetik auf Geld; Mikro-Cent sind Ganzzahlen (G26/S1)",
    },
    bothBackendsCovered: { type: "boolean", description: "Spalte in json UND pg geschrieben und gelesen" },
    columnAdditiveNullable: {
      type: "boolean",
      description: "ADD COLUMN IF NOT EXISTS, nullable, BIGINT - eine Bestandszeile ohne Wert bricht nichts",
    },
    noBackfill: { type: "boolean" },
    noMapValueChanged: { type: "boolean" },
    noSecretsLeaked: { type: "boolean" },
    existingAssertionsNotWeakened: { type: "boolean" },
    safetyGatesIntact: { type: "boolean" },
    approved: { type: "boolean" },
    blockers: { type: "array", items: { type: "string" }, description: "Je Eintrag hoechstens 400 Zeichen" },
    concerns: { type: "array", items: { type: "string" }, description: "Je Eintrag hoechstens 300 Zeichen" },
    verdict: { type: "string", description: "Hoechstens 500 Zeichen" },
  },
  required: [
    "approved",
    "testsPassIndependently",
    "scopeRespected",
    "gateAxisUntouched",
    "costCentsUnchanged",
    "stripePayloadUnchanged",
    "exactEquality",
    "noFloatMoney",
    "bothBackendsCovered",
    "columnAdditiveNullable",
    "noBackfill",
    "noMapValueChanged",
    "noSecretsLeaked",
    "existingAssertionsNotWeakened",
    "safetyGatesIntact",
    "blockers",
    "verdict",
  ],
};
const CC_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    s1: { type: "array", items: { type: "string" }, description: "Je Eintrag hoechstens 400 Zeichen" },
    s2: { type: "array", items: { type: "string" }, description: "Je Eintrag hoechstens 400 Zeichen" },
    s3: { type: "array", items: { type: "string" }, description: "Je Eintrag hoechstens 250 Zeichen" },
    s4: { type: "array", items: { type: "string" }, description: "Je Eintrag hoechstens 250 Zeichen" },
    blocker: { type: "boolean" },
    grepCheckDone: { type: "boolean" },
    verdict: { type: "string", description: "Hoechstens 400 Zeichen" },
  },
  required: ["s1", "s2", "s3", "s4", "blocker", "grepCheckDone", "verdict"],
};

async function runReview(target, suffix) {
  return await parallel([
    () =>
      agent(
        `STRENGER, adversarialer Safety-/Verhaltens-Reviewer in frischem Worktree. Pruefe Phase ${PHASE} auf Branch "${target}". Diese Phase fasst den Geld-Ledger an - sie darf die Gate-Achse und den Stripe-Pfad NICHT beruehren.
1. ln -s "${NODE_MODULES}" node_modules
2. git checkout -b review-${String(PHASE).toLowerCase()}${suffix} ${target}
3. npm test selbst -> testsPassIndependently + Zahlen. HINWEIS: auth-p9a-cache-headers und einige Spawn-Tests sind unter Volllast flaky, isoliert gruen - wird etwas rot, isoliert nachfahren und beides melden.
4. git diff ${BASE} ${target} gegen die absoluten Regeln pruefen.
${KV_P6_SCOPE}
PRUEFE BESONDERS, jeweils SELBST am Code nachgerechnet:
- exactEquality: DAS IST DER WICHTIGSTE PUNKT. Lies den Kerntest. Vergleicht er wirklich die SUMME vieler kleiner Buchungen gegen die Gate-Achse, mit Abweichung EXAKT 0? Und - entscheidend - stammen beide Werte aus DERSELBEN Rechenquelle, oder aus zwei unabhaengigen Rechnungen, die heute zufaellig uebereinstimmen? Zwei Rechnungen sind ein BLOCKER: KV-M4 verlaesst sich darauf, dass die Gleichheit strukturell gilt, nicht empirisch.
- noFloatMoney: greppe den Diff nach Fliesskomma-Arithmetik auf Geldwerten. Ein einziges \`*\` oder \`/\` auf einem Float-Geldwert ist S1 und BLOCKER (G26).
- gateAxisUntouched + costCentsUnchanged + stripePayloadUnchanged: git diff. Jede Aenderung an bookCents, trackUsage, addUsageCostCents, applyCreditCents, budgetExceeded, am cost_cents-Wert oder am Stripe-Payload ist ein BLOCKER.
- columnAdditiveNullable: pruefe die Schema-Zeile. ADD COLUMN IF NOT EXISTS? Nullable? BIGINT (nicht INTEGER - Ueberlauf, nicht NUMERIC/Float - G26)? Und: bricht eine Bestandszeile mit NULL irgendwo den Lesepfad?
- bothBackendsCovered: lies json.js UND pg.js. Ein Feld, das nur im json-Backend geschrieben wird, ist in Prod wirkungslos - BLOCKER.
- noBackfill: git diff nach Backfill-Code, UPDATE-Statements, Migrations-Skripten. Ein Backfill wuerde Betraege erfinden, die nie erhoben wurden - BLOCKER.
- existingAssertionsNotWeakened: git diff auf test/ genau lesen.
BEVOR du behauptest, ein Symbol existiere nicht: greppe am AUSGECHECKTEN BRANCH (Repo-Lehre KV-M0).
${SCHEMA_RULE}
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
        `CLEAN-CODE-AUDITOR. Pruefe den Diff der Phase ${PHASE} (Branch "${target}", Basis "${BASE}").
1. ln -s "${NODE_MODULES}" node_modules ; git checkout -b cc-${String(PHASE).toLowerCase()}${suffix} ${target}
2. Lies "${REPO}/.claude/refs/clean-code.md" VOLLSTAENDIG.
3. git diff ${BASE} ${target} ; neue Dateien vollstaendig lesen.
4. PFLICHT VOR JEDEM "EXISTIERT NICHT"-BEFUND: git grep am ausgecheckten Branch (Repo-Lehre KV-M0). grepCheckDone erst true, wenn wirklich getan.
5. Kategorie fuer Kategorie. Pro FLAG: "ID - Datei - Verstoss - Fix" + Schweregrad. S3/S4 gebuendelt.
Achte besonders auf: (a) **G26/S1 - Geld als Fliesskomma ist der schwerste denkbare Verstoss in dieser Phase**; pruefe jede Rechnung auf Ganzzahligkeit; (b) G25 - der Faktor Cent->Mikro-Cent MUSS eine benannte Konstante sein, keine nackte 10000; wenn im Repo schon eine existiert, ist eine zweite S2; (c) G5/S2 - EINE Stelle rechnet den Mikro-Cent-Betrag, nicht zwei; (d) C2 - preisquelle-Texte und Kommentare, die die Rundung beschreiben, muessen mitgezogen sein; (e) die Tests: Grenzfaelle als EIGENE Faelle (T5 - exakt 0, Rundung auf 0 mit Mikro-Cent>0, grosse Summe), ein Konzept pro Test (P14), unterscheidbare Fixture-Werte; (f) Kommentare deutsch OHNE Umlaute; (g) toter Code, ungenutzte Imports.
${SCHEMA_RULE}
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

// ---------- Phase 4: Self-Fix ----------
const FIX_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    headCommit: { type: "string" },
    addressed: { type: "array", items: { type: "string" }, description: "Je Eintrag hoechstens 250 Zeichen" },
    rejectedAsFalsePositive: {
      type: "array",
      items: { type: "string" },
      description: "Nicht reproduzierbare Blocker - mit Kommando und Ergebnis. Je Eintrag hoechstens 250 Zeichen.",
    },
    testsPass: { type: "boolean" },
    testPassCount: { type: "number" },
    committed: { type: "boolean" },
    summary: { type: "string", description: "Hoechstens 400 Zeichen" },
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
3. REPRODUZIERE JEDEN BLOCKER ZUERST (Repo-Lehre KV-M0). Nicht Reproduzierbares nach rejectedAsFalsePositive mit Kommando und Ergebnis - NICHT "fixen". Ein unter Volllast roter, isoliert gruener Test ist ein Flake, kein Blocker.
4. Behebe die reproduzierbaren Blocker, fuer jeden korrektheitsrelevanten Fix einen Regressionstest:
${JSON.stringify(blockers, null, 1)}
${KV_P6_SCOPE}
${CLEAN_CODE_REQ}
${SCHEMA_RULE}
${ABS_RULES}
5. node --check + npm test gruen. Dateien EINZELN adden, kein git stash.
6. **COMMITTE IMMER**, auch wenn ALLE Blocker Fehlalarme waren (dann eine Klarstellung committen) mit "fix(kv-p6): Review-Blocker geprueft (Runde ${round})". Ohne Commit bleibt die Phase auf BLOCKED, obwohl nichts kaputt ist. headCommit = git rev-parse HEAD.`,
    {
      label: `${PHASE}-fix-r${round}`,
      phase: "Self-Fix",
      schema: FIX_SCHEMA,
      isolation: "worktree",
      ...FIX_AGENT,
    },
  );
  fixSummaries.push(`r${round}: ${fix && fix.summary ? fix.summary.slice(0, 300) : "(kein Ergebnis)"}`);
  if (fix && Array.isArray(fix.rejectedAsFalsePositive) && fix.rejectedAsFalsePositive.length) {
    fixSummaries.push(`r${round} FEHLALARME: ${fix.rejectedAsFalsePositive.join(" | ").slice(0, 500)}`);
  }
  if (!fix || !fix.committed || !fix.headCommit) {
    fixSummaries.push(`r${round}: ABBRUCH - kein Commit vom Fix-Agenten.`);
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
EHRLICHKEITSREGEL: kein Schutz behaupten, der nicht belegt ist. **AUSDRUECKLICH UND DEUTLICH hinein: die Altzeilen wurden NICHT nachgebucht.** Die 101 ai_token-Zeilen mit cost_cents=0 bleiben 0, und die neue Spalte ist bei ihnen NULL. Wer sie in einem halben Jahr summiert, misst nichts - das muss im Bericht stehen, nicht in einer Fussnote.
Inhalt (Markdown): Phase ${PHASE} ${PHASE_TITLE}; Gate=${approved ? "PASS" : "BLOCKED"}; finalBranch=${reviewTarget}; der Befund kurz (101 von 101 Zeilen auf 0 gerundet, Gate-Achse NICHT betroffen); was gebaut wurde; die Schema-Zeile im Wortlaut; das Urteil zur automatischen Migration (N5) mit Belegstellen - und was das fuer den Deploy bedeutet; der Beweis der EXAKTEN Gleichheit inkl. der Frage, ob beide Werte aus derselben Rechenquelle stammen; die Mikro-Cent-Konstante; beide Backends; die Grenzfaelle; Mutationsprobe; angepasste Bestandstests; Safety-Urteil; Clean-Code-Audit; Fix-Runden inkl. Fehlalarme; ein Abschnitt "KEIN Backfill - was das heisst"; ein Abschnitt "Was diese Phase NICHT tut" (Gate-Achse, cost_cents, Stripe-Payload, Landkarte unveraendert); ein Abschnitt "Was der Lead nach dem Deploy pruefen muss": existiert die Spalte in Prod wirklich (SELECT auf information_schema), und tragen NEUE Zeilen einen Wert > 0? Quelle:
=== PLAN ===
${(plan || "").slice(0, 10000)}
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
  schemaLine: (impl && impl.schemaLine) || "",
  autoMigrationVerdict: (impl && impl.autoMigrationVerdict) || "",
  exactEqualityProof: (impl && impl.exactEqualityProof) || "",
  microCentConstant: (impl && impl.microCentConstant) || "",
  bothBackends: (impl && impl.bothBackends) || "",
  costCentsUnchanged: impl ? impl.costCentsUnchanged === true : false,
  stripePayloadUnchanged: impl ? impl.stripePayloadUnchanged === true : false,
  gateAxisUntouched: impl ? impl.gateAxisUntouched === true : false,
  noBackfill: impl ? impl.noBackfill === true : false,
  noMapValueChanged: impl ? impl.noMapValueChanged === true : false,
  mutationProbeResult: (impl && impl.mutationProbeResult) || "",
  existingTestsAdjusted: (impl && impl.existingTestsAdjusted) || [],
  filesTouched: ((impl && impl.filesEdited) || []).slice(0, 40),
  fixRounds: round,
  fixSummaries,
  remainingBlockers: approved ? [] : blockerList(safety, cc),
  reportPath,
  summary: impl && impl.summary ? impl.summary.slice(0, 600) : "",
};
