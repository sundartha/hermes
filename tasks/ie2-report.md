# Phase IE2 — Die Geld-Achse bekommt einen Herzschlag

- **Gate:** PASS
- **finalBranch:** `phase/ie2-geld-herzschlag`
- **headCommit:** `68767c53fa26ed0c38f6788a10c9adbcfa62f5ab`

## Plan (gekuerzt)

Ziel: die pro-Tenant-Kostendecke wird um eine fuenfte, **zeitgesteuerte** Fragestelle ergaenzt. Heute wird `blockingBudgetAxis` nur ereignisgebunden gefragt (Turn-Runde `claude.js#agentTurn`, `telnyx-llm-shim.js`, `routes/webhooks-elevenlabs.js`, `telephony/call-lifecycle.js#reattachActiveCall`) — ein Anruf ohne Turn und ohne Werkzeugaufruf erreicht die Decke nie (Befund B8).

Leitentscheidungen:
- **E-1**: neues, reines Modul `src/telephony/budget-watchdog.js` (Zustand + Takt, alles IO injiziert, Vorbild `telnyx-conversation-watchdog.js`, keine Wiederverwendung).
- **E-2**: Armierung sitzt in `armMaxDurationTimer` (einer Naht), nicht an vier Startpfaden — G27, Struktur statt Konvention.
- **E-3**: zweite Armierungsstelle beim erfolgreichen `reattachActiveCall` (pg-Spiegel-Luecke).
- **E-4**: dritte Stelle `rearmBudgetWatchdogs()` im Boot, bewusst NICHT am Realtime-Sonderfall von `rearmActiveCallTimers` haengend.
- **E-5**: kein `clear()` — der Takt endet, wenn der Anruf nicht mehr `active` ist.
- **E-6**: eine Logquelle, zwei Anlaesse (`BUDGET_TERMINATION_ORIGIN.REATTACH`/`WATCHDOG`), `reattach.js` bleibt byte-identisch.
- **E-7**: kein zweiter Terminierungsweg — ausschliesslich `terminateOverBudgetCall -> terminateActiveCall -> terminateAndBillCall`.
- **E-8**: Intervall-Default 15000 ms, min 0 (= AUS, Rueckfall-Hebel), max 600000; bewusst akzeptierte Ueberziehung ≤ ein Takt je Leg (~7,5 ct bei 30 ct/min), nicht kumulativ.
- **E-9**: Fehlerpfad haelt die Wache am Leben (Retry statt stillem Sterben).

NICHT gemacht: keine neue Achse/kein Zaehler, keine Tarif-/Decken-/Totband-Aenderung, keine Inbound-Lockerung, kein Anfassen von `bridge.js`/`REALTIME_MID_CALL_BUDGET_CHECK`, kein neuer Endpunkt, keine neue Dependency.

Edits (Plan-Umfang): `src/config.js` (neuer Wert `budgetWatchdogIntervalMs` im `safety`-Namespace), `src/telephony/call-lifecycle.js` (Import, Konstanten `BUDGET_TERMINATION_ORIGIN`/`ACTIVE_CALL_STATUS`, Wächter-Verdrahtung, `armMaxDurationTimer`, `reattachActiveCall` als async, `rearmActiveCallTimers`-Filter, neue `rearmBudgetWatchdogs()`), `src/boot.js` (ein Aufruf nach `lifecycle.rearmActiveCallTimers()`), `.env.example` + `render.yaml` (neue Env-Var dokumentiert). Tests: neue Datei `test/ie2-geld-wache.test.js` (8 Faelle IE2-1..IE2-8), Anpassungen an `test/config-namespaces.test.js`, `test/helpers.js` (BASE_ENV), `test/env-docs-spend-cap-coherence.test.js` (Doku-Kohaerenz-Riegel). Doku-Ergaenzung in `PLAN-SECURITY.md`.

## Impl-Zusammenfassung

- headCommit `68767c5`, `node --check` sauber auf allen vier geaenderten Kern-Dateien, `npm test` gruen: **5999 pass / 0 fail**.
- Smoke am echten Serverprozess (zwei Läufe): Kontrollfall (Achse frei) bleibt stumm, Anruf bleibt `active`; Sperrfall (Achse sperrt erst mid-call) erzeugt genau eine Zeile `[budget] wache: Guthaben erschoepft (call=call_xxx) -> terminalisiert` (kein PII), Anruf danach `status=completed`, `failureReason=budget-exhausted`, keine zweite Zeile.
- Neue Dateien: `src/telephony/budget-watchdog.js`, `test/ie2-geld-wache.test.js`.
- Geaenderte Dateien: `src/telephony/call-lifecycle.js`, `src/config.js`, `src/boot.js`, `.env.example`, `render.yaml`, `PLAN-SECURITY.md`, `test/config-namespaces.test.js`, `test/helpers.js`, `test/env-docs-spend-cap-coherence.test.js`, `eslint-suppressions.json`.

### Deviations vom Plan

1. **Plan-Luecke (Pflicht, sonst rot):** `test/config-namespaces.test.js` brauchte neben `safety`-Zaehler und `EXPECTED_TOTAL_KEYS` auch `EXPECTED_PRIMITIVE_LEAVES` (180 -> 181) — der Plan hatte nur die ersten beiden Zahlen genannt.
2. **Ungeplantes Pflicht-Aufraeumen:** der pre-commit-Hook (`scripts/check-staged-suppressions.js`) lehnte die Feature-Aenderung an `call-lifecycle.js` ab, weil sich dortige Lint-Befunde (`max-lines-per-function`, `id-length`) durch die Plan-Additionen bewegt hatten und Altlast-Eintraege einem Bau-Agenten verboten sind. Die Geld-Achse (Praedikat + Vollzug + Takt + Boot-Re-Arm) wurde deshalb als eigene Einheit `makeBudgetAxisSeam` neben den Fabrikrumpf gezogen; `makeCallLifecycle` sank von ~140 auf 97 gezaehlte Zeilen, die Datei lintet mit 0 Befunden, ihr Suppressions-Eintrag entfiel per `eslint --prune-suppressions`. Reine Verschiebung, keine Verhaltensaenderung; alle vier Quelltext-Riegel bleiben gruen.
3. **Struktur-Abweichung als Folge:** `rearmBudgetWatchdogs` lebt als `rearmWatchdogs` in `makeBudgetAxisSeam` und wird im Return-Objekt unveraendert als `rearmBudgetWatchdogs` durchgereicht; `boot.js` ruft weiterhin unveraendert `lifecycle.rearmBudgetWatchdogs()` auf.
4. **Test-Technik:** der (nicht-injizierbare) Max-Dauer-Cap-Timer laeuft real bis zu 180 s — `node --test` wartet das nachweislich ab. `test/ie2-geld-wache.test.js` faengt deshalb die globale Uhr fuer die Dauer eines Testkoerpers ein (try/finally) und trennt Cap-Timer in eine zweite Liste.
5. **Test-Umbau wegen Lint:** Call-Datensatz und Spy-Store entstehen gemeinsam in `makeHarness` (kein Property-Assign an Parameter), `RECENTLY_STARTED_MS = 30000` statt `30 * 1000` (no-magic-numbers) — reine Testform.
6. `npm run test:gates` bleibt mit 3 Bestandsbefunden rot (GAP-05, GAP-15, E2E-03) — beruehren weder Budget noch Lifecycle, laut CLAUDE.md zulaessig rot, nicht durch IE2 verursacht.
7. Der vorgegebene Symlink-Befehl `ln -s "./node_modules" node_modules` war selbstbezueglich (ELOOP) und wurde auf den echten Pfad korrigiert — sonst liefen Lint-Läufe still mit Exit 194 durch.

## Safety-Urteil

**approved: true — PASS, Freigabe zum Merge.**

Alle geprueften Kriterien erfuellt: `testsPassIndependently`, `safetyGatesIntact`, `disclosureIntact`, `authFailClosedIntact`, `noSecretsLeaked`, `scopeRespected`, `behaviorAsIntended` — alle `true`, keine Blocker.

Unabhaengige Verifikation: frischer Worktree/Branch `review-ie2` auf `phase/ie2-geld-herzschlag`; eigener Regressionslauf 5999 pass/0 fail; Gegenprobe auf `master` (c44367c) 5990 pass — Delta exakt +9 (8 neue IE2-Faelle + 1 Doku-Kohaerenz-Test), nichts verloren oder in eine andere Bank abgewandert. `npm run lint`: 0 errors/68 warnings. Eigener End-to-End-Beweis am echten Serverprozess (geseedetes aktives Leg, kein HTTP): Sperrfall terminalisiert mit genau zwei PII-freien Zeilen, Takt=0 erzeugt keine Zeile/keinen Effekt (Rueckfall-Hebel bestandsidentisch belegt), Achse frei über ~8 Runden in 4 s erzeugt keinen Log-Spam.

Gepruefte Wirkungsrichtung: strenger, nie lockerer — keine zweite Geld-Achse, kein zweiter Terminierungspfad, `disclosureSentence`/`claude.js`/`bridge.js` unberuehrt (0 Diff-Zeilen), keine neue Route, keine neue Dependency.

Benannte, nicht-blockierende Concerns:
- One-shot-Armierung: `armed`-Eintrag faellt vor `await terminate(call)` — scheitert der Provider-Hangup, folgt fuer dieses Leg keine weitere Runde (kein neues Risiko, gleiches Muster wie der Max-Dauer-Cap).
- `onTickFailure` ohne Obergrenze/Backoff — bei dauerhaftem Fehler eine Log-Zeile pro Takt (richtige Fehlrichtung, Preis ist Log-Volumen).
- Abdeckung bewusst unvollstaendig: der Realtime-Zweig von `POST /api/calls` bleibt ungedeckt (vorbestehend, in `PLAN-SECURITY.md` als Restrisiko 2 festgehalten, Wegfall laut Plan in IE6).
- Kosten je Takt: O(n) ueber alle Legs alle 15 s — spaeter zu messen, nicht jetzt zu bauen.
- Kommentar an `armMaxDurationTimer` ("Funktionsname ist historisch") bleibt bewusst stehen — Lesbarkeits-Schuld, keine Sicherheitsfrage.

## Clean-Code-Audit (S1-S4)

- **S1:** keine Befunde.
- **S2:** keine Befunde.
- **S3** (2 Befunde, kein Blocker):
  1. `src/telephony/call-lifecycle.js`, Return-Block von `makeCallLifecycle`: bestehende Export-Zeilen wurden drive-by von "eine pro Zeile" auf mehrere Namen pro Zeile umformatiert, ohne fachlichen Grund.
  2. `src/telephony/call-lifecycle.js`, catch-Block `terminateCappedCall`: Variable `e` -> `err` umbenannt, reine Kosmetik im Feature-Diff.
- **S4:** keine eigenstaendigen Befunde (die zwei S3-Punkte sind gemeinsam als S3/S4 gelistet).
- **blocker:** false
- **verdict:** PASS. `budget-watchdog.js` sauber pure (Zustand+Timer, IO injiziert), idempotent, fail-open-sicher gegen werfende Achse, one-shot vor Terminierung, 8 gezielte Tests gegen die echte Verdrahtung. Env-Var korrekt dreifach synchronisiert und per Kohaerenz-Test gepinnt. `CONFIG_NAMESPACES`-Zaehler korrekt nachgezogen. `eslint-suppressions.json` sauber entfernt statt neu ergaenzt. Alle betroffenen Tests gruen, `node --check` sauber, `PLAN-SECURITY.md` vollstaendig und ehrlich nachgezogen.
- **topTodos:** kein Blocker offen, Phase mergefaehig. Optional: die zwei kosmetischen Drive-by-Aenderungen bei Gelegenheit in einen separaten Formatting-Commit trennen.

## Fix-Runden

Keine — keine Fix-Runde war noetig, Gate erreichte PASS direkt.
