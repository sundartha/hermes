# Clean-Code-Bestaetigungs-Audit — 2026-07-17

**Auftrag:** Nach dem grossen Umbau (Server-Slim, Clean-Code P1-P8, Fragility-Remediation P1-P7,
seit 2026-07-17 live auf master `776760e`) final bestaetigen, ob der Quellcode jetzt den
Clean-Code-Richtlinien entspricht, wartbar ist und man gefahrlos daran arbeiten kann — d.h. ob
das wiederkehrende Muster **"wir reparieren hier was, woanders geht was kaputt"** strukturell weg ist.

**Methode:** Dynamic Workflow, 31 Subagenten, gegen `.claude/refs/clean-code.md`.
12 Schicht-Auditoren (je ein Subsystem) + 3 Fragilitaets-Analysen (Hubs/Kopplung · Invarianten
G31/G27 · Nebenlaeufigkeit/Races) + adversarielle Verifikation je S1/S2-Befund + Opus-Synthese.
Token-effizient: alle Fleiss-Agenten Sonnet, Opus nur fuer die Schluss-Bewertung.
Aufwand: ~2,9M Tokens, ~26 min, 0 Agenten-Fehler. Die 3 S1 wurden zusaetzlich vom Lead direkt
am Code gegengelesen (nicht nur Agenten-Aussage).

---

## Gesamturteil

| | |
|---|---|
| **Gesamtnote** | **B** (solide) |
| **Kann man hier gefahrlos arbeiten?** | **Weitgehend ja** — fuer die heute live laufenden Pfade |
| **Tests** | **2362 / 2362 gruen, 0 fail, 0 skipped, 0 todo** (P1-Regel 1 erfuellt) |
| **Bestaetigte S1** | 3 (jeder Lead-verifiziert) |
| **Bestaetigte S2 (Duplizierung)** | 12 |
| **Widerlegte Befunde** | 0 (leichter Vorbehalt: Verifizierer refutierten nichts) |

**Headline:** Der Umbau hat die Fragilitaet fuer die live laufenden Pfade **echt** gesenkt
(`server.js` von 2679 auf 185 Zeilen zerlegt, Safety-Gates + Terminierung jetzt strukturell
statt per Kommentar) — aber `config.js` bleibt der unveraenderte zweite Hub, und es liegen
**drei bestaetigte S1-Defekte** in wenig befahrenen Ecken, die die gruene Suite nicht abdeckt.

---

## Fragilitaets-Urteil (die Kernfrage)

Der Vor-Audit (2026-07, **vor** dem Umbau) nannte zwei Ursachen fuer "fix hier / kaputt dort":

### Ursache A — Ueberwachsene Hubs → **TEILWEISE behoben** (Note C)
- ✅ `server.js`: von **2679 → 185 Zeilen** ECHT zerlegt — per Code-Lesen als echte
  Modularisierung in 20+ einzeln instanzierte, einzeln testbare Module verifiziert, mit
  `app.js` als sauberem Composition-Root (Fan-in 1). Keine Kosmetik.
- ❌ `config.js`: im Kern **unveraendert** — 99 flache Top-Level-Keys, Fan-in 31, nur 3 gruppiert.
  Der neue `guardedConfig`-Proxy + `numEnv`/`boolEnv` haerten die gefaehrlichste *Folge*
  (stiller Drift wird laut), loesen aber nicht die Fan-in/Flach-Form.

### Ursache B — Invarianten per Konvention statt Struktur (G31/G27) → **WEITGEHEND behoben** (Note B)
- ✅ Outbound-Safety-Gates: aus "Reihenfolge per Kommentar" → **benanntes 16-elementiges Array
  mit Order-Snapshot-Test**, der Umsortierung bewusst bricht.
- ✅ Call-Terminierung: `terminateAndBillCall` erzwingt den bill-Thunk als **Pflichtparameter
  mit fail-fast Throw** — die alte C5-Bugklasse ist fuer den Budget-Pfad strukturell unmoeglich.
- ✅ End-Call-Guard: eine geteilte reine Funktion (eine Quelle).
- ⚠️ **Nicht ueberall angewendet:** Telnyx-Shim-Gates bleiben kommentar-geordnet ohne Order-Test;
  der Realtime-Pfad (`bridge.js finalize`) umgeht `terminateAndBillCall` komplett — dort ist die
  C5-Bugklasse nie geschlossen worden. Beide heute **dormant**, aber beim Aktivieren sofort wieder Treiber.

### Ursache C (die alten offenen S1) — Nebenlaeufigkeit/Races → **BEHOBEN** (Note A)
Alle 4 im Vor-Audit benannten S1 sind **strukturell mit Regressionstests zu**: Stripe-Webhook-Race
(Per-Tenant-Serialisierung), Float-Budget (durchgaengig Ganzzahl-Cent), pg/json-Boolean-Drift,
Terminierungs-Idempotenz. Ein Kontroll-Test beweist sogar aktiv, dass die alte Luecke ohne den Fix
reproduzierbar waere. Die staerkste Dimension des ganzen Audits.

**Fazit:** Fuer heute (`VOICE_ENGINE=budget`) ist "fix hier / kaputt dort" strukturell
unwahrscheinlicher geworden — verifiziert, nicht behauptet. Rest-Risiko: config-quere Aenderungen
und der dormante Realtime-Pfad.

---

## Schicht-Notenspiegel

| Note | Schicht | Kern |
|---|---|---|
| **A** | store-json-defaults | Crash-sichere atomare Persistenz, Reentrancy via AsyncLocalStorage, keine S1/S2 |
| **A** | telephony-gates-adapters | Sauberste Schicht: 16-Gate-Array + Order-Test, fail-closed, Secret-Guard-Test |
| **A** | routes | Einheitliches DI-Factory-Muster, Ownership eine Quelle, Signatur-Reihenfolge getestet |
| **B** | store-state-ops | Geld Ganzzahl-Cent, Nummer-Zustandsmaschine wirft strukturell; 1 S2 Timestamp-Dup |
| **B** | store-pg | RLS strukturell erzwungen; **S1** `ensureTenant` ohne `setTenant` |
| **B** | config-boot | `guardedConfig`+`numEnv`/`boolEnv`; **S1** `numEnv` parseInt-Trailing-Garbage |
| **B** | auth-wiring | Durchgehend DI, advisory-lock gegen Tenant-Race; S2 `webAuth`-Dup |
| **B** | telephony-core | `terminateAndBillCall` erzwingt bill-Pflicht; S2 Max-Dauer-Formel-Dup |
| **B** | conversation-llm | `llm.js`-Seam sauber DI-getestet; S2 Log-Prefix 14x, dailySmsCap-Default doppelt |
| **B** | billing-provisioning | Geld Ganzzahl-Cent, Webhook fail-closed; **S1** Provisioning-Enqueue vor Persist |
| **B** | mcp-ui | Whitelist+zod gegen Feld-Leck, DIP-Seam; 2 S2 Renderer-/Capability-Dup |
| **B** | gateway-misc | `app.js` sauberer Composition-Root; S2 `bridge.js` dritte Max-Dauer-Kopie |

---

## Bestaetigte S1 (Korrektheit/Sicherheit — alle Lead-gegengelesen)

### S1-1 · `src/store/pg.js:504` (G31) — stiller Datenverlust (Postgres-Backend)
`ensureTenant()` ruft im "abwesend"-Zweig `hydrateTenantInto()` **ohne** vorheriges
`setTenant(client, tenantId)` — anders als das korrekte `hydrateTenants` (Zeile 546-547).
Bei aktivem FORCE-RLS blockt die fehlende GUC die tenant-scoped SELECTs (der explizite
`tenant_id`-Filter rettet nicht, RLS ANDet). → `state.calls` bleibt leer → das naechste
`save()` → `deleteMissingCallsKeepActive` **loescht real existierende (nicht-aktive) Call-Zeilen**.
Latenter Rand-Branch: greift nur, wenn der Tenant im Spiegel fehlt UND bereits DB-Zeilen hat
(z.B. von einem anderen Prozess beruehrt). Von einem Agenten mit pglite + nicht-privilegierter
Rolle empirisch reproduziert; kein Test deckt diesen Branch ab.
**Fix:** `await setTenant(client, tenantId);` vor Zeile 504 + RLS-Regressionstest gegen den
absent-Branch mit vorab existierenden Call-Zeilen.

### S1-2 · `src/worker/provisioning-orchestrator.js:39` (G31) — verwaister Kauf ohne Audit-Spur
`queueProvisioning()` ruft `queue.enqueue()` (Zeile 39) **vor und unabhaengig** vom
`withStoreLock`-Block, der die Job-Spur persistiert. Schlaegt die Persistenz fehl, faengt der
`.catch` `{ok:false}` (Aufrufer meldet 503) — der Queue-Eintrag bleibt aber liegen (memory-Queue
kennt kein dequeue). Der naechste Drain **eines beliebigen anderen Onboardings** verarbeitet ihn:
echter Provider-Kauf (Hold+Capture, **echtes Geld**) laeuft durch, obwohl "nichts passiert"
gemeldet wurde. Da `s.provisioningJobs` nie einen Eintrag bekam, sieht auch der PROV-01-Reconciler
den Kauf nie — **keine Audit-Spur, keine Storno-Moeglichkeit**.
**Fix:** Reihenfolge tauschen (erst persistieren, dann `enqueue` nur bei Erfolg); oder `QueuePort`
um kompensierendes `dequeue(idempotencyKey)` erweitern und bei Persist-Fehler zuruecknehmen.

### S1-3 · `src/config.js:29` (G26) — vertippter Safety-Gate-Env-Wert kippt still
`numEnv()` validiert per `Number.isFinite` **nach** `parseInt`/`parseFloat` — beide sind nicht
strikt: `parseInt("120abc",10)===120`, `parseInt("45.9")===45`. Ein gesetzter-aber-vertippter
Env-Wert wird still zum Teilwert **statt fatal zu werfen** — entgegen dem eigenen Kommentar
(Zeile 20: "Boot wird verweigert statt lautlos ohne Gate weiterzulaufen"). Betroffen sind
Safety-Gates: `MAX_CALLS_PER_HOUR`, `PER_TARGET_CALL_CAP`, `MAX_BUDGET_EUR`, `MAX_CALL_DURATION_S`,
`RATE_LIMIT_PER_MIN`. Ungetestet.
**Fix:** `Number(raw.trim())` statt `parseInt`/`parseFloat` (dann `"120abc"→NaN→fatal`) + im
Integer-Modus `Number.isInteger` pruefen; Trailing-Garbage-Testfall ergaenzen.

---

## Bestaetigte S2 (Duplizierung — Divergenzrisiko, kein akuter Bug)

Die wichtigste (weil sicherheitskritische) zuerst:

1. **Max-Dauer-Formel `(call.maxDurationS || config.maxCallDurationS) * 1000` existiert 3x**
   unabhaengig: `bridge.js:282` (roher Magic-1000), `call-lifecycle.js:29`, `state-ops.js:373`
   (mit `MS_PER_SECOND`). Policy-Aenderung (Absolute Regel 1) kann in einer Engine landen und in
   der anderen lautlos fehlen. → **Einen geteilten Helfer fuehren.**
2. **`bridge.js:122` umgeht `terminateAndBillCall`** (6. Terminierungspfad) — der bill-Pflicht-Schutz
   gilt dort nicht; Modul-Kommentar behauptet faelschlich "JEDER Beender". → finalize() umstellen
   oder Wiring-Test + Kommentar korrigieren.
3. `web-auth.js:696` — `webAuth`/`webAuthAllowPending` bis auf Status-Praedikat identisch (Auth-Divergenzrisiko).
4. `config.js:156` — Trailing-Slash-Strip `.replace(/\/$/,"")` 7x dupliziert.
5. `state-ops.js:306` — Set-once-Timestamp-Helfer (`markAnswered`/`markSummarySmsSent`/`markBilled`) identisch.
6. `pg.js:1220` — `own = filter; deleteMissing(...)`-Idiom 3x kopiert.
7. `telnyx-call-control-ingest.js:34` — Log-Prefix `"[voice/call-control]"` 14x dupliziert.
8. `sms-summary.js:42` — `dailySmsCap ?? 20` dupliziert den config-Default (toter Fallback).
9. `contract.js:20` + `mcp-native.js:9`/`chatgpt.js:9` — Capability-/Renderer-Adapter strukturell identisch.

---

## Top-Todos (priorisiert)

1. **S1-1** `pg.js`: `setTenant` vor `hydrateTenantInto` in `ensureTenant` + RLS-Regressionstest (stiller Datenverlust).
2. **S1-2** `provisioning-orchestrator.js`: Persistenz vor `enqueue` ziehen (verwaister Kauf/kein Audit).
3. **S1-3** `config.js`: `numEnv` strikt validieren (`Number()`/Regex) + Trailing-Garbage-Test.
4. **bridge.js (B-1):** `finalize()` auf `terminateAndBillCall` umstellen oder Wiring-Test — bevor `VOICE_ENGINE=realtime` aktiviert wird.
5. **config.js-Gruppierung (A1):** ~76 Flat-Keys in Namespaces (`safety/*`, `billing/*`, …) hinter `guardedConfig` buendeln — den zweiten Hub tatsaechlich entschaerfen.
6. **`callMaxDurationMs`** als EINEN geteilten Helfer (bridge + call-lifecycle + state-ops).
7. **Telnyx-Shim-Gates (A2):** dasselbe `{name,run}`-Array + Order-Test wie `outbound-gates.js`, oder begruenden warum der dormante Endpunkt es nicht braucht.
8. **Doku-Drift:** veralteter KYC-Kommentar (`state-ops.js`) + `schema.sql:226` `cost_eur`-Float-Kommentar beschreiben den Vor-Fix-Zustand.

---

## Was nachweislich sauber gebaut ist

1. **Nebenlaeufigkeit an der Wurzel geschlossen** — alle 4 Baseline-S1 mit lauffaehigen
   Regressionstests behoben, inkl. Kontroll-Test der die alte Luecke beweist.
2. **Outbound-Gate-Kette** = 16-elementiges benanntes Array mit Order-Snapshot-Test (Reihenfolge ist Daten, nicht Zufall).
3. **`terminateAndBillCall`** erzwingt den bill-Thunk per fail-fast Throw — C5-Bugklasse fuer den Budget-Pfad strukturell unmoeglich.
4. **`server.js` 2679→185** echt zerlegt: `app.js` Composition-Root (Fan-in 1), 20+ eigenstaendige DI-Module.
5. **Geld projektweit Ganzzahl-Cent** (`eurToCents` gegen die JS-Float-Falle getestet); Secrets/PII leaken in keiner Schicht durch Logs (statischer Secret-Guard-Test).
6. **RLS auf 13 Tabellen mit FORCE** aktiv, per nicht-superuser-Test abgesichert.
7. **Drei Schichten komplett ohne S1/S2** (telephony-gates-adapters, routes, store-json-defaults). Gesamte 2362-Test-Suite gruen.

---

## Einordnung / Grenzen dieses Audits

- Die 3 S1 liegen allesamt in **wenig befahrenen Ecken** (Postgres-absent-Branch, Provisioning-
  Persistenz-Fehler, Env-Fehlkonfiguration) — genau deshalb ueberleben sie die gruene Suite:
  diese Pfade sind ungetestet. Kein Widerspruch zu "2362 gruen", sondern die praezise Grenze der Zusage.
- **0 widerlegte Befunde** heisst: die Verifizierer haben nichts refutiert. Bei objektiven
  Duplizierungs-Befunden (S2) plausibel; die 3 S1 wurden zur Sicherheit vom Lead direkt am Code gegengelesen.
- Rohdaten aller 31 Agenten + Per-Schicht-`strengths`/`s3s4`-Details:
  `subagents/workflows/wf_e50cc1ee-c7b/journal.jsonl` (Session-Transcript).

**Unterm Strich:** Solides **B**. Die Fragilitaet ist fuer das, was heute telefoniert, real und
verifiziert gesunken — kein diffuses "ueberall koennte was sein", sondern eine kurze, konkrete,
abarbeitbare Liste. Genau das Rest-Risiko, mit dem man kontrolliert weiterbauen kann.
