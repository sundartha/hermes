# Die ~91-Sekunden-Kappung — Befundstand 2026-08-10

Alle Zeiten UTC. **Regel dieser Datei: jede Zeile ist gemessen. Vermutungen sind als
solche markiert.** Quellen: Produktions-Postgres, Render-Logs/-Metriken, Telnyx-REST-API,
Code-Inventur.

## 1. Der Befund

51 Outbound-Anrufe seit 2026-07-11 (alle von einer US-DID an dieselbe DE-Mobilnummer,
alle ueber den ASSISTANT-Pfad — `call.assistant_id` ist bei allen 51 gesetzt).

**Neun Anrufe enden in einem Fenster von 0,37 Sekunden:**
90,92 / 90,99 / 91,14 / 91,17 / 91,20 / 91,22 / 91,25 / 91,28 / 91,29 s
(gerechnet `answered_at` -> `ended_at`). Alle neun liegen zwischen dem 04.08. und dem 10.08.

Weiter im weiteren Band 88,9–92,3 s: 88,92 (06.08.), 90,32 (09.08.), 90,86 (01.08.),
92,00 (13.07.), 92,29 (05.08.), 93,86 (27.07.).

**Gegenprobe — die Grenze ist nicht absolut.** Im selben Zeitraum liefen durch:
97,65 (08.08.) · 114,14 (31.07.) · 163,78 (01.08., mit `failure_reason=max-duration-cap`) ·
164,49 (06.08.) · 176,75 (06.08.) · 179,52 (04.08.) · 190,38 (03.08.).

**Der Anker ist das Abheben, nicht das Waehlen:** Streuung der drei Owner-Anrufe ab
`answered` = 0,37 s, ab `started` = 4,4 s.

**Der Timer laeuft unabhaengig vom Gespraechszustand.** Beim Anruf 07:31 (10.08.) traf der
Hangup den Agenten mitten im Wort; beim Anruf 08:24 hatte er ausgeredet und schwieg bereits
6,5 s (letzter `turn_ok` 08:26:00,044 mit 62 Zeichen ~ 3,5 s Sprechzeit; Hangup 08:26:10,065).

## 2. Ausgeschlossen — jeweils mit Beleg

| Kandidat | Beleg fuer den Ausschluss |
|---|---|
| Unser Max-Dauer-Cap | 5 Anrufe mit `max_duration_s=1800` endeten bei 91 s. Positivkontrolle: der Cap-Pfad SETZT `failure_reason='max-duration-cap'` (Anruf vom 01.08.) — bei allen 91-s-Anrufen ist das Feld leer. |
| Dial-statt-Answer-Anker | s.o., Streuung ab `started` ist 12x groesser |
| Turn-Limit | gedeckelte Anrufe haben 3–12 `caller_turns` |
| Telnyx-Konfiguration | ueber 10 Assistant-Versionen (12.07.–09.08.) hat sich KEIN Zeit-/Timeout-/Limit-Feld je geaendert. `time_limit_secs`=1800 durchgehend, `user_idle_timeout_secs`=null, `tools`=[]. Kein Feld liegt bei 90/91. |
| Timeout x Retry-Ketten | max. durchgesetzte Turn-Obergrenze 22,75 s (theoretisch 48,5 s). `llmBreakerCooldownMs(30000)x3=90000` ist Zahlenzufall — ein offener Breaker wirft sofort, er wartet nie. |
| HTTP-Server-Timeouts | Node 22 Defaults, keiner steuert die Antwortdauer: `headersTimeout`=60000, `requestTimeout`=300000, `keepAliveTimeout`=5000, `server.timeout`=0. Keine SSE-Ping/Pong. |
| Prozessabsturz / OOM | Speicher 112 MB von 537 MB (21 %), CPU < 8 %. Instanz `wlm9p` lief 07:27–07:49 durch (Anruf 07:31), Instanz `sbxvp` ab 07:50 durchgehend (Anruf 08:24). Instanzwechsel = die zwei Deploys. |
| Express-4-Fehlerfalle | `[guard] unhandledRejection` kommt im ganzen Fenster 24x vor — **alle** mit `setTenantSubscription: Tenant ... nicht gefunden`, **keine einzige** waehrend eines Anrufs. |
| Stummer Terminierungspfad | 12 Pfade inventarisiert: **keiner ist gleichzeitig stumm UND spurlos.** Jeder loggt, setzt `failure_reason`, oder beides. |
| Timer aus einem frueheren Anruf | Call-IDs eindeutig, alle Registries per-`callId`, jeder Timer-Callback liest den Call frisch und prueft `status==="active"`, Boot-Rearm rechnet gegen `answeredAt`. |
| GQ-P17 / GQ-P18 (Sprechsperre) | Band existiert seit 04.08.; GQ-P17 live erst 09.08. 15:45, GQ-P18 erst 09.08. 17:40. |
| Deploys im Verdachtsfenster | Zwischen dem 190-s-Anruf (03.08. 08:42) und dem ersten 91-s-Anruf (04.08. 14:03) liegen 4 Deploys. Drei sind reine Doku. Der vierte (`0d9a23cf`, GQ-S1, live 12:59:47) ist **reines Logging** — Diff gelesen: eine Log-Zeile je Request, ein Hash-Helfer, `{atMs, chars, hash}` je Call. Kein Gate, kein Timer, kein Abbruch. |
| SIP-Signatur als Unterscheidungsmerkmal | `normal_clearing / callee / sip 200` tragen **auch** die langen Anrufe (177 s, 180 s). Unterscheidet die Gruppen NICHT. Nur der 164-s-Anruf weicht ab (`caller` / `unspecified`). |

## 3. Nicht pruefbar mit unseren Mitteln

- **SIP-Traces gibt Telnyx uns grundsaetzlich nicht.** Portal-Antwort woertlich: *"SIP messages
  that belong to PSTN carriers or external parties are not displayed."* Wir haben kein eigenes
  SIP-Geraet. REST: `/v2/debugging*`, `/v2/calls`, `/v2/detail_records/<id>` → 404;
  `/v2/calls/<ccid>` → 422 fuer beendete Calls. PCAP-Export lieferte 24 Byte (leerer Header).
- `/v2/call_events` funktioniert und liefert das vollstaendige `call.hangup`-Payload —
  es enthaelt **kein** SIP-Header-Feld und kein `Session-Expires`.
- Render-Logretention beginnt faktisch am 03.08. (Abfrage 12.07.–03.08. liefert `logs: null`).

## 3b. GEKLAERT durch Telnyx (2026-08-10): das BYE kommt vom Ziel-Carrier

Telnyx hat auf Anfrage des Owners die carrier-seitigen Daten zu
`e86335bd-ee8a-442e-bb7b-1ed33c2256e0` ausgewertet. **Entscheidend ist ein Feld, das die
oeffentliche API NICHT herausgibt:**

    hangup_source  = callee
    hangup_details = recv_bye      <- Telnyx hat das BYE EMPFANGEN
    hangup_code    = 16 (NORMAL_CLEARING)
    sip_hangup_cause = 200

**`recv_bye` ist der Beleg:** das BYE kam von aussen, nicht von Telnyx und nicht von uns.
Telnyx' Einschaetzung: Muster konsistent mit einem **nicht aufgefrischten 90-s-Session-Timer
(RFC 4028)** auf der Seite des deutschen Mobilfunk-Carriers. Kein Telnyx-seitiges Limit
(`time_limit_secs=1800` wird nicht ausgeloest), keine Kontobeschraenkung.

SIP-Reason-Header und PCAP bleiben unzugaenglich, weil der Call zu einem PSTN-Carrier
terminiert — das bestaetigt die Portal-Meldung aus Abschnitt 3 unabhaengig.

**Konsequenz: in unserem Code nicht behebbar.** Offene Wege: Support-Ticket zur
Carrier-Eskalation (Entwurf mit allen 13 Session-IDs erstellt) und ein Test gegen eine
ANDERE Zielnummer/einen anderen Carrier.

**Zweite Telnyx-Antwort (10.08.), Fall ist beim NOC in der Warteschlange.** Telnyx hat den
gekappten Anruf gegen den 190-s-Anruf gelegt — beide ueber dieselbe Connection
(`3000979485014098987`), dieselbe Route, dieselbe DID, dasselbe Ziel. **Entscheidend: der
190-s-Anruf endete EBENFALLS mit `hangup_source=callee` / `normal_clearing`.** Er wurde also
nicht anders beendet, nur spaeter — genau das Bild, das entsteht, wenn der Session-Refresh
dort durchkam und das Gespraech normal endete. Telnyx' Lesart deckt sich damit: Carrier
verhandelt vermutlich `Session-Expires`=90 s, der Refresh scheitert intermittierend; gelingt
er, laeuft der Anruf weiter.

Die SIP-Ebene (Session-Expires-Header, re-INVITE/UPDATE und deren Antworten) ist auch fuer
den Telnyx-Support selbst nicht einsehbar — nur fuer das NOC. **Von unserer Seite ist hier
nichts mehr zu messen.**

**Die Owner-Praemisse "der Fehler liegt zu 100 % bei uns" war fuer die 91-s-Kappung nicht
zutreffend — fuer den parallel laufenden Dead-Air-Defekt (Abschnitt 5b) aber sehr wohl.**
Beide erzeugen dasselbe Erlebnis am Telefon (Agent bricht ab, Leitung reagiert nicht mehr).
Genau deshalb wurden sie eine Session lang als EIN Sachverhalt gefuehrt. Das ist die
wiederkehrende Falle dieses Projekts: zwei Sachverhalte auf einem Label.

## 4. Der naechste Schritt: die fehlende Kontrollgruppe

**Alle 51 Anrufe liefen ueber den ASSISTANT-Pfad.** Es existiert keine Messung des anderen
Pfades. Der Schalter dafuer ist ein Env-Flip ohne Deploy:

    TELNYX_AI_ASSISTANT_ENABLED=false

Dann laeuft Outbound ueber die Budget-Engine (TeXML/Gather, eigene STT) — anderer Code, kein
Shim, kein Telnyx-AI-Assistant. Ein Testanruf ueber 2 Minuten entscheidet:

- **kappt bei ~91 s** → der Assistant-Pfad ist NICHT die Ursache; die Ursache liegt tiefer
  (Telnyx-Plattform oder Strecke).
- **laeuft durch** → die Ursache liegt im Assistant-Pfad (Telnyx-Assistant oder unser Shim),
  und die Suche ist auf einen Bruchteil des Codes eingegrenzt.

Rueckweg: Wert wieder auf `true`. Preis waehrend des Tests: Budget-Engine hat kein Barge-in
und andere Gespraechsqualitaet.

## 5. Owner-Aussagen (bindend, nicht neu aufmachen)

- Telnyx-Konto vollstaendig verifiziert; Trial-Hypothese erledigt.
- US-DID / Netzstrecke ausdruecklich ausgeschlossen (zweimal bestaetigt).
- Owner-Bewertung: der Fehler liegt auf unserer Seite, weil das Verhalten neu ist.

## 5b. REPRODUZIERT: der Dead-Air-Watchdog kappt aktive Gespraeche

**Testanruf `call_msn34lpf77wg` (10.08. 10:24:55,884 -> 10:26:21,931 = 86,05 s), ASSISTANT-Pfad.**
Der Agent war angewiesen, laut mitzuzaehlen; der Owner hat nur zugehoert.

```
10:26:21.689  [telnyx-watchdog] dead_air {"callId":"call_msn34lpf77wg","turnSeq":3}
10:26:21.931  call.hangup ... hangup_cause=normal_clearing hangup_source=caller sip_hangup_cause=unspecified
10:26:21.957  [telnyx/voice] endCallViaCallControl ok status=200 ccid=true
```

`hangup_source=**caller**` — WIR haben aufgelegt. Owner-Gegenprobe unabhaengig: der Agent
brach bei der gesprochenen Zahl **70** ab.

**Wurzel:** `TELNYX_DEAD_AIR_TIMEOUT_S=45` misst *Sekunden ohne Shim-Turn*. Ein Shim-Turn
entsteht nur, wenn der ANRUFER spricht. Spricht der Agent laenger als 45 s am Stueck (langes
Vorlesen, Aufzaehlung, Recherche-Ergebnis), kommt in dieser Zeit kein Request — und der
Waechter haelt die aktive Leitung fuer tot. `turnSeq:3` bei 86 s passt dazu.
Der Waechter misst die falsche Groesse: er soll "Leitung tot" erkennen, prueft aber
"Anrufer schweigt".

**Das ist ein eigener Defekt, NICHT die Ursache der neun 91-s-Anrufe.** `dead_air` steht seit
dem 03.08. genau EINMAL im Log — bei diesem Testanruf. Die 91er tragen `hangup_source=callee`.
Die beiden Sachverhalte duerfen nicht vermischt werden (Lehre: zwei Sachverhalte auf 1 Label).

## 6. Nebenbefunde (unabhaengig von der Kappung)

- **Die Zusammenfassungs-SMS schlaegt bei JEDEM Anruf fehl:**
  `[sms] Telnyx sendSms fehlgeschlagen: HTTP 400 (40305 Invalid 'from' address)`.
  Der Owner bekommt nach keinem Anruf eine Zusammenfassung. Eindeutig unsere Seite.
- **`silenced` (GQ-P18) verwirft ganze fertige Antworten.** Erstmals am 10.08. aufgetreten
  (beide Anrufe), vorher nie. Wurzel: GQ-P18 stellte `speakChunk` von direktem Schreiben auf
  Puffern um, dadurch bleibt `wire.chunkCount()` bis zur Freigabe 0 und der
  `ALREADY_SPOKEN`-Schutz greift nicht — das Verwurf-Fenster waechst von ~0 ms auf bis zu
  `TELNYX_SHIM_EXTEND_HOLD_MS` (3000). Notbremse `=0` beseitigt `silenced` nachweislich
  (Kurzschluss synchron im Konstruktor, `release()` unerreichbar), holt aber den
  Doppelantwort-Defekt zurueck. **Owner-Entscheidung 10.08.: Sperre bleibt an.**
- **`number.country` fuer `+18643028341` (Tenant `owner`) steht auf `DE`** — es ist eine
  US-Nummer. Datenfehler, nicht angefasst.

## 7. Methodische Lehren dieser Runde

- **Erst die Kontrollgruppe, dann die Hypothese.** Die Cap-Timer-Erklaerung ("120 s minus
  Klingelzeit") war in sich schluessig und wurde von EINER DB-Abfrage widerlegt. Eine
  plausible Rechnung ersetzt keine Messung.
- **Eine Signatur beweist nur etwas, wenn die Gegengruppe sie NICHT traegt.**
  `hangup_source=callee` sah wie der Schluessel aus, bis die langen Anrufe dieselbe Signatur
  zeigten.
- **Ein leerer Export ist ein Befund, kein Fehlgriff.** Die 24-Byte-PCAP hat die Frage
  "kommen wir an SIP-Daten" endgueltig beantwortet.
