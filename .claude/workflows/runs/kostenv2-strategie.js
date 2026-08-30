// KOSTEN-V2: Strategiedokument fuer die vollstaendige Ist-Kosten-Erfassung je Tenant
// nach dem ElevenLabs-Umstieg. Produkt ist EIN Dokument, kein Code.
//
// NACH DEN KOSTENREGELN gebaut (.claude/refs/workflow.md 2a, Lehre workflow-kosten-cache-reads):
// kurze Prompts, kurze Agenten, keine woertlichen Ausgaben, keine Testsuite in Agenten.
// Modelle sind an JEDEM agent() gepinnt (Lehre workflow-model-policy) - Vererbung waere
// ein Kosten-Bug. Joins laufen ausschliesslich ueber vom SKRIPT vergebene Indizes und
// Dateipfade, nie ueber vom Modell formulierten Text (Lehre workflow-join-on-model-field).
//
// Aufbau: 4 Befund-Agenten messen (parallel) -> 2 unabhaengige Entwuerfe (parallel) ->
// 3 Angreifer (Pre-Mortem / Clean-Code / Verifikations-Kritiker, parallel) -> 1 Synthese
// -> Abnahme-Schleife (Kritiker + Patcher, max 2 Runden). Hoechstens 13 Agenten.

export const meta = {
  name: "kostenv2-strategie",
  description:
    "Strategiedokument: alle Kosten eines Anrufs (ElevenLabs + Telnyx) vollstaendig je Tenant erfassen und abbuchen. Messen -> zwei Entwuerfe -> drei Angreifer -> Synthese -> Abnahme.",
  phases: [
    { title: "Befund", detail: "4 Agenten messen Code, ElevenLabs-API, Telnyx-Belege, Gate-Kette", model: "sonnet" },
    { title: "Entwurf", detail: "2 unabhaengige Architekturen, blind zueinander", model: "opus" },
    { title: "Angriff", detail: "Pre-Mortem, Clean-Code-Audit, Verifikations-Kritiker", model: "opus/sonnet" },
    { title: "Synthese", detail: "Das Strategiedokument mit Phasenkette schreiben", model: "opus" },
    { title: "Abnahme", detail: "Kritiker sucht Platzhalter und unbelegte Behauptungen, Patcher behebt", model: "opus/sonnet" },
  ],
};

const REPO = "/Users/antonio/Mein Unternehmen/MCP/vodafone-agent";
const DIR = "tasks/kostenv2";
const AUFTRAG = `${DIR}/AUFTRAG.md`;
const DOK = "tasks/PLAN-KOSTEN-V2.md";
const MAX_ABNAHME_RUNDEN = 9;

// Owner-Entscheidung 2026-08-30, NACH dem ersten Lauf eingegangen. Sie geht erst ab
// Runde 4 in den Patch-Auftrag, damit die Runden 1-3 wortgleich aus dem Cache kommen.
const OWNER_NACHTRAG = `

OWNER-ENTSCHEIDUNG (2026-08-30, verbindlich, kam nach dem Entwurf herein):
OpenAI Realtime wird bis auf Weiteres NICHT verwendet - Wortlaut: "spielt erstmal keine
Rolle, haben nicht vor das zu verwenden".
Trage das im Dokument so nach:
- Die Katalogzeile openai_realtime BLEIBT. Sie wird ausdruecklich als bewusst NICHT
  gebauter Kostentraeger gefuehrt, mit dieser Entscheidung und ihrem Datum als Begruendung.
- Ersatzloses Streichen ist FALSCH: "wird nicht verwendet" ist nicht "ist nicht
  einschaltbar". VOICE_ENGINE=realtime bleibt ein erreichbarer Schalter, und bridge.js
  bucht nichts. Sieh deshalb einen Riegel vor, der das Anschalten der Engine verhindert
  oder wenigstens laut meldet, solange ihr Kostenpfad fehlt - nach dem Muster der
  bestehenden Boot-Gates, ohne eine eigene Bauphase dafuer aufzumachen.
- Wo das Dokument diesen Punkt bisher als offene Owner-Frage fuehrt, wird daraus eine
  ENTSCHIEDENE Festlegung. Er darf danach in Abschnitt 7 nicht mehr als offen stehen.`;

// ---- Bausteine, die in jeden Prompt gehen. Kurz halten: der Prompt wird bei JEDEM Turn
// des Agenten erneut gelesen und bezahlt.

const SPARSAM = `KOSTEN (bindend):
- Zitiere KEINE Kommando-/API-Ausgaben woertlich. Zahlen, Feldnamen, Exit-Codes genuegen.
- Fahre NIEMALS die Testsuite. Kein npm test, kein node --test.
- Lies gezielt (grep, sed -n '<von>,<bis>p'). Nie eine Datei > 200 Zeilen am Stueck.
- Halte dich unter ~60 Turns. Kosten = Kontext x Turns, das waechst quadratisch.
- Keine Erkundungstour durchs Repo. Was du nicht brauchst, liest du nicht.`;

const REGELN = `REGELN:
- Arbeitsverzeichnis ${REPO}. NUR LESEN am Code - dieser Lauf aendert KEINEN Produktivcode.
- Schreiben ausschliesslich in die dir genannte Zieldatei.
- KEINE Secrets in Datei, Ausgabe oder Log. Schluessel nur in eine Shell-Variable lesen
  (z.B. K=$(grep -E '^X=' .env | cut -d= -f2-)), NIE ausgeben, NIE ins Dokument.
- Keine schreibenden Anbieter-Aufrufe. Keine echten Anrufe, keine SMS. Nur GET/lesend.
- Deutsch. Fliesstext darf Umlaute tragen, Code-Kommentare nicht.
- PLATZHALTER SIND UNZULAESSIG. Kein "TODO", kein "Test", kein "hier ergaenzen", keine
  leere Liste als Feigenblatt. Wenn du etwas nicht messen konntest, schreibst du das
  ausdruecklich als offene Frage MIT dem Grund - das ist ein gueltiges Ergebnis.
- Trenne strikt BELEGT (mit Datei:Zeile oder gemessenem Wert) von VERMUTET. Eine
  Vermutung ohne diese Kennzeichnung ist ein Fehler, kein Stil.`;

// ---- Phase 1: Befund. Vier eng geschnittene Messauftraege.
// Jeder schreibt seine Langfassung in eine eigene Datei und gibt nur eine knappe
// Struktur zurueck - so bleibt der Datenfluss zwischen den Phasen klein.

const BEFUNDE = [
  {
    id: "code",
    datei: `${DIR}/befund-code.md`,
    auftrag: `Die KOSTENPFADE IM CODE vollstaendig kartieren.
Fragen: Welche Buchungsstellen existieren (Gate-Achse usage.costCents vs Ledger
usage_event)? Wer schreibt sie, in welcher Reihenfolge, unter welchem Flag? Wie kommt
heute eine Kostenart hinein - und an welcher EINEN Stelle muesste eine neue (ElevenLabs)
eingehaengt werden, damit sie beide Buecher erreicht?
Einstiege: src/billing/ (metering.js, cost-truing.js, cost-ledger-map.js, meter.js),
src/store/state-ops.js (bookCents, trackUsage, applyCostCorrectionCents,
addVoiceUsageCostCents, applyCreditCents), src/llm-usage.js, src/telephony/call-finish.js.
Nenne fuer jede Buchungsstelle Datei:Zeile. Beurteile ausdruecklich, ob
cost-ledger-map.js als Vollstaendigkeits-Struktur taugt, um "eine Kostenart fehlt" zum
Bauzeit-Fehler statt zum Sorgfaltsproblem zu machen.`,
  },
  {
    id: "elevenlabs",
    datei: `${DIR}/befund-elevenlabs.md`,
    auftrag: `Die ELEVENLABS-KOSTENQUELLE messen (offene Punkte O3, O4, O5 des Auftrags).
Schluessel: ELEVENLABS_API_KEY aus .env, Header xi-api-key. NUR GET.
Die Anruf- und Conversation-IDs stehen im Auftrag (Tabelle unter B2); weitere findest du
ueber GET /v1/convai/conversations?agent_id=... - der Agent steht als ELEVENLABS_AGENT_ID
in .env.
Zu klaeren, jeweils mit gemessenem Beleg:
1. Welche Felder tragen die Kosten, in welcher Einheit (metadata.cost, cost_fiat,
   charging.*)? Ist cost_fiat wirklich USD?
2. Ab wann nach Gespraechsende ist der Wert da? Rufe eine Konversation MEHRFACH ab und
   pruefe, ob der Wert sich noch aendert. Wenn du kein frisches Gespraech hast, sage das
   und leite die Frage als offen weiter - NICHT raten.
3. Was steht in charging.tier, und was passiert laut oeffentlicher Preisliste bei einem
   Plan-Wechsel (rueckwirkend oder nur vorwaerts)?
4. Rate-Limits auf dem Abruf (Header pruefen).
5. Gibt es einen Kontostands-/Verbrauchs-Endpunkt (z.B. /v1/user/subscription), der als
   zweite, unabhaengige Kontrolle gegen die Summe der Einzelgespraeche taugt?
Vergleiche zum Schluss die Summe der Einzel-Gespraechskosten gegen diesen Kontostand,
falls verfuegbar, und nenne die Abweichung.`,
  },
  {
    id: "telnyx",
    datei: `${DIR}/befund-telnyx.md`,
    auftrag: `Den TELNYX-BELEGPFAD fuer die SIP-Trunk-Legs messen (offene Punkte O1, O2).
Das ist die wichtigste offene Frage des ganzen Laufs: OB Telnyx fuer die EL-Anrufe
ueberhaupt Belege fuehrt und unter WELCHEM Schluessel sie auffindbar sind.
Schluessel: TELNYX_API_KEY aus .env. NUR GET.
Der bestehende Abrufcode steht in src/telephony/adapters/telnyx/ (suche nach
fetchCostRecordPool / assignCostRecords) - lies ihn, um Endpunkt und Parameterform zu
uebernehmen, statt sie zu erfinden.
Zu klaeren, jeweils mit gemessenem Beleg:
1. Liefert /v2/detail_records fuer den Zeitraum 19.08.-30.08.2026 Belege vom Typ
   'sip-trunking'? Wie viele, mit welchen Feldern?
2. Traegt irgendein Beleg die otb_-Kennung aus call.sip_call_id? Konkrete IDs stehen im
   Auftrag. Wenn nein: welches Feld verbindet den Beleg sonst mit unserem Anruf
   (Zeitfenster + Zielnummer + DID)? Wie eindeutig ist das wirklich?
3. Wie hoch ist der Telnyx-Anteil je Minute auf dieser Strecke (Einheit beachten: die
   Betraege kommen in 10^-8-Einheiten, das ist im Repo belegt)?
4. Gibt es ueberhaupt keinen Beleg? Dann ist DAS das Ergebnis - sage es klar, denn es
   entscheidet die Architektur.
WICHTIG: ein Abruf, der 0 Treffer liefert, ist erst dann eine Aussage, wenn du mit einer
POSITIV-KONTROLLE gezeigt hast, dass dieselbe Abfrage bei bekannten Altdaten (31.07.-12.08.,
Telnyx-Engine, call_control_id vorhanden) Treffer LIEFERT. Ohne diese Gegenprobe sieht
"nichts gefunden" genauso aus wie "falsch gefragt".`,
  },
  {
    id: "gate",
    datei: `${DIR}/befund-gate.md`,
    auftrag: `Die GELD-SPERRKETTE und ihre Multi-Tenant-Wirksamkeit pruefen (O6, O7).
Zu klaeren:
1. Die Kette vom Guthaben bis zur Ablehnung: tenant_budget -> effectiveCapCents ->
   budgetExceeded/liveBudgetExceeded -> blockingBudgetAxis -> reserve_budget-Gate.
   Nenne je Glied Datei:Zeile. Wo genau wuerde eine zusaetzliche, nachtraeglich gebuchte
   Kostenart wirksam - und wo nicht?
2. Perioden-Achse: budgetPeriodUsageCents, stampBudgetPeriod, budget_period_baseline.
   Was passiert mit einer Ist-Korrektur, die NACH einem Periodenwechsel eintrifft? Die
   Anker-Mechanik (chargeAnchors, applyCreditCents) ist dafuer gebaut - haelt sie?
3. INBOUND: laeuft eingehender Verkehr heute ueber ElevenLabs oder ueber den Bestandsweg?
   Belege es am Code (routes/voice.js, telnyx-inbound.js). Wenn ja, gelten B1 und B2 dort
   genauso, und das muss das Dokument tragen.
4. Plattform-Fixkosten ohne Tenant-Dimension (PLATFORM_FIXED_COST_CENTS_PER_MONTH,
   TTS_CHARACTER_QUOTA, DID-Monatsmiete): welche gibt es, welche werden heute auf Tenants
   umgelegt, welche nicht? Nur den IST-Zustand feststellen, nicht entscheiden.
5. Gegenprobe an der Produktions-DB (nur SELECT): stimmt die Kette rechnerisch fuer die
   vier vorhandenen Tenants? Zugang: psql "$(cat ~/.config/hermes/db-url)" -c "..."; die
   Tabellen call/usage/usage_event/tenant_budget stehen unter FORCE ROW LEVEL SECURITY,
   deshalb vor jedem SELECT im selben -c-Aufruf: set app.current_tenant = '<tenantId>';`,
  },
];

const BEFUND_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    dateiGeschrieben: { type: "boolean" },
    belegt: {
      type: "array",
      maxItems: 12,
      items: { type: "string" },
      description: "Je Eintrag EIN gesicherter Fakt mit Beleg (Datei:Zeile oder gemessener Wert). Ein Satz.",
    },
    offen: {
      type: "array",
      maxItems: 8,
      items: { type: "string" },
      description: "Was NICHT geklaert werden konnte, je mit Grund. Ein Satz.",
    },
    ueberraschungen: {
      type: "array",
      maxItems: 5,
      items: { type: "string" },
      description: "Funde, die der Auftrag NICHT erwartet hat und die die Architektur beeinflussen.",
    },
    kernaussage: { type: "string", description: "Max 3 Saetze. Was heisst der Befund fuer den Entwurf?" },
  },
  required: ["dateiGeschrieben", "belegt", "offen", "ueberraschungen", "kernaussage"],
};

function befundPrompt(b) {
  return `${SPARSAM}

${REGELN}

Lies zuerst ${AUFTRAG} - dort steht die bereits gesicherte Beweislage. Was dort als BELEGT
steht, erforschst du NICHT neu. Was dort als OFFEN steht, ist dein Arbeitsauftrag.

DEIN AUFTRAG (${b.id}):
${b.auftrag}

Schreibe deine Langfassung nach ${b.datei}: Fakt, Beleg, Bedeutung. Der Rueckgabewert ist
nur die Kurzform. Widerspricht dein Befund dem Auftrag, sagst du das ausdruecklich - der
Auftrag ist die Beweislage EINES Beobachters, nicht die Wahrheit.`;
}

// ---- Phase 2: Zwei Entwuerfe, bewusst mit verschiedener Grundhaltung, damit die
// Synthese wirklich etwas zu waehlen hat statt zweimal dasselbe zu lesen.

const ENTWUERFE = [
  {
    id: "A",
    datei: `${DIR}/entwurf-a.md`,
    haltung: `HALTUNG A - "Beleg je Kostentraeger".
Denke die Loesung vom ANBIETER-BELEG her: jeder Kostentraeger (ElevenLabs, Telnyx, unsere
eigenen LLM-Aufrufe) liefert einen eigenen Beleg, der Abgleich sammelt sie je Anruf ein
und bucht erst, wenn die Menge vollstaendig ist. Der bestehende cost-truing-Sweep waere
die Grundlage, die auf mehrere Traeger erweitert wird.
Deine Pflicht: zeige, wie Teil-Belege behandelt werden (ein Traeger antwortet, der andere
nicht), ohne in die B6-Falle zu laufen.`,
  },
  {
    id: "B",
    datei: `${DIR}/entwurf-b.md`,
    haltung: `HALTUNG B - "Anbieter-Kosten als erste Klasse".
Denke die Loesung vom DATENMODELL her: eine Kostenart ist ein eigenes Ding mit Quelle,
Waehrung, Zeitpunkt und Anruf-Bezug; der Anruf traegt eine Menge davon; Gate-Achse und
Ledger sind zwei Projektionen derselben Menge statt zweier getrennt gepflegter Buecher.
Der Abgleich wird dadurch zum Nachtragen fehlender Posten, nicht zum Korrigieren einer
Pauschale.
Deine Pflicht: zeige den Migrationsweg vom heutigen Zwei-Buecher-Zustand dorthin, in
Schritten, die einzeln lieferbar sind und die Sperrwirkung nie unterbrechen.`,
  },
];

const ENTWURF_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    dateiGeschrieben: { type: "boolean" },
    kernidee: { type: "string", description: "Max 4 Saetze." },
    phasen: {
      type: "array",
      maxItems: 10,
      items: { type: "string" },
      description: "Je Eintrag: Phasenname + was sie liefert + ihr Abnahmekriterium. Ein bis zwei Saetze.",
    },
    risiken: { type: "array", maxItems: 8, items: { type: "string" } },
    b6FalleVermieden: {
      type: "string",
      description: "Konkret: warum kann dieser Entwurf die Schaetzung NICHT auf einen unvollstaendigen Beleg heruntersetzen?",
    },
    offeneEntscheidungen: {
      type: "array",
      maxItems: 6,
      items: { type: "string" },
      description: "Was der Eigentuemer entscheiden muss, weil es keine technisch richtige Antwort gibt.",
    },
  },
  required: ["dateiGeschrieben", "kernidee", "phasen", "risiken", "b6FalleVermieden", "offeneEntscheidungen"],
};

function entwurfPrompt(e, befundDateien) {
  return `${SPARSAM}

${REGELN}

Du entwirfst eine Architektur, die dieses Ziel erfuellt: wenn ein Tenant zwei Minuten
telefoniert hat, sind ALLE dabei verursachten Kosten erfasst und von seinem Guthaben
abgebucht - fuer jeden Tenant, dauerhaft, ohne boese Ueberraschung in einem Monat.

Lies: ${AUFTRAG} (Beweislage) und die vier Befunde: ${befundDateien.join(", ")}.
Du arbeitest BLIND zum zweiten Entwurf - vergleiche dich nicht, entwirf deinen.

${e.haltung}

PFLICHTTEILE deiner Datei ${e.datei}:
1. Das Zielbild in einem Absatz.
2. Die Kostenarten-Tabelle: je Art die Quelle, die Waehrung, der Zeitpunkt der
   Verfuegbarkeit, der Weg in Gate-Achse UND Ledger. Keine Art darf fehlen - auch die
   nicht, die du bewusst NICHT je Tenant umlegen willst (dann steht dort die Begruendung).
3. Der Abgleich: wann wird nachgebucht, wann zurueckgegeben, welcher Beweis ist dafuer
   noetig. Die bestehende Asymmetrie (nachbuchen immer, erstatten nur bei vollstaendigem
   Beleg) ist das Vorbild.
4. Was passiert, wenn ein Anbieter-Beleg NIE kommt. Der Anruf darf nicht ewig offen
   bleiben und die Schaetzung nicht stillschweigend verfallen.
5. Der Alarmweg: woran merkt der Eigentuemer binnen Stunden, dass die Erfassung ausgefallen
   ist? Beachte den belegten Befund B3 - console.log erreicht niemanden.
6. Die Tarif-/Preisherleitung: wie kommt der Vorab-Schaetzsatz kuenftig zustande und wie
   wird er nachgezogen, ohne dass jemand daran denken muss.
7. Die Phasenkette. Jede Phase klein, einzeln lieferbar, mit einem Abnahmekriterium, das
   OHNE echten Anruf pruefbar ist. Jede Phase so beschrieben, dass eine spaetere Session
   sie ohne Rueckfrage bauen kann.
8. Was du bewusst NICHT tust und warum.

Beziehe dich auf Datei:Zeile, wo du bestehenden Code meinst. Erfinde keine Funktionsnamen -
pruefe am Code, ob es sie gibt.`;
}

// ---- Phase 3: Drei Angreifer auf BEIDE Entwuerfe.

const ANGRIFF_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    dateiGeschrieben: { type: "boolean" },
    befunde: {
      type: "array",
      maxItems: 14,
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          entwurf: { type: "string", enum: ["A", "B", "beide"] },
          schwere: { type: "string", enum: ["blocker", "ernst", "hinweis"] },
          aussage: { type: "string", description: "Der Defekt in einem Satz." },
          beleg: { type: "string", description: "Warum das stimmt: Datei:Zeile, Auftragspunkt oder konkretes Szenario." },
          abhilfe: { type: "string", description: "Was stattdessen zu tun ist. Ein Satz." },
        },
        required: ["entwurf", "schwere", "aussage", "beleg", "abhilfe"],
      },
    },
    urteil: { type: "string", description: "Max 3 Saetze: welcher Entwurf traegt besser, und woran haengt das?" },
  },
  required: ["dateiGeschrieben", "befunde", "urteil"],
};

const ANGREIFER = [
  {
    id: "premortem",
    datei: `${DIR}/angriff-premortem.md`,
    model: "opus",
    effort: "high",
    auftrag: `PRE-MORTEM. Versetze dich auf den 30. August 2027. Beide Entwuerfe wurden
gebaut, und die Kostenerfassung ist GESCHEITERT: entweder hat ein Tenant monatelang mehr
verbraucht als bezahlt, oder Kunden wurden systematisch zu viel belastet, oder die
Erfassung ist wieder still ausgefallen und es hat wieder niemand gemerkt.
Frage rueckwaerts: was ist passiert? Was hat dazu gefuehrt?
Arbeite mindestens diese Achsen ab, jede mit einem konkreten Ablauf:
- Der Anbieter aendert etwas (Preis, Feldname, Plan-Stufe, Rate-Limit, Endpunkt).
- Ein Beleg kommt verspaetet, doppelt, oder nach einem Periodenwechsel.
- Zwei Server-Instanzen laufen gleichzeitig (der prozesslokale Laufriegel faellt).
- Ein Anruf endet unsauber: Deploy mitten im Gespraech, verlorener Webhook, Zombie-Leg.
- Waehrungskurs, Rundung, Vorzeichen.
- Ein neuer Kanal kommt dazu (Inbound ueber EL, WhatsApp, ein zweiter Anbieter) und
  niemand denkt an die Kostenerfassung.
- Der Alarm feuert, aber ins Leere - schon einmal passiert, siehe B3.
Nur Szenarien, die aus DIESEN Entwuerfen folgen. Keine allgemeine Risikoprosa.`,
  },
  {
    id: "cleancode",
    datei: `${DIR}/angriff-cleancode.md`,
    model: "sonnet",
    effort: "high",
    auftrag: `CLEAN-CODE-AUDIT der beiden Entwuerfe gegen .claude/refs/clean-code.md
(lies das Dokument zuerst) und gegen die im Repo bereits geltenden Prinzipien.
Pruefe insbesondere:
- Eine Wahrheit je Sachverhalt (G5): schafft der Entwurf eine ZWEITE Stelle, die dieselbe
  Frage beantwortet? Zwei Preisquellen, zwei Vollstaendigkeits-Praedikate, zwei
  Waehrungsumrechnungen - genau daran ist die bestehende Kette schon dreimal gescheitert.
- Struktur statt Konvention (G27): faellt eine vergessene Kostenart beim Bauen auf, oder
  erst wenn Geld fehlt?
- Zwei Sachverhalte auf einem Label: "kein Beleg" und "Beleg sagt null" duerfen nie
  denselben Zustand teilen. Pruefe jeden vorgeschlagenen Zustand darauf.
- Funktionslaenge, Verschachtelung, Argumentzahl der vorgeschlagenen Nahtstellen.
- Magic Numbers, tote Pfade, abgeschaltete Sicherungen.
- Benennung: behauptet ein vorgeschlagener Name etwas, das die Sache nicht tut?
Beurteile auch, ob die vorgeschlagene Phasenkette WIRKLICH in einzeln lieferbare Stuecke
zerfaellt oder ob eine Phase heimlich die halbe Umstellung enthaelt.`,
  },
  {
    id: "kritiker",
    datei: `${DIR}/angriff-kritiker.md`,
    model: "opus",
    effort: "high",
    auftrag: `VERIFIKATIONS-KRITIKER. Deine einzige Frage: worauf stuetzt sich das hier
eigentlich?
Gehe beide Entwuerfe Satz fuer Satz durch und markiere jede tragende Behauptung als
BELEGT (mit nachpruefbarer Quelle) oder BEHAUPTET. Fuer jede BEHAUPTETE Aussage, auf der
Geld ruht, forderst du die Messung, die sie belegen wuerde - konkret, ausfuehrbar.
Pruefe ausserdem stichprobenartig am echten Code, ob die genannten Funktionsnamen,
Dateipfade und Zeilennummern tatsaechlich existieren und das tun, was der Entwurf
behauptet. Nimm mindestens 6 Stichproben, verteilt ueber beide Entwuerfe. Ein Entwurf,
der eine Funktion erfindet, ist an dieser Stelle unbrauchbar - sage das dann klar.
Pruefe zuletzt die VOLLSTAENDIGKEIT: welche Kostenart, welcher Kanal, welcher Zustand
kommt in KEINEM der beiden Entwuerfe vor? Das Ziel lautet "alle Kosten" - was fehlt?`,
  },
];

function angriffPrompt(a, entwurfDateien) {
  return `${SPARSAM}

${REGELN}

Du greifst zwei Architektur-Entwuerfe an, BEVOR sie gebaut werden. Wohlwollen hilft hier
niemandem: was du jetzt findest, kostet nichts, was du durchlaesst, kostet echtes Geld.

Lies: ${AUFTRAG}, dann beide Entwuerfe (${entwurfDateien.join(", ")}).

${a.auftrag}

Schreibe deine Langfassung nach ${a.datei}. Rueckgabewert ist die strukturierte Kurzform.
Vergib "blocker" nur, wenn der Entwurf so nicht gebaut werden darf. Findest du wenig,
sagst du das - erfinde keine Befunde, um die Liste zu fuellen.`;
}

// ---- Phase 4/5: Synthese und Abnahme.

const SYNTHESE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    dokGeschrieben: { type: "boolean" },
    phasenAnzahl: { type: "integer" },
    gewaehlterEntwurf: { type: "string", enum: ["A", "B", "misch"] },
    blockerEingearbeitet: { type: "integer", description: "Zahl der uebernommenen blocker/ernst-Befunde" },
    blockerVerworfen: {
      type: "array",
      maxItems: 6,
      items: { type: "string" },
      description: "Bewusst NICHT uebernommene Befunde, je mit Begruendung.",
    },
    offeneEigentuemerEntscheidungen: { type: "array", maxItems: 8, items: { type: "string" } },
    kernaussage: { type: "string", description: "Max 4 Saetze." },
  },
  required: ["dokGeschrieben", "phasenAnzahl", "gewaehlterEntwurf", "blockerEingearbeitet", "blockerVerworfen", "offeneEigentuemerEntscheidungen", "kernaussage"],
};

const ABNAHME_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    gate: { type: "string", enum: ["PASS", "BLOCKED"] },
    platzhalterGefunden: { type: "integer" },
    maengel: {
      type: "array",
      maxItems: 12,
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          stelle: { type: "string", description: "Abschnitt/Ueberschrift im Dokument." },
          mangel: { type: "string" },
          fix: { type: "string", description: "Was konkret zu aendern ist." },
        },
        required: ["stelle", "mangel", "fix"],
      },
    },
    urteil: { type: "string", description: "Max 3 Saetze." },
  },
  required: ["gate", "platzhalterGefunden", "maengel", "urteil"],
};

// ================= Ablauf =================

log("Kosten-V2: Befundphase - 4 Agenten messen parallel (Code, ElevenLabs, Telnyx, Gate-Kette).");

phase("Befund");
// BARRIERE gerechtfertigt: beide Entwuerfe brauchen ALLE vier Befunde gemeinsam - ein
// Entwurf auf halber Faktenlage ist der Fehler, den dieser Lauf gerade verhindern soll.
const befunde = await parallel(
  BEFUNDE.map((b) => () =>
    agent(befundPrompt(b), {
      label: `befund:${b.id}`,
      phase: "Befund",
      model: "sonnet",
      effort: "high",
      schema: BEFUND_SCHEMA,
    }),
  ),
);

// Join ueber den SKRIPT-Index, nie ueber Modelltext (Lehre workflow-join-on-model-field).
const befundOk = befunde.filter(Boolean).length;
log(`Befund: ${befundOk}/${BEFUNDE.length} Agenten geliefert.`);
befunde.forEach((r, i) => {
  if (!r) log(`  ! ${BEFUNDE[i].id}: kein Ergebnis`);
  else log(`  - ${BEFUNDE[i].id}: ${r.belegt.length} belegt, ${r.offen.length} offen, ${r.ueberraschungen.length} Ueberraschungen`);
});
if (befundOk === 0) return { abbruch: "kein einziger Befund - Entwurf waere Raterei" };

const befundDateien = BEFUNDE.filter((_, i) => befunde[i]).map((b) => b.datei);

phase("Entwurf");
// BARRIERE gerechtfertigt: die drei Angreifer lesen BEIDE Entwuerfe und vergleichen sie.
const entwuerfe = await parallel(
  ENTWUERFE.map((e) => () =>
    agent(entwurfPrompt(e, befundDateien), {
      label: `entwurf:${e.id}`,
      phase: "Entwurf",
      model: "opus",
      effort: "high",
      schema: ENTWURF_SCHEMA,
    }),
  ),
);
const entwurfOk = entwuerfe.filter(Boolean).length;
log(`Entwurf: ${entwurfOk}/2 geliefert.`);
if (entwurfOk === 0) return { abbruch: "kein Entwurf - nichts zu pruefen" };

const entwurfDateien = ENTWUERFE.filter((_, i) => entwuerfe[i]).map((e) => e.datei);

phase("Angriff");
// BARRIERE gerechtfertigt: die Synthese muss alle drei Angriffe zusammen abwaegen.
const angriffe = await parallel(
  ANGREIFER.map((a) => () =>
    agent(angriffPrompt(a, entwurfDateien), {
      label: `angriff:${a.id}`,
      phase: "Angriff",
      model: a.model,
      effort: a.effort,
      schema: ANGRIFF_SCHEMA,
    }),
  ),
);
const alleBefunde = angriffe.filter(Boolean).flatMap((a) => a.befunde);
const blocker = alleBefunde.filter((b) => b.schwere === "blocker");
log(`Angriff: ${angriffe.filter(Boolean).length}/3 geliefert, ${alleBefunde.length} Befunde davon ${blocker.length} Blocker.`);

const angriffDateien = ANGREIFER.filter((_, i) => angriffe[i]).map((a) => a.datei);

phase("Synthese");
const synthese = await agent(
  `${SPARSAM}

${REGELN}

Du schreibst das ENDGUELTIGE Strategiedokument nach ${DOK}. Es geht an eine spaetere
Session, die danach baut - ohne dich fragen zu koennen.

Lies in dieser Reihenfolge: ${AUFTRAG}, die Entwuerfe (${entwurfDateien.join(", ")}), die
Angriffe (${angriffDateien.join(", ")}). Die Befunde (${befundDateien.join(", ")}) ziehst
du heran, wo du einen Beleg brauchst.

Es gibt ${blocker.length} als "blocker" eingestufte Befunde. Jeder wird entweder
eingearbeitet oder mit Begruendung verworfen - stillschweigend uebergehen ist unzulaessig.

AUFBAU des Dokuments:
1. Das Problem in einem Absatz, mit den belegten Zahlen aus dem Auftrag.
2. Zielbild: was am Ende gilt.
3. Die Kostenarten-Tabelle. Je Art: Quelle, Waehrung, Verfuegbarkeit, Weg in Gate-Achse,
   Weg in Ledger, Preisherleitung. Vollstaendig - auch bewusst nicht umgelegte Arten.
4. Architektur-Entscheidung: welcher Entwurf traegt, was du aus dem anderen uebernimmst,
   und WARUM. Nenne die Entscheidung, nicht beide Optionen.
5. Die Phasenkette. Je Phase: Nummer, Titel, Ziel in zwei Saetzen, betroffene Dateien,
   Abnahmekriterium (ohne echten Anruf pruefbar), Abgrenzung ("was diese Phase NICHT
   tut"), Abhaengigkeit von Vorphasen. So geschnitten, dass jede Phase als eigener
   Workflow lauffaehig ist.
6. Pre-Mortem: die Szenarien aus dem Angriff, je mit Gegenmassnahme ODER der
   ausdruecklichen Notiz "akzeptiertes Risiko, weil ...".
7. Offene Eigentuemer-Entscheidungen: nur, was wirklich niemand technisch entscheiden
   kann. Je Punkt eine Empfehlung.
8. Was NICHT Teil dieses Plans ist.

REGELN fuer das Dokument:
- Jede tragende Zahl traegt ihre Herkunft. "Gemessen am ...", "belegt in Datei:Zeile",
  oder ausdruecklich "geschaetzt, zu messen in Phase N".
- Kein Platzhalter, kein TODO, keine leere Tabellenzelle.
- Keine Funktion, keinen Pfad nennen, ohne dass es sie gibt.
- Die Safety-Gates aus dem Auftrag bleiben unangetastet; sage bei jeder Phase, dass und
  wie sie das einhaelt, wo sie Geld-Pfade beruehrt.
- Schreibe fuer jemanden, der den Kontext NICHT hat.`,
  {
    label: "synthese:dokument",
    phase: "Synthese",
    model: "opus",
    effort: "high",
    schema: SYNTHESE_SCHEMA,
  },
);
log(`Synthese: ${synthese ? `${synthese.phasenAnzahl} Phasen, Entwurf ${synthese.gewaehlterEntwurf}` : "AUSGEFALLEN"}`);
if (!synthese) return { abbruch: "Synthese ausgefallen - kein Dokument" };

phase("Abnahme");
// Schleife statt Einmal-Pruefung: ein Kritiker, der nur meckert, hat noch nichts behoben
// (Lehre workflow-schema-not-content-guarantee - Schema erzwingt Struktur, nicht Qualitaet).
let abnahme = null;
let runden = 0;
for (let r = 1; r <= MAX_ABNAHME_RUNDEN; r++) {
  runden = r;
  abnahme = await agent(
    `${SPARSAM}

${REGELN}

Du nimmst das fertige Strategiedokument ${DOK} ab. Du bist die letzte Instanz vor dem
Eigentuemer. Seine ausdrueckliche Erwartung: "keine Annahmen, von vorne bis hinten
durchdacht, in einem Monat keine boese Ueberraschung".

Pruefe, in dieser Reihenfolge:
1. PLATZHALTER. Grep das Dokument auf TODO, TBD, "hier", "Test", "...", leere
   Tabellenzellen, Abschnitte ohne Inhalt. Zaehle die Treffer.
2. BELEGE. Stichprobe von mindestens 8 genannten Datei:Zeile-Verweisen und
   Funktionsnamen gegen den echten Code. Existieren sie? Tun sie, was das Dokument sagt?
3. VOLLSTAENDIGKEIT. Deckt die Kostenarten-Tabelle wirklich jede Kostenart ab, die in
   ${AUFTRAG} und in den Befunden vorkommt? Fehlt ein Kanal, ein Zustand, eine Richtung?
4. PHASENSCHNITT. Ist jede Phase einzeln lieferbar und einzeln pruefbar? Traegt jede ein
   Abnahmekriterium, das OHNE echten Anruf funktioniert? Kann eine spaetere Session eine
   Phase ohne Rueckfrage bauen?
5. BLOCKER-ABDECKUNG. Die Angriffe (${angriffDateien.join(", ")}) enthalten
   ${blocker.length} Blocker. Ist jeder eingearbeitet ODER begruendet verworfen?
6. SICHERHEIT. Wird irgendwo ein Safety-Gate aufgeweicht, umgangen oder per Default
   abgeschaltet? Steht irgendwo ein Secret?

Gate ist PASS nur, wenn 1 null Treffer hat, 2 keine erfundene Referenz findet und 3 bis 6
ohne Mangel durchlaufen. Sonst BLOCKED mit konkreten, umsetzbaren Maengeln.`,
    {
      label: `abnahme:r${r}`,
      phase: "Abnahme",
      model: "opus",
      effort: "high",
      schema: ABNAHME_SCHEMA,
    },
  );
  if (!abnahme) {
    log(`Abnahme R${r}: ausgefallen`);
    break;
  }
  log(`Abnahme R${r}: ${abnahme.gate}, ${abnahme.maengel.length} Maengel, ${abnahme.platzhalterGefunden} Platzhalter.`);
  if (abnahme.gate === "PASS") break;
  if (r === MAX_ABNAHME_RUNDEN) break;

  const maengelText = abnahme.maengel
    .map((m, i) => `${i + 1}. [${m.stelle}] ${m.mangel} -> ${m.fix}`)
    .join("\n");
  // Ab Runde 2 treffen die Maengel die Architektur, nicht mehr den Text - deshalb
  // schaerferer Auftrag UND das staerkere Modell. Runde 1 bleibt WORTGLEICH und mit
  // demselben Modell, damit sie beim Fortsetzen aus dem Cache repliziert wird statt
  // ein zweites Mal auf ein bereits gepatchtes Dokument losgelassen zu werden.
  const patchExtra =
    r === 1
      ? ""
      : `

ZUSATZ DIESER RUNDE: diese Maengel beruehren die Architektur, nicht nur die Formulierung.
- Verlangt ein Fix eine Entscheidung, die technisch NICHT eindeutig ist (etwa: einen
  Kostentraeger bauen oder nur katalogisieren), triffst du sie NICHT allein. Du nimmst sie
  als nummerierten Punkt MIT Empfehlung in Abschnitt 7 auf und laesst den Plan an der
  Stelle beide Wege offen.
- Aendert ein Fix eine Phase, ziehst du deren Abnahmekriterien, Abgrenzung und
  Abhaengigkeiten MIT nach. Eine halb nachgezogene Phase ist schlimmer als der
  urspruengliche Mangel.
- Wird eine Zahl gepinnt (Zeilenmenge, Typmenge, Phasennummer), pruefst du jede andere
  Stelle im Dokument, die dieselbe Zahl nennt, und ziehst sie mit.${r >= 4 ? OWNER_NACHTRAG : ""}`;
  await agent(
    `${SPARSAM}

${REGELN}

Behebe diese Maengel im Dokument ${DOK}. Nur diese, nichts sonst - kein Umschreiben, kein
Umsortieren, keine Kuerzung an anderer Stelle.

${maengelText}

Wo ein Mangel eine fehlende Tatsache betrifft, ermittelst du sie am Code oder an der DB.
Wo sie nicht ermittelbar ist, schreibst du sie als benannte offene Frage MIT Grund und
mit der Phase, die sie klaert - ein ehrliches "offen" ist zulaessig, ein Platzhalter nicht.${patchExtra}`,
    { label: `patch:r${r}`, phase: "Abnahme", model: r === 1 ? "sonnet" : "opus", effort: "high" },
  );
}

return {
  dokument: DOK,
  gate: abnahme ? abnahme.gate : "UNBEKANNT",
  abnahmeRunden: runden,
  restMaengel: abnahme ? abnahme.maengel.length : null,
  platzhalter: abnahme ? abnahme.platzhalterGefunden : null,
  phasen: synthese.phasenAnzahl,
  gewaehlterEntwurf: synthese.gewaehlterEntwurf,
  blockerGesamt: blocker.length,
  blockerVerworfen: synthese.blockerVerworfen,
  offeneEntscheidungen: synthese.offeneEigentuemerEntscheidungen,
  befundDateien,
  kernaussage: synthese.kernaussage,
};
