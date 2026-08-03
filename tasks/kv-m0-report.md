# Phase KV-M0 — Live-Konfiguration im Boot-Banner

- **Gate:** BLOCKED
- **finalBranch:** `phase/kv-m0-boot-banner`
- **headCommit (Impl):** `6891fe7`

## Was gebaut wurde

`src/boot.js` bekam drei neue, reine Ein-Zeilen-Funktionen (`paymentConfigBannerLine`,
`costTruingTypesBannerLine`, `modelConfigBannerLine`) plus einen Aggregator
`costConfigBannerLines({ billing, llm, voice })`, der die sieben bisher in Prod nicht
lesbaren Werte (`PAYMENT_ENABLED`, `SMS_COST_CENTS`, `BILLING_FLUSH_EPOCH`,
`COST_TRUING_REQUIRED_RECORD_TYPES`, `CLAUDE_MODEL`, `PRECALL_BRIEFING_MODEL`,
`ELEVENLABS_PLAY_TTS_ENABLED`) als drei zusaetzliche Zeilen ins Boot-Banner druckt.
Muster 1:1 uebernommen von `capabilityProbeLines`: Konfiguration rein, Zeilen raus,
gedruckt wird ausschliesslich in `logBootBanner`. Ein Literal `UNSET_LABEL = "nicht
gesetzt"` fuer die zwei strukturell nullbaren Felder (`flushEpochIso`,
`costTruingRequiredRecordTypes`); die uebrigen fuenf Felder loesen in `config.js`
immer auf einen funktionierenden Fallback auf und koennen "nicht gesetzt" nie zeigen.

Sechs neue Tests (`KV-M0-1` … `KV-M0-6`) in `test/kv-m0-boot-banner-config.test.js`:
Config- statt Env-Treue (Muster AL-P16-7), UNSET_LABEL-Konsequenz + Gegenprobe,
zwei Spawn-Tests gegen den echten Boot-Log, und ein Secret-Muster-Scan ueber die
gesamte Boot-Banner-Ausgabe.

## bannerSample (woertlich aus dem Log kopiert, lokaler Boot, PORT=3999)

**Fall 1 — alle sieben Werte gesetzt:**

```
  [boot] deployed commit=unbekannt
  [boot] configHash=eca54b482016111de572ec69fe1d9125b68ac5db7e709ac6e5a76127425c56d4

  Hermes Gateway laeuft auf http://localhost:3999
  Dashboard:      http://localhost:3999
  Voice-Engine:   budget
  Assistant-Pfad: aus (TELNYX_AI_ASSISTANT_ENABLED=false)
  Vorab-Briefing: aus (PRECALL_BRIEFING_ENABLED=false) - wirkt nur mit ASSISTANT_CONTEXT_ENABLED=true
  Vorab-Recherche: aus (RESEARCH_ENABLED=false) - wirkt nur mit allowResearch am Tenant
  In-Call-Nachschlag: aus (LOOKUP_ENABLED=false) - EXA_API_KEY fehlt, wirkt nur mit allowLookup am Tenant
  Consult-Kanal: aus (CONSULT_ENABLED=false) - wirkt nur mit ASSISTANT_CONTEXT_ENABLED=true und allowConsult am Tenant
  Ergebnis-Zitate: aus (EVIDENCE_RETENTION_DAYS=0) - 0 = keine Zitate
  MCP (HTTP):     http://localhost:3999/mcp  <- als Custom Connector in Claude eintragen
  Twilio-Webhook: http://localhost:3999/voice/incoming
  Status-Callback:http://localhost:3999/voice/status
  Outbound:       aktiv (Verifikation per Tenant: Abo+KYC)
  Nummern-Gates:  Land +49,+33,+44 | max 6 Calls/h pro Tenant | Notruf-/Premium-Denylist aktiv
  Budget-Achse:   Tenant Perioden-Fenster (BUDGET_MONTH_ENABLED=false) | Plattform Lebenszeit-Topf (BUDGET_MONTH_ENABLED=false) (nur Beobachtung/Warnschwelle, KS-P9)
  Kosten-Decken:  Tenant-Default 1500 ct | Plattform-Warnschwelle 3000 ct | Worst-Case-Tarif 30 ct/min
  Zahlungsabwicklung: AKTIV (PAYMENT_ENABLED=true) | SMS_COST_CENTS=2 ct | BILLING_FLUSH_EPOCH=2026-08-03T00:00:00.000Z
  Cost-Truing-Typen: COST_TRUING_REQUIRED_RECORD_TYPES=sip-trunking,call-control,speech-to-text,text-to-speech,recording,ai-voice-assistant
  Modelle: CLAUDE_MODEL=claude-haiku-4-5 | PRECALL_BRIEFING_MODEL=claude-sonnet-5 | AKTIV (ELEVENLABS_PLAY_TTS_ENABLED=true)
```

**Fall 2 — die sechs fallback-faehigen Werte NICHT gesetzt** (Code-Fallback greift;
`COST_TRUING_REQUIRED_RECORD_TYPES` musste auf `"sip-trunking,call-control"` bleiben,
weil ein leerer Wert seit P8 einen unkonditionalen Boot-Refusal ausloest — Bestandsverhalten,
nicht Teil dieser Phase, verifiziert):

```
  [boot] deployed commit=unbekannt
  [boot] configHash=eca54b482016111de572ec69fe1d9125b68ac5db7e709ac6e5a76127425c56d4

  Hermes Gateway laeuft auf http://localhost:3999
  Dashboard:      http://localhost:3999
  Voice-Engine:   budget
  Assistant-Pfad: aus (TELNYX_AI_ASSISTANT_ENABLED=false)
  Vorab-Briefing: aus (PRECALL_BRIEFING_ENABLED=false) - wirkt nur mit ASSISTANT_CONTEXT_ENABLED=true
  Vorab-Recherche: aus (RESEARCH_ENABLED=false) - wirkt nur mit allowResearch am Tenant
  In-Call-Nachschlag: aus (LOOKUP_ENABLED=false) - EXA_API_KEY fehlt, wirkt nur mit allowLookup am Tenant
  Consult-Kanal: aus (CONSULT_ENABLED=false) - wirkt nur mit ASSISTANT_CONTEXT_ENABLED=true und allowConsult am Tenant
  Ergebnis-Zitate: aus (EVIDENCE_RETENTION_DAYS=0) - 0 = keine Zitate
  MCP (HTTP):     http://localhost:3999/mcp  <- als Custom Connector in Claude eintragen
  Twilio-Webhook: http://localhost:3999/voice/incoming
  Status-Callback:http://localhost:3999/voice/status
  Outbound:       aktiv (Verifikation per Tenant: Abo+KYC)
  Nummern-Gates:  Land +49,+33,+44 | max 6 Calls/h pro Tenant | Notruf-/Premium-Denylist aktiv
  Budget-Achse:   Tenant Perioden-Fenster (BUDGET_MONTH_ENABLED=false) | Plattform Lebenszeit-Topf (BUDGET_MONTH_ENABLED=false) (nur Beobachtung/Warnschwelle, KS-P9)
  Kosten-Decken:  Tenant-Default 1500 ct | Plattform-Warnschwelle 3000 ct | Worst-Case-Tarif 30 ct/min
  Zahlungsabwicklung: aus (PAYMENT_ENABLED=false) | SMS_COST_CENTS=0 ct | BILLING_FLUSH_EPOCH=nicht gesetzt
  Cost-Truing-Typen: COST_TRUING_REQUIRED_RECORD_TYPES=sip-trunking,call-control
  Modelle: CLAUDE_MODEL=claude-haiku-4-5 | PRECALL_BRIEFING_MODEL=claude-sonnet-5 | aus (ELEVENLABS_PLAY_TTS_ENABLED=false)
```

Beide Laeufe: `/healthz` antwortete 200 unmittelbar danach, Prozess danach sauber
beendet (kein Server-Leak).

**Wichtig:** Diese beiden Faelle stammen aus lokalen Boots (Impl-Agent, Worktree). Was
in Render tatsaechlich in diesen Zeilen steht, ist NICHT gemessen — das ist genau der
Punkt der Phase KV-M0: sie macht die sieben Werte lesbar, sie liest sie nicht. Die
Abnahme (Live-Werte aus Render ablesen) steht bis zum Deploy aus, siehe unten.

## resolvedConfigProof

`KV-M0-1` (Muster AL-P16-7): `process.env` wird auf das Gegenteil der uebergebenen
Config gestellt (`PAYMENT_ENABLED=false` im Env vs. `paymentEnabled:true` im
Config-Objekt, `SMS_COST_CENTS=999` vs. `smsCostCents:2`, sowie Sentinel-Gegenteil-Werte
fuer `CLAUDE_MODEL`/`PRECALL_BRIEFING_MODEL`/`COST_TRUING_REQUIRED_RECORD_TYPES`/
`BILLING_FLUSH_EPOCH`), dann `costConfigBannerLines(config)` mit dem handgebauten
Objekt aufgerufen. Assertion: die Zeilen enthalten nur die uebergebenen config-Werte,
keiner der Env-Sentinel-Werte taucht auf. Mutationsprobe (a) bestaetigt das aktiv:
Umstellung auf `process.env.PAYMENT_ENABLED` machte KV-M0-1 rot.

Zusaetzlich zeigt `KV-M0-5` den Normalisierungsfall: `BILLING_FLUSH_EPOCH` roh als
`"2026-08-03T00:00:00Z"` (ohne Millisekunden) gesetzt, im Banner erscheint der
aufgeloeste, kanonische Wert `"2026-08-03T00:00:00.000Z"` — Beleg, dass die Funktion
den durch `config.js`/`isoInstantEnv` bereits verarbeiteten Wert liest, nicht den
Roh-String aus `process.env`.

## secretGrepProof

`KV-M0-6` spawnt einen echten Server mit `PAYMENT_ENABLED=true` plus echten
secret-foermigen Env-Werten (`STRIPE_SECRET_KEY=sk_test_x`,
`STRIPE_WEBHOOK_SECRET=whsec_test_x`, `ANTHROPIC_API_KEY=sk-ant-kv-m0-secret-darf-nirgends-auftauchen`,
`TWILIO_AUTH_TOKEN=kv-m0-twilio-token-darf-nirgends-auftauchen`) und scannt nicht nur
die drei neuen KV-M0-Zeilen, sondern den gesamten Banner-Abschnitt ab `"Hermes Gateway
laeuft auf"` (erste Zeile nach den zwei GAP-36-Diagnosezeilen `commit`/`configHash`,
die als einzige bekannte, bereits durch `test/gap-36-healthz-fingerprint.test.js`
geprueften Hex-Ausnahme bewusst ausgeschlossen sind) bis zum Ende der eingetroffenen
Ausgabe. Neun einzeln geprueft Muster: `sk_`, `sk-`, `"Bearer "`, `KEY=`, `SECRET=`,
`TOKEN=`, `PASSWORD=`, Hex ≥65 Zeichen, Base64 ≥40 Zeichen.

Kein Bezug auf eine feste Zeilen-/Feldliste — jede kuenftige Erweiterung von
`logBootBanner` faellt automatisch in denselben Scan, weil nur der Rohtext gescannt
wird. Mutationsprobe (b) bestaetigt das aktiv (s.u.).

## unsetRepresentation

`UNSET_LABEL = "nicht gesetzt"` (Konstante in `src/boot.js`), verwendet ausschliesslich
fuer die zwei strukturell nullbaren Felder:

- `flushEpochLabel(flushEpochIso)` → `flushEpochIso || UNSET_LABEL`
- `costTruingRecordTypesLabel(types)` → `types.length > 0 ? types.join(",") : UNSET_LABEL`

Die uebrigen fuenf Werte (`PAYMENT_ENABLED`, `SMS_COST_CENTS`, `CLAUDE_MODEL`,
`PRECALL_BRIEFING_MODEL`, `ELEVENLABS_PLAY_TTS_ENABLED`) koennen `"nicht gesetzt"` nie
zeigen — sie loesen in `config.js` immer auf einen funktionierenden Fallback auf.
`SMS_COST_CENTS=0 ct` (echter Betriebswert) bleibt dadurch von `"nicht gesetzt"`
unterscheidbar: im bannerSample stehen beide Werte in derselben Zeile
(`Zahlungsabwicklung: aus (PAYMENT_ENABLED=false) | SMS_COST_CENTS=0 ct |
BILLING_FLUSH_EPOCH=nicht gesetzt`) und sind eindeutig verschieden.

`KV-M0-2` pinnt, dass die zwei nullbaren Felder bei `null`/leer genau `"nicht gesetzt"`
zeigen; `KV-M0-3` pinnt die Gegenprobe, dass die fuenf fallback-faehigen Felder dieses
Label auch auf ihrem Nullwert (`false`/`0`) nie zeigen.

## Mutationsproben

1. Druck-Zeile aus `logBootBanner` entfernt → KV-M0-4/5 wurden rot (0 statt 1 Treffer
   je Label).
2. `paymentConfigBannerLine` testweise auf `process.env.PAYMENT_ENABLED` statt
   `billing.paymentEnabled` umgestellt → KV-M0-1 wurde rot (Sentinel-Erwartung
   verletzt); die uebrigen 5 KV-M0-Tests blieben gruen. Zurueckgenommen, danach alle
   6 gruen.
3. Testweise `STRIPE_SECRET_KEY=${billing.stripeSecretKey}` in
   `paymentConfigBannerLine` eingefuegt (simuliert ein gedankenlos hinzugefuegtes
   Secret-Feld) → KV-M0-6 wurde rot (Muster `SECRET=` und `sk_` feuerten beide),
   zusaetzlich KV-M0-5 (`doesNotMatch sk_test_x`) und KV-M0-2 (Zeilenformat) rot.
   Zurueckgenommen, danach wieder alle 6 gruen; laut Impl-Report trug der finale Diff
   keine der beiden Mutationen (per `git diff` verifiziert).

Safety hat unabhaengig eine eigene Mutationsprobe durchgefuehrt (Zeile
`MUTATION_TEST_FIELD=sk_live_deadbeef` in `logBootBanner` eingefuegt): KV-M0-6 ging
sofort auf das `sk_`-Muster rot, danach zurueckgenommen und `git status` sauber
bestaetigt.

## Smoke-Test-Ergebnis

Zwei echte lokale Boots (`node src/server.js`, `PORT=3999`,
`SKIP_TWILIO_SIGNATURE_CHECK=true`, `DATA_DIR`=Temp-Verzeichnis,
`OWNER_NUMBER_SEED` gesetzt): einmal alle sieben Werte gesetzt, einmal die sechs
fallback-faehigen Werte nicht gesetzt (mit der oben genannten
`COST_TRUING_REQUIRED_RECORD_TYPES`-Ausnahme wegen des Bestands-Boot-Refusals). Beide
Male `/healthz` → 200, Banner-Ausgabe woertlich in bannerSample kopiert, beide
Prozesse danach sauber per `pkill` beendet (kein Server-Leak, per `ps aux` gegengeprueft).

## Angepasste Bestandstests

Keine. Die Phase haengt nur an (drei neue Zeilen, keine bestehende Zeile veraendert
oder verschoben); kein Bestandslabel kollidiert mit den drei neuen. Geprueft:
`boot-failclosed.test.js`, `al-p16-boot-probes.test.js`,
`boot-budget-axis-label.test.js`, `cost-truing-booking-guard.test.js`,
`bootstrap-heal-boot.test.js`, `gap-36-healthz-fingerprint.test.js` — alle bleiben
unberuehrt, keine dieser Dateien wurde geaendert.

## Safety-Urteil

**APPROVED** (finales Safety-Review, unabhaengig durchgefuehrt). Kernpunkte:

- Diff ist exakt `src/boot.js` (61 Zeilen, rein additiv) + neue Testdatei
  (241 Zeilen) — kein Touch an `src/boot-guard.js`, `src/config.js`,
  `src/store/**`, `src/billing/**`, `src/server.js`, `src/route-policy.js`,
  `src/claude.js` (per `git diff master phase/kv-m0-boot-banner --stat` bestaetigt).
- Alle sieben Felder werden aus der bereits aufgeloesten Config gelesen, kein
  `process.env`-Zugriff im neuen Code (gegrept, null Treffer).
- Keines der sieben Felder traegt Secrets/PII/Tenant-IDs; ElevenLabs-Objekt: nur
  `.enabled` wird gelesen, nie `apiKey`/`voiceId`.
- Unabhaengige Mutationsprobe (s.o.) bestaetigt den Secret-Scan aktiv.
- Kein neues Feld erscheint in `/healthz`, API-Responses oder MCP-Tool-Ausgabe
  (gegrept).
- Keine bestehende Test-Assertion angetastet oder geschwaecht.
- Alle absoluten Regeln (Safety-Gates, Offenlegungssatz, Auth fail-closed, Secrets,
  Audio-nie-durch-MCP, Scope) bleiben von diesem Diff unberuehrt.

## Clean-Code-Audit (S1–S4)

**Verdict: BLOCKER.**

- **S1 (Blocker):** `src/boot.js` (`paymentConfigBannerLine`) liest
  `billing.flushEpochIso` — ein Feld, das im gepruehten Diff in `src/config.js`
  nirgends existiert (kein `BILLING_FLUSH_EPOCH`-Env-Parsing, kein Eintrag im
  billing-Namespace). `config.js` schuetzt seine Namespaces per fail-closed Proxy
  (`guardedConfig`): Zugriff auf einen unbekannten Key wirft `TypeError`. Empirisch
  verifiziert durch den Clean-Code-Auditor: `node --test
  test/kv-m0-boot-banner-config.test.js` auf dem geprueften Branch endete mit genau
  diesem Crash bei jedem Boot, sobald `logBootBanner` durchlaeuft (unbedingter
  Aufruf am Ende des Serverstarts) — der reale Boot-Pfad crasht, der Dienst startet
  nicht. Die eigenen Tests der Phase (KV-M0-4, -5, -6) waren zum Pruefzeitpunkt rot;
  `npm test` war auf diesem Branch-Stand nicht gruen.
- S2: keine gemeldet.
- S3 (Pass): Feldtrenner `" | "` ohne eigene Konstante — entspricht der bestehenden
  Konvention (`probeLine` nutzt ebenso `" - "` ohne Konstante), keine neue
  Abweichung. Kommentare durchgehend deutsch ohne Umlaute, konsistent mit Bestand.
- S4 (Pass): keine toten/auskommentierten Codebloecke, keine ungenutzten Imports;
  `UNSET_LABEL` als einzige Quelle, `costConfigBannerLines` sauber von der
  Druck-Stelle getrennt (Muster `capabilityProbeLines`); Test-Helfer ohne geteilten
  veraenderlichen Zustand, Build/Operate-Check sauber getrennt,
  `SECRET_LEAK_PATTERNS` nur einmal definiert.

## Fix-Runden

**r1 (einzige Runde):** Fix-Agent stellte fest, dass der gemeldete S1-Fehler auf dem
tatsaechlichen Branch `phase/kv-m0-boot-banner` nicht reproduziert — der Branch
enthaelt bereits den KV-P0-Merge (Commits `b8028cc`/`22f625c`, zeitlich vor dem
KV-M0-Commit `6891fe7`), der `flushEpochIso` in `src/config.js` (Zeile 524, via
`isoInstantEnv('BILLING_FLUSH_EPOCH', ...)`) bereits enthaelt. Kein Fix-Commit
erfolgte: der Fix-Agent brach ab, ohne einen Branch
`phase/kv-m0-boot-banner-fix1` zu erzeugen. Die Self-Fix-Schleife wurde daraufhin
beendet, ohne dass ein neuer, gegengeprueften gruener Stand erreicht oder gemerged
wurde.

**Konsequenz:** der S1-Befund des Clean-Code-Audits ist nicht abschliessend geklaert
— entweder war er ein Artefakt eines veralteten/falschen Basis-Standes beim
Auditor, oder er besteht tatsaechlich fort und wurde vom Fix-Agenten fallengelassen,
ohne das per eigenem Testlauf zu belegen. Diese Phase endet **BLOCKED**, nicht
gemerged. Vor jedem weiteren Schritt: `npm test` auf `phase/kv-m0-boot-banner`
tatsaechlich selbst laufen lassen und `config.billing.flushEpochIso` in
`src/config.js` an der genannten Stelle gegenlesen, statt der Behauptung des
Fix-Agenten zu vertrauen.

## Beim Lesen aufgefallen, bewusst NICHT gefixt (findingsNotFixed)

1. **`test/auth-p9a-cache-headers.test.js` (Bestand, unveraendert):** file-scope
   `before()`/`after()` mit geteiltem `startServer()`-Spawn crasht (`hookFailed`,
   `undefined.stop()`) oder haengt den gesamten `node --test`-Prozess unbegrenzt,
   sobald `--test-name-pattern` (wie bei `test:gates`) keinen der fuenf
   AUTH-P9A-Testnamen matcht — deterministisch reproduziert in Isolation, ohne jede
   Fremdlast. Macht `npm run test:gates` in der aktuellen Codebase praktisch nicht
   end-to-end durchlaufbar (haengt, statt mit rot durchzulaufen). Ausserhalb des
   Scopes dieser Phase (andere Datei, keine KV-M0-Beruehrung) — nicht behoben, nur
   fuer die eigene gatesRedCount-Messung umgangen (Testlauf ohne diese eine Datei).
   Gehoert in `tasks/lessons.md` oder eine eigene kleine Fix-Phase (Guard `if (srv)
   await srv.stop()`, Muster bereits in `kv-m0-boot-banner-config.test.js`
   verwendet).
2. **`COST_TRUING_REQUIRED_RECORD_TYPES` kann in einer echten Boot-Instanz nie
   tatsaechlich leer sein** (P8-Boot-Refusal, Bestandsverhalten) — die
   banner-seitige `UNSET_LABEL`-Anzeige fuer dieses Feld ist daher nur ueber die
   reine Funktion (KV-M0-2) beobachtbar, nie an einem lebenden Prozess. Kein Fehler
   dieser Phase, nur eine Beobachtung.

## Was der Lead nach dem Deploy tun muss

Diese Phase macht die sieben Werte lesbar — sie liest sie nicht. Was in Render
tatsaechlich in der Live-Konfiguration steht, ist durch KV-M0 nicht bekannt und darf
nicht behauptet werden. Sobald diese Phase (nach Aufloesung des Fix-r1-Abbruchs)
tatsaechlich gemerged und deployed ist:

1. Render-Boot-Log oeffnen und die drei neuen Zeilen (`Zahlungsabwicklung:`,
   `Cost-Truing-Typen:`, `Modelle:`) ablesen.
2. Die sieben Live-Werte daraus notieren: `PAYMENT_ENABLED`, `SMS_COST_CENTS`,
   `BILLING_FLUSH_EPOCH`, `COST_TRUING_REQUIRED_RECORD_TYPES`, `CLAUDE_MODEL`,
   `PRECALL_BRIEFING_MODEL`, `ELEVENLABS_PLAY_TTS_ENABLED`.
3. Diese sieben Werte in `tasks/PLAN-KOSTEN-VOLLSTAENDIGKEIT.md` eintragen.

Das ist die eigentliche Abnahme von KV-M0 — sie steht bis zum erfolgreichen Deploy
aus und ist durch diesen Bericht nicht erledigt.
