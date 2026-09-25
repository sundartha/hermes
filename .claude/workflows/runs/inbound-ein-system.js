// OWNER-EINWAND 2026-09-12: "ich will jetzt nicht zwei parallele Systeme haben".
// Der Analyse-Lauf hat (a) "ElevenLabs auch fuer Inbound" verworfen - aber nur in EINER
// Variante geprueft: die Telefonnummer beim Carrier direkt auf den EL-Trunk zeigen lassen
// (inbound_trunk_config). Die Variante, die der Owner meint, ist ungeprueft: UNSER Webhook
// nimmt an, laesst alle Gates laufen, spricht den Pflichtsatz - und gibt DANACH an denselben
// EL-Agenten ab, der Outbound schon bedient.
//
// Dieser Lauf beantwortet GENAU EINE Frage und schreibt danach die Leitentscheidung neu:
//   Kann der ElevenLabs-Agent einen eingehenden Anruf bedienen, OHNE dass eine der sieben
//   Sicherungen am Inbound-Webhook wegfaellt - und was kostet das pro Minute?
//
// Bauform wie inbound-paritaet-analyse.js: Fan-out (Anbieter-Faehigkeiten, Carrier-
// Faehigkeiten, Gate-Erhalt, Kosten) -> Entscheidung -> Gegenprobe. Keine Umsetzung.

export const meta = {
  name: "inbound-ein-system",
  description:
    "Prueft am Anbieter-Beleg, ob der ElevenLabs-Agent Inbound bedienen kann, ohne den Inbound-Webhook und seine sieben Sicherungen zu verlieren - und schreibt die Leitentscheidung von PLAN-INBOUND-PARITAET.md auf EIN System um.",
  phases: [
    { title: "Faehigkeiten", detail: "Anbieter- und Carrier-Mechanismen belegen, Gate-Erhalt und Kosten pruefen" },
    { title: "Entscheidung", detail: "Leitentscheidung + Phasenkette auf ein System umschreiben" },
    { title: "Gegenprobe", detail: "Die neue Entscheidung adversarial gegen Code und Belege pruefen" },
  ],
};

const REPO =
  typeof process !== "undefined" && process.env && process.env.OCLAW_REPO
    ? process.env.OCLAW_REPO
    : typeof process !== "undefined" && typeof process.cwd === "function"
      ? process.cwd()
      : ".";

const DOC = "PLAN-INBOUND-PARITAET.md";
const DOC_PATH = `${REPO}/${DOC}`;

const MODEL_OPUS = "opus";
const MODEL_SONNET = "sonnet";
const FAEHIGKEIT_AGENT = { model: MODEL_SONNET, effort: "high" };
const GATE_AGENT = { model: MODEL_OPUS, effort: "xhigh" };
const KOSTEN_AGENT = { model: MODEL_SONNET, effort: "medium" };
const ENTSCHEIDUNG_AGENT = { model: MODEL_OPUS, effort: "xhigh" };
const GEGENPROBE_AGENT = { model: MODEL_SONNET, effort: "high" };

const HAUSREGELN = `HAUSREGELN (unantastbar):
- READ-ONLY am Code: kein Edit, kein git-Commit, kein Branch, kein npm test. Nur der Entscheidungs-Agent schreibt, und zwar genau EINE Datei.
- SECRETS: "${REPO}/.env" darf gelesen werden, aber NIEMALS ein Wert zitiert werden - erlaubt ist ausschliesslich "<KEY> gesetzt/leer/true/false". Kein API-Key, kein Token, keine Rufnummer im Klartext, kein Gespraechstext (Absolute Regel 4/5).
- BELEG ODER OFFEN: eine Anbieter-Faehigkeit gilt nur als belegt, wenn du sie an der Anbieter-Doku (URL) oder an einer echten API-Antwort belegen kannst. Code-Belege nennen Datei + Symbolname, KEINE Zeilennummern (sie rotten). Alles andere ist "unbelegt" - und ein unbelegter Mechanismus darf nicht zur Praemisse einer Phase werden.
- KEIN RATEN BEI PROVIDER-VERTRAEGEN: dieses Projekt hat sich mehrfach an geratenen Anbieter-Feldnamen verletzt (ein geratenes Feld war wochenlang ein stiller Defekt; eine client-tools-Doku galt fuer unseren Weg gar nicht). Erfinde keinen Endpunkt, keinen Feldnamen, kein Audioformat.
- KEINE ZEILENAUSGABEN: niemals Kommando-Ausgaben, Doku-Volltexte oder Code-Bloecke ueber 15 Zeilen zurueckgeben. Verdichtetes Urteil, nicht Rohmaterial.`;

const LAGE = `LAGE (am Code vorgemessen - pruefe, was du brauchst, aber baue darauf auf):
Hermes ist ein Telefon-KI-Agent (Node/ESM, kein Build-Step, Carrier ist Telnyx).
HEUTE LIVE, zwei verschiedene Gehirne je Richtung:
- OUTBOUND: der ElevenLabs-ConvAI-Agent. Der Anruf wird ueber den EL-SIP-Trunk gestartet (POST /v1/convai/sip-trunk/outbound-call, "${REPO}/src/elevenlabs/outbound.js#originateCall"), unsere Telnyx-DID ist der Absender ("${REPO}/src/elevenlabs/nummern-registrierung.js"). Streaming-Audio, EL macht STT/LLM/TTS. Werkzeug-Rueckkanal per Webhook zu uns ("${REPO}/src/routes/webhooks-elevenlabs.js").
- INBOUND: die turn-basierte Budget-Engine. POST /voice/incoming + POST /voice/turn in "${REPO}/src/routes/voice.js", TeXML-Gather, "${REPO}/src/claude.js" als Gehirn, Sprachausgabe ueber Direktiven mit optionaler EL-Vorab-Synthese ("${REPO}/src/tts/directive-synth.js").
AUSSERDEM IM CODE, beide abgeschaltet: der Telnyx-AI-Assistant-Inbound-Handoff ("${REPO}/src/telnyx-inbound.js") und eine Audio-Bridge Telnyx-Media-Streams <-> OpenAI Realtime ("${REPO}/src/bridge.js", HEIKLE STELLEN markiert).
DIE SIEBEN SICHERUNGEN am Inbound-Webhook, die jeder Weg behalten MUSS (alle in "${REPO}/src/routes/voice.js", Abschnitt 1.3 von "${DOC}"): (1) Ed25519-Signaturpruefung fail-closed, (2) Wiederholungs-Riegel, (3) Tenant-Aufloesung NACH der Signatur ueber die angerufene Nummer, (4) pro-Tenant-Kostendecke (sperrt ausdruecklich auch Inbound), (5) Max-Dauer-Notbremse, (6) Kostenprofil-Buchung, (7) der fest verdrahtete Inbound-Pflichtsatz (Artikel 50 EU AI Act, wird GERENDERT, nie gepromptet).
OWNER-EINWAND, der diesen Lauf ausloest: zwei parallele Gesprachs-Systeme dauerhaft zu pflegen ist der Preis, den er NICHT zahlen will. Ein Plan, der den Telnyx-Assistant als DRITTES lebendes Gehirn scharfstellt, ist damit nicht mehr die Zielarchitektur.`;

const KANDIDATEN = `DER MASSSTAB, an dem jeder Mechanismus gemessen wird (Owner-Vorgabe, nicht verhandelbar): Inbound soll DASSELBE benutzen wie Outbound - denselben Agenten, dieselbe Stimme, EINEN Kostenpfad, EINEN Ort, an dem Gespraechslogik lebt. Zwei Gespraechs-Systeme dauerhaft zu pflegen ist kein akzeptables Ergebnis, sondern genau die zweite Wahrheit, die der Clean-Code-Katalog dieses Repos verbietet (G5). Der Kandidat, der am wenigsten eigenen Gespraechs-Code bei uns zurueck laesst, gewinnt - nicht der, der am schnellsten gebaut ist. Ein Mechanismus, der nur mit zusaetzlichem Sicherungs-Code zulaessig ist, ist dabei KEIN Verstoss gegen diesen Massstab: Sicherungen sind nicht Gespraechslogik.

DIE ZU PRUEFENDEN MECHANISMEN (keiner ist vorab gesetzt; es duerfen auch weitere dazukommen, wenn du sie belegen kannst):
K1 "Dial-to-SIP": unser Webhook nimmt an, rendert den Pflichtsatz, und verbindet den Anruf danach per TeXML/Call-Control auf eine SIP-Adresse des EL-Agenten. Kernfrage: akzeptiert EL einen eingehenden SIP-INVITE von unserem Carrier, und woran waehlt es dann Agent, Sprache und die anrufspezifischen Variablen?
K2 "Media-Bridge": unser Webhook nimmt an, rendert den Pflichtsatz, und bruecket danach den Telnyx-Media-Stream auf die EL-ConvAI-WebSocket-Schnittstelle - dieselbe Naht, die "${REPO}/src/bridge.js" heute fuer OpenAI Realtime bedient. Kernfrage: gibt es diese WebSocket-Schnittstelle fuer einen selbst gelieferten Audiostrom, welche Audioformate/Abtastraten, und lassen sich Agent-Ueberschreibungen und dynamische Variablen wie beim Outbound-Anrufstart mitgeben?
K3 "EL nimmt an, WIR entscheiden vorher": die Nummer zeigt beim Carrier auf den EL-Inbound-Trunk (inbound_trunk_config), aber der Anbieter fragt VOR dem ersten Wort bei UNS an. Der Analyse-Lauf hat diesen Kandidaten als reinen Bypass verworfen - das ist zu grob und ausdruecklich NEU ZU PRUEFEN. Kernfragen, jede am Anbieter-Beleg: gibt es fuer einen eingehenden Anruf einen Anbieter-Webhook auf UNSEREN Server, der VOR Gespraechsbeginn laeuft (in der Doku meist als Webhook fuer die Gespraechs-Initialisierung bzw. "conversation initiation" gefuehrt)? Kann dessen Antwort (1) den Anruf ABLEHNEN - das waere Tenant-Aufloesung, Kostendecke und Denylist -, (2) dynamische Variablen und Agent-Ueberschreibungen setzen - das waere der Pflichtsatz als erster Satz, die Sprache und die Stimme -, und (3) ist er signiert oder anders authentifiziert - das waere die Signaturpruefung? Gibt es Anbieter-Ereignisse fuer Anrufbeginn/-ende und eine Moeglichkeit, ein laufendes Gespraech von aussen zu beenden - das waere die Max-Dauer-Notbremse? Wenn ja, ist K3 der Kandidat, der Inbound WIRKLICH "genauso wie Outbound" macht: derselbe Agent, derselbe Transportweg, dieselbe Kostenquelle, KEIN eigener Gespraechs-Code bei uns. Wenn nein, sage GENAU, welche der vier Faehigkeiten fehlt.
K4 "Telnyx-Assistant": der schon gebaute Handoff. Nur als Vergleichsmassstab, und er ist fuer die Zielarchitektur diskreditiert: er ist ein DRITTES Gehirn mit eigenem Prompt, eigener Kostenquelle und einer statischen Plattform-Stimme in jeder Sprache. Er kommt nur dann noch in Frage, wenn K1, K2 und K3 alle drei widerlegt sind.`;

const FAEHIGKEIT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    thema: { type: "string" },
    mechanismen: {
      type: "array",
      description: "Je Eintrag EIN belegter oder widerlegter Mechanismus",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          id: { type: "string", description: "K1/K2/... oder eine neue Kennung" },
          existiert: { type: "string", enum: ["belegt", "widerlegt", "unbelegt"] },
          wieEsGeht: { type: "string", description: "Der Mechanismus in max 900 Zeichen: Endpunkt/Direktive/Feldnamen, woran die Zuordnung haengt" },
          beleg: { type: "string", description: "Anbieter-Doku-URL oder API-Antwort-Form oder Datei+Symbolname" },
          grenzen: { type: "string", description: "Was er NICHT kann: Formate, fehlende Ueberschreibungen, Einschraenkungen" },
          offeneFragen: { type: "array", items: { type: "string" } },
        },
        required: ["id", "existiert", "wieEsGeht", "beleg", "grenzen", "offeneFragen"],
      },
    },
    verdikt: { type: "string", description: "Ein Absatz: welcher Mechanismus traegt, welcher nicht, und warum" },
  },
  required: ["thema", "mechanismen", "verdikt"],
};

const FAEHIGKEITEN = [
  {
    key: "F1-anbieter",
    thema: "Was die ElevenLabs-Agents-Plattform fuer eingehende Anrufe wirklich anbietet",
    auftrag: `Belege am ANBIETER, nicht an unserem Code, welche Wege es gibt, einen eingehenden Anruf von einem EL-ConvAI-Agenten bedienen zu lassen.
- Nutze WebSearch/WebFetch auf die offizielle ElevenLabs-Dokumentation (Agents Platform / Conversational AI: Telefonie, SIP-Trunking inbound und outbound, Twilio-Anbindung, WebSocket-/Custom-Audio-Schnittstelle, conversation_initiation_client_data, Ueberschreibungen, dynamische Variablen, Sprach-Presets). Wenn ein Endpunkt existiert, nenne ihn beim Namen; wenn du ihn nicht belegen kannst, ist er unbelegt.
- Lade ausserdem das OpenAPI-Schema des Anbieters (https://api.elevenlabs.io/openapi.json) und pruefe daran, welche convai-Endpunkte und welche Ueberschreibungs-Pfade es GIBT. Das Projekt hat damit schon einmal einen naheliegenden, aber nicht existierenden Weg widerlegt - dasselbe Werkzeug, dieselbe Strenge.
- Fuer K2 ist die entscheidende Frage praezise: gibt es eine Schnittstelle, bei der WIR den Audiostrom liefern und empfangen (WebSocket), inklusive Agent-Ueberschreibungen und dynamischen Variablen je Gespraech? Nenne Audioformat und Abtastrate, die der Anbieter dort verlangt, und was er zurueckliefert.
- Fuer K1: kann ein Agent einen eingehenden SIP-INVITE annehmen, der von einem beliebigen Carrier kommt - und woran erkennt der Anbieter, WELCHER Agent gemeint ist (angerufene Nummer, Trunk-Zugangsdaten, SIP-Kopfzeile)? Braucht es dafuer dieselbe inbound_trunk_config, die wir bewusst weglassen, oder einen anderen Weg?
- ZWEITAUFTRAG, gleiche Strenge: lies unseren Agenten LIVE per GET auf den convai-Agenten-Endpunkt (Agenten-Kennung und Schluessel stehen in "${REPO}/.env", NIEMALS Werte zitieren) und nenne genau vier Dinge, die heute offen sind: das eingestellte TTS-Modell, die eingestellte Stimm-Kennung als Ja/Nein-Aussage "entspricht der kuratierten DE-Kennung aus ELEVENLABS_VOICE_ID_BY_PROFILE", die Liste der erlaubten Ueberschreibungen, und ob der Agent eine Inbound-Konfiguration traegt. NUR lesen, nie schreiben. Keine Kennung, kein Schluessel in der Rueckgabe - beschreibe, vergleiche, aber zitiere nicht.`,
  },
  {
    key: "F2-carrier",
    thema: "Was Telnyx aus einem bereits angenommenen Anruf heraus an eine externe Stelle abgeben kann",
    auftrag: `Unser Webhook hat den Anruf schon angenommen und den Pflichtsatz gesprochen. Welche Mechanismen gibt es DANACH, das Gespraech an eine externe Gegenstelle zu geben?
- Nutze WebSearch/WebFetch auf die offizielle Telnyx-Dokumentation: TeXML-Direktiven zum Verbinden auf eine SIP-Adresse, bidirektionales Media-Streaming (TeXML wie Call-Control), Transfer, Refer, und was davon MIT einem schon angenommenen Anruf geht. Nenne die Direktiven/Kommandos beim Namen.
- Pruefe, was unsere Adapter davon SCHON koennen: "${REPO}/src/telephony/adapters/telnyx/media.js", "${REPO}/src/telephony/adapters/telnyx/render.js", "${REPO}/src/telephony/adapters/telnyx/voice.js", "${REPO}/src/telephony/directives.js", "${REPO}/src/telephony/media-events.js", "${REPO}/src/bridge.js" und die streamDirectives-Naht in "${REPO}/src/routes/voice.js". Welche Direktive rendert der Renderer heute schon, welches Audioformat/welche Abtastrate liefert der Carrier im Media-Stream, und wie ist die Bridge heute verdrahtet (Schalter, Lebenszyklus, Barge-in, Anruf-Ende)?
- Beantworte konkret: laesst sich der Media-Stream ERST NACH einem gesprochenen Satz starten, oder muss er die erste Direktive sein? Und laeuft der Anruf weiter auf UNSEREM Leg (Gates, Max-Dauer-Timer, Kostenprofil greifen weiter) oder wird er weggegeben?
- Nenne ausdruecklich, was in "${REPO}/src/bridge.js" als HEIKLE STELLE markiert ist und warum - wer diese Naht fuer einen zweiten Anbieter benutzt, erbt genau diese Stellen.`,
  },
  {
    key: "F4-kosten",
    thema: "Was jede Variante pro Inbound-Minute kostet",
    auftrag: `Ohne Preis ist die Architekturentscheidung nicht entscheidbar. Rechne je Kandidat, belegt aus dem Repo.
- Lies den Kostenarten-Katalog und die Kostenprofile: "${REPO}/src/billing/kostenarten.js", "${REPO}/src/billing/metering.js", und suche die Profile (KOSTENPROFIL) samt der Traeger, die je Profil gebucht werden. Was kostet ein Inbound-Anruf HEUTE (Budget-Engine) je Minute, aus welchen Traegern setzt sich das zusammen, und was davon ist gemessen statt geschaetzt?
- Was kostet ein Outbound-Anruf heute (EL-Weg) je Minute, nach denselben Quellen? Es gibt im Projekt eine Lehre, dass der EL-Preis nach Turns und nicht nach Sekunden faellt - finde sie im Repo wieder und sage, ob sie hier greift.
- Leite daraus je Kandidat K1/K2 die erwartete Kostenstruktur ab: welche Traeger kommen dazu, welche fallen weg (unsere LLM-Token? unsere TTS-Zeichen? Carrier-Minuten doppelt, wenn ein zweites Leg entsteht?). Sage klar, wo du rechnest und wo du raetst.
- PFLICHTFRAGE ZUR BUCHHALTUNG (Owner-Vorgabe): heute wird ein Inbound-Anruf und ein Outbound-Anruf auf ZWEI verschiedenen Wegen verbucht (verschiedene Kostenprofile, verschiedene Traeger, verschiedene Quellen der Ist-Kosten). Beschreibe beide Wege in je drei Saetzen und sage dann, welcher Kandidat sie auf EINEN Weg zusammenfuehrt und welcher die Doppelung verfestigt. Ein Kandidat, der zwei Buchhaltungen zementiert, ist zu kennzeichnen.
- Pruefe zuletzt, ob die pro-Tenant-Kostendecke die neue Kostenstruktur ueberhaupt noch SIEHT: heute buchen die KI-Token in jeder Schleifenrunde live auf die Achse, die das Gate liest ("${REPO}/src/llm-usage.js", "${REPO}/src/budget-gate.js"). Bei einem Anbieter-gefuehrten Gespraech gibt es diese Schleifenrunden nicht. Welcher Traeger bucht dann, wann, und wie oft - und was heisst das fuer das Gate? Das ist die wichtigste Frage dieses Auftrags.`,
  },
];

phase("Faehigkeiten");
const [f1, f2, f4, gate] = await parallel([
  ...FAEHIGKEITEN.map((f) => () =>
    agent(
      `Du bist FAEHIGKEITS-AGENT fuer "${f.thema}". Du analysierst und belegst, du aenderst NICHTS.
${LAGE}
${KANDIDATEN}
${HAUSREGELN}
DEIN AUFTRAG:
${f.auftrag}
Arbeite gezielt - jede Datei und jede Doku-Seite, die du ganz liest, zahlt sich in jedem weiteren Turn erneut. Bleib in DEINEM Thema. Fuelle das Schema; "unbelegt" ist ein respektables Ergebnis und allemal besser als eine erfundene Faehigkeit.`,
      { label: f.key, phase: "Faehigkeiten", schema: FAEHIGKEIT_SCHEMA, ...FAEHIGKEIT_AGENT },
    ),
  ),
  () =>
    agent(
      `Du bist GATE-PRUEFER und der sicherheitskritische Agent dieses Laufs. Frage: welche der sieben Sicherungen am Inbound-Webhook ueberlebt jeden Kandidaten - und welche muesste neu gebaut werden, wo?
${LAGE}
${KANDIDATEN}
${HAUSREGELN}
VORGEHEN:
1. Lies den Inbound-Pfad wirklich: "${REPO}/src/routes/voice.js" (POST /voice/incoming, POST /voice/turn, die Signatur-Middleware, streamDirectives), "${REPO}/src/telephony/webhook-idempotenz.js", "${REPO}/src/budget-gate.js", "${REPO}/src/call-duration.js", "${REPO}/src/telephony/call-lifecycle.js", "${REPO}/src/telephony/call-termination.js", "${REPO}/src/i18n/inbound-notice.js", "${REPO}/src/llm-usage.js".
2. Lies, wie die BESTEHENDE Bridge mit denselben Fragen umgeht: "${REPO}/src/bridge.js" - insbesondere, welche Gates auf dem Realtime-Inbound-Pfad heute greifen und welche NICHT. Das ist der ehrlichste Vorboten-Beleg fuer K2, weil dieser Pfad schon existiert. Pruefe ausdruecklich: laeuft die Max-Dauer-Notbremse dort? Bucht dort etwas auf die Budget-Achse? Wird der Pflichtsatz dort gerendert?
3. Pruefe fuer K1 und K2 je Sicherung (1) bis (7): ueberlebt sie unveraendert, ueberlebt sie nur mit neuem Code (welchem, an welcher Naht), oder faellt sie weg? Eine Sicherung, die "im Prinzip noch da" ist, aber niemanden mehr stoppt, faellt WEG - sag das dann auch so.
4. Benenne die Gefahren, die ein anbieter-gefuehrtes Gespraech NEU einfuehrt: ein Anruf, den unser Prozess nicht mehr beenden kann; ein Gespraech, das laeuft, waehrend das Tenant-Guthaben erschoepft ist; ein Anruf ohne Kostenprofil; ein Pflichtsatz, der vom Anbieter statt von uns gesprochen wird; ein Neustart mitten im Gespraech.
Deine Rueckgabe entscheidet, ob die Zielarchitektur zulaessig ist. Im Zweifel benenne die Luecke - nicht die Hoffnung.`,
      { label: "F3-gates", phase: "Faehigkeiten", schema: {
        type: "object",
        additionalProperties: false,
        properties: {
          sicherungen: {
            type: "array",
            description: "Je Eintrag EINE der sieben Sicherungen, bewertet fuer K1 und K2",
            items: {
              type: "object",
              additionalProperties: false,
              properties: {
                nummer: { type: "number" },
                name: { type: "string" },
                heute: { type: "string", description: "Wo sie heute greift, Datei + Symbolname" },
                k1: { type: "string", enum: ["ueberlebt", "nur-mit-neuem-code", "faellt-weg"] },
                k2: { type: "string", enum: ["ueberlebt", "nur-mit-neuem-code", "faellt-weg"] },
                neuerCode: { type: "string", description: "Welcher Code an welcher Naht noetig waere, leer wenn keiner" },
              },
              required: ["nummer", "name", "heute", "k1", "k2", "neuerCode"],
            },
          },
          realtimeVorbote: { type: "string", description: "Was der bestehende Realtime-Inbound-Pfad ueber die Gate-Lage von K2 BELEGT, max 1200 Zeichen" },
          neueGefahren: { type: "array", items: { type: "string" } },
          zulaessig: {
            type: "object",
            additionalProperties: false,
            properties: {
              k1: { type: "boolean" },
              k2: { type: "boolean" },
              begruendung: { type: "string" },
            },
            required: ["k1", "k2", "begruendung"],
          },
          verdikt: { type: "string" },
        },
        required: ["sicherungen", "realtimeVorbote", "neueGefahren", "zulaessig", "verdikt"],
      }, ...GATE_AGENT },
    ),
]);

const belegBlock = `=== F1 ANBIETER ===\n${JSON.stringify(f1 ?? { fehlt: true }, null, 1)}\n\n=== F2 CARRIER ===\n${JSON.stringify(f2 ?? { fehlt: true }, null, 1)}\n\n=== F3 GATES ===\n${JSON.stringify(gate ?? { fehlt: true }, null, 1)}\n\n=== F4 KOSTEN ===\n${JSON.stringify(f4 ?? { fehlt: true }, null, 1)}`;

phase("Entscheidung");
const ENTSCHEIDUNG_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    docPath: { type: "string" },
    zielarchitektur: { type: "string", description: "EIN System - welches, in max 700 Zeichen" },
    mechanismus: { type: "string", description: "Der gewaehlte Mechanismus und sein Beleg, max 700 Zeichen" },
    machbar: { type: "boolean", description: "false, wenn KEIN Mechanismus die sieben Sicherungen behaelt - dann traegt das Dokument den Nachweis, warum zwei Systeme vorerst bleiben" },
    phasen: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          phaseId: { type: "string" },
          titel: { type: "string" },
          ziel: { type: "string" },
          hebel: { type: "string", enum: ["hoch", "mittel", "niedrig"] },
          aufwand: { type: "string", enum: ["klein", "mittel", "gross"] },
          hochrisiko: { type: "boolean" },
          braucthOwner: { type: "boolean" },
          ueberlebtWeiche: { type: "boolean", description: "true, wenn die Phase auch nach dem Umstieg auf ein System noch Wert hat" },
        },
        required: ["phaseId", "titel", "ziel", "hebel", "aufwand", "hochrisiko", "braucthOwner", "ueberlebtWeiche"],
      },
    },
    entfallen: { type: "array", items: { type: "string" }, description: "Welche Phasen der alten Kette gestrichen oder zurueckgestellt sind, je mit Grund" },
    ownerEntscheidungen: { type: "array", items: { type: "string" } },
    offeneMessungen: { type: "array", items: { type: "string" } },
    zusammenfassung: { type: "string", description: "max 900 Zeichen" },
  },
  required: ["docPath", "zielarchitektur", "mechanismus", "machbar", "phasen", "entfallen", "ownerEntscheidungen", "offeneMessungen", "zusammenfassung"],
};
const entscheidung = await agent(
  `Du schreibst die Leitentscheidung und die Phasenkette von "${DOC_PATH}" NEU. Das Dokument existiert und ist gut; du ersetzt gezielt seine Abschnitte 2 (Leitentscheidung), 3 (Pre-Mortem) und 4 (Phasenkette) und ziehst Abschnitt 6 (offene Messungen / Owner-Entscheidungen) nach. Abschnitt 1 (Ausgangslage, die vier belegten Wurzeln W1-W4) bleibt inhaltlich stehen - er ist am Code belegt; du darfst ihn um die neuen Belege ERGAENZEN, aber nichts Belegtes daraus streichen.
${LAGE}
${KANDIDATEN}
${HAUSREGELN}
=== BELEGE DIESES LAUFS ===
${belegBlock}
=== ENDE BELEGE ===

DER AUFTRAG DES OWNERS: EIN Gespraechs-System fuer beide Richtungen. Nicht zwei, und erst recht nicht drei. Der alte Plan hat den Telnyx-Assistant als drittes Gehirn scharfgestellt - das ist damit vom Tisch, ausser die Belege zeigen, dass er der EINZIGE Weg zu einem System ist.

SO ENTSCHEIDEST DU:
0. RANGFOLGE: gewinnt der Mechanismus, der am Ende am WENIGSTEN eigene Gespraechslogik und am wenigsten eigene Buchhaltung bei uns zurueck laesst - bei gleichem Sicherungsniveau. "Schnell zu bauen" ist ein Tiebreaker, kein Kriterium. Pruefe K3 zuerst, denn er ist der einzige Kandidat, der Inbound woertlich so fahren wuerde wie Outbound (Anbieter fuehrt das Gespraech, unser Server entscheidet vorher und protokolliert danach) - K1 und K2 lassen jeweils eigenen Code bei uns zurueck, K2 sogar eine komplette Audio-Bridge.
1. Traegt ein Mechanismus, der den EL-Agenten bedient, OHNE dass eine der sieben Sicherungen faellt? Der Gate-Pruefer hat je Sicherung geurteilt - eine Sicherung, die "nur-mit-neuem-code" ueberlebt, ist zulaessig, wenn dieser Code in der Kette als eigene Phase steht, VOR dem Scharfstellen. Eine Sicherung, die "faellt-weg", ist ein Abbruchgrund fuer diesen Mechanismus; Absolute Regel 1 und 2 stehen nicht zur Abwaegung.
2. Ist KEIN Mechanismus zulaessig, dann ist das Ergebnis machbar=false - und das Dokument sagt dem Owner ehrlich, dass ein System heute nicht geht, WORAN es haengt (Anbieter-Faehigkeit oder Sicherung), und welche Messung oder welche Anbieter-Aenderung es freischalten wuerde. Ein ehrliches Nein ist hier das bessere Produkt als eine gebaute Hoffnung.
3. Ist einer zulaessig, baue die Kette so: die schnellen Fixes, die den Owner HEUTE hoerbar entlasten und den Umstieg ueberleben, kommen zuerst (Aussprache, Stimme - siehe W1/W2); dann die Sicherungs-Phasen, die der neue Pfad braucht; dann der Pfad selbst hinter einem Schalter (aus = byte-identisch zum Bestand); zuletzt das Abschalten und ENTFERNEN der ueberzaehligen Engines, damit am Ende wirklich EIN System steht und nicht ein viertes dazukommt. Benenne ausdruecklich, was am Ende geloescht wird - eine Konsolidierung, die nichts entfernt, ist keine.
4. Ordne die Phasen der ALTEN Kette ein: welche ueberleben unveraendert, welche werden ueberflueessig, welche werden zurueckgestellt. Die Phase IP1 (Orthografie des deutschen Begruessungskatalogs) laeuft dem Owner gerade in der Umsetzung - pruefe und sage, ob ihr Ergebnis auf dem neuen Weg noch gebraucht wird, und wenn nicht, warum nicht.
5. PRE-MORTEM neu: ein Jahr weiter, die Konsolidierung ist gescheitert. Denke ausdruecklich an: ein eingehender Anruf erreicht niemanden mehr; ein Anruf, den unser Prozess nicht beenden kann; ein Gespraech auf Kosten eines Tenants ohne Guthaben; der Pflichtsatz faellt weg oder kommt vom Anbieter; der heute funktionierende Outbound-Pfad geht beim Umbau kaputt; der Anbieter aendert seine Schnittstelle und wir haben keinen zweiten Weg mehr. Jedes Risiko entschaerft oder ausdruecklich akzeptiert.
FORM: dieselbe wie bisher - je Phase ein Abschnitt "## Phase <ID> - <Titel>" mit Ziel (deterministisch pruefbar), Scope, NICHT-Scope, betroffenen Dateien/Nahtstellen, Invarianten, Abnahmekriterium (Kommando + erwartete Ausgabe), Testpflicht, Risiko + Rueckfall, Owner/Testanruf. Das Dokument IST die Spec fuer die spaeteren Umsetzungs-Workflows; ein Abschnitt, der eine Frage offen laesst, produziert einen geratenen Umbau. Neue Phasen bekommen neue Kennungen - vergib KEINE Kennung zweimal, auch nicht fuer eine geaenderte Phase; die alten Kennungen der ueberlebenden Phasen bleiben. Hoechstens 9 Phasen.
Schreibe die Datei mit dem Edit-/Write-Werkzeug zurueck. Kein Code, kein git-Commit, keine zweite Datei.`,
  { label: "entscheidung", phase: "Entscheidung", schema: ENTSCHEIDUNG_SCHEMA, ...ENTSCHEIDUNG_AGENT },
);

phase("Gegenprobe");
const gegenprobe = await agent(
  `Du bist ADVERSARIALER PRUEFER der NEUEN Leitentscheidung in "${DOC_PATH}". Deine Aufgabe ist, sie zu widerlegen, wo sie falsch ist. Du aenderst NICHTS.
${HAUSREGELN}
VORGEHEN:
1. Lies in "${DOC_PATH}" die Abschnitte 2, 3, 4 und 6 sowie jeden Phasen-Abschnitt.
2. Pruefe JEDE Aussage ueber eine Anbieter- oder Carrier-Faehigkeit: ist sie mit einer Doku-URL oder einer API-Form belegt, oder ist sie eine Annahme in Behauptungsform? Eine unbelegte Anbieter-Faehigkeit, auf der eine Phase steht, ist der schwerste Befund, den du melden kannst - genau daran hat sich dieses Projekt schon verletzt.
3. Pruefe jede Aussage ueber unseren Code am echten Code (Datei + Symbolname).
4. Pruefe die Kette gegen die Absoluten Regeln: bleibt die pro-Tenant-Kostendecke fuer Inbound wirksam, in JEDEM Zwischenzustand der Kette - nicht nur am Ende? Bleibt der Inbound-Pflichtsatz von UNS gerendert? Bleibt die Signaturpruefung fail-closed? Steht jede Phase, die Live-Verhalten aendert, hinter einem Schalter, und ist "Schalter aus" wirklich byte-identisch?
5. Pruefe die REIHENFOLGE: gibt es einen Zwischenzustand, in dem der neue Pfad schon Anrufe bedient, aber eine Sicherung noch nicht gebaut ist? Das ist ein Blocker, auch wenn das Endbild sauber ist.
6. Pruefe jeden Phasen-Abschnitt auf Umsetzbarkeit: fehlt Scope, Abgrenzung, Invariante, Abnahmekriterium oder Testpflicht, benenne genau die fehlende Angabe.
Melde nur, was du belegen kannst - und dann ohne Milde. Findest du nichts, ist tragfaehig=true das richtige Ergebnis.`,
  { label: "gegenprobe", phase: "Gegenprobe", schema: {
    type: "object",
    additionalProperties: false,
    properties: {
      geprueftAnzahl: { type: "number" },
      unbelegteAnbieterFaehigkeiten: { type: "array", items: { type: "string" }, description: "Phasen-tragende Anbieter-Aussagen ohne Beleg - der schwerste Befund" },
      widerlegt: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            behauptung: { type: "string" },
            befund: { type: "string" },
            beleg: { type: "string" },
            schwere: { type: "string", enum: ["tragend", "randstaendig"] },
          },
          required: ["behauptung", "befund", "beleg", "schwere"],
        },
      },
      reihenfolgeLuecken: { type: "array", items: { type: "string" } },
      regelverstoesse: { type: "array", items: { type: "string" } },
      luecken: { type: "array", items: { type: "string" } },
      tragfaehig: { type: "boolean" },
      verdikt: { type: "string" },
    },
    required: ["geprueftAnzahl", "unbelegteAnbieterFaehigkeiten", "widerlegt", "reihenfolgeLuecken", "regelverstoesse", "luecken", "tragfaehig", "verdikt"],
  }, ...GEGENPROBE_AGENT },
);

return {
  docPath: (entscheidung && entscheidung.docPath) || DOC,
  machbar: entscheidung ? entscheidung.machbar : null,
  zielarchitektur: (entscheidung && entscheidung.zielarchitektur) || "",
  mechanismus: (entscheidung && entscheidung.mechanismus) || "",
  gateZulaessig: gate ? gate.zulaessig : null,
  gateFaelltWeg: gate ? (gate.sicherungen || []).filter((s) => s.k1 === "faellt-weg" || s.k2 === "faellt-weg").map((s) => `${s.nummer} ${s.name}: K1=${s.k1} K2=${s.k2}`) : [],
  phasen: (entscheidung && entscheidung.phasen) || [],
  entfallen: (entscheidung && entscheidung.entfallen) || [],
  ownerEntscheidungen: (entscheidung && entscheidung.ownerEntscheidungen) || [],
  offeneMessungen: (entscheidung && entscheidung.offeneMessungen) || [],
  gegenprobeTragfaehig: gegenprobe ? gegenprobe.tragfaehig : null,
  gegenprobeGeprueft: gegenprobe ? gegenprobe.geprueftAnzahl : null,
  unbelegteAnbieterFaehigkeiten: gegenprobe ? gegenprobe.unbelegteAnbieterFaehigkeiten : [],
  widerlegtTragend: gegenprobe ? (gegenprobe.widerlegt || []).filter((w) => w.schwere === "tragend").map((w) => w.behauptung) : [],
  reihenfolgeLuecken: gegenprobe ? gegenprobe.reihenfolgeLuecken : [],
  zusammenfassung: (entscheidung && entscheidung.zusammenfassung) || "",
};
