# Phase AL-P2b — Betriebsumgebung fuer den Spike

## Betriebsrahmen

Wegwerf-Branch fuer den SSE-Spike. Basis ist `phase/al-p2-sse-spike` (Commit `197595f`),
**nicht** `master`. Das Ergebnis dieser Phase wird **nie** nach `master` gemergt — der
Code lebt ausschliesslich auf einem eigenen Spike-Branch und wird nach der Messung
verworfen. `.env.example`, `render.yaml`, `test/helpers.js` bleiben unberuehrt (keine
neue Env-Variable im Scope).

- **Gate:** BLOCKED
- **finalBranch:** `phase/al-p2b-spike-betrieb-fix2`

## Plan (gekuerzt)

Ziel: eine Betriebsumgebung fuer den in AL-P2 gebauten SSE-Spike, damit ein echter
Testanruf gefahren werden kann, ohne den Live-Tenant/Live-Assistant zu beruehren.

Gebaut werden sollte:

1. **Neutrale `pause`-Direktive** (`src/telephony/directives.js`) plus Renderer in
   `src/telephony/adapters/telnyx/render.js` und `.../twilio/render.js` (additiv,
   Port bleibt symmetrisch, kein neuer Zweig ohne Gegenstueck).
2. **Route "abnehmen und schweigen"** (`src/routes/voice-spike.js`, neu): reiner
   statischer TeXML-Responder fuer eine Wegwerf-DID. Dreifach eingegrenzt:
   - leere `TELNYX_SSE_SPIKE_CALLEE` -> 404 (Existenz hinter dem Schalter)
   - `To` != Sollnummer -> 404 + genau eine `[spike-silence]`-Diagnosezeile
   - sonst: `<Pause length=config.safety.maxCallDurationS>` + `<Hangup/>`
   Kein Store-, Kosten- oder Gate-Pfad. Mount **nach** `makeVoiceRoutes(...)` in
   `src/app.js` — die Route erbt damit die fail-closed Provider-Signaturpruefung
   und die bestehende `/voice`-Basic-Auth-Exemption, ohne eine neue Ausnahme zu
   erzeugen. Diese Mount-Reihenfolge ist die eigentliche Sicherung und sollte per
   Spawn-Test gepinnt werden, nicht nur per Kommentar behauptet.
3. **Treiber-Skript** (`scripts/al-p2-spike-driver.mjs`, neu) mit `--arm` /
   `--measure` / `--restore`:
   - Dry-Run (`apply:false`) ist der Default.
   - `forbiddenTokenIn` verweigert bei der Live-DID `+17067101188` und dem
     Live-Assistant-Praefix `assistant-dcf48d08` in JEDEM Argument.
   - `--arm`: nur GETs zur Vorbedingungspruefung, Snapshot wird **nur einmal**
     geschrieben (Idempotenz gegen doppeltes Armieren), Vorbedingung fail-closed
     (`texmlAppVoiceUrl` MUSS auf die Spike-Route zeigen).
   - `--measure`: Anruf laeuft ueber die **regulaere** `POST /api/calls` (alle
     Safety-Gates aktiv, kein neuer Endpunkt, kein Bypass), Urteil ueber die in
     AL-P2 gebaute `sseSpikeVerdict`-Funktion (kein zweites Urteil).
   - `--restore`: Rueckbau per Snapshot, verifiziert per **Objekt-GET**
     (`connectionMismatches`), nicht per Behauptung; `restored=true|false`.
4. **Wiederverwendung statt Duplikat** in `scripts/telnyx-call-latency.mjs`:
   drei Symbole (`SPIKE_FLAG`, `assistantTurnRowsFor`, `conversationIdForCall`)
   exportiert statt neu implementiert, `main()` verhaltens-erhaltend auf den
   neuen Seam gezogen.
5. Tests: `test/al-p2b-silence-route.test.js`, `test/al-p2b-spike-driver.test.js`
   (Praefix `AL-` ist nicht im i18n-Katalogmuster, landet also im
   Regressionslauf), plus je ein additiver Fall in den Bestands-Renderer-Tests.
6. Doku: `PLAN-SECURITY.md` (neuer Abschnitt `AL-P2b-SPIKEENV`),
   `tasks/al-testcall-checklist.md` (Fahr-/Rueckbau-Protokoll).

**Explizit nicht im Scope:** neue Env-Variable, Aenderung an `/voice/*`-Bestandsrouten,
Aenderung an `scripts/telnyx-assistant-provision.mjs`, neue npm-Dependency, Deploy/Push
nach `upstream`.

Pre-Mortem im Plan deckte u.a. ab: unsignierte oeffentliche Route (Mount-Reihenfolge +
Test), Live-DID/Live-Assistant versehentlich getroffen (`forbiddenTokenIn`), stiller
Rueckbau-Fehlglaube (Objekt-GET-Verifikation statt Behauptung), doppeltes Armieren
(Snapshot nur einmal schreiben), fehlgeleiteter Testanruf in falschem Handler
(`--arm`-Vorbedingung), stummer verirrter Anruf (Diagnosezeile).

## Implementierungs-Zusammenfassung

Vollstaendig gemaess Plan auf dem Wegwerf-Branch umgesetzt (letzter Stand
`phase/al-p2b-spike-betrieb-fix2`, abgezweigt von `phase/al-p2-sse-spike` @197595f).

Gebaut:

- `src/routes/voice-spike.js` (neu) — Route `POST /voice/spike-silence`, reiner
  statischer TeXML-Responder, dreifach eingegrenzt wie geplant, kein Store-/
  Kosten-/Gate-Pfad. Auth-Kante geerbt ueber Mount-Position (`src/app.js`, nach
  `makeVoiceRoutes(...)`), keine neue Exemption-Zeile.
- `scripts/al-p2-spike-driver.mjs` (neu) — `--arm`/`--measure`/`--restore`,
  Dry-Run-Default, Live-DID/Live-Assistant-Riegel ueber alle Argumente UND den
  Snapshot, einmalig geschriebener secretfreier Snapshot (Allowlist-Projektion),
  Messanruf ueber regulaere `POST /api/calls`, Rueckbau mit Objekt-GET-Verifikation.
- `pause`-Direktive additiv in `src/telephony/directives.js` sowie beiden
  Renderern (`telnyx/render.js`, `twilio/render.js`) — Port bleibt symmetrisch.
- `scripts/telnyx-call-latency.mjs`: drei Exporte + ein verhaltens-erhaltender
  Dedup in `main()`, keine Testaenderung an der Bestandssuite noetig.
- `PLAN-SECURITY.md` (Abschnitt `AL-P2b-SPIKEENV`), `tasks/al-testcall-checklist.md`
  (Fahr-/Rueckbau-Schritte 0/2b/3b + `--restore --apply` muss `restored=true`
  melden).
- Tests: 5 Spawn-Tests (`AL-P2b-1..5`) fuer die Route, 6 Offline-Tests
  (`AL-P2b-6..11`) fuer den Treiber, je 1 additiver Fall in
  `test/directive-render.test.js` und `test/telnyx-render.test.js`.
- In den Fix-Runden zusaetzlich: `src/telephony/adapters/telnyx/http-client.js`
  (neu) — dedupliziert einen dreifach kopierten Bearer/fetch/assertTelnyxOk-
  Baustein (`telnyxHeaders()`/`telnyxRequest(...)`), mit eigenem Test
  (`test/telnyx-http-client.test.js`, 5 Faelle).

Verifikation laut Impl-Report: `node --check` auf allen beruehrten Dateien gruen;
`npm test` 3558 pass / 0 fail (Baseline 3545, Delta genau die Plan-Vorhersage:
+11 AL-P2b + 2 Renderer-Faelle); `npm run test:gates` unveraendert 3 rot
(dokumentierter Bestandsstand, kein AL-P2b-Test darin); Smoke gegen lokal
gestarteten Server gruen (byte-genaues TeXML, 404 bei fremdem `To`, Treiber
verweigert ohne Kommando bzw. bei Live-DID ohne jeden Netzzugriff).
`committed: true`, `headCommit: 03dd4110052af5763fea77a47fb28ec4e97add17`.

### Deviations (aus dem Impl-Report)

1. Branchname `phase/al-p2b-spike-betrieb` statt der im Plantext genannten
   `phase/al-p2b-spike-env`; Basis (`phase/al-p2-sse-spike` @197595f) korrekt.
2. Testname `AL-P2b-5` praezisiert: die Diagnosezeile traegt laut Plan-Spec
   ausdruecklich `To` und Sollnummer im Klartext — Name entsprechend "404 + genau
   eine Diagnosezeile" statt "PII-frei".
3. `spikeSnapshot`-Signatur praezisiert auf `assistant = { id, externalLlm }`
   (roher Telnyx-Block), damit `--restore` ohne Zusatzargument auskommt und die
   Allowlist-Projektion (Test AL-P2b-11) ein echter Beweis statt Tautologie ist.
   Kein Zeitstempel im Snapshot.
4. `--measure` prueft `TELNYX_API_KEY` bereits vor dem Dry-Run (Plan: "Guards wie
   oben"), `DASHBOARD_PASSWORD` erst im `--apply`-Zweig (Dry-Run loest keinen
   Anruf aus).
5. Fehler in Plan-Schritt 4.7 (Smoke-curl) identifiziert: `-d 'To=+...'` kodiert
   das `+` als Leerzeichen und liefert dadurch (korrekt) 404; mit
   `--data-urlencode` (reale Provider-Kodierung, auch im Spawn-Test verwendet)
   liefert die Route das erwartete TeXML. Route selbst unveraendert.
6. `npm run test:gates` bleibt bei 3 rot — dokumentierter Bestandsstand, durch
   diese Phase unveraendert, kein AL-P2b-Test darin.
7. ESLint konnte nicht laufen (`@eslint/js` fehlt im Worktree-node_modules) —
   nicht als Blocker gewertet, durch `node --check` + Testlauf abgedeckt.
8. Anzeige-Platzhalter `NO_VALUE = "-"` existiert zusaetzlich unexportiert im
   Treiber-Skript statt als vierten Export aus `telnyx-call-latency.mjs`
   zusammengelegt — bewusst, da ein einzeichiges Ausgabe-Literal keine geteilte
   Logik ist und ein weiterer Export den Plan-Scope (3 Exporte + 1 Dedup)
   ueberschritten haette.

## Safety-Urteil (final)

**approved: false — verdict: BLOCKIERT (1 Blocker)**, inhaltlich sehr sauber, aber
eine der zwei als "gepinnt" dokumentierten Auth-Sicherungen pinnt tatsaechlich
nichts.

Unabhaengig bestaetigt:

- Safety-Gates unangetastet (`outbound-gates.js`, `budget-gate.js`,
  `api-calls.js`, `voice.js`, `auth-gate.js` byte-identisch zu master); neue
  Route loest weder Call noch SMS noch Geld aus; Messanruf laeuft ueber die
  voll gegatete `POST /api/calls`.
- Offenlegung unangetastet (`claude.js`, `bridge.js` byte-identisch zu master).
- Auth fail-closed haelt: unsignierte/falsch signierte/GET-Requests auf
  `/voice/spike-silence` enden bei `SKIP_TWILIO_SIGNATURE_CHECK=false` mit 403
  vor dem Handler (selbst gemessen inkl. Log-Beweis); keine neue Exemption-Zeile.
- Secrets: kein Secret in Logs/Snapshot/Responses, Snapshot ist Allowlist-
  Projektion und per Test gepinnt.
- Scope: keine neue Dependency, keine neue Env-Variable, `.env.example`/
  `render.yaml` unangetastet.
- Flag-off-Verhalten: ohne `TELNYX_SSE_SPIKE_CALLEE` antwortet die Route 404
  mit leerem Body, sonst unveraendert.

**Der Blocker:** `AL-P2b-4` ist ein Vakuumtest. Er schickt seinen Request von
`127.0.0.1` **ohne** `X-Forwarded-For`; `isTrustedLocalCaller(req)`
(`src/wiring/auth-gate.js`) laesst genau diesen Request ohnehin durch —
unabhaengig vom `/voice`-Praefix. Empirisch belegt: mit identischem Setup
(`DASHBOARD_PASSWORD=geheim`, kein `X-Forwarded-For`) liefert `POST /api/state`
404 statt 401 (das Gate fordert also nie Credentials); erst **mit**
`X-Forwarded-For` liefert `/api/state` 401 und `/nicht-vorhanden` 401, waehrend
`/voice/spike-silence` 200 bleibt. `AL-P2b-4` waere also auch dann gruen, wenn
die `/voice`-Exemption fuer die Route gar nicht greifen wuerde. `PLAN-SECURITY.md`
behauptet aber ausdruecklich, die Mount-Reihenfolge sei "per Spawn-Test gepinnt
(AL-P2b-3/AL-P2b-4)" — fuer AL-P2b-4 ist das falsch, dieselbe Klasse von
Falschbehauptung, die Runde 2 bereits einmal korrigiert hatte. Die Eigenschaft
selbst (keine Basic-Auth-Sperre vor der Route) haelt laut unabhaengiger Pruefung
— blockierend ist die fehlende Absicherung des Tests plus die falsche Aussage im
Sicherheitsdokument. Empfohlener Fix: `X-Forwarded-For`-Header im Test mitsenden
und einen Nicht-`/voice`-Pfad als 401-Gegenprobe ergaenzen. `AL-P2b-3`
(Signaturpruefung) wurde unabhaengig gegengeprueft und haelt.

**Concerns (nicht blockierend):**

- Kostenachse der Wegwerf-Route unbenannt: haelt einen eingehenden Leg bis
  `MAX_CALL_DURATION_S` offen ohne Call-Record/Budget-Achse/Watchdog — pro Anruf
  gedeckelt, in der Anzahl unbegrenzt solange armiert; Pre-Mortem-Satz fehlt im
  Plan.
- `--measure` hat keinen Riegel gegen den Live-Dienst: nur `armCommand` prueft
  die `voice_url`-Vorbedingung; `measureCommand` nimmt jedes `--service` und
  wuerde mit `--apply` auch gegen den Live-Dienst einen echten Outbound
  ausloesen (kein Gate-Bypass, aber die selbstgesetzte "Live nie anfassen"-Grenze
  deckt `--measure` nicht ab).
- `--restore` stellt `external_llm` nur teilweise wieder her: Snapshot
  projiziert bewusst nur `base_url`, aber `setAssistantExternalLlm` schreibt
  `model`/`llm_api_key_ref` aus der lokalen `.env` zurueck und das
  `restored=true`-Urteil vergleicht nur `base_url` — reproduziert im Kleinen die
  dokumentierte Env-Falle von `telnyx-assistant-provision.mjs`. Betrifft nur den
  Wegwerf-Assistant.
- "Kein Verhaltensunterschied" fuer `telnyx-call-latency.mjs` stimmt nicht exakt:
  der neue `telnyxHeaders()` haengt zusaetzlich `Content-Type: application/json`
  an jeden GET (praktisch harmlos, aber live unverifiziert, ausgerechnet am
  Messwerkzeug fuer die AL-P7-Entscheidung).
- Scope-Kante: Fix-Runde 1 hat mit `src/telephony/adapters/telnyx/http-client.js`
  ein neues Modul im Produktions-Baum angelegt und `telnyx-assistant-provision.mjs`
  angefasst (das Skript mit der dokumentierten Env-Falle) — auf einem Branch, der
  nie nach master geht, verdampft die G5-Vereinheitlichung mit dem Branch.
  Gewertet als reviewgetriebene Folgearbeit, nicht als ungefragtes Extra.
- Diagnosezeile `[spike-silence]` loggt `To` und Sollnummer im Klartext — Spec-
  erlaubt, aber bei fehlgeleitetem Anruf landet eine fremde Zielnummer im Log.

## Clean-Code-Audit (final)

**verdict: PASS, blocker: false.**

- **s1:** []
- **s2:** []
- **s3:**
  1. `scripts/al-p2-spike-driver.mjs` (`numberResource`, Z. 208-217): Pfad wird
     zweimal aufgebaut (einmal fuer `telnyxRequest.path`, einmal fuers
     Op-Label) statt einmal in eine Variable gelegt — rein kosmetisch.
  2. `scripts/al-p2-spike-driver.mjs` (`measureCommand`): `requireTelnyxKey()`
     wird auch im reinen Dry-Run-Zweig aufgerufen, obwohl dieser Pfad keinen
     Netzzugriff macht — leicht ueberraschend, koennte vor die apply-Weiche
     gezogen werden.
- **s4:** `armCommand`/`restoreCommand` teilen dieselbe Read-Apply-Verify-
  Struktur ohne gemeinsame Hilfsfunktion — fuer ein Wegwerf-Skript akzeptabel,
  bei Uebernahme in Dauerbetrieb wuerde sich ein `verifyAfterWrite()`-Helfer
  lohnen.

Bestaetigt: Live-DID/Live-Assistant-Riegel doppelt abgesichert
(`forbiddenTokenIn` ueber alle argv-Token + gezielter Praefix-Check in
`armCommand`), Dry-Run-Default, secretfreie Snapshot-Allowlist (per Test
gepinnt), Rueckbau per Objekt-GET statt Behauptung verifiziert. Neuer
`http-client.js`-Baustein dedupliziert korrekt eine dreifach kopierte
Bearer/fetch/assertTelnyxOk-Stelle (G5), eigenstaendig getestet (5 Faelle).
Route erbt die Auth-Kette nachweislich korrekt (Mount-Position verifiziert,
kein Basic-Auth-Loch), Existenz-Gate + To-Mismatch-Verhalten per Spawn-Test
gepinnt. `pause`-Direktive symmetrisch in beiden Renderern implementiert und
getestet. `PLAN-SECURITY.md` dokumentiert transparent sogar die Korrektur
einer frueheren falschen Behauptung (Fix2). Keine Magic Numbers ohne
Konstante, keine neue Sicherheitsausnahme, kein Secret-Leak gefunden. Beide
s3-Punkte ohne Blocker-Charakter fuer ein Wegwerf-Skript, das laut Spec nie
nach master gemergt wird.

## Fix-Runden

- **r1:** Behob den einzigen damals gemeldeten Blocker (S2-1) — extrahierte den
  dreifach duplizierten Telnyx-HTTP-Baustein (Bearer-Header, `fetch`,
  `assertTelnyxOk` als Fehlerparser, `{data}`-Envelope-Unwrap) in die neue
  geteilte Datei `src/telephony/adapters/telnyx/http-client.js`
  (`telnyxHeaders()`/`telnyxRequest({method, path, ...})`).
- **r2:** Beide dort gemeldeten Blocker waren reine Dokumentations-/
  Kommentar-Wahrheitsluecken, keine Logik-Bugs: `PLAN-SECURITY.md` und der
  Treiber-Kommentar behaupteten faelschlich, `scripts/telnyx-assistant-
  provision.mjs` sei von AL-P2b unangetastet, obwohl Fix-Commit `dd6d216` dort
  Bearer-Header/`fetch`/`assertTelnyxOk` durch den neuen `http-client.js`-
  Baustein ersetzt hatte. Text korrigiert.
- Danach lief eine weitere Safety-Review-Runde (final, s.o.), die einen neuen
  Blocker in `AL-P2b-4` (Vakuumtest) fand — dieser Blocker ist zum Zeitpunkt
  dieses Berichts **nicht** behoben; die Phase steht auf **BLOCKED**.
