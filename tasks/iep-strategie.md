# IEP - Inbound-Erlebnis-Paritaet: Strategie

Stand 2026-09-16. Nachfolger der IEX-Kette (A1..A11 gemergt, HEAD `52530ce`).
Anlass: Owner-Test #2 am 2026-09-15 durchgefallen ("absolute Katastrophe").
Notaus laeuft: `ELEVENLABS_INBOUND_ENABLED=false`, Banner "Inbound-EL: aus, 1 Tenants, scope=allowlist".

Quellen dieser Strategie: vier Forensik-Berichte (EL-Conversation, SIP/Telnyx, Init/Prompt,
Telnyx-CDR), `tasks/iex-spec-a.md`, `tasks/iel-spec.md`, `tasks/iel-cutover-protokoll.md`,
`tasks/iel-m1-messung.md`, `PLAN-SECURITY.md`, und Nachmessungen am Code (HEAD `52530ce`).
Jede Aussage traegt Quelle und Sicherheitsstufe: **belegt** | **indiz** | **unbelegt**.

---

## 1. Ziel und Abnahme der ganzen Kette

**Owner-Ziel:** eingehende Anrufe laufen ueber denselben ElevenLabs-Agenten wie ausgehende UND
klingen genauso gut. Reihenfolge: (1) Inbound auf EL, (2) Owner-Testanruf klingt wie Outbound,
(3) erst dann Budget-Engine loeschen.

**Woran der Owner misst** - drei Dinge, in dieser Rangfolge:

1. **Kein Anrufer hoert je etwas anderes als Hermes.** Das ist der wichtigste Punkt der ganzen
   Kette (Owner ausdruecklich). Bei Test #2 hoerte er eine englische Ansage ("call could not be
   completed") mit Rauschen, dann Klingeln, dann erst den Agenten.
2. **Der Agent klingt nicht duemmer als im Outbound.** Test #2: 3 Agent-Turns, letzter
   unterbrochen, Anrufer legte nach 49 s auf. Test #1: 5 Agent-Turns, sauberes `end_call` nach 59 s.
3. **Ruft der Owner von seiner eigenen Nummer an, wird er als Owner begruesst** - die
   KI-Kennzeichnung bleibt dabei immer.

### Das Abnahmeversprechen - bewusst kleiner als die Owner-Hoffnung

Unser Einfluss beginnt beim INVITE an Telnyx und endet an Telnyx' eigener Kante. Die Kette
verspricht deshalb NICHT "die Ansage ist weg", sondern:

> **Unsere Seite schweigt beweisbar, ab dem 200 OK gehoert die Leitung Hermes, und das
> unbeantwortete Fenster ist kuerzer als in Test #1, den der Owner gut fand.**

Wer mehr verspricht, verliert den dritten Test. Der Fall "Kette maschinell gruen, Owner hoert die
Ansage trotzdem" wird VOR dem Test benannt (Abschnitt 4) und ist dann eine Grenze unserer
Verantwortungsflaeche, kein Scheitern der Kette.

### Die eine Bauregel der Kette

**Kein Fix ohne Ohrzeugen.** Jede Phase muss ihren Erfolg belegen koennen, BEVOR ein Mensch
anruft. Ein Fix ohne Ohrzeugen ist eine Behauptung. Umgekehrt gilt: eine Messung, die den
falschen Weg misst, ist schlimmer als keine - sie erzeugt falsche Sicherheit.

---

## 2. Belegt, Indiz, ausserhalb unseres Einflusses

### 2.1 Belegt - und tragend fuer die Reihenfolge der Kette

| # | Aussage | Quelle |
|---|---|---|
| B1 | **Zwischen Test #1 und #2 aenderten sich 39 Dateien / 1450 Einfuegungen in `src/`**, davon 22 direkt auf dem Inbound-/EL-Pfad. Test #1 lief auf `9917db7` (`dep-dakes3h5efls73dp68p0`), Test #2 auf `52530ce` (`dep-dakqfu1594qs73977edg`). | `git diff --stat 9917db7 52530ce -- src/`; `tasks/iel-cutover-protokoll.md:3,:53` |
| B2 | **Die Eroeffnungsquelle wurde ausgetauscht.** In Test #1 war `first_message` die GESPEICHERTE Tenant-Begruessung ohne Pflichtsatz-Praefix (`begruessungOhnePflichtsatz({greeting: gespeicherteBegruessungFuer(...)})`, `9917db7:src/elevenlabs/inbound-initiation.js:139`). Heute ist sie ein generischer Vorlagensatz `bundle.inboundEroeffnung(ownerName)` (`src/elevenlabs/inbound-initiation.js:139`). | `git show 9917db7:src/elevenlabs/inbound-initiation.js`; HEAD `inbound-initiation.js:135-139` |
| B3 | **In Test #1 sprach UNSER Server den Pflichtsatz per TeXML-Play vor dem Dial**, mit Transkriptzeile; seit IEX-A3 spricht er gar nichts mehr vor dem Dial. | `git diff 9917db7 52530ce -- src/routes/voice.js` (entfernt: `store.addTranscript(call.id,"agent",locale.inboundNotice)`, `pflichtsatz:{...}`) |
| B4 | Das Anrufer-Bein war in #2 **1,56 s unbeantwortet** (`call_initiated` 20:32:41.815 -> `call_answered` 43.375). In #1 kam die Annahme 1,03 s nach `call_initiated`. | forensik-d §1, §2 (`list_call_events`) |
| B5 | `EL_DIAL_ANSWER_ON_BRIDGE = true` ist eine harte Code-Konstante ohne Env-Schalter; der Renderer setzt das Attribut nur bei ausdruecklichem `true`. | `src/elevenlabs/inbound-rueckfall.js:35`, `:114`; `src/telephony/adapters/telnyx/render.js:174-177` |
| B6 | **Telnyx hat in #2 auf keinem Bein Audio erzeugt**: 12 Session-Ereignisse, kein `playback_start`, kein `speak`, kein Ringback-Kommando, alle `failed:false`. | forensik-d §1 |
| B7 | **ElevenLabs schickte kein Early Media**: `180 Ringing` OHNE SDP, Medien erst mit dem `200 OK`. Gleiches Bild in #1. | forensik-b §1, §2 (`sip-messages`) |
| B8 | Telnyx sah im Fenster **genau EIN INVITE**, keine Wiederholung, kein zweiter Inbound-Leg. | forensik-d §4 |
| B9 | **Auch Test #1 hatte ein Klingeln** - von TELNYX erzeugt: `playback_start tone_stream://%(2000,4000,440,480)`, ~1,1 s US-Freiton auf dem bereits beantworteten Bein. Der Owner berichtete es nicht. | forensik-d §2 |
| B10 | Keine Konfigurationsaenderung zwischen #1 und #2: TeXML-App `updated_at` 2026-07-02, DID 2026-07-20, ein einziger Audit-Eintrag NACH beiden Anrufen. EL-seitig aenderte sich nur `first_message`. | forensik-d §5; forensik-c §2 |
| B11 | **Kein Repo-Skript waehlt je eine Telefonnummer** ("Keine Telefonnummer wird je gewaehlt"). `convo-bench` ist fuer den EL-Pfad blind (einziger Treiber TeXML/Gather). `stt-wer.mjs` und `telnyx-call-latency.mjs` haengen an Telnyx' eigener `/v2/ai/conversations`-Ressource, die bei einer Bruecke zu EL nicht entsteht. | `scripts/iel-mess.mjs:24-25`; `scripts/convo-bench/driver-texml.mjs:44-58`; `scripts/stt-wer.mjs:55,328-334` |
| B12 | **Es existiert kein Audio von #2** (EL `record_voice=false` seit A5, Telnyx `call_recording` an der DID aus seit 2026-07-20). Jede Aussage ueber "Stimme schlechter" ist heute unbeweisbar - in beide Richtungen. | forensik-c §2, §6; forensik-d §5 |
| B13 | **IEX-A12 ist NICHT gemergt**: `billsCalibratedInboundRate` steht weiterhin in `src/billing/metering.js:59`. Die Spec nennt "IEX-A12 gemergt" als Rollout-Vorbedingung. | `src/billing/metering.js:55-61`; `tasks/iex-spec-a.md` §7(b) |
| B14 | Der Eroeffnungs-Riegel prueft VIER Dinge und laeuft ZWEIMAL (vor der Bindung und am fertigen Antwort-Koerper): Namenssatz-Anfang, Hinweis woertlich, KI- UND Transkriptions-Marker, kein `{{`. | `src/i18n/inbound-opening.js:22-33`; `src/routes/webhooks-elevenlabs-init.js:213-215,:239-241` |
| B15 | Die Outbound-Owner-Eroeffnung `Hallo {Vorname}, hier ist dein KI-Assistent.` faellt an drei dieser vier Pruefungen durch - ohne eigene Sollform antwortet der Init-Webhook 404, keine Bindung, Fehlersatz. | `src/i18n/locales.js:274` gegen `inbound-opening.js:22-27` |
| B16 | Die Werkzeug-Sperre fuer Inbound ist **serverseitig und dreifach**, nicht Prompt-Kosmetik: `consult` verlangt `call.direction === "outbound"`, die Recherche ebenso an zwei Stellen, motorunabhaengig auch in der Budget-Engine. | `src/routes/webhooks-elevenlabs.js:429`; `src/research/in-call.js:51`; `src/research/registry.js:97`; `src/claude.js:633` |
| B17 | **Die Diagnose-Retention haengt am nackten Nummern-Vergleich OHNE Schalter und OHNE Allowlist** - bewusst so, damit ein Flag-Flip sie nicht still abschaltet. | `src/diagnostic-retention.js:56-68` |
| B18 | Die hinterlegte eigene Nummer ist nur Format-, Denylist- und land-validiert, NICHT eigentums-verifiziert, und von jedem eingeloggten Tenant setzbar. | `src/store/state-ops.js:2547-2555`; `src/self-service-routes.js:493-512`; `PLAN-SECURITY.md:3500-3531` |
| B19 | STIR/SHAKEN taugt nicht als Haertung: beide Inbound-Legs Attest **"C"** (Gateway, schwaechster Grad), `shaken_stir_enabled` an der TeXML-App `false`, das Attest erst im CDR nach dem Anruf sichtbar, im Code nirgends gelesen. | forensik-d §3, §5; `grep` in `src/` = 0 Treffer |
| B20 | Zaehlerstand: `m1` **5/5 erschoepft**, `nachdeploy` **2/3** (ein Anruf Reserve). Telnyx-Kosten: Inbound-Bein #2 0,0032 USD bei 60 abgerechneten Sekunden, EL-Bein 0 USD, alle fuenf M1-Anrufe zusammen 0,02 USD. | `tasks/iel-m1-zaehler.json`, `tasks/iel-nachdeploy-zaehler.json`; forensik-d §3 |
| B21 | Das gemeinsame Mess-TeXML setzt heute VOR und NACH dem Dial je ein `<Say>` (Pflichtsatz, Rueckfallsatz). | `scripts/iel-mess-anbieter.mjs:82-91` |
| B22 | Der Dienst deployt NICHT automatisch (`autoDeploy: no`); `git push origin` ist wirkungslos, deployt wird der Upstream-Stand. Ein Env-Wechsel auf Render ist selbst ein Deploy. | `mcp__render__get_service srv-d8m0fhflk1mc73bno570`; `tasks/iel-cutover-protokoll.md:22`; Memory `deploy-repo-split` |

### 2.2 Indiz - nicht als Beleg behandeln

| # | Aussage | Quelle |
|---|---|---|
| I1 | **Von fuenf moeglichen Tonquellen im Fenster INVITE -> Annahme scheiden vier am Beleg aus** (kein Verb vor dem Dial, kein Telnyx-Playback-Event, EL `180` ohne SDP, genau ein INVITE). Uebrig bleibt das Netz VOR Telnyx. | Ableitung aus B6-B8 |
| I2 | Eine sofortige Annahme wuerde das von UNS verantwortete Fenster von 1,56 s auf ~0,6 s senken (`call_initiated` 41.815 -> unser `dial`-Kommando 42.432). | forensik-d §1, Ableitung |
| I3 | Ein Ansage-Ton, den das Netz des Anrufers Richtung Anrufer spielt, durchquert Telnyx nie und ist in keinem CDR und keinem Event sichtbar. | forensik-d §3 Anm. 2, §7 Punkt 1 |
| I4 | Der Medien-Unterschied (Inbound G722 mit Transcodierung PCMU<->G722, Outbound PCMU ohne) ist ein Kandidat fuer den STEHENDEN Abstand zu Outbound - er bestand in #1 und #2 gleich und erklaert die Regression NICHT. | forensik-b §1/§3; forensik-d §3; `src/elevenlabs/nummern-registrierung.js:31,:47-53` |

### 2.3 Unbelegt - und die Kette haengt daran

| # | Annahme | Wer traegt sie |
|---|---|---|
| U1 | Dass ein `<Dial>` als ERSTES Verb mit weggelassenem `answerOnBridge` ein EINGEHENDES Bein sofort beantwortet. Belegt ist nur der Anbieter-Default; alle M1-Messungen liefen auf bereits beantworteten Beinen. | IEP-P2 vollstaendig |
| U2 | Dass ein Medien-Verb vor dem Dial spielbar ist, ohne den Dial zu verschieben. TeXML ist sequenziell. | IEP-P2 Fensterbesetzung |
| U3 | Dass Telnyx `record="record-from-ringing-dual"` in diesem Konto akzeptiert (dokumentiert, nie benutzt). | IEP-P1 - entschaerft, s. dort |
| U4 | Dass die EL-Conversation-API Turn-Latenzen und Beendigungsgrund ueberhaupt liefert. | IEP-P3 |
| U5 | Dass eine per Override gesetzte `first_message` genauso unterbrechungsgesperrt ausgeliefert wird wie die Agenten-eigene (Messfrage **M-U1**). Betrifft JEDE Eroeffnungsvariante, auch die heute laufende. | IEP-P6 und der Owner-Test |
| U6 | Dass die From-Angabe des Providers immer E.164-formig ankommt. n=7, ein Anrufer, ein Ingress-Peer. | IEP-P5 - fail-closed aufgeloest |
| U7 | Dass die ElevenLabs-Gespraechsminuten fuer die Mess-Laeufe unerheblich sind. In keiner Quelle beziffert. | Budgetfrage F2 |

### 2.4 Ausserhalb unseres Einflusses

- **Die SIP-Ladder am Telnyx-Eingang** (180 ohne SDP gegen 183 mit SDP Richtung Carrier) ist ueber
  keinen Telnyx-API-Endpunkt erreichbar - nur Portal-Debugger oder Support, mit unbestimmter
  Antwortzeit und dem moeglichen Ausgang "unentscheidbar" (forensik-d §7 Punkt 1). Laeuft als
  **kostenlose Parallelspur ohne Blockwirkung**.
- **Ursprungsnetz, Besuchsnetz beim Roaming und Transit-Carrier** liefern keine Daten. Ein dort
  entstandener Ton bleibt fuer jede unserer Messungen unsichtbar (I3).
- **Nicht Teil des Auftrags, in keiner Form:** Rufnummernwechsel, Nummernkauf, +49-DID. Dieselbe
  US-Nummer klingt im Outbound-Betrieb einwandfrei; die Ursache liegt im eingehenden Weg, den WIR
  verantworten.

---

## 3. Die Phasen in Reihenfolge

Leitgedanke: **der Anrufer bewertet die ersten zwei Sekunden**, also wird in der Reihenfolge des
Hoerens gebaut. Wo die Ohr-Reihenfolge und die Abhaengigkeit sich widersprechen, gewinnt die
Abhaengigkeit (deshalb steht das Beleg-Werkzeug P3 vor den Gespraechsphasen).

**Deploy-Regel fuer jede Phase mit Nachher-Messung** (B22): `git push upstream master` ->
`mcp__render__trigger_deploy` auf `srv-d8m0fhflk1mc73bno570` -> `list_deploys` (Commit =
master-HEAD) -> Boot-Banner im Log. **Ohne diesen Lesebeleg gilt keine Nachher-Zahl.** Ein
Wechsel von `ELEVENLABS_INBOUND_ENABLED` ist selbst ein Deploy und wird genauso belegt.

**Ausfuehrungs-Regel:** Bau und Tests laufen im Workflow-Agenten. **Jeder Anruf und jede
Anbieter- oder Env-Aenderung ist ein Einzelbefehl im Lead** - ein Subagent wird fuer
Prod-Aenderungen immer vom Classifier geblockt (Memory `classifier-blockt-testanrufe`).

---

### IEP-P0 - Hoerbeleg am Hoerer und Delta-Tabelle

**Ziel:** Vor jeder Code-Aenderung entscheiden, ob die Roboter-Ansage ueberhaupt in dem Fenster
entsteht, das wir reparieren koennen - und die vollstaendige Liste dessen, was sich zwischen dem
guten und dem schlechten Anruf geaendert hat. Kein Code, kein Deploy, kein Flag-Flip, null Kosten.

**Warum diese Phase existiert:** Die Kette haette sonst mit einer falschen Praemisse begonnen.
Zwei Befunde erzwingen sie:

1. Der Owner hoerte Ansage -> Rauschen -> Klingeln -> Agent. Das von uns verantwortete Fenster war
   1,56 s lang (B4). Eine englische Intercept-Ansage dauert allein 2-3 s; Ansage plus Rauschen
   plus Klingeln passen **arithmetisch nicht** in 1,56 s. Die Ansage lag also sehr wahrscheinlich
   VOR dem INVITE, den Telnyx sah - und dort aendert eine Annahme-Umstellung nichts.
2. Die Praemisse "unsererseits aenderte sich nur `answerOnBridge`" ist **widerlegt** (B1, B2, B3).

**Inhalt:**

1. **Tonmitschnitt am Hoerer** (Owner oder eine zweite Person am selben Netz/Handy): 5-10 Waehlvorgaenge
   auf die DID mit laufendem Mitschnitt (zweites Telefon, Sprachmemo, Freisprechen). Je Versuch
   notiert: Ansage ja/nein, Wortlaut, Position relativ zum Klingeln, Sekunde des Waehlens.
   Der Notaus bleibt AUS - die Ansage entsteht vor der Annahme, die Engine dahinter ist irrelevant.
2. **Delta-Tabelle Test #1 -> Test #2** (rein lesend, null Anrufe): `git diff 9917db7 52530ce --`
   ueber `src/elevenlabs`, `src/routes/voice.js`, `src/routes/webhooks-elevenlabs-init.js`,
   `src/i18n`, `src/telephony` vollstaendig durchgehen. Jede verhaltenswirksame Aenderung am
   Anrufer-Erlebnis in eine Zeile: was hoert der Anrufer, was sieht das Modell, was aendert sich
   am Medienweg. Zwei Eintraege stehen schon fest (B2, B3).
3. **Parallelspur, blockiert nichts:** Portal-Debugger-Auszug bzw. Telnyx-Support-Anfrage zur
   SIP-Ladder von Test #2 (`call_session_id 999fb000-b144-11f1-a712-02420a1f0b70`,
   `sip_call_id 235572679_73059313@206.147.72.190`, Gegenprobe #1
   `a0b44e1a-b0da-11f1-9413-02420a1f0a70`). Vier Fragen: 180 ohne SDP oder 183 mit SDP Richtung
   Carrier, eigene Early-Media-Erzeugung durch Telnyx, Upstream-Carrier/OCN, weitere INVITEs
   derselben Anrufernummer in den 60 s davor. Erfolgskriterium ist nicht "Ursache gefunden",
   sondern "jede Frage mit ja/nein/unbekannt beantwortet".

**Abnahme:** (a) Mitschnitt liegt vor, die drei Ausgaenge sind unterschieden:
- **(A) Ansage reproduzierbar und VOR dem Klingeln** -> IEP-P2 ist nicht der Fix. P2 schrumpft auf
  eine Hygiene-Phase ohne Abnahmelast, die Kette besteht aus P1, P3, P4, P5, P6, P7 plus
  Carrier-Spur.
- **(B) Ansage nicht reproduzierbar** -> Einmalereignis. P2 wird gebaut, aber nicht als Antwort auf
  die Ansage verkauft.
- **(C) Ansage NACH dem Klingeln** -> P2 trifft, mit Beweis, und behaelt die volle Abnahmelast.
(b) Delta-Tabelle vollstaendig, jede Zeile mit Datei:Zeile. (c) Die Eintraege B2/B3 stehen darin
mit ihrer Owner-Entscheidungsfrage (s. F7).

**Maschinelle Messung ohne Owner-Anruf:** Teil 2 und 3 vollstaendig. Teil 1 braucht ein Telefon,
aber KEINEN Owner-Testanruf im Sinne des Zaehlers: es wird nicht bewertet, ob Hermes gut ist -
es wird nur gehorcht, was vor dem Abheben passiert, und kann jederzeit abgebrochen werden.

**Risiko:** Der Owner muss selbst waehlen. Das ist kein Testanruf im Sinne der Sperre ("kein
Owner-Testanruf, bevor ein Fix belegt ist"), sondern eine Diagnose-Aufnahme - das gehoert ihm
gegenueber ausdruecklich so gesagt, sonst fuehlt es sich wie Test #3 an. Zweitens: dieselbe
Owner-Erinnerung, die die Reihenfolge liefert, hat in Test #1 ein messbar vorhandenes Klingeln
nicht berichtet (B9) - der Mitschnitt ersetzt die Erinnerung, er ergaenzt sie nicht.

**Rueckweg:** Keiner noetig - es wird nichts geaendert.

**Betroffene Dateien:** keine. Ergebnis: `tasks/iep-p0-delta.md` (neu).

---

### IEP-P1 - Der Ohrzeuge

**Ziel:** Ein maschineller Ohrzeuge, der auf unsere eigene DID anrufen und hoeren kann, was ein
Anrufer ab der Klingelphase hoert - plus eine Vorher-Aufnahme des heutigen Stands. Kein
Produktionscode, kein Owner.

**Warum vorn:** Es gibt heute kein Werkzeug, das hoert (B11), und von Test #2 existiert kein Audio
(B12). Ohne P1 hat keine spaetere Phase eine Abnahme.

**Inhalt - Reihenfolge ist Teil der Phase:**

1. **Lesend belegen, bevor irgendetwas gebaut wird** (Bestandsregel "erst GET + Snapshot, dann
   patchen"): vollstaendiger Koerper der TeXML-Application, der zugeordneten Connection und des
   Voice-Profiles. Zweck: Schnappschuss-Basis plus zwei Fragen, die P2 braucht - (a) gibt es an
   dieser Connection einen Ringback-Schalter (die FQDN-Connection des Outbound-Wegs hat
   `generate_ringback_tone=false`, ein Gegenstueck an der TeXML-App ist im dokumentierten Schema
   nicht vorhanden), (b) welches Feld setzt die SDP-Angebotsliste des Dial-Beins (die App fuehrt
   `inbound.codecs` "G722, G711A, G711U, VP8, H.264", angeboten wurde "PCMU, PCMA, G729, G722,
   AMR, AMR-WB" - beides deckt sich nicht). Ergebnis ist ein Befund, keine Aenderung.
2. **Ohrzeuge bauen** (nur `scripts/`, `test/`, `tasks/`): neue Fall-Gruppe `ohrzeuge`. Topologie
   bleibt die bestehende TeXML-Bruecke; geaendert wird nur das TeXML-Dokument des Mess-Beins:
   `<Dial><Number>eigene DID</Number></Dial>`.
3. **Aufnahme ueber den erprobten Weg**, nicht ueber den unerprobten: das Mess-Bein wird per
   Call-Control angenommen und mit `record_start` (dual) aufgezeichnet - dieser Weg laeuft bereits
   produktiv (`scripts/iel-mess.mjs:548-557`). Weil dieses Bein VOR dem Dial beantwortet ist,
   erfasst es die gesamte Klingel- und Ansageperiode des gewaehlten Beins ohnehin.
   `record="record-from-ringing-dual"` wird hoechstens als Gegenprobe gefahren. **Damit entfaellt
   die unbelegte Annahme U3 als Traeger der Beweisfuehrung.**
4. **Eigener TeXML-Bauer ohne die beiden `<Say>`-Verben** (B21) - sonst ist der Anrufer-Kanal von
   Sekunde null mit unserem eigenen Ton belegt und die Kennzahl "Fremdton vor der ersten
   Hermes-Silbe" misst nichts. Golden-Test pinnt: das Dokument enthaelt genau ein Verb.
5. **Sprechspur:** ein vorab gerenderter Anrufer-Text wird per `playback_start` in den laufenden
   Anruf gespielt, dieselbe Datei fuer alle Laeufe. Ohne sie gibt es keinen kontrollierten
   Anrufer-Text, und die Wirkungsbelege in P4 waeren nicht ausfuehrbar.
6. **Zielsperre - vier Riegel, alle fail-closed.** Die Bestandssperre ("Keine Telefonnummer wird
   je gewaehlt", B11) bleibt fuer `m1` und `nachdeploy` byte-gleich bestehen; die neue Gruppe
   bekommt einen eigenen, ENGEREN Pruefer:
   - **Ziel** ist EINE gepinnte Konstante (Env-Schluessel bzw. Feld im Fall-Schema mit
     hartkodiertem Erwartungswert), **nicht** aus dem Nummern-Inventar abgeleitet - das Inventar
     listet alle bei EL registrierten Nummern des Kontos und **waechst mit dem Rollout auf
     Kunden-DIDs**. Zusaetzlich muss das Ziel die DID des ausdruecklich gepinnten Mess-Tenants
     sein. Kein Kommandozeilen-Argument, kein Praefix-Match, leere Trefferliste = Verweigerung.
   - **`OUTBOUND_FROZEN`**: steht der Notaus, verweigert die Gruppe vor dem Senden. Der
     Ohrzeuge waehlt eine echte Nummer, laeuft aber NICHT durch `src/telephony/outbound-gates.js`
     (der direkte `POST /v2/texml/calls` umgeht die 18-stufige Gate-Kette). Ohne diesen Riegel
     haette der Kill-Switch eine Luecke - CLAUDE.md Regel 1.
   - **Denylist**: `isDenied` aus `src/telephony/number-denylist.js`, DIESELBE Quelle wie die
     Gate-Kette, kein Nachbau - auf Ziel UND Absender.
   - **Absenderkennung** ist Pflichtfeld und hart auf eine DID des eigenen Kontos geprueft (heute
     laesst `pruefeAnruferKennung` jede E.164-Form zu, `scripts/iel-mess.mjs:308-310`). Absender
     ist eine der nicht-Owner-DIDs des Kontos, nie die Owner-DID (Selbstanruf = nie gemessene
     Sonderkonfiguration), und nie eine Nummer, die in irgendeinem `private_number`-Feld steht.
     `callerId` wird am Dial ausdruecklich gesetzt, nicht vom A-Bein geerbt.
   - **Kein Anbieter-Schreibzugriff:** die Gruppe hat kein `setup`, kein `teardown`, keine
     Registrierungs-Aenderung. Die Ziel-DID ist von jeder Wegwerf-/Aufraeum-Logik ausgenommen.
7. **Zaehler und Kopfraum:** eigene Gruppe `tasks/iel-ohrzeuge-zaehler.json` nach exaktem
   Bestandsmuster (erhoeht VOR dem Senden, verweigert ab Deckel, fehlende Datei = Verweigerung,
   eigene Sperrdatei). `m1` und `nachdeploy` werden nicht gelesen und nicht geschrieben. Die
   60-s-Stufen gelten unveraendert. **Vor dem ersten Lauf** ein lesender Kopfraum-Check gegen die
   pro-Tenant-Kostendecke (sie sperrt Inbound HART, `src/routes/voice.js:532`) mit Abbruchschwelle.
   **`smsSummaryOptIn` des Tenants fuer das Messfenster auf false** - sonst feuert nach JEDEM Lauf
   eine echte Summary-SMS samt Kostenbuchung (`src/telephony/call-finish.js:362-375`).
8. **Auswertung** (`scripts/iel-mess-belege.mjs` erweitern): dual-kanaliges WAV, RMS-Fenster 20 ms
   auf dem Anrufer-Kanal, Bestands-STT (`scribe_v1`, `werteMitschnittAus`), `list_call_events`
   beider Beine. Sieben Kennzahlen je Lauf: (i) `call_initiated` -> `call_answered` in ms,
   (ii) Fremdton vor der ersten Hermes-Silbe ja/nein, (iii) `playback_start`/`tone_stream` im
   Anrufer-Bein ja/nein, (iv) ms vom 200 OK bis zur ersten Agenten-Silbe (**M-S2**, bis heute
   ungemessen), (v) laengstes Stille-Segment >= 200 ms ab der Annahme, (vi) Luecke je Turn,
   (vii) Energieverteilung oberhalb ~3 kHz und Grundrauschen (die objektive Klangkennzahl fuer
   den Vergleich inbound gegen outbound - CDR-`mos` ist in ALLEN Beinen konstant 4,4897 und
   taugt nicht).
9. **Kalibrierung - eigener Abnahmepunkt, vor jeder Verwendung in P2:** der Vorher-Lauf laeuft
   gegen den unveraenderten Stand, und jede Kennzahl wird gegen die BEREITS VORLIEGENDEN
   `call_events` der echten Anrufe #1 und #2 gehalten (1,56 s Fenster in #2; 1,03 s und 1,1 s
   `tone_stream` in #1). **Reproduziert der on-net-Lauf diese Werte nicht in derselben
   Groessenordnung, ist die Kennzahl als Abnahmemass ungeeignet** und wird aus P2 und P7
   gestrichen - sie dient dann nur noch als Regressionswaechter fuer unsere eigene
   TeXML-Struktur. Grund: der Ohrzeuge laeuft Telnyx-intern, der echte Inbound kam ueber einen
   Ingress-Peer mit LRN-Routing und Carrier-Codec-Aushandlung.
10. **Vorher-Lauf** gegen den Live-Stand. Voraussetzung: `ELEVENLABS_INBOUND_ENABLED` befristet
    wieder AN. **Der Vorher-Lauf laeuft VOR dem ersten Phasen-Merge**, solange der laufende Deploy
    nachweislich der Stand des durchgefallenen Tests ist; Commit des laufenden Deploys wird vor
    und nach jedem Flag-Flip protokolliert (B22).

**Abnahme:**
(a) Rotprobe der Zielsperre: eine Ziffer Abweichung, nationale Schreibweise, Praefix-Treffer und
**eine zweite Nummer im Inventar** werden abgewiesen; Vergleich auf Praefix aufweichen -> mindestens
ein Fall wird rot.
(b) Rotprobe der drei anderen Riegel: `OUTBOUND_FROZEN=true` -> Verweigerung; Denylist-Treffer ->
Verweigerung; fiktive oder fremde Absenderkennung -> Verweigerung.
(c) **Positiv-Kontrolle des Auswerters** gegen eine Attrappe mit bekanntem Fremdton und bekannter
Stille - ein Auswerter, der nichts findet, sieht sonst aus wie ein sauberer Lauf (Bestandslehre
`pruefkommando-ohne-positiv-kontrolle`).
(d) Zaehler erhoeht vor dem Senden, verweigert am Deckel.
(e) Golden-Test: das Mess-TeXML enthaelt genau ein Verb (kein `<Say>`).
(f) Ein Vorher-Lauf liegt vor: WAV anhoerbar, alle sieben Kennzahlen beziffert - insbesondere
M-S2, das damit erstmals eine Zahl hat.
(g) **Kalibrierungs-Urteil** aus Schritt 9 steht im Bericht: welche Kennzahl Abnahmekraft hat und
welche nicht.
(h) Befund aus Schritt 1 im Bericht (Ringback-Schalter vorhanden/nicht vorhanden, Codec-Feld
benannt/unbelegt).
(i) Kopfraum-Zahl vor und nach der Messrunde dokumentiert; `smsSummaryOptIn`-Zustand mit
Zeitstempel.
(j) `npm test -- --test-concurrency=4` gruen.

**Maschinelle Messung ohne Owner-Anruf:** Der Lauf IST die Messung. Ohne jeden Anruf pruefbar:
alle vier Sperren, Zaehler, Auswerter-Positivkontrolle, TeXML-Struktur (Golden, in-process) und
ein `curl`-Durchlauf von `/voice/incoming` mit `SKIP_TWILIO_SIGNATURE_CHECK=true`.

**Risiko:**
1. **Reichweite - der Pre-Mortem-Hauptfehler der Kette:** der Ohrzeuge laeuft on-net, ohne
   deutschen Mobilfunk, ohne Roaming, ohne Transit-Carrier. Er kann die englische Ansage weder
   reproduzieren noch ausschliessen. Wer sein Gruen als "Ansage beseitigt" liest, faellt beim
   naechsten Owner-Test erneut durch. Der Grenz-Satz ist deshalb Bestandteil der Abnahme, nicht
   des Vorworts.
2. Jeder Lauf ist ein **echter Produktions-Inbound**: Anruf-Datensatz, Buchung auf die
   Tenant-Decke, Inbox-Eintrag, Zusammenfassung, sichere Summary-SMS - genau der Grund, aus dem
   Fall N3 nie gebaut wurde (`scripts/iel-mess.mjs:5-9`).
3. Die neue Zielsperre ist die einzige Stelle der Kette, an der eine bestehende Sicherung
   erweitert wird. Ein zu grosszuegiger Pruefer waehlt einen Dritten an - deshalb gepinnte
   Konstante plus Tenant-Pruefung plus Rotprobe.
4. Der Notaus wird fuer den Vorher-Lauf befristet geoeffnet - **Zuruecksetzen auf `false` ist ein
   Abnahmepunkt**, keine Aufraeumnotiz: Boot-Banner mit Zeitstempel des Oeffnens und des
   Schliessens in den Bericht.
5. Aufnahmen liegen beim Anbieter (die M1-Mitschnitte liegen heute noch dort) - Loeschbeleg
   gehoert in den Phasenbericht.

**Rueckweg:** Additiver Commit ausschliesslich in `scripts/`, `test/`, `tasks/` - kein
Produktionspfad beruehrt, `git revert` des einen Commits stellt den Stand her. Die neue Zielsperre
faellt ohne Treffer von selbst in die Verweigerung. `ELEVENLABS_INBOUND_ENABLED` geht nach dem Lauf
sofort wieder auf `false`.

**Betroffene Dateien:** `scripts/iel-mess.mjs`, `scripts/iel-mess.cases.json`,
`scripts/iel-mess-anbieter.mjs`, `scripts/iel-mess-belege.mjs`, `tasks/iel-ohrzeuge-zaehler.json`
(neu), `test/` (neue Falltabellen und Golden).

---

### IEP-P2 - Sofortannahme und Fensterbesetzung

**Ziel:** Ab dem Moment, in dem Telnyx unser TeXML hat, gehoert die Medienstrecke uns - und bis
zur ersten Agenten-Silbe hoert der Anrufer ausschliesslich Hermes.

**Vorbedingung:** IEP-P0 hat entschieden, mit welcher Abnahmelast diese Phase laeuft (Ausgang A,
B oder C). Bei Ausgang A wird sie als Hygiene-Phase gebaut und NICHT als Antwort auf die Ansage
verkauft.

**Inhalt - ZWEI Aenderungen, bewusst in EINER Phase:**

1. **Sofortannahme:** `EL_DIAL_ANSWER_ON_BRIDGE` von `true` auf `false`
   (`src/elevenlabs/inbound-rueckfall.js:35`). Der Renderer laesst das Attribut dann weg (B5), das
   `<Dial>` bleibt ERSTES Verb und beantwortet damit das Bein. Das ist der in der Datei selbst
   (Zeilen 27-33) und in `tasks/iex-spec-a.md:214` fertig beschriebene Rueckweg IEX-A4b. Der
   Kommentarblock 23-33 wird nachgezogen, inklusive Gegenbuchung: die Pflichtmessung **M-S3
   entfaellt**, weil der Fehlersatz nach gescheitertem Dial auf einem BEANTWORTETEN Bein bereits
   gemessen ist (`[M1]` F-F).
2. **Fensterbesetzung - warum sie nicht in eine eigene Phase darf:** ab der Annahme hoert der
   Anrufer, was WIR liefern, und Telnyx spielt waehrend der Dial-Wartezeit von sich aus seinen
   US-Freiton (B9). Die Dial-Doku kennt fuer `ringTone` nur Laenderwerte und KEINEN Stille-Wert.
   Schritt 1 allein wuerde das fremde Klingeln durch UNSER US-Klingeln ersetzen - genau das, was
   der Auftrag verbietet. Drei harte Bedingungen, gleich welche Form gewaehlt wird:
   (a) kein Freiton und keine Netzansage; (b) keine Sprache, die mit der Offenlegung konkurriert -
   der in IEX-A3 abgeloeste TeXML-Pflichtsatz kommt NICHT zurueck, erste Sprache bleibt die
   freigegebene Agenten-Eroeffnung; (c) falls Audio, dann ein **vorab gerendertes statisches
   Asset**, kein `<Say>`: in Test #1 lagen zwischen `playback_start` (08.116) und
   `playback_started` (09.077) ~1,0 s Stille, weil im Anrufmoment synthetisiert wurde.
   Das Asset wird ueber den bestehenden statischen `public/`-Mount ausgeliefert, fester Dateiname,
   **kein Parameter, keine neue Route** (CLAUDE.md Regel 3). Umsetzung als EIN benannter Wert,
   getrennt abschaltbar, Default so, dass der Schalter-Aus-Zustand byte-gleich zum reinen
   Schritt 1 rendert.

3. **Harte Stopp-Regel statt weichem Rueckweg:** faellt die Messung "Medien-Verb vor dem Dial ohne
   Dial-Verschiebung" (U2) negativ aus, wird **IEP-P2 NICHT ausgeliefert**. Die Phase geht mit der
   Messzahl an den Owner zurueck (Entscheidung: US-Freiton bewusst akzeptieren, oder
   `answerOnBridge=true` belassen). Ein Auslieferungsstand "Sofortannahme ohne Fuellung" ist
   ausgeschlossen - er waere eine hoerbare Verschlechterung gegenueber heute.
4. **Nachher-Lauf** des Ohrzeugen mit identischem Auswerteschema, plus ein Lauf gegen ein nie
   antwortendes Ziel, der belegt, dass der Fehlersatz auf dem jetzt beantworteten Bein gesprochen
   wird.

**Abnahme:**
(a) Golden-Test des Uebergabe-TeXML: kein `answerOnBridge`-Attribut mehr, Dial bleibt erstes Verb
mit dem `<Redirect>` dahinter; `test/iex-a4-answer-on-bridge.test.js` wird zur Gegenrichtung
gedreht (der Datei-Kopf sieht das vor).
(b) Nachher-Lauf: `answer`-Kommando steht VOR dem `dial`-Kommando; `call_initiated` ->
`call_answered` unter 0,8 s. **Gilt nur, wenn die Kalibrierung in P1 Schritt 9 diese Kennzahl als
tauglich ausgewiesen hat.**
(c) Auf dem Anrufer-Kanal keine Energie vor der ersten Hermes-Silbe ausser der gewaehlten
Fuellung; in den `call_events` kein `playback_start` mit `tone_stream`.
(d) Laengstes Stille-Segment ab der Annahme unter der vom Owner gesetzten Schwelle (F4a); M-S2 fuer
Vorher und Nachher beziffert und nebeneinander im Bericht.
(e) Fehlerfall-Gegenprobe: Dial auf ein nie antwortendes Ziel -> Render-Zeile `[el-rueckfall]
quelle=dial_ende entscheidung=fehlersatz` UND der Fehlersatz ist im Mitschnitt hoerbar. **M-S3 ist
damit maschinell geschlossen** statt einem Owner-Anruf zugewiesen.
(f) Fuellung abgeschaltet -> TeXML byte-gleich zum reinen Schritt-1-Golden.
(g) Deploy-Lesebeleg nach der Deploy-Regel (Commit = master-HEAD, Boot-Banner).
(h) Vier Sicherungen nachgeprueft und unveraendert im Bericht dokumentiert (Signatur,
Tenant-Decke, Max-Dauer, Fehlersatz-Pfad) - `brakeSecondsFor`, `createCall(maxDurationS)`,
`markAnswered` und `armMaxDurationTimer` laufen bereits in `/voice/incoming`
(`src/routes/voice.js:546-560`), das `timeLimit` am Dial kommt aus derselben einen Quelle
`callMaxDurationMs`. **Die Umstellung schwaecht kein Gate.**
(i) `npm test -- --test-concurrency=4` gruen.
(j) Der Bericht enthaelt woertlich, was der Lauf NICHT beweist.

**Maschinelle Messung ohne Owner-Anruf:** Zwei Ohrzeugen-Laeufe desselben Falls gegen zwei
Deploys, plus `list_call_events` beider Laeufe und die Render-Zeilen `[el-init]`/`[el-rueckfall]`.
(a) und (f) laufen vollstaendig in-process.

**Risiko:**
1. Beseitigt die Ansage NUR, wenn sie in diesem Fenster entsteht - und die Messlage sagt eher das
   Gegenteil (I1). Die Phase verkuerzt das Fenster und besetzt den Rest, sie loescht keine fremde
   Ansage.
2. U1 ist ungemessen und tragend. Schritt 4 misst genau das; faellt es anders aus, endet die Phase
   mit dem Rueckweg statt mit einem Deploy.
3. Ueberlappt die Fuellung mit der Agenten-Eroeffnung, hoert der Anrufer zwei Hermes-Quellen
   gleichzeitig - schlimmer als Stille; der dual-kanalige Mitschnitt weist das direkt nach.
4. **Kostenwirkung im Rollout, nicht heute:** wer waehrend der Wartephase auflegt, erzeugt jetzt
   eine real beantwortete Traegerminute - und ein angenommenes Inbound-Bein wird mit 60 Sekunden
   abgerechnet (forensik-d §3). Heute kostet eine in der Klingelphase abgebrochene Zustellung
   null. Als **Rollout-Gate** (nicht als Owner-Test-Gate) wird eine Zahl verlangt: Anteil der
   Inbound-Zustellungen, die heute in der Klingelphase abbrechen, aus den vorhandenen
   `detail_records` ueber einen laengeren Zeitraum. Ist er nennenswert, vor dem Rollout entweder
   `EL_DIAL_RING_TIMEOUT_S` senken oder die Annahme an eine Mindest-Klingeldauer haengen. Der
   Befund gehoert in denselben Bericht wie die Ton-Kennzahlen.
   Umgekehrt entschaerft die Aenderung den Buchungsbefund, dass `answeredAt` heute VOR der
   Traeger-Annahme liegt (`tasks/iex-spec-a.md:403`).

**Rueckweg:** Produktionsseitig eine Zeile: `EL_DIAL_ANSWER_ON_BRIDGE` zurueck auf `true`, Deploy -
der Rueckweg ist der heutige Zustand und in der Datei dokumentiert. Die Fuellung ist ein eigener,
getrennt abschaltbarer Wert und einzeln revertierbar. Zweite Linie unveraendert:
`ELEVENLABS_INBOUND_ENABLED=false` schaltet den ganzen EL-Inbound-Weg ab, die Budget-Engine
bedient die DID.

**Betroffene Dateien:** `src/elevenlabs/inbound-rueckfall.js`, ggf.
`src/telephony/adapters/telnyx/render.js` (Fuellverb), `public/` (Asset),
`test/iex-a4-answer-on-bridge.test.js`, `test/iel-dial-render.test.js`, `src/config.js` und
`.env.example` (Fuell-Schalter), `render.yaml`.

---

### IEP-P3 - Beleg-Werkzeug

**Ziel:** Jede folgende Phase belegt sich selbst. Null Anrufe, kein Produktionscode.

**Warum hier und nicht spaeter:** P4 und P6 sind Verhaltensaenderungen, die ohne Turn-Zahlen,
Latenzen, `interrupted`-Flags und Beendigungsgrund nur nach Gefuehl bewertbar waeren - und Gefuehl
bei n=1 und Temperatur 0,66 ist Rauschen.

**Inhalt:**

1. `scripts/iel-geheimnisse-conversation.mjs` bekommt **`--conversation-id`**; heute liest es nur
   die NEUESTE Conversation je Richtung seit `--seit` (`:56-72`), womit jede nachtraegliche
   Pruefung eines bestimmten Anrufs unmoeglich ist.
2. Zusaetzliche, PII-freie Felder, die in der Forensik fehlten: `agent_id`, Startzeit,
   Beendigungsgrund, Turn-Zahlen je Seite, Latenzen je Turn, `interrupted`-Flag JEDER Agent-Zeile
   (heute nur der ersten - das ist das Feld, an dem **M-U1** haengt), wirksame Sprache / LLM /
   TTS-Modell / `voice_id`, die drei erlaubten Override-Pfade als Laengen.
3. **Waechter zuerst, Felder danach.** Alle neuen Felder laufen durch denselben "zuerst verbieten,
   dann ausgeben"-Waechter, der heute `tenant_token` und `sip_hermes_call_binding` schuetzt: Werte
   erscheinen als vorhanden/leer/Laenge, nie im Klartext. `conversation_config_override` und
   `first_message` erscheinen ausschliesslich als LAENGE - `first_message` traegt den Owner-Namen.
   Transkript-Inhalte bleiben ausgeschlossen (Regeln 4 und 5).
4. `scripts/check-elevenlabs-drift.mjs` wird als Pflichtschritt vor JEDEM weiteren Mess-Lauf ins
   Runbook geschrieben (read-only GET, fail-closed, kein PATCH im Import-Graphen).
5. **Ausdruecklich NICHT Teil:** die Turn-/ASR-/Barge-in-Parameter des Agenten anfassen. Sie
   sitzen auf Kontoebene und gelten fuer BEIDE Richtungen - jede Aenderung trifft sofort den
   laufenden Outbound-Betrieb.

**Abnahme:**
(a) Fixture-Gegenprobe mit **Rotprobe**: eine Conversation mit gesetztem `tenant_token` und
Bindungs-Token wird ausgegeben, ohne dass ein Wert im Klartext erscheint; Waechter entfernt ->
Test rot (Muster `test/iel-b10-geheimnisse.test.js`).
(b) `--conversation-id` liest genau die angegebene Conversation; ohne den Schalter bleibt das
Bestandsverhalten byte-gleich.
(c) Positiv-Kontrolle gegen die bekannten Conversations von #1/#2: jedes neue Feld kommt entweder
mit Wert oder mit der ausdruecklichen Meldung "vom Anbieter nicht geliefert" - **kein stilles
Leerfeld** (U4 wird damit beantwortet statt umgangen).
(d) `check-elevenlabs-drift.mjs` Exit-Code 0 mit demselben Feldabgleich wie im Forensik-Stand
(44/44, nur `retention_days` und die drei bekannten Werkzeug-Metadaten weichen ab).
(e) `npm test` gruen.

**Maschinelle Messung ohne Owner-Anruf:** vollstaendig. Lesende API-Aufrufe gegen bereits
existierende Conversations plus Unit-Tests gegen Fixtures. Verbraucht keinen Anruf aus keinem
Zaehler und schreibt nichts beim Anbieter.

**Risiko:** Diese Phase verbessert nichts - sie misst. Wer sie als Fortschritt an der
Anrufqualitaet verbucht, taeuscht sich und den Owner. Der einzige ernsthafte Fehlerfall ist ein
neues Feld am Waechter vorbei (Regeln 4/5) - deshalb die Rotprobe statt eines Positiv-Tests.
Scope-Drift: das Werkzeug ist ein Leser und wird keiner, der auch schreibt.

**Rueckweg:** Reine Werkzeugaenderung unter `scripts/` und `test/` - `git revert`, kein
Produktionsverhalten beruehrt, kein Deploy noetig.

**Betroffene Dateien:** `scripts/iel-geheimnisse-conversation.mjs`,
`scripts/iel-geheimnisse.mjs`, `test/iel-b10-geheimnisse.test.js`.

---

### IEP-P4 - Eroeffnung, Kontext, Prompt-Hygiene

**Ziel:** Der eingehende Agent bekommt dieselbe Orientierung wie der ausgehende - und die
Eroeffnung wird an dem Punkt entschieden, an dem sie sich zwischen Test #1 und #2 tatsaechlich
geaendert hat. Kein Push ins EL-Konto, keine Aenderung am geteilten Template.

**Inhalt - vier Wert-Aenderungen:**

1. **Eroeffnungsquelle (neu gegenueber allen Vorentwuerfen, aus B2):** Test #1 sprach die
   GESPEICHERTE Tenant-Begruessung, Test #2 einen generischen Vorlagensatz. `gespeicherteBegruessungFuer`
   existiert weiter, wird aber nur noch vom Budget-Weg gelesen. Owner-Entscheidung F7 legt fest,
   ob die gespeicherte Begruessung zurueck in die Eroeffnung fliesst. Fliesst sie zurueck, dann als
   **zweite, ebenso strikte Sollform des Riegels** (Namenssatz-Anfang bleibt Pflicht, Hinweis
   woertlich bleibt Pflicht) - nicht als Lockerung.
2. **Kontext ueber den EINEN Kanal, der schon heute pro Anruf sicher variiert:**
   `inboundDynamicVariables()` uebergibt heute `OHNE_AUFTRAG = Object.freeze({})` an die geteilte
   `dynamicVariables()` - alle Auftragsfelder fallen auf ihren Leerwert (gemessen:
   `callee_relation` Laenge 0 inbound gegen 1347 outbound). Statt leer kommt ein Inbound-Kontext:
   Rolle des Assistenten, was er aufnehmen soll, Erreichbarkeit, und dass der Owner eine
   Zusammenfassung bekommt.
   **Als ausdrueckliches Literal mit enumerierten Schluesseln, niemals das echte call-Objekt.**
   Grund: `dynamicVariables()` rendert aus dem uebergebenen Objekt auch `callee` (`call.to`) und
   `callee_relation` - letzteres ist der OUTBOUND-Owner-Block samt fertig eingesetztem
   Outbound-Offenlegungssatz, einzig durch `call.calleeIsOwner !== true` auf `""` gesperrt
   (`src/elevenlabs/outbound.js:701`). Ein durchgereichtes call-Objekt wuerde die Sicherheit dieser
   Grenze von "strukturell" auf "Disziplin" absenken.
   Erster Schritt bewusst als sprachrichtiger Standardtext, NICHT als neues Tenant-Setting -
   Datenmodell, Self-Service-UI und Validierung waeren eine eigene Phase und werden als
   Folgearbeit benannt statt vergessen.
3. **Prompt-Hygiene am WERT, nicht am Template:** der Platzhalter `{{inbound_situation}}` sitzt im
   geteilten Template direkt hinter `{{callee_relation}}` ohne Zeilenumbruch, und der Wert
   (`src/i18n/prompts/en.js:79-84`) beginnt selbst ohne fuehrenden Umbruch - am Live-Agenten
   entsteht `...not a human.THIS CALL IS AN EXCEPTION...`. Der Umbruch kommt an den WERT, wie
   `calleeRelationText` es outbound tut (`outbound.js:700-704`).
4. Der Satz *"have already been said to the caller, word for word, before you took over"* faellt:
   er stammt aus dem vor IEX-A3 abgeloesten Design mit serverseitigem TeXML-Play.

`test/el-vorlage-variablen-abgleich.test.js` zieht die Namensmenge nach; `assertAntwortSicher`
bleibt scharf.

**Strukturell outbound-sicher:** Outbound rendert `inbound_situation` immer `""`
(`outbound.js:970-975`, "ein ausgehender Anruf ist nie eingehend") und nutzt weiter sein eigenes
call-Objekt - eine Wertaenderung kann Outbound nicht erreichen.

**Ausdruecklich NICHT Teil:** `get_consult`/`look_up` fuer Inbound, ein neues EL-Werkzeug, ein
zweiter EL-Agent (s. Abschnitt 6 und die verworfenen Wege).

**Abnahme:**
(a) Outbound-Init byte-gleich zum Vorstand (Golden-Gegenprobe) - strukturell garantiert, trotzdem
gepinnt.
(b) `inbound_situation` beginnt mit dem Umbruch und enthaelt keinen Verweis mehr auf einen zuvor
gesprochenen Satz.
(c) **Die Werkzeug-Grenze haelt als TEST, nicht als Absicht:** `consult_available` und
`lookup_available` bleiben `"unavailable"`, `tenant_token` bleibt Leerstring.
(d) **Grenztest gegen das Durchreichen:** die Init-Antwort des Inbound-Wegs traegt
`callee_relation === ""` und `callee === ""`; ein `calleeIsOwner`-Feld am Inbound-Objekt veraendert
den Wert NICHT. Kein Wert enthaelt eine Rufnummer.
(e) Namensmengen-Test angepasst und gruen; Platzhalter-Riegel wirft weiterhin bei unaufgeloesten
Werten und nicht erlaubten Override-Pfaden (Rotprobe).
(f) `el-prompt-kuerze.test.js` gruen und `check-elevenlabs-drift.mjs` unveraendert - Beleg, dass
das geteilte Template nicht angefasst wurde.
(g) **Wirkungsbeleg mit n>=5** Ohrzeugen-Laeufen mit demselben eingespielten Anrufer-Text
(Sprechspur aus P1 Schritt 5), vorher/nachher verglichen ueber die P3-Kennzahlen (Turn-Zahl,
Turn-Luecken, Unterbrechungen, Beendigungsgrund). Wird das Anruf-Budget dafuer nicht bewilligt
(F2), entfaellt (g) und **die Phase wird ausdruecklich als unbewiesene Hygiene-Aenderung gefuehrt** -
kein drittes Ergebnis.
(h) `npm test` gruen.

**Maschinelle Messung ohne Owner-Anruf:** Init-Webhook lokal per `curl` (Variablenwerte
vollstaendig sichtbar, ohne Netz), Golden- und Namensmengen-Tests in-process, dazu der
Anbieter-Beleg ueber die Variablen-Laengen mit dem in P3 gehaerteten Werkzeug. Der Hoerbeleg kommt
aus dem Ohrzeugen.

**Risiko:**
1. **Der Hoereindruck-Gewinn aus Punkt 2 und 3 ist UNBELEGT:** die Kontextarmut bestand schon in
   Test #1, den der Owner als "Niveau wie Outbound" bezeichnete. Sie sind Kandidaten fuer den
   STEHENDEN Abstand zu Outbound, kein Fix fuer die Katastrophe. Punkt 1 dagegen ist ein
   **belegter Delta** zwischen dem guten und dem schlechten Anruf.
2. Die Datenflaeche waechst: was im Inbound-Kontext steht, reist im Prompt zum Anbieter und ist
   fuer einen FREMDEN Anrufer wirksamer Kontext. Heute reisen `owner_name`, Zeitzone, Datum,
   Mandatsgrenze und `inbound_situation` - keine Rufnummern, aus ausdruecklicher
   Datenminimierung (`inbound-initiation.js:59-61`). Dieselbe Disziplin gilt fuer den neuen Text.
3. Die Prompt-Laenge waechst (`el-prompt-kuerze.test.js` als Regressionsschutz).
4. Ein hartkodierter Standardtext ist genau so lange richtig, wie es einen Tenant gibt.

**Rueckweg:** Ein Schalter an einer Stelle: zurueck auf `OHNE_AUFTRAG`. Eroeffnungsquelle und
Prompt-Hygiene sind davon unabhaengig und einzeln revertierbar - reine Wertaenderungen in
i18n-Strings, die das geteilte Template und damit Outbound strukturell nicht erreichen. Kein
Anbieter-Rueckbau; der Platzhalter-Riegel faengt einen halben Rueckbau fail-closed ab.

**Betroffene Dateien:** `src/elevenlabs/inbound-initiation.js`, `src/i18n/prompts/en.js` (+ `de`,
`fr`), ggf. `src/i18n/locales.js` und `src/i18n/inbound-opening.js` (zweite Sollform),
`test/el-vorlage-variablen-abgleich.test.js`, `test/iex-a3-eroeffnung.test.js`.

---

### IEP-P5 - Owner-Erkennung: die Klempnerei

**Ziel:** Der Server weiss bei jedem eingehenden Anruf fail-closed, ob der Anrufer die hinterlegte
eigene Nummer des ANGERUFENEN Tenants benutzt. **Hoerbar aendert sich in dieser Phase nichts** -
einzeln merge- und deploybar.

**Inhalt:**

1. **Vorgelagerte, geteilte Normalisierung.** `call.from` wird heute roh uebernommen
   (`from: req.body.From || "unbekannt"`, `src/routes/voice.js:549`), waehrend `To` durch `normNum`
   laeuft (`:508`). Vor dem Praedikat laeuft dieselbe eine Quelle (`normNum` + E.164-Pruefung) -
   keine neue Regel, kein Praefix-Match, kein Vergleich der letzten n Ziffern. Alles, was die
   kanonische Form nicht erreicht (fehlend, "unbekannt", unterdrueckt, "anonymous", nationales
   Format), ergibt fail-closed KEINE Erkennung.
   **Das GESPEICHERTE `call.from` bleibt unveraendert**; die kanonische Form ist ein lokaler Wert,
   der nur an das Praedikat geht. Grund: am gespeicherten Feld haengen vier Bestandsstellen, die
   nichts mit der Owner-Erkennung zu tun haben - Tarifableitung
   (`src/billing/metering.js` `tariffCentsPerMin(call.to, call.from)`), Kostenkalibrierung
   (`src/billing/cost-calibration.js:77`), Betreff der Zusammenfassungs-Benachrichtigung und der
   Summary-SMS (`src/telephony/call-finish.js:340`), MCP-Anrufliste (`src/mcp-tools.js:405`);
   der Aktiv-Anruf-Lookup vergleicht ebenfalls roh (`src/store/state-ops.js:2857`). Eine
   Normalisierung am Schreibweg waere ein Geldpfad-Defekt, eingeschleppt von einer Phase ohne
   hoerbares Verhalten.
2. **Dritter benannter Zugang** in `src/callee-is-owner.js` auf DEMSELBEN nackten Vergleich. Das
   Modul dokumentiert diese Bauart im Kopf ("ZWEI EXPORTE, EIN VERGLEICH ... eine Datei, ein
   Vergleich, zwei benannte Zugaenge") und verbietet ausdruecklich jede Normalisierung im
   Praedikat (Zeilen 11-16). Ein dritter, anrufer-bezogener Zugang setzt das Muster fort;
   CLAUDE.md Regel 2 ("keine zweite Stelle, die dieselbe Frage noch einmal beantwortet") bleibt
   erfuellt. Eigener Funktionsname und Kopf-Kommentar, damit ihn niemand als vierten
   Outbound-Fall liest.
3. **Eigener Schalter, eigene Allowlist** (`boolEnv` Default `false`, `csvEnv` leer = NIEMAND),
   Muster `OWNER_SELF_CALL_*` (`src/config.js:1817-1839`), dokumentiert in `.env.example`,
   `sync:false` in `render.yaml`, sichtbar im Boot-Banner neben "Inbound-EL: ...".
   **Nicht** die Mitbenutzung von `OWNER_SELF_CALL_*`: `PLAN-SECURITY.md:3500-3531` nennt
   `OWNER_SELF_CALL_ENABLED=false` als eine der beiden Launch-Bedingungen - ein geteilter Schalter
   wuerde die Inbound-Begruessung an diese Ruecknahme koppeln und umgekehrt eine
   Inbound-Abschaltung zum Offenlegungs-Ereignis im Outbound machen.
4. **Eigenes set-once Anruf-Feld** (additiv, json/pg-Parity, Muster `callee_is_owner BOOLEAN NOT
   NULL DEFAULT FALSE`) statt Mitbenutzung von `calleeIsOwner`. Grund: `src/claude.js:184-203` hat
   die heutige Tatsache zur ORDNUNGSREGEL gemacht ("ein eingehender Anruf traegt `calleeIsOwner`
   strukturell nie als true") und prueft `isInbound` ZUERST - wer das Feld inbound setzt, macht
   diesen Kommentar still falsch und die Owner-Zeile unerreichbar; zusaetzlich wuerde der
   Outbound-Waechter in `convai.js` gelockert.
5. **Das neue Merkmal wird NICHT an die Diagnose-Retention gehaengt** (B17) - die Retention bleibt
   am Outbound-Vergleich. Sonst genuegte kuenftig eine gefaelschte Absenderkennung, um die
   Aufbewahrung eines fremden Gespraechs zu verlaengern. Als Test verankert.
6. **Nur-Ton-Invariante als Test verankern:** dieselbe Init-Antwort einmal mit Praedikat `true`,
   einmal `false` - gleiche Schluesselmenge, Differenzmenge der Werte spaeter GENAU
   `agent.first_message` und `inbound_situation` (in dieser Phase noch leer, weil P5 nichts
   Hoerbares aendert). Damit kann eine kuenftige Phase die Erkennung nicht unbemerkt zum
   Datenschalter machen.
7. **`PLAN-SECURITY.md` im selben Commit:** (a) die Inbound-Achse als DRITTEN Verwender der
   unverifizierten hinterlegten Nummer eintragen (der Bestandseintrag deckt ausdruecklich nur den
   Anruf-Weg, der SMS-Weg ist bereits als zweiter ungedeckter Verwender vermerkt, `:3542-3554`);
   (b) Launch-Bedingung (b) bei `:3519-3523` nennt ab jetzt **beide** Schalter namentlich - sonst
   behauptet der Eintrag eine Deckung, die es nicht mehr gibt.

**Abnahme:**
(a) Falltabelle am Praedikat gruen: exakter Treffer; eine Ziffer daneben; `0049...`;
leer/null/Nicht-String; "unbekannt"; "anonymous"; Nummer mit Leerzeichen und Bindestrichen
(Treffer, weil `normNum` vorgelagert greift); Schalter aus; Tenant nicht gepinnt; leere Allowlist.
**Rotprobe:** Normalisierung ins Praedikat schieben ODER auf Praefix vergleichen -> mindestens ein
Fall wird rot.
(b) Schalter aus = byte-gleiches Bestandsverhalten (Golden-Gegenprobe der Init-Antwort); Schalter
an = in dieser Phase ebenfalls byte-gleich, weil nur das Feld gesetzt wird.
(c) **Geldpfad-Gegenproben:** `tariffCentsPerMin` und `subjectInbound` liefern fuer einen Inbound
mit nicht-kanonischer `From` denselben Wert wie vorher.
(d) SQL-Gegenprobe gegen Produktion: die Zahl der Inbound-Datensaetze mit `callee_is_owner=true`
bleibt 0 (heute 0 von 7), der neue Zaehler auf dem neuen Feld steigt.
(e) json/pg-Parity ueber den Bestands-Shape-Test; Bestands-Datensaetze ohne das Feld gelten als
NICHT-Owner.
(f) Regressionstest: kein Inbound-Datensatz traegt je `calleeIsOwner=true`; die Diagnose-Retention
reagiert nicht auf das neue Feld.
(g) `test/route-auth-inventory.test.js` und `npm test` gruen.

**Maschinelle Messung ohne Owner-Anruf:** vollstaendig lokal. Server mit `PORT=0` und
`DATA_DIR`-Override starten, `/voice/incoming` mit `SKIP_TWILIO_SIGNATURE_CHECK=true` und `From` in
allen Varianten replayen, danach das neue Feld am Anruf-Datensatz und die Init-Webhook-Antwort
pruefen. Dazu Unit-Tests am reinen Praedikat (offline, ohne Spawn) und die lesende SQL-Gegenprobe.

**Risiko:**
1. **Die Anrufernummer ist faelschbar** - das ist der Kern der Owner-Entscheidung und der Grund,
   warum die Erkennung NUR den Ton faerbt. Outbound ist `ctx.to` das Ziel, das WIR nach dem
   `normalize_target`-Gate selbst gewaehlt haben; inbound ist es die Gegenseite `req.body.From`:
   der Webhook ist Ed25519-signatur-geprueft und fail-closed, sein INHALT stammt aus dem
   Ursprungsnetz. Faelschungsfest ist nur die andere Seite des Vergleichs (der Tenant kommt aus
   UNSERER angerufenen DID, `routes/voice.js:508-557`).
2. STIR/SHAKEN taugt nicht als Haertung (B19).
3. Die hinterlegte Nummer ist nicht eigentums-verifiziert (B18) - deshalb ist die Tenant-Allowlist
   nicht Kosmetik, sondern das tragende Gate. Wird der Launch-Blocker geschlossen, ohne dass die
   Besitz-Verifikation gebaut ist, ist DIESE Achse zurueckzunehmen, nicht der Eintrag.
4. Zwei aehnlich benannte Anruf-Felder nebeneinander - Kopf-Kommentar plus Regressionstest (f).
5. n=7 Anrufer aus einem Netz ueber einen Ingress-Peer sind keine Stichprobe (U6).
6. Diese Phase beruehrt den Qualitaetsbefund von Test #2 NICHT (in beiden Tests war die Erkennung
   aus) und darf nicht als Fix dafuer verbucht werden.

**Rueckweg:** Schalter auf `false` oder Allowlist leeren = niemand loest die Erkennung aus -
dieselbe Notaus-Bauart wie outbound, ohne Code-Aenderung. Zusaetzlich vollstaendiger `git revert`
moeglich, weil noch kein hoerbares Verhalten daran haengt; das neue Feld ist additiv.

**Betroffene Dateien:** `src/callee-is-owner.js`, `src/routes/voice.js`,
`src/store/state-ops.js`, `src/store/json.js`, `src/store/pg.js`, `src/db/schema.sql`,
`src/config.js`, `.env.example`, `render.yaml`, `PLAN-SECURITY.md`, `test/callee-is-owner.test.js`.

---

### IEP-P6 - Owner-Ton

**Ziel:** Ruft der Owner von seiner hinterlegten Nummer an, begruesst ihn der Agent im Owner-Ton.
Die KI-Kennzeichnung bleibt IMMER. Stellt sich im Gespraech heraus, dass jemand anderes am Apparat
ist, faellt der Agent SOFORT auf den freigegebenen Fremd-Wortlaut zurueck. Kein Datenkanal geht auf.

**Warum zuletzt:** hoechste regulatorische Flaeche, und der Beleg ist SCHWAECHER als outbound.

**Inhalt:**

1. **Zweite, ebenso strikte Sollform des Eroeffnungs-Riegels - KEINE Lockerung.** Der Riegel prueft
   vier Dinge und laeuft zweimal (B14); die Outbound-Owner-Eroeffnung faellt an dreien durch
   (B15). Ohne eigene Sollform antwortet der Init-Webhook 404 -> keine Bindung -> `dial_ende` ->
   Fehlersatz.
   **Die Owner-Sollform ist ein ANREDE-Wechsel, nicht ein Wegfall von Bausteinen:** Owner-Anrede
   PLUS KI-Kennzeichnung PLUS `bundle.inboundNotice` **woertlich**, so dass alle vier
   Bestandspruefungen unveraendert scharf bleiben und nur die geforderte Anfangsform wechselt.
   Fail-closed wie im Bestand: kein Vorname -> gar keine Owner-Eroeffnung, der freigegebene
   Bestandstext spricht.
   **Ein Wegfall des Transkriptions-/Zusammenfassungs-Hinweises wird in dieser Kette NICHT
   gebaut** - dazu s. F8 und Abschnitt 6.
2. **Pflicht-Rueckfall im Anrufmoment** als letzte, nicht verhandelbare Zeile der Owner-Variante
   von `inbound_situation`, mit dem Fremd-Eroeffnungstext FERTIG eingesetzt (das Modell darf ihn
   nicht umschreiben). Vorbild ist die letzte Zeile von `calleeRelation` outbound
   (`src/i18n/prompts/en.js:54-60`); `inboundSituation` kennt heute keinen Owner-Fall. Die Achse
   bleibt INBOUND (`inboundEroeffnung`/`inboundNotice`, `locales.js:305-307`), NICHT der
   Outbound-Offenlegungssatz (`:225-232`) - beide Achsen sind im Code ausdruecklich getrennt, und
   "ich rufe an im Auftrag von ... wird fuer meinen Auftraggeber zusammengefasst" ist bei einem
   EINGEHENDEN Anruf sachlich falsch. CLAUDE.md verlangt diese Zeile in JEDEM Owner-Prompt-Baustein.
3. Drei gesprochene Strings (de/en/fr); DE-Strings tragen echte Umlaute (Bestandsregel, Test
   `de-umlaut-orthography`). Wortlaut ist Owner-Freigabe, keine Entwickler-Entscheidung.
4. Die **Nur-Ton-Invariante** aus P5 wird scharf: Owner- und Fremd-Init unterscheiden sich in
   GENAU zwei Feldern (`agent.first_message`, `inbound_situation`), alle uebrigen Werte identisch.
5. Schalter fuer den Owner-Tenant an; `PLAN-SECURITY.md` IEL-B8 Abschnitt 2 nachziehen, wo heute
   woertlich steht `first_message = inboundEroeffnung(ownerName)`.

**Abnahme:**
(a) Riegel gruen fuer die Owner-Sollform; **ROT** fuer eine Owner-Eroeffnung ohne
Transkriptions-Marker; ROT ohne KI-Marker; ROT bei `{{`; kein Vorname -> keine Uebersteuerung,
Bestandstext spricht.
(b) Fremd-Anruf erzeugt weiterhin byte-identisch den freigegebenen Wortlaut (Golden).
(c) Nur-Ton-Test: gleiche Schluesselmenge, Differenzmenge genau zwei Felder - `tenant_token` weiter
leer, `consult_available` und `lookup_available` weiter `"unavailable"`.
(d) Grep-Abnahme: jeder Owner-Prompt-Baustein traegt die Rueckfall-Zeile woertlich, und der
Fremd-Eroeffnungstext steht dort als EINGESETZTER Wert, nicht als Anweisung zum Selbstformulieren.
(e) Lokaler Spawn-Test: `From` = hinterlegte Nummer -> Owner-Sollform; `From` = fremd ->
Bestandstext; `From` unterdrueckt -> Bestandstext.
(f) `npm test` gruen, `npm run test:gates` ohne neue rote Faelle, `npm run test:abnahme` mit nicht
gesunkener Zahl der Ausgewanderten.

**Maschinelle Messung ohne Owner-Anruf:** Die Entscheidung ist vollstaendig ohne Netz belegbar
(Init-Webhook per `curl` mit allen `From`-Varianten). **Der hoerbare Owner-Beleg ist die einzige
Luecke der Kette, die kein Maschinenanruf schliesst** - der Ohrzeuge ruft von einer eigenen
Konto-DID an und belegt damit nur den Fremd-Pfad. Er wird beim Owner-Testanruf geschlossen.

> **Ausdruecklich verworfen:** die hinterlegte Nummer des Tenants voruebergehend auf die
> Absendernummer des Mess-Beins zeigen zu lassen. An diesem einen Feld haengen live zwei scharfe
> Mechanismen, die beide nichts mit Inbound zu tun haben: die Offenlegungs-Ausnahme im Outbound
> (`ownerSelfCallGranted`, 32 Anrufe mit `callee_is_owner=true`) und die Diagnose-Retention, die
> seit GQ-P11 ein OPT-OUT ist und ohne Zutun greift (B17). Ein vergessenes oder wegen des
> In-Memory-pg-Stores wirkungsloses Zuruecksetzen ergaebe einen Outbound-Anruf ohne
> Offenlegungssatz an eine fremde Nummer plus ein aufbewahrtes Roh-Transkript. Zusaetzlich wuerde
> der Outbound-Kontrollanruf aus P7 im selben Fenster still verfaelscht. Ebenfalls verworfen:
> Caller-ID-Spoofing der Owner-Nummer im Messwerkzeug.

**Risiko:**
1. Der Fehlerfall ist nicht "der Owner hoert die Fremd-Eroeffnung" (das ist der akzeptierte Preis
   von fail-closed), sondern "ein Fremder mit gefaelschter Absendernummer hoert die
   Owner-Eroeffnung". Dagegen stehen: die KI-Kennzeichnung bleibt IMMER, der Pflichthinweis bleibt
   woertlich erhalten, kein Datenkanal geht auf (B16), und die Tenant-Allowlist ist Default leer.
2. U5 (M-U1) ist offen und gilt fuer JEDE Eroeffnungsvariante, nicht nur die Owner-Fassung - sie
   wird im Owner-Test gemessen (Abschnitt 4).
3. Neue Bundle-Felder brauchen laut GAP-31 je einen Produktionskonsumenten.

**Rueckweg:** Schalter aus -> die Bestandseroeffnung spricht, byte-identisch zum heutigen Stand,
ohne Deploy; notfalls Tenant aus der Allowlist nehmen. Die Owner-Sollform bleibt ungenutzt im Code
liegen. Kein Datenbank- und kein Anbieter-Rueckbau noetig. Bestandsregel der Kette gilt: **Rollback
Prompt vor Code.**

**Betroffene Dateien:** `src/i18n/locales.js`, `src/i18n/inbound-opening.js`,
`src/i18n/prompts/en.js` (+ `de`, `fr`), `src/elevenlabs/inbound-initiation.js`,
`src/config.js`, `.env.example`, `render.yaml`, `PLAN-SECURITY.md`,
`test/iex-a3-eroeffnung.test.js`.

---

### IEP-P7 - Abnahmeprobe

**Ziel:** Eine maschinelle Abnahmeprobe belegt die ganze Kette als Tonprotokoll - damit der EINE
Owner-Testanruf der Abnahme dient und nicht der Diagnose. Kein Produktionscode.

**Inhalt:**

1. Der Ohrzeuge wird zur **Ein-Befehl-Probe** (npm-Skript) mit fester Kennzahl-Liste und Ampel:
   Fremdton vor Hermes ja/nein, unbeantwortetes Fenster in ms, ms bis zur ersten Agenten-Silbe,
   laengste Stille, Turn-Luecken, Turn-Zahl, Unterbrechungen, Beendigungsgrund, Codec beider Beine,
   **Energieverteilung oberhalb ~3 kHz**. `check-elevenlabs-drift.mjs` laeuft als Vorbedingung.
2. **Outbound-Kontrollanruf derselben Ansage** - und zwar gleichartig: gegen einen
   **Owner-Self-Call** (`callee_is_owner=true`), denn das ist der Massstab des Owners, nicht ein
   Fremd-Outbound. Die Asymmetrie wird dabei protokolliert: der Owner-Outbound traegt gar keinen
   Offenlegungssatz, Du-Form, vollen Kontext und beide Werkzeuge; der Owner-Inbound traegt
   zwingend Namenssatz plus vollen Hinweis und keine Werkzeuge. Das ist die groesste belegte
   Differenz zwischen den beiden Hoererlebnissen und gehoert vor den Test benannt (F8).
3. **Klangvergleich objektiv:** dieselbe Agenten-Ansage inbound und outbound, Energieverteilung
   und Grundrauschen verglichen. Bei messbarem Unterschied ist die Wiedereintritts-Bedingung des
   verworfenen Codec-Punkts erfuellt - das gehoert VOR den Owner-Test entschieden, nicht danach.
4. **Post-Call-Kette belegen:** Transkript -> `summarizeCall` -> Inbox-Eintrag
   (`src/telephony/call-finish.js:312-337` mit dem Purge danach, `src/inbox-entry.js:41-46`). Fuer
   gebrueckte Inbound-Calls ist `anbieterZusammenfassung=false`, die Zusammenfassung stammt also
   aus UNSEREM `summarizeCall` - heute der einzige Task-Erzeuger fuer Inbound und bisher nie auf
   Brauchbarkeit geprueft.
5. **Abnahmemappe:** alle maschinellen Belege von P0 bis P6 an einer Stelle, jede Zeile mit Quelle
   und Sicherheitsstufe - kein "sieht gut aus". Darin auch die Delta-Tabelle aus P0, das
   Kalibrierungs-Urteil aus P1 Schritt 9, die Deploy-Lesebelege und was der Telnyx-Support zur
   SIP-Ladder geantwortet hat oder eben nicht.
6. **Grenz-Satz, woertlich und vor dem Anruf** (s. Abschnitt 4).
7. **Aufraeumen nach Bestandspflicht:** Prozessmuell der gemergten Phasen im Merge-Commit
   entfernen; untrackte Doku erst committen, dann loeschen, Dateien einzeln adden (nie
   `git add -A`). Mitschnitte beim Anbieter loeschen, Loeschbeleg im Bericht.
   **Vorab, vor IEP-P0:** ein eigener kleiner Aufraeum-Commit fuer die 11 untrackten
   `tasks/iex-a*-report.md` aus bereits gemergten Phasen - die Bestandsregel verlangt das im
   jeweiligen Merge-Commit, fuer IEX-A1..A11 ist es nicht geschehen. Ab IEP-P0 gilt die Regel je
   Merge, nicht am Kettenende.

**Abnahme:**
(a) Ampel gruen bei einem Lauf, der ohne Handgriffe reproduzierbar ist (zweiter Lauf gleiche Ampel).
(b) Mitschnitt inbound und outbound liegen ab und sind anhoerbar - der erste Hoerbeleg seit
`record_voice=false`.
(c) Der Grenz-Satz steht woertlich in der Mappe.
(d) Jede Zeile der Mappe traegt Quelle und Sicherheitsstufe.
(e) `check-elevenlabs-drift.mjs` Exit-Code 0 unmittelbar vor dem Anruf.
(f) `npm test -- --test-concurrency=4` gruen, `npm run test:gates` ohne neue rote Faelle gegenueber
dem Stand vor der Kette, `npm run test:abnahme` mit nicht gesunkener Zahl der Ausgewanderten.
(g) Zaehlerstand vor und nach dem Anruf dokumentiert.
(h) Inbox-Eintrag aus dem Probelauf ist inhaltlich brauchbar.
(i) **Aufwaermruf auf `/healthz` unmittelbar vor jedem Mess-Lauf und vor dem Owner-Testanruf**,
Zeitstempel in der Mappe. Der Dienst laeuft auf `plan free` mit einer Instanz; ein kalter Start
verschiebt genau die Sub-Sekunden-Werte, um die es geht (das ganze Fenster ist 1,56 s lang).
Die Kaltstart-Zeit wird einmal bewusst gemessen und beziffert.

**Maschinelle Messung ohne Owner-Anruf:** alles ausser dem Anruf selbst. Die Phase entscheidet
nur, OB der eine Owner-Anruf stattfindet.

**Risiko:**
1. Groesstes Risiko der Kette: eine gruene Ampel wird mit "bestanden" verwechselt. Die Probe
   beweist, dass unsere Seite schweigt und Hermes als Erstes spricht - nicht, dass der Owner in
   seinem Netz nichts anderes hoert.
2. Lehre aus der Abnahme-Schleife: nach Fund-SCHWERE steuern, nicht nach Fund-ZAHL;
   "abnahmefaehig danach" ist kein Signal.
3. Reproduzierbarkeit kostet echte Produktions-Inbounds - der Deckel bleibt hart.
4. Scope-Kriechen: Rollout und Budget-Engine-Loeschung draengen hier hinein (Abschnitt 5).

**Rueckweg:** Keine Produktionsaenderung. Faellt die Probe rot aus, wird KEIN Owner-Testanruf
freigegeben und die Kette geht in die Phase zurueck, deren Kennzahl kippt (Ton -> P2, Eroeffnung/
Kontext -> P4, Erkennung -> P5/P6) - nicht zum Owner. Faellt der Owner-Test durch, greift "Rollback
Prompt vor Code": erst die Wert-Aenderungen aus P6 und P4, dann P2, jede einzeln mit eigenem
Commit. Letzte Linie bleibt `ELEVENLABS_INBOUND_ENABLED=false` mit der intakten Budget-Engine.

**Betroffene Dateien:** `package.json` (npm-Skript), `scripts/iel-mess*.mjs`,
`tasks/iep-abnahmemappe.md` (neu), Aufraeumung in `tasks/`.

---

## 4. Der eine Owner-Testanruf

**Wann:** erst nachdem IEP-P7 die Ampel gruen gemeldet hat UND der Owner das Bestanden-Kriterium
schriftlich freigegeben hat (F9). Nie als Diagnose, nie mehrfach.

**Zaehler-Lage:** `nachdeploy` steht bei **2/3** - genau ein Anruf Reserve. `m1` ist mit **5/5**
erschoepft. Der Ohrzeuge laeuft in einer eigenen Gruppe und ruehrt beide nicht an. Jeder weitere
Owner-Anruf braucht eine eigene ausdrueckliche Freigabe mit eigener Gruppe und hartem Deckel.

**Was vorher maschinell belegt sein muss:**

| # | Beleg | Quelle in der Kette |
|---|---|---|
| 1 | Delta-Tabelle Test #1 -> Test #2 vollstaendig, jede Zeile mit Datei:Zeile | IEP-P0 |
| 2 | Hoerbeleg am Hoerer ausgewertet, Ausgang A/B/C benannt | IEP-P0 |
| 3 | Kalibrierungs-Urteil: welche Ohrzeugen-Kennzahl Abnahmekraft hat | IEP-P1 Schritt 9 |
| 4 | Zwei reproduzierbare Ohrzeugen-Laeufe ohne Fremdton und ohne `tone_stream`-Ereignis | IEP-P7 (a) |
| 5 | Unbeantwortetes Fenster beziffert, M-S2 vorher/nachher beziffert | IEP-P1, IEP-P2 |
| 6 | M-S3 maschinell geschlossen (Fehlersatz auf beantwortetem Bein hoerbar) | IEP-P2 (e) |
| 7 | Klangvergleich inbound gegen Owner-Outbound objektiv, mit Urteil zum Codec-Punkt | IEP-P7 (3) |
| 8 | Deploy-Lesebelege aller Phasen (Commit = master-HEAD, Boot-Banner) | Deploy-Regel |
| 9 | `check-elevenlabs-drift.mjs` Exit-Code 0 unmittelbar davor | IEP-P7 (e) |
| 10 | Aufwaermruf auf `/healthz`, Zeitstempel | IEP-P7 (i) |

**Der Anruf selbst ist zweigeteilt - M-U1 ist Pflichtteil, nicht Zufall:**

- **Erste Haelfte:** normaler Hoereindruck. Was hoert er vor dem Agenten? Klingt der Agent wie
  Outbound? Wird er als Owner begruesst?
- **Zweite Haelfte: gezieltes Dazwischenreden in Sekunde 1-2 der Eroeffnung.** Das ist die
  einzige Gelegenheit, **M-U1** zu messen (U5): wird eine per Override gesetzte `first_message`
  genauso unterbrechungsgesperrt ausgeliefert wie die Agenten-eigene? Auswertung ueber
  `conversation-beleg` (`transcript[0].interrupted`, seit IEX-A6 vorhanden, in P3 auf alle
  Agent-Zeilen erweitert). Daran haengt, ob die KI-Kennzeichnung und der Transkriptionshinweis
  abschneidbar sind.
  **`unterbrochen: ja` oder `unterbrochen: fehlt` = Notaus + STOPP** (Spec `iex-spec-a.md:57`,
  `:141`): sofort `schalter --aus --ausfuehren`, `trigger_deploy`, Banner "Inbound-EL: aus",
  dann Befund an den Owner. Der Ohrzeuge kann M-U1 nicht ersetzen - das Messwerkzeug spricht nicht
  in den laufenden Anruf hinein, es hoert nur.
- Danach der **Owner-Outbound-Kontrollanruf** als gleichartiger Vergleich (Self-Call, s. P7).

**Der Grenz-Satz, woertlich vor dem Anruf zu sagen:**

> Die maschinelle Probe laeuft Telnyx-intern - ohne deutschen Mobilfunk, ohne Roaming, ohne
> Transit-Carrier. Entsteht die Ansage im Heimat- oder Besuchsnetz, sieht sie keine unserer
> Messungen. Dann kann die Kette maschinell komplett gruen sein und du hoerst sie trotzdem. Dieser
> Ausgang ist kein Scheitern der Kette, sondern die Grenze unserer Verantwortungsflaeche - und wir
> haben ihn vorher benannt, nicht hinterher.

---

## 5. Gesperrt bis nach dem bestandenen Test

| Gesperrt | Begruendung | Zusaetzliche Vorbedingung |
|---|---|---|
| **Rollout auf alle Tenants** | Owner-Entscheidung | Die Spec `iex-spec-a.md` §7(b) nennt vier weitere Vorbedingungen, die diese Kette uebernimmt: (a) gruen **inkl. M-U1**; **M-S3 positiv ODER IEX-A4b live** (durch IEP-P2 erfuellt); **IEX-A12 gemergt**; **§9 F3 und F4 entschieden** |
| **Budget-Engine loeschen** | Owner-Entscheidung; das Loeschen nimmt zusaetzlich den Notaus-Rueckweg, auf dem die ganze Kette steht | erst nach stabilem Rollout |
| **IEX-A12** (Inbound-Minutensatz = Outbound-Satz) | Gebaut-pflichtig, **nicht gemergt** (B13). Ohne A12 wird nach dem Rollout flottenweit mit dem kalibrierten Inbound-Satz statt dem Leg-Satz abgerechnet - ein Geldpfad-Fehler ueber den gesamten Bestand | eigene, kleine Phase **zwischen Owner-Test und Rollout**, nicht in die Ohr-Phasen gemischt: sie beruehrt Geld, nicht Ton |
| **F3 / F4 aus `iex-spec-a.md` §9** | Betreiber-Alarm fuer gescheiterte Inbound-Uebergaben (F3) und Benachrichtigung bei Auflegen in der Wartephase (F4). Der Ausfall-Melder kennt heute nur Outbound (`outage-report.js:226`) - ein EL-Totalausfall faellt nach dem Rollout niemandem auf | Owner-Entscheidung, aufgenommen als F10 |
| **Klingelphasen-Abbruchquote** | Folge der Sofortannahme (IEP-P2 Risiko 4): heute kostet ein Abbruch in der Klingelphase null, danach eine abgerechnete Minute auf die Tenant-Decke | Zahl aus `detail_records` vor dem Rollout, s. IEP-P2 |

---

## 6. Akzeptierte Risiken

Jeder Punkt ist ein bewusst getragenes Risiko, kein Versehen.

**R1 - Die Ansage ist moeglicherweise unerreichbar.** Von fuenf moeglichen Tonquellen im Fenster
scheiden vier am Beleg aus (I1); uebrig bleibt das Netz VOR Telnyx, und ein dort entstandener Ton
ist fuer jede unserer Messungen unsichtbar (I3). Die Kette handelt trotzdem an der Stelle, die sie
verantwortet, und benennt die Grenze **vor** dem Test (Abschnitt 4). *Begruendung:* die
Alternative waere, gar nichts zu tun und auf eine Support-Antwort zu warten, die "unentscheidbar"
lauten kann.

**R2 - Der Ohrzeuge misst on-net.** Er kann die Ansage weder reproduzieren noch ausschliessen.
*Gegenmittel statt Verdraengung:* die Kalibrierung in IEP-P1 Schritt 9 entscheidet je Kennzahl, ob
sie Abnahmekraft hat; was nicht kalibriert, wird zum reinen Regressionswaechter degradiert.

**R3 - U1 bleibt bis zur Messung unbelegt.** Dass ein `<Dial>` als erstes Verb ein EINGEHENDES
Bein sofort annimmt, ist Doku-Default. *Begruendung:* der Rueckweg kostet eine Zeile, und die
Messung in IEP-P2 Schritt 4 findet vor der Auslieferung statt.

**R4 - Jeder Mess-Lauf ist ein echter Produktions-Inbound.** Anruf-Datensatz, Buchung auf die
Tenant-Decke, Inbox-Eintrag, Zusammenfassung, Summary-SMS. *Gegenmittel:* harter Deckel,
Kopfraum-Check, `smsSummaryOptIn` fuer das Messfenster aus, Aufraeumen der Muell-Eintraege in P7.
*Begruendung:* die Alternative (Telnyx-interne Nachbildung ohne die eigene DID) belegt nicht
einmal die Abwesenheit von Toenen am Produktionsweg.

**R5 - Der hoerbare Owner-Ton bleibt bis zum Owner-Testanruf unbelegt.** Der Weg dorthin
(hinterlegte Nummer umbiegen) ist ausdruecklich verworfen, weil an diesem Feld die
Outbound-Offenlegungs-Ausnahme und die Diagnose-Retention haengen (IEP-P6). *Begruendung:* ein
Ton-Beleg ist kein hinreichender Grund, zwei scharfe Rechtsmechanismen umzuschalten.

**R6 - Der Owner hoert die Fremd-Eroeffnung, wenn er mit unterdrueckter Nummer anruft.** Das ist
der Preis von fail-closed. Wie haeufig das vorkommt, ist ungemessen (n=0 in der sichtbaren
Historie). *Begruendung:* die Gegenrichtung waere, einem Fremden mit gefaelschter Absendernummer
den Owner-Ton zu geben.

**R7 - Die Anrufernummer bleibt faelschbar, und die hinterlegte Nummer bleibt unverifiziert.**
STIR/SHAKEN taugt nicht als Haertung (B19), Besitz-Verifikation ist nicht Teil dieser Kette.
*Gegenmittel:* die Erkennung faerbt nur den Ton, die KI-Kennzeichnung bleibt, kein Datenkanal geht
auf (B16), Default-Allowlist leer, Eintrag in `PLAN-SECURITY.md` erweitert statt geschlossen.

**R8 - Die EL-Gespraechsminuten der Mess-Laeufe sind unbeziffert** (U7). *Begruendung:* die
Telnyx-Seite liegt im Cent-Bereich (B20); der Gesamtbetrag wird als Teil der Budget-Freigabe F2
nachgetragen, nicht geraten.

**R9 - `get_consult`/`look_up` bleiben fuer Inbound gesperrt, obwohl das ein Teil des
Qualitaetsabstands zu Outbound ist.** Beide sind durch je zwei ausdruecklich als Sicherheitskern
kommentierte Server-Gates gesperrt (B16): die Rede eines FREMDEN, unauthentifizierten Anrufers
darf nicht in den Owner-Kontext exportiert werden und keine kostenpflichtige Suche ausloesen. Eine
Freischaltung waere eine Sicherheitsentscheidung im Sinne von Regel 1, kein Qualitaets-Hebel, und
sie widerspricht der Owner-Vorgabe, dass die Erkennung nur den Ton faerbt.

**R10 - Der Medienweg-Unterschied (G722 mit Transcodierung gegen PCMU) bleibt vorerst stehen.** Er
erklaert die Regression NICHT (I4), seine Hoerbarkeit ist unbelegt, das schreibende Telnyx-Feld ist
nicht einmal benannt, und die Aenderung waere Anbieter-Konfiguration, die auf JEDEN Anruf dieser
Connection wirkt - auch auf den Budget-Weg. **Wiedereintritts-Bedingung:** erst wenn (a) der
lesende Befund aus IEP-P1 Schritt 1 das schreibende Feld benennt UND (b) der objektive
Klangvergleich aus IEP-P7 einen messbaren Unterschied zeigt.

**R11 - Ein zweiter, von Outbound entkoppelter EL-Agent wird nicht gebaut.** Er verdoppelt
Prompt-Pflege, Drift- und Push-Flaeche, bevor belegt ist, dass der geteilte Agent das Problem ist.
Der Kontext-Unterschied laesst sich vollstaendig ueber per-Anruf-`dynamic_variables` herstellen
(IEP-P4). Gehoert in die Zeit nach dem bestandenen Test.

**R12 - Ein EL-eigenes `take_message`-Werkzeug wird nicht gebaut.** Es braeuchte eine Aenderung am
GETEILTEN Template plus Push ins EL-Konto und traefe sofort den laufenden Outbound-Betrieb. Der
Zweck ist groesstenteils erfuellt: fuer gebrueckte Inbound-Calls laeuft bereits Transkript ->
`summarizeCall` -> Inbox; IEP-P7 prueft genau das auf Brauchbarkeit.

**R13 - Die Turn-/ASR-/Barge-in-Parameter des Agenten bleiben unberuehrt.** Sie sitzen auf
Kontoebene und gelten fuer BEIDE Richtungen. Weicht Inbound ab, liegt es gerade NICHT an einer
Inbound-Einstellung.

**R14 - `convo-bench`, `stt-wer.mjs` und `telnyx-call-latency.mjs` werden nicht umgebaut** (B11).
Ein Umbau waere eine neue Architektur und koennte bei Fehlkonstruktion falsche Sicherheit
erzeugen - der teuerste Ausgang. Der Ohrzeuge misst am echten Ton statt an simulierten Turns.

---

## 7. Offene Owner-Fragen

Jede Frage mit Entscheidungsvorschlag und Folge je Antwort. Fragen mit **SPERRT** blockieren die
genannte Phase.

---

**F1 - SPERRT IEP-P1. Darf ein MASCHINEN-Anruf auf die eigene DID laufen?**
Jeder Lauf ist ein echter Produktions-Inbound: Anruf-Datensatz, Buchung auf die pro-Tenant-Decke,
Inbox-Eintrag, Zusammenfassung und - weil `private_number` gesetzt ist - eine **sichere** Summary-SMS.
Genau deshalb wurde Fall N3 nie gebaut.
*Vorschlag:* ja, mit hartem Deckel, `smsSummaryOptIn` fuer das Messfenster aus, Aufraeumen der
Eintraege in P7.
*Folge ja:* die Kette bekommt ihren Ohrzeugen und damit ihre Abnahme.
*Folge nein:* es bleibt nur ein Telnyx-interner Ersatz, der die Abwesenheit von Toenen **nicht an
der DID** belegt; P2, P4 und P7 verlieren ihre Abnahme und die Kette endet faktisch beim
Owner-Testanruf als einziger Messung - also dort, wo sie schon zweimal gescheitert ist.

**F2 - SPERRT IEP-P1 und IEP-P4. Wie viele Mess-Anrufe, in welcher Gruppe, mit welchem Deckel?**
Aufgeschluesselt gebraucht: P1 Vorher 2, P2 Nachher plus Fehlerfall 3, P4 Wirkungsbeleg vorher und
nachher 10, P7 zwei Laeufe plus Kontrolle 3 = **18**.
*Vorschlag:* eigene Gruppe `ohrzeuge`, Deckel 18, je Anruf hoechstens 60 s, eigene Zaehler- und
Sperrdatei; `nachdeploy` (2/3) und `m1` (5/5) bleiben unberuehrt. EL-Minutenkosten werden vor dem
ersten Lauf beziffert und nachgetragen (R8).
*Folge bewilligt:* P4 bekommt einen echten Wirkungsbeleg mit n>=5.
*Folge gekuerzt auf ~8:* P1, P2 und P7 sind gedeckt; **P4s Wirkungsbeleg entfaellt und die Phase
wird ausdruecklich als unbewiesene Hygiene-Aenderung gefuehrt** - kein Zwischenweg.

**F3 - SPERRT IEP-P1. Darf `ELEVENLABS_INBOUND_ENABLED` fuer die Vorher-Messung befristet wieder
AN?** (weiterhin nur Owner-Tenant, `scope=allowlist`)
*Vorschlag:* ja, engstes moegliches Fenster, ein einziger Lauf, Zuruecksetzen als Abnahmepunkt mit
Boot-Banner und Zeitstempel.
*Folge ja:* es gibt ein Vorher und damit einen Vergleich.
*Folge nein:* es gibt nur ein Nachher. Jede Verbesserungsaussage der Kette waere dann unbelegt.

**F4 - SPERRT IEP-P2, zweiteilig.**
**(a) Wie lang darf die Stille nach der sofortigen Annahme sein, bevor sie als Loch gilt?** Die
Schwelle muss VOR der Messung feststehen, damit sie nicht nachtraeglich ans Ergebnis angepasst
wird. M-S2 ist heute ungemessen und bekommt in P1/P2 erstmals eine Zahl.
*Vorschlag:* 300 ms, nachjustierbar nach der ersten Messung - aber schriftlich vor dem Nachher-Lauf.
**(b) Womit wird das Fenster besetzt?** Bindende Grenzen: kein Freiton (der Telnyx-Default `us` ist
genau der 440/480-Hz-Doppelton aus Test #1), keine Netzansage, kein gesprochener Satz, der mit der
Offenlegung konkurriert, und bei Audio ein **vorab gerendertes statisches Asset** statt
Laufzeit-Synthese (die kostete in #1 ~1,0 s Stille).
**Die ehrliche Fassung der Frage:** eine tonlose Variante ist technisch nicht erreichbar - EL
braucht rund 0,7-0,9 s bis zum 200 OK. Die Frage lautet also nicht "womit fuellen wir", sondern:
*Akzeptierst du, dass der Anrufer rund 0,7 s lang einen Hermes-eigenen Ton hoert, bevor der Agent
spricht - und gilt das als bestanden?*
*Folge ja:* P2 wird mit der gewaehlten Fuellung gebaut (Klang, Dauer, Lautstaerke brauchen dann
eine Freigabe).
*Folge nein:* P2 wird auf das reduziert, was es unbestritten leistet - Fensterverkuerzung und
Besitz der Medienstrecke -, und die Kriterien (c)/(d) wandern aus der Owner-Abnahme in die
Betriebs-Doku.
*Folge "Fuellung technisch unmoeglich" (U2 negativ):* P2 wird **nicht ausgeliefert** und geht mit
der Messzahl zurueck an den Owner.

**F5 - Soll ein Telnyx-Portal-Debugger-Auszug bzw. Support-Ticket zur SIP-Ladder von Test #2
angefordert werden?** (`call_session_id 999fb000-b144-11f1-a712-02420a1f0b70`, Gegenprobe #1
`a0b44e1a-b0da-11f1-9413-02420a1f0a70`)
Kostet keinen Anruf und ist die einzige Quelle, die 180 ohne SDP gegen 183 mit SDP klaert - traegt
aber die vollstaendige Anrufernummer des Owners zum Anbieter (PII), hat unbestimmte Antwortzeit und
kann "unentscheidbar" lauten.
*Vorschlag:* ja, als Parallelspur ohne Blockwirkung.
*Folge ja:* das Ergebnis landet in der Abnahmemappe, egal wie es ausfaellt.
*Folge nein:* R1 bleibt unaufloesbar; die Kette laeuft unveraendert weiter.

**F6 - SPERRT IEP-P4. Was darf im Inbound-Standardkontext stehen?**
Er reist im Prompt zum Anbieter und ist fuer JEDEN fremden Anrufer wirksamer Kontext. Heute reisen
`owner_name`, Zeitzone, Datum, Mandatsgrenze und `inbound_situation` - keine Rufnummern, aus
ausdruecklicher Datenminimierung.
*Vorschlag:* Rolle des Assistenten, was er aufnehmen soll, Erreichbarkeit, Hinweis auf die
Zusammenfassung - keine Rufnummern, keine Kalender-Inhalte, keine Kundendaten.
*Folge:* je mehr darin steht, desto besser orientiert der Agent und desto mehr erfaehrt ein
Fremder.

**F7 - SPERRT IEP-P4. Soll die gespeicherte Tenant-Begruessung zurueck in die Eroeffnung?**
Das ist ein **belegter Unterschied** zwischen dem Anruf, den du gut fandest, und dem, der
durchfiel: in Test #1 sprach der Agent deine gespeicherte Begruessung, in Test #2 einen generischen
Vorlagensatz (B2).
*Vorschlag:* ja, als zweite ebenso strikte Sollform des Riegels - Namenssatz-Anfang und Hinweis
bleiben Pflicht, nur der freie Teil kommt aus deiner gespeicherten Begruessung.
*Folge ja:* der erste Satz klingt wieder wie in Test #1.
*Folge nein:* der generische Satz bleibt, und der Kandidat mit dem staerksten Beleg fuer
"klang besser" bleibt ungenutzt.

**F8 - SPERRT IEP-P6. Wortlaut der Inbound-Owner-Eroeffnung - mit oder ohne Transkriptions- und
Zusammenfassungs-Hinweis?**
Die KI-Kennzeichnung bleibt in jedem Fall. Der heutige Riegel verlangt BEIDE Bausteine (B14). Ein
Wegfall des Hinweises wechselt die Begruendung von Art. 50 AI Act (KI-Kennzeichnung, unberuehrt) auf
eine DSGVO-Information, zu der im Repo **keine Rechtsanalyse existiert**. Zu bedenken: dein
Outbound-Vergleichsanruf ist ein Self-Call und traegt gar keinen Offenlegungssatz - der
Inbound-Owner-Fall wird also selbst im besten Fall zwei Saetze statt einer halben Zeile haben.
*Vorschlag:* Hinweis **behalten** (`Hallo Antonio, hier ist dein KI-Assistent. Das Gespräch wird
transkribiert und zusammengefasst.`) - diese Kette baut keinen Wegfall.
*Folge behalten:* P6 ist sofort baubar, der Riegel bleibt unveraendert scharf.
*Folge weglassen:* P6 wartet, bis eine Rechtsentscheidung schriftlich vorliegt; ein Wegfall wuerde
bedeuten, dass ein Fremder mit gefaelschter Absendernummer ohne Transkriptionshinweis spricht,
waehrend das Gespraech transkribiert, zusammengefasst und per SMS zugestellt wird.

**F9 - SPERRT IEP-P7. Was gilt als bestanden, festzulegen VOR dem Anruf?**
*Vorschlag:* zwei reproduzierbare Ohrzeugen-Laeufe ohne Fremdton und ohne `tone_stream`-Ereignis;
unbeantwortetes Fenster unter 0,8 s (kuerzer als die 1,03 s in Test #1); Stille unter der in F4a
gesetzten Schwelle; M-U1 gemessen und nicht rot.
*Und ausdruecklich mit zu entscheiden:* wie wird der Fall bewertet, dass die Kette maschinell
komplett gruen ist und du die Ansage trotzdem hoerst, weil sie vor Telnyx entsteht? *Vorschlag:*
das gilt nicht als Scheitern der Kette, sondern loest die Carrier-Spur aus (F5).

**F10 - Nicht sperrend fuer den Owner-Test, sperrend fuer den Rollout: F3 und F4 aus
`iex-spec-a.md` §9.**
(a) Betreiber-Alarm fuer gescheiterte Inbound-Uebergaben - heute kennt der Ausfall-Melder nur
Outbound, ein EL-Totalausfall faellt nach dem Rollout niemandem auf. (b) Benachrichtigung, wenn
jemand in der Wartephase auflegt.
*Vorschlag:* (a) ja, als kleine eigene Phase vor dem Rollout; (b) nein.
*Folge:* ohne Entscheidung bleibt der Rollout gesperrt, unabhaengig vom Owner-Test.

**F11 - Optional, unabhaengig von der Sperre "kein Owner-Testanruf vor belegtem Fix": Soll ein
Testanruf von einer ANDEREN Nummer aus einem anderen Netz erfolgen?**
Er trennt Leitung und Handy des Owners von Carrier und Telnyx und verbraucht die Owner-Reserve
nicht - braucht aber eine zweite Person.
*Vorschlag:* ja, falls jemand verfuegbar ist; es ist die einzige Messung, die "liegt es an meinem
Anschluss" beantwortet.
*Folge nein:* diese Unterscheidung bleibt dauerhaft offen.

---

## Anhang: bewusst verworfene Wege

Kurzliste, damit sie nicht in einer spaeteren Runde als neue Idee zurueckkehren. Begruendungen
stehen in Abschnitt 6 (R9-R14) bzw. bei der jeweiligen Phase.

- Rufnummernwechsel, Nummernkauf, +49-DID - in jeder Form, auch als Nebensatz.
- Die SIP-Ladder als blockierende Phase (sie ist Parallelspur, F5).
- `ringTone` am `<Dial>` als Loesung (der Default ist genau der US-Doppelton aus Test #1).
- Sofortannahme ausliefern und die Fuellung vertagen (waere hoerbar schlechter als heute).
- Rueckkehr des TeXML-Pflichtsatzes vor dem Dial (Owner abgelehnt; kostete in #1 ~1,0 s Stille).
- `get_consult`/`look_up` fuer Inbound freischalten (R9).
- Ein EL-eigenes `take_message`-Werkzeug (R12); ein zweiter EL-Agent (R11).
- Codec-Umstellung des Inbound-Beins (R10, mit Wiedereintritts-Bedingung).
- EL `record_voice` befristet wieder an (widerspricht Owner-Entscheidung O2; der Telnyx-Mitschnitt
  auf UNSEREM Mess-Bein leistet dasselbe ohne Dritt-Beteiligung).
- Turn-/ASR-/Barge-in-Parameter "schnell" nachziehen (R13).
- `convo-bench`/`stt-wer.mjs`/`telnyx-call-latency.mjs` auf den EL-Pfad umbauen (R14).
- Die letzte `nachdeploy`-Reserve fuer einen weiteren M7/M8-Maschinenanruf verbrauchen (er kann die
  Tonfrage strukturell nicht beantworten).
- Die bestehende Zielsperre des Messwerkzeugs oeffnen (stattdessen ein engerer Pruefer daneben).
- Caller-ID-Spoofing der Owner-Nummer; die hinterlegte Nummer fuer einen Ton-Test umbiegen (R5).
- Mitbenutzung von `calleeIsOwner`, `OWNER_SELF_CALL_ENABLED`, `OWNER_SELF_CALL_TENANT_IDS`.
- Den Eroeffnungs-Riegel fuer den Owner-Fall lockern (stattdessen zweite strikte Sollform).
- Die Besitz-Verifikation jetzt bauen (gross, und fuer das Bestehen des Owner-Tests ohne Wirkung).
- `outboundAgentConfigFor()` reaktivieren oder entfernen (Aufraeumfrage, gehoert in einen TD-Sweep).
- `MAX_BUDGET_EUR`, `OUTBOUND_FROZEN`, pro-Tenant-Kostendecke, Signaturpruefung oder den
  Offenlegungssatz im Zuge dieser Kette anfassen.
- Die Roboter-Ansage per Argument wegdefinieren ("sie entsteht ohnehin vor Telnyx") - ohne
  SIP-Ladder ist das Indiz, nicht Beleg.
