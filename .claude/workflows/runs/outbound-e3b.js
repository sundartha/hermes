// SCHLANKES, SELBST-FIXENDES Phasen-Workflow (Lead bleibt duenn).
// Kopie der Vorlage .claude/workflows/runs/outbound-e3a.js, Phase HART GEPINNT auf OUTBOUND-E3B.

export const meta = {
  name: "phase-impl-lean-outbound-e3b",
  description:
    "OUTBOUND-E3B (F2b): Der systematische Ausfall meldet sich beim Betreiber - dreistufige Erkennung (K0/K1/K2), durabler Marker ueber Neustarts, Mail als primaerer Kanal. Plus Ausdehnung des Reihenfolge-Riegels auf voice.js/outbound.js. Plan -> Impl (Worktree) -> dualer Review -> Self-Fix -> Report.",
  phases: [
    { title: "Plan", detail: "Umsetzung code-gegroundet planen (Spec: PLAN-OUTBOUND-RESILIENZ.md, Etappe E3b)", model: "opus" },
    { title: "Implementieren", detail: "Umsetzung im Worktree, npm test gruen, eslint . 0 Fehler", model: "sonnet" },
    { title: "Review", detail: "Safety/Abnahme + Clean-Code-Auditor (parallel, beide Opus)", model: "opus" },
    { title: "Self-Fix", detail: "S1/S2/Safety-Blocker fixen + Re-Review, bis PASS", model: "sonnet" },
    { title: "Report", detail: "Detailbericht in tasks/outbound-e3b-report.md (Lead liest ihn nicht)", model: "sonnet" },
  ],
};

// HART GEPINNT auf das Haupt-Repo (Symlink-Falle, C-P4).
const REPO = "/Users/antonio/Mein Unternehmen/MCP/vodafone-agent";
const NODE_MODULES = `${REPO}/node_modules`;

// PER-RUN-SKRIPT OUTBOUND-E3B: Phase HART GEPINNT.
const RUN = {
  phaseId: "OUTBOUND-E3B",
  phaseTitle:
    "F2(b): systematischer Ausfall meldet sich beim Betreiber (K0/K1/K2, durabler Marker, Mail primaer) + Reihenfolge-Riegel auf voice.js/outbound.js ausgedehnt",
  branch: "phase/outbound-e3b-betreiber-alarm",
  baseBranch: "master",
  planDoc: "PLAN-OUTBOUND-RESILIENZ.md",
  befundDoc: "tasks/befund-outbound-ausfall-2026-08-27.md",
  maxFixRounds: 4,
};

const PHASE = RUN.phaseId;
const PHASE_TITLE = RUN.phaseTitle;
const BRANCH = RUN.branch;
const BASE = RUN.baseBranch;
const PLAN_DOC = RUN.planDoc;
const BEFUND_DOC = RUN.befundDoc;
const MAX_FIX_ROUNDS = Number.isInteger(RUN.maxFixRounds) ? RUN.maxFixRounds : 2;
const REPORT_PATH = "tasks/outbound-e3b-report.md";

// MODELL-POLITIK: Urteilen=Opus, Ausfuehren=Sonnet; Pins pro agent() (Memory [[workflow-model-policy]]).
const PLAN_AGENT = { model: "opus", effort: "high" };
const IMPL_AGENT = { model: "sonnet", effort: "high" };
const SAFETY_AGENT = { model: "opus", effort: "xhigh" };
const CLEANCODE_AGENT = { model: "opus", effort: "high" };
const FIX_AGENT = { model: "sonnet", effort: "medium" };
const REPORT_AGENT = { model: "sonnet", effort: "low" };

// Suite-Anker: vom Lead auf master NACH dem E3a-Merge (cab6c4e) selbst gemessen: pass 5193 / fail 0.
const TEST_CMD = `LLM_PROVIDER=anthropic npm test`;
const TEST_FLOOR = 5193;

const LINT_REGEL = `LINT-PFLICHT (P1-Lehre, tasks/lessons.md): npm run lint (eslint ., volles Repo im Worktree) MUSS "0 errors" melden. Suppression-Dateien nur fuer Diff-eigene Dateien. Einen GEPINNTEN Altlast-Wert hebst du NICHT an, um nicht blockiert zu sein - du baust die Loesung so, dass der Pin haelt (E2: Modul-Funktion extrahiert; E3a: Pin sogar gesenkt). Muss ein Pin dennoch nachgezogen werden, ist das eine begruendete deviation mit GEMESSENER Zahl, nie eine Schaetzung.`;

const CLEAN_CODE_REQ = `CLEAN-CODE (PFLICHT): Lies "${REPO}/.claude/refs/clean-code.md" und befolge ihn bei JEDER Entscheidung. Fuer diese Phase besonders: EINE Erkennungsstelle, EIN Meldeweg - die Frage "liegt ein systematischer Ausfall vor?" wird an genau einem Ort beantwortet (reine Funktion: Eingabe = Fenster-Zahlen, Ausgabe = Urteil), der Versand ist davon getrennt; KEIN zweiter Benachrichtigungsweg neben dem Bestand; Schwellen und Zeitfenster sind BENANNTE Konstanten bzw. Env-Werte, nie roh im Code. Kein toter Code; Kommentare deutsch OHNE Umlaute. Neues Verhalten braucht Tests. ${LINT_REGEL}`;

const LEAD_DECISIONS = `BINDENDE LEAD-ENTSCHEIDUNGEN - nicht neu aufrollen, nicht umdeuten:
1. "${PLAN_DOC}" ist AUTORITATIV (Entwurfsentscheidung "E-4 (F2b)" und Etappe "E3b", dazu Testkonzept 6, Pre-Mortem 7 - besonders PM-16, PM-17, PM-20, PM-21, PM-22, PM-23 - und Abschnitt 8). Der gemessene Ausfall-Befund steht in "${BEFUND_DOC}". Umzusetzen ist NUR Etappe E3b PLUS der unter 8. zugewiesene E3a-Befund. Widersprueche Spec vs Ist-Code in deviations melden, Ist-Code respektieren.
2. E1 (platform_number_use + Freigabe-Riegel), E2 (Fehlervokabular not-placed/unreachable/result-unknown) und E3a (Nutzer-Rueckweg, Mail nur bei not-placed, Reihenfolge-Riegel in api-calls.js) sind auf ${BASE} gemergt. NICHT umbauen - E3b BENUTZT sie.
3. DREISTUFIGE ERKENNUNG gemaess Plan, alle drei Stufen sind Liefergegenstand:
   - K0: der ERSTE Befund einer neuen Fehlerklasse erzeugt IMMER eine Log-Warnung + einen Audit-Eintrag. Kostenlos, kein Versand. Grund: bei geringem Verkehr (ein Anruf pro Woche) wird jede Zaehl-Schwelle nie erreicht - genau der Fall vom 27.08.
   - K1: mehrere Fehler derselben Klasse UND (keine Erfolge im Fenster ODER mehrere betroffene Tenants) -> Alarm. BEIDE Klauseln sind noetig: "verschiedene Tenants" allein haette den 27.08. verpasst (alle vier Anrufe EIN Tenant), "keine Erfolge" allein ist bei Millionen Nutzern nutzlos.
   - K2: Anteilsregel mit MINDESTNENNER fuer den Skalenfall, dimensioniert wie im Plan beschrieben. Ohne Mindestnenner ist ein Anteil bei kleinen Zahlen Rauschen.
   Ein einzelner Tenant, der eine unerreichbare Nummer waehlt, darf KEINE Stufe ausloesen. Ein Anbieter-5xx-Sturm (result-unknown) zaehlt NICHT als unser Defekt.
4. MELDEWEG vierstufig in dieser Reihenfolge: Log-Warnung -> Audit -> SMS -> Mail. MAIL IST DER PRIMAERE ECHTE KANAL. Begruendung (bindend, aus dem Pre-Mortem): der heutige Betreiber-Alarm laeuft ueber DASSELBE Telnyx-Konto und DIESELBE Nummern-Tabelle wie der ausgefallene Outbound - ein Alarm, den derselbe Defekt mitreisst, ist keiner. Der Mailweg haengt an keinem Carrier.
5. PM-17 (bindend): die Absendernummer des SMS-Alarms wird beim Boot als EIGENE Plattform-Bindung abgeleitet (E1-Mechanik), damit derselbe Erase-Weg sie nicht still mitnimmt. Faellt sie weg, ist das ein LAUTER Befund, kein stilles null.
6. PM-23 (bindend): Fenster und Entprell-Marker muessen einen NEUSTART ueberleben. Das Zaehlfenster wird aus den persistenten Anruf-Zeilen abgeleitet, NICHT aus einem Speicher-Ringpuffer; der Entprell-Marker liegt in einer durablen Zeile (Store/Audit), NICHT im Notification-Puffer. Auf plan:free startet der Prozess staendig neu - ein Marker im Speicher bedeutet: Alarm bei jedem Aufwachen. Ein Test MUSS den Neustart nachstellen.
7. PM-16 (bindend): ist KEIN Betreiber-Kanal konfiguriert (weder Mail-Ziel noch SMS-Ziel), meldet der Boot-Guard das LAUT. "Nicht konfiguriert" darf NIE wie "alles gruen" aussehen. Ein leerer Kanal ist ein eigener, gezaehlter Befundzustand - nicht Schweigen.
8. E3a-BEFUND C-A (vom Safety-Reviewer belegt, hiermit E3b zugewiesen): dieselbe Reihenfolge-Fragilitaet wie in api-calls.js lebt unveraendert in src/routes/voice.js (der Reviewer hat sie dort verletzt, die GESAMTE Suite blieb gruen) und potenziell in src/elevenlabs/outbound.js. Dehne den Reihenfolge-Riegel dorthin aus UND baue je Stelle einen Test, der die verletzte Reihenfolge ROT macht. Ein Riegel per Kommentar ist keiner.
9. E3a-BEFUNDE S3-1/S3-2 (hiermit E3b zugewiesen): ein Sende-Marker fehlt, und die Entprellung haengt an der Mail statt am VORFALL. Entprelle am Vorfall (derselbe Ausfall = eine Meldung, egal ueber wie viele Anrufe er sich zeigt) und halte fest, ob und wann tatsaechlich gesendet wurde.
10. PII (bindend): der Alarm-Text traegt KEINE Rufnummern, KEINE Kundennamen, KEINE Gespraechsinhalte, KEINEN Anbieter-Rohtext - nur Klasse, Zahlen, Zeitfenster und Tenant-Anzahl (nicht Tenant-Identitaeten). Ein Test prueft den Text per Regex gegen Rufnummern-Muster. Nichts davon in Logs.
11. NEUE ENV-VARIABLEN zentral in src/config.js, dokumentiert in .env.example, geprueft in render.yaml UND eingetragen in test/helpers.js BASE_ENV (Repo-Lehre "Test BASE_ENV-Drift"). Defaults so, dass ein unkonfiguriertes System NICHT sendet, aber laut meldet (s. 7.).
12. Schritt 0 (Pflicht, VOR dem ersten Edit): npm run test:gates auf ${BASE} ausfuehren und die Zahl der roten Faelle festhalten - nach der Umsetzung darf sie NICHT hoeher sein.`;

const ABS_RULES = `ABSOLUTE REGELN (unantastbar, siehe CLAUDE.md):
- Safety-Gates NIE anfassen (Outbound-Permit, OUTBOUND_FROZEN, Denylist/Land-Gate/Stundenlimit, pro-Tenant-Kostendecke, Max-Gespraechsdauer, Telnyx-Signaturpruefung). Offenlegungs-Mechanik und callee_is_owner NICHT beruehren. Auth fail-closed: neue/geaenderte Endpunkte brauchen die Middleware-Kette und ggf. einen route-policy-Eintrag (test/route-auth-inventory.test.js). Secrets nur via env, nie loggen. AUDIO NIEMALS durch MCP.
- KEINE echten Anrufe/SMS/Mails, KEINE Provider-SCHREIBzugriffe, KEIN Deploy. Versand im Test NUR gegen Attrappe.
- SCOPE: NUR Etappe E3b plus die zugewiesenen E3a-Befunde. Der Drift-Waechter (E4) und die Absender-Wahrheit (E5) sind EIGENE Etappen - hier NICHT vorgreifen. Insbesondere: E3b erkennt Ausfaelle AM VERKEHR; der Fall "gar kein Verkehr" gehoert E4. Kein src/bridge.js.`;

// ---------- Phase 1: Plan ----------
phase("Plan");
const plan = await agent(
  `Du erstellst den DETAILLIERTEN, code-gegroundeten Umsetzungsplan fuer Phase ${PHASE} (${PHASE_TITLE}) im Repo "${REPO}". NUR PLANEN, NICHTS aendern.
1. Lies aus "${REPO}/${PLAN_DOC}" VOLLSTAENDIG: die Entwurfsentscheidung "E-4 (F2b)", die Etappe "E3b" samt Abnahmekatalog, Abschnitt 6, Abschnitt 7 (PM-16/17/20/21/22/23 im Wortlaut) und Abschnitt 8. AUTORITATIV. Dazu "${REPO}/${BEFUND_DOC}" und "${REPO}/tasks/outbound-e3a-report.md" (Befunde C-A, S3-1, S3-2).
2. Lies "${REPO}/.claude/refs/clean-code.md".
3. Lies den ECHTEN Code auf Basis "${BASE}" (E1+E2+E3a gemergt!): src/telephony/failure-reason.js (die Klassen), src/mail-not-placed.js (der E3a-Mailweg - Vorbild und moegliche Wiederverwendung), den bestehenden Betreiber-Alarm (grep - selbst finden: SMS-Weg, resolveBootstrapAlertSender o.ae.), src/boot-guard.js und src/boot.js (E1-Bindungsableitung als Muster), src/audit-store.js, den Sweep-/Tick-Mechanismus (grep runSweepTick o.ae.), src/store/state-ops.js + pg.js (durable Zeilen), src/config.js (Namespace-Konvention) und test/helpers.js (BASE_ENV).
4. Miss selbst: ${TEST_CMD} auf ${BASE} (pass-Anker, Lead-Messung war ${TEST_FLOOR}), npm run test:gates auf ${BASE} (Vorher-Zahl), npm run lint im WORKTREE (0 Fehler).
${LEAD_DECISIONS}
${CLEAN_CODE_REQ}
${ABS_RULES}
DEINE WICHTIGSTEN VIER AUFGABEN:
(a) **Die Erkennungsregel exakt dimensionieren:** lege die Schwellen, das Fenster und den Mindestnenner ZAHLENMAESSIG fest und begruende jede Zahl an zwei Szenarien: (i) heute, ~1 Anruf pro Woche - der 27.08.-Fall MUSS anschlagen (drei not-placed, null Erfolge, EIN Tenant); (ii) Skala, ~8.000 Anrufe pro Stunde - normales Grundrauschen darf NICHT anschlagen. Rechne beide Faelle im Plan vor.
(b) **Die Durabilitaet entwerfen (PM-23):** wo genau liegen Fenster und Marker, so dass ein Prozess-Neustart sie nicht verliert und ein wiederkehrender Ausfall nicht bei jedem Aufwachen erneut meldet. Entwirf den Neustart-Test konkret.
(c) **Den Meldeweg entwerfen:** Reihenfolge Log -> Audit -> SMS -> Mail, Mail primaer; was passiert, wenn ein Kanal fehlt oder wirft (der naechste Kanal muss trotzdem laufen); wie der Boot-Guard einen komplett unbesetzten Kanal LAUT meldet; wie die Absendernummer des SMS-Kanals als eigene Plattform-Bindung abgeleitet wird (E1-Mechanik).
(d) **Die Testfaelle einzeln entwerfen:** K0 (erster Befund einer neuen Klasse -> Log+Audit, KEIN Versand), K1 mit dem 27.08.-Muster, K1-Gegenprobe (ein Tenant, eine unerreichbare Nummer -> KEIN Alarm), K2 oberhalb und unterhalb der Anteilsschwelle, 5xx-Sturm (result-unknown -> kein Schuld-Alarm), Neustart-Test, Kanal-faellt-aus-Test, PII-Regex-Test, Boot-Guard-Test bei leeren Kanaelen, und die Sabotage-Gegenproben (Erkennung entschaerfen -> Test MUSS rot; Reihenfolge in voice.js verletzen -> Test MUSS rot).
LIEFERE: exakte Edits je Datei (Vorher/Nachher), die Zahlen mit Begruendung, neue Tests, je Abnahmepunkt Kommando + erwartete Ausgabe. Deine Rueckgabe IST der Plan.`,
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
    ausfall2708Proof: {
      type: "string",
      description: "AUSGEFUEHRT: das 27.08.-Muster (mehrere not-placed, null Erfolge, EIN Tenant) loest Alarm aus. Kommando + Ausgabe",
    },
    keinFehlalarmProof: {
      type: "string",
      description: "AUSGEFUEHRT: ein Tenant mit unerreichbarer Nummer und ein 5xx-Sturm loesen KEINEN Schuld-Alarm aus; Skalen-Grundrauschen ebenfalls nicht. Kommando + Ausgabe",
    },
    k0Proof: { type: "string", description: "AUSGEFUEHRT: erster Befund einer neuen Klasse -> Log+Audit, KEIN Versand. Kommando + Ausgabe" },
    neustartProof: {
      type: "string",
      description: "PM-23 AUSGEFUEHRT: Fenster und Entprell-Marker ueberleben einen Prozess-Neustart; kein Alarm bei jedem Aufwachen. Kommando + Ausgabe",
    },
    meldewegProof: {
      type: "string",
      description: "AUSGEFUEHRT gegen Attrappen: Reihenfolge Log->Audit->SMS->Mail; faellt ein Kanal aus, laufen die uebrigen. Kommando + Ausgabe",
    },
    bootGuardLautProof: {
      type: "string",
      description: "PM-16 AUSGEFUEHRT: kein Kanal konfiguriert -> LAUTER Befund, nicht Schweigen. Kommando + Ausgabe",
    },
    smsAbsenderBindungProof: {
      type: "string",
      description: "PM-17 AUSGEFUEHRT: die SMS-Absendernummer ist als eigene Plattform-Bindung abgeleitet und faellt nicht still weg. Kommando + Ausgabe",
    },
    reihenfolgeAusgedehntProof: {
      type: "string",
      description: "C-A AUSGEFUEHRT: Riegel auch in voice.js/outbound.js; Sabotage dort macht einen Test ROT, danach wiederhergestellt. Woertlich",
    },
    piiProof: { type: "string", description: "AUSGEFUEHRT: Alarm-Text ohne Rufnummern/Namen/Inhalte, per Regex geprueft; nichts im Log. Kommando + Ausgabe" },
    failClosedProof: { type: "string", description: "AUSGEFUEHRTE Sabotage: Erkennung entschaerft -> Test MUSS rot -> wiederhergestellt. Woertlich" },
    envProof: { type: "string", description: "Neue Env-Vars in config.js, .env.example, render.yaml, test/helpers.js BASE_ENV. Woertlich" },
    gatesProof: { type: "string", description: "npm run test:gates: Vorher-Zahl und Nachher-Zahl. Woertlich" },
    lintProof: { type: "string", description: "npm run lint (eslint ., VOLL, im Worktree) = 0 Fehler. Woertlich" },
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
    "ausfall2708Proof",
    "keinFehlalarmProof",
    "k0Proof",
    "neustartProof",
    "meldewegProof",
    "bootGuardLautProof",
    "smsAbsenderBindungProof",
    "reihenfolgeAusgedehntProof",
    "piiProof",
    "failClosedProof",
    "envProof",
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
3. Lies die Etappe E3b und die Entwurfsentscheidung E-4 in "${REPO}/${PLAN_DOC}" SELBST. Implementiere EXAKT gemaess Plan+Spec. ${CLEAN_CODE_REQ}
${LEAD_DECISIONS}
4. node --check auf JEDE geaenderte .js-Datei.
5. ${TEST_CMD} - pass MUSS >= ${TEST_FLOOR} sein und fail == 0 (Einzel-Flake nur nach isolierter Wiederholung werten; aendere waehrend eines laufenden Testlaufs KEINE Dateien - das erzeugt Scheinfehler, E2/E3a-Lehre; fahre NIE zwei volle Suiten gleichzeitig). DAZU npm run lint = 0 Fehler (VOLL, im Worktree) UND npm run test:gates nicht roeter als die Vorher-Zahl.
6. **ZEHN BEWEISE (alle Pflicht, alle AUSFUEHREN):** ausfall2708Proof, keinFehlalarmProof, k0Proof, neustartProof, meldewegProof, bootGuardLautProof, smsAbsenderBindungProof, reihenfolgeAusgedehntProof, piiProof, failClosedProof - Kommando+Ausgabe woertlich. Dazu envProof, gatesProof, lintProof.
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
    testCountNotShrunk: { type: "boolean", description: `pass >= ${TEST_FLOOR}, fail 0` },
    ausfall2708Erkannt: {
      type: "boolean",
      description: "SELBST gefahren: das exakte Muster vom 27.08. loest Alarm aus. Tut es das nicht, ist die Etappe wertlos = BLOCKER",
    },
    keinFehlalarm: {
      type: "boolean",
      description: "SELBST gefahren: unerreichbare Nummer eines Tenants, 5xx-Sturm und Skalen-Grundrauschen loesen KEINEN Alarm aus",
    },
    k0Wirksam: { type: "boolean", description: "SELBST gefahren: erster Befund einer neuen Klasse -> Log+Audit ohne Versand" },
    neustartFest: {
      type: "boolean",
      description: "PM-23 SELBST gefahren: Fenster/Marker ueberleben den Neustart; kein Alarm-Sturm bei jedem Aufwachen",
    },
    meldewegRobust: {
      type: "boolean",
      description: "SELBST gefahren: Reihenfolge stimmt, Mail ist primaer, ein ausgefallener Kanal stoppt die uebrigen nicht",
    },
    bootGuardLaut: { type: "boolean", description: "PM-16 SELBST gefahren: unbesetzter Kanal ergibt einen lauten Befund, kein stilles Gruen" },
    smsAbsenderGebunden: { type: "boolean", description: "PM-17 SELBST geprueft: SMS-Absender ist plattform-gebunden und faellt nicht still weg" },
    reihenfolgeRiegelAusgedehnt: {
      type: "boolean",
      description: "C-A: SELBST die Reihenfolge in voice.js UND outbound.js verletzt -> je ein Test wird ROT. Bleibt die Suite gruen = BLOCKER",
    },
    eineErkennungsstelle: {
      type: "boolean",
      description: "SELBST gegrept: GENAU EINE Stelle urteilt ueber systematischen Ausfall; Erkennung und Versand sind getrennt",
    },
    piiDicht: { type: "boolean", description: "SELBST geprueft: keine Rufnummern/Namen/Inhalte im Alarm-Text und in keinem Log" },
    sabotageSelbstRotGesehen: { type: "boolean", description: "SELBST ausgefuehrt: Erkennung entschaerft -> Test rot -> wiederhergestellt" },
    envVollstaendig: { type: "boolean", description: "config.js + .env.example + render.yaml + BASE_ENV; Default sendet nicht, meldet aber laut" },
    gatesNotWorse: { type: "boolean" },
    fullLintZeroErrors: { type: "boolean" },
    routeAuthIntact: { type: "boolean" },
    safetyGatesIntact: { type: "boolean" },
    noProviderWrites: { type: "boolean", description: "keine echten Mails/SMS/Provider-Schreibzugriffe im Diff und in keinem Test" },
    noSecretsLeaked: { type: "boolean" },
    scopeRespected: { type: "boolean", description: "kein bridge.js; kein Vorgriff auf E4/E5; E1/E2/E3a-Code unangetastet" },
    approved: { type: "boolean" },
    blockers: { type: "array", items: { type: "string" } },
    concerns: { type: "array", items: { type: "string" } },
    verdict: { type: "string" },
  },
  required: [
    "approved",
    "testsPassIndependently",
    "testCountNotShrunk",
    "ausfall2708Erkannt",
    "keinFehlalarm",
    "k0Wirksam",
    "neustartFest",
    "meldewegRobust",
    "bootGuardLaut",
    "smsAbsenderGebunden",
    "reihenfolgeRiegelAusgedehnt",
    "eineErkennungsstelle",
    "piiDicht",
    "sabotageSelbstRotGesehen",
    "envVollstaendig",
    "gatesNotWorse",
    "fullLintZeroErrors",
    "routeAuthIntact",
    "safetyGatesIntact",
    "noProviderWrites",
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
        `STRENGER, adversarialer Safety-/Abnahme-Reviewer in frischem Worktree. Pruefe Phase ${PHASE} auf Branch "${target}". Diese Etappe soll dafuer sorgen, dass ein Totalausfall NICHT drei Tage unbemerkt bleibt - ein Alarm, der das Muster vom 27.08. verpasst, der bei Skala im Rauschen ertrinkt, der den Neustart nicht ueberlebt oder der PII verschickt, bricht das Kernversprechen. Im Zweifel blockieren.
1. ln -s "${NODE_MODULES}" node_modules
2. git checkout -b review-outbound-e3b${suffix} ${target}
3. ${TEST_CMD} SELBST (pass >= ${TEST_FLOOR}, fail 0; fahre NIE zwei Suiten gleichzeitig). DAZU npm run lint SELBST (VOLL) = 0 Fehler UND npm run test:gates auf ${BASE} UND auf ${target}.
4. Lies die Etappe E3b + Entwurfsentscheidung E-4 + Pre-Mortem (PM-16/17/20/21/22/23) in "${REPO}/${PLAN_DOC}", dazu "${REPO}/${BEFUND_DOC}" und "${REPO}/tasks/outbound-e3a-report.md".
5. JEDEN Abnahmepunkt EINZELN selbst fahren; keine Impl-Behauptung uebernehmen:
   - **ausfall2708Erkannt:** das exakte Muster aus dem Befund selbst einspielen.
   - **keinFehlalarm:** eigene Gegen-Szenarien bauen (ein Tenant/unerreichbar, 5xx-Sturm, Skalen-Grundrauschen mit hohem Nenner).
   - **neustartFest:** Prozess-Neustart SELBST nachstellen.
   - **reihenfolgeRiegelAusgedehnt:** SELBST die Reihenfolge in voice.js UND in outbound.js verletzen. Bleibt die Suite gruen -> BLOCKER.
   - **piiDicht:** eigene Fixtures mit Rufnummer/Name/Inhalt, dann Alarm-Text und Log pruefen.
   - **eineErkennungsstelle:** SELBST grepen.
6. git diff ${BASE}..${target} durchsehen: kein Safety-Gate beruehrt, kein bridge.js, kein echter Versandweg scharf, kein Vorgriff auf E4/E5, E1/E2/E3a unangetastet.
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
 - **Single Source of Truth:** GENAU EINE Stelle urteilt "systematischer Ausfall"; Erkennung (reine Funktion) und Versand sind getrennt; kein zweiter Benachrichtigungsweg neben dem Bestand; keine zweite Schwellen-Tabelle.
 - **Erzwungen statt konventionell:** der ausgedehnte Reihenfolge-Riegel muss im Code wirken - ein Kommentar ist S1.
 - **Magic Numbers:** Schwellen, Fenster, Mindestnenner als benannte Konstanten oder Env-Werte.
 - **Durabilitaet:** kein Zustand, der einen Neustart nicht ueberlebt, wo der Plan Durabilitaet verlangt.
 - **Suppression-Tabu:** nur Diff-eigene Dateien; gepinnte Altlast-Werte nicht stillschweigend angehoben; volles Lint 0 Fehler; sonst S1.
 - **P11/T-Serie:** AUSGEFUEHRTE Gegenproben, sonst S1; Tests pinnen den SOLL-Zustand; Positiv- UND Negativ-Kontrolle vorhanden (Alarm feuert / feuert nicht).
 - Funktionslaenge (<=100), Verschachtelung (<=4), Argumente (<=3); Kommentare deutsch OHNE Umlaute; i18n vollstaendig, falls nutzer-sichtbar.
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
4. node --check + ${TEST_CMD} gruen, pass >= ${TEST_FLOOR}, npm run lint (VOLL) 0 Fehler, test:gates nicht roeter. node_modules NICHT committen. git add (betroffene Dateien einzeln) && git commit -m "fix(outbound-e3b): Review-Blocker beheben (Runde ${round})". headCommit = git rev-parse HEAD.
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
Inhalt (Markdown, deutsch OHNE Umlaute): Phase ${PHASE} ${PHASE_TITLE}; Gate=${approved ? "PASS" : "BLOCKED"}; finalBranch=${reviewTarget}; die Erkennungsregel mit ALLEN Zahlen und der Vorrechnung fuer beide Szenarien (heute / Skala); der Meldeweg mit Kanal-Ausfall-Verhalten; die Durabilitaet (was liegt wo, Neustart-Test); die Abnahmepunkte einzeln mit Urteil+Kommando; die ausgefuehrten Gegenproben woertlich (27.08.-Muster, Fehlalarm-Gegenproben, Neustart, Reihenfolge-Sabotage in voice.js/outbound.js, PII); Impl-Zusammenfassung + deviations; Safety-Urteil; Clean-Code-Audit; Fix-Runden; was fuer den Betrieb noch zu setzen ist (Env-Werte). Quelle:
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
  ausfall2708Erkannt: (safety && safety.ausfall2708Erkannt) || false,
  keinFehlalarm: (safety && safety.keinFehlalarm) || false,
  k0Wirksam: (safety && safety.k0Wirksam) || false,
  neustartFest: (safety && safety.neustartFest) || false,
  meldewegRobust: (safety && safety.meldewegRobust) || false,
  bootGuardLaut: (safety && safety.bootGuardLaut) || false,
  smsAbsenderGebunden: (safety && safety.smsAbsenderGebunden) || false,
  reihenfolgeRiegelAusgedehnt: (safety && safety.reihenfolgeRiegelAusgedehnt) || false,
  eineErkennungsstelle: (safety && safety.eineErkennungsstelle) || false,
  piiDicht: (safety && safety.piiDicht) || false,
  envVollstaendig: (safety && safety.envVollstaendig) || false,
  gatesNotWorse: (safety && safety.gatesNotWorse) || false,
  fullLintZeroErrors: (safety && safety.fullLintZeroErrors) || false,
  safetyGatesIntact: (safety && safety.safetyGatesIntact) || false,
  blockers: blockerList(safety, cc),
  fixRounds: round,
  reportPath,
  safetyVerdict: (safety && safety.verdict) || "",
  ccVerdict: (cc && cc.verdict) || "",
  deviations: (impl && impl.deviations) || [],
  summary: (impl && impl.summary) || "",
};
