// ANALYSE-WORKFLOW (Lead bleibt duenn): warum ein INBOUND-Anruf schlechter klingt als ein
// OUTBOUND-Anruf - und was sich daran aendern muss. Kein Code wird angefasst; das Produkt
// ist EIN Strategie-Dokument mit einer Phasenkette, die danach je Phase ueber
// .claude/workflows/runs/*-lean.js umgesetzt wird.
//
// Bauform bewusst wie phase-impl-lean.js (Memory [[lean-phase-orchestration]]):
//  1) HART GEPINNTE Parameter (kein args-Threading -> kein "analysiert versehentlich was
//     anderes"-Unfall, Memory [[phase-impl-workflow-args]]).
//  2) Fan-out Befund (sonnet) -> Synthese (opus) -> Gegenprobe (sonnet) -> Revision (opus).
//     Die Gegenprobe existiert, weil eine Strategie auf einer geratenen Provider-Konfiguration
//     wertlos ist (Memory [[provider-config-needs-doc-before-diagnosis]]).
//  3) POSTAGE-STAMP-RETURN: der Lead bekommt Pfad + Phasenliste + offene Messungen, NICHT
//     die Befunde selbst.
//
// KOSTENDISZIPLIN (.claude/refs/workflow.md 2a): keine woertlichen Kommando-Ausgaben, keine
// Code-Dumps in den Schemata, kein npm test in einem Analyse-Agenten. Kosten danach mit
// `node scripts/workflow-kosten.mjs <lauf-id>` messen - NIE subagent_tokens glauben.

export const meta = {
  name: "inbound-paritaet-analyse",
  description:
    "Analysiert die Gespraechsqualitaets-Divergenz Inbound vs. Outbound (Pfad, Stimme/Umlaute, Turn-Taking, Gehirn, Beweisbarkeit) und schreibt ein gegengeprueftes Strategie-Dokument mit Phasenkette.",
  phases: [
    { title: "Befund", detail: "5 Dimensionen parallel am echten Code messen (read-only)" },
    { title: "Strategie", detail: "Ein Strategie-Dokument mit Phasenkette schreiben" },
    { title: "Gegenprobe", detail: "Jede Tatsachenbehauptung des Dokuments am Code pruefen" },
    { title: "Revision", detail: "Widerlegte Behauptungen korrigieren, Dokument finalisieren" },
  ],
};

const REPO =
  typeof process !== "undefined" && process.env && process.env.OCLAW_REPO
    ? process.env.OCLAW_REPO
    : typeof process !== "undefined" && typeof process.cwd === "function"
      ? process.cwd()
      : ".";

// HART GEPINNT fuer diesen Lauf.
const DOC = "PLAN-INBOUND-PARITAET.md";
const DOC_PATH = `${REPO}/${DOC}`;
const BASE = "master";

const MODEL_OPUS = "opus";
const MODEL_SONNET = "sonnet";
const BEFUND_AGENT = { model: MODEL_SONNET, effort: "medium" };
const STRATEGIE_AGENT = { model: MODEL_OPUS, effort: "xhigh" };
const GEGENPROBE_AGENT = { model: MODEL_SONNET, effort: "high" };
const REVISION_AGENT = { model: MODEL_OPUS, effort: "high" };

// Gilt fuer JEDEN Agenten dieses Laufs.
const HAUSREGELN = `HAUSREGELN (unantastbar):
- READ-ONLY in der Befund-/Gegenprobe-Phase: kein Edit, kein git-Commit, kein Branch, kein npm test, kein Netzzugriff zu einem Provider. Nur lesen, grepen, zaehlen.
- SECRETS: "${REPO}/.env" darf gelesen werden, aber NIEMALS ein Wert zitiert werden. Erlaubt ist ausschliesslich "<KEY> gesetzt/leer/true/false". Kein API-Key, kein Token, kein Rufnummern-Klartext, kein Gespraechstext aus Transkripten in deiner Rueckgabe (Absolute Regel 4/5).
- BELEG ODER OFFEN: jede Aussage traegt ihren Beleg als Dateiname + Symbolname (KEINE Zeilennummern, die rotten - Katalog C2). Was du nicht am Code belegen kannst, gehoert NICHT in die Befunde, sondern in offeneMessungen. Raten ist der schlimmste moegliche Beitrag.
- KEIN LOKALER ENV-SCHLUSS AUF LIVE: "${REPO}/.env" ist die LOKALE Entwicklungs-Konfiguration. Welcher Wert auf Render (live) steht, ist damit NICHT belegt. Jede flag-abhaengige Aussage nennt den Schalter und markiert den Live-Wert als offen, wenn kein Repo-Beleg (Doku/Kettenstand/Test) ihn festhaelt.
- KEINE ZEILENAUSGABEN: gib niemals Kommando-Ausgaben, Testlaeufe oder Code-Bloecke ueber 15 Zeilen zurueck. Deine Rueckgabe ist verdichtetes Urteil, nicht Rohmaterial.`;

const KONTEXT = `KONTEXT (vom Lead am Code vorgemessen, als Startpunkt - pruefe es, uebernimm es nicht blind):
Hermes ist ein Telefon-KI-Agent (Node/ESM, kein Build-Step). Es gibt ZWEI Gespraechs-Engines und die Richtung entscheidet, welche laeuft:
- OUTBOUND (der Assistent ruft den Owner/einen Dritten an) laeuft ueber den ElevenLabs-ConvAI-Agenten: "${REPO}/src/elevenlabs/outbound.js", Prompt/Stimme/Eroeffnung in der Anbieter-Konfiguration ("${REPO}/elevenlabs/agent_configs/"), Werkzeug-Rueckkanal ueber "${REPO}/src/routes/webhooks-elevenlabs.js". Streaming-Audio, Anbieter-eigenes STT/TTS.
- INBOUND (ein Mensch ruft UNS an) laeuft ueber die turn-basierte Budget-Engine: "${REPO}/src/routes/voice.js" (POST /voice/incoming + /voice/turn), TeXML-Gather, "${REPO}/src/claude.js" als Gehirn, Sprachausgabe ueber Direktiven ("${REPO}/src/telephony/directives.js") und optionale ElevenLabs-Vorab-Synthese ("${REPO}/src/tts/directive-synth.js"). Ein Telnyx-AI-Assistant-Zweig fuer Inbound existiert ("${REPO}/src/telnyx-inbound.js"), ist aber an zwei Schalter gebunden.
- Der EL-Inbound-Weg ist BEWUSST nicht freigeschaltet ("${REPO}/src/elevenlabs/nummern-registrierung.js" laesst inbound_trunk_config absichtlich weg).
Der Owner berichtet vom echten Telefon: Inbound klingt deutlich schlechter als Outbound, die STIMME ist eine andere, und deutsche UMLAUTE werden inbound falsch ausgesprochen, waehrend sie outbound korrekt klingen.`;

const BEFUND_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    dimension: { type: "string" },
    istInbound: { type: "string", description: "Der Ist-Zustand des INBOUND-Pfads in dieser Dimension, max 1200 Zeichen" },
    istOutbound: { type: "string", description: "Der Ist-Zustand des OUTBOUND-Pfads in dieser Dimension, max 1200 Zeichen" },
    divergenzen: {
      type: "array",
      description: "Je Eintrag EIN belegter Unterschied, der Qualitaet kostet",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          id: { type: "string", description: "Kurzkennung, z.B. D2-1" },
          symptom: { type: "string", description: "Was der Anrufer hoert/erlebt" },
          wurzel: { type: "string", description: "Die Code-/Konfigurations-Ursache, nicht das Symptom" },
          beleg: { type: "string", description: "Datei + Symbolname, keine Zeilennummern" },
          schwere: { type: "string", enum: ["hoch", "mittel", "niedrig"] },
          aufwand: { type: "string", enum: ["klein", "mittel", "gross"] },
        },
        required: ["id", "symptom", "wurzel", "beleg", "schwere", "aufwand"],
      },
    },
    offeneMessungen: {
      type: "array",
      items: { type: "string" },
      description: "Was sich am Repo NICHT belegen liess und live/vom Owner gemessen werden muss",
    },
    verdikt: { type: "string", description: "Ein Absatz: was in dieser Dimension der eigentliche Hebel ist" },
  },
  required: ["dimension", "istInbound", "istOutbound", "divergenzen", "offeneMessungen", "verdikt"],
};

const DIMENSIONEN = [
  {
    key: "D1-pfad",
    titel: "Pfadwahl, Engines und Schalter",
    auftrag: `Verfolge BEIDE Richtungen end-to-end und benenne jede Verzweigung, an der sich die Pfade trennen.
- INBOUND: "${REPO}/src/routes/voice.js" (POST /voice/incoming, POST /voice/turn), "${REPO}/src/telnyx-inbound.js" (inboundHandoffDecision), die Weiche VOICE_ENGINE ("${REPO}/src/config.js"), "${REPO}/src/wiring/" fuer die Verdrahtung.
- OUTBOUND: "${REPO}/src/elevenlabs/outbound.js", "${REPO}/src/telnyx-origination.js", die Gates in "${REPO}/src/telephony/outbound-gates.js", und wo entschieden wird, ob EL oder Telnyx-Assistant oder Budget-Engine waehlt.
Liefere die VOLLSTAENDIGE Liste der Schalter, die die Pfadwahl beider Richtungen bestimmen (Name aus config.js + Default + welcher Zweig bei an/aus laeuft). Sage klar, WELCHE Engine ein Inbound-Anruf heute mit den Repo-Defaults faehrt und welche mit ausgeschalteten Zusatzschaltern. Pruefe, ob es einen bereits gebauten, nur abgeschalteten Weg zu mehr Inbound-Qualitaet gibt (Telnyx-AI-Assistant-Inbound) und was ihm fehlt. Suche ausserdem in "${REPO}/tasks/gq-chain-state.md" und "${REPO}/tasks/anrufdefekte-chain-state.md" nach schon gemessenen Belegen zur Richtungs-Asymmetrie.`,
  },
  {
    key: "D2-stimme",
    titel: "Stimme, TTS und die Umlaut-Aussprache",
    auftrag: `Die konkreteste Owner-Beschwerde: andere Stimme, und deutsche Umlaute klingen inbound falsch. Finde die Wurzel, nicht das Symptom.
- Wer spricht auf dem INBOUND-Pfad? Verfolge sayD/gather -> "${REPO}/src/telephony/directives.js" -> "${REPO}/src/telephony/adapters/telnyx/render.js" (voiceAttrs/Say-Attribute) -> und parallel die Vorab-Synthese "${REPO}/src/tts/directive-synth.js" + "${REPO}/src/tts/synth.js" + "${REPO}/src/telephony/adapters/telnyx/elevenlabs-voice.js". Welche Stimme/welches Modell/welches Locale landet am Draht, und unter welcher Bedingung faellt der Pfad auf den Provider-eigenen <Say> zurueck (Kontingent, Timeout, Flag, Nicht-Telnyx)?
- Wer spricht auf dem OUTBOUND-Pfad? Stimme/Modell aus "${REPO}/elevenlabs/agent_configs/" und "${REPO}/src/elevenlabs/".
- UMLAUTE: pruefe die gesprochenen deutschen Strings des Inbound-Pfads auf Transliteration (ae/oe/ue statt ä/ö/ü) - "${REPO}/src/i18n/locales.js", "${REPO}/src/i18n/greeting-catalog.js", "${REPO}/src/i18n/inbound-notice.js", der Seed-Default der Begruessung im Store, sowie die gesprochenen Texte, die aus "${REPO}/src/claude.js" kommen (Prompt-Anweisungen zur Schreibweise). Es gibt eine Regel im Projekt: gesprochene DE-Strings tragen Umlaute, ASCII gilt nur fuer Code/Kommentare - pruefe, ob der Inbound-Pfad sie verletzt, und ob ein Test sie fuer inbound ueberhaupt pinnt (grep in "${REPO}/test/" nach umlaut/orthograph).
- Zweite Umlaut-Hypothese, ebenso pruefen: ein falsches oder fehlendes Sprach-/Locale-Attribut am Say-Tag oder eine falsche voiceId beim Vorab-Synth laesst korrekt geschriebene Umlaute englisch klingen. Entscheide am Code, welche der beiden Hypothesen traegt - oder ob beide es tun.`,
  },
  {
    key: "D3-turntaking",
    titel: "Turn-Taking, Latenz und Barge-in",
    auftrag: `Warum ein turn-basierter Anruf sich zaeh anfuehlt, auch wenn jede einzelne Antwort gut ist.
- INBOUND: der Gather-Zyklus in "${REPO}/src/routes/voice.js" (/voice/turn), die Gather-Parameter im Renderer "${REPO}/src/telephony/adapters/telnyx/render.js", "${REPO}/src/telephony/stt-profile.js" + "${REPO}/src/telephony/adapters/telnyx/stt-model.js", "${REPO}/src/no-speech-escalation.js", "${REPO}/src/speech-chunker.js", "${REPO}/src/speech-shape.js", "${REPO}/src/metrics.js" (logTurnGap/L0), "${REPO}/src/thinking-signal.js", "${REPO}/src/turn-budget.js".
- OUTBOUND: was der EL-Agent stattdessen tut (Streaming, Barge-in, Turn-Erkennung) - soweit im Repo belegt ("${REPO}/elevenlabs/agent_configs/", "${REPO}/src/elevenlabs/").
Benenne konkret und in Zahlen, wo sie im Repo stehen: Pausen/Timeouts je Turn, ob der Anrufer den Agenten unterbrechen kann (barge-in) und ob es inbound ueberhaupt moeglich ist, ob es ein Denk-Signal gibt, wie lange die Totzeit zwischen zwei Turns ist. Pruefe, ob der bekannte Doppel-Turn-Defekt (Zwischen- und Endergebnis der Spracherkennung loesen je einen Turn aus) auf dem Inbound-Pfad heute noch moeglich ist.`,
  },
  {
    key: "D4-gehirn",
    titel: "Gehirn: Prompt, Werkzeuge, Eroeffnung, Zusammenfassung",
    auftrag: `Was der Agent inbound WEISS und KANN, verglichen mit outbound.
- INBOUND: "${REPO}/src/claude.js" (System-Prompt-Bau, Tool-Loop, welche Werkzeuge, agentStyle/Persona, tenantContext), "${REPO}/src/i18n/prompts/", "${REPO}/src/call-memory.js", "${REPO}/src/research/", "${REPO}/src/inbox-entry.js", "${REPO}/src/precall-briefing.js", "${REPO}/src/tool-follow-up.js".
- OUTBOUND: der Prompt und die Werkzeuge des EL-Agenten ("${REPO}/elevenlabs/agent_configs/", "${REPO}/src/conversation/elevenlabs-agent-config.js", "${REPO}/src/routes/webhooks-elevenlabs.js", "${REPO}/src/elevenlabs/opening-line.js" + opening-line-llm.js, "${REPO}/src/elevenlabs/time-context.js", "${REPO}/src/elevenlabs/call-locale.js").
Vergleiche ausdruecklich: Werkzeug-Liste je Richtung, Zeitbewusstsein, Wissen ueber den Owner/Kalender, Persona/Tonfall, wie die Eroeffnung entsteht (deterministisch vs. Modell), welche Sprache die Zusammenfassung traegt, und ob der Inbound-Agent ueberhaupt Nachrichten/Termine sauber aufnehmen kann. Nenne jede Faehigkeit, die outbound existiert und inbound fehlt - und jede, die inbound existiert und outbound fehlt.
WICHTIG (Absolute Regel 2): der Inbound-Pflichtsatz (inbound-notice) und der Outbound-Offenlegungssatz sind rechtlich verdrahtet. Beschreibe sie, aber schlage NIE vor, einen davon zu entfernen oder dem Modell zu ueberlassen.`,
  },
  {
    key: "D5-beweis",
    titel: "Beweisbarkeit: womit sich eine Verbesserung ueberhaupt belegen laesst",
    auftrag: `Eine Strategie ohne Vorher-Messung belegt hinterher nichts. Finde heraus, was schon existiert.
- Messwerkzeuge im Repo: "${REPO}/scripts/" vollstaendig durchsehen (insbesondere convo-bench, stt-wer, workflow-kosten, elevenlabs-Skripte, alles was nach Messung/Forensik/drift aussieht) - je Skript: was es misst, welche Richtung es abdeckt, was es braucht (Env/Netz/echter Anruf), und ob es INBOUND ueberhaupt erreicht. Lies "${REPO}/package.json" scripts fuer die kanonischen Namen.
- Testabdeckung: grep in "${REPO}/test/" nach den Inbound-Pfaden (voice/incoming, voice/turn, telnyx-inbound, inbound-notice, greeting) und nach den Outbound-EL-Pfaden. Wo ist Inbound-Verhalten gepinnt, wo nicht? Gibt es Tests, die einen DEFEKT als Soll festschreiben?
- Forensik: wie kommt man an das Rohmaterial eines echten Anrufs (Transkript-Segmente, Richtung, Engine)? Suche die dokumentierte Vorgehensweise in "${REPO}/docs/" und "${REPO}/tasks/". NENNE KEINE Gespraechsinhalte und keine Rufnummern.
Liefere als verdikt einen konkreten Vorschlag: mit welchem Kommando/Werkzeug liesse sich VOR dem Umbau ein Inbound-Ist-Wert festhalten, gegen den man nachher messen kann - und wenn es das Werkzeug nicht gibt, was ihm fehlt.`,
  },
];

phase("Befund");
const befunde = await parallel(
  DIMENSIONEN.map((d) => () =>
    agent(
      `Du bist BEFUND-AGENT fuer die Dimension "${d.titel}" im Repo "${REPO}" (Git-Basis "${BASE}"). Du analysierst, du aenderst NICHTS.
${KONTEXT}
${HAUSREGELN}
DEIN AUFTRAG:
${d.auftrag}
ARBEITSWEISE: lies den ECHTEN Code (cat/sed/grep), nicht die Kommentare allein - Kommentare in diesem Repo sind ausfuehrlich und koennen ueberholt sein; wo Kommentar und Code sich widersprechen, gilt der Code, und der Widerspruch ist selbst ein Befund. Arbeite gezielt: du hast ein Kostenbudget, jede Datei die du ganz liest zahlt sich in jedem weiteren Turn erneut. Sei vollstaendig innerhalb DEINER Dimension und rede nicht ueber die anderen vier.
Fuelle das Schema. divergenzen sind das Herz deiner Rueckgabe: jede ist ein Unterschied, der den Anrufer echte Qualitaet kostet, mit der WURZEL - nicht dem Symptom.`,
      { label: d.key, phase: "Befund", schema: BEFUND_SCHEMA, ...BEFUND_AGENT },
    ),
  ),
);

const befundBlock = DIMENSIONEN.map(
  (d, i) => `=== ${d.key} (${d.titel}) ===\n${JSON.stringify(befunde[i] ?? { fehlt: true }, null, 1)}`,
).join("\n\n");

phase("Strategie");
const STRATEGIE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    docPath: { type: "string" },
    leitentscheidung: { type: "string", description: "Die EINE Richtungsentscheidung in max 600 Zeichen" },
    phasen: {
      type: "array",
      description: "Die Phasenkette in Umsetzungsreihenfolge",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          phaseId: { type: "string", description: "z.B. IP1" },
          titel: { type: "string" },
          ziel: { type: "string", description: "Deterministisch pruefbares Ergebnis, max 300 Zeichen" },
          hebel: { type: "string", enum: ["hoch", "mittel", "niedrig"] },
          aufwand: { type: "string", enum: ["klein", "mittel", "gross"] },
          hochrisiko: { type: "boolean", description: "true, wenn Geld/Gates/Offenlegung/Live-Boot betroffen sind" },
          braucthOwner: { type: "boolean", description: "true, wenn die Phase eine Owner-Entscheidung oder einen echten Testanruf voraussetzt" },
        },
        required: ["phaseId", "titel", "ziel", "hebel", "aufwand", "hochrisiko", "braucthOwner"],
      },
    },
    ownerEntscheidungen: { type: "array", items: { type: "string" }, description: "Was der Owner entscheiden muss, bevor es weitergeht" },
    offeneMessungen: { type: "array", items: { type: "string" } },
    verworfen: { type: "array", items: { type: "string" }, description: "Welche naheliegenden Wege bewusst NICHT gewaehlt wurden, je mit Grund" },
    zusammenfassung: { type: "string", description: "max 900 Zeichen" },
  },
  required: ["docPath", "leitentscheidung", "phasen", "ownerEntscheidungen", "offeneMessungen", "verworfen", "zusammenfassung"],
};
const strategie = await agent(
  `Du bist STRATEGE. Aus fuenf Befunden entsteht EIN Dokument: "${DOC_PATH}". Du schreibst GENAU DIESE EINE Datei im Haupt-Repo. Kein Code, kein git-Commit, keine zweite Datei.
${KONTEXT}
${HAUSREGELN}
=== BEFUNDE ===
${befundBlock}
=== ENDE BEFUNDE ===

DIE FRAGE, die das Dokument beantwortet: wie wird die Gespraechsqualitaet eines INBOUND-Anrufs so gut wie die eines OUTBOUND-Anrufs - Stimme, Aussprache, Turn-Taking, Faehigkeiten?

BEVOR du die Kette festlegst, entscheide die LEITFRAGE und begruende sie im Dokument: Wird der Inbound-Pfad (a) auf denselben Streaming-Agenten gehoben, den Outbound schon nutzt (Paritaet durch EINEN Pfad), (b) auf den bereits gebauten, aber abgeschalteten Telnyx-AI-Assistant-Inbound-Zweig gehoben, oder (c) als turn-basierte Engine gezielt nachgebessert (Stimme/Umlaute/Latenz einzeln)? Bewerte alle drei an: Qualitaetsgewinn, Aufwand, Betriebsrisiko, Kosten pro Anruf, und wie viele Wahrheiten danach im Code stehen (zwei Engines zu pflegen ist ein dauerhafter Preis - dieses Projekt baut fuer Millionen Nutzer, nicht fuer einen Testanruf). Es ist ausdruecklich erlaubt und oft richtig, die schnellen Einzelfixe (Stimme/Umlaute) VOR die grosse Weiche zu setzen: ein Fix, der heute wirkt, schlaegt eine Architektur, die in drei Wochen wirkt - aber sage dann, welcher dieser Fixes bei der grossen Weiche wieder wegfaellt, damit niemand zweimal zahlt.

PRE-MORTEM (Pflicht, eigener Abschnitt): versetz dich ein Jahr weiter, die Kette ist gescheitert. Was ist passiert? Denke ausdruecklich an: ein Anrufer bekommt keine Verbindung mehr, die Kosten je Inbound-Minute vervielfachen sich unbemerkt, der rechtlich verdrahtete Inbound-Pflichtsatz faellt weg, ein Deploy startet nicht mehr, ein Umbau macht den Outbound-Pfad kaputt, den heute niemand beklagt. Jedes Risiko wird entweder entschaerft (sage wie) oder als akzeptiert benannt.

ABSOLUTE REGELN, die keine Phase brechen darf (CLAUDE.md): Safety-Gates (pro-Tenant-Kostendecke, Denylist/Land/Stundenlimit, Max-Dauer, OUTBOUND_FROZEN, Provider-Signaturpruefung fail-closed) werden nie entfernt oder per Default umgangen; der Offenlegungssatz bleibt fest verdrahtet; neue Endpunkte stehen standardmaessig hinter Auth; Secrets nie loggen; Audio nie durch MCP. Eine Phase, die eines davon beruehrt, traegt "hochrisiko": true.

DOKUMENT-AUFBAU (Markdown, deutsch, Kommentare/Prosa OHNE Umlaute nur im CODE - im Dokument sind Umlaute richtig und erwuenscht):
1. Ausgangslage: der belegte Ist-Unterschied beider Richtungen, in einer Tabelle. Nur Belegtes; Unbelegtes steht unter "Offene Messungen".
2. Leitentscheidung mit Begruendung und den beiden verworfenen Alternativen.
3. Pre-Mortem.
4. Die Phasenkette: je Phase EIN eigener Abschnitt mit der Ueberschrift "## Phase <ID> - <Titel>" und darin: Ziel (deterministisch pruefbar), Scope, NICHT-Scope (Abgrenzung), betroffene Dateien/Nahtstellen, Invarianten (was byte-identisch bleiben muss), Abnahmekriterium als Kommando + erwartete Ausgabe, Testpflicht (welches neue Verhalten welchen Test braucht), Risiko + Rueckfall, und ob die Phase eine Owner-Entscheidung oder einen echten Testanruf braucht.
   DIESES DOKUMENT IST DIE SPEC: je Phase wird spaeter ein Umsetzungs-Workflow mit specFile="${DOC}" gestartet, der GENAU diesen Abschnitt als autoritative Definition liest. Ein Abschnitt, der eine Frage offen laesst, produziert einen geratenen Umbau. Schreibe so, dass ein Implementierer ohne Rueckfrage arbeiten kann.
   Schneide die Phasen so, dass jede FUER SICH deploybar ist, einen kleinen Blast-Radius hat und hinter einem Schalter landet, wenn sie Live-Verhalten aendert (flag-aus = byte-identisch zum Bestand). Reihenfolge nach Hebel pro Aufwand, Abhaengigkeiten benannt. Nicht mehr als 8 Phasen - lieber weniger und scharf.
5. Clean-Code-Auflagen der Kette: wo droht eine zweite Wahrheit (G5), welche gemeinsame Naht muss VORHER gezogen werden, welche Magic Numbers gehoeren in config.js. Das Repo hat einen verbindlichen Katalog ("${REPO}/.claude/refs/clean-code.md"); jede Phase wird spaeter gegen ihn auditiert, also plane keine Phase, die ihn bricht.
6. Offene Messungen und Owner-Entscheidungen, als Liste, jede mit dem konkreten naechsten Schritt.
Schreibe die Datei mit dem Write-Werkzeug. docPath = der geschriebene Pfad. Fuelle das Schema passend zum Dokument - es ist die Kurzfassung, nicht ein zweiter Inhalt.`,
  { label: "strategie", phase: "Strategie", schema: STRATEGIE_SCHEMA, ...STRATEGIE_AGENT },
);

phase("Gegenprobe");
const GEGENPROBE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    dokumentGelesen: { type: "boolean" },
    geprueftAnzahl: { type: "number", description: "Wie viele Tatsachenbehauptungen du geprueft hast" },
    widerlegt: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          behauptung: { type: "string", description: "Die Aussage aus dem Dokument, gekuerzt" },
          befund: { type: "string", description: "Was der Code wirklich sagt" },
          beleg: { type: "string", description: "Datei + Symbolname" },
          schwere: { type: "string", enum: ["tragend", "randstaendig"], description: "tragend = eine Phase steht oder faellt damit" },
        },
        required: ["behauptung", "befund", "beleg", "schwere"],
      },
    },
    unbelegt: { type: "array", items: { type: "string" }, description: "Behauptungen, die weder belegbar noch widerlegbar sind und als offene Messung gekennzeichnet werden muessen" },
    regelverstoesse: { type: "array", items: { type: "string" }, description: "Phasen, die eine Absolute Regel oder den Clean-Code-Katalog brechen wuerden" },
    luecken: { type: "array", items: { type: "string" }, description: "Phasen-Abschnitte, die ein Implementierer ohne Rueckfrage NICHT umsetzen koennte, mit der fehlenden Angabe" },
    tragfaehig: { type: "boolean", description: "true, wenn keine tragende Behauptung widerlegt und keine Regel gebrochen wird" },
    verdikt: { type: "string" },
  },
  required: ["dokumentGelesen", "geprueftAnzahl", "widerlegt", "unbelegt", "regelverstoesse", "luecken", "tragfaehig", "verdikt"],
};
const gegenprobe = await agent(
  `Du bist ADVERSARIALER PRUEFER. Das Dokument "${DOC_PATH}" behauptet Tatsachen ueber diesen Code und baut darauf eine Umbau-Kette. Deine Aufgabe ist, es zu WIDERLEGEN, wo es falsch ist. Du aenderst NICHTS.
${HAUSREGELN}
VORGEHEN:
1. Lies "${DOC_PATH}" vollstaendig.
2. Nimm dir JEDE Tatsachenbehauptung ueber den Code heraus (welche Datei was tut, welcher Schalter was schaltet, welche Stimme wo herkommt, was ein Test pinnt) und pruefe sie am echten Code. Zaehle, wie viele du geprueft hast.
3. Pruefe die Phasen gegen die Absoluten Regeln (Safety-Gates, Offenlegung, Auth fail-closed, Secrets, Audio nie durch MCP) und gegen "${REPO}/.claude/refs/clean-code.md".
4. Pruefe jeden Phasen-Abschnitt auf Umsetzbarkeit: fehlt Scope, Abgrenzung, Invariante, Abnahmekriterium oder Testpflicht, ist das eine Luecke - benenne genau die fehlende Angabe.
Ein Fehlalarm kostet eine Fix-Runde, eine uebersehene falsche Praemisse kostet einen ganzen Umbau. Melde nur, was du am Code belegen kannst - und melde es dann ohne Milde. Findest du nichts, ist tragfaehig=true das richtige Ergebnis; erfinde keine Befunde.`,
  { label: "gegenprobe", phase: "Gegenprobe", schema: GEGENPROBE_SCHEMA, ...GEGENPROBE_AGENT },
);

phase("Revision");
const REVISION_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    docPath: { type: "string" },
    korrigiert: { type: "array", items: { type: "string" }, description: "Was im Dokument geaendert wurde" },
    zurueckgewiesen: { type: "array", items: { type: "string" }, description: "Welche Pruefbefunde du mit Begruendung NICHT uebernommen hast" },
    phasenFinal: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          phaseId: { type: "string" },
          titel: { type: "string" },
          ziel: { type: "string" },
          hebel: { type: "string", enum: ["hoch", "mittel", "niedrig"] },
          hochrisiko: { type: "boolean" },
          braucthOwner: { type: "boolean" },
        },
        required: ["phaseId", "titel", "ziel", "hebel", "hochrisiko", "braucthOwner"],
      },
    },
    ownerEntscheidungen: { type: "array", items: { type: "string" } },
    offeneMessungen: { type: "array", items: { type: "string" } },
    ersteEmpfehlung: { type: "string", description: "Welche Phase der Lead zuerst umsetzen soll und warum, max 400 Zeichen" },
    zusammenfassung: { type: "string", description: "max 900 Zeichen" },
  },
  required: ["docPath", "korrigiert", "zurueckgewiesen", "phasenFinal", "ownerEntscheidungen", "offeneMessungen", "ersteEmpfehlung", "zusammenfassung"],
};
const revision = await agent(
  `Du finalisierst "${DOC_PATH}". Der adversariale Pruefer hat das Dokument gegen den Code gehalten:
=== PRUEFBEFUNDE ===
${JSON.stringify(gegenprobe ?? { fehlt: true }, null, 1)}
=== ENDE PRUEFBEFUNDE ===
${HAUSREGELN}
AUFTRAG:
1. Lies "${DOC_PATH}".
2. Arbeite jeden Pruefbefund ab. Eine widerlegte TRAGENDE Behauptung heisst: die darauf gebaute Phase wird korrigiert oder gestrichen - nicht nur der Satz umformuliert. Unbelegtes wandert in "Offene Messungen" und darf nicht als Praemisse einer Phase stehen bleiben. Luecken in Phasen-Abschnitten schliesst du (Scope, Abgrenzung, Invariante, Abnahmekriterium, Testpflicht). Regelverstoesse werden entfernt.
3. Einen Pruefbefund, den du fuer falsch haeltst, darfst du zurueckweisen - aber nur mit einer am Code belegten Begruendung, die du in zurueckgewiesen nennst. Das Dokument selbst traegt danach keine widerlegte Behauptung mehr.
4. Halte das Dokument SO, dass jeder Phasen-Abschnitt weiterhin als autoritative Spec fuer einen Umsetzungs-Workflow taugt (Ueberschrift "## Phase <ID> - <Titel>" bleibt das Auffindungs-Muster). Schreibe die Datei mit dem Write-/Edit-Werkzeug zurueck. Keine zweite Datei, kein git-Commit, kein Code.
ersteEmpfehlung: welche Phase soll der Lead ZUERST umsetzen? Waehle nach Hebel pro Aufwand und danach, welche Phase ohne Owner-Entscheidung startbar ist.`,
  { label: "revision", phase: "Revision", schema: REVISION_SCHEMA, ...REVISION_AGENT },
);

return {
  docPath: (revision && revision.docPath) || (strategie && strategie.docPath) || DOC,
  leitentscheidung: (strategie && strategie.leitentscheidung) || "",
  phasen: (revision && revision.phasenFinal) || (strategie && strategie.phasen) || [],
  ersteEmpfehlung: (revision && revision.ersteEmpfehlung) || "",
  gegenprobeTragfaehig: gegenprobe ? gegenprobe.tragfaehig : null,
  gegenprobeGeprueft: gegenprobe ? gegenprobe.geprueftAnzahl : null,
  widerlegtTragend: gegenprobe ? (gegenprobe.widerlegt || []).filter((w) => w.schwere === "tragend").map((w) => w.behauptung) : [],
  korrigiert: (revision && revision.korrigiert) || [],
  ownerEntscheidungen: (revision && revision.ownerEntscheidungen) || [],
  offeneMessungen: (revision && revision.offeneMessungen) || [],
  divergenzZahl: befunde.reduce((n, b) => n + ((b && b.divergenzen) || []).length, 0),
  befundAusfaelle: DIMENSIONEN.filter((d, i) => !befunde[i]).map((d) => d.key),
  zusammenfassung: (revision && revision.zusammenfassung) || (strategie && strategie.zusammenfassung) || "",
};
