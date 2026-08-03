// PER-RUN-Skript KV-M0 (Kopie von kv-p0.js, Phase HART GEPINNT).
// Siehe Memory [[phase-impl-workflow-args]]: die Phase steht hier im Skript, nicht in args.

export const meta = {
  name: "phase-impl-lean",
  description:
    "KV-M0: Live-Konfiguration ins Boot-Banner - die Werte, die jede Zahl dieses Plans tragen, werden lesbar.",
  phases: [
    { title: "Plan", detail: "Code-gegroundeter Umsetzungsplan (clean-code.md + Plan-Doc + echter Code)" },
    { title: "Implementieren", detail: "Umsetzung im Worktree, npm test gruen" },
    { title: "Review", detail: "Safety/Verhalten + Clean-Code-Auditor (parallel)" },
    { title: "Self-Fix", detail: "S1/S2/Safety-Blocker fixen + Re-Review, bis PASS" },
    { title: "Report", detail: "Prozessbericht in tasks/kv-m0-report.md" },
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
const PHASE = "KV-M0";
const PHASE_TITLE = "Live-Konfiguration im Boot-Banner";
const BRANCH = "phase/kv-m0-boot-banner";
const BASE = "master";
const PLAN_DOC = "tasks/PLAN-KOSTEN-VOLLSTAENDIGKEIT.md";
const MAX_FIX_ROUNDS = 2;
const REPORT_PATH = "tasks/kv-m0-report.md";

const MODEL_SONNET = "sonnet";

// Modellpolitik (Kickoff KV-Kette): KV-M0 ist reine Ausgabe ohne Sperrwirkung und
// kippt keine Gate-Entscheidung -> die Phase laeuft KOMPLETT auf Sonnet.
// Pins explizit pro agent(), nie erben lassen (Memory [[workflow-model-policy]]).
const PLAN_AGENT = { model: MODEL_SONNET, effort: "medium" };
const IMPL_AGENT = { model: MODEL_SONNET };
const SAFETY_AGENT = { model: MODEL_SONNET, effort: "medium" };
const CLEANCODE_AGENT = { model: MODEL_SONNET, effort: "medium" };
const FIX_AGENT = { model: MODEL_SONNET, effort: "medium" };
const REPORT_AGENT = { model: MODEL_SONNET, effort: "low" };

const CLEAN_CODE_REQ = `CLEAN-CODE (PFLICHT): Lies "${REPO}/.claude/refs/clean-code.md" (verbindlicher Pruefkatalog) und befolge ihn bei JEDER Code-Entscheidung. Insbesondere: keine Duplizierung (G5/S2, EINE Quelle fuer eine Zugehoerigkeit); keine Magic Numbers ausser 0/1/-1 (G25, benannte Konstante); kein toter/auskommentierter Code (C5/G9), keine ungenutzten Imports (G12); intentions-ausdrueckende Namen (N1/N7); eine Aufgabe + eine Abstraktionsebene pro Funktion (G30/G34), <=3 Argumente (F1); keine brittle Datei:Zeile-Kommentare (C2); ESM, kein Build-Step, kein TypeScript.
UMLAUT-REGEL: Kommentare und Identifier OHNE Umlaute (ue/oe/ae) - wie im Bestand. Das Boot-Banner ist Betreiber-Log, kein gesprochener Nutzertext: es folgt derselben ASCII-Regel wie der uebrige Log-Bestand.`;

const ABS_RULES = `ABSOLUTE REGELN (unantastbar, siehe CLAUDE.md):
- Safety-Gates NIE entfernen/aufweichen/per-Default umgehen. Diese Phase aendert KEIN Verhalten - sie gibt aus.
- SECRETS: nur ueber env, NIEMALS loggen. Das ist in dieser Phase der zentrale Punkt: ein Boot-Banner ist eine Log-Zeile, die in Render-Logs landet. Es darf ausschliesslich Zahlen, Booleans, Modell-IDs und Typenlisten enthalten - NIE einen API-Key, ein Token, eine Signatur, ein Passwort, eine Kunden-Telefonnummer oder eine Tenant-Kennung.
- AUTH FAIL-CLOSED: keine Route, kein Endpunkt, keine neue Ausgabe ueber HTTP. Das Banner geht auf die Server-Konsole, nicht in eine API-Antwort.
- Disclosure-Satz (disclosureSentence) unberuehrt.
- SCOPE: NUR diese Phase. Keine ungefragten Extras. Keine neuen npm-Dependencies.`;

const KV_M0_SCOPE = `SCOPE DIESER PHASE (bindend):
ZIEL: Werte, die heute in Prod nicht lesbar sind, werden beim Boot ausgegeben. Es gibt kein Render-Lesetool fuer Env-Werte; ohne diese Ausgabe muss jede kuenftige Untersuchung aus Ledger-Zeilen rueckschliessen, was gesetzt ist. KV-M0 entsperrt damit jede Zahl der folgenden Phasen.

TEIL 1 - Das Banner erweitern:
Das bestehende Boot-Banner (in src/boot.js; zeigt heute u.a. BUDGET_MONTH_ENABLED, VOICE_ENGINE und die Kosten-Decken - finde die Stelle selbst per grep, uebernimm KEINE Zeilennummern) bekommt diese Werte dazu:
- PAYMENT_ENABLED (bereits anderweitig belegt, gehoert trotzdem ins Banner, damit die naechste Untersuchung nicht wieder ueber Ledger-Zeilen rueckschliessen muss)
- SMS_COST_CENTS
- COST_TRUING_REQUIRED_RECORD_TYPES (Typenliste)
- CLAUDE_MODEL
- PRECALL_BRIEFING_MODEL
- ELEVENLABS_PLAY_TTS_ENABLED
- BILLING_FLUSH_EPOCH (LEAD-ERGAENZUNG gegenueber dem Plan-Text, ausdruecklich begruendet: dieser Wert entstand gerade erst in KV-P0, er ist ein fail-closed-Riegel auf dem Geld-Pfad, und sein Zustand ist in Render genauso unlesbar wie die anderen sechs. Ihn wegzulassen hiesse, denselben blinden Fleck neu zu erzeugen, den diese Phase schliesst. Es ist ein Zeitstempel, kein Geheimnis. Ist er nicht gesetzt, MUSS das Banner das erkennbar machen - "nicht gesetzt" ist hier die betrieblich wichtigste Aussage, nicht ein leeres Feld.)

TEIL 2 - Die zwei Pflichttests (Abnahme aus dem Plan, woertlich):
(1) Ein Test, der die Banner-Ausgabe gegen die AUFGELOESTE Config haelt - NICHT gegen process.env. Das ist der Kern: das Banner soll zeigen, was der Dienst tatsaechlich benutzt, nicht was in der Umgebung steht. Wenn config.js einen Default anwendet, einen Wert normalisiert oder ihn verwirft, MUSS das Banner den benutzten Wert zeigen. Ein Test, der nur process.env gegen die Ausgabe haelt, misst die falsche Sache und ist eine verfehlte Abnahme.
(2) Ein Test, der die Banner-Ausgabe auf Secret-Muster greppt und ROT wird, wenn eines auftaucht: mindestens "sk_", "sk-", "Bearer ", "KEY=", "SECRET", "TOKEN", "PASSWORD", lange Base64-/Hex-Zeichenketten. Dieser Test ist der eigentliche bleibende Wert der Phase - er muss auch kuenftige Banner-Erweiterungen fangen, nicht nur die von heute. Baue ihn deshalb so, dass er die GESAMTE Banner-Ausgabe prueft und nicht nur die sieben neuen Felder.

FAIL-RICHTUNG: Ein nicht gesetzter Wert wird als solcher ausgewiesen ("nicht gesetzt"/"-"/"unset", eine Konvention, konsequent). Ein Banner, das einen fehlenden Wert wie einen gesetzten aussehen laesst, ist schlimmer als keins.

TEST-IDs: "KV-M0-N". NICHT mit einem i18n-Katalog-Praefix beginnen (DID|E2E|FMT|GAP|LANG|LAW|MCP|ORIG|OUT|PAY|PROMPT|UI|VOICE|WEB|WORLD gefolgt von einer Ziffer) - solche Tests landen still im test:gates-Lauf, wo Rot erlaubt ist.

NICHT-ZIELE (ausdruecklich):
- KEINE neue Env-Variable. Alle sieben Werte existieren bereits in src/config.js.
- KEIN Verhalten aendern: kein Gate, kein Default, keine Validierung, kein Boot-Refusal, kein neuer Boot-Guard. Diese Phase gibt aus, sie entscheidet nichts. Wenn dir beim Lesen ein fehlender Guard auffaellt, gehoert er in den Bericht, NICHT in den Diff.
- KEINE Aenderung an src/boot-guard.js, an der Gate-Achse, am Metering oder am Ist-Abgleich.
- KEIN Wert ueber HTTP ausgeben (kein /healthz-Feld, keine API-Antwort). Nur die Boot-Konsole.
- NIEMALS "git stash" (refs/stash ist zwischen Worktrees geteilt). NIEMALS "git add -A" - im Repo liegen untrackte Dateien mit Kundendaten. Dateien EINZELN adden.`;

// ---------- Phase 1: Plan ----------
phase("Plan");
const plan = await agent(
  `Du erstellst den DETAILLIERTEN, code-gegroundeten, CLEAN-CODE-KONFORMEN Umsetzungsplan fuer Phase ${PHASE} (${PHASE_TITLE}) im Repo "${REPO}". NUR PLANEN, NICHTS aendern.
1. Lies "${REPO}/${PLAN_DOC}" - den Abschnitt "KV-M0" und den Befund N3 (PAYMENT_ENABLED ist live true). Das Dokument ist die Autoritaet dieser Phase.
2. Lies "${REPO}/.claude/refs/clean-code.md" und "${REPO}/CLAUDE.md" (Absolute Regeln, Konventionen).
3. Lies den ECHTEN Code auf Basis "${BASE}" - grep nach Symbolen, uebernimm KEINE Zeilennummern (sie rotten): src/boot.js (das bestehende Boot-Banner: wie ist es aufgebaut, welche Formatierung/Konvention nutzt es, wie kommt es an die Config, wird es in Tests bereits abgefangen?), src/config.js (die sieben Werte: wie heissen sie in der aufgeloesten Config, in welchem Namespace liegen sie, welche Defaults/Normalisierungen greifen - besonders bei COST_TRUING_REQUIRED_RECORD_TYPES als Liste und BILLING_FLUSH_EPOCH als moeglicherweise null), test/ (grep nach dem Banner: gibt es schon einen Test, der die Boot-Ausgabe abfaengt? Wie faengt der Bestand Konsolen-Ausgabe ab - stdout-Capture, Logger-Stub, Spawn?), src/boot-guard.js (nur LESEN, um die Abgrenzung zu verstehen: Guards entscheiden, das Banner gibt aus).
4. ENTSCHEIDE UND BEGRUENDE: (a) Wie kommt der Test an die Banner-Ausgabe, ohne den Server zu spawnen? Wenn die Banner-Erzeugung heute untrennbar mit dem Ausgeben verwoben ist, ist die sauberste Loesung, die ZUSAMMENSTELLUNG der Zeilen von ihrer AUSGABE zu trennen (eine reine Funktion, die die Zeilen liefert; der Aufrufer druckt sie) - dann ist beides testbar, ohne stdout zu kapern. Pruefe, ob der Bestand das schon so macht, und weiche nur mit Begruendung davon ab. (b) Wie wird ein nicht gesetzter Wert dargestellt, konsequent fuer alle sieben? (c) Wie stellt der Secret-Test sicher, dass er auch KUENFTIGE Felder prueft und nicht nur die heutigen sieben? (d) Wie wird COST_TRUING_REQUIRED_RECORD_TYPES als Liste dargestellt, ohne die Zeile unlesbar zu machen?
5. Nenne ausdruecklich, welche Bestandstests kippen koennten (insbesondere solche, die Boot-Ausgabe oder Startverhalten pruefen) und wie du mit jedem umgehst.
6. PRE-MORTEM dieser Phase: ein Jahr spaeter hat das Banner Schaden angerichtet. Was ist passiert? Nenne mindestens: jemand hat spaeter ein Feld ergaenzt, das ein Secret trug, und der Test hat es nicht gefangen; das Banner zeigt process.env statt der aufgeloesten Config und jemand trifft eine Kosten-Entscheidung auf einem Wert, den der Dienst gar nicht benutzt; ein nicht gesetzter Wert sieht im Banner wie eine 0 aus. Fuer jedes: die Gegenmassnahme im Bauplan.
${KV_M0_SCOPE}
${CLEAN_CODE_REQ}
${ABS_RULES}
LIEFERE: (1) die exakten Edits je Datei (Vorher/Nachher-Skizze); (2) die Banner-Zeile(n) im Wortlaut, wie sie in der Konsole erscheinen werden, einmal mit allen Werten gesetzt und einmal mit keinem; (3) die Tests KV-M0-* mit konkreten Assertions (der Config-Test MUSS gegen die aufgeloeste Config pruefen, nicht gegen process.env - sag, wie du das erzwingst); (4) die Mutationsproben; (5) das Pre-Mortem mit Gegenmassnahmen. Kleiner Blast-Radius. Deine Rueckgabe IST der Plan.`,
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
    bannerSample: {
      type: "string",
      description:
        "Die tatsaechliche Banner-Ausgabe, einmal mit allen sieben Werten gesetzt und einmal mit keinem - woertlich kopiert, nicht nacherzaehlt",
    },
    resolvedConfigProof: {
      type: "string",
      description:
        "Womit ist belegt, dass das Banner die AUFGELOESTE Config zeigt und nicht process.env? Welcher Test, welcher Fall (z.B. ein Env-Wert, den config.js normalisiert oder verwirft)?",
    },
    secretGrepProof: {
      type: "string",
      description:
        "Wie prueft der Secret-Test die GESAMTE Banner-Ausgabe (nicht nur die neuen Felder), und welche Muster deckt er ab? Mutationsprobe: ein Feld mit Secret-Wert eingefuegt -> wurde er rot?",
    },
    unsetRepresentation: {
      type: "string",
      description: "Wie wird ein nicht gesetzter Wert dargestellt, und ist das von einer echten 0 unterscheidbar?",
    },
    noBehaviourChange: {
      type: "boolean",
      description:
        "MUSS true sein: kein Gate, kein Default, keine Validierung, kein Boot-Refusal, kein neuer Guard, keine neue Env-Variable",
    },
    nodeCheckPass: { type: "boolean" },
    testsPass: { type: "boolean" },
    testPassCount: { type: "number" },
    testFailCount: { type: "number" },
    gatesRedCount: { type: "number", description: "Rote Tests in npm run test:gates" },
    mutationProbeResult: { type: "string" },
    smokeTestResult: {
      type: "string",
      description:
        "Server lokal gestartet (PORT=0/3999, SKIP_TWILIO_SIGNATURE_CHECK=true) und die ECHTE Banner-Ausgabe gesehen? Ergebnis woertlich, oder ehrlich: nicht durchgefuehrt und warum",
    },
    findingsNotFixed: {
      type: "array",
      items: { type: "string" },
      description:
        "Beim Lesen aufgefallene Luecken/fehlende Guards, die BEWUSST NICHT gefixt wurden (Scope) - fuer den Bericht",
    },
    committed: { type: "boolean" },
    deviations: { type: "array", items: { type: "string" } },
    summary: { type: "string" },
  },
  required: [
    "headCommit",
    "bannerSample",
    "resolvedConfigProof",
    "secretGrepProof",
    "unsetRepresentation",
    "noBehaviourChange",
    "nodeCheckPass",
    "testsPass",
    "testPassCount",
    "testFailCount",
    "mutationProbeResult",
    "smokeTestResult",
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
3. Umsetzung: Banner-Erweiterung um die sieben Werte, Tests KV-M0-*.
4. node --check auf jede geaenderte src-Datei, dann npm test gruen. Dateien EINZELN adden, committen: "feat(kv-m0): Live-Konfiguration im Boot-Banner sichtbar machen".
${KV_M0_SCOPE}
${CLEAN_CODE_REQ}
5. npm test MUSS gruen sein. Kippende Bestandstests: jede Anpassung einzeln in existingTestsAdjusted begruenden.
6. npm run test:gates zusaetzlich fahren (DARF rot sein - Launch-Katalog). Zahl in gatesRedCount, und ob deine Aenderung sie erhoeht hat.
7. Mutationsproben: (a) ein Banner-Feld auf process.env statt auf die aufgeloeste Config umstellen -> wird der Config-Test rot? (b) ein Feld mit einem Secret-artigen Wert ins Banner einfuegen (z.B. "sk_test_abc123") -> wird der Secret-Test rot? Beide Mutationen ZURUECKNEHMEN, npm test erneut gruen. Der finale Diff darf keine Mutation tragen.
8. SMOKE-TEST (Pflicht in dieser Phase, weil die Abnahme eine ECHTE Konsolenausgabe ist): starte den Server lokal (PORT=0 oder PORT=3999, SKIP_TWILIO_SIGNATURE_CHECK=true, DATA_DIR auf ein Temp-Verzeichnis) und kopiere die tatsaechliche Banner-Ausgabe woertlich in bannerSample. Danach den Prozess wieder beenden. Wenn der Start scheitert, ist das ein Befund - melde ihn, schoene ihn nicht.
9. node_modules-Symlink NICHT committen. Nach dem Lauf: ps aux | grep "[n]ode src/server.js" - verwaiste Testserver beenden.
${ABS_RULES}
EHRLICH fuellen. Tests nicht gruen -> testsPass=false + deviations. resolvedConfigProof und secretGrepProof sind keine Floskeln.`,
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
    noSecretsInBanner: {
      type: "boolean",
      description:
        "SELBST geprueft: enthaelt die Banner-Ausgabe irgendeinen Wert, der ein Secret, ein Token, eine Signatur, eine Telefonnummer oder eine Tenant-Kennung sein koennte - heute oder bei naheliegender kuenftiger Erweiterung?",
    },
    secretTestCatchesFuture: {
      type: "boolean",
      description:
        "Prueft der Secret-Test die GESAMTE Banner-Ausgabe (faengt also auch kuenftige Felder) oder nur die sieben neuen? Selbst am Testcode nachgelesen.",
    },
    readsResolvedConfig: {
      type: "boolean",
      description: "Das Banner liest die aufgeloeste Config, NICHT process.env - selbst am Code nachgelesen",
    },
    noBehaviourChange: {
      type: "boolean",
      description:
        "Kein Gate, kein Default, keine Validierung, kein Boot-Refusal, kein neuer Guard, keine neue Env-Variable, keine Aenderung an boot-guard.js/Gate-Achse/Metering",
    },
    unsetIsDistinguishable: {
      type: "boolean",
      description: "Ein nicht gesetzter Wert ist im Banner von einer echten 0 / einem echten false unterscheidbar",
    },
    noHttpExposure: {
      type: "boolean",
      description: "Kein Wert wird ueber HTTP ausgegeben (kein /healthz-Feld, keine API-Antwort, keine MCP-Ausgabe)",
    },
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
    "noSecretsInBanner",
    "secretTestCatchesFuture",
    "readsResolvedConfig",
    "noBehaviourChange",
    "unsetIsDistinguishable",
    "noHttpExposure",
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
        `STRENGER, adversarialer Safety-/Verhaltens-Reviewer in frischem Worktree. Pruefe Phase ${PHASE} auf Branch "${target}". Diese Phase schreibt Konfigurationswerte in eine Log-Zeile, die in Render-Logs landet - der Secret-Aspekt ist der harte Teil.
1. ln -s "${NODE_MODULES}" node_modules
2. git checkout -b review-${String(PHASE).toLowerCase()}${suffix} ${target}
3. npm test selbst -> testsPassIndependently + Zahlen.
4. git diff ${BASE} ${target} gegen die absoluten Regeln pruefen.
${KV_M0_SCOPE}
PRUEFE BESONDERS, jeweils SELBST am Code nachgerechnet - nicht dem Impl-Bericht glauben:
- noSecretsInBanner: DAS IST DER WICHTIGSTE PUNKT. Gehe die ausgegebenen Felder EINZELN durch und frage bei jedem: kann dieser Wert in irgendeiner Konfiguration ein Geheimnis, ein Token, eine Kundennummer oder eine Tenant-Kennung sein? Achte besonders auf Werte, die "harmlos" aussehen: eine Modell-ID ist harmlos, aber eine URL kann einen Token im Query-String tragen. Ein Feld, das unter irgendeiner Konfiguration ein Secret ausgeben koennte, ist ein BLOCKER.
- secretTestCatchesFuture: lies den Secret-Test SELBST. Prueft er die gesamte Banner-Ausgabe oder nur die neuen Felder? Ein Test, der nur die heutigen sieben prueft, faengt die naechste Erweiterung nicht - und genau die ist der Fall, der in einem Jahr passiert. Fuege TESTWEISE ein achtes Feld mit dem Wert "sk_live_deadbeef" ins Banner ein: wird der Test rot? Wenn nein, ist das ein BLOCKER. Mutation zuruecknehmen.
- readsResolvedConfig: greppe den Banner-Code nach process.env. Jeder direkte process.env-Zugriff im Banner ist ein Verstoss gegen den Zweck der Phase (das Banner soll zeigen, was der Dienst BENUTZT) und mindestens eine schwere concern, bei einem der sieben Werte ein BLOCKER.
- noBehaviourChange: git diff auf src/boot-guard.js, src/config.js, src/store/**, src/billing/**. Wurde irgendwo eine Bedingung, ein Default oder eine Validierung veraendert? Diese Phase gibt aus - sie entscheidet nichts. Jede Verhaltensaenderung ist scope-fremd und ein BLOCKER.
- unsetIsDistinguishable: was zeigt das Banner bei einem nicht gesetzten Wert? Wenn "nicht gesetzt" wie "0" oder "false" aussieht, ist die Ausgabe irrefuehrend - Blocker, denn genau darauf sollen kuenftige Kosten-Entscheidungen gestuetzt werden.
- noHttpExposure: greppe nach neuen Feldern in /healthz, in API-Antworten, in MCP-Tool-Ausgaben. Das Banner gehoert auf die Konsole, nicht ins Netz.
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
Achte besonders auf: (a) die sieben Banner-Felder duerfen nicht als sieben kopierte Formatierungs-Ausdruecke dastehen (G5/S2) - eine Quelle, eine Formatierungsregel, eine Darstellung fuer "nicht gesetzt"; (b) die Zusammenstellung der Zeilen sollte von der Ausgabe getrennt sein (SRP/P2, und es ist die Voraussetzung fuer testbaren Code) - ist sie es nicht, pruefe ob der Bestand es vorgibt; (c) keine Magic Strings ohne Namen fuer die Trenn-/Praefix-Konvention (G25); (d) die neuen Tests: ein Konzept pro Test (P14), keine geteilte veraenderliche Fixture (P12), Build-Operate-Check (P13); (e) der Secret-Test darf seine Musterliste nicht dupliziert an zwei Stellen halten (G5); (f) Kommentare deutsch OHNE Umlaute; (g) toter/auskommentierter Code, ungenutzte Imports (C5/G9/G12).
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
${KV_M0_SCOPE}
${CLEAN_CODE_REQ}
${ABS_RULES}
4. node --check + npm test gruen. Dateien EINZELN adden (nie git add -A), kein git stash. node_modules NICHT committen. git commit -m "fix(kv-m0): Review-Blocker beheben (Runde ${round})". headCommit = git rev-parse HEAD.
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
EHRLICHKEITSREGEL: dieser Bericht darf KEINE Lesbarkeit behaupten, die nicht belegt ist. Das Banner wurde LOKAL gesehen, nicht in Render - was die Live-Werte tatsaechlich sind, weiss diese Phase NICHT und darf sie nicht behaupten. Das ist der ganze Punkt: die Phase macht die Werte lesbar, sie liest sie nicht.
Inhalt (Markdown): Phase ${PHASE} ${PHASE_TITLE}; Gate=${approved ? "PASS" : "BLOCKED"}; finalBranch=${reviewTarget}; was gebaut wurde; die tatsaechliche Banner-Ausgabe (bannerSample) woertlich in einem Codeblock, beide Faelle; der Beleg, dass die aufgeloeste Config gezeigt wird (resolvedConfigProof); der Secret-Test und wie er kuenftige Felder faengt (secretGrepProof); die Darstellung nicht gesetzter Werte; Mutationsproben; Smoke-Test-Ergebnis; angepasste Bestandstests; Safety-Urteil; Clean-Code-Audit (s1-s4); Fix-Runden; ein Abschnitt "Beim Lesen aufgefallen, bewusst NICHT gefixt" (findingsNotFixed - das ist wertvoll fuer die naechsten Phasen); ein Abschnitt "Was der Lead nach dem Deploy tun muss": die sieben Live-Werte aus dem Render-Boot-Log ablesen und in ${PLAN_DOC} eintragen - DAS ist die eigentliche Abnahme von KV-M0, und sie steht bis zum Deploy aus. Quelle:
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
  bannerSample: (impl && impl.bannerSample) || "",
  resolvedConfigProof: (impl && impl.resolvedConfigProof) || "",
  secretGrepProof: (impl && impl.secretGrepProof) || "",
  unsetRepresentation: (impl && impl.unsetRepresentation) || "",
  noBehaviourChange: impl ? impl.noBehaviourChange === true : false,
  smokeTestResult: (impl && impl.smokeTestResult) || "",
  findingsNotFixed: (impl && impl.findingsNotFixed) || [],
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
