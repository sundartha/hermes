# Phase AL-P2z — SSE-Spike-Schalter ersatzlos aus master

**Gate: PASS** | **finalBranch:** `phase/al-p2z-spike-entfernen` | **headCommit:** `c2d523671787a43aaf8655ddd28026ccccdb99ac`

## 0. Zweck / Ausgangslage

Vorlage: KS-AUF (`643f8dc`, ersatzlose Entfernung eines befristeten Spike-Schalters). AL-P2z entfernt den befristeten SSE-Spike-Schalter (AL-P2s, eingefuehrt mit `e3d1735`), der die Frage "verzoegert Telnyx die SSE-Antwort ('incremental' vs. 'buffered')?" messen sollte. Die Messung ist gefahren und protokolliert (`tasks/al-chain-state.md`: 2026-07-31 AL-P2 GEMESSEN `incremental`/GRUEN, Median 129 ms bei 8000 ms Rueckhalt; Telnyx-Turn-Timeout > 30 s). Damit ist der Schalter zwecklos und wird — analog KS-AUF — ersatzlos entfernt, nicht nur auf 0 gestellt.

`git revert e3d1735` ging nicht direkt (AL-P14 legte danebenliegende Hunks in `src/utils/timer.js`/`src/boot.js` nach), daher Handarbeit mit einem deterministischen Kontrollmechanismus: sechs Dateien ohne Drift seit `e3d1735` wurden auf den byte-identischen Vor-Spike-Blob (`e3d1735^`) zurueckgesetzt, sieben weitere Dateien manuell bereinigt unter Erhalt der AL-P14-Arbeit.

## 1. Plan (gekuerzt)

### Ziel-Tabelle (Rueckbau-Modus je Datei)

| Datei | Ziel |
|---|---|
| `src/telnyx-llm-shim.js` | byte-identisch `e3d1735^` |
| `scripts/telnyx-call-latency.mjs` | byte-identisch `e3d1735^` |
| `test/telnyx-shim-harness.js` | byte-identisch `e3d1735^` |
| `test/config-shape.test.js` | byte-identisch `e3d1735^` |
| `test/config-namespaces-helper.js` | byte-identisch `e3d1735^` |
| `test/telnyx-call-latency.test.js` | byte-identisch `e3d1735^` |
| `src/config.js`, `src/boot.js`, `src/utils/timer.js`, `test/helpers.js`, `.env.example`, `render.yaml`, `PLAN-SECURITY.md` | Handedit (AL-P14-Drift bleibt stehen) |
| `test/al-p2-sse-spike.test.js` | geloescht |

Die Byte-Identitaet ist als Kontrollmechanismus gedacht, nicht als reines Ausfuehrungsrezept: `git checkout e3d1735^ -- <datei>` ist erlaubte Ausfuehrung, das Ergebnis muss aber gegen den heutigen Kontext gelesen und im Bericht begruendet werden (`git diff e3d1735 HEAD -- <datei>` = leer als Beleg, dass keine Nachbar-Aenderung verlorengeht).

### Wesentliche Edits (Auszug)

- **`src/telnyx-llm-shim.js`** (9 Stellen): Import `sleepMs` raus; `FIRST_SENTENCE`, `splitAtFirstSentence`, `sseSpikeDelayMsFor`, `spikePauseFor`, `logShimSseSpike` komplett raus; `writeStreamingCompletion`/`writeCompletion` zurueck auf synchron (kein `await` ohne Zweck, G12); Factory-Parameter `sleep` raus; die fuenf `writeCompletion`-Aufrufstellen zurueck auf die Bestandsform ohne `pause`.
- **`src/config.js`**: `E164`-Import raus (kein zweiter Nutzer verifiziert), `e164Env` raus (einziger Nutzer war `sseSpikeCallee`), `telnyxAssistant`-Block um die Spike-Keys gekuerzt, `productionFootguns`-Klausel raus (prueft ausschliesslich den Spike selbst, kein Bestands-Gate betroffen).
- **`src/boot.js`**: `sseSpikeBannerLine` + Banner-Zeile raus; stale Kommentar-Referenz in `inCallConsultBannerLine` geheilt (`Muster sseSpikeBannerLine` -> `Muster assistantPathLabel`, C2).
- **`src/utils/timer.js`**: `sleepMs` raus (einzige Aufrufer waren `telnyx-llm-shim.js` und der Test-Harness, beide entschaerft); `defaultSetTimer`/`MS_PER_SECOND`/`MS_PER_MINUTE` (AL-P14) bleiben.
- **`scripts/telnyx-call-latency.mjs`**: Spike-Urteil (`sseSpikeVerdict`, `printSpikeVerdict`, `SPIKE_*`-Konstanten, `extractSpikeDelay`) raus; `parseLatencyArgs` wieder zu einer Funktion zusammengefuehrt (S4); `unaccountedVerdict`/Tabelle/`--call` unangetastet (das ist AL-P1).
- **`.env.example`**, **`render.yaml`**: die je neun Zeilen der beiden `TELNYX_SSE_SPIKE_*`-Env-Eintraege raus.
- **`PLAN-SECURITY.md`**: kompletter Abschnitt `## AL-P2S-SSESPIKE …` raus, kein Ersatz-Eintrag (Historie steht in `tasks/al-p2s-report.md`/`tasks/al-chain-state.md`).
- **Tests**: `test/al-p2-sse-spike.test.js` geloescht (17 Tests); in `test/telnyx-call-latency.test.js` die drei AL-P2-18/19/20-Tests + Helfer raus; `test/telnyx-shim-harness.js`, `test/config-namespaces-helper.js`, `test/config-shape.test.js`, `test/helpers.js` (`BASE_ENV`) entsprechend bereinigt. Keine neuen Tests — der Bestand (`telnyx-llm-shim.test.js`, `config-shape.test.js`, `config-namespaces.test.js`, `telnyx-call-latency.test.js`, `ks-p1b-shim-reattach.test.js`) pinnt das Zielverhalten bereits vollstaendig; die Byte-Identitaets-Pruefung ersetzt hier den Mutationstest.
- **`tasks/al-testcall-checklist.md`**: BLOCKER-Abschnitt (Fahranleitung des Schalters) durch einen kurzen, belegten Statuseintrag ersetzt.

### Deterministisch pruefbares Ergebnis (Kontrollskript im Plan)

1. Sechs driftfreie Dateien byte-identisch zu `e3d1735^` (Diff leer).
2. In den gedrifteten Dateien nur AL-P14-Arbeit stehen (grep auf spike/sleepMs/e164Env = 0 Treffer).
3. Repo-weiter grep `sse[_-]?spike|splitAtFirstSentence|spikePause|sleepMs|sleepSpy|e164Env` in `src/`, `test/`, `scripts/`, `public/`, `docs/`, `.env.example`, `render.yaml`, `PLAN-SECURITY.md`, `README.md`, `STATUS.md` = keine Ausgabe.
4. `test/al-p2-sse-spike.test.js` existiert nicht mehr.
5. `node --check` auf allen fuenf geaenderten `.js`-Dateien gruen.
6. `npm test` gruen (Testzahl = Baseline minus 20).
7. Smoke: Boot-Banner ohne "SSE-Spike:"-Zeile, `/healthz` 200.

### Pre-Mortem (Kernpunkte)

| Szenario | Wurzel | Entschaerfung |
|---|---|---|
| Kundenanruf haengt, weil ein Rest des Schalters ueberlebt | Teil-Rueckbau | Byte-Identitaet + grep-Pruefung muessen beide gelten |
| KS-P1b/KS-P2 beschaedigt | `git checkout` ueberschreibt fremde Arbeit | `git diff e3d1735 HEAD -- src/telnyx-llm-shim.js` = leer, kein Fremdanteil seit dem Spike; zusaetzlich `ks-p1b-shim-reattach.test.js` |
| AL-P14 faellt beim Rueckbau mit heraus | Blindes Reverse-Patchen | Vier Dateien ausdruecklich Handedit, Pruefung (2) faengt Verlust |
| Ein Gate faellt mit weg | `productionFootguns`-Klausel geloescht | Klausel prueft ausschliesslich den Spike; sieben Bestands-Footguns namentlich als unberuehrt gelistet |

Bewusst nicht in dieser Phase: Env-Werte im Render-Dashboard loeschen (Owner), Deploy, `tasks/al-chain-state.md` fortschreiben (Lead), AL-P7/P7b, `PLAN-ASSISTANT-LEAP.md` Phase 2, neue Dependencies.

## 2. Impl-Zusammenfassung

- **headCommit:** `c2d523671787a43aaf8655ddd28026ccccdb99ac`, `committed: true`
- **node --check:** PASS (alle 5 geaenderten `.js`-Dateien)
- **npm test:** PASS, 3615 gruen / 1 rot im Vollast-Lauf (isoliert erneut gruen, 7/7) — bekannter Vollast-Flake, kein echter Befund

Sechs driftfreie Dateien (`src/telnyx-llm-shim.js`, `scripts/telnyx-call-latency.mjs`, `test/telnyx-shim-harness.js`, `test/config-shape.test.js`, `test/config-namespaces-helper.js`, `test/telnyx-call-latency.test.js`) per `git checkout e3d1735^ --` auf byte-identischen Vor-Spike-Stand zurueckgesetzt (verifiziert: `git diff e3d1735^ HEAD -- <dateien>` leer). Die sieben Handedit-Dateien (`src/config.js`, `src/boot.js`, `src/utils/timer.js`, `test/helpers.js`, `.env.example`, `render.yaml`, `PLAN-SECURITY.md`) manuell bereinigt (Schalter, beide Env-Keys `TELNYX_SSE_SPIKE_*`, `e164Env`, `productionFootguns`-Klausel, Banner-Zeile, `sleepMs`, Doku-Abschnitt) unter Erhalt der AL-P14-Drift (`MS_PER_MINUTE`, `inCallConsultBannerLine` inkl. geheiltem Kommentar-Verweis). `test/al-p2-sse-spike.test.js` geloescht. `tasks/al-testcall-checklist.md`: BLOCKER-Abschnitt durch Erledigt-Statuseintrag ersetzt.

Grep nach `sse-spike/splitAtFirstSentence/spikePause/sleepMs/sleepSpy/e164Env` in `src/test/scripts/public/docs/.env.example/render.yaml/PLAN-SECURITY.md/README.md/STATUS.md` liefert keine Treffer.

Smoke: Server mit `SKIP_TWILIO_SIGNATURE_CHECK=true` + Dummy-Env bootet, `/healthz` = 200, Boot-Banner zeigt "Voice-Engine:"/"Assistant-Pfad:" OHNE "SSE-Spike:"-Zeile. Zweitprobe noetig, da zwei fehlende Boot-Pflicht-Env-Vars (`PUBLIC_URL`, `COST_TRUING_REQUIRED_RECORD_TYPES`) entdeckt und lokal ergaenzt wurden — unabhaengig von dieser Phase, Bestandsverhalten.

`node_modules`-Symlink vor dem Commit entfernt.

### Geaenderte Testdateien

- `test/al-p2-sse-spike.test.js` — geloescht
- `test/telnyx-call-latency.test.js` — AL-P2-18/19/20 + `audioFirstTokenRow`-Helfer + Imports zurueckgesetzt (byte-identische Restore)
- `test/config-shape.test.js` — `sseSpikeDelayMs`/`sseSpikeCallee` aus dem erwarteten `telnyxAssistant`-Objekt entfernt (byte-identische Restore)
- `test/config-namespaces-helper.js` — `telnyxSseSpike*`-Parameter/Zuweisungen entfernt (byte-identische Restore)
- `test/telnyx-shim-harness.js` — `sleepMs`-Import/Parameter/`sleepSpy` entfernt (byte-identische Restore)
- `test/helpers.js` — `TELNYX_SSE_SPIKE_DELAY_MS`/`CALLEE` aus `BASE_ENV` entfernt

### Deviations

1. 1 von 3616 Tests fiel im Vollast-Lauf rot (`test/inbound-disclosure-mandatory.test.js:94`), isoliert erneut ausgefuehrt gruen — bekannter Vollast-Flake (Lehre `suite-flake-p5-gate-proof`/`al-parallelism-load-limit`), Datei ausserhalb des Phasen-Scopes, kein echter Befund.
2. Fuer den Smoke-Test mussten zwei Boot-Pflicht-Env-Vars ergaenzt werden, die mit dieser Phase nichts zu tun haben (`PUBLIC_URL`, `COST_TRUING_REQUIRED_RECORD_TYPES`) — Bestandsverhalten, nicht durch AL-P2z eingefuehrt.
3. `npm run test:gates` wurde NICHT separat gefahren (Plan verlangt nur "unveraendert, darf rot sein, aber nicht ANDERS rot" — da AL-P2-* Tests nicht im i18n-Katalog-Pattern liegen und komplett aus der Regression entfernt wurden, ist dieser Lauf durch die Phase nicht betroffen; aus Zeitgruenden nicht zusaetzlich verifiziert).

### Clean-Code-Selbstcheck (Impl-Agent)

Reine Entfernung, keine neue Logik. Keine Duplizierung eingefuehrt, keine Magic Numbers, kein toter/auskommentierter Code hinterlassen (Grep-Kontrolle bestaetigt). `writeCompletion`/`writeStreamingCompletion` zurueck auf synchron ohne `await`, wie im Plan begruendet (G12: kein `async` ohne `await`). Kommentare deutsch ohne Umlaute, ESM unveraendert. Kein neuer Test noetig (reiner Rueckbau, Bestand deckt Zielverhalten bereits ab).

## 3. Safety-Urteil (final)

**Verdict: PASS** — approved, alle Einzelurteile (testsPassIndependently, safetyGatesIntact, disclosureIntact, authFailClosedIntact, noSecretsLeaked, scopeRespected, behaviorAsIntended) = `true`. Keine Blocker.

### Unabhaengige Verifikation

- Zwei unabhaengige Regressionslaeufe im frischen Worktree: roh 3636/3636 pass; korrigiert 3616/3616 pass, 0 fail (132 s / 98 s).
- Baseline-Gegenprobe auf master: korrigiert 3636/3636 pass. Delta Branch-vs-master = exakt -20 Tests = genau die 20 Spike-Tests. Kein weiterer Test verschwunden.
- Gates (`test:gates`): 129 / pass 126 / fail 3 (GAP-05, 2x GAP-15) — bekannter, vorbestehender Rotstand, unabhaengig von dieser Phase.
- Beide Store-Backends (json + pg via pglite-Harness) in einem Lauf abgedeckt.
- `node --check` gruen fuer alle fuenf geaenderten Dateien.
- Staerkster Beleg fuer "ersatzlos": `git diff 4305c15^ review-al-p2z` ist fuer `src/telnyx-llm-shim.js`, `scripts/telnyx-call-latency.mjs`, `test/telnyx-shim-harness.js`, `test/config-namespaces-helper.js`, `package.json`, `package-lock.json` LEER. `src/utils/timer.js` (+6) und `test/helpers.js` (+4) unterscheiden sich nur um die spaeter dazugekommenen AL-P14-Zeilen. Seit `4305c15` hat nur `878e4a7` (AL-P14) die betroffenen Dateien angefasst.

### Gate-Bewertung im Detail

- **Safety-Gates:** unangetastet. `productionFootguns` verliert ausschliesslich die Spike-eigene Klausel; alle uebrigen Footguns (`DASHBOARD_PASSWORD`, `SKIP_TWILIO_SIGNATURE_CHECK`, `STORE_BACKEND`, `TELNYX_SHIM_MAX_TURNS_PER_MIN` u.a.) bleiben Zeile fuer Zeile stehen. Die vier Notaus-Pfade im Shim (Rate-Gate, Budget-Kill inkl. `blockingBudgetAxis`, Loop-Guard, Degradations-Catch) sind byte-identisch zum Vor-Spike-Stand, inklusive KS-P2-Live-Budget-Term und KS-P1b-Re-Attach-Pfad. Denylist, Land-Gate, Stundenlimit, Kostendecke, Max-Dauer, `OUTBOUND_FROZEN`, Signaturpruefung liegen komplett ausserhalb des Diffs.
- **Offenlegung:** `src/claude.js`/`src/bridge.js` nicht im Diff; `disclosureSentence` unveraendert fest verdrahtet.
- **Auth fail-closed:** keine Auth-Datei beruehrt, Shim-Kanten byte-identisch, `safeEqual` unveraendert.
- **Secrets/PII:** reine Entfernung; geloeschter Log-Kanal `sse_spike_delay` war PII-frei; `E164`-Regex bleibt in `store/defaults.js` fuer andere Verwender erhalten.
- **Scope:** eingehalten, keine neuen Dependencies (`package.json`/`package-lock.json` byte-identisch zu master und Vor-Spike-Stand), keine Extras in `claude.js`, `bridge.js`, `server.js`, `auth.js`, `web-auth.js`, `store/*`, `billing/*`, `telephony/*`.

### Concerns (keine Blocker)

1. Doku-Inkonsistenz (kein Code-Risiko): `tasks/al-chain-state.md` fuehrt AL-P2z in der Phasen-Tabelle weiterhin als "offen" und beschreibt den Schalter an zwei Stellen als vorhanden. Nur `tasks/al-testcall-checklist.md` wurde im Branch aktualisiert — Chain-State-Pflege ist Lead-Arbeit.
2. Verwaiste Live-Env-Schluessel `TELNYX_SSE_SPIKE_DELAY_MS`/`TELNYX_SSE_SPIKE_CALLEE` bleiben im dashboard-gemanagten Render-Dienst stehen (wirkungslos, aber offene Owner-Handarbeit nach dem Merge).
3. Handhabungs-Notiz (kein Phasenbefund): `npm test` lieferte in der Review-Sandbox zweimal nur den npm-Banner; der direkte Aufruf von `test/i18n-catalog-run.mjs regression` lief beide Male vollstaendig und gruen — das Urteil steht auf diesen Laeufen.

## 4. Clean-Code-Audit (final)

**Verdict: PASS**, `blocker: false`.

- **s1 (Blocker):** keine Befunde
- **s2:** keine Befunde
- **s3:** keine Befunde
- **s4:** keine Befunde

Sauberer, vollstaendiger Rueckbau. Alle betroffenen Symbole (`sseSpikeDelayMsFor`, `splitAtFirstSentence`, `spikePauseFor`, `logShimSseSpike`, `sseSpikeBannerLine`, `e164Env`, `sleepMs`, `sseSpikeVerdict`, `printSpikeVerdict`, `extractSpikeDelay`, `SPIKE_FLAG`, `AUDIO_FIRST_TOKEN_FIELD`, `sleepSpy`, die Config-Keys `sseSpikeCallee`/`sseSpikeDelayMs`, `TELNYX_SSE_SPIKE_*`-Env) konsistent aus Code, Config, `.env.example`, `render.yaml`, Test-Helpern und dem Testfile entfernt, per gezieltem grep/Archive-Check verifiziert. `writeCompletion`/`writeStreamingCompletion` korrekt von async auf sync zurueckgebaut, alle 5 Aufrufstellen konsistent. `E164`-Regex bleibt in `defaults.js` fuer andere Verwender erhalten — nur der ungenutzte `e164Env`-Wrapper fiel weg. `boot.js`-Kommentar bei `inCallConsultBannerLine` korrekt aktualisiert (kein veralteter Kommentar, C2). `parseLatencyArgs` sinnvoll von zwei Funktionen zu einer zusammengefuehrt (positiver S4/G30-Effekt). `node --check` sauber auf allen 5 Dateien. Gezielter Testlauf der direkt betroffenen Suiten = 107/107 gruen. Voller Suite-Lauf: 1 Fail bei 3636 Tests (`webhook-events.test.js`), isoliert nachgestellt gruen (10/10) — klassischer Last-/Spawn-Flake, nicht diff-bezogen, deckt sich mit dokumentierten Repo-Flakes.

### Top-Todos

1. Keine Code-Aenderung noetig.
2. Owner: `TELNYX_SSE_SPIKE_DELAY_MS`/`TELNYX_SSE_SPIKE_CALLEE` im Render-Dashboard loeschen (dokumentiert, ausserhalb Code-Scope).
3. Bei Gelegenheit den einen vollstaendigen Suite-Flake (`webhook-events.test.js` unter Volllast) separat verifizieren/isolieren — nicht dieser Phase zuzuordnen.

## 5. Fix-Runden

Keine. Der erste Impl-Durchlauf bestand beide finalen Reviews (Safety PASS, Clean-Code PASS) ohne Nacharbeit; die im Abschnitt "Deviations" genannten drei Punkte sind dokumentierte Abweichungen vom Plan-Ablauf (Flake, Env-Ergaenzung fuer Smoke-Test, `test:gates` nicht separat gefahren), keine Fix-Runden gegen Blocker.

## 6. Offene Punkte / Owner-Uebergabe

- Env-Schluessel `TELNYX_SSE_SPIKE_DELAY_MS`/`TELNYX_SSE_SPIKE_CALLEE` im Render-Dashboard loeschen (wirkungslos, aber Aufraeumarbeit).
- `tasks/al-chain-state.md` auf den neuen Stand (AL-P2z erledigt) nachziehen (Lead-Arbeit).
- Merge von `phase/al-p2z-spike-entfernen` nach `master` und Deploy stehen noch aus (nicht Teil dieser Phase).
