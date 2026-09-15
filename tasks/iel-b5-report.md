# Phase IEL-B5: Status-Callback und Beenden fuer ueberbrueckte Inbound-Beine

**Gate: PASS**
**finalBranch:** `phase/iel-b5-status-beenden`
**headCommit:** `2fa15f0`
**Basis:** `phase/iel-b4-nachlauf-politik` @ `d21889d`

---

## 1. Ziel der Phase

IEL-B5 schliesst die drei Terminierungsnaehte eines ueberbrueckten (GEBUNDEN) Inbound-EL-Beins an den in IEL-B4 gebauten Nachlauf-Mechanismus an:

- `/voice/status` (Provider-Status-Callback)
- der Max-Dauer-Cap und die Geld-Wache (`terminateActiveCall`)
- `cancel_call` (MCP-Tool / `POST /api/calls/:id/cancel`)

Kernidee: fuer ein GEBUNDEN-Bein wird nie mehr direkt abgeschlossen (`finishCall`) und nie per `DELETE` beim Provider beendet. Stattdessen legt jeder dieser drei Wege zuerst das Traegerbein auf, holt dann begrenzt das Ergebnis vom Provider (Transkript/Zusammenfassung) und persistiert es, bevor gebucht wird. Das Carrier-Ende (`carrierEndMsOf`, aus B4a) wird zum Ende-Anker statt "jetzt".

---

## 2. Plan (gekuerzt)

### Befunde vor dem Bau
- Zwei Bestandstests (`telnyx-p6-cap-callcontrol` T6/T7) pinnen den heutigen Wortlaut des `hangUp`-Ausdrucks in `terminateActiveCall` und im Cancel-Block via Zeichen-Fenster/Regex — die neue Logik musste sich als `hangUp: hangUpForCall({...})` einfuegen, ohne diese Literale zu verschieben.
- Der Fake-Store in `test/el-beende-versuch.test.js` kennt nur `getCall`/`endCallRecord`; der Cancel-Pfad fuer Nicht-Inbound-EL-Calls muss weiter `endCallRecord` rufen → Wiederverwendung von `outbound.js#endeSchreiberFuer` (aus B4).
- Zeilenbudgets waren knapp (`makeCallLifecycle` 91/100, `makeElevenLabsOutbound` 94/100); die Ergebnis-Warte-Logik musste auf Modulebene in `outbound.js` stehen, die Fabrik bekommt nur eine Rueckgabezeile.
- `eslint-legacy-exceptions.json` und `test/check-staged-suppressions.test.js` brauchten gemessene Pin-Erhoehungen fuer `voice.js` (Komplexitaet 12→13, `makeVoiceRoutes` 227→~229 Zeilen) und `api-calls.js` (`makeCallRoutes` 221→~225 Zeilen).

### Geplante Abweichungen von der Spec-Dateiliste (A1-A7)
- **A1** `outbound.js`: neue Modul-Funktion `awaitAndPersistInboundElResult`, Konstante `EL_TERMINATION_RESULT_ATTEMPTS`, Export von `endeSchreiberFuer`, Log-Zeile `[el-inbound] nachlauf gestartet` (Runbook 11), Helfer `anbieterErgebnisFertig` (G5-Dedup).
- **A2** `app.js`: Verdrahtung von `startInboundNachlauf` und `awaitAndPersistInboundElResult`.
- **A3** `src/utils/timer.js`: geteilter `sleep(ms)`-Helfer; bestehende lokale `sleep`-Kopien bleiben unangetastet.
- **A4** Lint-Pins nachziehen, gemessen statt geschaetzt.
- **A5** Gemeinsamer Test-Harness `test/_iel-inbound-harness.js`, reine Verschiebung aus `test/iel-b4-nachlauf.test.js` (vermeidet ~100 duplizierte Zeilen).
- **A6** `EL_TERMINATION_RESULT_ATTEMPTS = 3` — Startwert, nicht gemessen.
- **A7** Riegel in `elevenLabsHangUpAction`: liefert `null` fuer jeden Call mit EL-Inbound-Profil (nie DELETE, E7b) — wirkt nur im heute unerreichbaren Fall ohne Traeger-Handle.

### Kernaenderungen laut Plan
- **`call-termination.js`**: neue Funktion `hangUpForCall({call, hangUp, awaitAndPersistInboundElResult})` — die EINE Auswahl des Beende-Thunks fuer `terminateActiveCall` UND `cancel_call`. Bei `bridgeStateOf(call) === GEBUNDEN` liefert sie `bridgedInboundHangUp` (Traeger auflegen im `finally`-sicheren Ablauf, dann Ergebnis holen); sonst wird `hangUp` unveraendert durchgereicht. `elevenLabsHangUpAction` liefert neu `null` fuer jeden Inbound-EL-Zustand.
- **`call-lifecycle.js`**: `terminateActiveCall` verwendet `carrierEndMsOf(call, Date.now())` statt `Date.now()` als Ende-Anker und ruft `hangUpForCall(...)` fuer den `hangUp`-Wert.
- **`routes/voice.js`**: `/voice/status` gibt bei `bridgeStateOf(call) === GEBUNDEN` sofort nach dem Terminal-Filter zurueck (`startInboundNachlauf(call.id)`), ohne auf den bestehenden Abschluss-Code darunter durchzufallen.
- **`routes/api-calls.js`**: Cancel-Route nutzt `endeSchreiberFuer` fuer `persistEnd` und `hangUpForCall` fuer `hangUp`.
- **`elevenlabs/outbound.js`**: `startInboundNachlauf` loggt neu die Runbook-11-Zeile; neue Modul-Funktion `awaitAndPersistInboundElResult` (max. 3 Versuche, Pause = `resultPollMs`, fail-soft); `anbieterErgebnisFertig` dedupliziert die "Provider-Ergebnis fertig"-Bedingung.
- **`server.js`/`app.js`**: Verdrahtung der neuen DI-Kante `awaitAndPersistInboundElResult` an Lifecycle- und Cancel-Route, sowie `elevenLabsOutbound` an `makeVoiceRoutes` fuer `startInboundNachlauf`.

### Geplante Tests (`test/iel-b5-status-ende.test.js`)
22 Faelle IEL-B5-1 bis -20 plus 5P/11P (Positiv-Kontrollen), u.a.:
- Reinheit/Referenzgleichheit von `hangUpForCall` fuer Nicht-GEBUNDEN-Zustaende
- Reihenfolge Traeger-Hangup vor Ergebnisabruf, auch bei Fehler im Traeger-Hangup (`finally`)
- `elevenLabsHangUpAction` liefert `null` fuer Inbound-EL
- Status→Poll, Status→Status (keine Doppel-Schleife), Poll→Status, Re-Arm-Poll→Status
- Negativ-Tabelle: WARTET/RUECKFALL/Outbound-EL loesen den Nachlauf nicht aus
- Cap→Status, Cap waehrend Nachlauf, Geld-Wache→Poll
- `cancel_call` fuer GEBUNDEN (mit/ohne Marker), WARTET, Budget-Inbound (Store-Aufrufreihenfolge unveraendert)
- vier Kindprozess-Tests (echter Server) fuer Neustart waehrend GEBUNDEN/RUECKFALL sowie die tatsaechliche Verdrahtung in `server.js` (Cap) und `app.js` (Cancel)

### Pre-Mortem (Auszug)
Doppelbuchung/Doppel-Schreiben nach Purge → durch `billedAt`-Riegel und synchronen `persistEnd` vor dem Thunk entschaerft. Verlorene Verdrahtung → kein `?.` auf dem Ergebnis-Callback, Spawn-Tests pinnen `server.js`/`app.js`. DELETE loescht Beleg beim Provider → A7-Riegel. Ueberbuchung im Nachlauf → E17-Anker. Langsamer Provider nach Auflegen → als Startwert akzeptiert (A6). `cancel_call` bis zu ~40s Antwortzeit → akzeptiert, Leitung ist da schon aufgelegt.

---

## 3. Implementierung — Zusammenfassung

Wie geplant umgesetzt auf `phase/iel-b5-status-beenden`, committed als `2fa15f0`.

- `/voice/status`: GEBUNDEN-Calls werden dort nicht mehr abgeschlossen, nur `startInboundNachlauf` gerufen (Marker einmalig, eine Log-Zeile, hoechstens eine Poll-Schleife).
- `hangUpForCall` in `call-termination.js`: EINE Auswahl des Beende-Thunks fuer Cap, Geld-Wache und `cancel_call`.
- `elevenLabsHangUpAction` liefert jetzt fuer jeden Inbound-EL-Call `null` (Guard A7).
- Ende-Zeit ist jetzt `carrierEndMsOf` in `terminateActiveCall` und `cancel_call`; Cancel nutzt den exportierten `endeSchreiberFuer`.
- `outbound.js`: neu `awaitAndPersistInboundElResult` mit `EL_TERMINATION_RESULT_ATTEMPTS = 3` (Startwert, nicht gemessen); neuer Helfer `anbieterErgebnisFertig`.
- `utils/timer.js`: neuer `sleep`-Helfer.
- Verdrahtung in `server.js` (Lifecycle) und `app.js` (Cancel-Route und Voice-Route).
- Lint-Pins gemessen nachgezogen: `voice.js` 227→229 Zeilen, Komplexitaet 12→13; `api-calls.js` 221→224 Zeilen. `LEGACY_FINGERPRINT` und Aenderungsprotokoll aktualisiert.

**Tests:** neuer Harness `test/_iel-inbound-harness.js` (aus B4-Test verschoben, B4-Test weiterhin 19/19 gruen); `test/iel-b5-status-ende.test.js` mit 22 Faellen inkl. vier echten Kindprozess-Tests fuer die `server.js`/`app.js`-Verdrahtung. Sabotage-Checks (GEBUNDEN-Zweig entfernt, `hangUpForCall` durchgereicht, A7-Guard entfernt, Verdrahtung entfernt) faerbten jeweils die passenden Tests rot, danach rueckgaengig gemacht.

**Ergebnisse:** `node --check` sauber fuer alle 8 geaenderten Dateien; Ziel-Testdateien 183/183 gruen; `npm run lint` Exit 0; `npm test -- --test-concurrency=4` Exit 0, 5652 pass / 0 fail. Alle Greps aus §4 des Plans lieferten die erwarteten Treffer. `PLAN-SECURITY.md` unveraendert (plangemaess).

### Deviations gegenueber Plan
1. **Tests B5-10/-13**: geplante Pruefung "Zusammenfassung sah FIXTURE_ZEILEN Rollen" ersetzt durch Transkriptlaenge zum Zeitpunkt `markBilled` (`transkriptBeiBuchung`), weil ein als `failed`/`cancelled` beendeter Call `finishCall` frueh verlaesst und `summarizeCall` nie laeuft — der Ersatz belegt direkter, dass das Ergebnis vor der Buchung gesichert wurde.
2. `FIXTURE_ZEILEN` zusaetzlich in den Harness verschoben (reine Verschiebung, ueber den Plan hinaus, keine Duplizierung in B4/B5-Tests).
3. Test B5-12: Call ohne vorgesetzten Marker geseedet (nicht wie im Plan beschrieben mit vorgesetztem Marker) — der Status-POST setzt den Marker und startet die Schleife selbst; ein vorgesetzter Marker haette den Schleifenstart verhindert.
4. Test B5-16: Store-Aufrufreihenfolge per Wrapper auf `endCallRecord`/`setCallEndedAt`/`markBilled` auf der gemeinsamen Harness-Store-Instanz aufgezeichnet.
5. `EL_TERMINATION_RESULT_ATTEMPTS = 3` bestaetigt als Startwert, nicht gemessen (A6, wie geplant).

### Dateien
**Neu:** `test/_iel-inbound-harness.js`, `test/iel-b5-status-ende.test.js`
**Geaendert:** `src/telephony/call-termination.js`, `src/telephony/call-lifecycle.js`, `src/routes/voice.js`, `src/routes/api-calls.js`, `src/elevenlabs/outbound.js`, `src/utils/timer.js`, `src/server.js`, `src/app.js`, `eslint-legacy-exceptions.json`, `test/check-staged-suppressions.test.js`, `test/iel-b4-nachlauf.test.js`

### Smoke-Test
Manueller `curl`-Smoke-Test lief nicht durch: Server-Start mit leerem Store wurde vom Boot-Guard abgewiesen ("Keine aktive Nummer im Store"). Stattdessen decken die vier Kindprozess-Tests (B5-17 bis -20) dieselben Routen gegen einen echten, mit einem Datensatz geseedeten Server ab (`POST /voice/status`, `POST /api/calls/:id/cancel`, Fake-Provider ueber HTTP, `FAKE_ORIGINATE`, Signatur-Skip) — alle vier gruen, keine Testserver zurueckgelassen.

---

## 4. Safety-Urteil

**APPROVED.** `testsPassIndependently: true`, `safetyGatesIntact: true`, `disclosureIntact: true`, `authFailClosedIntact: true`, `noSecretsLeaked: true`, `scopeRespected: true`, `behaviorAsIntended: true`, keine Blocker.

Unabhaengiger Testlauf (frischer Worktree, review-iel-b5 aus 2fa15f0 auf Basis d21889d): `node --check` fuer alle 8 Dateien OK; B5-relevante Tests (88 Faelle) exit 0; beruehrte Terminierungsnaehte (115 Faelle, u.a. `call-termination-order`, `el-beende-versuch`, `telnyx-p6-cap-callcontrol`, `ie2-geld-wache`, `reattach-active-call`, `route-auth-inventory`) exit 0; Struktur-/Quelltext-Tests plus `security.test.js` (264 Faelle) exit 0; `npx eslint` auf geaenderte Dateien exit 0. Diff-Pruefung: keine Aenderung an `claude.js`, `route-policy.js`, `config.js`, `package.json` oder `/voice/incoming`; keine neuen Endpunkte; zwei neue Log-Zeilen, nur mit `callId`.

**Verdict-Begruendung:** `/voice/status` startet fuer GEBUNDEN nur `startInboundNachlauf`, ohne Rueckfall auf den heutigen Abschluss. `terminateActiveCall` setzt das Ende auf `cappedEndedAtMs(call, carrierEndMsOf(call, now), CAP)` und nutzt `hangUpForCall`. `cancel_call` nutzt dieselbe Auswahl, Ende ueber `endeSchreiberFuer` mit Carrier-Ende als Anker. Mit Schalter aus (kein Code setzt heute `TELNYX_INBOUND_EL_CONVAI`) liefert `bridgeStateOf` fuer jeden Call `KEIN_EL_INBOUND` — Status-Pfad, `carrierEndMsOf`, `hangUpForCall`-Durchreichung und Cancel-Antwortform bleiben byte-identisch fuer Budget-Inbound und Outbound-EL (belegt durch B5-5P, -9, -11P, -16 und Bestandstests). Safety-Gates halten: Thunk legt erst das Traegerbein auf (awaited), holt danach das Ergebnis, bucht erst dann; begrenzte Wartezeit verzoegert nie die Kappung; Geld-Wache laeuft pro Call eigenstaendig; `billedAt` bleibt der einzige Buchungsriegel; pro-Tenant-Kostendecke unangetastet. Offenlegung, Auth (`internalOnly` + `callVisibleTo`, Signatur-MW) und Secrets nicht betroffen.

### Concerns (nicht blockierend)
1. `elevenLabsHangUpAction` liefert `null` jetzt auch fuer RUECKFALL (geht leicht ueber den B5-Scope "RUECKFALL/WARTET → heutiger Thunk" hinaus), deckt sich aber mit E7b; praktisch unerreichbar, da Inbound-Calls immer `twilioSid` tragen.
2. `/voice/status` auf einem bereits terminalen GEBUNDEN-Call setzt trotzdem `elNachlaufStartedAt` und loggt die Nachlauf-Zeile — wirkt nicht auf die Buchung, kann aber die Diagnose nach Runbook 11 verwirren.
3. `cancel_call` und der Cap-Pfad warten fuer GEBUNDEN bis zu ~40s (3×10s + 2×`resultPollMs`) nach dem Traeger-Hangup vor Buchung/Antwort — von der Spec akzeptiert, Leitung ist vorher aufgelegt.
4. Zwei eslint-Pins steigen (Komplexitaet, Zeilenzahl) — dokumentiert, bewertet vom Clean-Code-Audit.
5. Byte-Identitaet von Outbound-EL bei `cancel_call` nicht eigens in B5 getestet, aber durch unveraenderte Bestandstests (`el-beende-versuch`, `el-geldpfad-s1`) belegt.
6. Aenderungen ausserhalb der Spec-Dateiliste (app.js, outbound.js-Ergaenzungen, timer.js#sleep, Harness, Pin-Spiegel) als noetig/neutral bewertet, keine neue Dependency.
7. Fehlt `awaitAndPersistInboundElResult` in einer Komposition, wirft der `finally`-Block einen TypeError statt fail-soft — in Produktion nicht erreichbar (server.js verdrahtet immer, kein Code setzt vor B8 das Profil).

---

## 5. Clean-Code-Audit

**Verdict: PASS** — keine S1/S2-Funde. `blocker: false`.

### S1 (Blocker)
Keine Funde.

### S2 (Blocker)
Keine Funde.

### S3 (nicht-blockierend)
- `eslint-legacy-exceptions.json` traegt fuer `api-calls.js` und `voice.js` je einen `reason`-String von mehreren tausend Zeichen, der mit jeder Phase waechst (B5 haengt zwei weitere Saetze an). Jeder Zusatz einzeln sauber begruendet und maschinell gegen den echten eslint-Lauf geprueft. Reine Fortsetzung der Repo-Konvention, kein neuer Verstoss durch B5 — nur Trendbeobachtung.

### S4 (nicht-blockierend)
- Keine S4-Funde im Scope: neue Funktionen (`anbieterErgebnisFertig`, `hangUpForCall`, `bridgedInboundHangUp`, `awaitAndPersistInboundElResult`) sind klein, einzweckig und mit Objekt-Argumenten (F1) sauber DI-injiziert.

### Begruendung / Positiv-Punkte
1. G5 sauber angewendet: die vormals doppelte Bedingung `!conversation || !FINISHED_PROVIDER_STATUS.includes(...)` ist jetzt `anbieterErgebnisFertig`, genutzt von Poll-Takt und Beende-Pfad.
2. `endeSchreiberFuer`/`hangUpForCall` sind die EINE geteilte Auswahl fuer `terminateActiveCall` UND `cancel_call` (kein Parallel-Switch, G23/G5).
3. Reihenfolge Traeger-Auflegen → Ergebnis sichern per `try`/`finally` erzwungen, inkl. Test fuer werfenden Traeger-Hangup (IEL-B5-2).
4. `carrierEndMsOf` (aus B4a) erstmals in `call-lifecycle.js` verdrahtet, mit Test fuer unveraenderten Fallback bei Nicht-EL-Inbound (IEL-B5-11P).
5. DIP bleibt strikt: `call-termination.js` importiert nur ein reines Praedikat aus `elevenlabs/inbound-bridge-state.js`, keine zustandsbehaftete Kante, Kommentar erklaert die Ausnahme mit Praezedenzfall `state-ops.js`.
6. eslint-Pins korrekt gemessen nachgezogen.

### Top-Todos
- Kein Blocker offen — B5 kann gemergt werden.
- Optional/nicht-blockierend: bestehende lokale `sleep()`-Kopien ausserhalb des B5-Diffs koennten kuenftig auf den neuen geteilten `src/utils/timer.js#sleep` konsolidiert werden.

---

## 6. Security-Review

**approved: true**, keine Blocker.

### Concerns (nicht blockierend)
1. `bridgedInboundHangUp` — fehlt `awaitAndPersistInboundElResult` in einer Komposition, wirft der `finally`-Block einen TypeError statt fail-soft; in Produktion nicht erreichbar (kein `?.` in `server.js`).
2. `awaitAndPersistInboundElResult` — `cancel_call` (internalOnly) und Cap-/Geld-Wache-Pfad warten nach dem Auflegen bis zu 3×10s + 2×`resultPollMs`; die MCP-Antwort auf `cancel_call` kann ~30s haengen, die Kappung selbst wird nicht verzoegert.
3. `elevenLabsHangUpAction` — fuer jeden Inbound-EL-Zustand gibt es keinen EL-DELETE mehr, das Beenden haengt allein am Traeger-Handle; heute immer gesetzt, aber Invariante per Konvention ohne expliziten Test fuer "GEBUNDEN ohne Traeger-Handle".
4. `/voice/status` setzt den Nachlauf-Marker auch fuer einen schon terminalen Call (harmlos, erzeugt aber eine irrefuehrende Log-Zeile).
5. Test-Rauschen `store.recordCallCostEvidence is not a function` aus Fake-Stores — kein Produktionscode-Befund, verdeckt aber echte Belegfehler im Log.

### Verdict-Begruendung
Keine neue oeffentliche Route, `route-policy` und Routen-Inventar unveraendert und gruen. Geaenderte Stellen (`/voice/status`, `POST /api/calls/:id/cancel`, `terminateActiveCall`) lassen alle Safety-Gates in Kraft: Cap und Geld-Wache bleiben pro Call armiert, pro-Tenant-Decke bleibt wirksam. Bruecken-Thunk legt immer zuerst den Traeger auf, holt danach begrenzt das Ergebnis (fail-soft), Kappung wird nicht verzoegert. Doppelbuchung bleibt ueber `billedAt` ausgeschlossen. Neue Logzeilen enthalten nur `callId`, keine Nummern/Transkripte/Secrets. Offenlegung, Outbound-Pfad und Budget-Engine unberuehrt. Abnahme-Tests: 56/56 gruen.

---

## 7. Fix-Runden

Keine — beide Reviews (Safety und Clean-Code) kamen direkt auf PASS/APPROVED ohne Blocker; keine Fix-Runde noetig.
