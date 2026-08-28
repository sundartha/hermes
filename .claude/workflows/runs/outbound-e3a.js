// SCHLANKES, SELBST-FIXENDES Phasen-Workflow (Lead bleibt duenn).
// Kopie der Vorlage .claude/workflows/runs/outbound-e2.js, Phase HART GEPINNT auf OUTBOUND-E3A.

export const meta = {
  name: "phase-impl-lean-outbound-e3a",
  description:
    "OUTBOUND-E3A (F2a): Der Fehler erreicht den Nutzer - ueber die BESTEHENDEN Rueckgabewege (await_call_event/get_call_status/Feed/Widget), Mail nur fuer die not-placed-Klasse. Plus die zwei offenen E2-Befunde (Reihenfolge-Riegel, Grund auch ohne Anbieter-Status). Plan -> Impl (Worktree) -> dualer Review -> Self-Fix -> Report.",
  phases: [
    { title: "Plan", detail: "Umsetzung code-gegroundet planen (Spec: PLAN-OUTBOUND-RESILIENZ.md, Etappe E3a)", model: "opus" },
    { title: "Implementieren", detail: "Umsetzung im Worktree, npm test gruen, eslint . 0 Fehler", model: "sonnet" },
    { title: "Review", detail: "Safety/Abnahme + Clean-Code-Auditor (parallel, beide Opus)", model: "opus" },
    { title: "Self-Fix", detail: "S1/S2/Safety-Blocker fixen + Re-Review, bis PASS", model: "sonnet" },
    { title: "Report", detail: "Detailbericht in tasks/outbound-e3a-report.md (Lead liest ihn nicht)", model: "sonnet" },
  ],
};

// HART GEPINNT auf das Haupt-Repo (Symlink-Falle, C-P4).
const REPO = "/Users/antonio/Mein Unternehmen/MCP/vodafone-agent";
const NODE_MODULES = `${REPO}/node_modules`;

// PER-RUN-SKRIPT OUTBOUND-E3A: Phase HART GEPINNT.
const RUN = {
  phaseId: "OUTBOUND-E3A",
  phaseTitle:
    "F2(a): Der Fehler erreicht den Nutzer ueber die bestehenden Rueckgabewege; Mail nur fuer not-placed; Reihenfolge-Riegel und Grund auch ohne Anbieter-Status",
  branch: "phase/outbound-e3a-nutzer-rueckweg",
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
const REPORT_PATH = "tasks/outbound-e3a-report.md";

// MODELL-POLITIK: Urteilen=Opus, Ausfuehren=Sonnet; Pins pro agent() (Memory [[workflow-model-policy]]).
const PLAN_AGENT = { model: "opus", effort: "high" };
const IMPL_AGENT = { model: "sonnet", effort: "high" };
const SAFETY_AGENT = { model: "opus", effort: "xhigh" };
const CLEANCODE_AGENT = { model: "opus", effort: "high" };
const FIX_AGENT = { model: "sonnet", effort: "medium" };
const REPORT_AGENT = { model: "sonnet", effort: "low" };

// Suite-Anker: vom Lead auf master NACH dem E2-Merge (d59b136) selbst gemessen: pass 5167 / fail 0.
const TEST_CMD = `LLM_PROVIDER=anthropic npm test`;
const TEST_FLOOR = 5167;

const LINT_REGEL = `LINT-PFLICHT (P1-Lehre, tasks/lessons.md): npm run lint (eslint ., volles Repo im Worktree) MUSS "0 errors" melden. eslint-suppressions.json und eslint-legacy-exceptions.json duerfen NUR Eintraege von Dateien aendern, die im eigenen Diff stehen. Einen GEPINNTEN Altlast-Wert hebst du NICHT an, um nicht blockiert zu sein - du baust die Loesung so, dass der Pin haelt (E2-Lehre: dort wurde stattdessen eine Modul-Funktion extrahiert, die eine bestehende Zeile ERSETZT). Muss ein Pin dennoch nachgezogen werden, ist das eine begruendete deviation mit gemessener Zahl, nie eine Schaetzung.`;

const CLEAN_CODE_REQ = `CLEAN-CODE (PFLICHT): Lies "${REPO}/.claude/refs/clean-code.md" und befolge ihn bei JEDER Entscheidung. Fuer diese Phase besonders: KEINE zweite Wahrheit ueber den Fehlergrund - call.failureReason (aus E2) ist die Quelle, alle Leser rendern sie, niemand leitet sie neu her; KEIN zweiter Benachrichtigungsweg neben dem Bestand; die Text-Aufloesung (Token -> Satz) lebt an GENAU EINER Stelle je Oberflaeche. Magic Numbers in benannte Konstanten. Kein toter Code; Kommentare deutsch OHNE Umlaute. Neues Verhalten braucht Tests. ${LINT_REGEL}`;

const LEAD_DECISIONS = `BINDENDE LEAD-ENTSCHEIDUNGEN - nicht neu aufrollen, nicht umdeuten:
1. "${PLAN_DOC}" ist AUTORITATIV (Entwurfsentscheidung "E-3 (F2a)" und Etappe "E3a", dazu Testkonzept 6, Pre-Mortem 7, akzeptierte Risiken 8). Der gemessene Ausfall-Befund steht in "${BEFUND_DOC}". Umzusetzen ist NUR Etappe E3a PLUS die zwei unten unter 6./7. ausdruecklich zugewiesenen E2-Befunde. Widersprueche Spec vs Ist-Code in deviations melden, Ist-Code respektieren.
2. E1 (platform_number_use + dreifacher Freigabe-Riegel) und E2 (Fehlervokabular in src/telephony/failure-reason.js mit den Basis-Token not-placed/unreachable/result-unknown) sind auf ${BASE} gemergt. Beide NICHT umbauen - E3a BENUTZT sie.
3. SINGLE SOURCE OF TRUTH: der Grund kommt aus call.failureReason. E3a baut KEINEN neuen Mechanismus, sondern verdrahtet die BESTEHENDEN Rueckgabewege: await_call_event und get_call_status liefern status + failure_reason, der Feed/das Live-Widget rendert den Grund. Eine zweite Herleitung des Grundes irgendwo im Leser ist ein Blocker.
4. Der Warte-Platzhalter ("noch keine Antwort, in einigen Sekunden erneut fragen") verschwindet AUSSCHLIESSLICH bei terminalem Anruf MIT Grund. Die Gegenrichtung ist byte-identisch zum Bestand und per Test gepinnt: laufender Anruf -> Platzhalter bleibt; terminaler Anruf OHNE Grund -> Bestandsverhalten. Das ist die Positiv-Kontrolle dieser Etappe.
5. MAIL NUR FUER not-placed (Plan-Entscheidung): eine Mail geht ausschliesslich raus, wenn der Anruf NIE PLATZIERT wurde - also bei unserem/anbieterseitigem Defekt. NICHT bei unreachable (der Angerufene war weg - das ist Alltag, kein Vorfall) und NICHT bei result-unknown. Kein SMS-Generator, keine Mail pro Fehlanruf. Bei Skala waere beides Muell.
6. E2-BEFUND C1 (vom Safety-Reviewer belegt, hiermit E3a zugewiesen): die Invariante "der Grund wird geschrieben, BEVOR der Anruf beendet/abgerechnet wird" ist im echten Code NICHT gesichert - der Reviewer hat die Reihenfolge in src/routes/api-calls.js verletzt und die gesamte Suite blieb gruen. In E3a wird der Nutzertext zum Liefergegenstand, damit wird die Reihenfolge kaufentscheidend. Baue den Riegel an der Naht UND einen Test, der die verletzte Reihenfolge ROT macht. Ein Riegel per Kommentar ist keiner.
7. E2-BEFUND D-4 (hiermit E3a zugewiesen): ein Start-Fehlschlag OHNE Anbieter-Status (Netzfehler, Timeout, abgebrochene Verbindung) bleibt heute ohne Grund. Er bekommt einen - in der Klasse fuer unbekanntes Ergebnis, NICHT in der Schuldklasse. Fail-closed: kein erfundener Grund, aber auch kein leeres Feld.
8. E2-BEFUND D-5 (hiermit E3a zugewiesen): ein unbekanntes/neues Basis-Token darf in der Nutzer-Oberflaeche NICHT roh erscheinen. Es faellt auf einen verstaendlichen Sammel-Satz zurueck; der rohe Token bleibt der Diagnose vorbehalten (Store/Log-Ebene, nicht Nutzertext).
9. PII (bindend): der Nutzertext, der Feed-Eintrag und die Mail tragen KEINE Gespraechsinhalte und KEINEN Anbieter-Rohtext. Die Zielrufnummer erscheint nur dort, wo der Bestand sie ohnehin zeigt (der Nutzer kennt seine eigene Zielnummer) - nie in Logs. Fixtures erkennbar fiktiv.
10. i18n: neue nutzer-sichtbare Texte in ALLEN vom Bestand getragenen Sprachen, nach der Konvention GENAU DER Datei, in der sie leben (miss das nach - E2 hat fuer die Fehlergrund-Texte die ASCII/kuratiert-Konvention belegt). Keine gemischte Datei, kein Text nur auf Deutsch.
11. RUECKWAERTSKOMPATIBILITAET: bestehende MCP-Clients, Live-Widget und Dashboard duerfen nicht brechen; Antwortformate bleiben additiv. Ein Test pinnt das.
12. Schritt 0 (Pflicht, VOR dem ersten Edit): npm run test:gates auf ${BASE} ausfuehren und die Zahl der roten Faelle festhalten - nach der Umsetzung darf sie NICHT hoeher sein.`;

const ABS_RULES = `ABSOLUTE REGELN (unantastbar, siehe CLAUDE.md):
- Safety-Gates NIE anfassen (Outbound-Permit, OUTBOUND_FROZEN, Denylist/Land-Gate/Stundenlimit, pro-Tenant-Kostendecke, Max-Gespraechsdauer, Telnyx-Signaturpruefung). Offenlegungs-Mechanik und callee_is_owner NICHT beruehren. Auth fail-closed: neue/geaenderte Endpunkte brauchen die Middleware-Kette und ggf. einen route-policy-Eintrag (test/route-auth-inventory.test.js). Secrets nur via env, nie loggen. AUDIO NIEMALS durch MCP.
- KEINE echten Anrufe/SMS/Mails, KEINE Provider-SCHREIBzugriffe, KEIN Deploy. Mailversand im Test NUR gegen Attrappe.
- SCOPE: NUR Etappe E3a plus die drei zugewiesenen E2-Befunde. Der Betreiber-Alarm (E3b), der Drift-Waechter (E4) und die Absender-Wahrheit (E5) sind EIGENE Etappen - hier NICHT vorgreifen. Kein src/bridge.js.`;

// ---------- Phase 1: Plan ----------
phase("Plan");
const plan = await agent(
  `Du erstellst den DETAILLIERTEN, code-gegroundeten Umsetzungsplan fuer Phase ${PHASE} (${PHASE_TITLE}) im Repo "${REPO}". NUR PLANEN, NICHTS aendern.
1. Lies aus "${REPO}/${PLAN_DOC}" VOLLSTAENDIG: die Entwurfsentscheidung "E-3 (F2a)", die Etappe "E3a" samt Abnahmekatalog, Abschnitt 6 (Testkonzept), Abschnitt 7 (Pre-Mortem, besonders die Punkte zu Nutzertext, Alarm-Rauschen und PII) und Abschnitt 8. AUTORITATIV. Dazu "${REPO}/${BEFUND_DOC}" und - fuer die zugewiesenen Befunde C1/D-4/D-5 - "${REPO}/tasks/outbound-e2-report.md".
2. Lies "${REPO}/.claude/refs/clean-code.md".
3. Lies den ECHTEN Code auf Basis "${BASE}" (E1+E2 gemergt!): src/telephony/failure-reason.js (das E2-Vokabular und die Text-Aufloesung), src/i18n/failure-reason-texts.js, src/mcp-tools.js (await_call_event, get_call_status, der Warte-Platzhalter - selbst finden), src/store/views.js publicCall, src/routes/api-calls.js (die Naht aus Befund C1: wo der Grund geschrieben und wo beendet/abgerechnet wird), src/ui/widgets/call.html + src/ui/widget-i18n.js (das Live-Widget), den bestehenden Mail-Versandweg (grep - selbst finden, NICHT erfinden) und die Notification-/Feed-Maschinerie.
4. Miss selbst: ${TEST_CMD} auf ${BASE} (pass-Anker, Lead-Messung war ${TEST_FLOOR}), npm run test:gates auf ${BASE} (rote Faelle = Vorher-Zahl), npm run lint (0 Fehler; im WORKTREE messen, im Haupt-Repo stoeren gitignorierte Fremddateien).
${LEAD_DECISIONS}
${CLEAN_CODE_REQ}
${ABS_RULES}
DEINE WICHTIGSTEN VIER AUFGABEN:
(a) **Die Leserkette vollstaendig kartieren:** jeder Weg, auf dem ein Nutzer heute das Ergebnis eines Anrufs erfaehrt (MCP-Werkzeuge, Live-Widget, Feed, Dashboard, Mail, SMS). Fuer JEDEN: sieht er den Grund heute? Was fehlt? Das ist die Grundlage fuer "keine zweite Wahrheit".
(b) **Den Reihenfolge-Riegel entwerfen (C1):** zeige am Code die Naht, an der der Grund VOR dem Beenden/Abrechnen stehen muss, entwirf den Riegel (so, dass eine Verletzung nicht kompilieren/laufen kann statt nur dokumentiert zu sein) UND den Test, der die absichtlich verletzte Reihenfolge ROT macht. Ohne diesen Test ist die Etappe nicht abgenommen.
(c) **Die Mail-Bedingung scharf ziehen:** nur not-placed. Entwirf die Bedingung, den Empfaenger, den PII-freien Inhalt, die Sprache und die Entprellung (was passiert bei 5 Fehlversuchen hintereinander - eine Mail oder fuenf?). Nutze den BESTEHENDEN Versandweg; wenn keiner taugt, begruende das mit file:line.
(d) **Die Testfaelle einzeln entwerfen:** terminaler Anruf mit Grund (Platzhalter weg, Grund da), laufender Anruf (Platzhalter bleibt - Positiv-Kontrolle), terminaler Anruf ohne Grund (Bestandsverhalten), unbekanntes Token (Sammel-Satz statt roh), Start-Fehlschlag ohne Anbieter-Status (bekommt result-unknown), Mail nur bei not-placed (und NICHT bei unreachable), PII-Probe (kein Rohtext/Gespraechsinhalt), Reihenfolge-Sabotage (MUSS rot).
LIEFERE: exakte Edits je Datei (Vorher/Nachher), neue Tests, je Abnahmepunkt Kommando + erwartete Ausgabe. Deine Rueckgabe IST der Plan.`,
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
    nutzerSiehtGrundProof: {
      type: "string",
      description: "AUSGEFUEHRT: terminaler Anruf mit Grund -> await_call_event/get_call_status liefern status+failure_reason, Warte-Platzhalter weg. Kommando + Ausgabe",
    },
    positivKontrollProof: {
      type: "string",
      description: "AUSGEFUEHRT: laufender Anruf -> Platzhalter BLEIBT; terminaler Anruf ohne Grund -> Bestandsverhalten byte-identisch. Kommando + Ausgabe",
    },
    reihenfolgeRiegelProof: {
      type: "string",
      description: "C1: Riegel gebaut UND Sabotage ausgefuehrt - verletzte Reihenfolge macht einen Test ROT, danach wiederhergestellt. Woertlich",
    },
    ohneAnbieterStatusProof: {
      type: "string",
      description: "D-4: Start-Fehlschlag ohne Anbieter-Status bekommt die Unbekannt-Klasse, nicht die Schuldklasse, nicht leer. Kommando + Ausgabe",
    },
    unbekanntesTokenProof: {
      type: "string",
      description: "D-5: unbekanntes Basis-Token erscheint als verstaendlicher Sammel-Satz, nie roh im Nutzertext. Kommando + Ausgabe",
    },
    mailNurNotPlacedProof: {
      type: "string",
      description: "AUSGEFUEHRT gegen Attrappe: Mail bei not-placed JA, bei unreachable NEIN, bei result-unknown NEIN; Entprellung belegt. Kommando + Ausgabe",
    },
    piiProof: {
      type: "string",
      description: "AUSGEFUEHRT: kein Anbieter-Rohtext, kein Gespraechsinhalt in Nutzertext/Feed/Mail; nichts davon im Log. Kommando + Ausgabe",
    },
    i18nProof: { type: "string", description: "Neue Texte in allen Bestandssprachen, Konvention der Zieldatei gemessen. Woertlich" },
    bestandsverhaltenProof: { type: "string", description: "MCP-Clients/Widget/Dashboard brechen nicht; Antwortformate additiv. Kommando + Ausgabe" },
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
    "nutzerSiehtGrundProof",
    "positivKontrollProof",
    "reihenfolgeRiegelProof",
    "ohneAnbieterStatusProof",
    "unbekanntesTokenProof",
    "mailNurNotPlacedProof",
    "piiProof",
    "i18nProof",
    "bestandsverhaltenProof",
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
3. Lies die Etappe E3a und die Entwurfsentscheidung E-3 in "${REPO}/${PLAN_DOC}" SELBST. Implementiere EXAKT gemaess Plan+Spec. ${CLEAN_CODE_REQ}
${LEAD_DECISIONS}
4. node --check auf JEDE geaenderte .js-Datei.
5. ${TEST_CMD} - pass MUSS >= ${TEST_FLOOR} sein und fail == 0 (Einzel-Flake nur nach isolierter Wiederholung werten; aendere waehrend eines laufenden Testlaufs KEINE Dateien - das erzeugt Scheinfehler, E2-Lehre). DAZU npm run lint = 0 Fehler (VOLL, im Worktree) UND npm run test:gates nicht roeter als die Vorher-Zahl.
6. **ACHT BEWEISE (alle Pflicht, alle AUSFUEHREN):** nutzerSiehtGrundProof, positivKontrollProof, reihenfolgeRiegelProof, ohneAnbieterStatusProof, unbekanntesTokenProof, mailNurNotPlacedProof, piiProof, bestandsverhaltenProof - Kommando+Ausgabe woertlich. Dazu i18nProof, gatesProof, lintProof.
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
    nutzerSiehtGrund: {
      type: "boolean",
      description: "SELBST gefahren: der Nutzer erfaehrt bei einem gescheiterten Auftrag Status UND Grund; der Warte-Platzhalter erscheint nicht mehr faelschlich",
    },
    positivKontrolleGesehen: {
      type: "boolean",
      description: "SELBST gefahren: laufender Anruf behaelt den Platzhalter; terminaler Anruf ohne Grund verhaelt sich wie im Bestand",
    },
    reihenfolgeRiegelWirksam: {
      type: "boolean",
      description: "C1: SELBST die Reihenfolge verletzt -> ein Test wird ROT. Bleibt die Suite gruen, ist der Riegel wirkungslos = BLOCKER",
    },
    ohneAnbieterStatusGedeckt: { type: "boolean", description: "D-4: SELBST gefahren, Netzfehler/Timeout bekommt die Unbekannt-Klasse" },
    unbekanntesTokenGedeckt: { type: "boolean", description: "D-5: SELBST gefahren, kein roher Token im Nutzertext" },
    mailNurNotPlaced: {
      type: "boolean",
      description: "SELBST gefahren: Mail NUR bei not-placed; bei unreachable/result-unknown KEINE; Entprellung greift (5 Fehlversuche != 5 Mails)",
    },
    keineZweiteWahrheit: {
      type: "boolean",
      description: "SELBST gegrept: alle Leser rendern call.failureReason; niemand leitet den Grund neu her; keine zweite Textliste je Oberflaeche",
    },
    piiDicht: { type: "boolean", description: "SELBST geprueft: kein Rohtext/Gespraechsinhalt in Nutzertext, Feed, Mail oder Log" },
    bestandsverhaltenIntakt: { type: "boolean", description: "SELBST geprueft: MCP-Clients/Widget/Dashboard brechen nicht, Formate additiv" },
    i18nVollstaendig: { type: "boolean", description: "SELBST geprueft: alle Bestandssprachen bedient, Konvention der Zieldatei eingehalten" },
    gatesNotWorse: { type: "boolean" },
    fullLintZeroErrors: { type: "boolean" },
    routeAuthIntact: { type: "boolean" },
    safetyGatesIntact: { type: "boolean" },
    noProviderWrites: { type: "boolean", description: "keine echten Mails/SMS/Provider-Schreibzugriffe im Diff und in keinem Test" },
    noSecretsLeaked: { type: "boolean" },
    scopeRespected: { type: "boolean", description: "kein bridge.js; kein Vorgriff auf E3b/E4/E5; E1/E2-Code unangetastet" },
    approved: { type: "boolean" },
    blockers: { type: "array", items: { type: "string" } },
    concerns: { type: "array", items: { type: "string" } },
    verdict: { type: "string" },
  },
  required: [
    "approved",
    "testsPassIndependently",
    "testCountNotShrunk",
    "nutzerSiehtGrund",
    "positivKontrolleGesehen",
    "reihenfolgeRiegelWirksam",
    "ohneAnbieterStatusGedeckt",
    "unbekanntesTokenGedeckt",
    "mailNurNotPlaced",
    "keineZweiteWahrheit",
    "piiDicht",
    "bestandsverhaltenIntakt",
    "i18nVollstaendig",
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
        `STRENGER, adversarialer Safety-/Abnahme-Reviewer in frischem Worktree. Pruefe Phase ${PHASE} auf Branch "${target}". Diese Etappe soll dafuer sorgen, dass ein Nutzer den Fehlschlag seines Auftrags MITBEKOMMT - ein stiller Fehlschlag, eine zweite Wahrheit ueber den Grund, ein PII-Leck in Mail/Feed oder ein wirkungsloser Reihenfolge-Riegel bricht das Kernversprechen. Im Zweifel blockieren.
1. ln -s "${NODE_MODULES}" node_modules
2. git checkout -b review-outbound-e3a${suffix} ${target}
3. ${TEST_CMD} SELBST (pass >= ${TEST_FLOOR}, fail 0). DAZU npm run lint SELBST (VOLL) = 0 Fehler UND npm run test:gates auf ${BASE} UND auf ${target} (Vergleich!).
4. Lies die Etappe E3a + Entwurfsentscheidung E-3 + Pre-Mortem in "${REPO}/${PLAN_DOC}", dazu "${REPO}/tasks/outbound-e2-report.md" (Befunde C1/D-4/D-5).
5. JEDEN Abnahmepunkt EINZELN selbst fahren; keine Impl-Behauptung uebernehmen:
   - **nutzerSiehtGrund** und **positivKontrolleGesehen** (laufender Anruf behaelt den Platzhalter!) gegen den lokal gestarteten Server.
   - **reihenfolgeRiegelWirksam:** SELBST die Reihenfolge im echten Code verletzen. Bleibt die Suite gruen, ist der Riegel wirkungslos -> BLOCKER.
   - **mailNurNotPlaced:** SELBST alle drei Klassen durchspielen, Attrappe pruefen, Entprellung mit mehreren Fehlversuchen.
   - **keineZweiteWahrheit:** SELBST grepen.
   - **piiDicht:** eigenen Rohtext mit Rufnummer und Gespraechsinhalt einschleusen, dann Nutzertext, Feed, Mail und Log pruefen.
6. git diff ${BASE}..${target} durchsehen: kein Safety-Gate beruehrt, kein bridge.js, kein echter Versandweg scharf geschaltet, kein Vorgriff auf E3b/E4/E5, E1/E2-Code unangetastet.
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
 - **Single Source of Truth:** call.failureReason ist die EINE Quelle; kein Leser leitet den Grund neu her; die Token->Satz-Aufloesung existiert je Oberflaeche genau einmal; kein zweiter Benachrichtigungsweg neben dem Bestand.
 - **Erzwungen statt konventionell:** der Reihenfolge-Riegel (C1) muss im Code wirken, nicht im Kommentar - ein blosser Hinweis ist S1.
 - **Fail-closed:** unbekanntes Token -> Sammel-Satz; fehlender Anbieter-Status -> Unbekannt-Klasse; nie ein erfundener Grund.
 - **Mail-Bedingung:** eng gefasst (nur not-placed), entprellt, PII-frei, gegen Attrappe getestet.
 - **Suppression-Tabu:** nur Diff-eigene Dateien; gepinnte Altlast-Werte nicht angehoben (oder begruendet + gemessen); volles Lint 0 Fehler; sonst S1.
 - **P11/T-Serie:** AUSGEFUEHRTE Gegenproben, sonst S1; Tests pinnen den SOLL-Zustand; Positiv-Kontrolle vorhanden.
 - Funktionslaenge (<=100), Verschachtelung (<=4), Argumente (<=3); Kommentare deutsch OHNE Umlaute; Textkonvention der Zieldatei einheitlich; i18n vollstaendig.
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
4. node --check + ${TEST_CMD} gruen, pass >= ${TEST_FLOOR}, npm run lint (VOLL) 0 Fehler, test:gates nicht roeter. node_modules NICHT committen. git add (betroffene Dateien einzeln) && git commit -m "fix(outbound-e3a): Review-Blocker beheben (Runde ${round})". headCommit = git rev-parse HEAD.
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
Inhalt (Markdown, deutsch OHNE Umlaute): Phase ${PHASE} ${PHASE_TITLE}; Gate=${approved ? "PASS" : "BLOCKED"}; finalBranch=${reviewTarget}; die vollstaendige Leserkette mit Urteil je Weg; der Reihenfolge-Riegel (C1) inkl. ausgefuehrter Sabotage; die Mail-Bedingung samt Entprellung; die Behandlung von D-4/D-5; die Abnahmepunkte einzeln mit Urteil+Kommando; die ausgefuehrten Gegenproben woertlich (Positiv-Kontrolle, PII, Reihenfolge); Impl-Zusammenfassung + deviations; Safety-Urteil; Clean-Code-Audit; Fix-Runden. Quelle:
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
  nutzerSiehtGrund: (safety && safety.nutzerSiehtGrund) || false,
  positivKontrolleGesehen: (safety && safety.positivKontrolleGesehen) || false,
  reihenfolgeRiegelWirksam: (safety && safety.reihenfolgeRiegelWirksam) || false,
  ohneAnbieterStatusGedeckt: (safety && safety.ohneAnbieterStatusGedeckt) || false,
  unbekanntesTokenGedeckt: (safety && safety.unbekanntesTokenGedeckt) || false,
  mailNurNotPlaced: (safety && safety.mailNurNotPlaced) || false,
  keineZweiteWahrheit: (safety && safety.keineZweiteWahrheit) || false,
  piiDicht: (safety && safety.piiDicht) || false,
  bestandsverhaltenIntakt: (safety && safety.bestandsverhaltenIntakt) || false,
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
