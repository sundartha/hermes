# AUFTRAG: Vollstaendige Ist-Kosten je Tenant nach dem ElevenLabs-Umstieg

Stand 2026-08-30. Diese Datei ist die BEWEISLAGE des Leads. Sie ist am laufenden System
gemessen, nicht vermutet. Wer hier etwas als BELEGT liest, muss es NICHT neu erforschen.
Wer etwas als OFFEN liest, MUSS es messen, bevor er darauf baut.

## Ziel (Eigentuemer-Wortlaut)

> Wenn ein User zwei Minuten angerufen hat, sollen alle Kosten, die er in diesen zwei
> Minuten verursacht hat, aufgezeichnet und von seinem Guthaben abgebucht werden.

Fuer JEDEN Tenant, nicht nur fuer den Eigentuemer-Account. Und ohne boese Ueberraschung
in einem Monat.

## Die Topologie seit dem Umstieg

Telnyx haelt weiterhin die DID und die SIP-Strecke. Das GESPRAECH fuehrt seit dem
19.08.2026 der ElevenLabs-ConvAI-Agent (`src/elevenlabs/outbound.js`), der per SIP-Trunk
an der Telnyx-DID haengt. Sprachmodell, Spracherkennung und Sprachsynthese laufen damit
bei ElevenLabs und werden von ElevenLabs berechnet - nicht mehr bei uns, nicht mehr bei
Telnyx. Unsere Turn-Schleife laeuft auf diesem Weg gar nicht.

**KORREKTUR 2026-08-30, vom Abnahme-Kritiker (R9) am Code belegt - gegen die urspruengliche
Fassung dieser Datei:** aus "die Turn-Schleife laeuft nicht" folgt NICHT "es fallen keine
eigenen KI-Token an". Zwei Aufrufer buchen auf dem EL-Weg sehr wohl auf die Gate-Achse,
beide AUSSERHALB der Turn-Schleife:

| Aufrufer | Ort | Bedingung |
|---|---|---|
| `fetchPrecallBriefing` | `src/routes/api-calls.js:279` - VOR der EL-Weiche in `:362`, also NICHT engine-abhaengig | Flag `PRECALL_BRIEFING_ENABLED` |
| `summarizeCall`-Rueckfall | `src/telephony/call-finish.js:303-305` | flag-unabhaengig |

Beide laufen ueber `bookEstimatedTokenUsage`/`bookTokenUsage` (`src/precall-briefing.js:263`
bzw. `:314`) nach `store.trackUsage` (`src/llm-usage.js:66`/`:77`) auf genau die Achse, die
`budgetExceeded` liest. Wer sie fuer den EL-Weg als abwesend fuehrt, unterschaetzt die
Vollkosten je Anruf - mit direkter Folge fuer jede daraus abgeleitete Tarifhoehe.

Daraus folgt: es gibt seit dem Umstieg MINDESTENS ZWEI FREMDE Kostentraeger je Anruf
(ElevenLabs + Telnyx-SIP), wo vorher einer genuegte - PLUS die weiterlaufenden eigenen
Achsen (`ai_token` aus Briefing und Zusammenfassung, `research_fee`). Der Kostenpfad kennt
aber weiterhin nur einen.

## BELEGT (am laufenden System gemessen, 2026-08-30)

### B1 - Der Ist-Kosten-Abgleich ueberspringt JEDEN ElevenLabs-Anruf

`src/billing/cost-truing.js:138`:

    const providerLegIdOf = (call) => call.twilioSid || call.callControlId || null;

Ein EL-Anruf hat weder `twilio_sid` noch `call_control_id` - nur `sip_call_id`
(`otb_...`). Damit ist `isRetrievable` (Zeile 581) false und der Sweep laesst ihn
vollstaendig aus. Der Code sagt es selbst (Zeile 767-770): "Strukturell nie abgleichbar
... kein Abruf, kein Schreibzugriff, kein verbrauchter Versuch."

Datenbank-Beleg (Produktion, `call`-Tabelle, Tenant t_user_01KX600834GCJFV9GTZQKWZMTH):

| Zeitraum | Anrufe | mit call_control_id | mit sip_call_id | Truing-Versuche | abgeglichen |
|---|---|---|---|---|---|
| 31.07.-12.08. (Telnyx-Engine) | 56 | 56 | 0 | 56 | 56 |
| 19.08.-30.08. (EL-Engine) | 12 | 0 | 12 | **0** | **0** |

Live-Log-Beleg (Render `srv-d8m0fhflk1mc73bno570`, stuendlich, zuletzt 2026-08-30T13:33Z):

    [cost-truing] sweep kandidaten=12 gemessen=0 uebersprungen=12 anfragen=0
    [cost-truing] deckung=0% schwelle=80%

`anfragen=0` heisst: es wird nicht einmal ein HTTP-Request an Telnyx abgesetzt.

### B2 - Die ElevenLabs-Kosten stehen in KEINEM der beiden Buecher

Weder Verbrauchs-Ledger (`usage_event`) noch Gate-Achse (`usage.costCents`) kennen eine
ElevenLabs-Kostenart. Die Kosten-Landkarte `src/billing/cost-ledger-map.js` fuehrt die
Zeile `play_tts_characters` mit `ledger: false, gate: false` - sie beschreibt aber den
ALTEN Play-TTS-Pfad, nicht den ConvAI-Pfad. Fuer den ConvAI-Pfad existiert ueberhaupt
keine Zeile. Es gibt repo-weit keinen Preis-Parameter fuer ElevenLabs-Gespraechsminuten
(`grep` ueber `.env.example` und `src/config.js`: kein Treffer).

Der Anbieter LIEFERT die Zahlen. `GET /v1/convai/conversations/{id}` traegt
`metadata.cost` (Credits), `metadata.cost_fiat` (USD) und `metadata.charging` mit voller
Aufschluesselung (`llm_price`, `platform_price`, `tts_usage`, `asr_usage`, `tier`).
Gemessen fuer alle 8 angenommenen EL-Anrufe:

| Anruf | Dauer | gebucht | EL-Ist (USD) | LLM | Plattform |
|---|---|---|---|---|---|
| call_mt0ddduxuzgl 19.08. | 53 s | 30 ct | 0,1042 | 0,0346 | 0,0696 |
| call_mt18soytibps 20.08. | 41 s | 30 ct | 0,0859 | 0,0316 | 0,0543 |
| call_mt1rnbnfl2bp 20.08. | 44 s | 30 ct | 0,1175 | 0,0596 | 0,0578 |
| call_mt1s9bk9qvhb 20.08. | 8 s | 30 ct | 0,0099 | 0 | 0,0099 |
| call_mt1sa9vpavy0 20.08. | 17 s | 30 ct | 0,0215 | 0 | 0,0215 |
| call_mtd0acq2hq4q 28.08. | 12 s | 30 ct | 0,0155 | 0 | 0,0155 |
| call_mtd0yf5wzpi6 28.08. | 76 s | 60 ct | 0,1333 | 0,0335 | 0,0998 |
| call_mtfm5ss7g3jz 30.08. | 35 s | 30 ct | 0,0750 | 0,0292 | 0,0458 |

Summe: 270 EUR-ct gebucht gegen 56,28 US-ct echte EL-Kosten ueber 4,77 Minuten
= **11,81 US-ct/min im Schnitt, 16,0 US-ct/min im teuersten Anruf**.

Die EL-Kosten haben einen grossen FIXEN Anteil je Anruf (Prompt-Cache-Write, im
35-s-Anruf 8603 Tokens zweimal). Kurze Anrufe sind deshalb pro Minute teuer, lange
billig - eine reine Minutenpauschale bildet das strukturell falsch ab.

### B3 - Die Warnung, die genau das melden soll, landet nirgends

`emitFinding` in `cost-truing.js` feuert korrekt (im Live-Log belegt:
`Befund grund=coverage_below_threshold deckung=0% schwelle=80% sweeps=1`). Aber:

- `audit()` in `src/util.js:60` ist AUSSCHLIESSLICH ein `console.log`. Es schreibt NICHT
  in die Tabelle `audit_log`. Gegenprobe: `select ... from audit_log where action =
  'cost_truing_befund'` liefert 0 Zeilen, waehrend `login`/`did_released` (anderer
  Schreibpfad, `makeAuditStore`) vorhanden sind.
- Fuer diesen Befund-Code ist bewusst KEINE SMS vorgesehen.
- Die Eskalationsstufe `coverage_stalled` greift nie: `sweepsBelowThreshold` ist
  prozesslokal, jeder Render-Neustart nullt ihn (im Log nach dem Deploy wieder `sweeps=1`).

Ergebnis: 11 Tage bei 0 % Deckung, einzige Spur eine Log-Zeile auf dem Free Tier.

### B4 - Was HEUTE funktioniert (nicht kaputtmachen)

- Die Vorab-Gate-Kette gilt fuer den EL-Weg unveraendert (`routes/api-calls.js:362`,
  EL-Zweig sitzt HINTER der kompletten Kette, kein zweiter Einstieg).
- Vorab-Reserve: `outboundReserveCents` = Tarif x `RESERVE_LEAD_MINUTES` (2) = 60 ct,
  gehalten vor dem Waehlen; `reserve_budget` ist das LETZTE Gate; 402 bei zu wenig Geld.
- Live-Term mitten im Gespraech: `liveVoiceSpendCents` summiert ueber alle aktiven Legs
  des Tenants; der EL-Leg zaehlt mit, weil `markAnswered` beim Waehlen stempelt.
- Notbremse: `maxDurationS` wird aus dem Restguthaben abgeleitet, `armMaxDurationTimer`
  ist im EL-Zweig armiert (`api-calls.js:372`).
- Nach dem Anruf: `finishCall -> reconcileVoiceBudget` bucht Minuten x Tarif auf die
  Gate-Achse, `recordVoiceMinuteMeter` schreibt den Ledger. In der DB belegt: alle 8
  angenommenen EL-Anrufe tragen `estimated_cost_cents`, die 4 nicht angenommenen vom
  27.08. tragen korrekt nichts.
- Decke des Test-Tenants: `tenant_budget.hard_cap_cents` = 4500, Periodenverbrauch 462 ct.

### B5 - Der Tarif ist eine Altlast, die zufaellig passt

`VOICE_TARIFF_DEFAULT_CENTS=30` stammt laut `.env.example:599-601` aus einer Messung der
ALTEN Telnyx-Budget-Engine (8,18 ct je angefangener Minute ueber 21 Live-Anrufe). Er
deckt die heutige EL-Kostenstruktur mit Faktor rund 2,5 ab - aber niemand misst, ob das
so bleibt. `VOICE_TARIFF_FULL_COST_FLOOR_CENTS=10` ist aus der Assistant-Konfiguration
hergeleitet (10,4 US-ct/min) und liegt damit unter den heutigen Vollkosten.

### B6 - Die Falle, die der naheliegende Fix stellt

Wuerde jemand NUR den Join-Schluessel reparieren (B1), liefe der Abgleich gegen
Telnyx-Belege, die die EL-Kosten gar nicht enthalten. `applyCostCorrectionCents` wuerde
die 30-ct-Schaetzung auf die reinen SIP-Minuten heruntersetzen und damit rund 90 % der
echten Kosten von der Gate-Achse LOESCHEN. Der halbe Fix ist schlimmer als kein Fix.
Jeder Entwurf muss zeigen, dass er in diese Falle nicht laeuft.

## OFFEN (NICHT belegt - hier ist Messen Pflicht, Raten verboten)

- **O1**: Fuehrt Telnyx fuer die SIP-Trunk-Legs des EL-Wegs ueberhaupt Belege in
  `/v2/detail_records`, und unter welchem Schluessel? Gibt es einen Beleg, der die
  `otb_...`-Kennung aus `sip_call_id` traegt? `COST_TRUING_REQUIRED_RECORD_TYPES` steht
  live auf `sip-trunking,call-control` - ob der Typ `sip-trunking` real geliefert wird,
  ist UNGEPRUEFT. Der Telnyx-MCP-Server ist in dieser Session mit HTTP 401 ausgefallen;
  ein Schluessel liegt in `.env`.
- **O2**: Wie hoch ist der Telnyx-Anteil je Minute auf dieser Strecke wirklich?
- **O3**: Wann ist `metadata.cost_fiat` bei ElevenLabs stabil abrufbar (sofort nach
  Gespraechsende, oder mit Verzug)? Aendert sich der Wert nachtraeglich? Welche
  Rate-Limits gelten auf dem Abruf?
- **O4**: Waehrung. `cost_fiat` ist USD, die Gate-Achse rechnet in EUR-Cent ueber
  `providerToBucketRateMicro`. Gilt derselbe Kurs-Pfad, oder braucht es einen zweiten?
- **O5**: `metadata.charging.tier` stand im gemessenen Anruf auf `starter`. Aendert ein
  Plan-Wechsel bei ElevenLabs die Preise ruecklaufend oder nur vorwaerts?
- **O6**: Inbound. Der Kostenpfad ist richtungsoffen - laeuft Inbound heute ebenfalls
  ueber ElevenLabs, und wenn ja, gilt B1/B2 dort genauso?
- **O7**: Die ElevenLabs-Monatsgrundgebuehr und das Credit-Kontingent
  (`PLATFORM_FIXED_COST_CENTS_PER_MONTH`, `TTS_CHARACTER_QUOTA`) sind Plattformgroessen
  ohne Tenant-Dimension. Wie werden sie auf Tenants umgelegt - oder bewusst nicht?

## Was das Strategiedokument leisten muss

1. Eine Architektur, in der JEDE Kostenart je Anruf genau einen benannten Weg in BEIDE
   Buecher hat, und in der eine fehlende Kostenart STRUKTURELL auffaellt (nicht durch
   Sorgfalt). `src/billing/cost-ledger-map.js` ist der vorhandene Ansatz dafuer.
2. Einen Ist-Kosten-Abgleich, der mehrere Kostentraeger je Anruf zusammenfuehrt, und der
   nur dann Geld zurueckgibt, wenn ALLE Traeger belegt sind (die bestehende
   `refundProven`-Asymmetrie ist das richtige Vorbild).
3. Einen Alarmweg, der einen Ausfall dieser Art binnen Stunden sichtbar macht - und zwar
   an einem Ort, den der Eigentuemer wirklich sieht.
4. Eine Tarif-/Preis-Herleitung, die aus MESSUNG kommt, nicht aus Fortschreibung.
5. Eine Phasenkette: jede Phase klein, einzeln lieferbar, einzeln testbar, mit einem
   Abnahmekriterium, das ohne echten Anruf pruefbar ist. Jede Phase muss so beschrieben
   sein, dass eine spaetere Session sie ohne Rueckfrage als eigenen Workflow fahren kann.
6. Einen Pre-Mortem: ein Jahr in der Zukunft, die Umstellung ist gescheitert - was ist
   passiert? Die gefundenen Risiken entschaerft oder ausdruecklich als akzeptiert notiert.

## Absolute Grenzen (aus CLAUDE.md, nicht verhandelbar)

- Safety-Gates (Verifikation als Outbound-Permit, `OUTBOUND_FROZEN`, Denylist, Land-Gate,
  Stundenlimit, **pro-Tenant-Kostendecke**, Max-Gespraechsdauer, Provider-Signatur)
  duerfen NIE entfernt, aufgeweicht oder per Default umgangen werden.
- Die pro-Tenant-Kostendecke sperrt BEIDE Richtungen, Inbound eingeschlossen. Eine
  Lockerung fuer Inbound wurde 2026-07-30 geprueft und ZURUECKGEZOGEN.
- Der Offenlegungssatz und `callee_is_owner` werden nicht angefasst.
- Keine Secrets in Code, Log, API-Antworten oder Dokumenten.
- Kommentare deutsch OHNE Umlaute. Fliesstext im Dokument darf Umlaute tragen.
