# Phase AL-P2s — Detailbericht

**SSE-Spike-Schalter befristet erneut aufsetzen** (Vorlage `af4a66e`, Geldpfad im Shim geschuetzt)

- **Gate:** PASS
- **finalBranch:** `phase/al-p2s-spike-schalter`
- **headCommit:** `e3d1735a7fa8311639c20ad01b9c0e8829a1fc57`
- **Basis:** `master` = `8bd6af4`
- **Vorlage:** `af4a66e` (Rueckbau-Commit, der ihn entfernte: `643f8dc`, KS-AUF)

---

## 1. Plan (gekuerzt)

**Ziel:** den bereits einmal gebauten SSE-Spike-Schalter (Diagnose-Messwerkzeug: verzoegert
gezielt die Antwort einer einzelnen konfigurierten Zielrufnummer im Telnyx-LLM-Shim, um zu
messen, ob Telnyx vor `data:[DONE]` zu sprechen beginnt) wortgetreu wiederherstellen, diesmal
fuer eine Live-Messung gegen die Mobilnummer des Owners statt gegen einen Wegwerf-Dienst.

**Ausgangsbefund (§0):**
- 12 von 15 Vorlage-Dateien applyen konfliktfrei auf master (`git apply --check`).
- 3 Dateien brauchen Handarbeit: `src/telnyx-llm-shim.js`, `test/telnyx-shim-harness.js`,
  `tasks/al-testcall-checklist.md` — weil seit `af4a66e^` der KS-P1b-Drift
  (`reattachActiveCallByControlId`, `resolveOrReattachActiveCall`, `logShimReattach`) dazukam.
- Der KS-P2-Live-Budget-Term sitzt NICHT im Shim, sondern in `blockingBudgetAxis`
  (`src/budget-gate.js`) — diese Phase fasst ihn nicht an.
- `sleepMs`, `e164Env`, `sseSpike*`, `splitAtFirstSentence` existierten nirgends mehr im Bestand.
- `configFingerprint` hasht eine feste 7-Achsen-Liste — neue Config-Keys aendern den Hash nicht.
- Test-IDs `AL-P2-*` matchen den Katalog-Filter nicht (`npm test`, nicht `test:gates`).
- Fuer Inbound ist `call.to` immer die eigene DID — der Spike-Scope (`call.to === callee`)
  kann strukturell kein Inbound-Gespraech treffen.

**Pre-Mortem (§1), Kernrisiken und Gegenmittel:**

| Risiko | Gegenmittel |
|---|---|
| Kundenanruf haengt stumm | `sseSpikeDelayMsFor` ist einzige Entscheidungsstelle, dreifach konjunktiv (Verzoegerung UND Zielnummer UND `call.to === callee`), exportiert + getestet; Notaus-Pfade verzoegern nie |
| Schalter bleibt monatelang scharf | Boot-Refusal-Footgun, Boot-Banner-Zeile, `sse_spike_delay`-Logzeile; Rueckbau als eigene Pflicht-Phase AL-P2z |
| Schalter griff nie, Messung umsonst | `e164Env` fail-closed (Muell -> Fatal-Push, Boot-Refusal) |
| Owner-Rufnummer im Log/Repo | Banner/Log/Config-Diagnose nennen nur Var-Namen + delayMs, nie den Wert; Checkliste nutzt Platzhalter |
| Geldpfad beschaedigt | Handarbeit nur an 3 Dateien, KS-P1b wortwoertlich unangetastet, KS-P2 (`budget-gate.js`) nicht beruehrt — per Diff belegt |
| Live-Messung gegen Owner-Mobilnummer statt Wegwerf-Dienst | Owner-Entscheidung 2026-07-31; Code-Scope aendert sich nicht (Zielnummer ist Env, kein Code); Inbound strukturell ausgeschlossen; bekanntes Betriebsrisiko (US-DID->DE-Mobil intermittent) im Fahr-Protokoll benannt |

Nicht beruehrt: alle Safety-Gates, `disclosureSentence`, alle vier Auth-Kanten des Shims,
`latencyMs` in `turn_ok`, Audio-durch-MCP-Verbot, keine neue Dependency.

**Vorgehen:** 12 Dateien mechanisch per `git apply --include=...` aus dem Vorlage-Patch,
danach Etikett `AL-P2` -> `AL-P2s` in neu eingefuegten Kommentaren (Test-IDs `AL-P2-1..20`
bleiben unveraendert); 3 Dateien von Hand (siehe Impl unten); `PLAN-SECURITY.md`-Abschnitt
neu betextet (Grund fuer die zweite Existenz, Rueckbau als eigene Phase AL-P2z).

**Deterministische Pruefungen (§6):** `node --check`, Diff-Beweise (6 Dateien byte-identisch
zur Vorlage; Shim-Diff enthaelt nur KS-P1b+Spike; Geldpfad-Diff leer), Lint/Format, Fokuslauf,
`npm test`, `npm run test:gates` (unveraendert), Smoke ohne/mit Env-Vars.

---

## 2. Implementierung — Zusammenfassung

Branch `phase/al-p2s-spike-schalter`, Commit `e3d1735`, 15 Dateien, +704/-43.

- 12 konfliktfreie Vorlage-Dateien per `git apply` mechanisch restauriert:
  `src/config.js`, `src/boot.js`, `src/utils/timer.js`,
  `scripts/telnyx-call-latency.mjs`, `.env.example`, `render.yaml`, `test/helpers.js`,
  `test/config-namespaces-helper.js`, `test/config-shape.test.js`,
  `test/telnyx-call-latency.test.js`, `test/al-p2-sse-spike.test.js` (neu, 298 Z.),
  `PLAN-SECURITY.md`.
- 3 Dateien von Hand nachgezogen:
  - `src/telnyx-llm-shim.js` (8 Hunks): Import `sleepMs`, Konstante `FIRST_SENTENCE`,
    neue Funktionen `splitAtFirstSentence`, `sseSpikeDelayMsFor` (die eine
    Entscheidungsstelle: Verzoegerung UND Zielnummer UND `call.to === callee`),
    `spikePauseFor`; `writeStreamingCompletion`/`writeCompletion` werden `async` mit
    optionalem `pause`-Haken; neuer Log-Kanal `logShimSseSpike` (nur callId+delayMs, PII-frei);
    DI-Parameter `sleep = sleepMs` in der Factory; die 5 `writeCompletion`-Aufrufstellen
    angepasst — nur der Happy-Path (Abschiedssatz) erhaelt eine Pause, alle 4 Notaus-Pfade
    (Budget-Kill, Loop-Guard, Rate-Gate, Degradations-Catch) ausdruecklich keine.
  - `test/telnyx-shim-harness.js` (3 Hunks): Import `sleepMs`, DI-Parameter `sleep` in
    `makeHandler` durchgereicht, neuer Export `sleepSpy` (protokolliert ms + Chunks-vor-Pause
    als Reihenfolge-Beweis).
  - `tasks/al-testcall-checklist.md`: Block „BLOCKER Nr. 1" ersetzt durch ein 7-Schritte-
    Fahr- und Rueckbauprotokoll (Live-Dienst, Owner-Mobilnummer statt Wegwerf-Dienst;
    Scharfschalten, Anrufe, Urteil per `telnyx-call-latency.mjs`, Timeout-Leiter, Rueckbau als
    Phase AL-P2z, Altlasten aus der ersten Runde).

**Verifikation:** `node --check` auf allen 11 beruehrten `.js`-Dateien gruen; Fokuslauf
(9 Dateien) gruen inkl. 20 neuer Tests `AL-P2-1..20`; `npm test` 3611 Tests / 0 rot;
`npm run test:gates` unveraendert 129/126/3 (bekannte Baseline, kein Test abgerutscht);
Smoke bestaetigt Inertheit ohne Env-Vars und die PII-freie AKTIV-Bannerzeile mit Env
(Rufnummer taucht nirgends im Log auf, grep-Zaehler 0).

### Deviations

1. Plan-interner Widerspruch (§2 Schritt 1 „Etikett umbenennen" vs. §6 Pruefung (2)
   „Diff muss leer sein" fuer dieselben 4 Dateien `src/utils/timer.js`,
   `scripts/telnyx-call-latency.mjs`, `test/config-shape.test.js`,
   `test/config-namespaces-helper.js`): §2 befolgt (normative Bauanweisung). Belegt: Diff
   besteht ausschliesslich aus 8 Kommentar-Etikettzeilen, `test/al-p2-sse-spike.test.js` und
   `test/telnyx-call-latency.test.js` byte-identisch zur Vorlage.
2. Plan §6 Pruefung (4) `git diff af4a66e^ HEAD -- src/budget-gate.js src/store/state-ops.js`
   kann nicht leer sein, weil KS-P2/KS-P4 diese Dateien nach `af4a66e^` umgebaut haben.
   Ersetzt durch die aussagekraeftige Variante gegen `master` (inkl. `src/billing/metering.js`)
   — leer, Geldpfad unberuehrt.
3. `eslint` im Worktree nicht ausfuehrbar (`@eslint/js` fehlt) — ersetzt durch `node --check`
   auf allen 11 Dateien plus manuelle Sichtung.
4. `prettier` (npx-Cache 3.9.6 statt gepinnt ^3.8.4) meldet 9 Dateien — dieselben sind schon
   auf `master` rot (Baseline gemessen); Gegenprobe zeigt: kein einziger neuer Hunk wird
   umformatiert.
5. Der vorgegebene Setup-Symlink `ln -s "./node_modules" node_modules` war im Worktree
   selbstbezueglich — auf absoluten Pfad relinkt.
6. `npm test` 3611/0 — die Master-Baseline-Rechnung „Bestand + 20" wurde nicht ziffernweise
   nachgefahren (Laufzeit); stattdessen `npm run test:gates` als relevantere Invariante
   verifiziert (unveraendert 129/126/3, keine AL-P2-Tests im Katalog-Filter gelandet).

---

## 3. Safety-Urteil (final)

**Verdict: FREIGABE (approved: true)**

Alle Pruefwerte: `testsPassIndependently`, `safetyGatesIntact`, `disclosureIntact`,
`authFailClosedIntact`, `noSecretsLeaked`, `scopeRespected`, `behaviorAsIntended` — alle `true`.
`blockers: []`.

**Unabhaengige Nachpruefung:** frischer Worktree, Basis frisch bestaetigt
(`git merge-base --is-ancestor master review-al-p2s`, Branch genau 1 Commit vor `master`).
`npm test`: 3611/3609/2 rot im ersten Lauf — isoliert `test/i6-write-scope.test.js` 17/17 gruen,
Wiederholungslauf 3611/3611/0 — dokumentierter Voll-Last-Spawn-Race, kein Regressionsfang,
inhaltlich ausserhalb des Diffs. PG-Backend separat: 269/269 gruen. `npm run test:gates`:
129/126/3, deckungsgleich mit dokumentiertem Bestand, kein neues Rot.

**Eigene Gegenproben:**
- Roh-Draht-Vergleich der `res.write()`-Folge (zeichengenau, nur id/created maskiert):
  Spike AUS == Spike armiert-aber-Fremdziel == Verzoegerung-ohne-Zielnummer — alle drei
  zeichengleich. Nur der exakte Treffer weicht ab (genau 1 Pause).
- Fuzz auf `sseSpikeDelayMsFor` mit 14 feindlichen `call`-Formen und 6 Konfig-Formen —
  ausnahmslos 0, strikte `===`-Gleichheit haelt, kein Coercion-Schlupfloch.

**Absolute Regeln, einzeln geprueft:**
1. Safety-Gates unberuehrt — `src/telephony/`, `src/budget-gate.js`, `src/routes/` nicht im
   Diff; die 4 Notaus-Pfade uebergeben nachweislich keine Pause; neue Footgun-Klausel
   verschaerft nur (Boot-Refusal), lockert nichts.
2. Offenlegung unberuehrt — `src/claude.js`/`src/bridge.js` nicht im Diff.
3. Auth fail-closed unberuehrt — `src/auth.js`/`src/web-auth.js`/`src/middleware.js` nicht im
   Diff; Spike sitzt hinter allen 4 Auth-Kanten des Shims.
4. Secrets/PII — `e164Env`, Banner, Log nennen nie den Wert/die Rufnummer, nur Var-Name bzw.
   delayMs; `configFingerprint` unveraendert (7 Achsen, `sseSpikeCallee` nicht darunter);
   `render.yaml` setzt die Zielnummer `sync:false`.
5. Scope respektiert — 15 Dateien, keine neue Dependency (`package.json` unveraendert).
6. Flag-off Byte-Identitaet selbst gemessen (nicht geglaubt) — bei `pause=null` zeichengleich
   zum Vor-Spike-Draht.

**Concerns (keine Blocker, dokumentiert):**
- Owner-Entscheidung: Messung laeuft jetzt auf dem Live-Dienst gegen die Owner-Mobilnummer
  statt gegen einen Wegwerf-Dienst — Diagnose-Schalter kurzzeitig im echten Antwortpfad
  echter Kunden. Eingrenzung haelt (Fuzz-belegt), aber ein anderer Tenant, der dieselbe
  Nummer waehlt, bekaeme dieselbe Verzoegerung. In `PLAN-SECURITY.md` als bewusst akzeptierte
  Folge festgehalten.
- Rueckbau (AL-P2z) ist eine Zusage, kein Mechanismus — kein Code-seitiger Zwang, ihn zu
  fahren; die 3 Sonden verhindern nur Unbemerktheit, nicht Fortbestand.
- `numEnv` clamped `TELNYX_SSE_SPIKE_DELAY_MS > 30000` still auf 30000 (kein Fatal) — bei der
  Timeout-Leiter koennte ein Tippfehler unbemerkt als falsche Sprosse gemessen werden.
- Im JSON-Modus (`stream:false`) ist der armierte Spike wirkungslos UND stumm (kein Log) —
  wuerde Telnyx je `stream:false` senden, wuerde das Messwerkzeug faelschlich „incremental"
  melden. Abgesichert nur durch Checkliste (Operator-Disziplin, keine Code-Sperre).
- Vorbestehend, nicht neu: `tasks/al-testcall-checklist.md` traegt weiterhin die Live-DID im
  Klartext (stand schon so auf master).
- `npm run test:gates` bleibt mit 3 roten Tests rot (GAP-05, GAP-15 x2) — dokumentierter
  Bestand aus der Gates-Fix-Kette, nicht von dieser Phase verursacht, kein Blocker.

---

## 4. Clean-Code-Audit (final)

**Verdict: PASS, blocker: false**

- **S1 (hart):** keine Befunde.
- **S2 (hart):** keine Befunde.
- **S3 (mittel):** eine Randnotiz — `writeCompletion` gibt im Stream-Zweig
  `return await writeStreamingCompletion(...)` zurueck, im JSON-Zweig kein `return`
  (implizit `undefined`). Funktional harmlos, Rueckgabewert wird nirgends genutzt, aber
  Asymmetrie ohne erkennbaren Grund. Kosmetischer Optional-Fix: beide Zweige einheitlich als
  reines `await ...;` ohne `return`, oder Kommentar zur Begruendung.
- **S4 (niedrig):** keine Befunde.

**Begruendung des PASS:** fail-safe im Shim (`sseSpikeDelayMsFor` liefert 0 ohne Zielnummer =
Bestandsverhalten), fail-closed im Hosting (Verzoegerung ohne Zielnummer -> Boot-Refusal).
Notaus-Pfade nachweislich sofortig (AL-P2-12/13). PII-Disziplin konsequent. DI-Pattern fuer
`sleep` folgt bestehendem Timer-Injektions-Muster. 20 neue + 62 Bestandstests
(`test/telnyx-llm-shim.test.js`) gruen im geklonten Branch-Checkout. Byte-Identitaet bei
Spike=0 explizit per Test AL-P2-6 gepinnt. Alle 5 `writeCompletion`-Aufrufstellen konsequent
awaited, sodass Watchdog-Terminierung erst nach echtem Abschluss des Response-Writes inkl.
Pause laeuft (sonst Race, G31). Doku konsistent mit Code, Rueckbau explizit als eigene
Pflicht-Phase benannt.

**TopTodos (keine Blocker):**
1. S3-Randnotiz (asymmetrisches `return`) — rein kosmetisch, bei Gelegenheit mitnehmen.
2. Owner-Aufgabe: Rueckbau als Phase AL-P2z tatsaechlich fahren nach dem Live-Spike-Lauf.
3. Bei der Timeout-Leiter beachten, dass jede Delay-Stufe erneut den Footgun-Constraint
   durchlaeuft (bereits so gebaut, nur Hinweis fuer den Owner-Handlauf).

---

## 5. Fix-Runden

Keine — der Impl-Durchlauf erreichte PASS ohne Nachbesserungsrunde
(FIXES-Abschnitt der Quelle ist leer).
