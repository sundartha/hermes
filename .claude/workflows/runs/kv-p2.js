// PER-RUN-Skript KV-P2 (Phase HART GEPINNT).
// Siehe Memory [[phase-impl-workflow-args]]: die Phase steht hier im Skript, nicht in args.
// Schema traegt NUR Skalare mit Laengenlimit (Lehre aus wf_af632311-4d5: 16-KB-Nutzlast
// toetet den Lauf, nachdem die Arbeit schon committet war).

export const meta = {
  name: "phase-impl-lean",
  description:
    "KV-P2: Inbound-Carrier-Minuten erreichen die Gate-Achse - die groesste Kostenluecke, kalibriert an der KV-M1-Messung.",
  phases: [
    { title: "Plan", detail: "Code-gegroundeter Umsetzungsplan inkl. Decken-Rechnung (Opus)" },
    { title: "Implementieren", detail: "Umsetzung im Worktree, npm test gruen" },
    { title: "Review", detail: "Safety/Verhalten (Opus) + Clean-Code-Auditor (parallel)" },
    { title: "Self-Fix", detail: "S1/S2/Safety-Blocker fixen + Re-Review, bis PASS" },
    { title: "Report", detail: "Prozessbericht in tasks/kv-p2-report.md" },
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
const PHASE = "KV-P2";
const PHASE_TITLE = "Inbound-Carrier-Minuten auf die Gate-Achse";
const BRANCH = "phase/kv-p2-inbound-gate-achse";
const BASE = "master";
const PLAN_DOC = "tasks/PLAN-KOSTEN-VOLLSTAENDIGKEIT.md";
const MAX_FIX_ROUNDS = 2;
const REPORT_PATH = "tasks/kv-p2-report.md";
const DECKEN_PATH = "tasks/kv-p2-decken-rechnung.md";

const MODEL_OPUS = "opus";
const MODEL_SONNET = "sonnet";

// Modellpolitik (Kickoff KV-Kette): KV-P2 beruehrt Absolute Regel 1 (Kosten-Gate, Geld-Pfad)
// -> Plan und Safety auf Opus/high, Impl/Audit/Fix/Report auf Sonnet.
// Pins explizit pro agent(), nie erben lassen (Memory [[workflow-model-policy]]).
const PLAN_AGENT = { model: MODEL_OPUS, effort: "high" };
const IMPL_AGENT = { model: MODEL_SONNET };
const SAFETY_AGENT = { model: MODEL_OPUS, effort: "high" };
const CLEANCODE_AGENT = { model: MODEL_SONNET, effort: "medium" };
const FIX_AGENT = { model: MODEL_SONNET, effort: "medium" };
const REPORT_AGENT = { model: MODEL_SONNET, effort: "low" };

const SCHEMA_RULE = `SCHEMA-REGEL (bindend, sonst stirbt der Lauf): JEDES Textfeld deiner StructuredOutput-Antwort bleibt KURZ - hoechstens etwa 400 Zeichen, KEINE Markdown-Tabellen, KEINE Code-Bloecke, KEINE langen eingebetteten Zeilenumbrueche. Alles Umfangreiche schreibst du in eine DATEI und nennst im Feld nur den Pfad plus einen Satz. Ein Vorlauf dieser Kette ist an einer 16-KB-Nutzlast gestorben, nachdem die Arbeit bereits committet war.`;

const CLEAN_CODE_REQ = `CLEAN-CODE (PFLICHT): Lies "${REPO}/.claude/refs/clean-code.md" (verbindlicher Pruefkatalog) und befolge ihn bei JEDER Code-Entscheidung. Insbesondere: keine Duplizierung (G5/S2 - hier KRITISCH: EINE Tarif-Quelle, EINE Abfrage laufender Legs, keine zweite Kopie); Geld NIE als Fliesskomma (G26/S1); keine Magic Numbers ausser 0/1/-1 (G25, benannte Konstante); konfigurierbare Werte gehoeren nach src/config.js (G35); kein toter/auskommentierter Code (C5/G9), keine ungenutzten Imports (G12); Nebeneffekte im Namen sichtbar (N7); Name auf der Abstraktionsebene der Funktion (N2 - ein Name, der eine Richtung behauptet, die die Funktion nicht mehr hat, ist eine Luege); ueberholte Kommentare sind gefaehrlich (C2 - Kommentare, die diese Phase unrichtig macht, MUESSEN mitgezogen werden); eine Aufgabe pro Funktion (G30/G34), <=3 Argumente (F1); ESM, kein Build-Step, kein TypeScript. Tests: ein Konzept pro Test (P14), Grenzfaelle (T5), Build-Operate-Check (P13).
PFLICHT VOR JEDEM "EXISTIERT NICHT"-BEFUND: greppe am AUSGECHECKTEN BRANCH, nicht nur im Diff. Ein Symbol kann ueber die Basis hereingekommen sein (Repo-Lehre KV-M0).
UMLAUT-REGEL: Kommentare und Identifier OHNE Umlaute (ue/oe/ae) - wie im Bestand.`;

const ABS_RULES = `ABSOLUTE REGELN (unantastbar, siehe CLAUDE.md):
- Die pro-Tenant-Kostendecke ist ein GESCHUETZTES Gate. Diese Phase FUETTERT sie, sie schwaecht sie NICHT. Ihre Sperrwirkung bleibt unveraendert - inklusive der in CLAUDE.md festgehaltenen Aussage, dass sie BEIDE Richtungen sperrt.
- Die Inbound-Abweisung bei erschoepfter Decke (routes/voice.js) bleibt UNVERAENDERT. Sie zu entfernen waere die Wiederaufnahme der zurueckgezogenen Entscheidung E11 und braucht eine schriftliche CLAUDE.md-Aenderung - NICHT Teil dieser Phase, JEDE Beruehrung ist ein BLOCKER.
- Alle uebrigen Safety-Gates (Denylist/Land/Stundenlimit/Max-Dauer/Signaturpruefung/OUTBOUND_FROZEN, Abo+KYC als Outbound-Permit, MAX_NUMBERS) NIE entfernen/aufweichen/per-Default umgehen.
- Disclosure-Satz (disclosureSentence) unberuehrt.
- SECRETS nur via env, nie loggen/leaken.
- AUTH FAIL-CLOSED: keine neue Route, kein neuer Endpunkt, kein route-policy.js-Eintrag.
- SCOPE: NUR diese Phase. Keine ungefragten Extras. Keine neuen npm-Dependencies.`;

const KV_P2_SCOPE = `SCOPE DIESER PHASE (bindend):

DER BEFUND (belegt, nicht neu zu erheben): Bei einem Inbound-Anruf erreicht KEINE Carrier-Kostenart die Gate-Achse. \`recordVoiceMinuteMeter\` schreibt richtungsblind in den Ledger (Buch A), \`reconcileOutboundVoiceBudget\` filtert direkt daneben hart auf \`outbound\` und bucht nur dann auf die Gate-Achse (Buch B). Dieselben Kosten desselben Anrufs, zwei Schreibvorgaenge, zwei verschiedene Filter. Gleichzeitig SPERRT die Decke Inbound bereits heute (routes/voice.js weist eingehende Anrufe bei \`budgetExceeded\` ab) - die Achse, die Inbound sperren kann, bekommt von Inbound keinen Cent. Die Asymmetrie laeuft in beide falschen Richtungen.

TEIL 1 - Die Buchung wird richtungsoffen:
- \`reconcileOutboundVoiceBudget\` (src/billing/metering.js) verliert seinen Richtungsfilter UND seinen Namen. Ein Name, der "Outbound" behauptet, waehrend die Funktion beide Richtungen bucht, ist eine Luege (N2). Waehle einen Namen ohne Richtungsbehauptung und zieh ALLE Aufrufer und Kommentare mit.
- Der Minutensatz kommt aus \`callTariffCentsPerMin\` - EINE Tarif-Quelle. **Keine zweite Kopie, keine parallele Inbound-Tariffunktion** (G5). Der Inbound-Fall existiert in dieser Funktion bereits.
- \`estimated_cost_cents\` und die beiden Achsen-Anker (\`estimated_cost_spend_month_key\`, \`estimated_cost_period_key\`) MUESSEN auch an der Inbound-\`call\`-Zeile gesetzt werden - sonst kann KV-P3 spaeter nicht korrigieren. Das ist ein eigenes Abnahmekriterium, kein Nebeneffekt.

TEIL 2 - Der Inbound-Satz, kalibriert an KV-M1 (LEAD-ENTSCHEIDUNG, bindend):
- **Der Inbound-Satz betraegt 6 Cent je angefangener Minute.** Herleitung, die in den Bericht gehoert: KV-M1 hat einen kontrollierten Inbound-Anruf vollstaendig vermessen - Ist-Kosten **1,87 US-Cent je angefangener Minute** (US-DID, Budget-Engine, Assistant-Pfad NICHT beteiligt; 3,73 ct fuer 2 angefangene Minuten, davon 71 % speech-to-text, 17 % sip-trunking, 11 % call-control). 6 ct traegt damit einen Sicherheitsaufschlag von gut 3x ueber dem Ist und liegt zugleich 5x unter dem Outbound-Worst-Case.
- **Der Outbound-Worst-Case von 30 ct/min ist als Inbound-Satz AUSDRUECKLICH NICHT zu verwenden** - er waere 16-fach ueberhoeht und wuerde einen Starter-Kunden nach 50 Inbound-Minuten sperren, bei realen Kosten von 93 US-Cent gegen eine 15-Euro-Decke.
- Der Satz gehoert als benannter, konfigurierbarer Wert nach src/config.js (G35), dokumentiert in .env.example, geprueft gegen render.yaml, UND in BASE_ENV (test/helpers.js) gepinnt - sonst leakt die lokale .env in die Spawn-Tests (Repo-Lehre test-base-env-drift).
- FAIL-RICHTUNG: fehlt oder ist der Satz unbrauchbar, wird **nie auf 0** gebucht. "Im Zweifel der teurere Satz" ist die Richtung - ein nicht gebuchter Cent ist der Schaden, den diese Phase behebt. Begruende im Plan, welchen Rueckfall du waehlst und warum er nicht 0 ist.
- Die Messung gilt NUR fuer die Konfiguration, in der sie erhoben wurde (US-DID, Budget-Engine, ohne Assistant-Pfad). Das gehoert als Grenze in den Bericht und in PLAN-SECURITY.md - nicht als Fussnote, sondern als Satz.

TEIL 3 - Der Live-Zaehler zieht mit (Owner-Entscheidung 3b, bindend):
- \`liveVoiceSpendCents\` (metering.js) ist heute outbound-only, weil \`store.activeOutboundCallsFor\` sein einziger Produzent ist. Diese Abfrage wird RICHTUNGSOFFEN.
- **Es entsteht KEINE zweite \`activeInboundCallsFor\`** (G5) - eine zweite Liste, die jemand synchron halten muesste, ist genau das Muster, an dem dieses Repo schon einmal gescheitert ist.
- Der Vertrag von \`liveVoiceSpendCents\` aendert sich ausdruecklich von "nur Outbound" auf "alle laufenden Legs des Tenants". **Der Modul-Kommentar wird mitgezogen** - er behauptet heute "Inbound traegt nichts bei - was nie gebucht wird, darf auch live nicht zaehlen" und wird mit dieser Phase sachlich falsch (C2).
- Der Mid-Call-Abbruch ist KEIN Zuwachs dieser Phase: \`blockingBudgetAxis\` laeuft schon heute richtungsblind in jeder Schleifenrunde. Neu ist allein, dass die Pruefung die eigenen, noch ungebuchten Minuten des laufenden Inbound-Legs sieht.

TEIL 4 - Die Landkarte kippt GENAU EINE Zeile:
- In src/billing/cost-ledger-map.js kippt \`voice_minute_inbound\` von \`gate: false\` auf \`gate: true\`. KEINE andere Zeile wird angefasst - sms, number_month und play_tts_characters bleiben auf \`gate: false\`.
- Der KV-P1-Verhaltenstest (test/kv-p1-cost-ledger-map.test.js) erzwingt, dass die REALITAET mitkippt: er loest den echten Buchungspfad aus und liest beide Buecher. Wenn du die Zeile drehst, ohne dass der Code bucht, MUSS er rot werden - und umgekehrt. Nenne im Bericht, welche Assertion dort jetzt greift.

TEIL 5 - Die Decken-Rechnung (Pre-Mortem TOD 1, VORBEDINGUNG des Merges):
Schreibe die vollstaendige Rechnung in die Datei "${REPO}/${DECKEN_PATH}" (falls das Schreiben ausserhalb deines Worktrees blockiert ist, schreib sie IN deinen Worktree und nenne den Pfad). Sie enthaelt je Katalog-Tarif (Starter, Business):
- die verkauften Minuten, die Plan-Decke in Cent, den Inbound-Satz,
- wie viele Inbound-Minuten bis zur Sperre reichen - rein inbound, und nach vollem Outbound-Kontingent,
- die Gegenprobe: **kann ein Kunde seine GEKAUFTEN Minuten vollstaendig inbound telefonieren, ohne in die Geld-Decke zu laufen?** Lautet die Antwort NEIN, ist das ein BLOCKER: dann muss die Decke vorher angehoben werden, und die Phase wird nicht gemergt. Sag es klar, statt es zu relativieren.
- Der Bestandsbefund N7 gehoert dazu: das Minuten-Kontingent verbraucht Inbound bereits heute richtungsblind (\`voiceMinutesUsedSince\` filtert nicht auf Richtung), es sperrt aber nur Outbound. Bei einem Kunden, der beide Richtungen nutzt, beisst also das Minuten-Kontingent VOR der Geld-Decke. Das ist Bestandsverhalten und ausdruecklich Owner-bestaetigt - nicht "reparieren".

DIE VIER PFLICHT-ABNAHMEN (aus dem Plan, woertlich):
(1) Ein beendeter Inbound-Call mit 2 Minuten erhoeht \`usage.spendMonthCostCents\` um 2 x Inbound-Satz. Mutationsprobe: der Bestandsfilter (Richtungsfilter wieder einsetzen) faerbt ihn rot.
(2) \`estimated_cost_cents\` und beide Achsen-Anker sind an der Inbound-\`call\`-Zeile gesetzt.
(3) Ein NIE BEANTWORTETER Inbound-Call bucht NICHTS (\`voiceMinutesOf\` = 0).
(4) GENAU EINE Buchung je Call: der persistierte \`billedAt\`-Riegel greift fuer Inbound identisch - auch ueber einen Neustart hinweg (er ist genau dafuer persistiert). Das ist der Riegel gegen Pre-Mortem TOD 2 (Doppelbelastung).

TEST-IDs: "KV-P2-N". NICHT mit einem i18n-Katalog-Praefix beginnen (DID|E2E|FMT|GAP|LANG|LAW|MCP|ORIG|OUT|PAY|PROMPT|UI|VOICE|WEB|WORLD gefolgt von einer Ziffer).

DEFINITION OF DONE, zusaetzlich: PLAN-SECURITY.md bekommt die neue Inbound-Kosten-Kante MIT ZAHLEN eingetragen (Inbound-Satz, gemessener Ist-Satz, Konfigurationsgrenze der Messung, und das bewusst getragene Restrisiko aus TOD 4: ein einzelnes sehr langes Inbound-Gespraech zwischen zwei Sweeps).

NICHT-ZIELE (ausdruecklich):
- KEINE neue DB-Spalte, KEIN Backfill. \`estimated_cost_cents\` und beide Anker existieren bereits.
- KEINE rueckwirkende Buchung: die zwei historischen Inbound-Calls bleiben ungebucht und werden im Bericht ausdruecklich so gefuehrt.
- KEIN Ist-Abgleich fuer Inbound - das ist KV-P3, die naechste Phase. \`cost-truing.js\` bleibt in dieser Phase UNVERAENDERT.
- KEINE Aenderung an Tarif, Marge, Abo-Preis oder Preismodell. Der Inbound-Satz ist ein Kosten-Messwert fuer das Gate, KEIN Kundenpreis.
- KEINE Aenderung an der Inbound-Abweisung in routes/voice.js.
- KEINE zweite Decke, kein zweites Gate, keine zweite Liste laufender Calls.
- NIEMALS "git stash" (refs/stash ist zwischen Worktrees geteilt). NIEMALS "git add -A" - im Repo liegen untrackte Dateien mit Kundendaten. Dateien EINZELN adden.`;

// ---------- Phase 1: Plan ----------
phase("Plan");
const plan = await agent(
  `Du erstellst den DETAILLIERTEN, code-gegroundeten, CLEAN-CODE-KONFORMEN Umsetzungsplan fuer Phase ${PHASE} (${PHASE_TITLE}) im Repo "${REPO}". NUR PLANEN, NICHTS aendern.
1. Lies "${REPO}/${PLAN_DOC}": den Abschnitt "KV-P2" VOLLSTAENDIG, dazu "Befund", "Die gemeinsame Wurzel", die Messungen N1/N2/N7, das ERGEBNIS KV-M1 (der gemessene Inbound-Satz und seine Grenzen), das Pre-Mortem TOD 1/TOD 2/TOD 4 und die Owner-Entscheidungen 1 und 3. Das Dokument ist die Autoritaet dieser Phase; die Owner-Entscheidungen sind BEANTWORTET und nicht neu zu verhandeln.
2. Lies "${REPO}/.claude/refs/clean-code.md" und "${REPO}/CLAUDE.md" (Absolute Regeln - besonders Regel 1 und die Owner-Entscheidung E10/E11 dort).
3. Lies den ECHTEN Code auf Basis "${BASE}" - grep nach Symbolen, uebernimm KEINE Zeilennummern aus dem Plan-Doc (sie rotten):
   - src/billing/metering.js: \`recordVoiceMinuteMeter\`, \`reconcileOutboundVoiceBudget\`, \`callTariffCentsPerMin\`, \`liveVoiceSpendCents\`, \`voiceMinutesOf\`, der Modul-Kommentarkopf
   - src/store/state-ops.js: \`addVoiceUsageCostCents\`, \`bookCents\`, \`budgetExceeded\`, \`activeOutboundCallsFor\`, \`recordCallEstimatedCostCents\`, die Achsen-Anker
   - src/telephony/call-finish.js: die zwei nebeneinanderstehenden Schreibvorgaenge und der \`billedAt\`-Riegel
   - src/outbound-gates.js (oder wo \`tariffCentsPerMin\`/\`isDomesticLeg\` liegen): wie der Tarif je Leg bestimmt wird, und was der Inbound-Fall heute liefert
   - src/billing/cost-ledger-map.js + test/kv-p1-cost-ledger-map.test.js: die Landkarte und wie ihr Verhaltenstest die Zeile prueft
   - src/routes/voice.js: die Inbound-Abweisung bei erschoepfter Decke (NUR LESEN - sie bleibt unveraendert)
   - src/config.js: Muster fuer Tarif-/Kostenwerte, \`assertConfig\`, Namespace-Whitelist; .env.example; render.yaml; test/helpers.js BASE_ENV
   - test/: bestehende Metering-/Budget-Tests, die kippen koennten
4. ENTSCHEIDE UND BEGRUENDE:
   (a) Der neue Funktionsname (ohne Richtungsbehauptung) und ALLE Stellen, die mitziehen muessen - Aufrufer, Kommentare, Tests.
   (b) WIE der Inbound-Satz in \`callTariffCentsPerMin\` einfliesst, OHNE eine zweite Tarif-Quelle zu erzeugen. Heute liefert die Funktion fuer Inbound \`tariffCentsPerMin(call.to, call.to)\` - an einer US-DID also den Auslandssatz. Der kalibrierte Satz von 6 ct/min muss ihn fuer Inbound ersetzen. Zeig, dass danach GENAU EINE Funktion den Minutensatz eines Legs bestimmt.
   (c) Die Fail-Richtung des Satzes: was passiert bei fehlendem/unbrauchbarem Wert, und warum ist das nicht 0?
   (d) WIE \`activeOutboundCallsFor\` richtungsoffen wird, ohne eine zweite Abfrage zu erzeugen - inklusive aller heutigen Aufrufer: aendert sich fuer die etwas? Ein Aufrufer, der die Richtungsfilterung BRAUCHT, muss sie dann selbst ausdruecken; nenne jeden.
   (e) Welche Kommentare diese Phase unrichtig macht (C2) - liste sie einzeln.
5. RECHNE DIE DECKEN-RECHNUNG (TOD 1) VOR: je Katalog-Tarif verkaufte Minuten, Decke in Cent, Inbound-Satz, Reichweite in Inbound-Minuten, und die Gegenprobe "kann der Kunde seine gekauften Minuten vollstaendig inbound telefonieren?". Nenne die Zahlen, die du im Code gefunden hast, nicht die aus dem Plan-Doc - das Doc kann veraltet sein. Wenn die Antwort NEIN lautet, sag ausdruecklich, dass die Phase so nicht mergefaehig ist.
6. Nenne ausdruecklich, welche Bestandstests kippen und wie du mit jedem einzelnen umgehst. Ein Bestandstest, der heute "Inbound bucht nicht" pinnt, ist eine ZUSAGE, die diese Phase bewusst dreht - er wird umgeschrieben, nicht geloescht, und die Aenderung wird begruendet.
7. PRE-MORTEM dieser Phase: ein Jahr spaeter hat KV-P2 Schaden angerichtet. Was ist passiert? Nenne mindestens: ein Kunde, dessen Kerngebrauch das Entgegennehmen von Anrufen ist, ist Mitte des Monats gesperrt und verliert seine Erreichbarkeit; ein Anruf wird doppelt gebucht, weil der billedAt-Riegel fuer Inbound nicht greift; der Live-Zaehler zaehlt ein Leg doppelt, weil die richtungsoffene Abfrage mehr liefert als gedacht; der Inbound-Satz wurde nie an einer +49-DID nachgemessen und ist dort falsch. Fuer jedes: die Gegenmassnahme im Bauplan oder die ehrliche Feststellung, dass es ein getragenes Restrisiko ist.
${KV_P2_SCOPE}
${CLEAN_CODE_REQ}
${ABS_RULES}
LIEFERE: (1) die exakten Edits je Datei (Vorher/Nachher-Skizze); (2) die Config-Deklaration inkl. Fail-Richtung; (3) die vier Pflicht-Abnahmen als konkrete Tests KV-P2-* mit Assertions, plus die Mutationsproben; (4) die Decken-Rechnung mit Zahlen und dem Ja/Nein-Urteil; (5) die Liste der unrichtig werdenden Kommentare; (6) den PLAN-SECURITY.md-Text ausformuliert; (7) das Pre-Mortem. Kleiner Blast-Radius. Deine Rueckgabe IST der Plan.`,
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
      description: "Je angepasstem Bestandstest: ID - alte Zusage - neue Zusage - Begruendung. Je Eintrag hoechstens 250 Zeichen.",
    },
    renamedFunction: {
      type: "string",
      description: "Alter Name -> neuer Name, und wie viele Aufrufer/Kommentare mitgezogen wurden. Hoechstens 300 Zeichen.",
    },
    singleTariffSourceProof: {
      type: "string",
      description:
        "Womit ist belegt, dass GENAU EINE Funktion den Minutensatz eines Legs bestimmt (keine zweite Inbound-Kopie)? Hoechstens 400 Zeichen.",
    },
    inboundRateWiring: {
      type: "string",
      description:
        "Der Inbound-Satz: Name der Env-Variable, Wert, und Ja/Nein je Stelle - config.js, .env.example, render.yaml, BASE_ENV. Hoechstens 400 Zeichen.",
    },
    failDirectionProof: {
      type: "string",
      description:
        "Was passiert bei fehlendem/unbrauchbarem Inbound-Satz, und welcher Test belegt, dass NICHT 0 gebucht wird? Hoechstens 350 Zeichen.",
    },
    liveCounterProof: {
      type: "string",
      description:
        "Wie wurde die Abfrage laufender Legs richtungsoffen, ohne eine zweite Abfrage zu erzeugen? Welche Aufrufer waren betroffen? Hoechstens 400 Zeichen.",
    },
    mapRowFlipped: {
      type: "string",
      description:
        "Welche Landkarten-Zeile kippte, welche Assertion im KV-P1-Test greift jetzt, und welche Zeilen blieben unveraendert? Hoechstens 350 Zeichen.",
    },
    deckenRechnungPath: { type: "string", description: "Pfad der geschriebenen Decken-Rechnung" },
    deckenRechnungVerdict: {
      type: "string",
      description:
        "Kann ein Kunde je Katalog-Tarif seine GEKAUFTEN Minuten vollstaendig inbound telefonieren, ohne in die Geld-Decke zu laufen? JA/NEIN je Tarif mit den Zahlen. Hoechstens 400 Zeichen.",
    },
    acceptance1: { type: "string", description: "Abnahme (1) 2-Minuten-Inbound bucht 2x Satz: Testname + Ergebnis. Hoechstens 250 Zeichen." },
    acceptance2: { type: "string", description: "Abnahme (2) estimated_cost_cents + beide Anker gesetzt: Testname + Ergebnis. Hoechstens 250 Zeichen." },
    acceptance3: { type: "string", description: "Abnahme (3) nie beantworteter Inbound bucht nichts: Testname + Ergebnis. Hoechstens 250 Zeichen." },
    acceptance4: { type: "string", description: "Abnahme (4) genau EINE Buchung je Call (billedAt, auch ueber Neustart): Testname + Ergebnis. Hoechstens 300 Zeichen." },
    voiceRouteUntouched: { type: "boolean", description: "src/routes/voice.js Inbound-Abweisung unveraendert" },
    costTruingUntouched: { type: "boolean", description: "src/billing/cost-truing.js unveraendert (das ist KV-P3)" },
    planSecurityUpdated: { type: "boolean" },
    nodeCheckPass: { type: "boolean" },
    testsPass: { type: "boolean" },
    testPassCount: { type: "number" },
    testFailCount: { type: "number" },
    gatesRedCount: { type: "number" },
    mutationProbeResult: { type: "string", description: "Hoechstens 500 Zeichen" },
    committed: { type: "boolean" },
    deviations: { type: "array", items: { type: "string" } },
    summary: { type: "string", description: "Hoechstens 500 Zeichen" },
  },
  required: [
    "headCommit",
    "renamedFunction",
    "singleTariffSourceProof",
    "inboundRateWiring",
    "failDirectionProof",
    "liveCounterProof",
    "mapRowFlipped",
    "deckenRechnungPath",
    "deckenRechnungVerdict",
    "acceptance1",
    "acceptance2",
    "acceptance3",
    "acceptance4",
    "voiceRouteUntouched",
    "costTruingUntouched",
    "planSecurityUpdated",
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
2. REGEL 0: ZUERST \`git checkout -b ${BRANCH} ${BASE}\`, DANN erst lesen.
3. Umsetzung in dieser Reihenfolge: (a) Inbound-Satz nach config.js + .env.example + render.yaml + BASE_ENV; (b) Tarif-Quelle; (c) Richtungsfilter raus + Umbenennung + Kommentare mitziehen; (d) Live-Zaehler richtungsoffen; (e) Landkarten-Zeile kippen; (f) Tests KV-P2-*; (g) PLAN-SECURITY.md; (h) Decken-Rechnung nach "${DECKEN_PATH}".
4. node --check auf jede geaenderte src-Datei, dann npm test gruen. Dateien EINZELN adden, committen: "feat(kv-p2): Inbound-Carrier-Minuten erreichen die Gate-Achse".
${KV_P2_SCOPE}
${CLEAN_CODE_REQ}
5. npm test MUSS gruen sein. Kippende Bestandstests: jede Anpassung einzeln in existingTestsAdjusted begruenden. Wer eine Assertion abschwaecht, ohne das dort zu erklaeren, hat die Phase verfehlt.
6. npm run test:gates zusaetzlich fahren (DARF rot sein - Launch-Katalog). HINWEIS: test/auth-p9a-cache-headers.test.js haengt bekanntermassen unter --test-name-pattern (Bestandsdefekt, NICHT deine Aufgabe) - wenn der Lauf haengt, brich ab und melde es statt zu warten.
7. MUTATIONSPROBEN, alle drei, einzeln, jede danach zuruecknehmen:
   (a) Richtungsfilter wieder einsetzen -> die Inbound-Buchungstests MUESSEN rot werden.
   (b) Landkarten-Zeile voice_minute_inbound auf gate:false zuruecksetzen -> der KV-P1-Verhaltenstest MUSS rot werden (die Realitaet bucht jetzt).
   (c) Den Inbound-Satz auf 0 setzen -> die Fail-Richtung MUSS anschlagen (kein stilles 0-Buchen).
   Jede Mutation zuruecknehmen, npm test erneut gruen. Der finale Diff darf keine Mutation tragen.
8. node_modules-Symlink NICHT committen. Nach dem Lauf: ps aux | grep "[n]ode src/server.js" - verwaiste Testserver beenden.
${SCHEMA_RULE}
${ABS_RULES}
EHRLICH fuellen. deckenRechnungVerdict ist das Feld, an dem der Merge haengt: ergibt die Rechnung, dass ein Kunde seine gekauften Minuten NICHT inbound telefonieren kann, sag NEIN - dann wird die Phase nicht gemergt, und das ist das richtige Ergebnis, kein Misserfolg.`,
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
    independentTestSummary: { type: "string", description: "Hoechstens 300 Zeichen" },
    scopeRespected: { type: "boolean" },
    capStillBlocksBothDirections: {
      type: "boolean",
      description:
        "SELBST geprueft: die pro-Tenant-Decke sperrt weiterhin BEIDE Richtungen; ihre Sperrwirkung wurde nicht geschwaecht",
    },
    voiceRouteUntouched: {
      type: "boolean",
      description: "Die Inbound-Abweisung in routes/voice.js ist unveraendert (E11 nicht wiederaufgenommen)",
    },
    noDoubleBooking: {
      type: "boolean",
      description:
        "SELBST verifiziert: genau EINE Buchung je Inbound-Call; der persistierte billedAt-Riegel greift auch ueber einen Neustart. Wie geprueft?",
    },
    singleTariffSource: {
      type: "boolean",
      description: "SELBST gegrept: genau EINE Funktion bestimmt den Minutensatz; keine zweite Inbound-Kopie",
    },
    singleActiveCallsQuery: {
      type: "boolean",
      description: "Keine zweite activeInboundCallsFor-Abfrage entstanden; alle Aufrufer der geaenderten Abfrage geprueft",
    },
    liveCounterNoDoubleCount: {
      type: "boolean",
      description:
        "SELBST nachgerechnet: der richtungsoffene Live-Zaehler zaehlt kein Leg doppelt und keinen bereits gebuchten Call erneut",
    },
    failDirectionNeverZero: {
      type: "boolean",
      description: "SELBST geprueft: fehlender/unbrauchbarer Inbound-Satz fuehrt NIE zu einer 0-Buchung",
    },
    ratePlausible: {
      type: "boolean",
      description:
        "Der Inbound-Satz ist an KV-M1 kalibriert (Ist 1,87 ct/min), traegt Sicherheitsaufschlag und ist nicht der 16-fach ueberhoehte Outbound-Worst-Case",
    },
    deckenRechnungSound: {
      type: "boolean",
      description:
        "SELBST nachgerechnet: kann der Kunde je Katalog-Tarif seine gekauften Minuten vollstaendig inbound telefonieren? Rechnung selbst gepruefT, nicht uebernommen",
    },
    exactlyOneMapRowFlipped: {
      type: "boolean",
      description: "GENAU eine Landkarten-Zeile kippte (voice_minute_inbound); sms/number_month/play_tts unveraendert",
    },
    mapTestEnforcesReality: {
      type: "boolean",
      description:
        "SELBST verifiziert durch Mutation: Zeile auf gate:false zurueckdrehen -> KV-P1-Verhaltenstest rot",
    },
    costTruingUntouched: { type: "boolean", description: "cost-truing.js unveraendert (das ist KV-P3)" },
    ankerSetForInbound: {
      type: "boolean",
      description: "estimated_cost_cents und BEIDE Achsen-Anker sind an der Inbound-call-Zeile gesetzt (KV-P3 braucht sie)",
    },
    staleCommentsFixed: {
      type: "boolean",
      description: "Kommentare, die diese Phase unrichtig macht (insbesondere 'Inbound traegt nichts bei'), wurden mitgezogen",
    },
    envWiringComplete: { type: "boolean", description: "config.js + .env.example + render.yaml + BASE_ENV" },
    planSecurityUpdated: { type: "boolean" },
    noSecretsLeaked: { type: "boolean" },
    existingAssertionsNotWeakened: { type: "boolean" },
    disclosureIntact: { type: "boolean" },
    safetyGatesIntact: { type: "boolean" },
    approved: { type: "boolean" },
    blockers: { type: "array", items: { type: "string" }, description: "Je Eintrag hoechstens 500 Zeichen" },
    concerns: { type: "array", items: { type: "string" }, description: "Je Eintrag hoechstens 300 Zeichen" },
    verdict: { type: "string", description: "Hoechstens 600 Zeichen" },
  },
  required: [
    "approved",
    "testsPassIndependently",
    "scopeRespected",
    "capStillBlocksBothDirections",
    "voiceRouteUntouched",
    "noDoubleBooking",
    "singleTariffSource",
    "singleActiveCallsQuery",
    "liveCounterNoDoubleCount",
    "failDirectionNeverZero",
    "ratePlausible",
    "deckenRechnungSound",
    "exactlyOneMapRowFlipped",
    "mapTestEnforcesReality",
    "costTruingUntouched",
    "ankerSetForInbound",
    "staleCommentsFixed",
    "envWiringComplete",
    "planSecurityUpdated",
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
    s1: { type: "array", items: { type: "string" }, description: "Je Eintrag hoechstens 500 Zeichen" },
    s2: { type: "array", items: { type: "string" }, description: "Je Eintrag hoechstens 500 Zeichen" },
    s3: { type: "array", items: { type: "string" }, description: "Je Eintrag hoechstens 300 Zeichen" },
    s4: { type: "array", items: { type: "string" }, description: "Je Eintrag hoechstens 300 Zeichen" },
    blocker: { type: "boolean" },
    grepCheckDone: { type: "boolean", description: "Vor jedem 'existiert nicht'-Befund am ausgecheckten Branch gegrept?" },
    passNotes: { type: "string", description: "Hoechstens 400 Zeichen" },
    topTodos: { type: "array", items: { type: "string" } },
    verdict: { type: "string", description: "Hoechstens 400 Zeichen" },
  },
  required: ["s1", "s2", "s3", "s4", "blocker", "grepCheckDone", "verdict"],
};

async function runReview(target, suffix) {
  return await parallel([
    () =>
      agent(
        `STRENGER, adversarialer Safety-/Verhaltens-Reviewer in frischem Worktree. Pruefe Phase ${PHASE} auf Branch "${target}". Diese Phase fuettert ein GESCHUETZTES Gate (die pro-Tenant-Kostendecke) mit einer neuen Kostenquelle. Ein Fehler hier sperrt zahlende Kunden aus ihrer eigenen Erreichbarkeit oder belastet sie doppelt - pruefe entsprechend hart.
1. ln -s "${NODE_MODULES}" node_modules
2. git checkout -b review-${String(PHASE).toLowerCase()}${suffix} ${target}
3. npm test selbst -> testsPassIndependently + Zahlen.
4. git diff ${BASE} ${target} gegen die absoluten Regeln pruefen.
${KV_P2_SCOPE}
PRUEFE BESONDERS, jeweils SELBST am Code nachgerechnet - glaube keinem Bericht:
- capStillBlocksBothDirections + voiceRouteUntouched: git diff auf src/routes/voice.js und auf \`budgetExceeded\`. Die Inbound-Abweisung MUSS unveraendert sein. Jede Lockerung dort ist die Wiederaufnahme der zurueckgezogenen Entscheidung E11 und ein BLOCKER, unabhaengig davon, wie sinnvoll sie aussieht.
- noDoubleBooking: DAS IST DER ZWEITWICHTIGSTE PUNKT (Pre-Mortem TOD 2). Lies den billedAt-Riegel und pruefe, ob er fuer Inbound IDENTISCH greift. Konstruiere gedanklich: Call endet, Buchung, Prozess-Neustart, derselbe Call wird erneut finalisiert - wird doppelt gebucht? Gibt es einen zweiten Pfad (Status-Callback, Sweep, Retry), der dieselbe Buchung ausloesen kann? Ein zweiter Aufrufer der Buchungsfunktion ist ein BLOCKER.
- liveCounterNoDoubleCount: der Live-Zaehler addiert die noch ungebuchten Minuten laufender Legs zur bereits gebuchten Summe. Pruefe: kann ein Call, der GERADE gebucht wurde, kurzzeitig in BEIDEN Summen stehen? Kann ein Leg doppelt gezaehlt werden, wenn ein Anruf zwei Legs hat? Rechne es durch, statt es anzunehmen.
- singleTariffSource + singleActiveCallsQuery: greppe SELBST repo-weit. Eine zweite Tariffunktion oder eine zweite Abfrage laufender Calls ist ein BLOCKER (G5) - genau dieses Muster hat im Repo schon einmal Schaden angerichtet.
- failDirectionNeverZero: setze den Inbound-Satz TESTWEISE auf 0 bzw. entferne ihn. Wird 0 gebucht? Das waere die Wurzel dieses ganzen Plans in neuer Gestalt ("ein fehlender Preis ist lautlos eine 0") und ein BLOCKER. Mutation zuruecknehmen.
- deckenRechnungSound: RECHNE SELBST. Nimm die Decke je Katalog-Tarif und die verkauften Minuten aus dem Code (nicht aus dem Bericht) und pruefe: reicht die Decke, damit ein Kunde seine gekauften Minuten vollstaendig inbound telefonieren kann? Wenn nein, ist das ein BLOCKER - die Decke muesste vorher angehoben werden.
- exactlyOneMapRowFlipped + mapTestEnforcesReality: git diff auf src/billing/cost-ledger-map.js. GENAU eine Zeile darf gekippt sein. Dreh sie TESTWEISE zurueck auf gate:false - wird der KV-P1-Verhaltenstest rot? Wenn nein, ist der Fortschrittsanzeiger der ganzen Kette kaputt - BLOCKER. Zuruecknehmen.
- ankerSetForInbound: ohne \`estimated_cost_cents\` und beide Achsen-Anker an der Inbound-call-Zeile kann KV-P3 nicht korrigieren, und die Schaetzung bleibt dauerhaft stehen - dann belastet diese Phase Kunden systematisch zu hoch. Selbst am Test nachlesen.
- costTruingUntouched: git diff auf src/billing/cost-truing.js. Jede Aenderung dort ist KV-P3 und scope-fremd.
- staleCommentsFixed: greppe nach dem Kommentar, der behauptet, Inbound trage nichts bei. Steht er noch da, ist er jetzt eine Luege im Geld-Pfad (C2).
- existingAssertionsNotWeakened: git diff auf test/ genau lesen. Ein Bestandstest, der "Inbound bucht nicht" pinnte, DARF gedreht werden - aber nur mit Begruendung im Diff/Commit.
BEVOR du behauptest, ein Symbol existiere nicht: greppe am AUSGECHECKTEN BRANCH, nicht nur im Diff (Repo-Lehre KV-M0).
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
        `CLEAN-CODE-AUDITOR. Pruefe den Diff der Phase ${PHASE} (Branch "${target}", Basis "${BASE}") streng gegen den Katalog.
1. ln -s "${NODE_MODULES}" node_modules ; git checkout -b cc-${String(PHASE).toLowerCase()}${suffix} ${target}
2. Lies "${REPO}/.claude/refs/clean-code.md" VOLLSTAENDIG (definiert S1-S4 + Audit-Regeln: nur gesehenen Code bewerten, nicht raten).
3. git diff ${BASE} ${target} ; neue Dateien vollstaendig lesen.
4. PFLICHT VOR JEDEM "EXISTIERT NICHT"-BEFUND: git grep am ausgecheckten Branch. Ein Symbol kann ueber die Basis hereingekommen sein und taucht im Diff nicht auf. Ein S1 auf ungepruefter Annahme ist ein Fehlalarm und kostet eine ganze Runde (Repo-Lehre KV-M0). grepCheckDone erst true, wenn wirklich getan.
5. Kategorie fuer Kategorie. Pro FLAG: "ID - Datei - Verstoss - Fix" + Schweregrad. S3/S4 gebuendelt.
Achte besonders auf: (a) G5/S2 - EINE Tarif-Quelle, EINE Abfrage laufender Legs; jede Kopie ist S2; (b) G26/S1 - Geld ausschliesslich als Ganzzahl-Cent, keine Fliesskomma-Arithmetik, kein Runden an der falschen Stelle; (c) N2/N7 - der neue Funktionsname darf keine Richtung behaupten, Nebeneffekte muessen im Namen stehen; (d) C2 - Kommentare, die die Phase unrichtig macht, MUESSEN mitgezogen sein: greppe den Diff-Umkreis nach Aussagen ueber "outbound"/"Inbound traegt nichts bei"; (e) G25 - der Inbound-Satz als benannter Config-Wert, keine nackte Zahl im Buchungspfad; (f) die neuen Tests: ein Konzept pro Test (P14), Grenzfaelle (T5 - 0 Minuten, nie beantwortet, genau 1 Minute), unterscheidbare Fixture-Werte je Fall; (g) Kommentare deutsch OHNE Umlaute; (h) toter/auskommentierter Code, ungenutzte Imports.
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

// ---------- Phase 4: Self-Fix-Loop ----------
const FIX_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    headCommit: { type: "string" },
    addressed: { type: "array", items: { type: "string" }, description: "Je Eintrag hoechstens 250 Zeichen" },
    rejectedAsFalsePositive: {
      type: "array",
      items: { type: "string" },
      description: "Blocker, die du NICHT reproduzieren konntest - mit Kommando und Ergebnis. Je Eintrag hoechstens 250 Zeichen.",
    },
    filesTouched: { type: "array", items: { type: "string" } },
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
3. REPRODUZIERE JEDEN BLOCKER ZUERST. Ein Blocker ist eine Behauptung, kein Befund (Repo-Lehre KV-M0). Was sich nicht reproduzieren laesst, kommt nach rejectedAsFalsePositive mit Kommando und Ergebnis - NICHT "fixen".
4. Behebe die reproduzierbaren Blocker, fuer jeden korrektheits-/sicherheitsrelevanten Fix einen Regressionstest:
${JSON.stringify(blockers, null, 1)}
${KV_P2_SCOPE}
${CLEAN_CODE_REQ}
${SCHEMA_RULE}
${ABS_RULES}
5. node --check + npm test gruen. Dateien EINZELN adden (nie git add -A), kein git stash. node_modules NICHT committen.
6. **COMMITTE IMMER**, auch wenn ALLE Blocker Fehlalarme waren: dann committe eine Klarstellung (ein praezisierender Kommentar oder ein Test, der den vermeintlichen Defekt widerlegt) mit "fix(kv-p2): Review-Blocker geprueft (Runde ${round})". Ein ausbleibender Commit beendet die Schleife und laesst die Phase auf BLOCKED stehen, obwohl nichts kaputt ist. headCommit = git rev-parse HEAD.
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
  if (fix && Array.isArray(fix.rejectedAsFalsePositive) && fix.rejectedAsFalsePositive.length) {
    fixSummaries.push(`r${round} FEHLALARME: ${fix.rejectedAsFalsePositive.join(" | ").slice(0, 500)}`);
  }
  if (!fix || !fix.committed || !fix.headCommit) {
    fixSummaries.push(`r${round}: ABBRUCH - kein Commit vom Fix-Agenten (Branch ${fixBranch} existiert nicht).`);
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
LIES ZUERST die Decken-Rechnung. Sie sollte unter "${REPO}/${DECKEN_PATH}" liegen; fehlt sie dort, suche sie unter "${REPO}/.claude/worktrees/*/${DECKEN_PATH}" (ein Agent kann ausserhalb seines Worktrees nicht schreiben). Uebernimm sie WOERTLICH in den Bericht. Fehlt sie ganz, schreib das ausdruecklich hin - sie ist Vorbedingung des Merges.
EHRLICHKEITSREGEL: dieser Bericht darf KEINEN Schutz behaupten, der nicht am Code belegt ist. Ausdruecklich hineingehoerende Grenzen: der Inbound-Satz ist an EINER Messung, EINER Konfiguration (US-DID, Budget-Engine, ohne Assistant-Pfad) kalibriert und an einer +49-DID NIE nachgemessen; der Ist-Abgleich fuer Inbound kommt erst mit KV-P3, bis dahin steht die Schaetzung; die zwei historischen Inbound-Calls bleiben ungebucht.
Inhalt (Markdown): Phase ${PHASE} ${PHASE_TITLE}; Gate=${approved ? "PASS" : "BLOCKED"}; finalBranch=${reviewTarget}; was gebaut wurde; die Umbenennung und was mitgezogen wurde; der Beleg fuer EINE Tarif-Quelle und EINE Abfrage laufender Legs; der Inbound-Satz mit HERLEITUNG (KV-M1: 1,87 ct/min Ist -> 6 ct/min mit Aufschlag; warum NICHT 30 ct/min); die Fail-Richtung; die Decken-Rechnung woertlich mit dem JA/NEIN-Urteil je Tarif; die vier Pflicht-Abnahmen einzeln mit Testnamen; die gekippte Landkarten-Zeile und welche Assertion sie erzwingt; Mutationsproben; angepasste Bestandstests mit Begruendung; Safety-Urteil; Clean-Code-Audit; Fix-Runden inkl. Fehlalarme; ein Abschnitt "Was diese Phase NICHT tut" (kein Ist-Abgleich, keine rueckwirkende Buchung, keine Aenderung an der Inbound-Abweisung, keine zweite Decke, kein Kundenpreis); ein Abschnitt "Was der Lead nach dem Merge tun muss" (Env-Wert im Render-Dashboard setzen - und was passiert, wenn er es nicht tut). Quelle:
=== PLAN ===
${(plan || "").slice(0, 12000)}
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
  renamedFunction: (impl && impl.renamedFunction) || "",
  singleTariffSourceProof: (impl && impl.singleTariffSourceProof) || "",
  inboundRateWiring: (impl && impl.inboundRateWiring) || "",
  failDirectionProof: (impl && impl.failDirectionProof) || "",
  liveCounterProof: (impl && impl.liveCounterProof) || "",
  mapRowFlipped: (impl && impl.mapRowFlipped) || "",
  deckenRechnungPath: (impl && impl.deckenRechnungPath) || "",
  deckenRechnungVerdict: (impl && impl.deckenRechnungVerdict) || "",
  acceptances: [
    (impl && impl.acceptance1) || "",
    (impl && impl.acceptance2) || "",
    (impl && impl.acceptance3) || "",
    (impl && impl.acceptance4) || "",
  ],
  voiceRouteUntouched: impl ? impl.voiceRouteUntouched === true : false,
  costTruingUntouched: impl ? impl.costTruingUntouched === true : false,
  planSecurityUpdated: impl ? impl.planSecurityUpdated === true : false,
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
