// SCHLANKES, SELBST-FIXENDES Phasen-Workflow (Lead bleibt duenn).
// Vorlage: outbound-e4.js. Phase HART GEPINNT auf OUTBOUND-E5.
// NEU GESCHNITTEN gegenueber PLAN-OUTBOUND-RESILIENZ.md (Owner-Anordnung 29.08.): die Etappe
// behebt die REGRESSION (Outbound sendet nicht mehr die Tenant-DID), nicht nur die Buchfuehrung.

export const meta = {
  name: "phase-impl-lean-outbound-e5",
  description:
    "OUTBOUND-E5 (F3, neu geschnitten): der ausgehende Anruf geht wieder mit der DID des anrufenden Tenants raus - je DID eine ElevenLabs-Registrierung, ID am number-Datensatz, Auswahl pro Anruf - und der Store schreibt die TATSAECHLICH gesendete Nummer. Plan -> Impl (Worktree) -> dualer Review -> Self-Fix -> Report.",
  phases: [
    { title: "Plan", detail: "Umsetzung code-gegroundet planen (Regression aus dem EL-Umstieg)", model: "opus" },
    { title: "Implementieren", detail: "Umsetzung im Worktree, npm test gruen, eslint . 0 Fehler", model: "sonnet" },
    { title: "Review", detail: "Safety/Abnahme + Clean-Code-Auditor (parallel, beide Opus)", model: "opus" },
    { title: "Self-Fix", detail: "S1/S2/Safety-Blocker fixen + Re-Review, bis PASS", model: "sonnet" },
    { title: "Report", detail: "Detailbericht in tasks/outbound-e5-report.md (Lead liest ihn nicht)", model: "sonnet" },
  ],
};

const REPO = "/Users/antonio/Mein Unternehmen/MCP/vodafone-agent";
const NODE_MODULES = `${REPO}/node_modules`;

const RUN = {
  phaseId: "OUTBOUND-E5",
  phaseTitle:
    "F3: der Outbound sendet wieder die DID des anrufenden Tenants (je DID eine EL-Registrierung) und der Store schreibt die tatsaechlich gesendete Nummer",
  branch: "phase/outbound-e5-absender-did",
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
const REPORT_PATH = "tasks/outbound-e5-report.md";

const PLAN_AGENT = { model: "opus", effort: "xhigh" };
const IMPL_AGENT = { model: "sonnet", effort: "high" };
const SAFETY_AGENT = { model: "opus", effort: "xhigh" };
const CLEANCODE_AGENT = { model: "opus", effort: "high" };
const FIX_AGENT = { model: "sonnet", effort: "medium" };
const REPORT_AGENT = { model: "sonnet", effort: "low" };

// Vom Lead auf master (a9deb74) SELBST gemessen - NICHT neu messen lassen:
const TEST_CMD = `LLM_PROVIDER=anthropic npm test`;
const TEST_FLOOR = 5361;
const GATES_ROT_AUF_MASTER = "3 rote Faelle (GAP-05, GAP-15, E2E-03)";

const BLOCKER_VERMEIDUNG = `BLOCKER-VERMEIDUNGSLISTE (aus 23 Fix-Runden der Etappen E1-E4 - das sind die Fehler, die JEDES MAL eine teure Extra-Runde ausgeloest haben):
1. GEGENPROBEN AUSFUEHREN, nicht behaupten. Sabotage wirklich fahren, rotes Ergebnis woertlich zitieren, zurueckbauen, "git status --porcelain" leer nachweisen.
2. POSITIV-KONTROLLE IMMER mitliefern. Zu jedem "erkennt den Defekt"-Test gehoert ein "verhaelt sich im gesunden Fall unveraendert"-Test.
3. ATTRAPPEN MUESSEN IHR ARGUMENT PRUEFEN. Eine Attrappe, die stur "true" zurueckgibt und ihr Argument ignoriert, beweist NICHTS darueber, WELCHER Wert uebergeben wurde - genau daran ist in E4 ein Blocker vier Runden lang unentdeckt geblieben. Wo es auf einen konkreten Wert ankommt, pinnt der Test ihn BYTE-GENAU.
4. KEIN STILLES GRUEN. Fehlt eine Konfiguration oder eine Anbieter-Angabe, ist das ein eigener, GEZAEHLTER unknown-Befund - nie ein "alles in Ordnung". Zweimal war das in E4 ein Blocker.
5. GEPINNTE ALTLAST-WERTE NICHT ANHEBEN (eslint-legacy-exceptions.json). Loesung so bauen, dass der Pin haelt.
6. ABNAHMEPUNKTE ABZAEHLEN und einzeln abhaken. In E3b fehlte ein kompletter Punkt unbemerkt.
7. KEINE ZWEI TESTLAEUFE GLEICHZEITIG, keine Dateiaenderung waehrend eines Laufs.
8. FIXTURES NICHT AUF GRENZWERTE legen; Erwartungen aus dem Fixture ABLEITEN.
9. NEUE ENV-VARIABLEN vollstaendig: src/config.js + .env.example + render.yaml + test/helpers.js BASE_ENV; pruefen, ob ein neuer Boot-Guard Bestands-Spawn-Tests kippt.
10. DOKU AN DEN CODE ANGLEICHEN, nicht umgekehrt - und wenn die Etappe eine Zusicherung in PLAN-SECURITY.md/Runbook aendert, wird sie DORT nachgezogen (E4-Blocker 2).`;

const LINT_REGEL = `LINT-PFLICHT: npm run lint (eslint ., VOLL, im Worktree) MUSS "0 errors" melden. Suppressions nur fuer Diff-eigene Dateien.`;

const CLEAN_CODE_REQ = `CLEAN-CODE (PFLICHT): Lies "${REPO}/.claude/refs/clean-code.md" und befolge ihn bei JEDER Entscheidung. Fuer diese Phase besonders: EINE Stelle beantwortet "welche Absendernummer und welche Anbieter-Registrierung gehoeren zu diesem Anruf?"; die Auswahl ist eine reine Funktion (Eingabe: Tenant/Nummer-Datensatz, Ausgabe: Registrierungs-ID + E.164) ohne Netzzugriff; das Anlegen der Registrierung ist davon getrennt. Kein zweiter Absender-Pfad neben dem Bestand. Kommentare deutsch OHNE Umlaute. ${LINT_REGEL}`;

const LEAD_DECISIONS = `BINDENDE LEAD-ENTSCHEIDUNGEN - nicht neu aufrollen, nicht umdeuten:
1. DIE ETAPPE IST NEU GESCHNITTEN (Owner-Anordnung 29.08.2026). "${PLAN_DOC}" fuehrt unter "E5" nur die BUCHFUEHRUNG (from_actual_e164 aus Messung). Das reicht nicht: der Owner hat festgestellt, dass hier eine REGRESSION vorliegt, keine Ungenauigkeit. Umzusetzen ist der Zielzustand, den das Plan-Dokument in Abschnitt 4 selbst nennt: "je Tenant eigene, rueckrufbare DID; auf dem EL-Weg je DID eine Registrierung, ani_override_type nicht mehr always".
2. DER BELEG DER REGRESSION (selbst nachpruefen, dann bauen):
   - Bis 12.08.2026 lief JEDER Outbound ueber Telnyx mit der DID des Tenants:
     src/routes/api-calls.js "originateCall({ from: ctx.fromNumber, ... })" und
     "originateAiAssistantCall({ fromNumber: ctx.fromNumber, ... })".
   - Seit 19.08.2026 laeuft alles ueber ElevenLabs; src/elevenlabs/outbound.js#startCallBody
     uebergibt NUR agent_id/agent_phone_number_id/to_number - die Absendernummer haengt an EINER
     global registrierten Nummer, nicht am Anruf.
   - Messbar in der Prod-DB: gespeichert from_e164 = die Tenant-DID, tatsaechlich gesendet die
     globale Nummer (s. "${BEFUND_DOC}", Abschnitt 3/F3 und Abschnitt 5).
   Folge fuer den Kunden: der Angerufene sieht eine fremde Nummer; ruft er zurueck, landet er ueber
   store.numberRecordByE164(to) beim BESITZER dieser Nummer - nicht beim anrufenden Tenant. Bei
   einem echten Kunden waere das ein Datenschutz-Vorfall.
3. ZIELVERHALTEN: der ausgehende Anruf traegt die DID des ANRUFENDEN Tenants als Absender - auf
   ALLEN Wegen (EL-Pfad wie Telnyx-Pfade). Der Telnyx-Pfad tut das bereits; er ist die Referenz,
   nicht der Umbaugegenstand.
4. WEG AUF DEM EL-PFAD: je Tenant-DID eine eigene ElevenLabs-Nummernregistrierung
   (POST /v1/convai/phone-numbers, SIP-Trunk auf denselben Telnyx-Trunk), deren Kennung am
   number-Datensatz gespeichert wird; beim Anruf waehlt der Server die Kennung des anrufenden
   Tenants. Die globale Env ELEVENLABS_AGENT_PHONE_NUMBER_ID bleibt als Rueckfall fuer Tenants
   OHNE eigene Registrierung bestehen (Bestandsschutz) - aber der Rueckfall ist LAUT: er wird
   gezaehlt und ist am Anruf-Datensatz erkennbar, nie stilles Verhalten (E4-Lehre 4).
5. PROVIDER-SCHREIBZUGRIFF IM PRODUKTIVCODE (neu, sorgfaeltig gaten): das ANLEGEN einer
   Registrierung ist ein Schreibzugriff beim Anbieter. Er gehoert an dieselbe Stelle und hinter
   dasselbe Schalter-Muster wie der bestehende Nummernkauf im Provisioning (selbst finden:
   PROVISIONING_ENABLED / src/worker/provisioning.js). Idempotent: zweimal aufgerufen entsteht
   KEINE zweite Registrierung. Fehlschlag darf die Nummern-Provisionierung NICHT zerreissen -
   die DID bleibt nutzbar, die Registrierung wird nachholbar.
   IN DIESEM WORKFLOW WIRD KEIN EINZIGER ECHTER SCHREIBZUGRIFF AUSGEFUEHRT. Tests laufen
   ausschliesslich gegen Attrappen/lokale Stubs.
6. BESTANDS-DIDs: fuer die bereits existierenden Nummern braucht es einen nachholbaren Weg
   (Backfill/Reparaturlauf), KEIN automatisches Massen-Anlegen beim Boot. Additiv-nullable Feld
   heisst IMMER: Backfill-Plan benennen (Repo-Lehre).
7. DER TELNYX-OVERRIDE IST DER SCHARFSCHALTER, UND ER IST OWNER-AKTION: solange
   "ani_override_type: always" auf der Trunk-Connection steht, ueberschreibt Telnyx JEDE
   gesendete From-Nummer mit der einen. Der Code muss deshalb VOR dem Cutover korrekt und
   folgenlos sein und NACH dem Cutover ohne Code-Aenderung wirken. Beschreibe den Cutover im
   Report exakt (Endpunkt, Feld, Rueckbau), fuehre ihn NICHT aus.
8. BUCHFUEHRUNG (der urspruengliche E5-Auftrag, bleibt Teil der Etappe): der Store schreibt die
   TATSAECHLICH gesendete Nummer. Solange sie nicht belegbar ist, wird sie ehrlich als unbekannt
   gefuehrt - nie geraten. from_e164 (die Soll-Nummer) bleibt unveraendert, damit Routing und
   Kostenpfade nicht brechen.
9. DRIFT-AUSNAHME NACHZIEHEN: "outbound-drift-ausnahmen.json" traegt seit dem 29.08. den Eintrag
   "config_ani_mismatch" mit dem ausdruecklichen Vermerk, dass er zu ENTFERNEN ist, sobald diese
   Etappe je DID eine eigene Registrierung anlegt. Entscheide begruendet, ob er mit dieser Etappe
   faellt oder erst mit dem Owner-Cutover (Punkt 7) - und schreibe die Entscheidung in den Eintrag
   bzw. entferne ihn. Ein Eintrag, der stillschweigend stehen bleibt, ist ein Blocker.
10. SICHERHEIT: eine Registrierung darf NIE einer fremden Tenant-DID zugeordnet werden. Die
   Zuordnung ist tenant-isoliert zu pruefen (RLS-Gotcha beachten). Ein Tenant darf ueber keinen
   Weg die Registrierung eines anderen benutzen - dazu ein ausdruecklicher Test.
11. Schritt 0 (Pflicht, VOR dem ersten Edit): npm run test:gates auf ${BASE} ausfuehren; erwartet
   ${GATES_ROT_AUF_MASTER}. Nach der Umsetzung nicht hoeher.
${BLOCKER_VERMEIDUNG}`;

const ABS_RULES = `ABSOLUTE REGELN (unantastbar, siehe CLAUDE.md):
- Safety-Gates NIE anfassen (Outbound-Permit, OUTBOUND_FROZEN, Denylist/Land-Gate/Stundenlimit, pro-Tenant-Kostendecke, Max-Gespraechsdauer, Telnyx-Signaturpruefung). Offenlegung/callee_is_owner NICHT beruehren - insbesondere bleibt das callee_is_owner-Praedikat unveraendert, auch wenn sich die Absendernummer aendert. Auth fail-closed. Secrets nur via env, nie loggen. AUDIO NIEMALS durch MCP.
- KEINE echten Anrufe/SMS/Mails, KEINE Provider-SCHREIBzugriffe (auch keine EL-Registrierung!), KEIN Deploy, KEIN Nummernkauf. Alles gegen Attrappen.
- SCOPE: NUR Etappe E5 in dem oben geschnittenen Umfang. Kein src/bridge.js. Der Drift-Waechter (E4) wird BENUTZT und hoechstens um den in Punkt 9 genannten Eintrag angepasst, nicht umgebaut.`;

// ---------- Phase 1: Plan ----------
phase("Plan");
const plan = await agent(
  `Du erstellst den DETAILLIERTEN, code-gegroundeten Umsetzungsplan fuer Phase ${PHASE} (${PHASE_TITLE}) im Repo "${REPO}". NUR PLANEN, NICHTS aendern.
WICHTIG ZUR EFFIZIENZ: den vollen Testlauf hat der Lead gemessen (${TEST_FLOOR} pass / 0 fail auf ${BASE}, Gates ${GATES_ROT_AUF_MASTER}). Fahre ihn NICHT erneut.
1. Lies "${REPO}/${BEFUND_DOC}" VOLLSTAENDIG (Abschnitt 3/F3 und Abschnitt 5 belegen die Regression) und in "${REPO}/${PLAN_DOC}" den Abschnitt 4 (Zielmodell), die Etappe "E5" und die Entwurfsentscheidung "E-5".
2. Lies "${REPO}/.claude/refs/clean-code.md".
3. Lies den ECHTEN Code auf Basis "${BASE}": src/routes/api-calls.js (die drei Engine-Zweige und ctx.fromNumber - wo kommt er her?), src/routes/_tenant.js bzw. der resolve_outbound-Pfad, src/elevenlabs/outbound.js (startCallBody, originateCall), src/elevenlabs/convai.js (der Anbieter-Client - welche Endpunkte gibt es schon?), src/worker/provisioning.js + src/queue/* (wo Nummern entstehen, wie gegated), src/store/state-ops.js + pg.js + json.js + src/db/schema.sql (wie ein additives Feld an number sauber dazukommt, RLS!), src/telephony/outbound-config-drift.js (E4 - was der Waechter heute prueft), outbound-drift-ausnahmen.json.
4. LESENDE Anbieter-Klaerung (KEINE Schreibzugriffe): kann eine ElevenLabs-SIP-Nummernregistrierung mehrfach auf DENSELBEN Telnyx-Trunk zeigen (mehrere phone_numbers, ein outbound_trunk)? Welche Felder verlangt POST /v1/convai/phone-numbers fuer provider=sip_trunk? Gibt es Limits oder Kosten? Nutze GET-Abfragen (Schluessel aus "${REPO}/.env", NIE ausgeben) und die offizielle Doku (WebFetch/WebSearch). Sage klar, was BELEGT ist und was nicht - auf einer unbelegten Annahme darf der Etappenschnitt nicht stehen.
${LEAD_DECISIONS}
${CLEAN_CODE_REQ}
${ABS_RULES}
DEINE WICHTIGSTEN VIER AUFGABEN:
(a) **Die Absenderkette lueckenlos kartieren:** von der Tenant-DID bis zu dem, was der Angerufene sieht - je Engine-Zweig. Wo genau wird heute welche Nummer gesetzt/ueberschrieben (auch der Telnyx-ani_override gehoert in die Kette). Daraus ergibt sich, welche Stelle die Etappe wirklich aendern muss.
(b) **Den Registrierungs-Lebenszyklus entwerfen:** anlegen (idempotent, gegated, fehlertolerant), speichern (Feld an number, beide Backends, Backfill fuer Bestands-DIDs), auswaehlen (reine Funktion), zurueckgeben/aufraeumen wenn eine DID freigegeben wird - und wie das mit dem E1-Freigabe-Riegel zusammenspielt.
(c) **Den Rueckfall entwerfen:** was passiert, wenn ein Tenant (noch) keine eigene Registrierung hat. Bestandsschutz ja, aber LAUT und am Datensatz erkennbar.
(d) **Die Testfaelle einzeln entwerfen:** Tenant MIT eigener Registrierung -> seine DID geht raus (byte-genau gepinnt, keine argument-ignorierende Attrappe!); Tenant OHNE -> Rueckfall, gezaehlt und sichtbar; fremde Registrierung ist NICHT erreichbar (Tenant-Isolation); Anlegen ist idempotent; Anbieter-Fehler beim Anlegen zerreisst die Provisionierung nicht; from_actual_e164 wird nur bei Beleg geschrieben, sonst ehrlich unbekannt; Bestandsverhalten der Telnyx-Zweige byte-identisch; Sabotage-Gegenprobe.
LIEFERE: exakte Edits je Datei (Vorher/Nachher), Migrations-/DDL-Text + Backfill-Plan, neue Tests, je Abnahmepunkt Kommando + erwartete Ausgabe, und den exakten Owner-Cutover (Telnyx-Endpunkt/Feld/Rueckbau). Deine Rueckgabe IST der Plan.`,
  { label: `${PHASE}-plan`, phase: "Plan", ...PLAN_AGENT },
);

// ---------- Phase 2: Implementieren ----------
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
    eigeneDidProof: {
      type: "string",
      description: "AUSGEFUEHRT: Tenant MIT eigener Registrierung -> SEINE DID wird als Absender uebergeben, byte-genau gepinnt (Attrappe prueft ihr Argument!). Kommando + Ausgabe",
    },
    rueckfallLautProof: {
      type: "string",
      description: "AUSGEFUEHRT: Tenant OHNE eigene Registrierung -> Rueckfall auf die globale Nummer, GEZAEHLT und am Datensatz erkennbar, nie still. Kommando + Ausgabe",
    },
    tenantIsolationProof: {
      type: "string",
      description: "AUSGEFUEHRT: kein Tenant kann die Registrierung eines anderen benutzen. Kommando + Ausgabe",
    },
    idempotenzProof: { type: "string", description: "AUSGEFUEHRT: zweimal anlegen -> KEINE zweite Registrierung. Kommando + Ausgabe" },
    fehlertoleranzProof: {
      type: "string",
      description: "AUSGEFUEHRT: Anbieter-Fehler beim Anlegen zerreisst die Nummern-Provisionierung nicht; die Registrierung bleibt nachholbar. Kommando + Ausgabe",
    },
    buchfuehrungProof: {
      type: "string",
      description: "AUSGEFUEHRT: die tatsaechlich gesendete Nummer wird geschrieben, wenn belegt - sonst ehrlich unbekannt, nie geraten. from_e164 unveraendert. Kommando + Ausgabe",
    },
    telnyxZweigeUnveraendertProof: {
      type: "string",
      description: "AUSGEFUEHRT: die beiden Telnyx-Zweige verhalten sich byte-identisch zum Bestand (sie waren nie kaputt). Kommando + Ausgabe",
    },
    backfillProof: { type: "string", description: "Backfill-Weg fuer Bestands-DIDs: Kommando, Idempotenz, kein Massen-Anlegen beim Boot. Woertlich" },
    driftAusnahmeProof: {
      type: "string",
      description: "Punkt 9: Entscheidung ueber den config_ani_mismatch-Eintrag getroffen und im Eintrag/Repo sichtbar gemacht. Woertlich",
    },
    keineSchreibzugriffeProof: {
      type: "string",
      description: "Beleg per grep, dass in Tests und Arbeit KEIN echter Anbieter-Schreibzugriff stattfand. Woertlich",
    },
    failClosedProof: { type: "string", description: "AUSGEFUEHRTE Sabotage: Auswahl entschaerft -> Test MUSS rot -> wiederhergestellt. Woertlich" },
    cutoverBeschreibung: { type: "string", description: "Der exakte Owner-Cutover bei Telnyx (Endpunkt, Feld, Rueckbau) - NICHT ausgefuehrt. Woertlich" },
    envProof: { type: "string", description: "Neue/geaenderte Env-Vars vollstaendig (config.js, .env.example, render.yaml, BASE_ENV). Woertlich" },
    gatesProof: { type: "string", description: `test:gates Vorher (${GATES_ROT_AUF_MASTER}) und Nachher. Woertlich` },
    lintProof: { type: "string", description: "npm run lint (VOLL, im Worktree) = 0 Fehler. Woertlich" },
    abnahmeProofs: { type: "string", description: "JEDER Abnahmepunkt EINZELN, abgezaehlt: Kommando + Ausgabe" },
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
    "eigeneDidProof",
    "rueckfallLautProof",
    "tenantIsolationProof",
    "idempotenzProof",
    "fehlertoleranzProof",
    "buchfuehrungProof",
    "telnyxZweigeUnveraendertProof",
    "backfillProof",
    "driftAusnahmeProof",
    "keineSchreibzugriffeProof",
    "failClosedProof",
    "cutoverBeschreibung",
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
3. Lies "${REPO}/${BEFUND_DOC}" (Abschnitt 3/F3, Abschnitt 5) SELBST. Implementiere EXAKT gemaess Plan. ${CLEAN_CODE_REQ}
${LEAD_DECISIONS}
4. node --check auf JEDE geaenderte .js-Datei.
5. ${TEST_CMD} - pass MUSS >= ${TEST_FLOOR} sein und fail == 0 (Einzel-Flake nur nach isolierter Wiederholung werten). DAZU npm run lint = 0 Fehler (VOLL) UND npm run test:gates nicht roeter als ${GATES_ROT_AUF_MASTER}.
6. **ZEHN BEWEISE (alle Pflicht, alle AUSFUEHREN):** eigeneDidProof, rueckfallLautProof, tenantIsolationProof, idempotenzProof, fehlertoleranzProof, buchfuehrungProof, telnyxZweigeUnveraendertProof, keineSchreibzugriffeProof, failClosedProof, backfillProof - Kommando+Ausgabe woertlich. Dazu driftAusnahmeProof, cutoverBeschreibung, envProof, gatesProof, lintProof.
7. JEDEN Abnahmepunkt einzeln abarbeiten (abzaehlen!); Kommando+Ausgabe nach abnahmeProofs.
8. node_modules NICHT committen. git add (Dateien EINZELN, nie -A) && git commit (Botschaft deutsch). headCommit = git rev-parse HEAD.
${ABS_RULES}
EHRLICH fuellen; Offenes offen nennen, nicht schoenen.`,
  { label: `${PHASE}-implement`, phase: "Implementieren", schema: IMPL_SCHEMA, isolation: "worktree", ...IMPL_AGENT },
);

// ---------- Phase 3: Dualer Review ----------
const SAFETY_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    testsPassIndependently: { type: "boolean" },
    independentTestSummary: { type: "string" },
    testCountNotShrunk: { type: "boolean", description: `pass >= ${TEST_FLOOR}, fail 0` },
    eigeneDidGehtRaus: {
      type: "boolean",
      description: "SELBST gefahren: die DID des anrufenden Tenants wird als Absender uebergeben, byte-genau. Eine argument-ignorierende Attrappe zaehlt NICHT als Beweis (E4-Blocker 2)",
    },
    rueckfallLaut: { type: "boolean", description: "SELBST gefahren: fehlende Registrierung -> gezaehlter, sichtbarer Rueckfall, nie stilles Verhalten" },
    tenantIsolationDicht: { type: "boolean", description: "SELBST gefahren: keine fremde Registrierung erreichbar" },
    idempotent: { type: "boolean", description: "SELBST gefahren: zweimal anlegen erzeugt keine zweite Registrierung" },
    fehlertolerant: { type: "boolean", description: "SELBST gefahren: Anbieter-Fehler zerreisst die Provisionierung nicht" },
    buchfuehrungEhrlich: { type: "boolean", description: "SELBST gefahren: gesendete Nummer nur bei Beleg, sonst unbekannt; from_e164 unveraendert" },
    telnyxZweigeUnveraendert: { type: "boolean", description: "SELBST geprueft: die beiden Telnyx-Zweige byte-identisch zum Bestand" },
    keineEchtenSchreibzugriffe: { type: "boolean", description: "SELBST gegrept: kein POST/PATCH/DELETE gegen Anbieter im Diff und in keinem Test" },
    backfillTragfaehig: { type: "boolean", description: "SELBST geprueft: Bestands-DIDs nachholbar, kein Massen-Anlegen beim Boot" },
    driftAusnahmeEntschieden: { type: "boolean", description: "Punkt 9: der config_ani_mismatch-Eintrag ist entfernt ODER mit begruendeter Frist versehen - nicht stillschweigend stehengeblieben" },
    sabotageSelbstRotGesehen: { type: "boolean" },
    alleAbnahmepunkteAbgehakt: { type: "boolean", description: "SELBST abgezaehlt gegen den Plan" },
    offenlegungUnberuehrt: { type: "boolean", description: "callee_is_owner und die Offenlegungs-Mechanik unveraendert, obwohl sich die Absendernummer aendert" },
    gatesNotWorse: { type: "boolean" },
    fullLintZeroErrors: { type: "boolean" },
    routeAuthIntact: { type: "boolean" },
    safetyGatesIntact: { type: "boolean" },
    noSecretsLeaked: { type: "boolean" },
    scopeRespected: { type: "boolean" },
    approved: { type: "boolean" },
    blockers: { type: "array", items: { type: "string" } },
    concerns: { type: "array", items: { type: "string" } },
    verdict: { type: "string" },
  },
  required: [
    "approved",
    "testsPassIndependently",
    "testCountNotShrunk",
    "eigeneDidGehtRaus",
    "rueckfallLaut",
    "tenantIsolationDicht",
    "idempotent",
    "fehlertolerant",
    "buchfuehrungEhrlich",
    "telnyxZweigeUnveraendert",
    "keineEchtenSchreibzugriffe",
    "backfillTragfaehig",
    "driftAusnahmeEntschieden",
    "sabotageSelbstRotGesehen",
    "alleAbnahmepunkteAbgehakt",
    "offenlegungUnberuehrt",
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
        `STRENGER, adversarialer Safety-/Abnahme-Reviewer in frischem Worktree. Pruefe Phase ${PHASE} auf Branch "${target}". Diese Etappe behebt eine REGRESSION: seit dem Umstieg auf ElevenLabs geht der Outbound nicht mehr mit der DID des Kunden raus. Ein Fix, der die falsche Nummer weiterhin sendet, der still auf die globale zurueckfaellt, der die Registrierung eines fremden Tenants erreichbar macht oder der die Telnyx-Zweige beschaedigt, bricht das Kernversprechen. Im Zweifel blockieren.
1. ln -s "${NODE_MODULES}" node_modules
2. git checkout -b review-outbound-e5${suffix} ${target}
3. ${TEST_CMD} SELBST (pass >= ${TEST_FLOOR}, fail 0; NIE zwei Suiten gleichzeitig). npm run lint SELBST (VOLL) = 0 Fehler. npm run test:gates auf ${target} (master-Stand gepinnt: ${GATES_ROT_AUF_MASTER}).
4. Lies "${REPO}/${BEFUND_DOC}" (Abschnitt 3/F3, Abschnitt 5) und Abschnitt 4 von "${REPO}/${PLAN_DOC}".
5. JEDEN Punkt EINZELN selbst fahren:
   - **eigeneDidGehtRaus:** pinne BYTE-GENAU, welche Nummer uebergeben wird. Prüfe, ob die Test-Attrappen ihr Argument wirklich auswerten - in E4 war genau das vier Runden lang der blinde Fleck.
   - **rueckfallLaut** und **tenantIsolationDicht** mit eigenen Fixtures.
   - **telnyxZweigeUnveraendert:** die beiden Telnyx-Zweige waren NIE kaputt; jede Aenderung dort ist begruendungspflichtig.
   - **keineEchtenSchreibzugriffe:** grep ueber Diff UND Tests.
   - **driftAusnahmeEntschieden:** steht der Eintrag noch unveraendert da, ist das ein Blocker.
6. git diff ${BASE}..${target}: kein Safety-Gate, keine Offenlegungs-/callee_is_owner-Aenderung, kein bridge.js, kein Provider-Schreibzugriff.
${LEAD_DECISIONS}
${ABS_RULES}
approved=true NUR wenn alle Punkte selbst gesehen. Rueckgabe IST das Urteil.`,
        { label: `${PHASE}-review-safety${suffix}`, phase: "Review", schema: SAFETY_SCHEMA, isolation: "worktree", ...SAFETY_AGENT },
      ),
    () =>
      agent(
        `CLEAN-CODE-AUDITOR. Pruefe den Diff der Phase ${PHASE} (Branch "${target}", Basis "${BASE}") streng gegen den Katalog.
1. Lies "${REPO}/.claude/refs/clean-code.md" VOLLSTAENDIG.
2. git diff ${BASE} ${target} ; neue Dateien per git show ${target}:<pfad>.
3. Kategorie fuer Kategorie. Pro FLAG: "ID · Datei · Verstoss · Fix" + Schweregrad. S3/S4 gebuendelt.
BESONDERS ACHTEN:
 - **Single Source of Truth:** EINE Stelle waehlt Absendernummer + Registrierung; kein zweiter Absender-Pfad; das Anlegen ist von der Auswahl getrennt.
 - **Kein stilles Gruen:** fehlende Registrierung ist ein gezaehlter, sichtbarer Zustand.
 - **Store-Fassade und RLS:** additives Feld sauber in beiden Backends, Backfill benannt, Tenant-Isolation erzwungen.
 - **Attrappen pruefen ihr Argument** (E4-Lehre); Tests pinnen den SOLL-Zustand.
 - **Suppression-Tabu**, Funktionslaenge, Verschachtelung, Magic Numbers, Kommentare deutsch OHNE Umlaute.
blocker=true wenn s1 ODER s2 nicht leer. Erfinde nichts.`,
        { label: `${PHASE}-review-cleancode${suffix}`, phase: "Review", schema: CC_SCHEMA, isolation: "worktree", ...CLEANCODE_AGENT },
      ),
  ]);
}

const gateOk = (sa, cca) => !!(sa && sa.approved && cca && !cca.blocker);
const blockerList = (sa, cca) => [...((sa && sa.blockers) || []), ...((cca && cca.s1) || []), ...((cca && cca.s2) || [])];

phase("Review");
let reviewTarget = BRANCH;
let [safety, cc] = await runReview(reviewTarget, "");

// ---------- Phase 4: Self-Fix ----------
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
  const fix = await agent(
    `Du behebst die REVIEW-BLOCKER der Phase ${PHASE} in einem frischen Worktree. NUR die Blocker, kein Scope-Drift.
1. ln -s "${NODE_MODULES}" node_modules
2. git checkout -b ${fixBranch} ${reviewTarget}
3. Behebe DIESE Blocker sauber und minimal; je korrektheits-/sicherheitsrelevantem Fix ein Regressionstest:
${JSON.stringify(blockerList(safety, cc), null, 1)}
${LEAD_DECISIONS}
${CLEAN_CODE_REQ}
${ABS_RULES}
4. node --check + ${TEST_CMD} gruen, pass >= ${TEST_FLOOR}, npm run lint (VOLL) 0 Fehler, test:gates nicht roeter. git add (Dateien einzeln) && git commit -m "fix(outbound-e5): Review-Blocker beheben (Runde ${round})". headCommit = git rev-parse HEAD.
EHRLICH: was du NICHT loesen konntest, in summary nennen.`,
    { label: `${PHASE}-fix-r${round}`, phase: "Self-Fix", schema: FIX_SCHEMA, isolation: "worktree", ...FIX_AGENT },
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
    `Schreibe einen Detailbericht der Phase ${PHASE} in "${REPO}/${REPORT_PATH}" (Haupt-Repo, NICHT im Worktree). NICHTS am Code aendern, KEIN git-Commit.
Inhalt (Markdown, deutsch OHNE Umlaute): Phase ${PHASE} ${PHASE_TITLE}; Gate=${approved ? "PASS" : "BLOCKED"}; finalBranch=${reviewTarget}; die vollstaendige Absenderkette je Engine-Zweig (vorher/nachher); der Registrierungs-Lebenszyklus inkl. Backfill; der Rueckfall und wie er sichtbar ist; die Tenant-Isolation; die Abnahmepunkte einzeln mit Urteil+Kommando; die ausgefuehrten Gegenproben woertlich; die Entscheidung zur Drift-Ausnahme; **der exakte Owner-Cutover bei Telnyx** (Endpunkt, Feld, Rueckbau, Reihenfolge); Impl-Zusammenfassung + deviations; Safety-Urteil; Clean-Code-Audit; Fix-Runden. KEINE Schluessel, keine Kundenrufnummern. Quelle:
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
  testPassCount: (impl && impl.testPassCount) || null,
  eigeneDidGehtRaus: (safety && safety.eigeneDidGehtRaus) || false,
  rueckfallLaut: (safety && safety.rueckfallLaut) || false,
  tenantIsolationDicht: (safety && safety.tenantIsolationDicht) || false,
  idempotent: (safety && safety.idempotent) || false,
  fehlertolerant: (safety && safety.fehlertolerant) || false,
  buchfuehrungEhrlich: (safety && safety.buchfuehrungEhrlich) || false,
  telnyxZweigeUnveraendert: (safety && safety.telnyxZweigeUnveraendert) || false,
  keineEchtenSchreibzugriffe: (safety && safety.keineEchtenSchreibzugriffe) || false,
  backfillTragfaehig: (safety && safety.backfillTragfaehig) || false,
  driftAusnahmeEntschieden: (safety && safety.driftAusnahmeEntschieden) || false,
  offenlegungUnberuehrt: (safety && safety.offenlegungUnberuehrt) || false,
  gatesNotWorse: (safety && safety.gatesNotWorse) || false,
  fullLintZeroErrors: (safety && safety.fullLintZeroErrors) || false,
  safetyGatesIntact: (safety && safety.safetyGatesIntact) || false,
  cutoverBeschreibung: (impl && impl.cutoverBeschreibung) || "",
  blockers: blockerList(safety, cc),
  concerns: (safety && safety.concerns) || [],
  fixRounds: round,
  reportPath,
  safetyVerdict: (safety && safety.verdict) || "",
  ccVerdict: (cc && cc.verdict) || "",
  deviations: (impl && impl.deviations) || [],
  summary: (impl && impl.summary) || "",
};
