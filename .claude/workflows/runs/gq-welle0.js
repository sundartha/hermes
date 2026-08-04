export const meta = {
  name: "gq-welle0-kartierung",
  description:
    "Gespraechsqualitaet Welle 0: nur-lesende Kartierung je Befund (B-1..B-10, O-1/O-3/O-10) + Pruefstand-Entwurf",
  phases: [{ title: "Kartierung", detail: "ein Plan-Agent je Befund, alle parallel, nur lesend" }],
};

// Hart gepinnt - NICHT ueber args (dokumentierte Args-Misfire-Falle).
const REPORT_DIR = "tasks/gq-welle0";
const BASIS_COMMIT = "master";

const SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: [
    "befund",
    "phase_titel",
    "wurzel_hypothese",
    "wurzel_belegt",
    "dateien",
    "abhaengt_von",
    "risiko",
    "messgroesse_am_pruefstand",
    "aufwand",
    "offene_frage_an_owner",
    "bericht_pfad",
  ],
  properties: {
    befund: { type: "string", description: "Die ID, z.B. B-1" },
    phase_titel: { type: "string", description: "Kurzer Phasenname, deutsch, ohne Umlaute" },
    wurzel_hypothese: {
      type: "string",
      description: "Die vermutete Wurzel in 1-3 Saetzen, mit Datei:Zeile wo belegbar",
    },
    wurzel_belegt: {
      type: "string",
      enum: ["am-code-belegt", "hypothese-messbar", "hypothese-unbelegt"],
      description:
        "am-code-belegt = du hast die Stelle gelesen und sie erklaert den Befund. hypothese-unbelegt = du raetst. Rate NICHT als belegt aus.",
    },
    dateien: {
      type: "array",
      items: { type: "string" },
      description:
        "Repo-relative Pfade, die eine Phase zu diesem Befund AENDERN muesste. Das ist der Zweck dieser Welle - sei genau, nicht grosszuegig. Nur Dateien, die wirklich angefasst werden, keine, die man nur liest.",
    },
    abhaengt_von: {
      type: "array",
      items: { type: "string" },
      description: "Befund-IDs, die vorher erledigt sein muessen. Leer wenn unabhaengig.",
    },
    risiko: {
      type: "string",
      description:
        "Pre-Mortem: die Aenderung ist ein Jahr spaeter als Fehler erkannt worden - was ist passiert? Beruehrt sie Safety-Gates, Offenlegung, Auth, Kostendecken?",
    },
    messgroesse_am_pruefstand: {
      type: "string",
      description:
        "Die EINE Zahl, an der man vorher/nachher misst. Muss aus einem abgespielten Anruf ablesbar sein.",
    },
    aufwand: { type: "string", enum: ["klein", "mittel", "gross"] },
    offene_frage_an_owner: {
      type: "string",
      description: "Leerstring wenn keine. Nur echte Entscheidungen, keine Rueckversicherung.",
    },
    bericht_pfad: { type: "string" },
  },
};

const REGELN = `
KONTEXT
Du kartierst EINEN Befund fuer die Kette "Gespraechsqualitaet" des Telefon-KI-Agenten Hermes
(Node/ESM, kein Build-Step). Der Owner hat nach einem Testanruf gesagt: "eine absolute
Katastrophe, von vorne bis hinten stimmt absolut gar nichts." 17 vorherige Phasen waren
gruen und haben nichts geaendert - weil der Feedback-Loop kaputt war, nicht der Ablauf.

HARTE REGELN
1. NUR LESEN. Du aenderst KEINEN Produktionscode, keine Konfiguration, keine Tests.
   Die EINZIGE Datei, die du schreibst, ist dein Bericht (Pfad unten).
2. Du arbeitest gegen den aktuellen Stand von ${BASIS_COMMIT} im Hauptverzeichnis.
   Kein Worktree, kein Branch, kein git checkout, kein npm test, kein Server-Start.
3. Du RAETST NICHT. Wenn du die Wurzel nicht am Code belegen kannst, schreibst du
   wurzel_belegt="hypothese-unbelegt" und nennst die Messung, die sie belegen wuerde.
   Dieses Repo hat schon einmal 297 von 297 Belegen verloren, weil jemand Feldnamen
   geraten hat. Ein ehrliches "unbelegt" ist wertvoller als eine plausible Erfindung.
4. Lies gezielt (grep -n, dann die Fundstelle), nicht ganze Dateien am Stueck.
5. Beruehrt dein Befund Safety-Gates (Kostendecke, OUTBOUND_FROZEN, Signaturpruefung),
   den Offenlegungssatz oder Auth, sagst du das im Feld "risiko" ausdruecklich.
   Diese duerfen NIE aufgeweicht werden.

WAS "dateien" BEDEUTET
Aus deiner Liste berechnet der Lead, welche Phasen parallel laufen duerfen:
disjunkte Dateimengen = parallel, jede Ueberschneidung = seriell. Eine zu grosszuegige
Liste serialisiert die ganze Kette unnoetig; eine zu knappe erzeugt Merge-Konflikte.
Nenne nur, was eine Phase wirklich aendern muss.

BERICHT
Schreibe deinen Detailbericht nach ${REPORT_DIR}/<befund>.md (kleingeschrieben, z.B. b-1.md):
Wurzel mit Datei:Zeile, was du geprueft und was du NICHT geprueft hast, Loesungsskizze,
Rueckweg. Kommentare/Doku auf Deutsch OHNE Umlaute (ue/oe/ae), wie im Bestand.
Die strukturierte Rueckgabe traegt nur Zahlen und Pfade - kein Fliesstext-Dump.
`;

const BEFUNDE = [
  {
    id: "B-1",
    modell: "opus",
    effort: "high",
    titel: "Doppel-Turns aus der Spracherkennung",
    auftrag: `
B-1 IST DIE WURZEL DER GANZEN KETTE. Solange sie steht, misst jeder andere Befund Rauschen.

DER BEFUND, am echten Anruf belegt (call_msczdf1aadbw, 2026-08-03):
Aeusserungen der Gegenstelle kommen DOPPELT an - einmal angefangen, einmal vollstaendig
(Zwischenergebnis + Endergebnis der Spracherkennung). BEIDE loesen einen eigenen
Agenten-Turn aus. Der Agent beginnt zu sprechen, ~1,5 s spaeter startet die zweite Runde
und ueberschreibt ihn. Fuer den Anrufer klingt das, als schneide sich der Agent selbst
das Wort ab.

DAS ROHMATERIAL LIEGT VOR - lies es zuerst, es ist der Beleg:
data/evidence/db-2026-08-04/call_msczdf1aadbw.tsv  (Spalten: seq, rolle, zeit, text)
  Segment 9  08:43:15.745 caller  "...frag deinen besitzer welches automodell er hat damit ich weiss"
  Segment 10 08:43:17.880 caller  dieselbe Aeusserung, vollstaendiger
  Segment 11 08:43:18.583 agent   Antwort auf 9
  Segment 12 08:43:20.061 agent   Antwort auf 10, 1,478 s spaeter, ueberschreibt 11
Weitere Belege: call_msahzky8m8p9.tsv (01.08., VOR dem Streaming-Deploy - dasselbe Muster,
also NICHT vom Streaming verursacht) und call_msehh15xn34h.tsv / call_msegxsp9qucb.tsv (04.08.).
Am 04.08. lagen in call_mseip2888klk turnSeq 1 und 2 EINE MILLISEKUNDE auseinander.

DEINE AUFGABE
Finde die Stelle im Code, an der eine eingehende Spracherkennungs-Nachricht einen
Agenten-Turn ausloest, und beantworte: warum loest das Zwischenergebnis ueberhaupt einen
Turn aus? Gibt es ein Feld, das Zwischen- von Endergebnis unterscheidet (is_final,
interim, confidence, partial o.ae.), und wird es gelesen? Wird ein laufender Turn beim
Eintreffen des naechsten abgebrochen - und wenn ja, wo?
Relevanter Bereich: der Telnyx-Assistant-/Shim-Pfad (src/telnyx-llm-shim.js,
src/telnyx-inbound.js, src/routes/voice.js, src/telephony/adapters/telnyx/*) und der
Budget-Engine-Pfad (Gather/STT). WICHTIG: outbound und inbound sind zwei verschiedene
Maschinen (siehe B-9) - sag ausdruecklich, fuer WELCHE Richtung deine Wurzel gilt.

WENN DU DIE UNTERSCHEIDUNG NICHT IM CODE FINDEST: sag das. Dann ist die naechste Frage,
ob das Provider-Ereignis das Feld ueberhaupt mitliefert - und das ist eine MESSUNG am
Live-Webhook, keine Vermutung. Nenne sie als solche. Rate KEINEN Feldnamen.
`,
  },
  {
    id: "PRUEFSTAND",
    modell: "opus",
    effort: "high",
    titel: "Wiederholungs-Pruefstand",
    auftrag: `
DU ENTWIRFST DEN PRUEFSTAND. Er blockiert die ganze Kette und ist Welle 1.

WARUM ER GEBRAUCHT WIRD
17 Phasen wurden gegen "npm test" und einen Conversation-Bench abgenommen. Beide waren
gruen, waehrend das Telefonat kaputt war. Der Bench simuliert die Gegenstelle mit einem
sauberen Modell: er erzeugt KEINE doppelten Turns, KEIN Kauderwelsch, KEINE Halbsaetze -
also genau die Bedingungen nicht, unter denen der Agent scheitert. Gemessen am 02.08.:
ein eigens gebautes Bench-Szenario feuerte look_up 5/5, waehrend es live 0/12 feuerte.
Ein Szenario, das den Defekt nicht reproduziert, kann keinen Fix belegen.

WAS ER LEISTEN MUSS
Echte Anrufe abspielen: die tatsaechlichen Gegenstellen-Turns in ihrer tatsaechlichen
Reihenfolge und mit ihren tatsaechlichen Zeitabstaenden, INKLUSIVE der Doppel-Zustellungen
und des Kauderwelschs, gegen den echten Agenten-Turn-Pfad.
Ausgabe je Lauf: welche Werkzeuge angeboten / welche gefeuert, Anzahl Turns, Anzahl
inhaltlicher Wiederholungen, ob end_call kam, wie viele Antworten von einer spaeteren
ueberschrieben wurden.

ROHMATERIAL (liegt bereit, mit Zeitstempeln):
data/evidence/db-2026-08-04/*.tsv - Spalten: seq, rolle(caller|agent), ISO-Zeit, text
  call_msczdf1aadbw.tsv  38 Segmente, Beleg-Anruf 03.08. fuer B-1..B-7
  call_msahzky8m8p9.tsv  24 Segmente, 01.08., B-1 vor dem Streaming-Deploy
  call_msabz9975sph.tsv  17 Segmente, 01.08.
  call_msehh15xn34h.tsv / call_msegxsp9qucb.tsv  04.08., outbound
Aeltere Kopien ohne Zeitstempel liegen unter data/evidence/*.txt.

DIE ABNAHME - und sie ist hart:
Der Pruefstand muss B-1, B-4, B-5 und B-6 ROT reproduzieren.
  B-1 der Agent antwortet zweimal auf dieselbe Aeusserung
  B-4 look_up feuert nie (live: 0 von 19 Turns, obwohl in 19 angeboten)
  B-5 end_call feuert nie (live: 0 von 19)
  B-6 take_message feuert 8 mal mit derselben Nachricht
Reproduziert er sie nicht, ist er wertlos.

DEINE ENTSCHEIDUNGEN, die du begruenden musst:
1. An welcher Naht setzt er an? Prozess-extern (HTTP gegen einen lokal gestarteten Server)
   oder in-process (die Turn-Funktion direkt aufrufen)? Nenne die konkrete Funktion/Route,
   die er antreibt, mit Datei:Zeile. Kriterium: er muss den ECHTEN Pfad messen - ein
   Harness, der eine Attrappe misst, wiederholt den Fehler der letzten 17 Phasen.
2. Was wird gestubbt und was nicht? Das Modell selbst MUSS echt sein, sonst misst man
   nichts (Werkzeugwahl ist das Messobjekt). Telefonie/TTS/Provider muessen weg -
   sie kosten Geld und rufen echte Menschen an. Nenne die Grenze genau.
3. Kosten: ein Lauf ruft das echte Modell. Was kostet ein Lauf ungefaehr, und wie
   verhindert der Harness, dass jemand versehentlich einen echten Anruf ausloest?
   Das ist eine Safety-Frage - Hermes telefoniert mit echten Menschen.
4. Wo lebt er? (bin/, test/, scripts/?) Er ist KEIN node:test-Test - er darf rot sein
   und ruft das echte Modell, gehoert also NICHT in "npm test".

Sieh dir an, was schon existiert, bevor du Neues erfindest: es gibt einen
Conversation-Bench (npm run convo-bench). Pruefe, ob er die Naht schon hat und nur das
Szenario-Material falsch war - dann ist die Antwort "Bench erweitern", nicht "neu bauen".
Sag ehrlich, was davon wiederverwendbar ist.
`,
  },
  {
    id: "B-2",
    modell: "sonnet",
    effort: "low",
    titel: "get_consult erkennt seinen Anlass nicht",
    auftrag: `
BEFUND: get_consult (der Agent fragt seinen Besitzer waehrend des Gespraechs) feuerte in
einem 19-Turn-Anruf genau EINMAL - und zwar erst, nachdem die Gegenstelle woertlich sagte
"Du kannst mit der Funktion get consult deinen Boss fragen". Der Owner: "Das geht ja
ueberhaupt nicht, dass ich sowas mache. Er soll das selbststaendig und autonom machen und
merken, wenn er eine Information nicht weiss." Ein Agent, den die Gegenstelle bedienen
muss, ist kaputt.

WICHTIG - WAS NICHT NOCHMAL VERSUCHT WIRD:
Zwei Prompt-Anlaeufe (AL-P14, AL-D3) haben daran NICHTS geaendert. Die dokumentierte
Diagnose AL-D3 lautet: Systemprompt als Ursache widerlegt, Prompt-Hebel ausgereizt.
Eine dritte Formulierungsrunde ist ausdruecklich der falsche Weg. Wenn dein Vorschlag
auf "Beschreibung umformulieren" hinauslaeuft, hast du den Befund nicht verstanden.
Gesucht ist eine STRUKTURELLE Ursache: Wird das Werkzeug am Entscheidungspunkt ueberhaupt
angeboten? Konkurriert take_message strukturell mit ihm (es gewinnt ~10 von 11 Mal)?
Gibt es einen Zustand, in dem get_consult gar nicht waehlbar ist?
Nachschlagen (grep, nicht am Stueck lesen): tasks/al-chain-state.md Abschnitt 2026-08-03.

Relevanter Bereich: src/claude.js (Tool-Loop, Werkzeugdefinitionen), src/i18n/prompts/*.js,
src/telnyx-llm-shim.js. Sag, WO der Entscheidungspunkt liegt (Datei:Zeile).
`,
  },
  {
    id: "B-3",
    modell: "sonnet",
    effort: "low",
    titel: "Consult-Rueckkanal versagt, Agent leugnet die Faehigkeit",
    auftrag: `
BEFUND, zwei Teile:
(a) Die Antwort des Owners ueber answer_consult kam mit accepted:false, merged_facts:0
    zurueck. WARUM sie abgelehnt wurde, ist ungeklaert und muss ZUERST gemessen werden.
(b) Zwei Segmente spaeter sagte der Agent: "Ich habe leider keine Funktion, um Antonio
    direkt zu konsultieren - das geht technisch nicht." - nachdem er sie gerade benutzt
    hatte. Eine Falschaussage gegenueber der Gegenstelle.

Finde den Ablehnungspfad von answer_consult: welche Bedingungen setzen accepted=false?
Welche fuehren zu merged_facts=0? Gibt es ein Zeitfenster, eine Zuordnung ueber eine ID,
eine Statuspruefung? Nenne jede Bedingung mit Datei:Zeile.
Fuer (b): woher kommt die Behauptung "das geht technisch nicht"? Steht sie im Prompt,
oder erfindet das Modell sie, weil der Rueckkanal leer blieb? Sag, welches von beidem
du belegen kannst - und wenn du es nicht kannst, sag das.
Relevanter Bereich: src/claude.js, src/mcp-tools.js, src/store/*, src/i18n/prompts/*.js.
`,
  },
  {
    id: "B-4",
    modell: "sonnet",
    effort: "low",
    titel: "look_up feuert nie",
    auftrag: `
BEFUND: look_up (Internetrecherche, Anbieter ist Exa) wurde in 19 von 19 Turns ANGEBOTEN
und 0 mal GEFEUERT. Auf "Wann wurde Fiat gegruendet?" antwortete der Agent
"Fiat wurde 1899 gegruendet" aus dem Gedaechtnis und sagte danach "das wusste ich einfach".
Der Owner hat zweimal ausdruecklich eine Internetrecherche verlangt und keine bekommen.

Gemessen und dokumentiert (02.08.): das eigens gebaute Bench-Szenario feuerte look_up
schon mit den ALTEN Beschreibungen 5/5, waehrend es live 0/12 feuerte. Der Bench belegt
hier also nichts - das ist genau der Grund, warum der Pruefstand gebaut wird.

Kartiere: Wo wird look_up definiert und angeboten (Datei:Zeile)? Gibt es ein Gate, das
es in bestimmten Richtungen/Zustaenden ausschliesst (inbound hat laut B-9 KEIN look_up)?
Wird das Ergebnis eines Aufrufs ueberhaupt in die Antwort zurueckgefuehrt?
Eine Prompt-Umformulierung ist NICHT die gesuchte Antwort - such nach einer strukturellen
Ursache. Wenn du keine findest, sag das ehrlich und nenne die Messung, die entscheiden wuerde.
`,
  },
  {
    id: "B-5",
    modell: "sonnet",
    effort: "low",
    titel: "Der Agent legt nicht auf",
    auftrag: `
BEFUND: end_call wurde in 19 von 19 Turns nicht aufgerufen. Nach "Gut, dann gebe ich
Antonio Bescheid" redet der Agent weiter. Der Anrufer musste selbst auflegen.

Das zahlt direkt auf eine NEUE Owner-Vorgabe ein (O-3): "So kurz wie moeglich" - jede
telefonierte Minute kostet 30 ct und ist der groesste Kostenblock. ABER: O-3 sagt
ausdruecklich MESSGROESSE, KEINE KAPPE. Keine harte Turn- oder Sekundengrenze, weil eine
Kappe Gespraeche mitten durchschneidet. Die bestehende Max-Dauer-Notbremse als
Safety-Gate bleibt unberuehrt - fass sie NICHT an.

Kartiere: Wo ist end_call definiert, wo wird es angeboten, und was passiert, wenn es
feuert (legt es wirklich auf, oder setzt es nur ein Flag)? Gibt es einen Zustand, in dem
es gar nicht angeboten wird? Kommt es beim Budget-Engine-Pfad (inbound) ueberhaupt vor?
`,
  },
  {
    id: "B-6",
    modell: "sonnet",
    effort: "low",
    titel: "Pathologische Wiederholung von take_message",
    auftrag: `
BEFUND: take_message feuerte in einem Anruf 8 mal, jedes Mal mit derselben Nachricht.
Die Segmente 18, 23, 24, 26, 30, 32, 34, 38 tragen im Kern denselben Satz. Der Anrufer
hoerte achtmal dieselbe Zusage.
Beleg: data/evidence/db-2026-08-04/call_msczdf1aadbw.tsv - lies die genannten Segmente.

Kartiere: Gibt es eine Deduplizierung oder Idempotenz bei take_message? Wird eine bereits
aufgenommene Nachricht dem Modell im naechsten Turn als "schon erledigt" sichtbar gemacht,
oder sieht es in jeder Runde eine unveraenderte Ausgangslage?
Beachte den Zusammenhang mit B-1: wenn jede Aeusserung zwei Turns ausloest, verdoppelt
das die Wiederholungen automatisch. Sag ausdruecklich, welcher Anteil auf B-1 zurueckgeht
und was danach noch uebrig bliebe - das entscheidet, ob B-6 ueberhaupt eine eigene Phase braucht.

RANDBEDINGUNG (O-9, Owner-Handgriff, KEIN Code-Thema): der Owner hat keine private Nummer
hinterlegt, im Log steht "sms_summary_skipped reason=no_private_number". Aufgenommene
Nachrichten erreichen ihn also gar nicht. Erwaehne es, aber baue KEINE Loesung dafuer.
`,
  },
  {
    id: "B-7",
    modell: "sonnet",
    effort: "low",
    titel: "STT-Kauderwelsch",
    auftrag: `
BEFUND (vorbestehend, nicht von der letzten Kette verursacht, nie behoben): Die
Spracherkennung liefert Unsinn. Belege aus dem echten Anruf: "Hast Du das im Internet
tress passiert?", "Bis zum behindert, man." Der Agent reagiert dann auf Unsinn.
Beleg: data/evidence/db-2026-08-04/call_msczdf1aadbw.tsv, Segmente 7/9/10.

Kartiere: Welche Spracherkennung laeuft, wie ist sie konfiguriert, und wo? Sprache/Modell/
Parameter - stehen sie in src/config.js, in der Provider-Konfiguration, im Assistant-Objekt?
Gibt es ein Konfidenzmass, das ankommt und ignoriert wird?
Wichtig: outbound (Telnyx-Assistant) und inbound (Budget-Engine, TeXML-Gather + STT) sind
zwei verschiedene Maschinen mit womoeglich zwei verschiedenen Erkennern - nenne beide
getrennt. Fuer die Sprache gilt empirisch belegt "de-DE", NIE "de".
Sag ehrlich, ob das ueberhaupt von uns aus steuerbar ist oder Anbietersache.
`,
  },
  {
    id: "B-9",
    modell: "sonnet",
    effort: "low",
    titel: "Inbound und Outbound vereinheitlichen (O-1, Weg A)",
    auftrag: `
BEFUND, am Log und am Code belegt: Inbound und Outbound sind ZWEI VERSCHIEDENE MASCHINEN.
  Outbound laeuft ueber den Telnyx-Assistant/LLM-Shim (assistant_id und
  telnyx_conversation_id gesetzt, Log-Zeilen "[telnyx-shim] turn_ok").
  Inbound laeuft ueber die Budget-Engine (TeXML-Gather + STT), beide IDs NULL, keine
  einzige turn_ok-Zeile. Folge: das Token-Streaming wirkt inbound gar nicht, inbound gibt
  es weder get_consult noch look_up, und die Pausen zwischen den Turns lagen bei
  10827 / 17839 / 12671 ms - waehrend die Modell-Latenzen bei 1036-2846 ms lagen.
  Die Pausen kommen also NICHT vom Modell, sondern aus der Gather-/STT-Schicht.

DIE WURZEL IST BEKANNT: Der Inbound-Assistant-Pfad EXISTIERT (inboundAssistantHandoffXml
in src/routes/voice.js, startInboundAiAssistant in src/telnyx-inbound.js) und sein Flag ist
live an. Er feuert trotzdem nie, weil sein Waechter auf einem GERATENEN Feldnamen steht:
  const INBOUND_CALL_CONTROL_ID_FIELD = "CallControlId";
vom Autor selbst als "live unbestaetigt" markiert - mit einem STILLEN Rueckfall auf die
alte Engine. Kein Log, keine Sonde, kein Test faengt den Fall. Der Dienst meldet
"Assistant-Pfad: AKTIV" und laeuft inbound seit Wochen ueber die Budget-Engine.

OWNER-ENTSCHEIDUNG O-1 (bindend, nicht neu aufrollen): vereinheitlicht wird ueber Weg A -
den echten Feldnamen am Live-Webhook MESSEN, dann den Handoff scharf schalten.
Zusatzauflage: der stille Rueckfall verschwindet. Faellt der Handoff aus, muss das im Log
und in einer Sonde SICHTBAR sein.

DEINE AUFGABE - und der erste Punkt ist der wichtigste:
1. Wie misst man den echten Feldnamen, OHNE zu raten? Der Inbound-Webhook trifft live ein.
   Gibt es einen Ort, an dem der rohe Body schon geloggt wird, oder braucht es eine
   temporaere Sonde? Beschreibe den konkreten Handgriff. Dieses Repo hat 297 von 297
   Kostenbelegen verloren, weil jemand Feldnamen geraten hat - rate hier NICHTS.
2. Was genau muss sichtbar werden, damit ein ausbleibender Handoff nicht mehr still ist?
3. Welche Dateien beruehrt das Scharfschalten?
NICHT deine Aufgabe: die Twilio-Abstraktion (das ist O-2, eine EIGENE Phase). Merke aber
an, falls ein Capability-Waechter (providerSupports ... AI_ASSISTANT) im Weg steht.
`,
  },
  {
    id: "B-10",
    modell: "sonnet",
    effort: "low",
    titel: "Stummes Scheitern bei Modell-Ausfall",
    auftrag: `
BEFUND, live erlebt am 2026-08-04: Das Anthropic-Guthaben war leer, jeder Modell-Turn kam
mit 400 "Your credit balance is too low" zurueck. Der Owner hoerte nur die Offenlegung
(deterministischer Speak-Node, kein Modell) und danach NICHTS - inbound wie outbound.
Vier Anrufe, null Zusammenfassungen; der Outbound-Anruf lief 52 s mit SIEBEN
aufeinanderfolgenden "agentTurn fehlgeschlagen", waehrend der Owner weitersprach und
Carrier-Minuten liefen. Entdeckt wurde es nur, weil der Owner selbst anrief.

DREI EIGENSTAENDIGE DEFEKTE, alle drei gehoeren in die Kette, unabhaengig vom Guthaben:
1. Der Degradations-Satz erreicht den Anrufer nicht. Er IST verdrahtet
   (degradedSpeechFor(err, locale) im Shim-Catch, src/telnyx-llm-shim.js, trennt transient
   -> llmDegradedSpeech von 4xx -> turnErrorSpeech). Trotzdem hoerte der Owner ueber sieben
   gescheiterte Turns hinweg nichts. Ob der Satz gar nicht auf den Draht ging oder nur nicht
   gesprochen wurde, ist UNGEMESSEN. Sag, wie man das misst - zuerst messen, dann fixen.
2. Der Bezahl-Fall ist in der Telemetrie unsichtbar. Der Shim prueft
   vendorStatusOf(err) === HTTP_PAYMENT_REQUIRED (402) und loggt dann vendor_402.
   Anthropic liefert fuer leeres Guthaben aber 400 mit invalid_request_error. "Uns ist das
   Geld ausgegangen" faellt damit in den generischen Fehlerpfad.
3. Es gibt keine Alarmierung. Ein Telefon-Agent, der bei Modell-Ausfall weiterlaeuft,
   Minuten verbrennt und niemanden benachrichtigt, ist schlimmer als einer, der gar nicht
   erst abhebt.

ZIEL: bei anhaltendem Modell-Ausfall hoerbar und wuerdevoll beenden statt stumm
weiterzulaufen. Das zahlt zugleich auf O-3 (Kuerze/Minutenkosten) ein.
Kartiere alle drei Teile getrennt. Fuer Teil 3: pruefe, was an Benachrichtigungswegen
SCHON existiert (SMS-Versand? Audit-Log? Render?) - erfinde keinen neuen Kanal, wenn
einer da ist. Ein Alarm, der selbst Geld kostet oder in einer Schleife feuert, ist ein
neuer Defekt: nenne die Entprellung.
`,
  },
  {
    id: "O-10",
    modell: "sonnet",
    effort: "low",
    titel: "Diagnosemodus - diagnostic:true reparieren, Inbound mitschneiden",
    auftrag: `
ZWEI ZUSAMMENHAENGENDE OWNER-ENTSCHEIDUNGEN. Ohne sie ist jede kuenftige Anruf-Forensik
Glueckssache - deshalb laeuft diese Phase parallel zum Pruefstand, nicht danach.

O-10: Der Server IGNORIERT das Feld diagnostic. Beim Testanruf am 03.08. war es gesetzt,
in der DB steht diagnostic=false. Frisch nachgemessen am 04.08.: ALLE zehn juengsten
Anrufe stehen auf diagnostic=false, auch die, bei denen es gesetzt wurde. Das Rohtranskript
des Beleg-Anrufs ueberlebte nur, weil die Loeschung noch nicht gelaufen war.
Finde den Weg des Feldes vom Aufruf (MCP place_call / REST) bis in die Spalte call.diagnostic
und sag, wo es verloren geht - mit Datei:Zeile.

O-11: Fuer Inbound existiert HEUTE KEIN Rohtranskript - transcript_segment ist leer, nur
summary und result bleiben. Nachgemessen: call_msczw0irl06s hat 0 Segmente, die
Inbound-Anrufe vom 04.08. haben 1-2. Die Aufbewahrung wird ausdruecklich NICHT generell
hochgedreht (EVIDENCE_RETENTION_DAYS=7 bleibt) - es kommt ein Modus, der GEZIELT mitschneidet.
Kartiere: wo werden Segmente geschrieben, wo geloescht, und was unterscheidet inbound von
outbound? Warum hat inbound so wenige?

RANDBEDINGUNG: Transkripte sind personenbezogene Daten von Menschen, die nicht zugestimmt
haben. Ein Diagnosemodus, der versehentlich dauerhaft anbleibt, ist ein Datenschutz-Defekt.
Nenne im Feld "risiko", wie er sich selbst wieder abschaltet.
Die Datenschutzerklaerung selbst ist ausdruecklich ZURUECKGESTELLT - nicht anfassen.
`,
  },
  {
    id: "O-3",
    modell: "sonnet",
    effort: "low",
    titel: "Kuerze als Messgroesse",
    auftrag: `
NEUE OWNER-VORGABE, noch nirgends umgesetzt: Der Agent soll das Gespraech so kurz wie
moeglich halten. Telefonierte Minuten sind der groesste Kostenblock (Tarif 30 ct/min).

O-3 IST BINDEND UND PRAEZISE: "So kurz wie moeglich" ist eine MESSGROESSE, KEINE KAPPE.
Turns und Dauer je ERLEDIGTEM Auftrag werden gemessen und als Ziel im Prompt verankert.
KEINE harte Turn- oder Sekundengrenze - eine Kappe schneidet Gespraeche mitten durch.
Die bestehende Max-Dauer-Notbremse ist ein Safety-Gate und bleibt unberuehrt: fass sie
NICHT an, weiche sie NICHT auf.

Kartiere:
1. Was wird heute schon je Anruf erfasst (Turns, Dauer, Kosten) und wo liegt es?
   Es gibt bereits Felder wie caller_turns, estimated_cost_cents, actual_cost_micro_cents
   an der call-Tabelle - pruefe, was davon gefuellt wird.
2. Woran erkennt man "erledigt"? Es gibt objective_achieved und result - reicht das als
   Nenner, oder ist es unzuverlaessig? Ohne verlaesslichen Nenner ist die Messgroesse wertlos,
   denn ein Agent, der sofort auflegt, ist "kurz" und nutzlos. Sag das ausdruecklich.
3. Wo im Prompt wuerde das Ziel verankert - und welche Stelle darf dabei NICHT angefasst
   werden (der Offenlegungssatz ist fest verdrahtet und bleibt der allererste Satz).
`,
  },
];

phase("Kartierung");
log(`Welle 0: ${BEFUNDE.length} Kartierungs-Agenten, nur lesend, Basis=${BASIS_COMMIT}`);

const ergebnisse = await parallel(
  BEFUNDE.map((b) => () =>
    agent(
      `${REGELN}\n\nDEIN BEFUND: ${b.id} - ${b.titel}\n` +
        `Dein Bericht gehoert nach ${REPORT_DIR}/${b.id.toLowerCase()}.md\n${b.auftrag}`,
      {
        label: `karte:${b.id}`,
        phase: "Kartierung",
        model: b.modell,
        effort: b.effort,
        schema: SCHEMA,
      },
    ),
  ),
);

const gueltig = ergebnisse.filter(Boolean);
log(`${gueltig.length}/${BEFUNDE.length} Karten zurueck`);

// Ueberschneidungen der Dateimengen - daraus leitet der Lead die Parallelitaet ab,
// statt sie zu raten. Jede geteilte Datei zwingt zwei Phasen in die Reihenfolge.
const belegung = {};
for (const k of gueltig) {
  for (const datei of k.dateien || []) {
    (belegung[datei] ||= []).push(k.befund);
  }
}
const kollisionen = Object.entries(belegung)
  .filter(([, wer]) => wer.length > 1)
  .map(([datei, wer]) => ({ datei, befunde: wer }))
  .sort((a, b) => b.befunde.length - a.befunde.length);

return {
  karten: gueltig,
  fehlend: BEFUNDE.filter((b) => !gueltig.some((k) => k.befund === b.id)).map((b) => b.id),
  kollisionen,
  unbelegte_wurzeln: gueltig
    .filter((k) => k.wurzel_belegt === "hypothese-unbelegt")
    .map((k) => k.befund),
  owner_fragen: gueltig
    .filter((k) => (k.offene_frage_an_owner || "").trim().length > 0)
    .map((k) => ({ befund: k.befund, frage: k.offene_frage_an_owner })),
};
