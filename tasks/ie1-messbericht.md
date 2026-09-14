# IE1 Messbericht — Stand 2026-09-14, nachts

**Ergebnis vorneweg: IE1 ist NICHT gemessen. 0 von 6 Fragen (F-A…F-F) sind durch einen
echten Anruf belegt.** Der Grund ist nicht der Anbieter, sondern die Ausfuehrungsumgebung:
der Auto-Mode-Classifier hat drei Schritte abgelehnt, und diese Ablehnungen wurden nicht
umgangen.

| Schritt | Ablehnungsgrund (Classifier) |
|---|---|
| Lokaler Fangserver + `cloudflared`-Quick-Tunnel fuer TeXML-/`action`-Rueckrufe | `External Ingress Tunnel` |
| Messskript, das die Testanrufe ausloest (Telnyx → ElevenLabs-SIP, kein Mensch am Ende) | `Real-World Transactions` |
| Nur-Lese-Abfrage der Prod-DB (Kostenprofile der letzten 45 Tage) | `Production Reads` |

**Folge fuer die Kette:** IE5 darf ohne IE1 nicht gebaut werden (Plan, Phase IE5,
"Abhaengigkeiten"), und das ist gerade wichtiger geworden, nicht weniger — s. Befund B-2
unten. IE6 Stufe 3 haengt an IE5. Gebaut wird in dieser Nacht nur, was an keinem der
beiden haengt: IE6 Stufe 1 (Telnyx-AI-Assistant) und Stufe 2 (OpenAI-Realtime-Bridge).

---

## 1. Was ohne Anruf belegt ist

Alle Werte am 2026-09-13 zwischen 20:40 und 21:05 UTC erhoben, nur lesend, sofern nicht
anders vermerkt. Keine Rufnummer im Klartext (nur die letzten vier Ziffern).

### B-1 — Die Testnummer traegt SEHR WOHL eine Inbound-Freigabe (widerspricht dem Kickoff)

`GET /v1/convai/phone-numbers` + je `GET .../{id}`: vier Registrierungen, alle am Agenten
"Hermes".

| Registrierung | Label | Nummer | supports_inbound | inbound_trunk |
|---|---|---|---|---|
| `phnum_0701m18z3h2tex79r3vscsk5jxqq` | hermes-num_… | …1188 | false | null |
| `phnum_1101m00pjrg7e1js7aaxwp8hdw38` | Spike2 Telnyx | …0177 | **true** | **`allowed_addresses: ["0.0.0.0/0"]`, `allowed_numbers: [<eigene Nummer>]`, keine Zugangsdaten, `media_encryption: disabled`** |
| `phnum_1801m18z2twbeexajb3edv1xbbt2` | hermes-num_… | …4874 | false | null |
| `phnum_4001m18yyw9jfp287kky86e3egn2` | hermes-num_… | …8341 | false | null |

Der Kickoff schrieb "keine davon traegt heute `inbound_trunk_config`". **Das stimmt nicht.**
Die Spike2-Registrierung nimmt INVITEs von jeder IP an, gefiltert nur ueber eine
(faelschbare) Absendernummer. Das ist offene Messung **M20** und weiter offen. Die
Nummer …0177 gehoert laut Memory `e5-absender-did-live` seit 24.08. nicht mehr zu unserem
Telnyx-Konto; die Registrierung ist in Produktion unreferenziert. Schadensbild heute gering
(ohne Pflichtvariablen beendet der Agent sofort, s. B-2), aber es ist eine offene Tuer.
**Nicht angefasst** — Aufraeumen ist eine Owner-Entscheidung.

Nebenbefund lokal: `.env` `ELEVENLABS_AGENT_PHONE_NUMBER_ID` zeigt auf genau diese
Spike2-Registrierung. Live ist das laut Memory die …8341-Registrierung; lokal ist nicht live.

### B-2 — Der Live-Agent kann einen Inbound-INVITE so, wie er ist, nicht fuehren (neue Praemisse fuer IE5)

`GET /v1/convai/agents/<id>`:

- `first_message`, Prompt und Werkzeuge referenzieren **14** dynamic variables:
  `owner_name, opening_line, callee_relation, callee, objective, constraints, background,
  today, owner_timezone, callee_timezone, consult_available, lookup_available, mandate,
  voicemail_line`.
- `dynamic_variable_placeholders` gibt es nur fuer **4** davon (`owner_name`, `objective`,
  `callee`, `mandate`). Die anderen 10 haben keinen Ersatzwert.
- Spike 2 hat am 2026-08-14 gemessen: fehlt eine Variable der `first_message`, beendet
  ElevenLabs das Gespraech direkt nach dem Abheben mit Code 1008 — der Angerufene hoert
  Stille (`tasks/spike2-messung.jsonl`, Anrufe 1+2).
- SIP-`X-`Header werden laut Doku zu `sip_*`-Variablen (B3 im Plan). Ein Header kann
  also `opening_line` o.ae. **nicht** fuellen.

**Was daraus fuer K1 folgt, und das stand so nicht im Plan:** F-B fragt nur, OB Variablen
ueber den Header ankommen. Die schaerfere Frage ist, ob der **unveraenderte Outbound-Agent**
einen Inbound-Anruf ueberhaupt beginnt. Nach heutiger Beleglage beginnt er ihn nicht (1008).
Und selbst mit allen Variablen spraeche er seine `first_message` — den **Outbound**-
Offenlegungssatz ("im Auftrag von …") — direkt nach unserem Inbound-Pflichtsatz: Doppelansage
mit falschem Inhalt. Ein Override-Kanal fuer `first_message` existiert ueber SIP nicht.

Drei Wege, die IE5 dafuer braucht — **keiner gemessen, keiner entschieden**:

1. `inbound_trunk_config.attributes_to_headers` (API-Schema: "Map of dynamic variable name
   to header name") — moeglicherweise der Kanal, der Header auf NICHT-`sip_`-Variablen
   abbildet. Dazu eine `first_message`, die aus einer Variablen entsteht. Das beruehrt den
   Outbound-Agenten (Art.-50-Riegel `startsWith`), also Outbound-Byte-Identitaet.
2. Der Conversation-Initiation-Webhook des Agenten (heute `null`). Unter K1 laege er
   HINTER unseren sieben Sicherungen und wuerde nur anreichern; unsigniert bleibt er
   trotzdem (K3-Befund 1) — braucht eine eigene Auth-Betrachtung (z.B. ein Einmal-Token je
   Anruf im SIP-Header, sofern der Webhook Header sieht — unbelegt).
3. Eine zweite Agenten-Konfiguration nur fuer Inbound. Das waere ein zweiter Prompt —
   am Owner-Massstab ("EIN Ort, an dem Gespraechslogik lebt") fragwuerdig; Owner-Frage.

### B-3 — F-E teilweise: eine Registrierung traegt beide Richtungen

Die Spike2-Registrierung zeigt live `supports_inbound=true` UND `supports_outbound=true`
mit vollstaendigem `inbound_trunk`- und `outbound_trunk`-Objekt. Dass dieselbe Nummer beides
tragen kann, ist damit **belegt** (Quelle: `GET /v1/convai/phone-numbers/phnum_1101…`).
**Unbelegt** bleibt der zweite Halbsatz von F-E: dass ein PATCH von `inbound_trunk_config`
die gemessene `outbound_trunk`-Projektion nicht veraendert.

### B-4 — Anbieter-Doku, die den Probe-Aufbau ohne Nummernkauf und ohne Tunnel moeglich macht

| Beleg | Quelle |
|---|---|
| TeXML-Anruf per API nimmt Inline-Anweisungen: `Texml` ("the call will execute these instructions instead of fetching from the Url"); ebenso Update-Call (`Texml`, `Status=completed`) | Telnyx OpenAPI "InitiateCallRequest"/"UpdateCallRequest" (telnyx-go `texmlaccountcall.go`) |
| Call-Control- und TeXML-Applikationen haben `inbound.sip_subdomain` + `sip_subdomain_receive_settings: only_my_connections` — Anrufe an `sip:<beliebig>@<sub>.sip.telnyx.com` landen dort | developers.telnyx.com/api-reference/texml-applications/creates-a-texml-application |
| `<Dial>`: `action`, `method`, `timeout` (5–120), `timeLimit` (60–14400), `answerOnBridge`; `DialCallStatus` an `action`. `<Sip>`: `username`, `password`, `statusCallback`; eigene Header laut Doku-Zusammenfassung ueber URI-Query (`?X-Header=value`) — **nicht gemessen** | developers.telnyx.com/docs/voice/programmable-voice/texml-verbs/dial |
| EL `inbound_trunk_config`: `allowed_addresses`, `allowed_numbers`, `media_encryption`, `credentials{username,password}`, `remote_domains`, `attributes_to_headers` | elevenlabs.io/docs/api-reference/phone-numbers/update |
| EL-Doku nennt die Zuordnung INVITE → Nummer → Agent weiterhin NICHT (B4 unveraendert), nennt keine Fehlercodes fuer unbekannte Kennungen, und sagt nichts dazu, was bei fehlenden Pflichtvariablen passiert | elevenlabs.io/docs/eleven-agents/phone-numbers/sip-trunking |

### B-5 — Live-Konfiguration (Render-Boot-Banner, Instanz `-4pb9z`, 2026-09-13 20:22 UTC)

- `Assistant-Pfad: AKTIV (TELNYX_AI_ASSISTANT_ENABLED=true)` — **der Kickoff nannte ihn "Schalter aus"; das stimmt nur fuer den Inbound-Handoff** (`TELNYX_INBOUND_HANDOFF_ENABLED=false`).
- `Voice-Engine: budget`; `Inbound-Sprechpfad: play_tts`; `Outbound: aktiv`.
- Agent-Turn-Konfiguration: `silence_end_call_timeout: 30`, `max_duration_seconds: 600`
  (wichtig fuer F-C: ein `timeLimit`-Test braucht Aktivitaet auf der Leitung, sonst beendet
  der Agent nach 30 s Stille selbst).

### B-6 — Kassenstand vor der Messung

Telnyx-Guthaben 6,44 USD. ElevenLabs Tarif `starter`, 21 306 von 58 622 Credits verbraucht.

### B-7 — Drift-Waechter vorher

`npm run elevenlabs:drift` → exit 1, "ROT - 5 besessene Felder weichen ab (davon 2 bewusst
ausgenommen)", 0 Verbots-Verletzungen. Das ist der Bestand vor jeder IE1-Handlung; Rohausgabe
lag im Scratch der Sitzung. Da keine Anbieter-Konfiguration geaendert wurde, bleibt er gleich.

---

## 2. Was am Anbieter angelegt wurde (kostenlos, keine Nummer)

| Objekt | ID | Zweck | Zustand |
|---|---|---|---|
| Telnyx TeXML-App "IE1 Messung Uebergabe (Wegwerf)" | `3048315229369796444` | traegt den Probe-Anruf mit Inline-TeXML | `voice_url` ist ein Platzhalter, wird bei Inline-TeXML nie gerufen; Outbound-Profil MCP |
| Telnyx Call-Control-App "IE1 Messung Mensch (Wegwerf)" | `3048315366347376485` | spielt den Anrufer, per SIP-Subdomain `hermesie15c3d4cd0` | `only_my_connections`; Webhook auf einen nicht existierenden Pfad von `sundartha.com` |

Beide sind ohne Nummer und ohne Verkehr. Loeschen, falls die Messung nicht gefahren wird:
`DELETE /v2/texml_applications/3048315229369796444` und
`DELETE /v2/call_control_applications/3048315366347376485`.

Am ElevenLabs-Konto, am Live-Agenten, an den vier Registrierungen und an der produktiven DID
wurde **nichts** geaendert.

---

## 3. Der fertige Probe-Aufbau (braucht die Freigabe fuer echte Testanrufe)

Kein Tunnel noetig, keine Nummer kaufen, kein Mensch wird angerufen.

- **"Anrufer"**: die Call-Control-App oben. Ein Anruf an ihre SIP-Subdomain wird per
  Polling (`GET /v2/connections/<app>/active_calls`) gefunden, per `answer` angenommen und
  per `record_start` (dual) mitgeschnitten. Die Aufnahme ist das, was ein Mensch gehoert
  haette; Transkription ueber ElevenLabs STT. Per `speak` kann der "Anrufer" reden (haelt
  den Agenten ueber die 30-s-Stillegrenze).
- **"Unser Inbound-Bein"**: ein TeXML-Anruf ueber die TeXML-App oben, `To` = die
  SIP-Subdomain, Inline-`Texml` = exakt die K1-Form:
  `<Say>Pflichtsatz</Say><Dial timeout timeLimit action method><Sip>sip:+<Testnummer>@sip.rtc.elevenlabs.io?X-Hermes-Probe=…</Sip></Dial>`.
- **Belege je Frage**: EL-Gespraechsliste + Detail (Agent, `metadata.phone_call`,
  `termination_reason`, `conversation_initiation_client_data.dynamic_variables`) fuer F-A/F-B;
  Update-Call `Status=completed` und Call-Control-`hangup` waehrend der Bruecke plus EL-
  Gespraechsende fuer F-C; `detail_records` nach einigen Minuten fuer F-D; ein
  PATCH/GET-Vergleich an der Spike2-Registrierung fuer F-E; fuer F-F eine unbekannte Kennung
  (`sip:+1555…@sip.rtc.elevenlabs.io`), falsche Zugangsdaten und die Ist-Filterung
  (`allowed_numbers`) — mit Mitschnitt, ob der Anrufer die Antwort hinter `action` noch hoert.
- **Offene Detailentscheidung fuer F-F:** `action` muss eine abrufbare URL sein. Ohne Tunnel
  bietet sich `https://app.sundartha.com/voice/incoming` an: Telnyx signiert den Rueckruf,
  die Produktion findet die Ziel-"Nummer" nicht und antwortet mit ihrem bestehenden
  Unrouted-Satz ("Diese Nummer ist nicht erreichbar …") plus Hangup — genau die Form des
  Rueckfalls ohne Gehirn. Nebenwirkung: je Probe eine `inbound_unrouted`-Audit-Zeile in
  Produktion. Alternative ohne Produktionsberuehrung: ein Tunnel (vom Classifier gesperrt)
  oder ein TeXML-Bin (nur im Portal anlegbar).
- **Geschaetzte Kosten**: unter 1 USD Telnyx, rund 5 ElevenLabs-Agentenminuten.
- **Rueckstellung danach**: die Spike2-Registrierung auf den oben unter B-1 dokumentierten
  Vorher-Zustand — oder, Owner-Entscheidung, gleich enger (Zugangsdaten statt `0.0.0.0/0`).

**Was der Owner dafuer tun muss:** eine von zwei Freigaben.
(a) Den Classifier fuer diese Messung freigeben (Permission-Regel), dann faehrt der Agent
sie in rund 30 Minuten; oder (b) sagen, dass er selbst ueber `!` ausfuehrt, dann schreibt der
Agent ihm die Befehle.
