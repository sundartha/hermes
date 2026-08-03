// PER-RUN-Skript KV-M4 (Phase HART GEPINNT).
// Schema traegt NUR Skalare mit Laengenlimit (Lehre: 16-KB-Nutzlast toetet den Lauf).

export const meta = {
  name: "phase-impl-lean",
  description:
    "KV-M4: monatliche Gegenprobe - Provider-Rechnung gegen abgerufene gegen gebuchte Kosten, nur Beobachtung.",
  phases: [
    { title: "Plan", detail: "Code-gegroundeter Umsetzungsplan" },
    { title: "Implementieren", detail: "Umsetzung im Worktree, npm test gruen" },
    { title: "Review", detail: "Safety/Verhalten + Clean-Code-Auditor (parallel)" },
    { title: "Self-Fix", detail: "Blocker fixen + Re-Review, bis PASS" },
    { title: "Report", detail: "Prozessbericht in tasks/kv-m4-report.md" },
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
const PHASE = "KV-M4";
const PHASE_TITLE = "Monatliche Gegenprobe (Beobachtung)";
const BRANCH = "phase/kv-m4-monatliche-gegenprobe";
const BASE = "master";
const PLAN_DOC = "tasks/PLAN-KOSTEN-VOLLSTAENDIGKEIT.md";
const MAX_FIX_ROUNDS = 2;
const REPORT_PATH = "tasks/kv-m4-report.md";

const MODEL_SONNET = "sonnet";

// Modellpolitik (Kickoff KV-Kette): KV-M4 ist reines Logging ohne Sperrwirkung
// -> komplett Sonnet.
const PLAN_AGENT = { model: MODEL_SONNET, effort: "medium" };
const IMPL_AGENT = { model: MODEL_SONNET };
const SAFETY_AGENT = { model: MODEL_SONNET, effort: "medium" };
const CLEANCODE_AGENT = { model: MODEL_SONNET, effort: "medium" };
const FIX_AGENT = { model: MODEL_SONNET, effort: "medium" };
const REPORT_AGENT = { model: MODEL_SONNET, effort: "low" };

const SCHEMA_RULE = `SCHEMA-REGEL (bindend, sonst stirbt der Lauf): JEDES Textfeld deiner StructuredOutput-Antwort bleibt KURZ - hoechstens etwa 400 Zeichen, KEINE Markdown-Tabellen, KEINE Code-Bloecke, KEINE langen eingebetteten Zeilenumbrueche. Alles Umfangreiche schreibst du in eine DATEI und nennst im Feld nur den Pfad plus einen Satz. Ein Vorlauf dieser Kette ist an einer 16-KB-Nutzlast gestorben, nachdem die Arbeit bereits committet war.`;

const CLEAN_CODE_REQ = `CLEAN-CODE (PFLICHT): Lies "${REPO}/.claude/refs/clean-code.md". Insbesondere: Geld NIE als Fliesskomma (G26/S1); keine Duplizierung (G5/S2 - die drei Summen ziehen ihre Daten aus je EINER Quelle, keine nachgebauten Filter); keine Magic Numbers ausser 0/1/-1 (G25); konfigurierbare Werte nach src/config.js (G35); P4/DIP - der HTTP-Aufruf gehoert hinter die bestehende Provider-Abstraktion, nicht als roher fetch in die Fachlogik; N7 - Nebeneffekte im Namen; eine Aufgabe pro Funktion (G30); ESM, kein Build-Step, kein TypeScript. Tests: ein Konzept pro Test (P14), Grenzfaelle (T5 - Provider antwortet nicht, leerer Monat, erster Lauf), Build-Operate-Check (P13), KEIN echter Netzaufruf im Test (P12/R - der Provider wird gestellt).
PFLICHT VOR JEDEM "EXISTIERT NICHT"-BEFUND: greppe am AUSGECHECKTEN BRANCH, nicht nur im Diff (Repo-Lehre KV-M0).
UMLAUT-REGEL: Kommentare und Identifier OHNE Umlaute (ue/oe/ae).`;

const ABS_RULES = `ABSOLUTE REGELN (unantastbar, siehe CLAUDE.md):
- Diese Phase hat KEINE Sperrwirkung. Sie liest und loggt. Sie darf KEIN Gate speisen, KEINE Schwelle setzen, KEINEN Alarm ausloesen und KEINEN Call/keine SMS beeinflussen.
- Alle Safety-Gates unberuehrt. Die Gate-Achse wird NUR GELESEN, nie geschrieben.
- SECRETS: der Provider-Aufruf braucht einen API-Key. Er darf NIEMALS geloggt werden - nicht in der Gegenprobe-Zeile, nicht in einer Fehlermeldung, nicht in einem Test-Fixture.
- AUTH FAIL-CLOSED: keine neue Route, kein neuer Endpunkt, keine HTTP-Ausgabe.
- Disclosure-Satz unberuehrt.
- SCOPE: NUR diese Phase. Keine ungefragten Extras. Keine neuen npm-Dependencies.`;

const KV_M4_SCOPE = `SCOPE DIESER PHASE (bindend):

ZWECK: Alle anderen Phasen dieses Plans schliessen BEKANNTE Luecken. Diese eine schuetzt gegen die naechste UNBEKANNTE - sie ist damit die einzige, die die Wurzel selbst adressiert. Ohne sie faellt derselbe Befund in einem Jahr mit einer anderen Kosten-Art erneut an, und wieder merkt es niemand.

TEIL 1 - Die drei Zahlen, einmal je Kalendermonat:
1. **Provider-Monatssumme** aus dem Rechnungs-Endpunkt (Monats-Rollup; KEINE Aufschluesselung je Nummer noetig - hier zaehlt die Summe).
2. **Summe der abgerufenen Ist-Kosten** unserer Calls des Monats (\`actual_cost_micro_cents\`).
3. **Summe der auf die Gate-Achse gebuchten Carrier-Betraege** des Monats.
Die Phase stellt sie nebeneinander und **LOGGT NUR**. Zwei Differenzen fallen dabei ab:
- Faellt (1) merklich ueber (2): es gibt eine Kosten-Art, die wir gar nicht ABRUFEN.
- Faellt (2) merklich ueber (3): es gibt eine Kosten-Art, die wir abrufen, aber nicht BUCHEN.
Genau diese zwei Fragen beantwortet heute nichts.

TEIL 2 - WAEHRUNG (die Falle dieser Phase, ausdruecklich):
Die Provider-Betraege stehen in Provider-Waehrung (heute USD), die Gate-Achse in EUR-Cent. **Drei Zahlen in zwei Waehrungen nebeneinanderzustellen, ohne das zu benennen, macht die ganze Gegenprobe wertlos.** Kein "ungefaehr passt schon". Entweder du rechnest an GENAU EINER benannten Stelle um (und sagst welche und mit welchem Kurs), oder du weist jede Zahl mit ihrer Waehrung aus und vergleichst nur, was vergleichbar ist. Beides ist vertretbar; beides muss im Log sichtbar sein. Prueft der Bestand das schon irgendwo? Grep - es gibt im Repo bereits eine Regel, dass Provider-Betraege in Provider-Waehrung UNVERAENDERT bleiben und die Umrechnung an genau einer Kante lebt. Halte dich daran.

TEIL 3 - Einmal je Monat, ohne zweiten Timer:
- Der Aufruf reitet auf dem BESTEHENDEN periodischen Sweep mit. **KEIN zweiter Timer, KEINE neue Ressource, KEIN Render-Cron** (den es auf dem Free Tier nicht gibt).
- Der Sweep laeuft stuendlich; die Gegenprobe darf hoechstens EINMAL je Kalendermonat einen Provider-Aufruf ausloesen. Der Riegel dafuer muss einen Neustart UEBERLEBEN (persistiert), sonst feuert er nach jedem Deploy erneut. Muster: der Idempotenz-Anker der Monatsmiete-Buchung - schau ihn dir an und folge ihm.
- Lastbudget: EIN zusaetzlicher GET je Monat. Mehr ist ein Scope-Bruch.

TEIL 4 - Keine Sperrwirkung, keine Schwelle (Owner-Entscheidung 6, ausdruecklich OFFEN):
**In dieser Phase entsteht KEINE Schwelle, KEIN Alarm, KEINE SMS, KEIN Boot-Refusal.** Erst wenn drei Monatswerte vorliegen, ist eine Schwelle ueberhaupt begruendbar. Wer hier eine Zahl als Grenze einbaut, raet - und eine geratene Grenze ist genau das Muster, das dieser Plan an anderer Stelle behebt. Ein Diff, der eine Schwelle oder eine Benachrichtigung einfuehrt, ist ein BLOCKER.

TEIL 5 - Plattform-Fixkosten bleiben DRAUSSEN (Owner-Entscheidung 7):
Stripe-Gebuehren, WorkOS, Render gehoeren NICHT in diese Gegenprobe - auch nicht als eigene Zeile. Sie beantworten keine der zwei Fragen, die KV-M4 stellt, und verwaessern beide. Die Gegenprobe vergleicht Provider-VERBRAUCHSkosten gegen gebuchte VERBRAUCHSkosten.

DIE PFLICHT-ABNAHMEN:
(1) EINE Log-Zeile je Monat mit drei Betraegen und zwei Differenzen, jede mit ihrer Waehrung. Ein Test mit GESTELLTEN Zahlen pinnt die Rechnung exakt (keine Naeherung).
(2) Idempotenz: zweimaliger Sweep im selben Kalendermonat loest GENAU EINEN Provider-Aufruf aus. Und: der Riegel ueberlebt einen Neustart - belege das, nicht nur den In-Memory-Fall.
(3) Fehlerfall: der Provider antwortet nicht / antwortet mit Fehler / liefert keine Rechnung fuer den Monat. Die Gegenprobe darf den Sweep NICHT umbringen - der Ist-Abgleich muss danach normal weiterlaufen. Das ist der wichtigste Grenzfall: eine Beobachtung, die den Kostenschutz mitreisst, ist schlimmer als keine Beobachtung.
(4) KEIN echter Netzaufruf in den Tests. Der Provider wird gestellt.
(5) Mutationsprobe: eine der drei Summen falsch verdrahten -> der Rechnungstest wird rot.

TEST-IDs: "KV-M4-N". NICHT mit einem i18n-Katalog-Praefix beginnen (DID|E2E|FMT|GAP|LANG|LAW|MCP|ORIG|OUT|PAY|PROMPT|UI|VOICE|WEB|WORLD gefolgt von einer Ziffer).

LANDKARTE: Diese Phase kippt KEINE Zeile und aendert KEINEN ledger/gate-Wert. Sie bucht nichts.

NICHT-ZIELE (ausdruecklich):
- KEINE Schwelle, KEIN Alarm, KEINE Benachrichtigung, KEINE Sperrwirkung.
- KEIN zweiter Timer, KEIN Cron, KEINE neue Provider-Ressource.
- KEINE Plattform-Fixkosten.
- KEINE Aenderung an der Gate-Achse, am Ist-Abgleich, an der Sofortbuchung, an der Landkarte.
- KEINE neue DB-Spalte, ES SEI DENN der Idempotenz-Riegel braucht sie - dann additiv-nullable per ADD COLUMN IF NOT EXISTS in der Schema-Datei (laeuft beim Boot automatisch, in KV-P6 verifiziert) und OHNE Backfill.
- KEINE neue Env-Variable, es sei denn zwingend - dann mit voller Verdrahtung (config.js + .env.example + render.yaml + BASE_ENV in test/helpers.js).
- NIEMALS "git stash". NIEMALS "git add -A". Dateien EINZELN adden.`;

// ---------- Phase 1: Plan ----------
phase("Plan");
const plan = await agent(
  `Du erstellst den DETAILLIERTEN, code-gegroundeten, CLEAN-CODE-KONFORMEN Umsetzungsplan fuer Phase ${PHASE} (${PHASE_TITLE}) im Repo "${REPO}". NUR PLANEN, NICHTS aendern.
1. Lies "${REPO}/${PLAN_DOC}": den Abschnitt "KV-M4", die Owner-Entscheidungen 6 und 7, das Pre-Mortem TOD 5 (Mess-Last) und den Abschnitt "KV-P6" (der Ledger ist seit dieser Phase geldrichtig - das ist die Voraussetzung dafuer, dass die Gegenprobe ueberhaupt etwas misst).
2. Lies "${REPO}/.claude/refs/clean-code.md" und "${REPO}/CLAUDE.md".
3. Lies den ECHTEN Code auf Basis "${BASE}" - grep nach Symbolen, uebernimm KEINE Zeilennummern:
   - src/boot.js: das bestehende periodische Sweep-Intervall - wie haengt sich etwas dort ein? Was laeuft dort heute schon mit (Muster GAP-06/DID-Miete)?
   - src/billing/metering.js: \`recordNumberMonthMeter\` und sein Faelligkeits-/Idempotenz-Anker (\`numbersDueForMonthMeter\` o.ae.) - DAS ist das Muster fuer "einmal je Kalendermonat, ueberlebt Neustart"
   - src/billing/cost-truing.js: der Sweep, in dem die Gegenprobe mitreiten koennte, und wie er mit Provider-Fehlern umgeht
   - der Telnyx-Adapter: gibt es schon einen Zugriff auf den Rechnungs-Endpunkt? Grep nach "invoice". Wenn nicht, wo gehoert er hin (Provider-Abstraktion, NICHT roher fetch in der Fachlogik)?
   - src/store/state-ops.js: wie kommt man an die Summe der \`actualCostMicroCents\` eines Monats und an die auf die Gate-Achse gebuchten Carrier-Betraege eines Monats? Gibt es dafuer schon Abfragen, oder muessen sie entstehen? Achtung: die Gate-Achse fuehrt AUCH KI-Token und Recherche-Gebuehren - die Gegenprobe will den CARRIER-Anteil. Klaere, ob der ueberhaupt getrennt lesbar ist. **Wenn nicht, ist DAS der wichtigste Befund des Plans** und gehoert benannt, bevor eine Zeile Code entsteht.
   - die Waehrungsregel im Repo: grep nach der Stelle, an der Provider-Betraege in unsere Waehrung umgerechnet werden. Es gibt eine Vorgabe, dass das an genau EINER Kante passiert.
4. ENTSCHEIDE UND BEGRUENDE:
   (a) Woher kommt jede der drei Zahlen genau (Funktion/Abfrage), und in welcher Waehrung/Einheit?
   (b) Ist der Carrier-Anteil der Gate-Achse ueberhaupt getrennt lesbar? Wenn nein: was ist die ehrlichste Ersatzgroesse, und was verliert die Gegenprobe dadurch?
   (c) Wo sitzt der Monats-Riegel, und wie ueberlebt er einen Neustart? Braucht es dafuer eine Spalte, oder reicht ein vorhandenes Feld?
   (d) Wie ist sichergestellt, dass ein Provider-Fehler den Sweep NICHT umbringt?
   (e) Wie sieht die Log-Zeile woertlich aus, inklusive Waehrungskennzeichnung?
5. Nenne ausdruecklich, welche Bestandstests kippen und wie du damit umgehst.
6. PRE-MORTEM: ein Jahr spaeter hat KV-M4 Schaden angerichtet. Was ist passiert? Nenne mindestens: die Gegenprobe wirft, und der Ist-Abgleich faellt seitdem still aus; sie feuert nach jedem Deploy erneut und kostet Provider-Anfragen; die drei Zahlen stehen in zwei Waehrungen nebeneinander und jemand zieht eine falsche Schlussfolgerung; die Zeile wird nie gelesen, weil niemand weiss, dass es sie gibt. Fuer jedes: die Gegenmassnahme oder die ehrliche Feststellung.
${KV_M4_SCOPE}
${CLEAN_CODE_REQ}
${ABS_RULES}
LIEFERE: (1) die exakten Edits je Datei; (2) die Log-Zeile im Wortlaut mit Beispielwerten und Waehrungen; (3) die Tests KV-M4-* mit konkreten Assertions (inkl. Idempotenz ueber Neustart und Provider-Fehler); (4) die Mutationsprobe; (5) die Antwort auf 4b - was die Gegenprobe wirklich vergleichen kann; (6) das Pre-Mortem. Kleiner Blast-Radius. Deine Rueckgabe IST der Plan.`,
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
    logLine: { type: "string", description: "Die Gegenprobe-Zeile im Wortlaut mit Beispielwerten UND Waehrungen. Hoechstens 350 Zeichen." },
    threeSources: {
      type: "string",
      description: "Woher kommt jede der drei Zahlen (Funktion/Abfrage) und in welcher Einheit? Hoechstens 400 Zeichen.",
    },
    currencyHandling: {
      type: "string",
      description:
        "Wie werden die Waehrungen behandelt - eine benannte Umrechnungsstelle oder getrennte Ausweisung? Hoechstens 350 Zeichen.",
    },
    carrierShareReadable: {
      type: "string",
      description:
        "Ist der CARRIER-Anteil der Gate-Achse getrennt lesbar? Wenn nein: welche Ersatzgroesse, und was verliert die Gegenprobe? Hoechstens 400 Zeichen.",
    },
    monthlyLatchProof: {
      type: "string",
      description:
        "Wo sitzt der Monats-Riegel, und womit ist belegt, dass er einen NEUSTART ueberlebt? Hoechstens 350 Zeichen.",
    },
    providerFailureProof: {
      type: "string",
      description:
        "Womit ist belegt, dass ein Provider-Fehler den Sweep NICHT umbringt (Ist-Abgleich laeuft danach weiter)? Hoechstens 350 Zeichen.",
    },
    noThreshold: { type: "boolean", description: "MUSS true sein: keine Schwelle, kein Alarm, keine Benachrichtigung" },
    noSecondTimer: { type: "boolean", description: "MUSS true sein: kein zweiter Timer, kein Cron" },
    noPlatformFixedCosts: { type: "boolean", description: "MUSS true sein: keine Plattform-Fixkosten in der Gegenprobe" },
    noRealNetworkInTests: { type: "boolean" },
    gateAxisReadOnly: { type: "boolean", description: "Die Gate-Achse wird NUR gelesen, nie geschrieben" },
    noMapValueChanged: { type: "boolean" },
    newColumnOrEnv: {
      type: "string",
      description: "Neue Spalte oder Env-Variable noetig? Wenn ja: welche und wo ueberall verdrahtet. Hoechstens 300 Zeichen.",
    },
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
    "logLine",
    "threeSources",
    "currencyHandling",
    "carrierShareReadable",
    "monthlyLatchProof",
    "providerFailureProof",
    "noThreshold",
    "noSecondTimer",
    "noPlatformFixedCosts",
    "noRealNetworkInTests",
    "gateAxisReadOnly",
    "noMapValueChanged",
    "newColumnOrEnv",
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
3. Umsetzung: die drei Summen, der Monats-Riegel, die Log-Zeile, der Fehlerfall, Tests KV-M4-*.
4. node --check auf jede geaenderte src-Datei, dann npm test gruen. Dateien EINZELN adden, committen: "feat(kv-m4): monatliche Gegenprobe - Provider gegen abgerufen gegen gebucht".
${KV_M4_SCOPE}
${CLEAN_CODE_REQ}
5. npm test MUSS gruen sein. Kippende Bestandstests einzeln begruenden.
   HINWEIS ZU FLAKES: test/auth-p9a-cache-headers.test.js und einige Spawn-Tests werden unter Volllast rot, sind isoliert aber gruen (bekanntes Repo-Muster). Wird ein Test rot, fahr ihn ISOLIERT nach und melde beides. Nicht "reparieren", was isoliert gruen ist.
6. npm run test:gates zusaetzlich (DARF rot sein). auth-p9a-cache-headers haengt bekanntermassen unter --test-name-pattern - wenn der Lauf haengt, brich ab und melde es.
7. MUTATIONSPROBE: eine der drei Summen falsch verdrahten (z.B. den Monatsfilter entfernen) -> der Rechnungstest MUSS rot werden. Zuruecknehmen, npm test erneut gruen.
8. node_modules-Symlink NICHT committen. Nach dem Lauf: ps aux | grep "[n]ode src/server.js" - verwaiste Testserver beenden.
${SCHEMA_RULE}
${ABS_RULES}
EHRLICH fuellen. carrierShareReadable ist der Punkt, an dem diese Phase ehrlich oder wertlos wird: wenn der Carrier-Anteil nicht getrennt lesbar ist, sag das und beschreibe, was die Gegenprobe dann wirklich vergleicht - erfinde keine Genauigkeit.`,
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
    sweepSurvivesProviderFailure: {
      type: "boolean",
      description:
        "SELBST verifiziert: wirft der Provider-Aufruf, laeuft der Ist-Abgleich danach normal weiter - die Beobachtung reisst den Kostenschutz NICHT mit",
    },
    monthlyLatchSurvivesRestart: {
      type: "boolean",
      description: "SELBST geprueft: der Monats-Riegel ist persistiert, nicht nur im Speicher",
    },
    noThreshold: { type: "boolean", description: "Keine Schwelle, kein Alarm, keine Benachrichtigung, keine Sperrwirkung" },
    noSecondTimer: { type: "boolean" },
    noPlatformFixedCosts: { type: "boolean" },
    currencyExplicit: {
      type: "boolean",
      description: "Jede Zahl im Log traegt ihre Waehrung, oder es wird an genau EINER benannten Stelle umgerechnet",
    },
    gateAxisReadOnly: { type: "boolean" },
    noRealNetworkInTests: { type: "boolean" },
    noSecretsLeaked: {
      type: "boolean",
      description: "SELBST geprueft: kein API-Key in Log, Fehlermeldung oder Fixture",
    },
    loadBudgetRespected: { type: "boolean", description: "Hoechstens EIN zusaetzlicher Provider-Aufruf je Monat" },
    noMapValueChanged: { type: "boolean" },
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
    "sweepSurvivesProviderFailure",
    "monthlyLatchSurvivesRestart",
    "noThreshold",
    "noSecondTimer",
    "noPlatformFixedCosts",
    "currencyExplicit",
    "gateAxisReadOnly",
    "noRealNetworkInTests",
    "noSecretsLeaked",
    "loadBudgetRespected",
    "noMapValueChanged",
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
        `STRENGER, adversarialer Safety-/Verhaltens-Reviewer in frischem Worktree. Pruefe Phase ${PHASE} auf Branch "${target}". Diese Phase haengt einen Provider-Aufruf in den Sweep, der den Ist-Abgleich traegt - ein Fehler hier legt den Kostenschutz still.
1. ln -s "${NODE_MODULES}" node_modules
2. git checkout -b review-${String(PHASE).toLowerCase()}${suffix} ${target}
3. npm test selbst -> testsPassIndependently + Zahlen. HINWEIS: auth-p9a-cache-headers und einige Spawn-Tests sind unter Volllast flaky, isoliert gruen - wird etwas rot, isoliert nachfahren und beides melden.
4. git diff ${BASE} ${target} gegen die absoluten Regeln pruefen.
${KV_M4_SCOPE}
PRUEFE BESONDERS, jeweils SELBST am Code nachgerechnet:
- sweepSurvivesProviderFailure: DAS IST DER WICHTIGSTE PUNKT. Lies den Aufrufpfad. Was passiert, wenn der Provider-Aufruf wirft, einen Fehlercode liefert oder in einen Timeout laeuft - laeuft der Ist-Abgleich danach normal weiter? Prueft ein Test das? Eine Beobachtung, die den Kostenschutz mitreisst, ist schlimmer als keine Beobachtung - das waere ein BLOCKER.
- monthlyLatchSurvivesRestart: der Sweep laeuft stuendlich. Ist der Monats-Riegel persistiert oder nur im Speicher? Nur im Speicher heisst: nach jedem Deploy feuert er erneut - BLOCKER (Lastbudget) und ausserdem falsche Daten.
- noThreshold: greppe den Diff nach Schwellen, Vergleichen mit Warngrenzen, SMS-/Alarm-Aufrufen, Boot-Guard-Eintraegen. Diese Phase darf NUR loggen. Eine geratene Schwelle ist ein BLOCKER (Owner-Entscheidung 6 ist ausdruecklich OFFEN).
- currencyExplicit: stehen drei Zahlen in zwei Waehrungen nebeneinander, ohne dass man es sieht? Dann ist die Gegenprobe irrefuehrend - BLOCKER. Pruefe die Log-Zeile SELBST.
- noSecretsLeaked: der Provider-Aufruf braucht einen API-Key. Greppe Log-Ausgaben, Fehlerpfade und Fixtures. Ein geleakter Key ist S1.
- gateAxisReadOnly + noMapValueChanged: git diff. Jede Schreiboperation auf der Gate-Achse ist scope-fremd und ein BLOCKER.
- loadBudgetRespected: zaehle die Provider-Aufrufe je Sweep-Durchlauf im Code. Mehr als einer je Monat ist ein Scope-Bruch.
- noRealNetworkInTests: greppe die Tests nach echten Netz-Zielen.
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
Achte besonders auf: (a) P4/DIP - der HTTP-Aufruf gehoert hinter die bestehende Provider-Abstraktion; ein roher fetch in der Fachlogik ist ein Verstoss und macht den Test netzabhaengig; (b) G26/S1 - Geld als Ganzzahl, keine Fliesskomma-Arithmetik, und die Waehrungs-Einheit im Namen (ein \`sum\` ohne Einheit ist hier ein Korrektheitsrisiko); (c) G5/S2 - die drei Summen ziehen aus je EINER Quelle, keine nachgebauten Monatsfilter; (d) G25 - benannte Konstanten; (e) P8 - der Fehlerpfad muss diagnostizierbar loggen, nicht still schlucken; (f) die Tests: ein Konzept pro Test (P14), Grenzfaelle als EIGENE Faelle (T5 - Provider-Fehler, leerer Monat, erster Lauf), KEIN echtes Netz (P12/R), unterscheidbare Fixture-Werte; (g) Kommentare deutsch OHNE Umlaute; (h) toter Code, ungenutzte Imports.
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
3. REPRODUZIERE JEDEN BLOCKER ZUERST (Repo-Lehre KV-M0). Nicht Reproduzierbares nach rejectedAsFalsePositive mit Kommando und Ergebnis - NICHT "fixen". Ein unter Volllast roter, isoliert gruener Test ist ein Flake.
4. Behebe die reproduzierbaren Blocker, fuer jeden korrektheitsrelevanten Fix einen Regressionstest:
${JSON.stringify(blockers, null, 1)}
${KV_M4_SCOPE}
${CLEAN_CODE_REQ}
${SCHEMA_RULE}
${ABS_RULES}
5. node --check + npm test gruen. Dateien EINZELN adden, kein git stash.
6. **COMMITTE IMMER**, auch wenn ALLE Blocker Fehlalarme waren (dann eine Klarstellung committen) mit "fix(kv-m4): Review-Blocker geprueft (Runde ${round})". Ohne Commit bleibt die Phase auf BLOCKED, obwohl nichts kaputt ist. headCommit = git rev-parse HEAD.`,
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
EHRLICHKEITSREGEL: kein Schutz behaupten, der nicht belegt ist. Diese Phase hat KEINE Sperrwirkung - sie sieht nur hin. **Wenn der Carrier-Anteil der Gate-Achse nicht getrennt lesbar war, MUSS das prominent im Bericht stehen**, samt der Aussage, was die Gegenprobe dann wirklich vergleicht. Erfundene Genauigkeit ist hier schlimmer als eine benannte Unschaerfe.
Inhalt (Markdown): Phase ${PHASE} ${PHASE_TITLE}; Gate=${approved ? "PASS" : "BLOCKED"}; finalBranch=${reviewTarget}; der Zweck (die einzige Phase gegen UNBEKANNTE Luecken); die drei Quellen mit Einheit; die Waehrungsbehandlung; die Log-Zeile im Wortlaut; der Monats-Riegel und sein Neustart-Beleg; der Provider-Fehlerfall und warum er den Sweep nicht umbringt; die Mutationsprobe; angepasste Bestandstests; Safety-Urteil; Clean-Code-Audit; Fix-Runden inkl. Fehlalarme; ein Abschnitt "Was diese Phase bewusst NICHT tut" (keine Schwelle - Owner-Entscheidung 6 ist offen und wird erst nach dem dritten Monatswert entscheidbar; keine Plattform-Fixkosten - Entscheidung 7; kein zweiter Timer); ein Abschnitt "Was der Lead tun muss": die erste Gegenprobe-Zeile im Render-Log ablesen und in ${PLAN_DOC} eintragen, und nach DREI Monatswerten die Schwellen-Frage (Owner-Entscheidung 6) erneut vorlegen. Quelle:
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
  logLine: (impl && impl.logLine) || "",
  threeSources: (impl && impl.threeSources) || "",
  currencyHandling: (impl && impl.currencyHandling) || "",
  carrierShareReadable: (impl && impl.carrierShareReadable) || "",
  monthlyLatchProof: (impl && impl.monthlyLatchProof) || "",
  providerFailureProof: (impl && impl.providerFailureProof) || "",
  newColumnOrEnv: (impl && impl.newColumnOrEnv) || "",
  noThreshold: impl ? impl.noThreshold === true : false,
  noSecondTimer: impl ? impl.noSecondTimer === true : false,
  noPlatformFixedCosts: impl ? impl.noPlatformFixedCosts === true : false,
  gateAxisReadOnly: impl ? impl.gateAxisReadOnly === true : false,
  mutationProbeResult: (impl && impl.mutationProbeResult) || "",
  existingTestsAdjusted: (impl && impl.existingTestsAdjusted) || [],
  filesTouched: ((impl && impl.filesEdited) || []).slice(0, 40),
  fixRounds: round,
  fixSummaries,
  remainingBlockers: approved ? [] : blockerList(safety, cc),
  reportPath,
  summary: impl && impl.summary ? impl.summary.slice(0, 600) : "",
};
