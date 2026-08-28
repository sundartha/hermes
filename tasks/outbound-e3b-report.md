# OUTBOUND-E3B F2(b): Betreiber-Alarm bei systematischem Ausfall

Basis: `master` = `cab6c4e` (E1+E2+E3a gemergt). Gate-Status: **BLOCKED**.
finalBranch: `phase/outbound-e3b-betreiber-alarm-fix4`

## 1. Auftrag

Der systematische Ausfall (Regressionsanker: 27.08.2026, vier gescheiterte Outbound-Versuche
innerhalb ~6 Minuten, alle `not-placed:invite-403-D51`, ein Tenant, kein Erfolg seit dem
20.08.) muss beim Betreiber ankommen — nicht nur beim Kunden (das leistet bereits E3a mit der
einen `not-placed`-Mail). Zwei getrennte Stufen: K0 (erster Befund, kostenlos, kein Versand),
K1 (kleines Volumen), K2 (Skala). Marker durabel (PM-23), Meldeweg fail-soft, Mail primaer.
Zusaetzlich wurde der Reihenfolge-Riegel "Grund vor Endstatus" auf `voice.js` und
`elevenlabs/outbound.js` ausgedehnt (Befund C-A aus dem E3a-Safety-Review).

## 2. Die Erkennungsregel — Zahlen und Vorrechnung

### 2.1 Was gezaehlt wird

- Nur `not-placed` (Basis-Token via `failureReasonBase()`). `unreachable`, `result-unknown`,
  `no-answer`, `busy`, `canceled`, `failed`, `max-duration-cap`, `budget-exhausted` zaehlen nie.
- Nur `direction === "outbound"`.
- Eimer = Token **ohne** Carrier-Suffix: `not-placed:invite-403-D51` -> `not-placed:invite-403`.
  `not-placed:start-403` und `not-placed:invite-403` bleiben getrennte Eimer.
- Erfolg = `answeredAt` gesetzt (nicht `status === "completed"` — der 27.08.-Datensatz zeigt
  `status=failed, answered_at=NULL`, Status und Wirklichkeit koennen auseinanderfallen).

### 2.2 Die Zahlen (alle als Env, mit Begruendung)

| Groesse | Env | Wert | Begruendung |
|---|---|---|---|
| Fenster `W` | `OUTAGE_ALERT_WINDOW_MS` | 3 600 000 (60 min) | 10-fache Reserve zum gemessenen Vorfall (5 min 45 s); dieselbe Vorfallslaenge wie E3a (`NOT_PLACED_MAIL_DEBOUNCE_MS`); `0` = Regel komplett aus (Rollback-Hebel) |
| Mindestzahl `N` | `OUTAGE_ALERT_MIN_FAILURES` | 3 | 27.08. erzeugte 4 Versuche, `N=3` feuert vor dem letzten; `N=1` waere jeder einzelne `not-placed` (~41/h bei Skala auch im gesunden System); Einzelfall ist ueber K0 kostenlos gedeckt |
| Mindestnenner `M` | `OUTAGE_ALERT_MIN_ATTEMPTS` | 20 | kleinster Nenner, bei dem 20 % nie weniger als 4 Fehler bedeutet (`ceil(0.2*20)=4>N=3`) — K2 kann nie schwaecher sein als K1 |
| Anteil `p` | `OUTAGE_ALERT_FAIL_SHARE_PERCENT` | 20 (ganzzahlig) | 20-facher Abstand zum plausiblen Grundrauschen (<=1 %), deutlich unter jedem echten Teilausfall (25-100 %) |
| Mind. Tenants `T` | `MIN_TENANTS_SHARED_FAULT` (Konstante) | 2 | wirkt nur im Klein-Volumen-Bein |
| Entprellung | `OUTAGE_ALERT_DEBOUNCE_MS` | 21 600 000 (6 h) | nach zugestellter Meldung |
| Wiederholversuch | `OUTAGE_ALERT_RETRY_MS` | 900 000 (15 min) | nach fehlgeschlagener Zustellung (Befund S3-2) |

### 2.3 Die Regel (rein, IO-frei, zeit-injiziert)

```
beurteileAusfall({ fenster, marker, schwellen, nowMs }) -> { urteil, zahlen }
0. W === 0                              -> "aus"
1. fenster.fehler === 0                 -> marker offen ? "erholt" : "kein-befund"
2. marker fehlt                         -> "erstbefund"  (K0: WARN+Audit, kein Versand)
3. K1  versuche < M UND fehler >= N UND (erfolge === 0 ODER tenants >= T)
       UND meldeErlaubt(marker, nowMs)  -> "alarm"
4. K2  versuche >= M UND fehler*100 >= versuche*p UND meldeErlaubt(marker, nowMs) -> "alarm"
5. sonst                                -> "kein-befund"
```

`versuche < M` in K1 ist eine bewusste Ergaenzung (Deviation D-2): ohne sie ist die
Oder-Bedingung bei Skala immer wahr (41 Fehler/h auf ~41 Tenants) -> Dauerfeuer. K1 und K2
partitionieren dieselbe Volumen-Achse an derselben Grenze `M`.

### 2.4 Rechnung (i) — heute, ~1 Anruf/Woche, der 27.08.-Fall

Vier Versuche (16:36:55 / 16:40:09 / 16:41:09 / 16:42:34), alle `not-placed:invite-403-D51`,
ein Tenant, `erfolge=0` im Fenster.

| Anruf | Zahlen | K0 | K1 | Ergebnis |
|---|---|---|---|---|
| 1 | fehler 1 | kein Marker -> **erstbefund** | 1>=3 nein | WARN+Audit, 0 Kosten, Marker angelegt |
| 2 | fehler 2 | Marker da | 2>=3 nein | still |
| 3 | fehler 3, erfolge 0 | – | 3>=3 ja UND erfolge==0 ja | **ALARM** — Mail+SMS, `reportedAt` gesetzt |
| 4 | fehler 4 | – | Bedingung wahr, aber 85 s < 6 h Debounce | kein zweiter Alarm |

Ergebnis: **genau EIN Betreiber-Alarm**, 4 Minuten vorher eine kostenlose Audit-Spur.
Wahrscheinlicherer Verlauf (Nutzer ruft einmal an, gibt auf): `fehler=1<N` -> K1 schweigt,
K0 feuert trotzdem (WARN+Audit, kein Versand) — PM-21.

### 2.5 Rechnung (ii) — Skala, ~8 300 Anrufe/h, gesundes Grundrauschen

Annahme: 0,5 % `not-placed` -> 41 Fehler/h, verteilt auf ~10 Eimer -> ~4/Eimer/h.
`versuche=8300 >= M=20` -> K1 gar nicht anwendbar (kein Rauschen). K2: Anteil je Eimer
`4/8300=0,05 %` << 20 %; selbst alle 41 Fehler in einem Eimer: `41/8300=0,49 %` << 20 %.
Echter Ausfall (ANI weg, jeder Outbound scheitert): Anteil ~100 % -> Alarm nach ~9 s (M=20
Versuche bei 8300/h). Teilausfall 25 % -> Alarm; 10-%-Teilausfall bleibt still (benannte Grenze).

Falschalarm-Rechnung im Uebergangsregime (frische Instanz, genau M=20, wahre Fehlerrate 1 %):
`P(>=4 von 20) = 4,3e-5`; bei ~41 Ausloesungen/h ~0,0018 Falschalarme/h ≈ einer alle 23 Tage,
zusaetzlich von der 6-h-Entprellung gedeckelt. Im Skalenregime (Nenner 8300, Mittelwert 83,
sd≈9) liegt die 20-%-Schwelle bei 1660 Fehlern — ~175 Sigma, praktisch unerreichbar.

### 2.6 Gegenproben (Anforderung)

| Fall | Rechnung | Ergebnis |
|---|---|---|
| Ein Tenant, unerreichbare Nummer, 10 Versuche | `unreachable:...` zaehlt nicht -> fehler=0 | kein Befund |
| Anbieter-5xx-Sturm, 50 Versuche | `result-unknown:...` zaehlt nicht | kein Schuld-Alarm (PM-20) |
| 10x `no-answer` | Bestands-Token, nicht `not-placed` | kein Alarm |

## 3. Der Meldeweg

Reihenfolge: `1. WARN-Log` (immer, kostenlos) -> `2. Audit` (`outage_detected`/`outage_alert`/
`outage_recovered`) -> `3. Mail` (**primaer**, awaited) -> `4. SMS` (`sendFailSoftAlertSms`,
Absender aus der beim Boot abgeleiteten `alert_sms_sender`-Bindung, nicht mehr per
Laufzeit-Suche).

**Kanal-Ausfall-Verhalten:**
- Jede Stufe in eigenem `try/catch`; ein Wurf in Mail bricht SMS nicht ab; kein Fehlschlag
  bricht `finishCall` ab.
- Fehlschlag erzeugt `console.warn("[outage] Kanal <kanal> fehlgeschlagen: ...")` — mit
  Kanal-Kennung, ohne Ziel. Stumm scheitern ist verboten.
- Mail ist primaer, weil der bisherige einzige Betreiber-Kanal (Bootstrap-SMS) ueber
  dasselbe Telnyx-Konto laeuft wie der ausgefallene Outbound (PM-4) — ein Alarm, den derselbe
  Defekt mitreisst, ist keiner.
- Zustellungs-Marker: `lastAttemptAt` bei jedem Versuch, `reportedAt` nur bei zugestellter Mail
  **oder** wenn kein Mail-Ziel konfiguriert ist. Wirft die Mail bei gesetztem Ziel, bleibt
  `reportedAt=null` -> naechster `not-placed`-Abschluss wiederholt nach `OUTAGE_ALERT_RETRY_MS`.
- Body-Vertrag (PII, Regel 10): genau `klasse=/fehler=/versuche=/erfolge=/tenants=/fenster_min=`
  — keine E.164, kein Tenant-Bezeichner, keine Call-ID, kein Anbieter-Rohtext. Eine Formulierung
  fuer Log, Audit, Mail und SMS.
- Boot-Guard (PM-16): neuer fataler Befund `platform_alert_channels_unset_with_outbound`, wenn
  beide Kanaele leer sind UND EL-Outbound an UND `outageAlertWindowMs>0`. Zwei nicht-fatale
  Auswege ohne Deploy (`ELEVENLABS_OUTBOUND_ENABLED=false` oder `OUTAGE_ALERT_WINDOW_MS=0`).

## 4. Durabilitaet (PM-23)

- **Fenster**: abgeleitet aus den persistierten `call`-Zeilen (`store.load().calls`), kein
  Ringpuffer, kein In-Memory-Zaehler. `pg.js` hydriert alle Anruf-Zeilen je Tenant beim Boot.
- **Marker**: neue globale Tabelle `outage_alert` (Vorbild `platform_number_use`), FORCE RLS +
  permissive globale Policy, `UNIQUE INDEX` auf offene Zeilen (`code` WHERE `closed_at IS NULL`).
  Felder: `code, first_seen_at, last_seen_at, last_attempt_at, reported_at, delivered_channels,
  closed_at`. Kein Wrapper in `store.js`/`json.js`/`pg.js` — Mutation liegt rein in
  `state-ops.js`, Paritaet ueber `STATE_FIELD_DEFAULTS` (json) + `hydrate/flush` (pg), ausserhalb
  von `makePgStore` (Pin 562 Zeilen haelt).
- **Neustart-Test** (`test/ausfall-marker-durabel-pg.test.js`, PGlite):
  - N1 Neustart-Round-Trip: claim -> save -> Spiegel verworfen -> reopen(db) -> Marker
    byte-identisch da.
  - N2 (eigentliche PM-23-Aussage): Marker mit `reportedAt=t0`, save, reopen,
    `beurteileAusfall(nowMs=t0+60s)` -> `kein-befund` (Entprellung ueberlebt den Neustart);
    `nowMs=t0+DEBOUNCE_MS+1` -> `alarm`.
  - N3 Negativ-Kontrolle: ohne save/reopen kein Marker -> `erstbefund` (beweist, dass N2 die DB
    misst, nicht den Prozessspeicher).
  - N4: Flush-Prune (leere keep-Liste raeumt die Tabelle, Paritaet zu
    `deleteMissingPlatformNumberUse`).
  - Zusaetzlich vom Reviewer echt gefahren: zwei getrennte node-Prozesse gegen dasselbe
    `DATA_DIR` (json-Backend) — Prozess 1 loest Alarm aus, Prozess 2 (frischer Start) sendet
    beim vierten Fehlversuch **nichts** mehr (kein Alarm-Sturm beim Aufwachen).

## 5. Abnahmepunkte — Urteil + Kommando

| # | Kommando | Urteil |
|---|---|---|
| S0 | `npm run test:gates` auf `master` (vor Edit) | PASS — 700 tests / pass 697 / fail 3 (GAP-05, GAP-15, E2E-03) |
| C1 | `node --test test/ausfall-erkennung.test.js` | PASS — 14/14 |
| C2 | `node --test test/ausfall-meldeweg.test.js` | PASS — 12/12 (Plan schaetzte 11; M3a/M3b als zwei Faelle, staerker) |
| C3 | `node --test test/ausfall-marker-durabel-pg.test.js` | PASS — 4/4 (N1-N4) |
| C4 | `node --test test/fehlergrund-reihenfolge-riegel.test.js` | PASS — 6/6 (R1-R5, R4 in a/b gezaehlt) |
| C5 | `node --test test/ausfall-boot-guard.test.js` | PASS — 11/11 |
| C6 | `node --test test/store-outage-marker.test.js` | PASS — 10/10 |
| C7 | Kanal-Selbsttest + HOLD-Eskalation | **NICHT UMGESETZT** in der Basis-Implementierung (Testdateien fehlten); vom Safety-Reviewer als Blocker 2 gemeldet, siehe Abschnitt 8 |
| C8 | Bestandsbuendel (anrufstart-ablehnung-grund, fehlergrund-vokabular, nutzer-mail-nur-not-placed, mcp-fehlergrund-rueckweg, plattform-nummer-bindung*, kv-m4) | PASS — alle gruen |
| C9 | `node --test test/route-auth-inventory.test.js` | PASS — 9/9, unveraendert (kein neuer Endpunkt) |
| C10 | `LLM_PROVIDER=anthropic npm test` | PASS — 5228-5251 (je Runde) / fail 0, Baseline 5193 uebertroffen |
| C11 | Sabotage-Gegenproben (Abschnitt 6) | PASS — je ROT wie erwartet, sauber zurueckgebaut |
| C12 | `node scripts/check-staged-suppressions.js <7 Dateien>` | PASS — Exit 0, kein Pin angehoben (bestaetigt durch erfolgreichen commit durch den echten pre-commit-Hook) |
| C13 | `node count.mjs src/routes/voice.js ...` / `... call-finish.js ...` | PASS — 267 / <=100 exakt |
| C14 | `npm run test:gates` (nachher) | PASS — fail 3, dieselben drei Faelle |
| C15 | `npm run lint` (voller Worktree) | PASS — 0 errors |
| C16 | `node --check` auf alle geaenderten `.js` | PASS |
| C17 | `git diff --stat` gegen `cab6c4e` | PASS — nur Plan-Scope, kein Safety-Gate/Offenlegung/Auth/`bridge.js` beruehrt |

**Gesamturteil der finalen Safety-Review: NICHT FREIGEGEBEN (2 Blocker, siehe Abschnitt 8).**
Clean-Code-Audit (Runde 4): PASS, kein Blocker (0x S1/S2, 6x S3, 3x S4).

## 6. Ausgefuehrte Gegenproben (woertlich)

### 27.08.-Muster (Regressionsfang)
Kommando: `node --test --test-name-pattern="E2 K1" test/ausfall-erkennung.test.js`
```
✔ E2 K1 (REGRESSIONSFANG 27.08.2026): 3 Fehler, 0 Erfolge, EIN Tenant, Marker vorhanden -> alarm (0.559291ms)
ℹ tests 1 / pass 1 / fail 0
```
Vom Safety-Reviewer zusaetzlich unabhaengig nachgefahren: das woertliche Anbieter-Fehlerobjekt
aus dem Befund ("unexpected status from INVITE response: sip status: 403: Unverified
origination number D51 (SIP 403)") durch `providerErrorReason` -> `not-placed:invite-403-D51`,
vier echte Anruf-Zeilen mit den echten `call_id`s und Zeitstempeln, durch den echten
`makeCallFinish().finishCall` gefahren: Anruf 1 -> K0, Anruf 3 -> genau 1 Mail + 1 SMS mit Body
`klasse=not-placed:invite-403 fehler=3 versuche=3 erfolge=0 tenants=1 fenster_min=60 regel=alarm`,
Anruf 4 entprellt.

### Fehlalarm-Gegenproben
Kommando: `node --test --test-name-pattern="E4 K1-Gegenprobe|E8 5xx-Sturm" test/ausfall-erkennung.test.js`
```
✔ E4 K1-Gegenprobe: ein Tenant, 10x unreachable (fehler bleibt 0 in outageWindow) -> kein-befund (0.40275ms)
✔ E8 5xx-Sturm: 50 result-unknown-Versuche zaehlen nicht als fehler -> kein-befund (0.057417ms)
ℹ tests 2 / pass 2 / fail 0
```
Vom Safety-Reviewer zusaetzlich eigene Szenarien: (a) 10x unerreichbar/1 Tenant -> 0 Audits/0
Versand; (b) Anbieter-5xx-Sturm 50 Versuche/12 Tenants -> 0 Versand; (b2) Poll-Timeout-Sturm 40
Versuche -> 0; (c) Skalen-Grundrauschen 8300 Versuche/h/900 Tenants bei 1 % -> nur ein K0-Audit,
0 Mail/SMS; (c2) bei 3 % -> 0 Versand; (d) Positiv-Kontrolle bei 30 % -> ALARM (Regel ist nicht
schlicht taub).

### Neustart
Kommando: `node --test test/ausfall-marker-durabel-pg.test.js`
```
✔ N1: NEUSTART-ROUND-TRIP - claimen, speichern, Spiegel verwerfen, neu hydrieren, lesen (642.696292ms)
✔ N2: KEIN ZWEITER ALARM NACH DEM AUFWACHEN (die eigentliche PM-23-Aussage) (425.98175ms)
✔ N3: NEGATIV-KONTROLLE der Mechanik - ohne save()/reopen() gibt es keinen Marker (398.896458ms)
✔ N4: Flush-Prune - leere keep-Liste raeumt die Tabelle (Parity zu deleteMissingPlatformNumberUse) (399.465875ms)
ℹ tests 4 / pass 4 / fail 0
```
Reviewer zusaetzlich: echter Prozesswechsel (zwei node-Prozesse, json-Backend) — Prozess 1 drei
Fehlversuche -> K0+ALARM, Prozess 2 (frisch) vierter Fehlversuch -> 0 Audits, kein Alarm-Sturm.

### Reihenfolge-Sabotage in voice.js/outbound.js
Kommando: `node --test test/fehlergrund-reihenfolge-riegel.test.js`
```
✔ R1 Mechanismus-Pin (Positiv-Kontrolle): persistEnd laeuft vor bill
✔ R2 Produktions-Thunk: endFailedCallWithReason schreibt den Grund VOR dem Endstatus
✔ R3 Laufzeit je Naht: persistEndWithReason ruft recordFailureReason VOR endCall
✔ R4(a) Positiv-Kontrolle: alle drei Naht-Dateien nennen persistEndWithReason mindestens einmal
✔ R4(b) SABOTAGE-FANG: in KEINER der drei Naht-Dateien steht store.recordFailureReason( als freie Anweisung
✔ R5 Verdrahtungs-Pin je Naht: die persistEnd-Aufrufstellen sind mit dem Riegel verdrahtet
ℹ tests 6 / pass 6 / fail 0
```
Ausgefuehrte Sabotagen (danach zurueckgebaut, `git diff` sauber):
1. `src/routes/voice.js`: `store.recordFailureReason(...)` als freie Zeile hinter
   `await terminateAndBillCall(...)` -> `pass 3 / fail 3` (R4a, R4b, R5 ROT). Zurueckgebaut ->
   wieder `pass 6/fail 0`. Auf `master` (vor dieser Etappe) blieb dieselbe Sabotage GRUEN
   (Befund C-A) — das ist der Beleg, dass der neue Test etwas faengt, das vorher niemand fing.
2. Dieselbe Verschiebung in `src/elevenlabs/outbound.js` -> `pass 4 / fail 2` (R4b, R5 ROT).
   Zurueckgebaut -> wieder `pass 6/fail 0`.
3. Vom Reviewer zusaetzlich: dieselbe freie Zeile in `src/telephony/call-lifecycle.js` (vierte,
   im Basis-Plan nicht genannte Naht, in Fix-Runde 3 ergaenzt) -> R4(b) und R5 ROT.

Weitere Fail-Closed-Sabotagen (Erkennungsregel selbst):
- K1-Bein (`kleinesVolumenAlarm`) auf `false` -> `pass 10/fail 4` (E2, E3, E9, E10 ROT).
  Zurueckgebaut -> wieder `pass 14/fail 0`.
- `MIN_TENANTS_SHARED_FAULT` von 2 auf 99 -> `pass 13/fail 1` (nur E3 ROT, E2 bleibt gruen —
  beweist, dass die 0-Erfolge-Klausel und die Mehr-Tenants-Klausel unabhaengig gepinnt sind).
  Zurueckgebaut -> wieder `pass 14/fail 0`.
- `void reportSystematicOutage;` statt des Aufrufs in `call-finish.js` (Wurzel-Luecke aus
  Review-Runde 1) -> `ausfall-verdrahtung-call-finish.test.js` 2 Faelle ROT.

### PII
Kommando: `node --test --test-name-pattern="^M7:" test/ausfall-meldeweg.test.js`
```
[outage] outage_alert klasse=not-placed:invite-403
✔ M7: PII-Regex (Regel 10) - der Alarm-Body traegt keine Rufnummer/Tenant-ID/Call-ID/Carrier-Rohtext (1.620041ms)
ℹ tests 1 / pass 1 / fail 0
```
Reviewer zusaetzlich mit elf eigenen PII-Werten (Rufnummer, DID, SMS-Ziel, Mail-Ziel, Klarname
"Dr. Beatrix Hohenzollern-Schmiedeberg", Gespraechsinhalt, Tenant-ID, Call-ID, Anbieter-Rohtext,
"D51") gegen Mail-Text, SMS-Body, Audit-Detail und jede Log-Zeile geprueft: 0 von 11 Werten
taucht irgendwo auf.

## 7. Implementierungs-Zusammenfassung + Deviations

**Kern:** `src/telephony/outage-detection.js` (reine Regel: K0/K1/K2, Eimer ohne
Carrier-Suffix via `reasonWithoutCarrier()` aus `failure-reason.js`, Fenster aus persistenten
`call`-Zeilen) getrennt von `src/telephony/outage-report.js` (Meldeweg: WARN->Audit->Mail->SMS).
PM-23 durch `outage_alert`-Tabelle + pg-Hydrate/Flush ausserhalb `makePgStore`. PM-17
(SMS-Absenderbindung) und PM-16 (Boot-Guard laut, neuer fataler Befund
`BOTH_UNSET_WITH_OUTBOUND`) umgesetzt. Befund C-A auf alle drei Naehte (`api-calls.js`,
`voice.js`, `elevenlabs/outbound.js`) ueber eine gemeinsame `persistEndWithReason()`-Funktion in
`call-termination.js` ausgedehnt, in Fix-Runde 3 zusaetzlich auf `call-lifecycle.js`.

**Deviations (dokumentiert, Ist-Code respektiert):**
- D-1: zusaetzlicher `OUTAGE_ALERT_RETRY_MS` (15 min) — sonst gibt es bei fehlgeschlagener
  Mail-Zustellung null Meldungen zum echten Vorfall (S3-2).
- D-2: K1 traegt zusaetzlich `versuche < M` — ohne diese Klausel ist die Lead-Formulierung bei
  Skala immer wahr (PM-22).
- D-3: Rollback-Hebel ist `OUTAGE_ALERT_WINDOW_MS=0`, nicht `MIN_FAILURES=0`.
- D-4: `OUTAGE_ALERT_FAIL_SHARE_PERCENT` ganzzahlig statt Fliesskomma (Repo-Konvention).
- D-5: kein Wrapper in `store.js`/`json.js`/`pg.js` — Mutation bleibt rein in `state-ops.js`
  (Muster E1/`platformNumberUse`).
- D-6: zwei Module (`outage-detection.js` rein, `outage-report.js` Versand) statt eines.
- D-7: Reihenfolge-Riegel wohnt in `call-termination.js`, der Bestandstest wurde generisch auf
  drei Dateien gehoben statt kopiert.
- D-8: `src/telnyx-call-control-ingest.js` (vierte Naht) **nicht** migriert — Scope-Disziplin
  und gemessene Zeilenpin-Huerde (148 Zeilen, Suppressions ohne Altlast-Eintrag); offen an die
  naechste Etappe uebergeben, per eigenem Beweis (`call-termination-order.test.js`) begruendet.
- D-9: Erholungs-Uebergang laeuft im Stunden-Sweep, nicht am Anruf-Ende.
- Zusaetzliche Test-Fleet-Abweichung: BASE_ENV pinnt `OUTAGE_ALERT_WINDOW_MS="0"` statt des
  Produktions-Defaults 3 600 000 — sonst haetten 149 Bestands-Spawn-Testfaelle mit
  `ELEVENLABS_OUTBOUND_ENABLED=true` den neuen fatalen Boot-Guard ausgeloest (real gefunden).

**Zwei echte Bugs waehrend der Umsetzung gefunden und behoben:**
1. `boot.js#warnAlertChannelUnset` reichte `config.billing` direkt an das erweiterte
   `alertChannelFindings`; die neuen Parameter liegen aber in `config.mail`/`config.voice` —
   der `guardedConfig`-Tippfehler-Riegel warf beim ersten echten Boot
   (`[guard] uncaughtException`). Am laufenden Server reproduziert, per Namespace-Zusammenfuehrung
   behoben.
2. Siehe Test-Fleet-Abweichung oben (`OUTAGE_ALERT_WINDOW_MS` in BASE_ENV).

## 8. Safety-Urteil (final)

**NICHT FREIGEGEBEN — 2 Blocker.** Alle Kernpunkte (27.08.-Erkennung, Fehlalarm-Freiheit, K0,
Neustart-Festigkeit, Meldeweg-Robustheit, lauter Boot-Guard, gebundener SMS-Absender,
ausgedehnter Reihenfolge-Riegel, eine Erkennungsstelle, PII-Dichte, Sabotage-Rot-Nachweis,
Env-Vollstaendigkeit, Gates nicht schlechter, 0-Fehler-Lint, Route-Auth intakt, Safety-Gates
unangetastet, keine Provider-Schreibzugriffe, keine Secrets, Scope respektiert) sind PASS.

**Blocker 1 — falsche Entwarnung bei Null-Verkehr:** `runOutageRecoverySweep` urteilt allein aus
`fenster.fehler === 0` auf `erholt` und schliesst den durablen Marker, **ohne jeden Beleg, dass
ueberhaupt ein Anruf stattgefunden hat**. Bei einem Anruf pro Woche steht spaetestens ~2 h nach
jedem Alarm "erholt" im Log, waehrend die Konfiguration unveraendert kaputt ist — die Umkehrung
des Plan-Zwecks ("damit Stille eindeutig ist") und ein Urteil ueber genau den Fall ("gar kein
Verkehr"), der ausdruecklich Etappe E4 zugewiesen ist. Kein verpasster Alarm entsteht dadurch
(drei weitere Fehlversuche fuehren wieder ueber K0 zu Alert), aber der einzige
prozess-ueberlebende Nachweis eines laufenden Ausfalls wird aktiv falsch gesetzt. Fix:
`RECOVERED` nur bei `fenster.versuche > 0` (besser `fenster.erfolge > 0`), sonst `NONE` und
Marker bleibt offen; plus Test "offener Marker + leeres Fenster -> keine Audit-Zeile, Marker
bleibt offen".

**Blocker 2 — Abnahmepunkt C8 fehlt vollstaendig:** die 24-h-Eskalation eines HOLD
`platform_number_in_use` ueber denselben Meldeweg (Plan-Entscheidung F-8) ist weder als Test
noch als Code vorhanden, ohne dokumentierte Abweichung. E1 liefert nur wiederholtes
WARN-/Audit-Rauschen ohne Alters-Schwelle. Entweder bauen oder als bewusste, vom Lead
freigegebene Abweichung schriftlich festhalten.

**Concerns (kein Blocker, aber wichtig fuer den Betrieb):**
- Deploy-Risiko: mit `ELEVENLABS_OUTBOUND_ENABLED=true` (live) und
  `OUTAGE_ALERT_WINDOW_MS=3600000` (render.yaml-Default) verweigert der Dienst den Start
  (exit 1), solange kein vollstaendiger Betreiber-Kanal (Mail-Adresse UND Mailer, oder SMS-Ziel)
  gesetzt ist. `render.yaml` setzt `PLATFORM_ALERT_SMS_TO=""` und `PLATFORM_ALERT_MAIL_TO` als
  `sync:false` (Live-Wert laut Plan unbekannt) — **ohne vorherige Dashboard-Aenderung ist der
  erste Deploy ein Totalausfall von Inbound und Outbound.**
- "Audit" ist keine durable Zeile — der Melder ruft `audit` aus `util.js` (reiner
  `console.log`), nicht `auditStore.record` (der durable Weg). Folgt dem Plan-Vorbild
  `cost-truing.js#emitFinding`, weicht aber vom Plan-Wortlaut ("audit_store-Zeile, durabel")
  ab.
- Mail-Kanal kann still tot sein, wenn SMS gesetzt ist (`alertChannelFindings` steigt frueh
  aus, bevor die Mail-Pruefung laeuft) — nicht stumm zur Laufzeit (WARN-Zeile), aber der
  Betreiber merkt es erst im Ernstfall bzw. beim (nicht gebauten) monatlichen Selbsttest.
- Skalen-Kosten: `outageWindow` iteriert bei jedem `not-placed`-Abschluss `state.calls`
  vollstaendig, innerhalb des globalen Single-Writer-Locks — bei Millionen-Skala O(alle
  Anrufe) pro Fehlversuch unter Sperre; konsistent mit der Bestandsarchitektur, gehoert aber
  auf die Beobachtungsliste vor echtem Verkehr.
- `store.save()` in `outage-report.js` wird nirgends awaitet — entspricht dem Repo-Muster
  (`call-finish.js` macht es genauso), Restrisiko bei Prozesstod zwischen Reservierung und
  Flush bleibt.

## 9. Clean-Code-Audit (final, Runde 4)

**Verdict: PASS, kein Blocker** (0x S1, 0x S2, 6x S3, 3x S4). Katalog vollstaendig durchlaufen
(P1-P16, C1-C5, E1-E2, F1-F4, G1-G36, N1-N7, T1-T9) gegen `git diff master..fix4` (37 Dateien,
+2482/-92).

**S3-Befunde (Top 3):**
1. `outage-report.js:83-86` vermischt "nichts zu wiederholen" mit "ueber welchen Kanal
   zugestellt" — ist `PLATFORM_ALERT_MAIL_TO` leer, schreibt der durable Marker
   `deliveredChannels="mail"`, obwohl keine Mail rausging. Fehl-Diagnose in der
   Ausfall-Forensik. Fix: zwei Aussagen trennen (`channels` nur bei nachweislichem Erfolg,
   eigenes `nichtsZuWiederholen`-Flag fuer `reportedAt`).
2. `store.save()` steht in vier neuen Schreibpfaden **hinter** dem `withStoreLock`-Block statt
   im Lock-Body (Repo-Vertrag `store.js:389`, Muster `release-reconcile.js`).
3. `alarmZeile`s Parameter `regel` wird vom einzigen Aufrufer immer mit `ALERT` belegt — jede
   Meldung traegt `regel=alarm` ohne Information, obwohl K1/K2 fachlich unterscheidbar waeren.
   Zusaetzlich: `AUDIT_ACTION[OUTAGE_VERDICT.ALERT]` wird in `sendAlert` als nacktes Literal
   dupliziert statt aus der bestehenden Tabelle gelesen.

Weitere S3: Mail-Domaenen-Praedikat `mailerKonstruierbar` wohnt im Boot-Guard statt bei den
Mail-Modulen (kuenstliche Kopplung); `sendAlert` liest `config.billing.outageAlertWindowMs`
direkt statt das bereits gebuendelte `schwellen.windowMs` zu nutzen.

**S4 (kosmetisch):** Sprachmischung Deutsch/Englisch in einer Struktur
(`{fehler, versuche, erfolge, tenants}`); Prozess-Metadaten im Quelltext-Kommentar ("Review-
Blocker Runde 2/3/4") statt im VCS; Selbsttest-Eimer-Konstante nur als Test-Literal gepinnt.

Bestaetigt (Schwerpunkte): genau eine Erkennungsstelle (`beurteileAusfall`, zwei Aufrufer, beide
in `outage-report.js`); erzwungener statt konventioneller Reihenfolge-Riegel
(`persistEndWithReason`, vier Naehte); keine Magic Numbers (alle Schwellen Env mit min/max,
Multiplikatoren benannt); Durabilitaet (PGlite-Neustart inkl. Negativ-Kontrolle);
Suppression-Tabu eingehalten (`eslint-suppressions.json` unveraendert, kein `eslint-disable`);
Sabotage-Gegenproben selbst ausgefuehrt und zurueckgebaut; alle Funktionen deutlich unter
100 Zeilen, Verschachtelung max. 2, Optionen-Objekt bei >3 Parametern; Kommentare durchgehend
deutsch ohne Umlaute (grep-verifiziert).

## 10. Fix-Runden

- **r1**: Basis-Verdrahtungspunkte B1, E3B-01, E3B-02 behoben, je mit Verhaltens-/
  Wiring-Regressionstest, per Sabotage-Gegenprobe verifiziert.
- **r2**: Vier von fuenf Runde-2-Blockern behoben (85dc713 auf `fix2`, Basis `ad93502`),
  u.a. Stille-Pfad in `reportFailedCall` (call-finish.js) — `sendNotPlacedMail` jetzt in
  eigenem try/catch, ein werfender `accountByTenant` (pg-Pool) reisst den Betreiber-Melder
  nicht mehr mit.
- **r3**: Alle vier Runde-3-Blocker behoben und committet (2f471d9). Bewusst nicht
  vollstaendig geloest: `telnyx-call-control-ingest.js#recordHangupOutcome` als vierte, freie
  Formulierung derselben Invariante — als Deviation D-8 an die naechste Etappe uebergeben.
- **r4**: Beide Runde-4-Blocker (G22/G5, G26/G2) behoben, je mit Regressionstest. `outageBucket`
  duplizierte die Carrier-Suffix-Grammatik — jetzt `reasonWithoutCarrier()` in
  `failure-reason.js` als einzige Quelle, mit Identitaets-Pin im Test.
- **Finale Safety-Review nach r4**: 2 neue Blocker gefunden (Null-Verkehr-Entwarnung, fehlender
  C8) — **noch nicht behoben**, Gate bleibt BLOCKED.

## 11. Fuer den Betrieb noch zu setzen (Env-Werte)

**Vor jedem Deploy dieses Branches zwingend im Render-Dashboard:**
- `PLATFORM_ALERT_MAIL_TO` (Betreiber-Mailadresse) **und** einen funktionierenden Mailer
  (`BREVO_API_KEY` **oder** `SMTP_HOST`) setzen — **oder** `PLATFORM_ALERT_SMS_TO`
  vollstaendig setzen. Ohne einen vollstaendigen Kanal verweigert der Dienst den Start
  (`exit 1`), sobald `ELEVENLABS_OUTBOUND_ENABLED=true` und `OUTAGE_ALERT_WINDOW_MS>0` (beides
  der Live-Zustand).

**Neue Env-Werte (mit Produktions-Defaults, bereits in `.env.example`/`render.yaml`
dokumentiert):**
```
OUTAGE_ALERT_WINDOW_MS=3600000
OUTAGE_ALERT_MIN_FAILURES=3
OUTAGE_ALERT_MIN_ATTEMPTS=20
OUTAGE_ALERT_FAIL_SHARE_PERCENT=20
OUTAGE_ALERT_DEBOUNCE_MS=21600000
OUTAGE_ALERT_RETRY_MS=900000
PLATFORM_ALERT_MAIL_TO=            # dashboard-verwaltet, sync:false, LIVE-WERT UNBEKANNT
```
Rollback-Hebel im Notfall: `OUTAGE_ALERT_WINDOW_MS=0` schaltet den gesamten Melder ab (der
fatale Boot-Guard greift dann ebenfalls nicht mehr).
</content>
