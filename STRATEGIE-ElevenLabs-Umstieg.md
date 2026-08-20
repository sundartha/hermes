# Strategie: Umstieg auf ElevenLabs Agents

**Datum:** 12.08.2026
**Grundlage:** `Befund-Messung-2026-08-12.md`, `Umstieg-ElevenLabs-Plan.md`, eigene Messungen
am Live-System und an der Produktionsdatenbank, Code-Bestandsaufnahme, ElevenLabs-Doku
(abgerufen 12.08.2026), Datenschutz-Recherche.

> **Zu Fachbegriffen:** Jeder wird beim ersten Auftauchen in einem Halbsatz erklärt. Wo
> etwas ungeklärt blieb, steht das Wort **ungeklärt** — nicht eine Vermutung, die wie ein
> Ergebnis aussieht.

---

## 1. Entscheidung in fünf Zeilen

1. **Wir stellen jetzt nicht um.** Wir kaufen für einen Nachmittag einen ElevenLabs-Zugang
   (22 US-Dollar) und **Antonio baut den Agenten von Hand nach** und telefoniert damit.
2. **Vorher** läuft ein Testset aus 8 Szenarien gegen den heutigen Stand, damit „besser"
   eine Zahl ist und kein Gefühl.
3. **Kosten bis zur Entscheidung:** rund 30 US-Dollar und 2 Arbeitstage. Kosten der vollen
   Umstellung, falls sie danach beschlossen wird: 5–7 Arbeitstage.
4. **Woran man merkt, ob es funktioniert hat:** nach Phase 1 (ein Nachmittag) weiß Antonio,
   ob es hörbar besser ist. Nach Phase 2 (ein Tag) wissen wir, ob das Herzstück des Produkts
   — die Rückfrage mitten im Gespräch — bei ElevenLabs überhaupt trägt. Erst dann wird Geld
   und Zeit in die Umstellung gesteckt.
5. **Der wichtigste Fund dieser Prüfung:** Drei der fünf Befunde, die den Umstieg begründen
   sollten, halten der Messung nicht stand. **Der Umstieg kann trotzdem richtig sein — aber
   aus einem anderen Grund als angenommen.** Der echte Grund steht in Abschnitt 2.6.

---

## 2. Ausgangslage — was im Code und am Live-System gefunden wurde

### 2.1 Der Abbruch nach 110 Sekunden: die Messung war eine andere Größe

Das ist der Befund, der den ganzen Plan trägt — und er hält nicht.

Ich habe die Anrufe in der Produktionsdatenbank nachgemessen. Dabei zeigt sich: Das
Werkzeug `get_call_status` liefert die Dauer **ab dem Moment des Wählens**, nicht ab dem
Moment des Abhebens (`src/mcp-tools.js:129-135`). Die frühere Untersuchung im Projekt maß
dagegen **ab Abheben**. Das sind zwei verschiedene Größen unter demselben Namen.

Rechnet man die Klingelzeit heraus, verschwindet die angebliche Streuung vollständig:

| Anruf | Dauer laut Client (Wählen → Ende) | Klingelzeit | **Abheben → Ende** |
|---|---|---|---|
| Zähltest 12.08. | 109 s | 18 s | **91 s** |
| Zähltest 11.08. | 107 s | 16 s | **91 s** |
| Werkstatt 11.08. | 105 s | 14 s | **91 s** |
| Zähltest 10.08. | 91 s | 5 s | 86 s |
| Werkstatt 12.08. (Erfolg) | 70 s | 4 s | 66 s |
| Funktionstest 11.08. | 80 s | 10 s | 70 s |

**Dreimal exakt 91 Sekunden, Streuung null.** Die im Befund beschriebene „Decke von 91 bis
109 Sekunden" ist keine Decke mit Streuung, sondern **eine harte Grenze von 91 Sekunden
plus unterschiedlich lange Klingelzeit**.

Über die gesamte Anrufhistorie dieses Mandanten (70 Anrufe, davon 61 mit Abheben) liegt bei
91 Sekunden ein deutlicher Berg:

```
190 s: 1 Anruf        98 s: 1
180 s: 1              94 s: 1
177 s: 1              92 s: 1
164 s: 2          →   91 s: 14 Anrufe  ←
114 s: 1              90 s: 1
                      89 s: 2
```

**Zwei Schlussfolgerungen, beide gegen den Befund:**

- **„Kein einziger Anruf überschreitet jemals ~110 Sekunden" ist falsch.** Sechs Anrufe
  haben es getan, der längste lief **190 Sekunden** ab Abheben. Eine im Code berechnete
  Obergrenze wäre absolut — die hier ist es nicht.
- **Die vermutete Formel ist widerlegt.** Die Stelle, die aus dem Guthaben eine Höchstdauer
  macht, steht in `src/call-duration.js:77-84`. Sie liefert konstruktionsbedingt **nur
  Vielfache von 60 Sekunden oder 1800 Sekunden**. 91 ist keines von beidem. Mit den
  Standardwerten (Guthaben 1500 Cent, Tarif 30 Cent/Minute) ergibt sie **1800 Sekunden**,
  und `max_duration_s: 600` würde daraus 600 Sekunden machen — genau das, was angefordert
  war. Zusätzlich schreibt dieser Pfad beim Auslösen zwingend einen Fehlergrund
  (`max-duration-cap`, `src/telephony/call-lifecycle.js:96-97`); die gemessenen Anrufe haben
  keinen.

**Was stattdessen belegt ist:** Die frühere Untersuchung (`tasks/91s-kappung-befunde-2026-08-10.md`)
hat bei Telnyx die technischen Abbruchgründe abgefragt. Ergebnis: `hangup_details=recv_bye`
— das Auflegen-Signal kam **von außen**, nicht von uns. Telnyx' eigene Lesart: ein nicht
aufgefrischter Sitzungs-Zeitgeber beim deutschen Ziel-Netz (technisch: RFC 4028
`Session-Expires`, üblicherweise 90 Sekunden). Der Fall liegt beim Netzbetrieb von Telnyx.

> **Widerspruch, den ich nicht auflöse:** Der Befund sagt „Unser eigener Server legt auf",
> das Projekt sagt seit dem 10.08. „der Ziel-Carrier legt auf, bei uns nicht behebbar".
> **Die Messung stützt die zweite Aussage.** Sie beweist sie nicht vollständig — dass sechs
> Anrufe 114 bis 190 Sekunden liefen, passt zu „scheitert manchmal", nicht zu „scheitert
> immer". Der billigste offene Test steht seit dem 10.08. unerledigt in `tasks/todo.md`:
> **ein Anruf auf eine andere deutsche Nummer** (anderes Netz oder Festnetz). Kappt der
> auch bei 91 Sekunden, ist es nicht netzspezifisch. Läuft er durch, ist eine deutsche
> Absendernummer die Abhilfe. Aufwand: ein Anruf.

**Zur „Stimme versiegt 20 Sekunden vor dem Leitungsende":** Es gibt einen Wert, der exakt
20 Sekunden groß ist — `CAP_FAREWELL_LEAD_MS = 20000` (`src/config.js:1450-1454`). Er sorgt
dafür, dass der Agent einen Abschiedssatz spricht, wenn die Restzeit unter 20 Sekunden
fällt. **Aber dieser Pfad ist nur in der einen von zwei Gesprächs-Bauarten aktiv**, und
welche am 12.08. lief, ist aus dem Repo nicht entscheidbar (siehe 2.5). Ich habe **keinen
Code gefunden, der 91 Sekunden erzeugt**, und keinen belegten Zusammenhang zwischen
Stimm-Ende und Leitungsabbruch. Das bleibt **ungeklärt**.

### 2.2 Der Anruf ohne Gespräch, der als Erfolg gilt — schlimmer als beschrieben

**Belegt, und zwar systematisch.** In der Datenbank:

| Anrufe dieses Mandanten gesamt | 70 |
|---|---|
| davon **nie abgehoben** (`answered_at` leer) | 9 |
| davon trotzdem als **`completed`** verbucht | **8** |

Das ist kein Einzelfall vom 12.08., sondern **jeder achte Anruf**. Am 12.08. traf es zwei
Anrufe direkt hintereinander (54 s und 55 s reine Klingelzeit, Protokoll leer,
Fehlergrund leer).

**Die Ursache steht im Code, eindeutig.** Ein Anruf wird bei der Erstellung sofort mit
`status: "active"` angelegt (`src/store/state-ops.js:221`) — „klingelt gerade" ist nur eine
Anzeige-Ableitung an der Oberfläche (`src/mcp-tools.js:123-127`), kein echter Zustand. Trifft
später das Auflege-Ereignis ein, setzt `src/telnyx-call-control-ingest.js:256-271` den Status
**bedingungslos** auf `completed`:

```js
persistEnd: () => {
  if (call.status === "active") store.endCallRecord(call.id, "completed");
}
```

Ob je jemand abgehoben hat (`answeredAt`), wird **nie geprüft**. Der technische Grund des
Auflegens (`hangup_cause`, `sip_hangup_cause`) kommt vom Anbieter mit, wird aber nur in eine
Logzeile geschrieben und **nirgends gespeichert** (`src/telnyx-call-control-ingest.js:48-68`).
Die Anrufbeantworter-Erkennung existiert (`src/telephony/answered-by.js`), ist aber
abgeschaltet (`MACHINE_DETECTION_ENABLED=false`, `render.yaml:546-547`).

**Bewertung:** Das ist der einzige Befund der Liste, der ohne jede Diskussion ein echter,
schwerer Defekt in unserem Code ist — und er hat mit dem Umstieg **nichts zu tun**. Er
bleibt nach einem Umstieg genauso bestehen, wenn er nicht separat behoben wird. Aufwand:
etwa ein Tag.

### 2.3 Die Web-Recherche existiert — sie ist ausgeschaltet

**Der Befund „Es gibt sie gar nicht" ist falsch.**

Es gibt ein vollständiges Recherche-Modul: `src/research/` mit 334 Zeilen plus Adapter, mit
fertiger Anbindung an **Exa** (ein Such-Dienst für KI-Anwendungen), mit Kostenbuchung pro
Suche, mit einem Schutzfilter und einer Bereinigung der Trefferdaten.

Es ist hinter **vier** Bedingungen gesperrt, die alle gleichzeitig erfüllt sein müssen:
`LOOKUP_ENABLED`, `ASSISTANT_CONTEXT_ENABLED`, das Mandanten-Recht `allowLookup` und ein
gesetzter `EXA_API_KEY`. Der Standardwert ist **aus**.

**Und der Grund dafür steht wörtlich daneben** (`.env.example:355-358`):

> „Auftragsverarbeiter (Exa) – das gehoert VOR dem Anschalten in die
> Datenschutzerklaerung."

**Das ist der eigentliche Befund:** Die häufigste Frage am Telefon ist nicht deshalb
unbeantwortbar, weil Code fehlt, sondern weil **eine Datenschutz-Entscheidung offen ist**.
Ein Anbieterwechsel löst das nicht — ElevenLabs' „fertige Exa-Anbindung" läuft in exakt
dieselbe Wand, nur mit einem zusätzlichen Auftragsverarbeiter davor.

Dass der Agent im Gespräch sagt, er könne nicht recherchieren, ist also korrekt und
ehrlich. Dass er **manchmal trotzdem Wetterdaten erfindet**, bleibt ein echter Defekt — aber
ein Modell-Defekt, kein fehlendes Werkzeug.

### 2.4 Was beim Umstieg stirbt, bleibt und angepasst werden muss

Alle Zahlen aus `wc -l`. Gesamt: `src/` = 39.634 Zeilen, `test/` = 100.343 Zeilen in 548
Dateien mit rund 4.030 Testfällen.

**STIRBT — rund 2.940 Zeilen**, die es nur gibt, weil wir die Gesprächsführung selbst machen:

| Datei | Zeilen | Wozu |
|---|---|---|
| `src/telnyx-llm-shim.js` | 1100 | Übersetzer zwischen Telnyx' Turn-Modell und unserem Gehirn |
| `src/bridge.js` | 416 | Audio-Brücke zu OpenAI (live nicht in Betrieb) |
| `src/telnyx-conversation-watchdog.js` | 362 | Wachhunde gegen Anbieter-Eigenheiten |
| `src/telnyx-call-control-ingest.js` | 339 | Ereignis-Zustandsmaschine des Anbieters |
| `src/turn-budget.js` | 120 | rechnet gegen eine 15-Sekunden-Frist |
| `src/speech-chunker.js` + `src/speech-shape.js` | 165 | satzweises Ausspielen |
| `src/telnyx-turn-*.js`, `src/telnyx-speech-gate.js` u. a. | ~440 | Riegel gegen Doppelantworten, Kappungen, Stille |

**BLEIBT unverändert — rund 27.000 Zeilen**, also der teure Teil des Produkts: Abrechnung
(3.539), Datenhaltung und Mandantentrennung (8.233), Anmeldung (1.039), Selbstbedienung und
Onboarding (858), Warteschlange (413), Dashboard (11.576), Sprachen (1.876), Tarife,
Prüfprotokoll.

**MUSS ANGEPASST WERDEN — der eigentliche Aufwand:** `src/claude.js` (1469, Prompts und
Werkzeug-Schleife wandern in den Agent, die Zusammenfassung bleibt), `src/telephony/` (4415,
die Sicherheits-Gates bleiben fachlich, aber Anrufauslösung, Beendigung und Ereignisse
müssen auf ElevenLabs neu), `src/routes/voice.js` (579), `src/routes/api-calls.js` (394),
`src/mcp-tools.js` (1003, der Vertrag nach außen bleibt), `src/consult/` und
`src/research/` (815, müssen an ElevenLabs' Werkzeug-Modell).

**Tests:** Schätzung — 142 der 548 Testdateien tragen ein Orchestrierungs-Muster im Namen
und enthalten **1.287 von rund 4.030 Testfällen, also etwa 32 %**. Die Zahl ist eine
Namensheuristik, keine Inhaltsanalyse; sie überschätzt und unterschätzt zugleich. Die
Größenordnung „ein knappes Drittel der Tests hängt an der Gesprächsführung" halte ich für
belastbar, die genaue Zahl nicht.

### 2.5 Ein Widerspruch, den ich nicht auflösen kann: welche Bauart läuft eigentlich?

Es gibt zwei Gesprächs-Bauarten im System. `render.yaml:102` und `:552` sagen, die eine sei
aus. Die frühere Untersuchung belegt aber, dass **alle 51 untersuchten Anrufe** über die
andere liefen. Die Evaluation vom 11.08. führt diesen Punkt seit einem Tag ausdrücklich als
**ungeklärt**.

**Warum das hier zählt:** Davon hängt ab, ob der 20-Sekunden-Wert aus 2.1 überhaupt greifen
kann, und davon hängt die halbe Kostenrechnung ab. Das ist eine Prüfung von Minuten, die
seit dem 11.08. offen ist. Sie gehört in Phase 0.

### 2.6 Warum ElevenLabs damals verlassen wurde — die Antwort lautet: es geschah nie

Ich habe die gesamte Git-Historie durchsucht (1.908 Commits, alle Zweige).

- **Der allererste Commit** des Projekts (`e413cfe`, 12.06.2026) heißt
  *„Telefon-KI mit MCP (Twilio + Claude)"* und enthält bereits die selbstgebaute
  Orchestrierung.
- **ElevenLabs taucht erstmals am 02.07.2026 auf** (`2b204f2`) — und zwar ausschließlich als
  Stimme (Text-zu-Sprache), nicht als Gesprächsführung.
- Die Suche nach `convai`, `agent_id`, `conversational ai` über die gesamte Historie:
  **null Treffer.**

**Es gab in diesem Repository nie einen Prototyp auf ElevenLabs Conversational AI.**

Die einzige dokumentierte Entscheidung dazu steht in einem archivierten Plan
(`PLAN-TELNYX-AI-ASSISTANT.md`, Commit `62e929d`), wörtlich:

> „**Fallback-Weg bei P0-rot:** Schwenk auf C-ElevenLabs (ElevenLabs Conversational AI). Der
> Brain-Shim P1-P3 ist bei beiden Wegen identisch, nicht verloren."

**ElevenLabs war die bewusst offengehaltene Alternative. Sie wurde nie gezogen, weil der
Telnyx-Weg im Vorab-Test nicht rot lief. Eine Begründung „ElevenLabs kann X nicht" existiert
in der gesamten Historie nicht.**

> **Das ist eine gute Nachricht mit einem Haken.** Gut: Es gibt keinen vergessenen
> technischen Grund, in den wir zurücklaufen würden. Der Haken: Wenn es einen Prototyp gab,
> dann **außerhalb dieses Codes** — vermutlich ein im ElevenLabs-Dashboard von Hand
> zusammengeklickter Agent. Der hatte keine Sicherheits-Gates, keine Abrechnung, keine
> Mandantentrennung, keine Offenlegungspflicht und keinen Rückfrage-Kanal. **Die Erinnerung
> „damals lief es gut" vergleicht deshalb nicht zwei Produkte, sondern ein Spielzeug mit
> einem Produkt.** Das entwertet die Erinnerung nicht — Phase 1 baut genau diesen Vergleich
> bewusst nach. Es heißt nur: Die Messlatte aus Phase 1 ist „klingt es besser", nicht „ist
> es fertiger".

### 2.7 Der echte Grund, der für einen Anbieterwechsel spricht

Er steht in keinem der beiden Ausgangsdokumente.

**Rund 40 % aller Agenten-Äußerungen kommen beim Menschen abgeschnitten an** — gemessen über
30 Anrufe, 63 von 158 Turns, belegt seit mindestens dem 31.07.
(`tasks/PLAN-KAPPUNG.md:30-32`). In einem einzelnen Anruf waren es 5 von 7. Das ist der
Defekt, der das Erlebnis „ich kann mit dem Ding nicht reden" erzeugt.

Und die Wurzel ist **unbekannt**. Wörtlich aus demselben Dokument: *„Die Wurzel: UNBELEGT."*
Ein Arbeitslauf mit 26 Agenten hat 20 Hypothesen geprüft und 13 verworfen, ohne die Ursache
zu finden. Sie sitzt in einer Schicht, die **weder wir noch der Telnyx-Support einsehen
können** — nur deren Netzbetrieb.

**Das ist das stärkste Argument für den Wechsel, und es ist ein anderes als das im Plan:**
Nicht „ElevenLabs hat mehr Funktionen", sondern **„wir sitzen in einer Blackbox fest, und
ein Anbieterwechsel ist der einzige Weg, in Tagen statt Monaten herauszufinden, ob die
Blackbox das Problem ist."**

---

## 3. Was verifiziert wurde und was ungeklärt blieb

### 3.1 Rückfrage-Werkzeuge und die 300 Sekunden

**BELEGT:**
- Das Feld heißt `response_timeout_secs` und existiert. Bereich für Webhook-Werkzeuge
  (unser Server wird angerufen): **5 bis 300 Sekunden, Standardwert 20**.
- **Abweichung:** Über MCP angebundene Werkzeuge haben einen **anderen** Bereich — 5 bis
  **120** Sekunden, Standard 30. Die im Plan genannten „1 bis 300" stimmen also weder oben
  noch unten vollständig.
- Der Widerspruch ist bestätigt: Die erzählende Doku-Seite erwähnt Timeouts **nirgends**;
  nur die API-Referenz nennt Zahlen.
- Das Gespräch selbst hat `max_duration_seconds` mit **Standardwert 600**. Ein
  300-Sekunden-Werkzeug verbraucht also die Hälfte des Standard-Gesprächsbudgets.
- Die vier genannten Einstellungen existieren alle: `pre_tool_speech` (`auto`/`force`/`off`),
  `interruption_mode` (`allow`/`disable_during_tool`/`disable_during_tool_and_turn`),
  `tool_call_sound` (`typing`, `elevator1`–`4`). `disable_interruptions` existiert auch, ist
  aber **veraltet** und nicht mehr zu verwenden.
- **Im Plan fehlt die vermutlich wichtigste Einstellung:** `execution_mode: async` —
  wörtlich *„runs the tool entirely in the background without pausing the conversation"*.
  Ein Werkzeug, das im Hintergrund läuft, während das Gespräch weiterläuft. Für den
  Rückfrage-Kanal ist das wahrscheinlich die bessere Bauform als 300 Sekunden Warten.

**UNGEKLÄRT — und das ist die riskanteste Lücke des ganzen Plans:**
- `turn_timeout` hat den **Standardwert 7 Sekunden** und bedeutet „maximale Wartezeit auf
  die Antwort des Nutzers, bevor der Agent ihn erneut anspricht". **Ob dieser Zeitgeber
  während eines laufenden Werkzeug-Aufrufs feuert, sagt die Doku an keiner Stelle.** Dass es
  einen eigenen Wert `disable_during_tool_and_turn` gibt, legt nahe, dass es ein Thema ist.
  Ein Werkzeug mit 300 Sekunden Wartezeit nützt nichts, wenn der Agent nach 7 Sekunden
  wieder zu reden anfängt.
- Für `max_duration_seconds` ist **kein Maximum** dokumentiert.
- Die Telefonie-Ebene: Die SIP-Referenz enthält **keine** Angaben zu Anrufdauer-Grenzen oder
  Sitzungs-Zeitgebern. Das ist ein dokumentiertes Nichts, kein belegtes „unbegrenzt".

**Zum Vergleich, unser heutiger Stand:** Der Rückfrage-Kanal hält heute **47 Sekunden**
offen (`CONSULT_OPEN_MS=47000`) und wartet 4 Sekunden im laufenden Turn
(`CONSULT_WAIT_MS=4000`). Die realistische Frage ist also nicht „47 gegen 300", sondern
**„funktionieren bei ElevenLabs überhaupt 30 bis 60 Sekunden?"** — und die ist heute
unbeantwortet.

### 3.2 Der Endpunkt für ausgehende Anrufe

**BELEGT:** `POST /v1/convai/sip-trunk/outbound-call` existiert exakt so. Pflichtfelder:
`agent_id`, `agent_phone_number_id`, `to_number`. Der Auftrag pro Anruf geht über
`dynamic_variables` (Platzhalter im Prompt füllen) — genau wie im Plan empfohlen.

**BELEGT, und der Plan hat recht mit der Warnung:** Der Alternativweg
`conversation_config_override` ist aus Sicherheitsgründen standardmäßig gesperrt, und
wörtlich: *„Tool and knowledge base overrides replace the default arrays for that
conversation"* — er **ersetzt** die Werkzeugliste, statt sie zu ergänzen. Der Plan warnt zu
Recht davor.

**BELEGT, im Plan nicht erwähnt:** Überschreitet man die Zahl gleichzeitiger Anrufe, kosten
weitere Anrufe **das Doppelte** (0,16 statt 0,08 US-Dollar je Minute), werden nachrangig
verarbeitet und ab dem Dreifachen ganz abgewiesen.

**UNGEKLÄRT:** Ob `max_duration_seconds` pro Anruf überschreibbar ist — API-Referenz und
Anleitung widersprechen sich.

### 3.3 Die Telnyx-Anbindung

**BELEGT:** Eine offizielle Anleitung existiert. Die Schritte im Plan stimmen: SIP-Verbindung
vom Typ FQDN (ein SIP-Trunk ist eine Telefonleitung über Internet statt über Kupferkabel;
FQDN heißt, die Gegenstelle wird über einen Namen statt über eine IP-Adresse angesprochen),
Zugangsdaten für ausgehende Anrufe, `sip.rtc.elevenlabs.io`, Rufnummernformat `+E.164`,
Transportprotokoll **TCP**. Ein- **und** ausgehende Anrufe laufen über dieselbe Verbindung.

**BELEGT:** Erlaubte Sprachcodecs (Verfahren zur Audio-Komprimierung) sind **G711 oder
G722** — sonst nichts. Verschlüsselung der Sprachdaten ist möglich und wird empfohlen.

**UNGEKLÄRT, und für uns direkt relevant:**
- **Zur US-Nummer nach Deutschland steht in der gesamten ElevenLabs-Doku nichts.** Keine
  Länder-Einschränkung, keine Routing-Aussage — weder erlaubend noch verbietend. Die Frage
  ist über ElevenLabs' Doku **prinzipiell nicht beantwortbar**; sie hängt am Telnyx-Profil
  für ausgehende Anrufe, also an genau der Stelle, an der schon heute der Verdacht liegt.
- Die Doku unterscheidet nicht zwischen den beiden G711-Varianten. Deutschland nutzt die
  eine, die USA die andere. Ob die deutsche unterstützt wird: nicht dokumentiert.
- IP-Freischaltung als Alternative zur Passwort-Anmeldung ist aus der Doku heraus **nicht
  umsetzbar** — es ist kein IP-Bereich veröffentlicht.

### 3.4 Die Preise

**BELEGT — die Zahlen im Plan stimmen alle**, mit zwei Ergänzungen:

| Plan | USD/Monat | Minuten | Zusatzminute | Gleichzeitig |
|---|---|---|---|---|
| Free | 0 | 15 | 0,08 | 4 |
| **Starter** | **6** | **75** | 0,08 | 6 |
| Creator | 22 (1. Monat 11) | 275 | 0,08 | 10 |
| Pro | 99 | 1.238 | 0,08 | 20 |
| Scale | 299 | 3.738 | 0,08 | 30 |
| Business | 990 | 12.375 | 0,08 | 40 |

Der **Starter-Plan für 6 US-Dollar** fehlt im Plan — für den Test reicht er möglicherweise.

**BELEGT, wörtlich:** *„The LLM model and any telephony are billed separately on top, based
on usage."* Also: Denken und Telefonleitung kommen **obendrauf**. Der Plan sagt das richtig.
Stille wird nur mit 5 % berechnet. Eigenes Sprachmodell mitbringen ist möglich.

**BELEGT — Preisänderungen:** Für eine Firma im EU-Raum gilt die EU-Fassung der
Geschäftsbedingungen: **mindestens 30 Tage Vorankündigung**. (In der Nicht-EU-Fassung
könnte ElevenLabs jederzeit ändern — für uns gilt die bessere Variante.)

**BELEGT — Startup-Zuschuss existiert:** 12 Monate, rund 680 Stunden Agents-Nutzung, Wert
über 4.000 US-Dollar. Bedingung u. a.: weniger als 25 Mitarbeiter, keine Agentur, ein
Antrag je Firma, das Zuschuss-Logo muss 12 Monate gezeigt werden. **Bewerben kostet nichts.**

**UNGEKLÄRT:** Ob unterschiedliche Stimm-Modelle unterschiedlich viel kosten. Was ein
Enterprise-Vertrag kostet (durchgehend „Custom", nur über den Vertrieb).

### 3.5 Datenschutz — der Teil, an den niemand gedacht hat

Das gehört auf Seite eins, deshalb steht es hier vollständig.

**Die gute Nachricht zuerst — die größte Befürchtung war falsch.** Der Plan vermutete, dass
EU-Datenresidenz (Speicherung der Daten in Europa) die guten Modelle ausschließt. Wörtlich
aus der Doku:

> „With EU data residency enabled, a small number of older Gemini and Claude LLMs are not
> available in ElevenLabs Agents."

Betroffen sind **nur einige ältere** Modelle. GPT-5.x, Gemini 3.5, Claude Opus 4.7 und
Sonnet 4.6 bleiben verfügbar. Kein Beleg, dass Sprachausgabe, Spracherkennung, Wissensbasis
oder Websuche wegfallen. Einzige belegte Streichung: Synchronisation von Videos, die wir
nicht brauchen.

**Die schlechte Nachricht — der Preis dafür:**

1. **EU-Datenresidenz ist ausschließlich Enterprise.** Wörtlich: *„Data residency is an
   exclusive feature available to ElevenLabs' Enterprise customers."* Enterprise heißt
   „Preis auf Anfrage", die Stufe darunter (Business) kostet 990 US-Dollar im Monat.
2. **Und selbst EU-Residenz reicht nicht.** Wörtlich: *„While storage will take place in the
   selected location, processing may nevertheless occur outside of the selected location."*
   Speicherung in der EU, Verarbeitung darf raus — und als Beispiel für
   Auslands-Verarbeitung nennt die Doku ausdrücklich **Post-Call-Webhooks**, also genau den
   Weg, über den wir an die Transkripte kämen. Nur zusammen mit dem Zero-Retention-Modus
   bleibt alles in der EU.
3. **Zero-Retention ist ebenfalls Enterprise** — und schaltet Funktionen ab, die wir wollen:
   *„Summaries are unavailable"*, *„MCP support is not currently available"*.
4. **Standardeinstellungen, die für ein deutsches Produkt falsch stehen:** Aufbewahrung von
   Transkripten und Audio **2 Jahre**, Audio-Mitschnitt **an**, Nutzung der Daten zum
   Modelltraining **erlaubt** (Widerspruch möglich, wirkt aber nur für die Zukunft). Alle
   drei sind ohne Enterprise per Einstellung änderbar — Aufbewahrung lässt sich auf 0 Tage
   setzen. **Billig zu beheben, aber man muss es tun.**
5. **Vertragspartner ist Eleven Labs Inc., New York**, auch in der EU-Fassung der
   Bedingungen. Ein Auftragsverarbeitungsvertrag ist öffentlich verfügbar
   (`elevenlabs.io/dpa`) und gilt automatisch mit den Nutzungsbedingungen; er enthält die
   EU-Standardvertragsklauseln in beiden für uns relevanten Varianten. Das ist sauber
   gemacht.

**Der schwerste Befund betrifft aber gar nicht ElevenLabs.**

Die Datenschutzkonferenz der deutschen Aufsichtsbehörden hat 2018 wörtlich festgehalten:

> „Die Aufzeichnung von Telefongesprächen ist datenschutzrechtlich in aller Regel nur mit
> Einwilligung auch des externen Gesprächspartners zulässig. … **Die bloße Einräumung einer
> Widerspruchsmöglichkeit und das anschließende Fortsetzen des Telefonats stellen keine
> datenschutzrechtlich wirksame Einwilligung dar.**"

Verlangt wird ein aktives „Ja" oder ein Tastendruck, **vor** Beginn der Aufzeichnung,
nachweisbar protokolliert. Der Sächsische Datenschutzbeauftragte schließt zusätzlich aus,
dass man sich auf ein „berechtigtes Interesse" stützen kann.

**Hermes speichert heute wortgetreue Transkripte.** Das heißt: Diese Anforderung ist **heute
schon nicht erfüllt**, mit dem Eigenbau genauso wie mit ElevenLabs. Es ist kein
Umstiegs-Thema, sondern ein offener Produktbefund.

Es gibt einen dokumentierten Ausweg (Bayerisches Landesamt, 2025): Live-Transkription **ohne
dauerhafte Speicherung**, nur eine anonymisierte Zusammenfassung — das ließe sich auf
„berechtigtes Interesse" stützen. **Das ist eine Produktentscheidung, keine
Anbieterentscheidung.**

**Und ein Datum, das ab sofort gilt:** Der EU AI Act, Artikel 50, verlangt, dass Menschen
informiert werden, wenn sie mit einer KI sprechen — **seit dem 02.08.2026**, also seit zehn
Tagen. Er wurde durch die jüngste Änderungsverordnung **nicht** verschoben (verschoben wurden
nur die Hochrisiko-Fristen). Bußgeld bis 15 Millionen Euro oder 3 % des Jahresumsatzes; für
kleine Unternehmen gilt der niedrigere Wert. **Diese Pflicht erfüllt Hermes bereits** über
den fest verdrahteten Offenlegungssatz — und bei ElevenLabs bliebe sie erfüllbar, weil die
erste Nachricht des Agenten fest vorgegeben werden kann.

**UNGEKLÄRT und anwaltlich zu prüfen:** Ob die flüchtige Audio-Zwischenspeicherung im
Spracherkennungs-Pfad bereits eine „Aufnahme auf einen Tonträger" im Sinne von § 201 StGB
ist (dazu existiert **keine** Behörden- oder Gerichtsquelle). Ob die
Wettbewerbsrecht-Generalklausel greift. Die konkrete Liste der Unterauftragsverarbeiter von
ElevenLabs und die amtliche Bestätigung der US-Zertifizierung waren **technisch nicht
abrufbar** (beide Seiten laden ohne JavaScript nicht) — das sind zusammen etwa 10 Minuten im
Browser und blockieren die Datenschutz-Dokumentation.

### 3.6 Zusammenfassung: belegt gegen offen

| Frage | Stand |
|---|---|
| 91-Sekunden-Grenze kommt aus unserer Guthaben-Formel | **widerlegt** |
| 91 Sekunden ab Abheben, dreimal exakt | **belegt** (Datenbank) |
| Sechs Anrufe liefen 114–190 s | **belegt** (Datenbank) |
| Anruf ohne Abheben wird `completed` | **belegt**, 8 von 70 |
| Web-Recherche existiert, ist ausgeschaltet | **belegt** (`src/research/`) |
| Nie ein ElevenLabs-Prototyp im Code | **belegt** (1.908 Commits) |
| Kein technischer Grund gegen ElevenLabs dokumentiert | **belegt** |
| 40 % gekappte Agenten-Turns, Wurzel unbekannt | **belegt** (30 Anrufe) |
| `response_timeout_secs` 5–300 bei Webhook-Werkzeugen | **belegt** |
| `execution_mode: async` existiert | **belegt** |
| Feuert `turn_timeout` (7 s) während eines Werkzeugs? | **ungeklärt — kritisch** |
| Telefonie-Ebene mit eigener Zeitgrenze? | **ungeklärt** |
| US-Nummer → Deutschland bei ElevenLabs | **ungeklärt** |
| Deutsche G711-Variante unterstützt? | **ungeklärt** |
| EU-Residenz nur Enterprise | **belegt** |
| Enterprise-Preis | **ungeklärt** |
| Welche Gesprächs-Bauart läuft heute live | **ungeklärt** — Prüfung von Minuten |
| Was ein Enterprise-Vertrag für uns kostet | **ungeklärt** |

---

## 4. Premortem — es ist November 2026, die Umstellung ist gescheitert

Sortiert nach Wahrscheinlichkeit mal Schaden. Der wahrscheinlichste Grund steht oben.

### P1 — Es wurde wieder ohne Messung gearbeitet

Drei Monate vergangen, das Gefühl ist unverändert schlecht, und niemand kann sagen, ob
irgendetwas besser wurde. **Das ist der wahrscheinlichste Grund von allen**, und er ist am
eigenen Haus belegt: Die Gesprächsqualitäts-Kette lief acht Tage über fünf Phasen mit **null
bestätigten Qualitätsgewinnen**. Ein Arbeitslauf verbrannte 753.000 Token in einem Pfad, der
nie betreten wurde.

| | |
|---|---|
| **Frühwarnzeichen** | Nach einer Änderung wird telefoniert und diskutiert, statt eine Zahl abzulesen. Es gibt keine Tabelle mit Datum, Modellname und Punktzahl. |
| **Gegenmaßnahme** | Phase 0 vor allem anderen. Keine Phase gilt als fertig, bevor ihre Zahl in der Tabelle steht. Wer eine Änderung ohne Vorher-Zahl vorschlägt, bekommt ein Nein. |
| **Phase** | 0 |

### P2 — Der Umstieg löste das Problem nicht, weil die Diagnose falsch war

Umgestellt, migriert, und der Agent ist genauso unzuverlässig. **Drei von fünf Befunden, die
den Umstieg begründeten, halten der Messung heute schon nicht stand** (Abschnitt 2). Wenn
man auf einer falschen Diagnose eine Woche Umbau aufbaut, ist die Woche weg.

| | |
|---|---|
| **Frühwarnzeichen** | In Phase 1 ist der handgebaute ElevenLabs-Agent **nicht** deutlich besser als der heutige Stand. |
| **Gegenmaßnahme** | Phase 1 ist ein Nachmittag ohne eine Zeile Code und hat ein hartes Abbruchkriterium. Fällt sie durch, endet der Umstieg dort. |
| **Phase** | 1 |

### P3 — Der Rückfrage-Kanal überlebt die Migration nicht

Das ist das eigentliche Produkt — dass der Telefon-Agent den auftraggebenden KI-Agenten
mitten im Gespräch fragen kann. Bei ElevenLabs hängt das an einem Zeitgeber, dessen
Verhalten während eines Werkzeug-Aufrufs **nirgends dokumentiert ist** (`turn_timeout`,
Standard 7 Sekunden). Ist er hart, ist die Migration sinnlos: Man hätte das
Alleinstellungsmerkmal gegen bessere Gesprächsführung getauscht.

| | |
|---|---|
| **Frühwarnzeichen** | Im Labortest fängt der Agent nach wenigen Sekunden wieder an zu reden, statt auf das Werkzeug zu warten. |
| **Gegenmaßnahme** | Eigene Phase, **vor** jeder Integration. Getestet werden 30 / 45 / 60 Sekunden mit einem echten Anruf, und zwar beide Bauarten: Warten (`response_timeout_secs`) und Hintergrund (`execution_mode: async`). |
| **Phase** | 2 |

### P4 — Die Marge kippt

Heute gemessene Ist-Kosten: **8,18 Cent je Minute**. Der Business-Tarif bringt nach
Zahlungsgebühren **7,65 Cent je Minute** — er ist **heute schon defizitär**. ElevenLabs
Agents liegen bei geschätzt 8–12 Cent je Minute, **plus** Telefonleitung, **plus** Denken.
Wenn der Umstieg gelingt und das Produkt teurer wird, verkauft man jede Minute mit Verlust.

| | |
|---|---|
| **Frühwarnzeichen** | Nach den ersten echten Anrufen liegt die Rechnung je Minute über 10 Cent. |
| **Gegenmaßnahme** | In Phase 4 werden die Kosten aus drei echten Anrufen **an der Rechnung** abgelesen, nicht geschätzt, und gegen beide Tarife gehalten. Der Business-Tarif wird vor dem Start neu gerechnet (Anhang, Frage 8). |
| **Phase** | 4 |

### P5 — Der Datenschutz zwingt in einen Enterprise-Vertrag

EU-Datenresidenz und Zero-Retention sind bei ElevenLabs **ausschließlich** Enterprise. Die
Stufe darunter kostet 990 US-Dollar im Monat, Enterprise ist „Preis auf Anfrage". Wenn der
erste zahlende Kunde einen Auftragsverarbeitungsvertrag mit EU-Verarbeitung verlangt, steht
man vor einer Rechnung, die es beim Eigenbau nicht gab.

| | |
|---|---|
| **Frühwarnzeichen** | Der erste Kunde fragt nach EU-Verarbeitung, oder die eigene Datenschutzerklärung lässt sich ohne Residenz nicht schreiben. |
| **Gegenmaßnahme** | Vor Phase 3 den Enterprise-Preis beim Vertrieb erfragen — eine E-Mail. Solange er unbekannt ist, gilt der Umstieg als **wirtschaftlich ungeprüft**. Aufbewahrung sofort auf 0 Tage, Audio-Mitschnitt aus, Training-Widerspruch setzen. |
| **Phase** | 1 (Einstellungen), 3 (Preis) |

### P6 — Nach zwei Wochen tut sich sichtbar nichts

Antonio hat wieder das Gefühl, es passiert nichts, verliert das Vertrauen in den Plan und
bricht mitten in der Umstellung ab — mit zwei halbfertigen Systemen.

| | |
|---|---|
| **Frühwarnzeichen** | Eine Phase läuft länger als angesetzt, ohne dass ein hörbares oder ablesbares Ergebnis entstanden ist. |
| **Gegenmaßnahme** | Jede Phase liefert für sich allein ein sichtbares Ergebnis (Zahl oder Telefonat). Keine Phase dauert länger als vier Tage. Phase 1 dauert einen Nachmittag und wird von Antonio selbst gemacht — das früheste mögliche Erfolgserlebnis. |
| **Phase** | alle |

### P7 — Die Einwilligung des Angerufenen fehlt weiterhin

Der erste zahlende Kunde ruft mit Hermes bei einer Arztpraxis an. Die Praxis beschwert sich
bei der Aufsichtsbehörde. Belegt: Die Datenschutzkonferenz verlangt für gespeicherte
Transkripte eine **aktiv bestätigte** Einwilligung. Das gilt heute schon und wurde nie
umgesetzt.

| | |
|---|---|
| **Frühwarnzeichen** | Es gibt keinen Beschluss, ob wortgetreue Transkripte gespeichert werden oder nur anonymisierte Zusammenfassungen. |
| **Gegenmaßnahme** | Anwaltliche Kurzprüfung (Anhang, Frage 4), unabhängig vom Umstieg beauftragt. Bis dahin kein fremder Kunde. |
| **Phase** | 0 (Beauftragung), unabhängig vom Umstieg |

### P8 — Die Werkzeugwahl bleibt unzuverlässig, weil sie am Modell hängt

Der Agent ruft die Rückfrage weiterhin mal auf und tut mal nur so. Das hängt am Sprachmodell,
nicht am Anbieter — es **wandert mit**. Drei Prompt-Runden sind daran bereits gescheitert.
Der Beschluss „nächster Schritt ist ein Modellwechsel, keine vierte Prompt-Runde" steht seit
dem **06.08. unausgeführt**.

| | |
|---|---|
| **Frühwarnzeichen** | Im Phase-1-Test ruft auch der ElevenLabs-Agent die Rückfrage nicht zuverlässig auf. |
| **Gegenmaßnahme** | In Phase 1 wird bewusst ein starkes Modell eingestellt (Claude Sonnet 4.6). Zeigt sich dort der Sprung, ist die Ursache das Modell — und dann ist ein Modellwechsel im Bestand die billigere Antwort als eine Migration. |
| **Phase** | 1 |

### P9 — Es wurde zum Rundumschlag

Claude Code bekommt „mach die Migration" und arbeitet eine Woche durch. Am Ende laufen
weder alt noch neu. **2.940 Zeilen sterben, rund 1.287 Testfälle hängen an der Schicht** —
das ist kein Eingriff, den man am Stück macht.

| | |
|---|---|
| **Frühwarnzeichen** | Ein Arbeitsauftrag umfasst mehr als eine Phase. Der Testlauf ist länger als einen Tag rot. |
| **Gegenmaßnahme** | Eine Phase je Auftrag, dazwischen hält Antonio an und prüft. Der neue Weg liegt hinter einem Schalter **neben** dem alten, nicht an seiner Stelle. Umschalten ist ein Flag-Flip, kein Merge. |
| **Phase** | 3, 4 |

### P10 — Die US-Nummer bleibt das Problem, das sie schon ist

Nach der Migration klingelt es beim Handwerker weiterhin aus Amerika, oder gar nicht. Zur
Frage US-Nummer nach Deutschland steht in der ElevenLabs-Doku **nichts** — sie hängt am
Telnyx-Profil, also an derselben Stelle wie heute. Der Umstieg löst sie nicht.

| | |
|---|---|
| **Frühwarnzeichen** | Testanrufe kommen nicht an oder werden nicht angenommen. |
| **Gegenmaßnahme** | Eine deutsche Nummer besorgen — **unabhängig vom Umstieg und vor Phase 3**. Zusätzlich der offene Ein-Anruf-Test aus 2.1 (andere deutsche Nummer). |
| **Phase** | 0 |

### P11 — Abhängigkeit von einem Anbieter, der dasselbe Produkt baut

ElevenLabs baut Telefon-Agenten. Wenn sie die MCP-Anbindung selbst anbieten, ist der
Vorsprung weg — und dann sitzt man auf deren Rechnung. Belegt: Preisänderungen sind mit 30
Tagen Vorlauf möglich; undokumentierte Standardwerte, die sich still ändern, haben wir beim
jetzigen Anbieter bereits zweimal erlebt.

| | |
|---|---|
| **Frühwarnzeichen** | ElevenLabs kündigt eine MCP- oder Assistenten-Anbindung an. Eine Rechnung steigt ohne erklärbare Ursache. |
| **Gegenmaßnahme** | Die Sicherheits-Gates, die Abrechnung, die Mandantentrennung und der MCP-Vertrag bleiben **bei uns** (Abschnitt 2.4: rund 27.000 Zeilen). Der Anbieter wird über dieselbe Naht angebunden wie Telnyx, damit ein dritter Anbieter nicht wieder ein Umbau ist. |
| **Phase** | 3 |

### P12 — Der eigentliche Defekt war nie die Gesprächsführung

Nach dem Umstieg stellt sich heraus: Die 40 % gekappten Äußerungen lagen an etwas, das
mitgewandert ist. Die eigene Pre-Mortem-Runde vom 18.07. gewichtete die wahrscheinlichste
Todesursache des Produkts mit **35 % „fehlender Nutzen"** gegen **20 % „Qualität"** — bei
null echten Aufträgen in der gesamten Anrufhistorie.

| | |
|---|---|
| **Frühwarnzeichen** | Phase 1 zeigt keinen Sprung. Oder: Der Umstieg gelingt technisch, und es meldet sich trotzdem kein Kunde. |
| **Gegenmaßnahme** | Phase 1 als Blackbox-Test lesen: Er beantwortet in einem Nachmittag die Frage, an der ein Arbeitslauf mit 26 Agenten gescheitert ist. Danach ist die Frage „warum kauft das jemand" wieder die wichtigere. |
| **Phase** | 1 |

### P13 — Zwei Systeme, keins gepflegt

Der alte Stand bleibt „für alle Fälle" liegen, wird nicht mehr getestet, und beim ersten
Rückschalt-Versuch ist er kaputt.

| | |
|---|---|
| **Frühwarnzeichen** | Der Testlauf des alten Wegs wird übersprungen oder als „egal" markiert. |
| **Gegenmaßnahme** | Solange beide Wege existieren, muss `npm test` für beide grün sein. Der Rückweg wird in Phase 4 **einmal geübt**, nicht nur beschrieben. Feste Frist: Nach vier Wochen stabilem Betrieb wird der alte Weg gelöscht. |
| **Phase** | 4 |

---

## 5. Phasen-Fahrplan

Fünf Phasen. Jede liefert für sich allein ein sichtbares Ergebnis. Jede hat ein
Abbruchkriterium und einen Rückweg.

---

### Phase 0 — Messen, und die stillen Fehlschläge abstellen

> **Ziel in einem Satz:** Ab heute ist jede Änderung nachweisbar besser oder schlechter,
> und kein Anruf gilt mehr als erfolgreich, der nie stattgefunden hat.

**Warum der Bugfix hier hineingehört und nicht in „neue Funktionen":** 8 von 70 Anrufen sind
falsche Erfolge. Solange das so ist, misst jedes Testset eine um 11 % geschönte
Erfolgsquote — der Vorher-Wert wäre unbrauchbar. Der Fix ist Voraussetzung der Messung, kein
Feature.

**Schritte**

1. **8 Szenarien festlegen**, je eine Frage mit Ja/Nein-Antwort. Vorschlag aus dem Befund
   übernommen: Werkstatt-Termin mit fehlender Angabe · Wissensfrage mit aktuellem Bezug ·
   Gespräch über 3 Minuten · Gesprächspartner redet dazwischen · Gesprächspartner nuschelt ·
   Sprachwechsel auf Englisch · Gesprächspartner will etwas Unmögliches · Anrufbeantworter
   geht ran.
2. **Auf dem vorhandenen Werkzeug aufbauen, nicht neu bauen.** `npm run convo-bench`
   existiert, kennt Szenarien, einen Bewerter und Schalter für Anbieter und Modell. Es ist
   ein Stellvertreter (kein echtes Telefon, kein Ton) — deshalb zusätzlich **acht echte
   Anrufe** mit Ja/Nein-Bewertung von Hand.
3. **Ergebnis in eine Tabelle**: Datum, Modellname, Bauart, x von 8.
4. **Den stillen Fehlschlag beheben:** Ein Anruf ohne Abheben darf nicht `completed` werden.
   Er braucht `failed` plus Grund. Der Grund kommt vom Anbieter mit und wird heute
   weggeworfen — er muss gespeichert und in `get_call_status` ausgeliefert werden.
5. **Zwei Prüfungen von Minuten**, die seit dem 11.08. offen sind: Welche Gesprächs-Bauart
   läuft live? Ist das Guthaben des Sprachmodell-Anbieters gedeckt?
6. **Ein einzelner Anruf** auf eine andere deutsche Nummer (anderes Netz oder Festnetz), um
   die 91-Sekunden-Frage zu schließen.

**Aufwand** 1 Tag · **Wer** Claude Code (Testset, Bugfix), Antonio (die acht echten Anrufe
bewerten)

**Fertig, wenn** eine Zahl in der Tabelle steht — sie darf schlecht sein — **und** ein
Anruf ohne Abheben nachweislich als `failed` mit Grund erscheint.

**Abbruchkriterium** Reproduziert das Testset die bekannten Defekte nicht (Rückfrage feuert
nicht, Äußerungen werden gekappt), ist es als Messgerät untauglich. Dann wird es repariert,
**bevor** irgendetwas anderes passiert — nicht als „gut genug" durchgewinkt.

**Rückweg** Der Bugfix ist eine Verhaltensänderung im Statusfeld. Rückweg: ein Commit
zurücknehmen und neu deployen, etwa 15 Minuten.

---

### Phase 1 — Antonio baut den ElevenLabs-Agenten von Hand

> **Ziel in einem Satz:** Antonio hört mit eigenen Ohren, ob es besser ist — bevor eine
> Stunde Programmierung investiert wird.

**Diese Phase macht Antonio allein. Keine Zeile Code, kein Claude Code, kein Deployment.**

**Schritte, Klick für Klick**

1. Auf `elevenlabs.io` ein Konto anlegen. Plan **Creator, 22 US-Dollar** (im ersten Monat
   11). Der Starter-Plan für 6 Dollar reicht mit 75 Minuten notfalls auch.
2. **Sofort drei Einstellungen ändern**, bevor telefoniert wird (Menü *Settings*):
   - Aufbewahrung der Gesprächsdaten von 2 Jahren auf **0 Tage**
   - Audio-Mitschnitt **aus**
   - Unter *Data use* der Nutzung zum Modelltraining **widersprechen**
3. Menü *Agents* → **Create Agent**.
4. **Sprache** Deutsch. **Stimme** aussuchen und einmal anhören.
5. Als Gehirn **Claude Sonnet 4.6** einstellen. Nicht sparen — erst wissen, was maximal geht.
6. **Reasoning effort auf `None`** stellen. (Damit denkt das Modell nicht vor jeder Antwort
   nach; für Telefonate empfiehlt ElevenLabs das ausdrücklich, sonst stockt der Redefluss.)
7. **Web-Recherche einschalten:** Integration *Exa*, ein Schlüssel, fertig.
   **Achtung:** Damit geht ein weiterer Dienstleister in die Verarbeitung. Für den Test mit
   der eigenen Nummer ist das vertretbar; **vor dem ersten fremden Kunden gehört Exa in die
   Datenschutzerklärung** (siehe 2.3).
8. Den heutigen System-Prompt aus Hermes übertragen.
9. Eine **Testnummer** von ElevenLabs nehmen. Die eigene Telnyx-Nummer kommt erst in Phase 3
   — sie wird hier bewusst nicht angefasst.
10. **Die acht Szenarien aus Phase 0 durchtelefonieren** und je Szenario Ja oder Nein
    notieren.

**Aufwand** 2–3 Stunden · **Wer** **Antonio, allein**

**Fertig, wenn** eine zweite Zahl neben der aus Phase 0 steht — x von 8 — und Antonio sagen
kann, ob es hörbar besser war.

**Abbruchkriterium — hart und vorher festgelegt:** Ist der ElevenLabs-Agent **nicht
mindestens 3 von 8 Punkten besser** als der heutige Stand, **endet der Umstieg hier**.
Stattdessen wird der seit dem 06.08. offene Modellwechsel im Bestand ausgeführt (Phase 8 des
Premortems): Das ist eine Konfigurationsänderung von einer Stunde statt einer Woche Umbau.

**Rückweg** Abo kündigen. An Hermes wurde nichts angefasst. Kosten: 22 US-Dollar.

---

### Phase 2 — Trägt der Rückfrage-Kanal? (Das Herzstück)

> **Ziel in einem Satz:** Beweisen, dass der Telefon-Agent bei ElevenLabs mitten im
> Gespräch auf eine Antwort von außen warten kann, ohne dass das Gespräch zerfällt.

**Warum diese Phase vor der Integration steht:** Der Rückfrage-Kanal ist das, wofür jemand
zahlen soll. Ist er bei ElevenLabs nicht baubar, ist die ganze Migration sinnlos — dann
hätte man das Alleinstellungsmerkmal gegen bessere Aussprache getauscht. Und genau hier hat
die Doku ihre größte Lücke (Abschnitt 3.1).

**Schritte**

1. Ein Webhook-Werkzeug anlegen (ein Werkzeug, bei dem ElevenLabs unseren Server aufruft und
   auf dessen Antwort wartet), das auf einen **Wegwerf-Endpunkt** zeigt — nicht auf Hermes.
   Der Endpunkt tut nichts, außer eine einstellbare Zeit zu warten und dann zu antworten.
2. **Beide Bauarten testen:**
   - **Warten:** `response_timeout_secs`, dazu `pre_tool_speech: force`,
     `interruption_mode: disable_during_tool`, `tool_call_sound: typing`.
   - **Hintergrund:** `execution_mode: async` — der Agent redet weiter, während das Werkzeug
     läuft.
3. Je Bauart drei echte Anrufe mit Wartezeiten von **30, 45 und 60 Sekunden**.
4. Protokollieren: Hält der Agent durch? Sagt er den Überbrückungssatz? Fängt er nach 7
   Sekunden von selbst wieder an zu reden (das wäre `turn_timeout`)? Legt jemand auf?

**Aufwand** 1 Tag · **Wer** Claude Code (Endpunkt und Konfiguration), Antonio (die Anrufe)

**Fertig, wenn** für jede der drei Wartezeiten dokumentiert ist, was passiert — und eine
Empfehlung feststeht, welche der beiden Bauarten der Rückfrage-Kanal bekommt.

**Abbruchkriterium** Übersteht der Agent **keine 30 Sekunden** Wartezeit in **keiner** der
beiden Bauarten, ist ElevenLabs für unser Produkt ungeeignet. Dann wird abgebrochen und
stattdessen der Modellwechsel im Bestand gefahren. (Zum Vergleich: Hermes hält heute 47
Sekunden offen.)

**Rückweg** Nichts an Hermes verändert. Der Wegwerf-Endpunkt wird gelöscht.

---

### Phase 3 — Eigene Nummer und Anbindung hinter einen Schalter

> **Ziel in einem Satz:** Hermes kann Anrufe wahlweise über den alten oder den neuen Weg
> führen — umschaltbar, ohne dass Kunden etwas merken.

**Schritte**

1. **Vorher: eine deutsche Nummer besorgen.** Unabhängig vom Umstieg fällig (Premortem P10).
2. Bei Telnyx eine SIP-Verbindung nach der offiziellen Anleitung einrichten (Typ FQDN,
   Zugangsdaten für ausgehende Anrufe, `sip.rtc.elevenlabs.io`, Format `+E.164`, Transport
   **TCP**), Nummer zuweisen. Bei ElevenLabs die Nummer importieren; als Ziel **nur den
   Hostnamen** `sip.telnyx.com` eintragen, ohne `sip:` davor.
3. **Zuerst einen ausgehenden und einen eingehenden Anruf** über die eigene Nummer — bevor
   Code angefasst wird.
4. Erst dann die Anbindung in Hermes: `place_call` löst wahlweise den alten Weg oder
   `POST /v1/convai/sip-trunk/outbound-call` aus. Der Auftrag geht über
   `dynamic_variables` in eine Prompt-Vorlage mit Platzhaltern — **nicht** über
   `conversation_config_override` (der ersetzt die Werkzeugliste, statt sie zu ergänzen).
5. **Die Sicherheits-Gates bleiben davor.** Verifikation, Kostendecke, Länder-Sperre,
   Stundenlimit, Notaus, Offenlegungssatz — jeder neue Auslöse-Pfad läuft durch dieselbe
   Kette. Das ist nicht verhandelbar.
6. Rückkanal: Transkript über den Post-Call-Webhook, Status über
   `GET /v1/convai/conversations/{id}`.
7. **Der neue Weg liegt hinter einem Schalter neben dem alten.** Kein Ersetzen.

**Aufwand** 3–4 Tage · **Wer** Claude Code, Abnahme durch Antonio

**Fertig, wenn** ein Anruf über die eigene deutsche Nummer über ElevenLabs rausgeht, ein
eingehender ankommt, das Transkript in Hermes landet — **und** `npm test` für **beide** Wege
grün ist.

**Abbruchkriterium** Ist die Anbindung nach vier Tagen nicht telefonierfähig, oder scheitert
sie an einer Stelle, die die Doku nicht abdeckt (deutsche G711-Variante, Routing nach
Deutschland), wird angehalten und die Lage neu bewertet — **nicht** weiterprobiert.

**Rückweg** Schalter zurückstellen. Der alte Weg ist unangetastet. Dauer: ein Deploy, etwa
10 Minuten.

---

### Phase 4 — Vergleichen, Kosten ablesen, entscheiden

> **Ziel in einem Satz:** Die Entscheidung fällt mit zwei Zahlen und einer Rechnung, nicht
> mit einem Gefühl.

**Schritte**

1. Dasselbe Testset gegen beide Wege. Zwei Zahlen nebeneinander.
2. **Kosten je Minute an der echten Rechnung ablesen** — drei Anrufe, dann in beide
   Abrechnungen schauen (ElevenLabs und Telnyx). Nicht schätzen.
3. Gegen beide Tarife halten: Starter (Erlös 15,67 Cent je Minute) und Business (7,65 Cent
   je Minute). Der heutige Ist-Wert ist 8,18 Cent.
4. Den Enterprise-Preis für EU-Datenresidenz erfragen, falls in Phase 3 noch nicht geschehen.
5. **Den Rückweg einmal üben**, nicht nur beschreiben: umschalten, telefonieren,
   zurückschalten, telefonieren.
6. Entscheidung: umschalten oder nicht.

**Aufwand** 1 Tag · **Wer** Claude Code (Messung), **Antonio entscheidet**

**Fertig, wenn** die Entscheidung schriftlich festgehalten ist, mit den beiden Zahlen und
dem Minutenpreis daneben.

**Abbruchkriterium** Ist der neue Weg nicht besser **oder** liegt er über 12 Cent je Minute,
wird **nicht** umgeschaltet. Der Schalter bleibt aus, die Arbeit bleibt liegen — das ist
billiger als ein Produkt, das mit Verlust telefoniert.

**Rückweg** Der alte Weg bleibt vier Wochen lang lauffähig und wird mitgetestet. Erst danach
wird gelöscht.

---

### Zeitplan

| Phase | Aufwand | Wer | Kosten |
|---|---|---|---|
| 0 — Messen + stille Fehlschläge | 1 Tag | Claude Code + Antonio | — |
| 1 — Von Hand nachbauen | 2–3 Std. | **Antonio allein** | 22 USD |
| 2 — Rückfrage-Kanal | 1 Tag | Claude Code + Antonio | ~5 USD |
| 3 — Nummer + Anbindung | 3–4 Tage | Claude Code | Nummer-Miete |
| 4 — Vergleichen | 1 Tag | Antonio entscheidet | ~5 USD |

**Bis zur Entscheidung (Phasen 0–2): 2,5 Tage und rund 30 US-Dollar.**
**Volle Umstellung, falls beschlossen: 5–7 Arbeitstage.**

---

## 6. Was wir bewusst NICHT tun

Vier Wochen sind verloren gegangen, weil niemand aufgeschrieben hatte, was nicht dazugehört.

**1. Keinen eigenen Sprach-Stack bauen.**
Er löst keinen der Befunde, und die Evaluation vom 11.08. beziffert ihn mit 3–6 Wochen
Bauzeit plus Dauerbetrieb.
*Doch, wenn:* Phase 1 zeigt einen klaren Sprung, Phase 2 scheitert aber am Rückfrage-Kanal —
dann ist die Gesprächsführung das Problem und kein Anbieter löst es. Frühestens in drei
Monaten, und dann mit Zahlen aus dem Testset.

**2. Keine Prompt-Arbeit vor Phase 0.**
Drei Prompt-Runden sind bereits gescheitert. Ohne Vorher-Zahl ist die vierte ein Münzwurf.
*Doch, wenn:* Das Testset steht und zeigt reproduzierbar, welcher Prompt-Teil versagt.

**3. Die Gesprächsführung nicht optimieren, während umgestellt wird.**
Zwei gleichzeitige Änderungen an derselben Sache machen jede Messung wertlos — genau diese
Vermengung hat den Eindruck „nichts hilft" erzeugt.
*Doch, wenn:* Die Umstellung ist entschieden (nach Phase 4) und der neue Weg ist die
alleinige Grundlage.

**4. Keine neuen Funktionen während der Umstellung.**
Keine Kalenderanbindung, kein Weiterverbinden, keine Anrufbeantworter-Erkennung, keine
Dashboard-Arbeit.
*Doch, wenn:* Ein zahlender Kunde nennt die Funktion als Kaufbedingung. Dann geht Kundennutzen
vor Umbau — und der Umbau pausiert, statt beides halb zu machen.

**5. Die 91-Sekunden-Grenze nicht weiter jagen.**
Zwölf Kandidaten sind ausgeschlossen, der Fall liegt beim Netzbetrieb des Anbieters, und die
Messung in 2.1 zeigt, dass sie durchbrochen wird (bis 190 s). Es bleibt genau **ein** offener
Test: ein Anruf auf eine andere deutsche Nummer. Der steht in Phase 0.
*Doch, wenn:* Dieser eine Anruf auch bei 91 Sekunden kappt — dann ist es nicht netzspezifisch
und die Suche geht weiter.

**6. Keine EU-Datenresidenz und keinen Enterprise-Vertrag vor Phase 4 kaufen.**
Solange nicht feststeht, dass umgestellt wird, ist das Geld für ein Problem ausgegeben, das
man vielleicht nicht bekommt. Der Preis wird **erfragt**, nicht bezahlt.
*Doch, wenn:* Ein zahlender Kunde verlangt EU-Verarbeitung schriftlich.

**7. Die Datenschutzerklärung nicht nebenbei schreiben.**
Sie blockiert heute die Web-Recherche (2.3) und blockiert morgen den ersten Kunden. Sie ist
eine eigene Aufgabe mit anwaltlicher Kurzprüfung — kein Nebenprodukt einer Migrations-Phase.
*Doch, wenn:* nie „nebenbei". Sie bekommt einen eigenen Termin.

**8. Nicht in einem Rutsch migrieren.**
Eine Phase je Auftrag. Der neue Weg liegt **neben** dem alten hinter einem Schalter.
*Doch, wenn:* nie. Das ist die Bauart, die in diesem Projekt zweimal funktioniert hat.

---

## 7. Anhang: Was Antonio entscheiden muss, bevor Phase 1 startet

Jede Frage mit einer Empfehlung. Keine Denkaufgaben.

| # | Frage | Empfehlung |
|---|---|---|
| 1 | Wird Phase 1 überhaupt gemacht? | **Ja.** Ein Nachmittag und 22 Dollar beantworten eine Frage, an der ein Arbeitslauf mit 26 Agenten gescheitert ist. |
| 2 | Welches Gehirn im Test? | **Claude Sonnet 4.6, Reasoning effort `None`.** Erst wissen, was maximal geht; sparen kann man danach. |
| 3 | Gilt das Abbruchkriterium „mindestens 3 von 8 besser"? | **Ja, und es wird vorher festgeschrieben.** Sonst wird die Latte nachträglich an das Ergebnis angepasst. |
| 4 | Werden wortgetreue Transkripte weiter gespeichert? | **Anwaltliche Kurzprüfung beauftragen** (ein bis zwei Stunden). Die Aufsichtsbehörden verlangen dafür eine aktiv bestätigte Einwilligung des Angerufenen. Die Alternative — nur anonymisierte Zusammenfassung — ist eine Produktentscheidung, die früh fallen sollte. |
| 5 | Wird Exa (Web-Recherche) freigeschaltet? | **Ja, aber erst nach Ergänzung der Datenschutzerklärung.** Der Code ist fertig; es fehlt nur diese Entscheidung. Wirkt sofort und unabhängig vom Umstieg. |
| 6 | Deutsche Telefonnummer besorgen? | **Ja, sofort und unabhängig vom Umstieg.** Eine US-Nummer im Display eines deutschen Handwerkers kostet Gespräche, und der Verdacht auf Zustellprobleme steht seit dem 10.08. im Raum. |
| 7 | Welcher ElevenLabs-Plan für den Test? | **Creator, 22 USD** (erster Monat 11). Starter für 6 USD reicht notfalls; 75 Minuten sind für acht Szenarien knapp. |
| 8 | Business-Tarif (9,99 USD / 120 Min.) | **Vor dem Start neu rechnen.** Er ist bei Vollnutzung **heute schon defizitär** (Erlös 7,65 gegen Ist-Kosten 8,18 Cent je Minute) — mit ElevenLabs würde die Lücke größer. Entweder Preis hoch oder Minuten runter. |
| 9 | Startup-Zuschuss beantragen? | **Ja.** 12 Monate, Wert über 4.000 USD, Bedingung „unter 25 Mitarbeiter" ist erfüllt. Kostet eine halbe Stunde. |
| 10 | Wer bewertet die acht Szenarien? | **Antonio, immer.** Die Bewertung ist ein Hör-Urteil; ein Programm kann sie nicht ersetzen. |
| 11 | Wer darf abbrechen? | **Antonio, an jedem Phasenende.** Die Abbruchkriterien stehen im Fahrplan und werden nicht nachverhandelt. |
| 12 | Was passiert, wenn Phase 1 durchfällt? | **Der seit dem 06.08. offene Modellwechsel im Bestand** — eine Konfigurationsänderung von etwa einer Stunde statt einer Woche Umbau. |

---

## 8. Widersprüche, die ich nicht aufgelöst habe

Sie stehen hier gesammelt, damit sie niemand übersieht.

1. **„Unser eigener Server legt auf" gegen „der Ziel-Carrier legt auf".** Die
   Datenbank-Messung stützt die zweite Aussage (dreimal exakt 91 s ab Abheben, plus
   Anbieter-Beleg `recv_bye`). Sie erklärt aber nicht, warum sechs Anrufe 114–190 s liefen.
   **Offen.**
2. **„82 Anrufe, keine einzige Bewertung."** Das stimmt so nicht. Es gibt `npm run
   convo-bench` mit Szenarien und Bewerter, einen schriftlichen Abnahmekatalog vom 11.08.,
   Vorher-Messungen und eine statistisch gerechnete Erfolgsschwelle. Was fehlt, ist nicht das
   Werkzeug, sondern ein **durchgehend geführter Punktestand über echte Anrufe**. Der
   Unterschied ist wichtig: Phase 0 baut auf Vorhandenem auf, statt neu anzufangen.
3. **Welche Gesprächs-Bauart live läuft, ist im Repo nicht entscheidbar** —
   Konfigurationsdatei und Messung widersprechen sich, und die Frage steht seit dem 11.08.
   offen. Davon hängt die halbe Kostenrechnung ab.
4. **Der Befund nennt die Web-Recherche „nicht gebaut", der Code enthält sie fertig.** Die
   Sperre ist eine Datenschutz-Entscheidung, kein Programmierproblem.
5. **Die Erinnerung „ein Prototyp lief auf ElevenLabs und funktionierte gut" ist durch die
   Git-Historie nicht gedeckt** — in 1.908 Commits gibt es keine Spur davon. Wahrscheinlich
   lag er außerhalb dieses Codes (im ElevenLabs-Dashboard). Das ist keine
   Falschaussage, aber es heißt: Der Vergleich war nie gleichwertig.
6. **Der Plan sagt „14 von 15 Zeilen sind Konfiguration statt Programmierung."** Nach dieser
   Prüfung sind es weniger: Befund 1 ist widerlegt, Befund 3 ist bei uns schon gebaut,
   Befund 5 ist unser Bug und wandert mit. Was übrig bleibt, ist Befund 4 — die
   Gesprächsführung. **Das ist ein gutes Argument. Es ist nur ein anderes.**
