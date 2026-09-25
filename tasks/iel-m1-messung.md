# IEL-M1 — Messung Uebergabe Telnyx -> ElevenLabs-SIP (F-A…F-F, M1–M13)

Mess-Agent IEL-M1, 2026-09-14, 14:17–14:50 UTC. Maschine-zu-Maschine, kein Mensch in der Leitung.
Owner-Freigabe: hoechstens 5 Anrufe, je <= 60 s. **Zaehlerstand am Ende: 5/5** (`tasks/iel-m1-zaehler.json`),
Sperre frei. Rohbelege: `tasks/iel-m1-messung.jsonl` (Zeilennummern unten "J<n>").
Nummern nur mit letzten 4 Ziffern. Keine Volltranskripte gelesen.

| J | Lauf | Fall | lauf_id |
|---|---|---|---|
| J1 | kein Anruf | F-E | – |
| J2 | Anruf 1 | F-A (**Messaufbau-Fehlschlag**) | iel-mu1c1dal-8ac9a5 |
| J3 | Anruf 2 | F-A | iel-mu1c9n65-1dda49 |
| J4 | Anruf 3 | F-A-digest (neu) | iel-mu1cgohu-17da25 |
| J5 | Anruf 4 | F-F-unbekannt | iel-mu1ckurt-f937e7 |
| J6 | Anruf 5 | F-F-abgelehnt | iel-mu1cncg5-d9651c |
| J7 | kein Anruf | F-D | – |

Zusaetzliche Belegquellen (nur lesend): Telnyx `GET /v2/texml/Accounts/<acc>/Calls` (Felder
`parent_call_sid`, `sip_hangup_cause`), `GET /v2/call_events?filter[connection_id]=…`,
`GET /v2/detail_records`; ElevenLabs `GET /v1/convai/conversations/{id}` und
**`GET /v1/convai/conversations/{id}/sip-messages`** (liefert 200 mit Roh-SIP; siehe M13).

---

## Anruf 1 — Fehlschlag am Messaufbau (J2)

`GET /v2/connections/<CC-App>/active_calls` lieferte als ersten Eintrag das **TeXML-Elternbein**
(dessen call_control_id == TeXML-sid `v3:tBPChtzfETg…`), nicht das eingehende Bein der Call-Control-App.
`answer` darauf -> HTTP 422 / 90102 "Invalid command"; das echte Bein (call.initiated 14:22:47.533,
`direction incoming`, `state parked`) blieb ungeantwortet, TeXML-Anruf `no-answer`/487 nach 15 s. Kein
ElevenLabs-Kontakt. Zusaetzlich: die TeXML-Anlage-Antwort traegt `call_sid` auf oberster Ebene, nicht
`data.sid` -> Hauptbein-Griff war leer.

**Skript-Korrekturen danach** (Sicherungen unveraendert: Zaehler, Sperre, 60-s-Stufen, Ziel-Allowlist;
jeweils `node --check` + Trockenlauf mit 0 fetch-Aufrufen):
- `scripts/iel-mess.mjs`: Anrufer-Bein aus `call.initiated`-Ereignis (Filter `connection_id`+`name`,
  "to" traegt lauf_id) plus active_calls; jeder Kandidat hoechstens einmal `answer`, erstes 2xx gewinnt.
  Hauptbein aus top-level `call_sid`. `eltern_api`-Stufe legt nur das Elternbein auf (F-C isoliert).
  `ende.anrufer_beendet`. Neuer Digest-Ablauf `mitDigestZugang` (s. Anruf 3).
- `scripts/iel-mess-anbieter.mjs`: `anruferEreignisseAnfrage`; Digest-TeXML (zwei Dials).
- `scripts/iel-mess-belege.mjs`: `metadata.phone_call` (Richtung, Registrierung, Anrufer/Angerufen
  maskiert, `sip_header_dynamic_variables` nur Schluessel), `probe_endung`, "enthaelt lauf_id".
- `scripts/iel-mess.cases.json`: Fall `F-A-digest`.

Vorab ohne Anruf geklaert: Filter `call_start_after_unix` wirkt (Positiv-/Negativkontrolle: 1 bzw. 0
Treffer), `metadata.phone_call.phone_number_id` existiert (OpenAPI `ConversationHistorySIPTrunkingPhoneCallModel`).
Beide Wegwerf-Apps haengen am Outbound-Profil `2982782444253480209` ("MCP", US/CA/DE) — genutzt, nicht veraendert.

---

## Ergebnisse je Fall

**F-A Agenten-Zuordnung — BELEGT (J3).** `<Dial><Sip>sip:+…0177@sip.rtc.elevenlabs.io:5060;transport=tcp?X-Hermes-Probe=…</Sip>`
erreichte den Agenten der Spike2-Registrierung: `conv_2201m2g556dwf69vwxpf22f2xre3`, `agent_id` = Registrierungs-Agent,
`phone_call.type sip_trunking`, `direction inbound`, `phone_number_id phnum_1101…`, Anrufer/Angerufen …0177.
Status `failed`, `termination_reason` "Missing required dynamic variables in first message: {'opening_line', 'owner_name'}",
Dauer 1 s, keine Agent-Nachricht. SIP (sip-messages): INVITE -> 100 -> 180 (9 ms) -> 200 OK (349 ms) -> ACK ->
**BYE von ElevenLabs nach 1,7 s**. Mitschnitt: Pflichtsatz gehoert, Rueckfallsatz gehoert (TeXML laeuft nach Agent-BYE weiter).

**F-B Variablenkanal — BELEGT fuer TeXML (J3, J4).** URI-Header `?X-Hermes-Probe=…` kommt als Header an
(sip-messages: `X-Hermes-Probe` im INVITE) und als Variable `sip_hermes_probe` (in
`conversation_initiation_client_data.dynamic_variables` UND `metadata.phone_call.sip_header_dynamic_variables`,
letzteres ein **Objekt**, keine Liste). Telnyx setzt selbst `X-Telnyx-Call-Control-ID` -> `sip_telnyx_call_control_id`;
Wert = call_control_id des **Dial-Kindbeins** (nicht des Elternbeins), `system__call_sid` ist davon verschieden.
`F-B-cc` nicht noetig, nicht gefahren.

**F-C Elternbein-Griff — TEILWEISE BELEGT (J5 + call_events).** Mit dem Live-Agenten nicht messbar (Bruecke endet
nach ~1,7 s per 1008). Beleg aus Anruf 4, dessen Bruecke 30 s aktiv war (unbekannte Kennung, von EL angenommen):
`POST …/Calls/<eltern-sid> Status=completed` -> **HTTP 202**; call_events: `hangup`-Kommando Eltern 14:38:36.722,
`call_hangup` Eltern 14:38:37.092 (`hangup_source caller`) und Kindbein 14:38:37.106 (detail_record `hangup_details send_bye`).
Nicht voll isoliert: der Wachhund schickte 172 ms spaeter auch `hangup` ans Anrufer-Bein (dort `hangup_source callee`).
`<Dial timeLimit>` nicht gemessen (kein Anruf erreichte 60 s). Eigener F-C-Lauf (isolierte Stufe) fand nicht statt, Budget erschoepft.

**F-D Zweites Bein und Abrechnung — BELEGT (J7 + detail_records).** Jeder Dial erzeugt ein **eigenes Telnyx-Bein**
(eigene id, gleiche `telnyx_session_id` wie das TeXML-Elternbein), abgerechnet **doppelt gelistet**: `sip-trunking`
(cost 0, rate 0, route Intra) und `call-control` (rate 0,002 USD/min; z.B. 2 s -> billed 6 s -> 0,0002 USD; 30 s ->
0,001 USD). Taktung sichtbar 6 s (2->6, 38->42). Record-Type `texml` ist ungueltig (HTTP 400). Gescheiterte Dials:
0 s, cost 0. Telnyx-Guthaben 6,42 -> 6,40 USD fuer alle Laeufe.

**F-E Nummer doppelt belegbar — BELEGT (J1).** PATCH `inbound_trunk_config` (Werte unveraendert) -> HTTP 200;
`outbound_abweichend []`, `inbound_abweichend []` (outbound_trunk inkl. `has_auth_credentials true` + username erhalten).
Keine Nebenwirkung sichtbar.

**F-F Fehlerfall — BELEGT fuer vier Fehlerbilder, `<Dial action>` OFFEN.**

| Fehlerbild | SIP/Telnyx | EL-Gespraech | TeXML danach | Anrufer hoert |
|---|---|---|---|---|
| Agent bricht ab (fehlende Variable), J3/J4 | 200 OK, dann BYE von EL nach ~1,7 s (`recv_bye`) | ja, `failed` 1008-Text | laeuft weiter | Rueckfallsatz (J3, J4) |
| Absender nicht in `allowed_numbers`, J6 | **404** (`sip_invite_failure_status 404`, `UNALLOCATED_NUMBER`, `recv_refuse`) nach 0,7 s | nein | laeuft weiter | Rueckfallsatz (J6) |
| Digest-Zugangsdaten fehlen, J4 Dial 2 | 407-Challenge -> Telnyx `send_cancel`, 487, `MANDATORY_IE_MISSING`, 0 s | nein | laeuft weiter | Rueckfallsatz (J4) |
| **Unbekannte Kennung** (+…0199), J5 | **200 OK** (`call_answered` 0,9 s nach Dial, `call_bridged`) | **nein** | **bleibt im Dial** | **Stille** bis Wachhund (30 s), Rueckfallsatz NICHT gehoert |

Letzte Zeile ist der gefaehrliche Fall: ein Tippfehler/fehlende Registrierung ergibt Stille statt Rueckfall; nur
`timeLimit` (60 s) oder unser Hangup beendet ihn. Vermutung, **unbelegt**: EL/LiveKit matcht den Trunk ueber
Absender (…0177 in `allowed_numbers` der Spike2-Registrierung) + IP-ACL 0.0.0.0/0 ohne Pruefung der angerufenen
Kennung und findet dann keinen Agenten; ob ein Anrufer ausserhalb jeder `allowed_numbers` ebenfalls Stille bekaeme, ist ungemessen.

**Digest (M3) — BELEGT (J4).** Wegwerf-Zugangsdaten zur Laufzeit erzeugt, PATCH -> 200, GET `has_auth_credentials true`.
Dial 1 MIT `<Sip username password>`: sip-messages `INVITE -> 100 -> 407 (Proxy-Authenticate) -> ACK -> INVITE mit
Proxy-Authorization (+0,29 s) -> 180 -> 200 OK`, Gespraech `conv_4401m2g5fdbtfmav5herb5sjyf8q` (`probe_endung -mit`, 1008).
Dial 2 OHNE: kein Gespraech, detail_record 487/`send_cancel`. **Zugangsdaten werden erzwungen, obwohl
`allowed_addresses ["0.0.0.0/0"]` gesetzt ist** (ohne Zugangsdaten auf der Registrierung, J3: kein 407).
Rueckbau: PATCH mit `credentials: null` -> 200, GET `has_auth_credentials false`, `inbound_wie_vorher true`,
`outbound_wie_vorher true` (Beleg im Feld `digest` von J4).

**allowed_numbers (M2) — BELEGT (J6).** Einzige Aenderung gegenueber J3: Absender/`callerId` +…0198 statt …0177.
Ergebnis SIP 404, kein Gespraech. `allowed_numbers` ist ein **Absender-(From-)Filter**.

---

## Messfragen aus R1

| M | Ergebnis | Beleg |
|---|---|---|
| M1 | Request-URI-User `+<E.164>` trifft die Registrierung mit gleicher `phone_number` (J3). `To`-Header nicht getrennt variiert (TeXML setzt ihn gleich) -> **offen**. Nichttreffer: **200 OK + Stille, kein Gespraech** (J5), kein SIP-Fehler | J3, J5, detail_record `e664cba6…` |
| M2 | Ja, Absender-Filter; Ablehnung = **404** | J6, detail_record `2c1b5dea…` |
| M3 | Ja: EL challengt mit **407**, TeXML `<Sip username password>` antwortet mit Proxy-Authorization | J4, sip-messages conv_4401… |
| M4 | **TCP**; `;transport=tcp` wird beachtet (EL `transport TCP`, local :5060) | sip-messages J3/J4 |
| M5 | Quell-IP **192.76.120.10** (Telnyx US, Default-`sipRegion`), auch BYE-Ziel :5060. Andere Regionen ungemessen -> **offen** | sip-messages `remote_address` |
| M6 | nach Deploy zu messen (braucht Webhook-Endpunkt) | – |
| M7 | nach Deploy zu messen | – |
| M8 | nach Deploy zu messen | – |
| M9 | Ja -> `sip_hermes_probe`; plus automatisch `sip_telnyx_call_control_id` (Kindbein) | J3/J4 |
| M10 | Placeholders greifen im SIP-Inbound **nicht** fuer `first_message` (`owner_name` hat einen, steht trotzdem in der 1008-Liste). Prompt-/Werkzeug-Variablen **offen** (Abbruch schon an first_message) | J3, J4 `abbruchgrund` |
| M11 | nach Deploy zu messen | – |
| M12 | nicht gemessen -> **offen** | – |
| M13 | `GET /v1/convai/phone-numbers/{id}/sip-messages` weiter **403 HTML** (14:3x UTC); **`GET /v1/convai/conversations/{id}/sip-messages` -> 200** mit Roh-SIP, `local/remote_address`, `transport` (jede Nachricht doppelt gelistet). Ursache des 403 **offen** | lesende GETs |

---

## Aufraeumen / Endzustand

- Spike2-Registrierung `phnum_1101m00pjrg7e1js7aaxwp8hdw38`: GET nach allen Laeufen identisch zum Ausgangszustand
  (`allowed_addresses ["0.0.0.0/0"]`, `allowed_numbers […0177]`, `media_encryption disabled`, `has_auth_credentials false`,
  `remote_domains null`, `attributes_to_headers {}`; outbound_trunk unveraendert, Agent unveraendert). F-E ohne Nebenwirkung.
- `setup` nicht gelaufen -> kein `teardown` noetig, keine Wegwerf-Registrierung.
- Telnyx-Wegwerf-Apps `3048315229369796444` (TeXML) und `3048315366347376485` (Call Control) **bestehen weiter**
  (ohne Nummer), active_calls 0. Loeschen ist Owner-/Lead-Entscheidung (Befehle in `tasks/ie1-messbericht.md` §2).
- Mitschnitte der Anrufer-Beine liegen bei Telnyx (Aufnahmen `c5c68c58…`, `b447bc86…`, `c4b8d76a…`, `ad99e0d6…`), nur Maschinenansagen.
- Live-Agent, Workspace, produktive DIDs, Render, Prod-DB, Outbound: nicht angefasst. Kein git-Commit.

## Offen, baurelevant

1. **Unbekannte Kennung = Stille** (J5): der Bau braucht eine eigene Zeitgrenze fuer "Dial verbunden, aber kein Gespraech"
   bzw. darf sich nicht auf den TeXML-Rueckfall verlassen; `<Dial action>`-Aufruf im Fehlerfall ungemessen.
2. Der unveraenderte Agent bricht jeden SIP-Inbound nach ~1,7 s ab (1008, `first_message`-Variablen) — ohne
   Init-Webhook oder Agent-Aenderung ist kein Inbound-Gespraech moeglich (M6–M8, M10, M11 nach Deploy).
3. Korrelation Anruf <-> EL-Gespraech: eigener X-Header (`sip_<name>`) funktioniert; `sip_telnyx_call_control_id` zeigt aufs Kindbein.
4. Kosten: je Inbound ein zusaetzliches call-control-Bein (0,002 USD/min, 6-s-Takt) neben dem Elternbein.
5. F-C isoliert (nur Elternbein) und `<Dial timeLimit>` nicht belegt; M1-`To`, M5 fuer EU-Region, M12, M13-Ursache offen.
