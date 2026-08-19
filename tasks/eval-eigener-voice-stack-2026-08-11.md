# Evaluation: eigenen Voice-Stack bauen?

Stand 2026-08-11. Anlass: Owner-Frage — "die Gespraechsqualitaet ist extrem schlecht, ich
ueberlege den ganzen Stack selber zu machen; mehr Flexibilitaet, ist die Qualitaet so
einfacher zu verbessern? Aufwand? Pre-Mortem? Konsequenzen? Skaliert das auf Millionen?"

Grundlage: vier parallele Erhebungen (Defekt-Forensik im Repo, Code-Inventar, Markt-/
Technik-Recherche mit Primaerquellen, Kosten-/Skalenrechnung), danach eine adversariale
Gegenlesung, deren Treffer einzeln am Code nachgeprueft wurden. Abschnitt 9 protokolliert,
was die Gegenlesung an der ersten Fassung korrigiert hat — inklusive der gekippten
Hauptempfehlung.

---

## 0. Kernurteil

**Bau den Prototyp — als Messgeraet, nicht als Ersatz.** Bauzeit 1-2 Wochen fuer die
Laborstufe, 3-6 Wochen bis Paritaet (Abschnitt 2.3). Bei den urspruenglich geschaetzten
5-9 Monaten waere "nicht bauen" richtig gewesen; bei 1-2 Wochen ist es falsch, weil der
Prototyp genau die Frage beantwortet, an der 26 Agenten gescheitert sind.

**Reihenfolge: 30 Minuten Kontopruefung (7.0) -> Messgroesse festlegen (7.1) -> Prototyp ->
Entscheidung am Messwert.** Der Prototyp loest die Prompt-Defekte (Werkzeugwahl,
Identitaets-Kollaps, Persona) NICHT — die wandern auf jeden Stack mit.

1. **Der Zaehlstand spricht gegen den Eigenbau, das Gewicht nicht so klar.** 15 von 21
   belegten offenen Defekten (~71 %) sitzen in unserem Code oder im Prompt. Aber der
   *lauteste* Defekt — 40 % gekappte Agenten-Turns — sitzt in der Telnyx-Blackbox, und der
   Forensik-Bericht sagt das selbst: *"Der lauteste erlebte Einzelbefund ist C1 — Schicht (c),
   NICHT (a)/(b)."* Anzahl ist nicht Lautstaerke. Wer nur zaehlt, entscheidet falsch.
2. **Vor jeder Stack-Frage stehen zwei Pruefungen von Minuten**, die den Qualitaetseindruck
   erklaeren koennten (Abschnitt 7.0): das DeepSeek-Guthaben stand am 11.08. auf
   `is_available:false` — falls Live denselben Account nutzt, antwortet **jeder Turn** mit der
   Stoerungsansage. Und ob der Assistant-Pfad live ueberhaupt an ist, ist ungeprueft, obwohl
   die halbe Kostenrechnung daran haengt.
3. **Der Aufwand ist geringer, als eine Bauchschaetzung sagt** — an diesem Repo kalibriert
   (Abschnitt 2.3). Aber der Weg heisst *Adapter neben dem Bestand*, nicht Stack-Tausch.
4. **Millionen Kunden skalieren technisch unspektakulaer** (~2.700 gleichzeitige Gespraeche
   bei 1 Mio Nutzern). Der dominierende Kostenblock ist die Nummernmiete: bis zu **1 Mio
   USD/Monat** bei 1 Nummer je Tenant — mehr als alle Gespraechsminuten zusammen, und vom
   Voice-Stack voellig unberuehrt.

---

## 1. Was heute kaputt ist (verifiziert)

### 1.1 Auszaehlung — und warum sie allein nichts entscheidet

| Schicht | offene belegte Defekte | Eigener Stack hilft? |
|---|---|---|
| (a) unser Orchestrierungs-Code | 9 | ueberwiegend nein — aber s. 1.2 |
| (b) Prompt / LLM-Verhalten | 6 | nein — wandert mit |
| (c) Telnyx-Assistant-Blackbox | 4 (C1 Kappungsrate, C2 Satzzeichen, C3 Eager-EOT, C4 undok. Config) | ja / vielleicht |
| (d) TeXML/Gather turn-basiert | 1 (kein Barge-in) | ja — strukturell |
| (g) Carrier/SIP | 1 (91-s-Kappung) | teilweise — s. 1.4 |
| **Summe** | **21** | |

15 von 21 = ~71 % in (a)/(b). **Diese Zahl traegt das Urteil aber nicht allein**, aus drei
nachgeprueften Gruenden:

- **Gewicht ≠ Anzahl.** Der Forensik-Bericht attestiert mehreren der 15 ausdruecklich
  *"keine direkte Hoerbarkeit"* (A5), *"kein Hoer-Symptom"* (A8), *"Wirkung auf das Gespraech
  UNGEMESSEN"* (A9). Dagegen C1: 40 % **aller** Agenten-Aeusserungen, Owner-Urteil
  *"jeder dritte bis vierte Satz war komplett abgehakt und es war mir nicht moeglich, mit dem
  KI-Agenten ein Gespraech zu fuehren"* (`tasks/gq-chain-state.md:1064`).
- **"Liegt in unserem Code" heisst nicht "stack-unabhaengig".** `telnyx-speech-gate.js`
  (GQ-P18) steht im Code-Inventar unter STACK-GEBUNDEN: es *kompensiert eine
  Telnyx-Assistant-Eigenheit* (fragmentierte STT-Zustellung). **A1 (`silenced`-Verwurf) ist
  die Nebenwirkung genau dieser Kompensation.** Dasselbe Muster: Turn-Probe/Supersede (221 Z.),
  Conversation-Watchdog (362 Z.), Shim (1.100 Z.) — unser Code, der ausschliesslich wegen des
  fremden Turn-Modells existiert. Ein Teil der (a)-Defekte verschwaende mit dem fremden Modell.
- **Die 40 % sind ein Protokoll-Delta, keine Hoermessung.** Das Messwerkzeug sagt das ueber
  sich selbst: *"Es misst die Kappung zwischen unserem Draht und Telnyx' eigenem Protokoll.
  Was das Ohr des Angerufenen erreicht hat, liegt hinter dieser Grenze und ist hier nicht
  messbar."* (`scripts/kappungsrate.mjs`, Commit `e2b5c48`).

### 1.2 Die Fehlschlag-Historie

- **Drei erfolglose Prompt-Runden** gegen die Werkzeugwahl (AL-P14, AL-D3-Nachmessung,
  Werkzeugwahl-P3+P4). Die Nachher-Messung vom 11.08. verfehlte das Kernziel.
  **Praezision:** die oft zitierte "0/5" ist als Tool-Feuer-Zaehlung korrekt, ihre Lesart als
  fuenf verpasste Gelegenheiten aber **ueberzeichnet** — nach Bereinigung
  (`tasks/befund-toolwahl-7-szenariopruefung.md:92-99`) sind es **2/5 klar, 1/5 schwach**.
- Der Owner-Beschluss "naechster Schritt ist Modellwechsel/A-B-Test, **keine vierte
  Prompt-Runde**" steht seit **06.08.** und ist bis heute nicht ausgefuehrt.
- GQ-P1 (Code-Riegel gegen Doppelantworten) lief 753k Token in einen nie betretenen Pfad.
- GQ-P17 wurde durch GQ-P18 ersetzt, das den neuen Defekt A1 (`silenced`) einfuehrte.

Fuenf Defekte wurden sehr wohl an der Wurzel geschlossen (Turn-Duplikation, Provider-Nudge,
STT-Kauderwelsch, Dead-Air, vier Fragilitaets-Fixe) — mit demselben Stack.

### 1.3 Die Provider-Konfiguration: ein Gewinn, nicht zwei

Die erste Fassung dieser Evaluation behauptete zwei bestaetigte Config-Gewinne. Nachgeprueft
haelt nur einer:

- **`disable_greeting_interruption: true`** — owner-bestaetigt, die Offenlegung ist nicht mehr
  wegdrueckbar (`gq-chain-state.md:248`). Haelt.
- **`interrupt_prediction_threshold`** — am 04.08. von 0.4 auf 0.2 gesetzt und subjektiv als
  Gewinn gebucht; am **09.08. wieder auf 0.4 zurueckgedreht** (`gq-chain-state.md:1126`), weil
  0.2 als *aktiv verschaerfter, undokumentierter Default* erkannt wurde (C4). Die spaetere
  Kappungsmessung widerlegte den Gewinn ausdruecklich: *"0 von 2 gekappt faellt bei 40 %
  Grundrate in 36 % der Faelle zufaellig an"* (`tasks/PLAN-KAPPUNG.md:34-38`). **Kein Beleg.**

Die Aussage "die Provider-Konfiguration war die erste Adresse, nicht die letzte" bleibt damit
halb gedeckt — genug, um sie zu pruefen, zu wenig, um darauf eine Strategie zu bauen.

### 1.4 Die 91-s-Kappung: hier braeche Eigenbau echte Sicht

`tasks/91s-kappung-befunde-2026-08-10.md:69-96`: `hangup_details = recv_bye` belegt, dass das
BYE von aussen kam. Telnyx liest es als nicht aufgefrischten **Session-Timer nach RFC 4028**
(`Session-Expires` ≈ 90 s) beim deutschen Mobilfunk-Carrier; der Fall liegt beim NOC.
*"Die SIP-Ebene ist auch fuer den Telnyx-Support selbst nicht einsehbar — nur fuer das NOC.
Von unserer Seite ist hier nichts mehr zu messen."*

Ein eigener SIP-Trunk machte uns zum SIP-Endpunkt: `Session-Expires`, re-INVITE/UPDATE und
deren Antworten waeren erstmals sichtbar und selbst steuerbar. **Aber** der scheiternde
Refresh liegt laut Telnyx zwischen Telnyx und dem DE-Carrier — hinter unserem Trunk.
Sichtbarkeit ist nicht Behebbarkeit.

**Wichtiger als der Defekt selbst ist seine Wirkung auf das Urteil:** jeder Owner-Testanruf
endete nach ~91 s, parallel lief der Dead-Air-Defekt. Das Urteil "extrem schlechte Qualitaet"
ist auf einer Strecke entstanden, die aus **zwei stack-fremden Gruenden** kaputt war. Zwei
Ursachen, ein Erlebnis am Telefon — genau diese Vermengung erzeugt den Eindruck "nichts hilft".

---

## 2. Aufwand

### 2.1 Was schon existiert

| stack-unabhaengig (bleibt) | Zeilen | stack-gebunden (faellt/wird ersetzt) | Zeilen |
|---|---|---|---|
| Store / Multi-Tenancy | 8.233 | `telnyx-llm-shim.js` | 1.100 |
| apps/web | 7.414 | Call-Control-Ingest + Watchdog/Sonden | 922 |
| Billing | 3.539 | `bridge.js` (OpenAI-Realtime hart verdrahtet) | 416 |
| i18n | 1.723 | TeXML-Render/Direktiven | 320 |
| Safety-Gates | 1.252 | Assistant-Anteile in `voice.js` u. a. | ~250 |
| Onboarding + Queue | 1.197 | | |
| Auth / Web-Auth | 1.148 | | |
| MCP | 1.035 | | |
| **Summe** | **~25.500** | **Summe** | **~3.000** |

`src/**` = 39.250 Zeilen, `test/**` = 100.124 Zeilen / ~4.016 Tests. **Der teure Teil des
Produkts ist stack-unabhaengig.** Die Gates, das Billing, die Mandantentrennung bleiben stehen
und werden nur neu angebunden — sie muessen nicht neu gebaut werden.

### 2.2 Was komplett fehlt

`src/telephony/ports.js` (280 Zeilen) fuehrt `VoiceControl`, `Messaging`, `VoiceRenderer`,
`NumberProvisioning`, `MediaTransport`, `WebhookEvents`, `InboundSignatureVerifier` — und sagt
in `:248-250` ausdruecklich, dass `MediaTransport` **nur** die Telnyx-Frame-Seite kapselt.
Es gibt **keinen STT-Port, keinen TTS-Port, keinen RealtimeBackend-Port** und **kein eigenes
VAD/Endpointing** (heute immer fremd: OpenAI `server_vad` ODER Telnyx
`interrupt_prediction_threshold` ODER Telnyx-Gather-`auto`). Ebenso fehlt jedes
Jitter-/Resampling-Management jenseits von reinem u-law-Durchreichen.

### 2.3 Schaetzung — an diesem Repo kalibriert

**Kalibrierungsanker (korrigiert):** Track B — LLM-Anbieter-Port, Vertrag, zwei Adapter,
Registry, Golden-Master — lief vom Plan (06.08.) bis `docs(b5)` (09.08.); alle Bau-Commits
tragen **08.08. und 09.08.**, also **rund vier Kalendertage**. Der Owner baut mit
Agenten-Ketten deutlich schneller, als eine Bauchschaetzung annimmt. Das muss die Schaetzung
einpreisen.

**Bauzeit und Abnahmezeit sind zu trennen — sie in einen Topf zu werfen war der Fehler der
ersten beiden Fassungen.**

| Stufe | Inhalt | BAUZEIT |
|---|---|---|
| 1 | Labor-Prototyp: ein Anruf klingt gut, LiveKit/Pipecat als Unterbau (Transport, VAD, Turn-Detection, SIP kommen fertig), keine Gates, kein Multi-Tenant | **1-2 Wochen** |
| 2 | Paritaet: Gates/Billing/Multi-Tenant neu angebunden, Inbound+Outbound, Tests, Fallback per Flag | **+ 2-4 Wochen** |

**Bauzeit-Korridor: 3-6 Wochen.** Anker: Track B (Vertrag, zwei Adapter, Registry,
Golden-Master) lief ~4 Kalendertage; die ~25.500 Zeilen Bestand werden neu **angebunden**,
nicht neu gebaut.

**Was NICHT Bauzeit ist — und wo das Risiko wirklich liegt:** "besser als heute" ist keine
Bauleistung, sondern eine Abnahme. Jede Echtzeit-Aenderung braucht echte Anrufe zur Pruefung,
Echtzeit-Fehler sind nicht deterministisch reproduzierbar (kein Golden-Master pinnt einen
Jitter-Puffer), und die Kalibrierung dafuer steht im eigenen Haus: die GQ-Kette laeuft seit
dem 03.08. — acht Tage, fuenf Phasen, **null bestaetigte Qualitaetsgewinne**. Der Engpass ist
der Feedback-Loop, nicht der Editor. **Deshalb ist die Messgroesse aus 7.1 die Vorbedingung
des Bauens, nicht sein Nachgang.**

Danach ist der Stack nicht "fertig", sondern eine **Dauerverpflichtung**.

---

## 3. Pre-Mortem: ein Jahr spaeter, der Umbau ist gescheitert

**S1 — "Die Defekte sind mitgewandert" (wahrscheinlichster Fall).** Monate gebaut, die
Werkzeugwahl feuert weiter falsch, die Persona kollabiert weiter — beides lag im Prompt.
Dazu eine neue Defektklasse: Audio-Aussetzer, Reconnect-Luecken, Jitter.
*Gegenmittel: 7.0 und 7.2 vor jeder Zeile Code.*

**S2 — "Latenz ist schlechter geworden."** Telnyx' eigene 100-Call-Messung: co-located 450 ms
gegen "stitched stack" 1.210 ms (Herstellerzahl). Unabhaengig belegt ist der Kern: jeder
Netz-Hop zwischen Carrier, Orchestrator und Modell kostet 200-300 ms, Ziel-Gesamtbudget
~800 ms, ab ~1,5 s "rapide Verschlechterung". Heute macht Telnyx STT, VAD und TTS am Carrier.
*Gegenmittel: Co-Location als harte Vorbedingung. Render ist dafuer die schwaechste Wahl
(5 Regionen, kein dokumentiertes Sticky-Routing fuer zustandsbehaftete Audio-Bruecken).*

**S3 — "Wir haben am falschen Ende optimiert."** Die eigene Pre-Mortem-Runde vom 18.07.
gewichtete die wahrscheinlichste Todesursache mit **35 % fehlender Nutzen** gegen **20 %
Qualitaet** — bei 0 echten Auftraegen in der gesamten Call-Historie.

**S4 — "Der Solobetrieb hat den Betrieb nicht getragen."** Echtzeit-Audio bringt eine
Bereitschaftslast mit, die ein turn-basierter HTTP-Pfad nicht hat.

**S5 — "Es war nie eine Stack-Frage."** Der Beschluss vom 06.08. (Modell-A/B) blieb liegen;
nach dem Umbau stellte sich heraus, dass das Modell die Werkzeugwahl entschied.

**S6 — die Gegenrichtung, falls NICHT gebaut wird:** die Kappungsrate bleibt in einer
Blackbox, in die weder wir noch der Telnyx-Support hineinsehen. Der Preis der Blindheit ist
bereits beziffert — 26 Agenten, 20 Hypothesen, 13 gekippt, Wurzel unbekannt; davor GQ-P1 mit
753k Token; der O2-Versuch kostete drei Testanrufe und endete ohne Ergebnis. **Drei Jahre
solcher Runden sind teurer als ein Adapter.** Diese laufenden Kosten gehoeren gegen die
2-6 Monate gerechnet.

---

## 4. Konsequenzen

**Dafuer**
- **Diagnostizierbarkeit** — das staerkste Argument, staerker als Kosten oder Latenz, und das
  einzige, das auf **alle kuenftigen** Defekte wirkt, nicht nur auf die heutigen 21. Heute ist
  der Feedback-Loop an der entscheidenden Stelle blind, und CLAUDE.md ("Wurzel statt Symptom",
  "IMMER erst Runtime-Output lesen") ist dort **strukturell nicht befolgbar**.
- **Lieferantenrisiko ist belegt, nicht spekuliert:** undokumentierte Felder mit stillschweigend
  verschaerften Defaults (C4); `PATCH` quittiert ungueltige Felder mit **HTTP 200 und ignoriert
  sie still — zweimal in diesem Projekt erlebt** (`PLAN-KAPPUNG.md:63-68`).
- SIP-Sicht (1.4); freie Wahl der Bausteine je Markt inkl. **EU-Endpunkten** (s. 6).
- Kein Assistant-Aufschlag von 5,0 US-Ct/min.
- Marktbefund: Bland, Sierra, Cresta und OpenAI haben **sehr frueh und bewusst** in eigene
  Latenz-/Turn-Taking-Technik investiert, als Grundsatzentscheidung — nicht als spaeteren
  Umbau. Fuer ein Produkt, dessen ganzes Versprechen ein natuerliches Telefongespraech ist,
  ist genau diese Schicht die Differenzierung.

**Dagegen**
- 2-6 Monate, danach Dauerbetrieb; Latenzrisiko (S2); Bereitschaftslast solo (S4).
- Turn-Taking ist laut Praxisberichten **die** Hauptfehlerquelle eigener Stacks. Fertige
  Komponenten existieren 2026 (Deepgram Flux fusioniert STT und Turn-Detection, ~30 % weniger
  Fehlunterbrechungen; LiveKit Turn Detector akustisch + linguistisch; Pipecat Smart Turn rein
  akustisch) — niemand muss ein Modell trainieren, aber Auswahl und Schwellwert-Tuning bleiben
  hoerbare Integrationsarbeit.
- 8-kHz-u-law verschlechtert STT strukturell (Konsensbereich aus Drittanbieterquellen:
  92 % -> 65 % Genauigkeit Headset -> Mobilfunk; **keine einzelne Primaerstudie**). Trifft
  jeden Stack, auch den eigenen.
- DTMF erzwingt einen Bruch im Medienkanal; ohne extern persistierten Zustand "hat die KI
  danach Amnesie".
- **Der Zwischenweg ist nicht dasselbe wie "alles selbst":** LiveKit Agents oder Pipecat
  nehmen Transport, VAD, Turn-Detection und SIP-Anbindung ab (LiveKit mit nativem SIP-Support,
  **Telnyx explizit als getesteter Provider**) und lassen Orchestrierung, Gates, Disclosure und
  Transkripte im Haus. Das ist der Kontrollgewinn, den die Frage sucht, zu einem Bruchteil des
  Aufwands.

---

## 5. Kosten

| Variante | Ct/min |
|---|---|
| **heute live, Assistant-Pfad (n=21)** | **8,18** — Ankeranruf n=1: 9,42 |
| heute, Nicht-Assistant-Pfad | 5,4-8,2 |
| Eigenbau, gekaufte APIs + ElevenLabs Flash | 9-15 |
| Eigenbau, gekaufte APIs + Cartesia | 5-9 |
| Eigenbau, eigene GPUs, hohe Auslastung | 4,5-5,0 |
| Eigenbau, eigene GPUs, niedrige Auslastung | 10-50+ |
| Vapi / Retell / ElevenLabs Agents | 7-25 / 13-31 / 8-12 |
| Telnyx AI Assistant (Katalog) | 5,0-5,6 |

**Der Eigenbau ist kein Kostenargument.** Der beste realistische Fall (Cartesia-TTS, 5-9 Ct)
ueberlappt mit dem heutigen Pfad. Eigene GPUs lohnen erst ab dauerhaft >50-100 gleichzeitigen
Gespraechen je GPU — darunter ist Miete pro Aufruf strikt billiger.

**Die Marge ist das dringendere Problem, unabhaengig vom Stack** (gerechnet mit dem
n=21-Wert 8,18 Ct):

| Tarif | Erloes/min nach Stripe | Ist-Kosten/min | Marge |
|---|---|---|---|
| Starter 4,99 USD / 30 Min | 15,67 Ct | 8,18 Ct | **+7,49 Ct (48 %)** |
| Business 9,99 USD / 120 Min | 7,65 Ct | 8,18 Ct | **−0,53 Ct (−7 %)** |

Business ist bei Vollausschoepfung **heute schon defizitaer** — vor DID-Miete (wird nicht
gebucht, bekannter Bug), vor realen ElevenLabs-Kosten (Faktor 179 ueber dem gebuchten
Relay-Preis) und vor der Inbound-Luecke. Mit dem Ankeranruf-Wert 9,42 Ct waeren es −23 %; der
n=1-Wert taugt aber nicht als Rechengrundlage.

---

## 6. Skaliert das auf Millionen?

**Technisch ja, unspektakulaer.** Annahmen: 30 Min/Monat/Nutzer (volle Starter-Zuteilung,
bewusst hoch), 15 % Busy-Hour-Konzentration, Kapazitaet ≈ Erlang + 3·√Erlang:

| Nutzer | Busy-Hour-Erlang | Peak, gleichzeitige Gespraeche |
|---|---|---|
| 10.000 | 25 | ~40 |
| 100.000 | 250 | ~300 |
| 1.000.000 | 2.500 | ~2.700 |

Bei 8 kHz / 20 ms sind das 100 Frames/s je Leg, also ~270.000 Nachrichten/s telefonieseitig
bei 1 Mio Nutzern — eine Flotte aus mehreren Mehrkern-Instanzen, keine exotische
Groessenordnung. Grobe Infrastruktur: 2.000-4.500 USD/Monat. **Render ist fuer den
Realtime-Fall die schwaechste Wahl**; Fly.io, Hetzner oder AWS passen besser.

**Die echten Bremsen sind nicht technisch:**

1. **Nummernmiete: 1 USD/Monat × 1 Mio Tenants = 1 Mio USD/Monat.** Groesser als alle
   Minutenkosten zusammen. Wird heute nicht einmal gebucht. Eine Geschaeftsmodell-Frage
   (geteilte Nummern? Nummer erst ab Abo?), kein Stack-Thema.
2. Telnyx: Outbound 20 Anrufe/s je IP; Kanallimit ist Carrier-Verhandlung.
3. KYC/Regulatorik je Land vor Nummernaktivierung — kein API-Call.
4. STIR/SHAKEN + jaehrliche RMD-Rezertifizierung (USA), ab Mai 2026 KYUP; KI-Stimmen gelten
   unter TCPA als "artificial/prerecorded" (`disclosureSentence` deckt einen Teil ab).
5. **Die Inbound-Kostenluecke wird bei Millionen oeffentlich waehlbarer Nummern zum
   Missbrauchsvektor** — Inbound erreicht die Gate-Achse mit keiner Carrier-Kostenart.

### DSGVO — dringend, unabhaengig von der Stack-Frage

Der live laufende LLM-Anbieter ist seit 2026-08-11 **DeepSeek**. Keine bestaetigten
Uebermittlungsgarantien; die Berliner Datenschutzbeauftragte hat einen Verstoss gegen
Art. 46(1) DSGVO festgestellt — waehrend Hermes echte Anruftranskripte von EU-Anrufern
verarbeitet. Entscheidung faellig **vor** dem ersten fremden Kunden.

Ein Eigenbau ist hier nicht nur Komfort, sondern Hebel: Deepgram (EU GA) und AssemblyAI bieten
EU-Endpunkte, Telnyx ein explizites EU-Angebot; ElevenLabs-EU-Residenz ist Enterprise-only,
Anthropic direkt nicht (nur ueber Bedrock/Vertex Frankfurt).

---

## 7. Was zu tun ist — in dieser Reihenfolge

### 7.0 Zwei Pruefungen von Minuten, vor allem anderen

1. **DeepSeek-Guthaben.** Am 11.08. gemessen: `GET https://api.deepseek.com/user/balance` ->
   `is_available:false`, `total_balance "-0.00"`; alle 25 Experiment-Anfragen endeten mit
   **HTTP 402 `Insufficient Balance`** (`tasks/befund-toolwahl-6-experiment.md:1-30`).
   **Unbelegt ist nur, ob Render denselben Schluessel nutzt.** Falls ja, antwortet **jeder
   Turn** mit `turnErrorSpeech` — und "extrem schlechte Qualitaet" haette eine triviale,
   stack-fremde Erklaerung. Das ist die billigste denkbare Pruefung und gehoert vor jede
   weitere Ueberlegung.
2. **`TELNYX_AI_ASSISTANT_ENABLED` live.** `render.yaml:102` sagt `false`, zuletzt gemessen
   wurde `true` am 29.07. Kosten-, Margen- **und** Defektzuordnung haengen daran.

### 7.1 Die Kappung pfadunabhaengig messen — nicht per TeXML-Gegenmessung

Die erste Fassung empfahl, die Kappungsrate auf dem Budget-/TeXML-Pfad gegenzumessen. **Das
ist nachweislich untauglich** und wurde verworfen (Abschnitt 9). Stattdessen:

**Erzeugten Text gegen das aufgezeichnete Audio halten.** Recording wird auf beiden Pfaden
bebucht. Das misst, was das Ohr tatsaechlich bekam — statt eines Protokoll-Deltas — und
funktioniert auf TeXML, auf dem Assistant-Pfad und auf **jedem kuenftigen Stack** gleich.
Damit entsteht zum ersten Mal eine Messgroesse, die einen Stack-Vergleich ueberhaupt zulaesst.

Falls die Blackbox-Hypothese danach weiter im Raum steht, ist der direkte Test **nicht** der
Eigenbau, sondern ein **anderer fertiger Assistant** (Vapi, Retell, Deepgram Voice Agent — mit
Preisen und Latenzen in der Recherche): dieselbe Frage, in Tagen statt Monaten.

### 7.2 Den liegengebliebenen Owner-Beschluss ausfuehren (billiger als gedacht)

Modell-A/B fuer die Werkzeugwahl, beschlossen am 06.08. Die frueher genannte Huerde ist
**weg**: Commit `1b73809` (11.08.) hat die Bench-Messkette an Anbieter und Modell
herangefuehrt, `scripts/convo-bench.mjs` fuehrt `--llm-provider anthropic|deepseek` und
`--agent-model`. Nach drei gescheiterten Prompt-Runden die einzige ungeprobte Hypothese fuer
den groessten Block der (b)-Defekte. **Vorbedingung: 7.0 Punkt 1** — ein leeres Konto macht
jede Messung wertlos.

### 7.3 Die (a)-Defekte abraeumen (1-2 Wochen)

Handwerk, kein Forschungsprojekt: `silenced`-Verwurf, SMS-400, D-2-Race, Denksignal-Deckung,
`objective`-Kappung, `consultHoldSpeech`-Sie-Hardcode (ein Einzeiler, seit dem Kickoff offen).

### 7.4 Erst dann: den Seam schneiden, nicht den Stack tauschen

Reihenfolge: **RealtimeBackend-Port** (die KI-Seite austauschbar machen, wie `ports.js:248-250`
es heute ausdruecklich offenlaesst) -> **STT-Port** -> **TTS-Port**. Danach ist der Eigenbau
ein Adapter neben dem Bestand, mit Flag-Flip und Rueckweg — die Bauart, die in diesem Repo
zweimal funktioniert hat (Golden-Master in B3b und B5). **Kein Big Bang.** Und als Unterbau
zuerst LiveKit Agents / Pipecat pruefen, nicht VAD und SIP selbst schreiben.

### 7.5 Abbruchkriterium — vor Baubeginn festlegen

Bei 2-6 Monaten ist die wichtigste Governance-Frage: **woran erkennen wir, dass wir aufhoeren
muessen?** Vorschlag: nach Stufe 1 muss die pfadunabhaengige Kappungsmessung aus 7.1 auf dem
Prototyp **mindestens halbiert** sein, sonst wird abgebrochen. Ohne definiertes "gut genug"
ist ein Umbau weder begruendbar noch beendbar — und eine Judge-Score-Baseline fuer die heutige
Konfiguration existiert derzeit **nicht** (die letzte stammt aus Juli auf Haiku 4.5, nicht auf
DeepSeek).

---

## 8. Offene Punkte, die nur der Owner klaeren kann

1. DeepSeek-Guthaben und ob Live denselben Account nutzt (7.0).
2. `TELNYX_AI_ASSISTANT_ENABLED` live (7.0).
3. DeepSeek und DSGVO — vor dem ersten fremden Kunden (Abschnitt 6).
4. Nummernmiete im Geschaeftsmodell (6.1) — 1 Nummer je Tenant traegt bei Millionen nicht.
5. Business-Tarif ist bei Vollnutzung defizitaer (Abschnitt 5).

---

## 9. Was die Gegenlesung korrigiert hat

Die erste Fassung wurde adversarial gegengelesen; jeder Treffer ist einzeln am Code
nachgeprueft. Korrigiert wurden:

| Punkt | erste Fassung | nachgeprueft |
|---|---|---|
| **Hauptempfehlung** | Kappungsrate auf dem TeXML-Pfad gegenmessen | **verworfen.** Das Werkzeug schliesst den Budget-Pfad im eigenen Kopfkommentar aus (*"Anrufe der Budget-Engine sind NICHT messbar"*), und TeXML spielt eine **vorab synthetisierte Datei** ab (`adapters/telnyx/render.js`, `renderPlay`) — ein Praefix-Abbruch kann dort konstruktionsbedingt nicht entstehen. Ein Ratenabfall waere garantiert und wuerde nichts belegen. Ersetzt durch 7.1. |
| Aufwand | 5-9 Monate | **2-6 Monate.** Der Anker war falsch: Track B lief ~4 Kalendertage, nicht zwei Wochen. |
| Schicht (c) | 2 Defekte, Tabelle summierte auf 19 | **4**, Summe 21 |
| Config-Gewinne | zwei bestaetigt, Schwelle "0.4 -> 0.2" | **einer.** Richtung war 0.2 -> 0.4 (09.08.), der Gewinn ist widerlegt |
| Werkzeugwahl | "0/5" | 0/5 als Zaehlung korrekt, Lesart ueberzeichnet: **2/5 klar, 1/5 schwach** |
| Marge | 9,42 Ct (n=1) -> Business −23 % | **8,18 Ct (n=21) -> −7 %** |
| Bench-Huerde | kann nicht gegen zwei Anbieter messen | **behoben** seit `1b73809` |
| DeepSeek-Guthaben | nicht erwaehnt | **7.0, vor allem anderen** |
| 71-%-Argument | trug das Urteil | **entschaerft:** zaehlt Koepfe, nicht Lautstaerke (1.1) |

**Nicht uebernommen:** die Ruege, "~3,5 Mio Token" sei erfunden — die Zahl steht woertlich in
der Sitzungs-Memory `gespraechsqualitaet-kickoff.md`, die der Gegenleser nicht durchsucht hat.

---

## Anhang: Belegstatus

Am Code oder an Messungen dieses Repos belegt: Abschnitte 1, 2.1, 2.2, 5 (Ist-Kosten, Tarife),
7.0, 9. Primaerquellen-Recherche mit URL und Datum (volle Listen in den Erhebungsberichten):
Abschnitte 4 (Turn-Detection, DTMF, 8-kHz-WER), 5 (Fremdpreise), 6 (Regulatorik,
Infrastruktur, DSGVO). Eigene Schaetzung mit offengelegten Annahmen: 2.3 (Aufwand), 6
(Nebenlaeufigkeit). **Nicht belegbar** war: ein namentlicher Fallbericht eines Wechsels
Plattform -> Eigenbau oder umgekehrt — es gibt nur generische Vergleichsartikel ohne
Attribution.
