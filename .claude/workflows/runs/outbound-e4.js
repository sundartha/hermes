// SCHLANKES, SELBST-FIXENDES Phasen-Workflow (Lead bleibt duenn).
// Vorlage: outbound-e3b.js, Phase HART GEPINNT auf OUTBOUND-E4.
// GESTRAFFT (Lead-Entscheidung nach 16 Fix-Runden in E1-E3b): der Plan-Agent misst die Suite
// NICHT mehr selbst (Anker ist gemessen und gepinnt), die master-Gates-Zahl ist gepinnt statt
// je Review neu gemessen, maxFixRounds 4 -> 3, und die wiederkehrenden Blocker-Muster stehen
// als Vermeidungsliste direkt im Impl-Prompt.

export const meta = {
  name: "phase-impl-lean-outbound-e4",
  description:
    "OUTBOUND-E4 (F4): Drift-Waechter gegen die Anbieter-Wirklichkeit - erkennt den 27.08.-Zustand OHNE dass ein Anruf stattfinden muss (Boot + Stundentakt + externer Takt). Plus Fabrik-Vertrag-Test und Bezug im Betreiber-Befund. Plan -> Impl (Worktree) -> dualer Review -> Self-Fix -> Report.",
  phases: [
    { title: "Plan", detail: "Umsetzung code-gegroundet planen (Spec: PLAN-OUTBOUND-RESILIENZ.md, Etappe E4)", model: "opus" },
    { title: "Implementieren", detail: "Umsetzung im Worktree, npm test gruen, eslint . 0 Fehler", model: "sonnet" },
    { title: "Review", detail: "Safety/Abnahme + Clean-Code-Auditor (parallel, beide Opus)", model: "opus" },
    { title: "Self-Fix", detail: "S1/S2/Safety-Blocker fixen + Re-Review, bis PASS", model: "sonnet" },
    { title: "Report", detail: "Detailbericht in tasks/outbound-e4-report.md (Lead liest ihn nicht)", model: "sonnet" },
  ],
};

// HART GEPINNT auf das Haupt-Repo (Symlink-Falle, C-P4).
const REPO = "/Users/antonio/Mein Unternehmen/MCP/vodafone-agent";
const NODE_MODULES = `${REPO}/node_modules`;

const RUN = {
  phaseId: "OUTBOUND-E4",
  phaseTitle:
    "F4: Drift-Waechter gegen die Anbieter-Wirklichkeit (Boot + Stundentakt + externer Takt), Regressionsfang 27.08. ohne Verkehr",
  branch: "phase/outbound-e4-drift-waechter",
  baseBranch: "master",
  planDoc: "PLAN-OUTBOUND-RESILIENZ.md",
  befundDoc: "tasks/befund-outbound-ausfall-2026-08-27.md",
  maxFixRounds: 3,
};

const PHASE = RUN.phaseId;
const PHASE_TITLE = RUN.phaseTitle;
const BRANCH = RUN.branch;
const BASE = RUN.baseBranch;
const PLAN_DOC = RUN.planDoc;
const BEFUND_DOC = RUN.befundDoc;
const MAX_FIX_ROUNDS = RUN.maxFixRounds;
const REPORT_PATH = "tasks/outbound-e4-report.md";

const PLAN_AGENT = { model: "opus", effort: "high" };
const IMPL_AGENT = { model: "sonnet", effort: "high" };
const SAFETY_AGENT = { model: "opus", effort: "xhigh" };
const CLEANCODE_AGENT = { model: "opus", effort: "high" };
const FIX_AGENT = { model: "sonnet", effort: "medium" };
const REPORT_AGENT = { model: "sonnet", effort: "low" };

// Vom Lead auf master (8995f0c) SELBST gemessen - NICHT neu messen lassen:
const TEST_CMD = `LLM_PROVIDER=anthropic npm test`;
const TEST_FLOOR = 5285;
const GATES_ROT_AUF_MASTER = "3 rote Faelle (GAP-05, GAP-15, E2E-03)";

// Die wiederkehrenden Blocker aus 16 Fix-Runden (E1, E2, E3a, E3b) - VORAB vermeiden:
const BLOCKER_VERMEIDUNG = `BLOCKER-VERMEIDUNGSLISTE (aus 16 Fix-Runden der Etappen E1-E3b - das sind die Fehler, die JEDES MAL eine teure Extra-Runde ausgeloest haben; wer sie vermeidet, ist beim ersten Review durch):
1. GEGENPROBEN AUSFUEHREN, nicht behaupten. Jede Sabotage wirklich fahren, das rote Ergebnis woertlich zitieren, danach zurueckbauen und "git status --porcelain" leer nachweisen. Eine nur beschriebene Gegenprobe gilt als NICHT erbracht.
2. POSITIV-KONTROLLE IMMER mitliefern. Ein Waechter, der ALLES meldet, besteht jeden Negativ-Test und ist trotzdem kaputt. Zu jedem "erkennt den Defekt"-Test gehoert ein "meldet bei gesundem Zustand NICHTS"-Test.
3. GEPINNTE ALTLAST-WERTE NICHT ANHEBEN (eslint-legacy-exceptions.json). Loesung so bauen, dass der Pin haelt - E2 hat dafuer eine Modul-Funktion extrahiert, die eine bestehende Zeile ERSETZT; E3a hat den Pin sogar gesenkt. Muss ein Pin doch bewegt werden: gemessene Zahl + Begruendung + deviation, nie geschaetzt.
4. ABNAHMEPUNKTE DES PLANS VOLLSTAENDIG abarbeiten. In E3b fehlte ein kompletter Abnahmepunkt (C8) samt Testdatei - unbemerkt und undeklariert. Zaehle die Abnahmepunkte der Etappe im Plan ab und hake sie EINZELN ab. Was du nicht baust, wird eine ausdrueckliche deviation MIT Begruendung.
5. KEINE ZWEI TESTLAEUFE GLEICHZEITIG und waehrend eines laufenden Laufs KEINE Datei aendern - beides hat in E2 und E3a Scheinfehler erzeugt, die dann teuer falsifiziert werden mussten.
6. FIXTURES NIE AUF EINEN GRENZWERT LEGEN. Am 28.08. kippte ein Geldpfad-Test, weil die Fixture exakt auf einer Minutengrenze lag und unter Last die naechste Minute anbrach. Zeit-/Schwellenwerte in Fixtures mit Luft zur Grenze waehlen, Erwartungen aus dem Fixture-Wert ABLEITEN statt eine zweite Zahl zu tippen.
7. NEUE ENV-VARIABLEN vollstaendig: src/config.js + .env.example + render.yaml + test/helpers.js BASE_ENV. Und PRUEFEN, ob ein neuer Boot-Guard Bestands-Spawn-Tests kippt - in E3b haette ein Default 149 Bestandsfaelle rot gemacht.
8. DURABLER ZUSTAND gehoert in eine persistente Zeile, nicht in einen Speicher-Puffer - auf plan:free startet der Prozess staendig neu.
9. Tests pinnen den SOLL-Zustand, nicht die Implementierung; kein Test, der nur die eigene Rechnung nachbaut.`;

const LINT_REGEL = `LINT-PFLICHT: npm run lint (eslint ., VOLL, im Worktree) MUSS "0 errors" melden. Suppressions nur fuer Diff-eigene Dateien. Siehe Punkt 3 der Vermeidungsliste.`;

const CLEAN_CODE_REQ = `CLEAN-CODE (PFLICHT): Lies "${REPO}/.claude/refs/clean-code.md" und befolge ihn bei JEDER Entscheidung. Fuer diese Phase besonders: EINE Pruefstelle - die Frage "stimmt unsere Absender-Konfiguration noch mit der Anbieter-Wirklichkeit ueberein?" wird an genau einem Ort beantwortet, als reine Funktion (Eingabe: die abgefragten Anbieter-Antworten, Ausgabe: Befundliste) OHNE Netzzugriff; das Holen der Daten ist davon getrennt und testbar attrappierbar. Schwellen/Intervalle als benannte Konstanten bzw. Env-Werte. Kein toter Code; Kommentare deutsch OHNE Umlaute. ${LINT_REGEL}`;

const LEAD_DECISIONS = `BINDENDE LEAD-ENTSCHEIDUNGEN - nicht neu aufrollen, nicht umdeuten:
1. "${PLAN_DOC}" ist AUTORITATIV (Entwurfsentscheidung "E-6 (F4)" und Etappe "E4", dazu Testkonzept 6, Pre-Mortem 7 - besonders PM-16 und PM-26 - und Abschnitt 8). Der gemessene Ausfall-Befund steht in "${BEFUND_DOC}"; er enthaelt die echten Anbieter-Antworten, gegen die der Waechter anschlagen muss.
2. E1 (platform_number_use + Freigabe-Riegel + PLATFORM_ANI_E164), E2 (Fehlervokabular), E3a (Nutzer-Rueckweg) und E3b (Betreiber-Alarm K0/K1/K2, Meldeweg WARN->Audit->Mail->SMS, durable outage_alert-Zeile, Sweep-Zweige) sind auf ${BASE} gemergt. NICHT umbauen - E4 BENUTZT sie, insbesondere den BESTEHENDEN Meldeweg (kein zweiter Kanal!).
3. DER KERN DIESER ETAPPE: der Waechter muss den Zustand vom 27.08. erkennen, OHNE dass ein Anruf stattfindet. E3b erkennt Ausfaelle am Verkehr - bei rund einem Anruf pro Woche ist das zu spaet. E4 schliesst genau diese Luecke: er vergleicht unsere deklarierte Absenderkonfiguration mit dem, was der Anbieter tatsaechlich sagt. Der 27.08.-Fall (unsere ANI gehoert dem Konto nicht mehr) MUSS aus reinen Lese-Abfragen erkennbar sein.
4. TAKT: Pruefung beim Boot UND im BESTEHENDEN Stundentakt (kein neuer Timer, keine neue Ressource). AUSDRUECKLICH NICHT vor jedem Waehlen - das kostet Latenz auf dem Anrufstart, erzeugt unbeschraenkte Anbieter-Last bei Skala, und ein Falsch-Positiv wuerde einen bezahlten Kundenanruf verhindern.
5. WAS BEI ROT PASSIERT: fail-closed heisst hier NICHT "keine Anrufe mehr". Der Befund wird ueber den BESTEHENDEN Meldeweg gemeldet (E3b). Ein automatisches Abschalten des Produkts aufgrund einer Anbieter-Abfrage ist NICHT erlaubt - ein Falsch-Positiv (Rate-Limit, Anbieter-Stoerung) darf nie den Umsatz abschalten. Der Plan sieht dafuer ein separates, per Default AUSGESCHALTETES Gate vor; halte dich exakt daran und lasse den Default AUS.
6. "UNKNOWN" IST EIN EIGENER, GEZAEHLTER BEFUND (PM-16): eine Pruefung, die mangels Konfiguration oder wegen eines Anbieterfehlers kein Urteil faellen kann, meldet das LAUT - sie darf NIE wie "alles gruen" aussehen. Das ist der Fehler, der den 27.08. drei Tage unsichtbar gemacht hat.
7. MEHRERE INSTANZEN / RATE-LIMITS (PM-26): der Waechter darf beim Deploy nicht M-fach parallel in die Anbieter-Grenze laufen. Nutze den im Plan vorgesehenen Single-Flight-Mechanismus und eine Mindestfrist zwischen zwei Laeufen.
8. EXTERNER TAKT (Owner-Entscheidung F-4): ein GitHub-Actions-Workflow "on: schedule" als Liefergegenstand - er laeuft AUSSERHALB von Render und faellt damit nicht mit dem Dienst zusammen aus. Er braucht nur-lesende Secrets; das Hinterlegen der Secrets ist eine OWNER-AKTION und wird NICHT von dir ausgefuehrt. WICHTIG (Praezedenzfall im Repo): der bestehende elevenlabs:drift-Workflow laeuft bei push/pull_request und wird ohne hinterlegten Schluessel mit "::warning::" UEBERSPRUNGEN - genau das darf hier nicht passieren. Ein uebersprungener Waechter muss sichtbar sein, nicht still.
9. NUR-LESENDE ANBIETER-ABFRAGEN. Im Code, in den Tests und waehrend deiner Arbeit: NIEMALS POST/PATCH/PUT/DELETE gegen Telnyx oder ElevenLabs. Tests laufen ausschliesslich gegen Attrappen mit den echten Antwortformen aus dem Befund.
10. ZUSATZAUFTRAG A (Concern aus E3b, hiermit E4 zugewiesen): die Rueckgabe-Form der Sweep-Fabrik wird von KEINEM Test ausgefuehrt. Faellt ein Sweep-Zweig aus der Fabrik, bleibt die gesamte Suite gruen, waehrend der Tick in Produktion bei JEDEM Lauf synchron wirft (der Wurf liegt vor dem Promise, das catch faengt ihn nicht). E4 fuegt einen WEITEREN Zweig hinzu und verschaerft das. Baue einen Vertrags-Test, der die Fabrik-Rueckgabe gegen die erwarteten Methoden prueft, und weise per Gegenprobe nach, dass ein fehlender Zweig rot wird.
11. ZUSATZAUFTRAG B (Concern aus E3b): der HOLD-Eskalations-Befund nennt heute weder Anzahl noch Bezug ("eine Kuendigung wartet"). Ergaenze eine PII-FREIE Anzahl nach dem Muster der bestehenden Alarm-Zeile (fehler=/versuche=), damit der Empfaenger weiss, ob eine oder fuenf Kuendigungen haengen. KEINE Rufnummern, keine Tenant-Identitaeten.
12. ZUSATZAUFTRAG C (Doku, klein): in "${PLAN_DOC}" (a) die Abnahmetabelle der Etappe E3b auf die tatsaechlichen Testzahlen nachziehen (C5/C6/C8 nennen ueberholte Werte) und (b) unter "Bewusst akzeptierte Risiken" ergaenzen, dass die Erholungs-Meldung bei heutigem Anrufvolumen praktisch nie erscheint (RECOVERED verlangt Erfolge im selben Fenster) - gewollte Richtung ("zu laut ist erlaubt, stumm nie"), aber das Signal ist heute dekorativ.
13. Schritt 0 (Pflicht, VOR dem ersten Edit): npm run test:gates auf ${BASE} ausfuehren und die Zahl der roten Faelle festhalten. Erwartet: ${GATES_ROT_AUF_MASTER}. Nach der Umsetzung darf sie NICHT hoeher sein.
${BLOCKER_VERMEIDUNG}`;

const ABS_RULES = `ABSOLUTE REGELN (unantastbar, siehe CLAUDE.md):
- Safety-Gates NIE anfassen (Outbound-Permit, OUTBOUND_FROZEN, Denylist/Land-Gate/Stundenlimit, pro-Tenant-Kostendecke, Max-Gespraechsdauer, Telnyx-Signaturpruefung). Offenlegung/callee_is_owner NICHT beruehren. Auth fail-closed (route-policy + test/route-auth-inventory.test.js). Secrets nur via env, NIE loggen, NIE in eine Datei oder in einen Report schreiben. AUDIO NIEMALS durch MCP.
- KEINE echten Anrufe/SMS/Mails, KEINE Provider-SCHREIBzugriffe, KEIN Deploy, KEIN Nummernkauf.
- SCOPE: NUR Etappe E4 plus die drei Zusatzauftraege A/B/C. Die Absender-Wahrheit (E5) ist eine EIGENE Etappe - hier NICHT vorgreifen. Kein src/bridge.js.`;

// ---------- Phase 1: Plan (misst die Suite NICHT selbst - Straffung) ----------
phase("Plan");
const plan = await agent(
  `Du erstellst den DETAILLIERTEN, code-gegroundeten Umsetzungsplan fuer Phase ${PHASE} (${PHASE_TITLE}) im Repo "${REPO}". NUR PLANEN, NICHTS aendern.
WICHTIG ZUR EFFIZIENZ: den vollen Testlauf hat der Lead bereits gemessen (Anker ${TEST_FLOOR} pass / 0 fail auf ${BASE}, Gates ${GATES_ROT_AUF_MASTER}). Fahre ihn NICHT erneut - deine Zeit gehoert dem Code-Verstaendnis und dem Entwurf. Einzelne gezielte Testdateien darfst du selbstverstaendlich fahren.
1. Lies aus "${REPO}/${PLAN_DOC}" VOLLSTAENDIG: die Entwurfsentscheidung "E-6 (F4)", die Etappe "E4" samt Abnahmekatalog (zaehle die Abnahmepunkte ab!), Abschnitt 6, Abschnitt 7 (PM-16, PM-26) und Abschnitt 8. Dazu "${REPO}/${BEFUND_DOC}" - dort stehen die ECHTEN Anbieter-Antworten vom 27.08. (Telnyx-Nummernliste, verified_numbers leer, EL-Nummernregistrierung, ani_override), gegen die der Waechter anschlagen muss.
2. Lies "${REPO}/.claude/refs/clean-code.md".
3. Lies den ECHTEN Code auf Basis "${BASE}": src/telephony/outage-report.js und outage-detection.js (E3b - der bestehende Meldeweg und die Sweep-Zweige, die du benutzt statt zu duplizieren), src/boot.js + src/boot-guard.js (E1-Bindungsableitung, Boot-Befunde), die Sweep-Fabrik und runSweepTick (Zusatzauftrag A!), src/config.js, package.json (Skript-Konventionen fuer "npm run ..."), .github/workflows/ci.yml (der elevenlabs:drift-Praezedenzfall aus Lead-Entscheidung 8), die bestehenden Anbieter-Clients (nur-lesende Abfragen - selbst finden), test/helpers.js.
4. Miss NICHT die volle Suite; pruefe stattdessen gezielt, welche Bestandstests deine Aenderungen beruehren koennten.
${LEAD_DECISIONS}
${CLEAN_CODE_REQ}
${ABS_RULES}
DEINE WICHTIGSTEN VIER AUFGABEN:
(a) **Den Pruefsatz exakt festlegen:** welche nur-lesenden Abfragen zusammen BEWEISEN, dass unsere Absenderkonfiguration noch gueltig ist. Fuer jede: welcher Befund entsteht bei welcher Antwort, und was bedeutet ein Fehler/Timeout (-> unknown, gezaehlt, nie gruen). Leite das aus den ECHTEN Antworten im Befund ab, nicht aus Vermutungen.
(b) **Den 27.08.-Regressionsfang entwerfen:** die Fixture ist der belegte Zustand (ANI gesetzt, aber in der Kontoliste nicht enthalten) -> der Waechter MUSS "Eigentum verloren" melden. Dazu die Positiv-Kontrolle (alles stimmt -> LEERE Befundliste) und der unknown-Fall.
(c) **Takt, Single-Flight und externer Workflow:** wo genau haengt der Boot-Lauf, wo der Stundentakt; wie verhindert der Single-Flight den Deploy-Sturm; wie sieht der GitHub-Actions-Workflow aus, und wie wird ein UEBERSPRUNGENER Lauf sichtbar statt still (Lead-Entscheidung 8).
(d) **Die Zusatzauftraege A/B/C konkret einplanen** (Fabrik-Vertrags-Test mit Gegenprobe, PII-freie Anzahl im HOLD-Befund, die zwei Doku-Nachzuege).
LIEFERE: exakte Edits je Datei (Vorher/Nachher), die Befundklassen-Tabelle, neue Tests, je Abnahmepunkt Kommando + erwartete Ausgabe. Deine Rueckgabe IST der Plan.`,
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
    regressionsfangProof: {
      type: "string",
      description: "AUSGEFUEHRT: die echte 27.08.-Anbieterlage (ANI nicht mehr in der Kontoliste) ergibt den Eigentums-Befund - OHNE dass ein Anruf stattfindet. Kommando + Ausgabe",
    },
    positivKontrollProof: {
      type: "string",
      description: "AUSGEFUEHRT: gesunde Anbieterlage -> LEERE Befundliste (der Waechter meldet nicht alles). Kommando + Ausgabe",
    },
    unknownGezaehltProof: {
      type: "string",
      description: "AUSGEFUEHRT: fehlende Konfiguration/Anbieterfehler/Timeout -> eigener gezaehlter unknown-Befund, NIE gruen. Kommando + Ausgabe",
    },
    taktProof: {
      type: "string",
      description: "AUSGEFUEHRT: Lauf beim Boot und im Stundentakt; KEIN Lauf vor dem Waehlen; Single-Flight verhindert Parallel-Sturm. Kommando + Ausgabe",
    },
    meldewegWiederverwendetProof: {
      type: "string",
      description: "AUSGEFUEHRT: der Befund geht ueber den BESTEHENDEN E3b-Meldeweg; kein zweiter Kanal, keine zweite Entprellung. Kommando + Ausgabe",
    },
    keinAutoAbschaltenProof: {
      type: "string",
      description: "AUSGEFUEHRT: ein roter Befund schaltet das Produkt NICHT ab; das Gate ist per Default AUS. Kommando + Ausgabe",
    },
    externerTaktProof: {
      type: "string",
      description: "Der GitHub-Actions-Workflow existiert, laeuft nach Zeitplan, und ein uebersprungener Lauf ist SICHTBAR (nicht still). Datei + Inhalt + Begruendung",
    },
    fabrikVertragProof: {
      type: "string",
      description: "ZUSATZAUFTRAG A AUSGEFUEHRT: Vertrags-Test der Sweep-Fabrik; Gegenprobe (Zweig entfernt) macht ihn ROT, danach wiederhergestellt. Woertlich",
    },
    holdBezugProof: { type: "string", description: "ZUSATZAUFTRAG B AUSGEFUEHRT: PII-freie Anzahl im HOLD-Befund. Kommando + Ausgabe" },
    dokuNachzugProof: { type: "string", description: "ZUSATZAUFTRAG C: die zwei Nachzuege im Plan-Dokument. Woertlich" },
    nurLesendProof: {
      type: "string",
      description: "Beleg, dass Code UND Tests ausschliesslich lesende Anbieter-Abfragen machen (grep ueber Methoden). Woertlich",
    },
    failClosedProof: { type: "string", description: "AUSGEFUEHRTE Sabotage: Waechter entschaerft -> Test MUSS rot -> wiederhergestellt. Woertlich" },
    envProof: { type: "string", description: "Neue Env-Vars in config.js, .env.example, render.yaml, BASE_ENV; kein Bestands-Spawn-Test kippt. Woertlich" },
    gatesProof: { type: "string", description: `npm run test:gates: Vorher (${GATES_ROT_AUF_MASTER}) und Nachher. Woertlich` },
    lintProof: { type: "string", description: "npm run lint (VOLL, im Worktree) = 0 Fehler. Woertlich" },
    abnahmeProofs: { type: "string", description: "JEDER Abnahmepunkt der Etappe EINZELN, abgezaehlt: Kommando + Ausgabe" },
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
    "regressionsfangProof",
    "positivKontrollProof",
    "unknownGezaehltProof",
    "taktProof",
    "meldewegWiederverwendetProof",
    "keinAutoAbschaltenProof",
    "externerTaktProof",
    "fabrikVertragProof",
    "holdBezugProof",
    "dokuNachzugProof",
    "nurLesendProof",
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
3. Lies die Etappe E4 und die Entwurfsentscheidung E-6 in "${REPO}/${PLAN_DOC}" SELBST. Implementiere EXAKT gemaess Plan+Spec. ${CLEAN_CODE_REQ}
${LEAD_DECISIONS}
4. node --check auf JEDE geaenderte .js-Datei.
5. ${TEST_CMD} - pass MUSS >= ${TEST_FLOOR} sein und fail == 0. DAZU npm run lint = 0 Fehler (VOLL, im Worktree) UND npm run test:gates nicht roeter als ${GATES_ROT_AUF_MASTER}.
6. **DREIZEHN BEWEISE (alle Pflicht, alle AUSFUEHREN):** regressionsfangProof, positivKontrollProof, unknownGezaehltProof, taktProof, meldewegWiederverwendetProof, keinAutoAbschaltenProof, externerTaktProof, fabrikVertragProof, holdBezugProof, dokuNachzugProof, nurLesendProof, failClosedProof, envProof - Kommando+Ausgabe woertlich. Dazu gatesProof und lintProof.
7. JEDEN Abnahmepunkt der Etappe einzeln abarbeiten (abzaehlen!); Kommando+Ausgabe nach abnahmeProofs.
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
    erkenntOhneVerkehr: {
      type: "boolean",
      description: "SELBST gefahren: der 27.08.-Zustand wird erkannt, OHNE dass ein Anruf stattfindet. Das ist der Kern - tut er es nicht, ist die Etappe wertlos = BLOCKER",
    },
    positivKontrolleGesehen: { type: "boolean", description: "SELBST gefahren: gesunde Lage -> LEERE Befundliste" },
    unknownNieGruen: { type: "boolean", description: "SELBST gefahren: Anbieterfehler/fehlende Konfiguration -> gezaehlter unknown-Befund, nie stilles Gruen" },
    taktKorrekt: { type: "boolean", description: "SELBST geprueft: Boot + Stundentakt, KEIN Lauf vor dem Waehlen, Single-Flight wirksam" },
    keinZweiterMeldeweg: { type: "boolean", description: "SELBST gegrept: der bestehende E3b-Meldeweg wird benutzt, nicht dupliziert" },
    keinAutoAbschalten: { type: "boolean", description: "SELBST geprueft: ein roter Befund schaltet den Outbound NICHT ab; Gate-Default AUS" },
    externerTaktSichtbar: { type: "boolean", description: "SELBST geprueft: geplanter Workflow existiert; ein uebersprungener Lauf ist sichtbar, nicht still" },
    fabrikVertragWirksam: {
      type: "boolean",
      description: "ZUSATZAUFTRAG A: SELBST einen Sweep-Zweig aus der Fabrik entfernt -> Test MUSS rot werden. Bleibt die Suite gruen = BLOCKER",
    },
    holdBezugVorhanden: { type: "boolean", description: "ZUSATZAUFTRAG B: SELBST geprueft, Anzahl im Befund, weiterhin PII-frei" },
    nurLesend: { type: "boolean", description: "SELBST gegrept: kein POST/PATCH/PUT/DELETE gegen Anbieter, weder im Code noch in Tests" },
    piiDicht: { type: "boolean", description: "SELBST geprueft: keine Rufnummern/Schluessel in Befund, Log, Report oder Workflow-Datei" },
    sabotageSelbstRotGesehen: { type: "boolean", description: "SELBST ausgefuehrt: Waechter entschaerft -> Test rot -> wiederhergestellt" },
    alleAbnahmepunkteAbgehakt: {
      type: "boolean",
      description: "SELBST abgezaehlt gegen den Plan: KEIN Abnahmepunkt fehlt (in E3b fehlte einer unbemerkt). Fehlender Punkt ohne deklarierte Abweichung = BLOCKER",
    },
    envVollstaendig: { type: "boolean" },
    gatesNotWorse: { type: "boolean", description: `auf dem Branch gemessen gegen den gepinnten master-Stand: ${GATES_ROT_AUF_MASTER}` },
    fullLintZeroErrors: { type: "boolean" },
    routeAuthIntact: { type: "boolean" },
    safetyGatesIntact: { type: "boolean" },
    noSecretsLeaked: { type: "boolean" },
    scopeRespected: { type: "boolean", description: "kein bridge.js; kein Vorgriff auf E5; E1-E3b unangetastet" },
    approved: { type: "boolean" },
    blockers: { type: "array", items: { type: "string" } },
    concerns: { type: "array", items: { type: "string" } },
    verdict: { type: "string" },
  },
  required: [
    "approved",
    "testsPassIndependently",
    "testCountNotShrunk",
    "erkenntOhneVerkehr",
    "positivKontrolleGesehen",
    "unknownNieGruen",
    "taktKorrekt",
    "keinZweiterMeldeweg",
    "keinAutoAbschalten",
    "externerTaktSichtbar",
    "fabrikVertragWirksam",
    "holdBezugVorhanden",
    "nurLesend",
    "piiDicht",
    "sabotageSelbstRotGesehen",
    "alleAbnahmepunkteAbgehakt",
    "envVollstaendig",
    "gatesNotWorse",
    "fullLintZeroErrors",
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
        `STRENGER, adversarialer Safety-/Abnahme-Reviewer in frischem Worktree. Pruefe Phase ${PHASE} auf Branch "${target}". Diese Etappe ist der einzige Mechanismus, der einen Konfigurations-Ausfall bemerkt, OHNE dass ein Kunde darueber stolpert. Ein Waechter, der den 27.08.-Zustand nicht erkennt, der bei gesunder Lage Alarm schlaegt, der bei Anbieterfehler still gruen meldet oder der das Produkt abschaltet, bricht das Kernversprechen. Im Zweifel blockieren.
1. ln -s "${NODE_MODULES}" node_modules
2. git checkout -b review-outbound-e4${suffix} ${target}
3. ${TEST_CMD} SELBST (pass >= ${TEST_FLOOR}, fail 0; NIE zwei Suiten gleichzeitig). npm run lint SELBST (VOLL) = 0 Fehler. npm run test:gates auf ${target} - der master-Stand ist gepinnt (${GATES_ROT_AUF_MASTER}), den musst du NICHT neu messen.
4. Lies die Etappe E4 + Entwurfsentscheidung E-6 + Pre-Mortem (PM-16, PM-26) in "${REPO}/${PLAN_DOC}" und "${REPO}/${BEFUND_DOC}".
5. JEDEN Abnahmepunkt EINZELN selbst fahren; keine Impl-Behauptung uebernehmen:
   - **erkenntOhneVerkehr:** die ECHTE Anbieterlage aus dem Befund selbst einspielen, OHNE einen Anruf zu erzeugen.
   - **positivKontrolleGesehen** und **unknownNieGruen** mit eigenen Fixtures.
   - **fabrikVertragWirksam:** SELBST einen Sweep-Zweig aus der Fabrik entfernen. Bleibt die Suite gruen -> BLOCKER.
   - **alleAbnahmepunkteAbgehakt:** die Abnahmepunkte der Etappe im Plan ABZAEHLEN und einzeln gegen den Branch pruefen. In E3b fehlte ein kompletter Punkt unbemerkt - such gezielt danach.
   - **nurLesend** und **piiDicht** per eigenem grep, inklusive der neuen Workflow-Datei.
6. git diff ${BASE}..${target} durchsehen: kein Safety-Gate beruehrt, kein Provider-Schreibzugriff, kein Auto-Abschalten, kein Vorgriff auf E5.
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
 - **Single Source of Truth:** EINE Pruefstelle als reine Funktion, getrennt vom Datenholen; KEIN zweiter Meldeweg neben E3b; keine zweite Befundklassen-Tabelle.
 - **Fail-closed ohne Selbstschaden:** unknown ist gezaehlt; ein roter Befund schaltet nichts ab.
 - **Magic Numbers:** Intervalle, Fristen, Schwellen als benannte Konstanten/Env-Werte.
 - **Suppression-Tabu:** nur Diff-eigene Dateien; gepinnte Altlast-Werte nicht angehoben; volles Lint 0 Fehler; sonst S1.
 - **P11/T-Serie:** AUSGEFUEHRTE Gegenproben, sonst S1; Positiv- UND Negativ-Kontrolle; Fixtures nicht auf Grenzwerten; Erwartungen aus dem Fixture abgeleitet.
 - Funktionslaenge (<=100), Verschachtelung (<=4), Argumente (<=3); Kommentare deutsch OHNE Umlaute.
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
4. node --check + ${TEST_CMD} gruen, pass >= ${TEST_FLOOR}, npm run lint (VOLL) 0 Fehler, test:gates nicht roeter. node_modules NICHT committen. git add (Dateien einzeln) && git commit -m "fix(outbound-e4): Review-Blocker beheben (Runde ${round})". headCommit = git rev-parse HEAD.
EHRLICH: was du NICHT loesen konntest, in summary nennen.`,
    {
      label: `${PHASE}-fix-r${round}`,
      phase: "Self-Fix",
      schema: FIX_SCHEMA,
      isolation: "worktree",
      ...FIX_AGENT,
    },
  );
  fixSummaries.push(`r${round}: ${fix && fix.summary ? fix.summary.slice(0, 300) : "(kein Ergebnis)"}`);
  if (!fix || !fix.committed || !fix.headCommit) {
    fixSummaries.push(`r${round}: ABBRUCH - kein Commit vom Fix-Agenten.`);
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
Inhalt (Markdown, deutsch OHNE Umlaute): Phase ${PHASE} ${PHASE_TITLE}; Gate=${approved ? "PASS" : "BLOCKED"}; finalBranch=${reviewTarget}; der vollstaendige Pruefsatz (welche Abfrage belegt was, welcher Befund bei welcher Antwort); der 27.08.-Regressionsfang; Takt/Single-Flight/externer Workflow; was bei Rot passiert (und was ausdruecklich NICHT); die Abnahmepunkte einzeln mit Urteil+Kommando; die ausgefuehrten Gegenproben woertlich; die drei Zusatzauftraege A/B/C; Impl-Zusammenfassung + deviations; Safety-Urteil; Clean-Code-Audit; Fix-Runden; die OWNER-AKTIONEN (Secrets fuer den externen Workflow, Env-Werte). KEINE Schluessel, keine echten Kundenrufnummern. Quelle:
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
  erkenntOhneVerkehr: (safety && safety.erkenntOhneVerkehr) || false,
  positivKontrolleGesehen: (safety && safety.positivKontrolleGesehen) || false,
  unknownNieGruen: (safety && safety.unknownNieGruen) || false,
  taktKorrekt: (safety && safety.taktKorrekt) || false,
  keinZweiterMeldeweg: (safety && safety.keinZweiterMeldeweg) || false,
  keinAutoAbschalten: (safety && safety.keinAutoAbschalten) || false,
  externerTaktSichtbar: (safety && safety.externerTaktSichtbar) || false,
  fabrikVertragWirksam: (safety && safety.fabrikVertragWirksam) || false,
  alleAbnahmepunkteAbgehakt: (safety && safety.alleAbnahmepunkteAbgehakt) || false,
  nurLesend: (safety && safety.nurLesend) || false,
  piiDicht: (safety && safety.piiDicht) || false,
  gatesNotWorse: (safety && safety.gatesNotWorse) || false,
  fullLintZeroErrors: (safety && safety.fullLintZeroErrors) || false,
  safetyGatesIntact: (safety && safety.safetyGatesIntact) || false,
  blockers: blockerList(safety, cc),
  concerns: (safety && safety.concerns) || [],
  fixRounds: round,
  reportPath,
  safetyVerdict: (safety && safety.verdict) || "",
  ccVerdict: (cc && cc.verdict) || "",
  deviations: (impl && impl.deviations) || [],
  summary: (impl && impl.summary) || "",
};
