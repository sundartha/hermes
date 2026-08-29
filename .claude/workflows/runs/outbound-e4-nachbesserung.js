// GEZIELTE NACHBESSERUNG (schlank): E4 endete BLOCKED mit SIEBEN benannten Blockern.
// Muster: outbound-e3b-nachbesserung.js (dort 4 Agenten statt 17, PASS in 2 Runden).

export const meta = {
  name: "outbound-e4-nachbesserung",
  description:
    "OUTBOUND-E4 Nachbesserung: 7 Blocker (stilles Gruen bei fehlender Agenten-Zuordnung, ANI-Riegel misst die falsche Nummer, kein Entprellen vor Versand, Ausnahmen in-process wirkungslos, Selbstheilung unerreichbar, CLI ohne Test, doppelte elRead-Closure). Fix -> gezielter Review -> ggf. zweite Runde.",
  phases: [
    { title: "Fix", detail: "Die sieben benannten Blocker beheben, sonst nichts", model: "sonnet" },
    { title: "Review", detail: "Gezielter Safety-Review der sieben Punkte + volle Regression", model: "opus" },
  ],
};

const REPO = "/Users/antonio/Mein Unternehmen/MCP/vodafone-agent";
const NODE_MODULES = `${REPO}/node_modules`;
const BASE = "phase/outbound-e4-drift-waechter-fix1";
const BRANCH = "phase/outbound-e4-nachbesserung";
const MASTER = "master";
const PLAN_DOC = "PLAN-OUTBOUND-RESILIENZ.md";
const TEST_CMD = `LLM_PROVIDER=anthropic npm test`;
const TEST_FLOOR = 5285; // Lead-Messung auf master (65c4764)
const MAX_ROUNDS = 2;

const FIX_AGENT = { model: "sonnet", effort: "high" };
const SAFETY_AGENT = { model: "opus", effort: "xhigh" };

// NEUER BETRIEBSSTAND seit dem Review - fuer Blocker 3 entscheidend:
const LIVE_LAGE = `NEUE LIVE-LAGE (seit dem Review vom 28.08. geaendert, VOR dem Fixen lesen):
Der Outbound wurde am 28.08.2026 repariert - Weg 1 der Wiederherstellung ist UMGESETZT. Stand heute
am Anbieter, per Anruf verifiziert (call_mtd0acq2hq4q, completed, 29 s):
  - Telnyx-Connection 3026479542865757220 ("ElevenLabs Spike2"): ani_override = +18643028341
    (kontoeigene DID, Tenant "owner"), ani_override_type = always
  - ElevenLabs-Nummernregistrierung phnum_1101m00pjrg7e1js7aaxwp8hdw38: phone_number =
    +15739090177 (UNVERAENDERT - diese Nummer gehoert dem Telnyx-Konto NICHT mehr)
  - Env PLATFORM_ANI_E164 = +18643028341 (im Render-Dashboard gesetzt)
DAS HEISST: die EL-Registrierung und der ANI-Override zeigen dauerhaft auf VERSCHIEDENE Nummern -
ein Zustand, der bewusst so ist und bis zur naechsten Etappe bleibt. Der Waechter WIRD diesen
Unterschied als Befund sehen. Ohne die in Blocker 3 verlangte Entprellung UND ohne die in
Blocker 3/4 verlangte Wirksamkeit der Ausnahmen im In-Prozess-Pfad wuerde der Betreiber deshalb
ab dem ersten Deploy STUENDLICH Mail und SMS bekommen - bei 3,09 USD Restguthaben. Diese
Nachbesserung ist damit die Vorbedingung dafuer, dass E4 ueberhaupt deploybar ist.`;

const BLOCKER = [
  `BLOCKER 1 - unknown ist NICHT ueberall laut (verletzt bindende Entscheidung 6 / PM-16).
src/telephony/outbound-config-drift.js#pruefeElNummer:
  if (wert.agentId && soll.elAgentId && wert.agentId !== soll.elAgentId)
Vom Reviewer selbst gemessen: (a) EL-Nummer KEINEM Agenten zugewiesen (assigned_agent fehlt ->
agentId null) -> befunde=[], "gemessen 9/9"; (b) ELEVENLABS_AGENT_ID nicht konfiguriert ->
befunde=[], "gemessen 9/9". Fall (a) ist ein echter, outbound-toetender Driftzustand und wird als
vollstaendig gruen gemeldet; Fall (b) ist woertlich "mangels Konfiguration kein Urteil" und wird
als "9 von 9 Pruefungen gefahren" ausgewiesen. Die Etappe hat die richtige Bauform fuer denselben
Fall bereits (supports_outbound fehlt -> unbekannt:pruefung1_supports_outbound, K-15) - die
Asymmetrie ist eine Luecke, keine Entscheidung.
FIX: fehlendes wert.agentId UND leeres soll.elAgentId je als eigenen GEZAEHLTEN unknown-Befund
melden (Muster K-15 / meldeUnbekannt, identisch zu pruefeFqdns/pruefeOvp), Test mit beiden
Faellen. Zusaetzlich ELEVENLABS_AGENT_ID in die Pflicht-Secret-Pruefung von
.github/workflows/outbound-drift.yml aufnehmen (dort stehen heute nur TELNYX_API_KEY,
ELEVENLABS_API_KEY, PLATFORM_ANI_E164) - sonst meldet der stuendliche externe Waechter dauerhaft
9/9 gruen, obwohl die Haelfte von Pruefung 1 nie ausgewertet wurde.`,

  `BLOCKER 2 - der ANI-Riegel misst die FALSCHE Nummer nach; PLAN-SECURITY.md und Runbook
behaupten das Gegenteil. src/telephony/outbound-gates.js#makeAniOwnershipGate loest auf dem
Marker drift:ownership_lost aus (aus Pruefung 3, betrifft N_ani = outbound.ani_override der
FQDN-Connection), ruft zur Live-Nachmessung aber aniOwnershipRecheck(ctx.fromNumber) - und
ctx.fromNumber ist die EIGENE aktive DID des anrufenden Tenants, nachweislich eine ANDERE Nummer
als die real gesendete. Folgen: (a) im echten 27.08.-Fall gehoert die Tenant-DID dem Konto
weiterhin -> Nachmessung false -> das Gate laesst durch, ist also genau dort inert, wo es
dokumentiert ist; (b) umgekehrt kann es einen Anruf ablehnen, weil eine unbeteiligte Tenant-DID
nicht aufloest. PLAN-SECURITY.md ("Eine LIVE-Nachmessung ... MUSS den Verlust im Moment des
Anrufs BESTAETIGEN") und docs/RUNBOOK-OUTBOUND.md ("lehnt der ANI-Riegel ab dem naechsten Anruf
mit 503 ab") sind damit unwahr. test/outbound-ani-gate.test.js G-2 kann es nicht fangen: die
Attrappe ist async () => true und ignoriert ihr Argument.
FIX: die Nachmessung auf die PLATTFORM-ANI fuehren (config.provisioning.platformAniE164 bzw. der
gemessene N_ani aus Pruefung 3, NICHT ctx.fromNumber) und einen Test ergaenzen, der die
uebergebene e164 BYTE-GENAU pinnt. Der Default AUS ist kein Freibrief - die Sicherheitsdoku
beschreibt eine Schutzwirkung, die der Code nicht hat.`,

  `BLOCKER 3 - kein Entprellen vor dem Versand, und die deklarierten Ausnahmen wirken in-process
gar nicht (PM-3). src/telephony/outbound-drift-watch.js#laufeDrift ruft fuer JEDEN Befund der
Klassen ownership/config/watchdog_stale bei JEDEM Lauf meldeBetreiberAlarm(...) - ungefilterter
Versand (outage-report.js -> sendeUeberBeideKanaele -> Mail + SMS). Keine Reservierung, keine
Entprellung davor: anders als E3b (claimVerdict/outageAlertDebounceMs) und anders als
meldeHoldEskalation (zuMelden). Der Kommentarkopf von meldeBetreiberAlarm behauptet
ausdruecklich das Gegenteil. Gemessen: 24 runDriftSweep-Aufrufe bei unveraendertem Ausfall ->
3 Mails + 9 Audit-Zeilen; im Stundentakt 24 Mails/Tag, der 27.08.-Ausfall lief 3 Tage.
Zweite Haelfte: laufeDrift uebergibt beurteileDrift KEINE ausnahmen -
outbound-drift-ausnahmen.json wird ausschliesslich von scripts/check-outbound-drift.mjs geladen,
"if (befund.ausgenommen) continue;" ist in-process TOT.
FIX: (1) Entprellung VOR dem Versand (offener Marker + Frist, Muster meldeHoldEskalation /
outageAlertDebounceMs); Test, der zwei aufeinanderfolgende Laeufe bei unveraendertem Befund auf
GENAU EINEN Versand pinnt. (2) Die Ausnahmequelle auch dem In-Prozess-Waechter zufuehren - EINE
Quelle fuer beide Wege, wie es outbound-config-soll.js fuer das Soll bereits macht.`,

  `BLOCKER 4 (S1-1) - die Selbstheilung ist unerreichbar, die fuenfte Befundklasse existiert in
KEINEM ausgelieferten Pfad. src/telephony/outbound-drift-watch.js:88,128,147 +
outbound-config-drift.js:319-328: beide Selbstheilungs-Bedingungen haengen an
zaehler.unknown === 0, das AUCH strukturell unvermeidbare unknowns zaehlt
(unbekannt:pruefung1_supports_outbound ist laut Diff-eigener Datei "STRUKTURELL, unabhaengig vom
Anbieterzustand"; "kein Verbrauch in 24h" nennt der Code selbst den "Regelfall bei ~1 Anruf/
Woche"). zaehler.unknown ist in Produktion IMMER > 0. Gemessene Gegenprobe: "gemessen=7 von 9
unbekannt=2" -> ownership-Marker geschlossen? false; drift_recovered? false; MESSUNG_OK_MARKER
geschrieben? false. Positiv-Kontrolle (supports_outbound:true + eine Anrufzeile) -> alles true.
Belegt: (a) schliesseVerschwundeneBefunde schliesst NIE etwas, ein behobener Ausfall bleibt ewig
offen; (b) letzteErfolgreicheMessungMs bleibt null -> pruefeStale kehrt sofort zurueck ->
watchdog_stale (PM-5, der Faenger fuer "der Fruehwarner selbst ist still gestorben") ist
UNERREICHBAR, obwohl das Runbook ihn als scharfen Meldeweg beschreibt; (c) dauerhafte
WARN-Muedigkeit. Die gruenen Tests W-3b/W-0 belegen das Gegenteil nur, weil ihre Fixtures einen
Zustand bauen, den Produktion nie erreicht.
FIX: (1) dieselbe Ausnahmequelle auch in-process laden (s. Blocker 3); (2) beide Bedingungen auf
NICHT-AUSGENOMMENE unknowns umstellen (z.B. zaehler.unknownOffen), damit "erklaerte Unwissenheit"
und "konnte nicht messen" unterscheidbar werden; (3) Test mit der PRODUKTIONSNAHEN Antwortform,
der beweist, dass messung-ok geschrieben und ein verschwundener Befund geschlossen wird.`,

  `BLOCKER 5 (S1-2) - dieselbe Klasse wie Blocker 1, zweite Fundstelle:
src/telephony/outbound-config-drift.js:126 faellt STILL aus, wenn ELEVENLABS_AGENT_ID leer ist
oder die Antwort keinen assigned_agent traegt - kein Befund, kein unknown, und "gemessen" zaehlt
Pruefung 1 trotzdem als gefahren. Gemessen: mit gesetztem soll.elAgentId ->
['config_el_agent_mismatch'], 9 von 9; mit LEEREM soll.elAgentId -> [], 9 von 9. Ein vollstaendig
gruener Bericht ueber eine Zuweisung, die nie verglichen wurde. ELEVENLABS_AGENT_ID ist in
render.yaml sync:false.
FIX: gemeinsam mit Blocker 1 loesen (meldeUnbekannt('pruefung1_agent', ...)), EINE Stelle.`,

  `BLOCKER 6 (S1-3) - scripts/check-outbound-drift.mjs (142 Zeilen neuer Produktionscode) hat
KEINEN einzigen automatisierten Test. Ungedeckt: schluesselFehlt() (die behauptete
Fail-closed-Eigenschaft "ohne TELNYX_API_KEY nie stilles OK"), ladeAusnahmen() (fehlende Datei ->
[]), die CLI-Variante von sollAusConfig(), melde()/Exit-Code-Zuordnung, umfangsZeile() und der
laut Plan woertlich verlangte D7-Anker pruefung3Zeile(). Bestehende Tests pruefen die Datei nur
per Quelltext-Grep. Der Bestandspraezedenzfall macht es anders:
test/elevenlabs-drift-rotprobe.test.js importiert istBlockierend AUS der Skriptdatei und fuehrt es aus.
FIX: Spawn-Test nach Bestandsmuster mit (a) Negativ-Kontrolle ohne TELNYX_API_KEY -> Exit 1 +
Fail-closed-Meldung, (b) Positiv-Kontrolle gegen einen LOKALEN Stub-Server -> Exit 0,
Umfangszeile "N von 9" und der D7-Anker "pruefung3 ownership=ok" im stdout. KEINE echten
Anbieter-Abfragen im Test.`,

  `BLOCKER 7 (S2-1) - Duplizierung (G5): die elRead-Closure steht wortgleich zweimal,
src/server.js:147-150 und scripts/check-outbound-drift.mjs:108-111:
  { fetchPhoneNumber: (phoneNumberId) => fetchPhoneNumber({ fetchImpl: fetch,
    account: config.voice.elevenLabsOutbound, phoneNumberId }) }
Exakt die Doppelung, die diese Phase fuer sollAusConfig selbst als Blocker beseitigt hat
("vergisst man eine, misst der CLI-Weg still etwas anderes als der In-Prozess-Waechter").
FIX: eine Fabrik makeElConfigRead(config) an EINER Stelle (neben sollAusConfig in
src/telephony/outbound-config-soll.js), beide Aufrufer darauf umstellen; den bestehenden
Grep-Test S-3 analog erweitern.`,
];

const REGELN = `RAHMEN (unantastbar):
- Safety-Gates NIE anfassen; Offenlegung/callee_is_owner nicht beruehren; Auth fail-closed;
  Secrets nur via env, NIE loggen. AUDIO nie durch MCP.
- KEINE echten Anrufe/SMS/Mails, KEINE Provider-SCHREIBzugriffe, KEIN Deploy. Anbieter-Abfragen in
  Tests ausschliesslich gegen Attrappen/lokale Stubs.
- PII: Befund, Log und Alarm tragen KEINE Rufnummern, Namen oder Gespraechsinhalte.
- SCOPE: NUR die sieben Blocker. Kein Umbau der Erkennungsregel, kein Vorgriff auf die
  Absender-Etappe (Tenant-DID als ANI), kein bridge.js. Die bereits abgenommenen Pruefpunkte der
  Etappe (erkennt ohne Verkehr, Positiv-Kontrolle, Takt, kein zweiter Meldeweg, kein
  Auto-Abschalten, externer Takt sichtbar, Fabrik-Vertrag, nur lesend, PII) duerfen sich NICHT
  verschlechtern.
- CLEAN-CODE (${REPO}/.claude/refs/clean-code.md): EINE Quelle je Frage (Ausnahmen, Soll,
  elRead-Closure); reine Urteilsfunktionen ohne Seiteneffekt; Schwellen/Fristen als benannte
  Konstanten; Kommentare deutsch OHNE Umlaute.
- LINT: npm run lint (VOLL, im Worktree) = 0 Fehler. Gepinnte Altlast-Werte NICHT anheben.
- Waehrend eines laufenden Testlaufs KEINE Dateien aendern, NIE zwei Suiten gleichzeitig.
- Fixtures NICHT auf Grenzwerte legen; Erwartungen aus dem Fixture ABLEITEN.`;

const FIX_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    headCommit: { type: "string" },
    filesTouched: { type: "array", items: { type: "string" } },
    testsAddedOrChanged: { type: "array", items: { type: "string" } },
    b1b5Proof: {
      type: "string",
      description: "Blocker 1+5 AUSGEFUEHRT: fehlende agentId und leeres soll.elAgentId ergeben je einen GEZAEHLTEN unknown-Befund, nie 9/9 gruen. Kommando + Ausgabe",
    },
    b2Proof: {
      type: "string",
      description: "Blocker 2 AUSGEFUEHRT: die Nachmessung erhaelt die PLATTFORM-ANI, byte-genau per Test gepinnt. Kommando + Ausgabe",
    },
    b3Proof: {
      type: "string",
      description: "Blocker 3 AUSGEFUEHRT: zwei Laeufe bei unveraendertem Befund -> GENAU EIN Versand; Ausnahmen wirken auch in-process. Kommando + Ausgabe",
    },
    b4Proof: {
      type: "string",
      description: "Blocker 4 AUSGEFUEHRT mit produktionsnaher Antwortform: messung-ok wird geschrieben, verschwundener Befund wird geschlossen, watchdog_stale ist erreichbar. Kommando + Ausgabe",
    },
    b6Proof: { type: "string", description: "Blocker 6 AUSGEFUEHRT: Spawn-Test des CLI-Skripts, Negativ- UND Positiv-Kontrolle. Kommando + Ausgabe" },
    b7Proof: { type: "string", description: "Blocker 7 AUSGEFUEHRT: eine Fabrik, beide Aufrufer umgestellt, Grep-Test erweitert. Kommando + Ausgabe" },
    liveLageProof: {
      type: "string",
      description: "Nachweis am Code, dass die HEUTIGE Live-Lage (EL-Nummer != ani_override, bewusst) NICHT zu stuendlichem Mail+SMS fuehrt. Kommando + Ausgabe",
    },
    keineVerschlechterungProof: { type: "string", description: "Die abgenommenen Pruefpunkte der Etappe unveraendert. Kommando + Ausgabe" },
    testsPass: { type: "boolean" },
    testPassCount: { type: "number" },
    testFailCount: { type: "number" },
    lintProof: { type: "string" },
    gatesProof: { type: "string" },
    committed: { type: "boolean" },
    deviations: { type: "array", items: { type: "string" } },
    summary: { type: "string" },
  },
  required: [
    "headCommit",
    "b1b5Proof",
    "b2Proof",
    "b3Proof",
    "b4Proof",
    "b6Proof",
    "b7Proof",
    "liveLageProof",
    "keineVerschlechterungProof",
    "testsPass",
    "testPassCount",
    "testFailCount",
    "lintProof",
    "gatesProof",
    "committed",
    "summary",
  ],
};

const SAFETY_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    b1b5Behoben: { type: "boolean", description: "SELBST gefahren: fehlende Agenten-Zuordnung und fehlendes Soll ergeben gezaehlte unknowns, nie stilles Gruen" },
    b2Behoben: { type: "boolean", description: "SELBST gefahren: die Nachmessung laeuft auf die Plattform-ANI; Test pinnt die uebergebene Nummer byte-genau" },
    b3Behoben: { type: "boolean", description: "SELBST gefahren: zwei Laeufe -> ein Versand; Ausnahmen wirken in-process" },
    b4Behoben: { type: "boolean", description: "SELBST gefahren mit produktionsnaher Antwort: Selbstheilung greift, watchdog_stale erreichbar" },
    b6Behoben: { type: "boolean", description: "SELBST gefahren: CLI-Spawn-Test mit Negativ- und Positiv-Kontrolle" },
    b7Behoben: { type: "boolean", description: "SELBST gegrept: nur noch EINE elRead-Fabrik" },
    liveLageTragbar: {
      type: "boolean",
      description: "SELBST geprueft: mit der HEUTIGEN Live-Lage (EL-Nummer +15739090177 != ani_override +18643028341) entsteht KEIN stuendlicher Mail/SMS-Sturm",
    },
    keineVerschlechterung: { type: "boolean", description: "SELBST stichprobenartig: erkennt-ohne-Verkehr, Positiv-Kontrolle, kein Auto-Abschalten, nur lesend, PII unveraendert" },
    sabotageSelbstRotGesehen: { type: "boolean", description: "SELBST ausgefuehrt: je Riegel einzeln entschaerft -> Test rot -> wiederhergestellt" },
    testsPassIndependently: { type: "boolean" },
    fullLintZeroErrors: { type: "boolean" },
    gatesNotWorse: { type: "boolean" },
    safetyGatesIntact: { type: "boolean" },
    dokuStimmtMitCodeUeberein: {
      type: "boolean",
      description: "SELBST geprueft: PLAN-SECURITY.md und docs/RUNBOOK-OUTBOUND.md beschreiben jetzt, was der Code TATSAECHLICH tut (Blocker 2)",
    },
    scopeRespected: { type: "boolean" },
    approved: { type: "boolean" },
    blockers: { type: "array", items: { type: "string" } },
    concerns: { type: "array", items: { type: "string" } },
    verdict: { type: "string" },
  },
  required: [
    "approved",
    "b1b5Behoben",
    "b2Behoben",
    "b3Behoben",
    "b4Behoben",
    "b6Behoben",
    "b7Behoben",
    "liveLageTragbar",
    "keineVerschlechterung",
    "sabotageSelbstRotGesehen",
    "testsPassIndependently",
    "fullLintZeroErrors",
    "gatesNotWorse",
    "safetyGatesIntact",
    "dokuStimmtMitCodeUeberein",
    "scopeRespected",
    "blockers",
    "verdict",
  ],
};

let target = BASE;
let round = 0;
let fix = null;
let safety = null;
const verlauf = [];

while (round < MAX_ROUNDS) {
  round++;
  const branch = round === 1 ? BRANCH : `${BRANCH}-r${round}`;
  phase("Fix");
  fix = await agent(
    `Du behebst in einem FRISCHEN Git-Worktree SIEBEN benannte Blocker der Etappe OUTBOUND-E4. Nichts sonst.
1. ln -s "${NODE_MODULES}" node_modules
2. git checkout -b ${branch} ${target}
3. Lies die Etappe "E4" und die Entwurfsentscheidung "E-6" in "${REPO}/${PLAN_DOC}".
${LIVE_LAGE}
${round > 1 ? `ACHTUNG Runde ${round}: der Review der Vorrunde meldete noch offen:\n${JSON.stringify((safety && safety.blockers) || [], null, 1)}\nBehebe ZUSAETZLICH diese.` : ""}
=== DIE SIEBEN BLOCKER ===
${BLOCKER.map((b, i) => `--- (${i + 1}) ---\n${b}`).join("\n\n")}
=== ENDE BLOCKER ===
${REGELN}
4. node --check auf jede geaenderte .js-Datei. ${TEST_CMD} - pass >= ${TEST_FLOOR}, fail == 0.
   npm run lint (VOLL) 0 Fehler. npm run test:gates nicht roeter als auf ${MASTER}.
5. ACHT BEWEISE, alle AUSFUEHREN: b1b5Proof, b2Proof, b3Proof, b4Proof, b6Proof, b7Proof,
   liveLageProof (der wichtigste fuer die Deploybarkeit!), keineVerschlechterungProof.
6. Wo die Doku (PLAN-SECURITY.md, docs/RUNBOOK-OUTBOUND.md) eine Schutzwirkung beschreibt, die der
   Code nach dem Fix hat oder NICHT hat: Doku an den Code angleichen, nicht umgekehrt.
7. node_modules NICHT committen. git add (Dateien EINZELN, nie -A) && git commit -m
   "fix(outbound-e4): die sieben Review-Blocker beheben". headCommit = git rev-parse HEAD.
EHRLICH fuellen; was du nicht loesen konntest, in deviations und summary nennen.`,
    { label: `e4-nachbesserung-fix-r${round}`, phase: "Fix", schema: FIX_SCHEMA, isolation: "worktree", ...FIX_AGENT },
  );
  verlauf.push(`r${round} fix: ${fix && fix.summary ? fix.summary.slice(0, 250) : "(kein Ergebnis)"}`);
  if (!fix || !fix.committed || !fix.headCommit) {
    verlauf.push(`r${round}: ABBRUCH - kein Commit vom Fix-Agenten.`);
    break;
  }
  target = branch;

  phase("Review");
  safety = await agent(
    `STRENGER, adversarialer Safety-Reviewer in frischem Worktree. Pruefe die NACHBESSERUNG der Etappe OUTBOUND-E4 auf Branch "${target}".
Die Etappe war inhaltlich bereits abgenommen bis auf SIEBEN Blocker. Deine Aufgabe: sind sie WIRKLICH weg, ohne dass etwas kaputtgeht - und ist die Etappe mit der HEUTIGEN Live-Lage deploybar?
1. ln -s "${NODE_MODULES}" node_modules
2. git checkout -b review-e4-nach-r${round} ${target}
3. ${TEST_CMD} SELBST (pass >= ${TEST_FLOOR}, fail 0; NIE zwei Suiten gleichzeitig). npm run lint SELBST (VOLL) = 0 Fehler. npm run test:gates auf ${target}.
4. Lies die Etappe E4 + E-6 in "${REPO}/${PLAN_DOC}", dazu PLAN-SECURITY.md und docs/RUNBOOK-OUTBOUND.md.
${LIVE_LAGE}
=== DIE SIEBEN BLOCKER (Original-Wortlaut) ===
${BLOCKER.map((b, i) => `--- (${i + 1}) ---\n${b}`).join("\n\n")}
=== ENDE BLOCKER ===
5. SELBST FAHREN, nichts uebernehmen - besonders:
   - **liveLageTragbar:** baue die HEUTIGE Anbieter-Lage als Attrappe nach (EL-Registrierung
     +15739090177, ani_override +18643028341, PLATFORM_ANI_E164 +18643028341) und lasse den
     Waechter MEHRFACH laufen. Entsteht daraus stuendlich Mail+SMS, ist die Etappe NICHT
     deploybar -> BLOCKER.
   - **b2Behoben:** pruefe, WELCHE Nummer die Nachmessung bekommt - eine Attrappe, die ihr
     Argument ignoriert, beweist nichts.
   - **b4Behoben:** mit der PRODUKTIONSNAHEN Antwortform (ohne supports_outbound, ohne Verkehr).
   - **dokuStimmtMitCodeUeberein:** Satz fuer Satz gegen den Code.
   - **sabotageSelbstRotGesehen:** je Riegel einzeln entschaerfen -> Test rot -> wiederherstellen,
     "git status --porcelain" am Ende leer.
6. git diff ${MASTER}..${target} durchsehen: kein Safety-Gate beruehrt, kein Provider-Schreibzugriff,
   kein Auto-Abschalten, Scope eingehalten.
${REGELN}
approved=true NUR wenn alle Punkte selbst gesehen. Rueckgabe IST das Urteil.`,
    { label: `e4-nachbesserung-review-r${round}`, phase: "Review", schema: SAFETY_SCHEMA, isolation: "worktree", ...SAFETY_AGENT },
  );
  verlauf.push(`r${round} review: approved=${safety && safety.approved} blockers=${((safety && safety.blockers) || []).length}`);
  if (safety && safety.approved) break;
}

const approved = !!(safety && safety.approved);
return {
  phaseId: "OUTBOUND-E4-NACHBESSERUNG",
  finalBranch: target,
  gate: approved ? "PASS" : "BLOCKED",
  approved,
  runden: round,
  b1b5Behoben: (safety && safety.b1b5Behoben) || false,
  b2Behoben: (safety && safety.b2Behoben) || false,
  b3Behoben: (safety && safety.b3Behoben) || false,
  b4Behoben: (safety && safety.b4Behoben) || false,
  b6Behoben: (safety && safety.b6Behoben) || false,
  b7Behoben: (safety && safety.b7Behoben) || false,
  liveLageTragbar: (safety && safety.liveLageTragbar) || false,
  keineVerschlechterung: (safety && safety.keineVerschlechterung) || false,
  dokuStimmtMitCodeUeberein: (safety && safety.dokuStimmtMitCodeUeberein) || false,
  testPassCount: (fix && fix.testPassCount) || null,
  fullLintZeroErrors: (safety && safety.fullLintZeroErrors) || false,
  blockers: (safety && safety.blockers) || [],
  concerns: (safety && safety.concerns) || [],
  deviations: (fix && fix.deviations) || [],
  verlauf,
  verdict: (safety && safety.verdict) || "",
  summary: (fix && fix.summary) || "",
};
