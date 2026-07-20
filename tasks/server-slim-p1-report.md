# Server-Slim P1 — `src/billing/metering.js` extrahieren

**Gate: PASS**
**finalBranch:** `phase/slim-p1-metering`
**Typ:** Leaf, pure, reine Verschiebung (kein BDUF, verhaltenserhaltend)

---

## 1. Ziel der Phase

`server.js` (2244 LOC) enthielt an L1035-1088 einen in sich geschlossenen Metering-Block: die Konstante `MS_PER_MINUTE` sowie vier Funktionen (`voiceMinutesOf`, `recordVoiceMinuteMeter`, `reconcileOutboundVoiceBudget`, `recordNumberMonthMeter`), die Voice-Minuten in Stripe-Usage-Events und den Budget-Reconcile-Bucket buchen. Der Block war ein "Leaf" — nur zwei Call-Sites in `server.js` (`finishCall`, `runProvisioningDrain`), keine Rückrufe in andere Server-Interna. P1 verschiebt ihn 1:1 in ein eigenes Modul, ohne Logik zu ändern.

---

## 2. Plan (gekürzt)

### Grounding
Zeilennummern gegen den echten Code auf `master` verifiziert (Plan-Doc-Angabe „L1035-1088" stimmte exakt). Word-boundary-Grep bestätigte die Import-Konsequenzen:

| Symbol | Definition | Nutzung ausserhalb des Blocks |
|---|---|---|
| `MS_PER_MINUTE` | L1035 | nur intern |
| `voiceMinutesOf` | L1040 | nur intern (im Block) |
| `recordVoiceMinuteMeter` | L1049 | 1 Call-Site: `finishCall` (L1101) |
| `reconcileOutboundVoiceBudget` | L1066 | 1 Call-Site: `finishCall` (L1102) |
| `recordNumberMonthMeter` | L1080 | 1 Call-Site: `runProvisioningDrain` (L1924) |

- `tariffCentsPerMin` (Import): nach dem Move 0 Rest-Nutzungen in `server.js` → Import entfernen.
- `holdAmountForCountry`, `USAGE_EVENT_KIND`: bleiben, da anderswo in `server.js` noch gebraucht (Hold-Berechnung bzw. SMS-Meter).

### Neues Modul: `src/billing/metering.js`
Signatur: `makeMetering({ store, config }) -> { voiceMinutesOf, recordVoiceMinuteMeter, reconcileOutboundVoiceBudget, recordNumberMonthMeter }`. Relative Imports aus `src/billing/`: `../store/defaults.js` (`USAGE_EVENT_KIND`), `../telephony/outbound-gates.js` (`tariffCentsPerMin`), `../telephony/provisioning-geo.js` (`holdAmountForCountry`). Alle vier Funktionen byte-identisch aus L1035-1088 übernommen, inkl. deutscher Kommentare ohne Umlaute. `voiceMinutesOf` wird trotz reiner Interngebrauch im Original bewusst mit-exponiert (Modul-Landkarte der Spec nennt es explizit; reine, seiteneffektfreie Domänenfunktion; hat einen Caller im neuen Unit-Test → kein totes/über-exponiertes Symbol).

### Edits an `server.js` (6 chirurgische Änderungen)
1. Ungenutzten Import `tariffCentsPerMin` aus `outbound-gates.js`-Import entfernen.
2. `import { makeMetering } from "./billing/metering.js";` bei den billing-Imports ergänzen.
3. `const metering = makeMetering({ store, config });` in der Wiring-Region (nach `outboundGates`, vor `app.use(securityHeaders)`) — Konstruktion, keine Middleware-Änderung.
4. Block L1035-1088 entfernen (collapse auf eine Leerzeile vor `// ---- Call zu Ende`).
5. `finishCall`-Call-Sites auf `metering.recordVoiceMinuteMeter(call)` / `metering.reconcileOutboundVoiceBudget(call)` umstellen; `if (config.paymentEnabled)`-Gate bleibt am Aufrufer.
6. `runProvisioningDrain`-Call-Site auf `metering.recordNumberMonthMeter(r.number)` umstellen.

Erwartete Netto-Reduktion: ≈ −49 LOC in `server.js`.

### Tests
Bestandssuite als Byte-Gate (kein Ziel der Phase, keine Bestandstest-Datei angefasst): `finishcall-billing-once`, `outbound-reconcile-finishcall`, `usage-event-meter`, `f2-p8-cost-cap`, `bk3-auto-provision` + volle Suite. Ein neuer Unit-Test `test/metering-unit.test.js` (Fake-Store/Fake-Config, F.I.R.S.T., kein Netz/DB) deckt Grenzfälle direkt ab: `voiceMinutesOf` ceil-Rand (60001ms → 2min), 0-Minuten-Fälle, `direction`-Gate (inbound/outbound), übersprungene Nummer (`undefined`), sowie den Beleg, dass die Payment-Gate-Bedingung nicht im Modul sitzt.

### Deterministisches Ergebnis (Gate-Kommandos)
`node --check` auf Modul + `server.js`; grep-Zahlen für `voiceMinutesOf`-Definition (0), die drei Call-Site-Funktionen (je 1), `tariffCentsPerMin` (0), `^export` (0, INV-10), Boot-Log-Zeile (1, INV-6); Phasen-Gate isoliert + `npm test` global (beide Backends); `git diff --stat` zeigt Netto-Minus.

### Blast-Radius & Invarianten
- **INV-9 (Geld-Pfad):** Funktionskörper byte-identisch, Gate bleibt beim Aufrufer, Cents bleiben Ganzzahl.
- **INV-7 (EINE Instanz):** `const metering` genau einmal in der Wiring-Wurzel.
- **INV-6/INV-2 (Boot-Log & Middleware-Reihenfolge):** unberührt — reine `const`-Einfügung vor `app.use`.
- **INV-10 (export-frei):** keine neuen Exports in `server.js`.
- Nicht-Ziele: keine Logik-/Intra-Funktions-Splits, kein Dedup, keine Env-Var, keine Bestandstest-Änderung.

---

## 3. Implementierung — Zusammenfassung

- **headCommit:** `90815cf701807d8ef974ebf834bd8f481c04e226`
- `node --check`: PASS
- Tests: PASS — **2285 / 2285**, 0 Fail
- Committed: ja (auf Phase-Branch)

**Umsetzung:** `src/billing/metering.js` neu angelegt mit `makeMetering({store, config})` → `voiceMinutesOf` / `recordVoiceMinuteMeter` / `reconcileOutboundVoiceBudget` / `recordNumberMonthMeter`; Körper byte-identisch aus `server.js` L1035-1088 verschoben. `server.js` verdrahtet `const metering = makeMetering({ store, config })` einmal beim Boot (nach `outboundGates`, vor `securityHeaders`); `finishCall` und `runProvisioningDrain` rufen jetzt `metering.*`. Payment-Gate (`if (config.paymentEnabled)`) bleibt beim Aufrufer; `reconcileOutboundVoiceBudget` läuft weiterhin immer. Ungenutzter `tariffCentsPerMin`-Import aus `outbound-gates.js` entfernt (0 Rest-Nutzungen in `server.js`). Alle grep-Gates aus dem Plan exakt getroffen (`voiceMinutesOf`-Definition=0, die 3 Call-Site-Funktionen je=1, `tariffCentsPerMin`=0, `^export`=0, Boot-Log=1 Treffer). Netto `server.js`: **−49 Zeilen (2244 → 2195)**, exakt wie geplant.

**Dateien:**
- Neu: `src/billing/metering.js`, `test/metering-unit.test.js`
- Editiert: `src/server.js`

**Neue/geänderte Tests:** `test/metering-unit.test.js` (neu, 11 Tests: `voiceMinutesOf`-Grenzfälle inkl. ceil-Rand 60001ms→2min, `recordVoiceMinuteMeter` 0min/N-min, `reconcileOutboundVoiceBudget` inbound/outbound/0min, `recordNumberMonthMeter` undefined/Number, sowie expliziter Beleg, dass `paymentEnabled=false` trotzdem bucht = Gate liegt beim Aufrufer, nicht im Modul).

**Smoke-Test:** PASS — Server via `test/helpers.js#startServer` gespawnt (BASE_ENV, temp DATA_DIR), `GET /healthz` → 200, Boot-Log enthält „laeuft auf http://localhost" (INV-6 bestätigt). Temp-Runner-Skript nach dem Test gelöscht, nicht committet.

### Deviations vom Plan

1. **`STORE_BACKEND=pg npm test` nicht separat als Shell-Env-Override ausgeführt.** `test/helpers.js` `BASE_ENV` setzt `STORE_BACKEND` hart auf `json` für gespawnte Server; ein äusserer Env-Var wird dafür ignoriert (dokumentierte Lehre `test-base-env-drift`). Beide Backends sind trotzdem in der EINEN `npm test`-Ausführung abgedeckt: ~126 Testdateien instanziieren PGlite direkt in-process (u.a. die Phasen-Gate-Datei `f2-p8-cost-cap.test.js`), diese liefen grün mit im vollen Lauf (2285/2285). Kein Blocker, nur eine Präzisierung des im Plan verlangten pg-Laufs.

---

## 4. Safety-Urteil (final)

**Verdict: APPROVED**

- `testsPassIndependently`: true
- `safetyGatesIntact`: true
- `disclosureIntact`: true
- `authFailClosedIntact`: true
- `noSecretsLeaked`: true
- `scopeRespected`: true
- `behaviorAsIntended`: true
- `blockers`: keine
- `concerns`: keine

**Unabhängige Verifikation:** Auf frischem `review-slim-p1` (aus `phase/slim-p1-metering`) selbst grün: (a) Phasen-Verifikations-Tests + neuer Unit-Test: `finishcall-billing-once` + `outbound-reconcile-finishcall` + `usage-event-meter` + `f2-p8-cost-cap` + `bk3-auto-provision` + `metering-unit` = 37/37 pass, 0 fail. (b) Volle Suite `NODE_ENV=test node --test test/*.test.js` = 2285 pass / 0 fail / 0 Flake (deckt beide Backends ab: json-Default + pglite in den *-pg-Tests). `node --check` grün auf `metering.js`, `server.js`, `metering-unit.test.js`.

**Begründung:** P1 ist eine saubere, byte-identische reine Verschiebung. Nur 3 Dateien (neues Modul `src/billing/metering.js`, `server.js` netto −49 Zeilen, EIN neuer Unit-Test) — keine ungefragten Extras, keine neue npm-Dependency (`package.json` unverändert). Die 5 Ziele (`MS_PER_MINUTE`, `voiceMinutesOf`, `recordVoiceMinuteMeter`, `reconcileOutboundVoiceBudget`, `recordNumberMonthMeter`) sind wortgleich in die Factory `makeMetering({store,config})` gewandert; das Modul importiert `USAGE_EVENT_KIND`/`tariffCentsPerMin`/`holdAmountForCountry` selbst (Exporte verifiziert). `grep -c 'function voiceMinutesOf' src/server.js` = 0.

**INV-9 (Geld-Pfad) eingehalten:** die Gating-Bedingung `if (config.paymentEnabled)` bleibt beim Aufrufer (`finishCall` für `recordVoiceMinuteMeter`, `runProvisioningDrain` für `recordNumberMonthMeter`), `reconcileOutboundVoiceBudget` läuft weiter IMMER; der neue Test pinnt explizit, dass das Modul selbst ungated bucht.

**INV-7:** `metering` wird genau EINMAL in der Wiring-Region (nach `outboundGates`, vor `app.use`) konstruiert.

**Kein Dangling-Ref:** `tariffCentsPerMin` (einzige Nutzung ausgelagert) korrekt aus dem Import entfernt, `holdAmountForCountry` (L1862) + `USAGE_EVENT_KIND` (L1108) korrekt behalten.

**Globale Gates:** export-Count `server.js`=0, Boot-Log-Zeile genau 1× wortwörtlich, Middleware-/Mount-Reihenfolge unberührt (INV-2/INV-6). Safety-Gates (`outbound-gates.js`), Disclosure (`claude.js`/`bridge.js`) und Auth byte-identisch/nicht im Diff. Volle Suite 2285/0 auf beiden Backends grün, kein p5-Flake.

---

## 5. Clean-Code-Audit (final)

**Verdict: PASS** — sauberer, planKonformer Leaf-Extract ohne Blocker
**Blocker: false**

### S1 (kritisch)
Keine Findings.

### S2 (schwerwiegend)
Keine Findings.

### S3 (moderat)
1. **N4 (Beobachtung, kein FLAG)** — `src/billing/` · `meter.js` (Stripe-Flush/Aggregation der `usage_events`) und `metering.js` (Erzeugung der `usage_events` + Budget-Reconcile) liegen im selben Verzeichnis mit fast identischem Namen. Beide Namen/Verantwortlichkeiten sind explizit in `PLAN-SERVER-SLIM.md` so vorgegeben (BINDEND), daher keine freie Entscheidung der Phase-Implementierung; optional liesse sich per Kopfkommentar in einer der beiden Dateien auf die jeweils andere verweisen.

### S4 (geringfügig)
Keine Findings.

### Top-Todos
- Keine blockierenden To-dos — Branch ist merge-fähig.
- Optional/nice-to-have: kurzer Querverweis-Kommentar zwischen `meter.js` und `metering.js` (S3, nicht blockierend).

### Pass-Notes
Reine, verhaltenserhaltende Extraktion aus `server.js` in `src/billing/metering.js` (`makeMetering({store, config}) -> voiceMinutesOf, recordVoiceMinuteMeter, reconcileOutboundVoiceBudget, recordNumberMonthMeter`), 1:1 deckungsgleich mit `PLAN-SERVER-SLIM.md` Abschnitt P1 (Dateipfad, Factory-Form, Funktionsnamen, Zeilenumfang ~80, Verdrahtungsort). Verifiziert: `node --check` für `metering.js`/`server.js`/Testdatei OK; `npm test` auf dem Phase-Branch: 2285/2285 grün (0 fail).

Neue Unit-Test-Datei `test/metering-unit.test.js` deckt Normalfall, 0-Minuten-Fall, `direction`-Gate (inbound/outbound), übersprungene Nummer (`undefined`) und die kritische ceil-Rundungsgrenze (60001ms → 2 Minuten) ab; nutzt einen reinen Fake-Store, kein Netz/DB (P12/F.I.R.S.T. erfüllt). Ein Test bestätigt explizit die dokumentierte Invariante INV-9: die Gating-Bedingung `config.paymentEnabled` bleibt beim Aufrufer (`finishCall`/`runProvisioningDrain`), NICHT im Modul — Modul selbst bucht ungated.

Keine toten Imports zurückgelassen: `tariffCentsPerMin` korrekt aus dem `server.js`-Import entfernt (nur noch in `metering.js` gebraucht), `USAGE_EVENT_KIND`/`holdAmountForCountry` korrekt behalten (`server.js` nutzt sie weiterhin an anderer Stelle: SMS-Kind bzw. Hold-Berechnung). `grep -c "function voiceMinutesOf" src/server.js` = 0 wie im Plan gefordert. Verdrahtung `const metering = makeMetering({ store, config })` sitzt zur Boot-Zeit im bestehenden Wiring-Bereich, konsistent mit `outboundGates`/`provisioningQueue` (P15/G24); kein TDZ-Risiko (`store` ist Namespace-Import, `config` bereits konstruiert).

Geld bleibt durchgehend Ganzzahl-Cents (G26). Kommentare durchgehend Deutsch ohne Umlaute (Konvention eingehalten), keine Kommentar-Leichen (C2), kein auskommentierter Code (C5), keine Magic Numbers ausserhalb der bereits vorher benannten Konstante `MS_PER_MINUTE` (G25). Funktionslänge/Verschachtelung/Argumentzahl aller neuen Funktionen weit unter den Richtwerten.

**cleanCodeSelfCheck (Impl-seitig, deckungsgleich mit dem Audit):** Keine Magic Numbers ausser 0/1 (`MS_PER_MINUTE` benannt, `60*1000` selbsterklärend/G25-Ausnahme wie im Original). Kein toter/auskommentierter Code. Kein ungenutzter Import. Factory-Signatur ≤3 Args via Options-Objekt (`store`, `config`). Nebeneffekte im Funktionsnamen sichtbar (`record…`/`reconcile…`). EINE Metering-Instanz (INV-7), am Boot injiziert, kein Lazy-Init (P15). `server.js` bleibt export-frei (INV-10). Kommentare deutsch ohne Umlaute, wie Bestand. Keine neue Dependency. Reine Verschiebung ohne Logik-/Intra-Funktions-Änderung; genau EIN neuer Test hinzugefügt, keine Bestandstest-Datei angefasst.

---

## 6. Fix-Runden

Keine. Der Branch hat beide Reviews (Safety und Clean-Code) im ersten Durchlauf ohne Blocker bestanden — kein Self-Fix-Zyklus erforderlich.

---

## 7. Ergebnis

| Metrik | Wert |
|---|---|
| `server.js` LOC | 2244 → 2195 (−49) |
| Neue Module | `src/billing/metering.js` |
| Neue Tests | `test/metering-unit.test.js` (11 Tests) |
| Bestandstests angefasst | 0 |
| Volle Suite | 2285 / 2285 grün, 0 Fail, 0 Flake |
| Safety | APPROVED, keine Blocker/Concerns |
| Clean-Code | PASS, S1/S2 leer, 1× S3 (Beobachtung, kein Flag) |
| Fix-Runden | 0 |
