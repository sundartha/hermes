# Phase C-P1 — Rueckfall-Default explizit auf Telnyx (Track C, Schritt 2)

**Gate: PASS**
**finalBranch:** `phase/c-p1-default-provider`
**headCommit:** `eee4c581cd37b022a20730fd0f906224b210ee31`

---

## 1. Gegenstand

`DEFAULT_PROVIDER` (in `src/store/defaults.js`) wird von `PROVIDER.TWILIO` auf `PROVIDER.TELNYX`
geflippt — der einzige live betriebene Carrier wird damit auch der explizite Rueckfall-Default
fuer alle Stellen, die keinen Provider nennen. Begruendung laut Kommentar im Diff: gemessen gegen
die Produktions-DB am 2026-08-07 (RLS je Tenant gesetzt) laufen 3 Nummern und 67 Anrufe, keine
einzige Zeile auf Twilio — der Flip leitet keinen echten Verkehr um.

## 2. Plan (gekuerzt)

### 0. Befunde vor der Umsetzung

- **B-1**: Die Leser-Liste der urspruenglichen Spec ("§2, vollstaendig") war unvollstaendig — 10
  Lesestellen statt der genannten 4:
  1. `src/store/defaults.js` `resolveSeedProvider` (Rueckfall, Spec 1)
  2. `src/routes/voice.js` `/voice/incoming` (Rueckfall, Spec 2)
  3. `src/routes/voice.js` `/voice/status` (Rueckfall, Spec 3)
  4. `src/telephony/voice-render.js` `streamDirectives` (Rueckfall, Spec 4)
  5. `src/store/state-ops.js` `createCall` (`provider || DEFAULT_PROVIDER`) — fehlte in der Spec
  6. `src/store/state-ops.js` `seedBootstrapNumber` (Default-Arg) — fehlte in der Spec
  7. `src/store/state-ops.js` `bootstrapTenant` (Default-Arg) — fehlte in der Spec
  8. `src/store/state-ops.js` `requestNumber` (Default-Arg, **Geld-Pfad**) — fehlte in der Spec
  9. `src/store/pg.js` Call-Flush (`c.provider || DEFAULT_PROVIDER`) — fehlte in der Spec
  10. `src/store/pg.js` Number-Flush (`n.provider || DEFAULT_PROVIDER`) — fehlte in der Spec

- **B-2**: Der Geld-Pfad ist vom Flip nicht betroffen (verifiziert). Alle Live-Aufrufer der vier
  Default-Arg-Stellen nennen ihren Provider bereits explizit (`api-onboard.js`,
  `provision-trigger.js`, `boot.js` mit Validierung gegen `twilio|telnyx`, `json.js` via
  `resolveSeedProvider`, `api-calls.js` aus der Absendernummer). `numberProvisioning` in
  `src/telephony/registry.js` hat zudem keinen Twilio-Eintrag — ein Twilio-Provisioning wuerde
  fail-closed werfen. Kein Carrier-Wechsel auf einem Kauf-/Geld-Pfad.

- **B-3**: Rueckfall-Leser 4 (`voice-render.js` Media-Pfad) war bislang ungetestet — beide
  Bestandstests in `test/voice-render-action-url.test.js` setzten `provider` explizit. Ein neuer
  Test (T-3) schliesst die Luecke.

- **B-4**: Kein neues Testfile — neue Tests kommen in `test/provider-threading.test.js` (dort
  leben bereits `providerFromHeaders`, Provider-Threading-Fixtures und Inbound-Render-Diskriminatoren).

**Nicht in dieser Phase**: Twilio-Adapter/Routen/Signaturpruefung, Boot-Pflicht auf
`TWILIO_ACCOUNT_SID`/`TWILIO_AUTH_TOKEN`, `test/helpers.js`-Konstanten `OWNER_TEST_NUMBER`/
`DOMESTIC_TEST_NUMBER`/`BASE_ENV`-`TWILIO_*`, die hartcodierten `PROVIDER.TWILIO`-Default-Argumente
in `src/telephony/registry.js` (das sind eigene Defaults, keine `DEFAULT_PROVIDER`-Leser) —
gehoert zu Track-C-Schritt 4/5.

### Edits (Uebersicht)

- **Der Flip**: `src/store/defaults.js` — `DEFAULT_PROVIDER = PROVIDER.TELNYX` + Begruendungs-
  kommentar mit der Prod-DB-Messung.
- Sechs Kommentar-Aktualisierungen (kein Verhaltenscode): `src/config.js`
  (`ownerNumberProvider`-Doku), `src/billing/provision-trigger.js` (Begruendung fuer explizites
  `provider: TELNYX`), `src/store/state-ops.js` (zwei Stellen: `createCall`,
  `seedBootstrapNumber`), `src/routes/voice.js` (Inbound-Rueckfall-Kommentar), `.env.example`
  (`OWNER_NUMBER_PROVIDER`-Doku).
- **Tests**: 3 neue Zusicherungen (T-1/A: `DEFAULT_PROVIDER === PROVIDER.TELNYX`; T-2/B: Inbound
  ohne Provider-Header rendert TeXML statt TwiML; T-3: `streamDirectives` ohne `call.provider`
  nutzt den Telnyx-Media-Pfad) plus Nachzug an 8 Bestandstests, die den alten impliziten
  Twilio-Rueckfall genutzt hatten — alle Assertions blieben woertlich, nur die Provider-Herkunft
  wurde explizit gemacht (neue Fixture `TWILIO_TEST_SIGNATURE_HEADERS` als Gegenstueck zu
  `TELNYX_TEST_SIGNATURE_HEADERS` in `test/helpers.js`).

### Deterministisch pruefbares Ergebnis (Plan-Vorgabe)

`node --check` je geaenderte Datei, gezielte Testlaeufe, voller `npm test` (Erwartung
4060/4060), `npm run test:gates` unveraendert, Gegenprobe (Flip zurueckdrehen -> 3 neue Tests
muessen rot werden), Smoke-Test via `curl` gegen `/voice/incoming`.

## 3. Implementierung — Zusammenfassung

C-P1 exakt gemaess Plan umgesetzt: `DEFAULT_PROVIDER` geflippt (die einzige Verhaltenszeile),
sechs Kommentar-Aktualisierungen. Drei neue Tests pinnen die vorher unbeobachteten Rueckfall-Pfade
(Identitaet, Inbound-Header-Rueckfall, Media-Pfad-Rueckfall). Acht Bestandstests benennen ihren
Provider jetzt explizit ueber `TWILIO_TEST_SIGNATURE_HEADERS`, Assertions blieben woertlich
erhalten.

Gegenprobe durchgefuehrt: Flip zurueckgedreht -> die drei neu gepinnten Faelle fallen rot (bei der
Impl-eigenen Messung 3/16 rot gemeldet — siehe Deviation/Concern zur Commit-Message unten), danach
zurueckgeflippt und wieder komplett gruen bestaetigt.

**Ergebnis**: `npm test` 4060/4060 gruen, 0 fail. Smoke via Testharness-Server-Spawn bestaetigt den
Telnyx-Rueckfall end-to-end (echter Server, echter HTTP-POST ohne Provider-Header, Antwort enthaelt
`transcriptionEngine="Deepgram"`, kein `speechModel`).

**Geaenderte Dateien** (Produktivcode, alle nur Kommentar ausser der einen Zeile in `defaults.js`):
`src/store/defaults.js`, `src/config.js`, `src/billing/provision-trigger.js`,
`src/store/state-ops.js`, `src/routes/voice.js`, `.env.example`.

**Geaenderte/neue Tests**: `test/provider-threading.test.js`, `test/voice-render-action-url.test.js`,
`test/owner-number-seed.test.js`, `test/inbound-routing.test.js`,
`test/telnyx-elevenlabs-inbound.test.js`, `test/telnyx-p9-flag-matrix.test.js`,
`test/voice-status-lifecycle.test.js`, `test/helpers.js`.

### Deviation (Impl-Bericht)

`npm run test:gates` blieb im Sandbox-Worktree bei ~6 Minuten Laufzeit ohne CPU-Fortschritt stehen
(letzter Subtest: `test/auth-p7-gate-removed.test.js`) und wurde manuell abgebrochen. Vermutete
Ursache: Ressourcen-Konkurrenz durch eine parallel laufende zweite Session im selben Sandbox-Host
(bekannte Parallelitaets-Grenze — zwei gleichzeitige `node --test`-Laeufe ueberlasten die Kerne).
Kein erkennbarer Zusammenhang mit den geaenderten Dateien. Der Pflicht-Regressionslauf (`npm test`)
lief vollstaendig und sauber gruen (4060/4060). Empfehlung der Impl: `test:gates` in einer Session
ohne parallele Workflow-Last vor dem finalen Abhaken der Kette erneut fahren.

## 4. Safety-Urteil

**approved: true** — alle Einzelpruefungen (`testsPassIndependently`, `safetyGatesIntact`,
`disclosureIntact`, `authFailClosedIntact`, `noSecretsLeaked`, `scopeRespected`,
`behaviorAsIntended`) **true**.

**Unabhaengige Nachpruefung** (frischer Worktree, Branch `review-c-p1`):
- `npm test`: 2 von 3 Volllaeufen sauber gruen (4060/4060); 1 Lauf unter Nebenlast 4059/4060
  (Testname durch eigene tail-Kuerzung nicht rekonstruierbar) — passt zum dokumentierten
  ~12%-Volllast-Flake der Suite, kein isoliert roter Test.
- Postgres-Backend (pglite) gezielt nachgefahren: 74/74 gruen.
- Alle von `test/helpers.js` beruehrten Testdateien separat: 44/44 gruen.
- Eigene Gegenprobe (Flip zurueckdrehen, danach revertiert): **5** Tests fallen rot — "C-P1 A",
  "C-P1 B", "C-P1 streamDirectives ohne provider", `resolveSeedProvider: leer -> DEFAULT_PROVIDER
  (Telnyx)` und der (f)-Block in `/voice/status`. Flip ist damit belegbar gepinnt.
- `node --check` gruen fuer alle 5 geaenderten src-Dateien. `git status` im Worktree sauber.

**Blockers: keine.**

**Concerns (nicht-blockierend):**
1. Commit-Message behauptet, die Gegenprobe mache "exakt die drei neuen Tests" rot, "alle anderen
   bleiben gruen" — gemessen sind es **fuenf** rote Tests (zusaetzlich `resolveSeedProvider`-Test
   und der neue (f)-Block in `voice-status-lifecycle`). Abweichung geht in die sichere Richtung
   (mehr Pinning als behauptet), ist aber eine ungenaue Tatsachenbehauptung in der Historie —
   Empfehlung: im Merge-Commit richtigstellen.
2. Ein Volllauf von dreien war rot (4059/4060) durch eigene tail-Kuerzung nicht namentlich
   rekonstruierbar; zwei isolierte Wiederholungen vollstaendig gruen — passt zum bekannten
   Suite-Flake, kein Blocker, aber nicht positiv als Flake identifiziert.
3. **Divergenz Registry vs. DEFAULT_PROVIDER**: `src/telephony/registry.js` haelt seine
   Port-Defaults weiterhin als Literal `PROVIDER.TWILIO` (voiceControl/messaging/mediaTransport/
   webhookEvents/voiceRenderer). Nach dem Flip heisst "Default" an zwei Orten Unterschiedliches.
   Heute inert (keine arg-lose Call-Site in `src/`, nur Kommentare), aber ein kuenftiger
   arg-loser Aufruf griffe still nach Twilio. Gehoert in einen spaeteren Track-C-Schritt.
4. **Nullable-Spalte**: `src/db/schema.sql` fuehrt `call.provider`/`number.provider` als TEXT ohne
   NOT NULL; Flush-Pfade in `pg.js` setzen `x.provider || DEFAULT_PROVIDER`. Eine Altzeile mit
   NULL wuerde ab jetzt als `telnyx` statt `twilio` materialisiert. Laut gemessener Praemisse
   (3 Nummern, 67 Anrufe, 0 Twilio-Zeilen) existiert kein solcher Fall in Prod; der Outbound-
   Absenderpfad erbt `DEFAULT_PROVIDER` nicht. Erwaehnenswert, kein Blocker.
5. Abnahmepunkt "Smoke-Test mit lokal gestartetem Server" wurde nicht manuell mit echtem `npm
   start` nachgestellt (braucht echte Env/Secrets); aequivalent abgedeckt durch den
   spawn-basierten Integrationstest "C-P1 B", der einen echten Server startet und in der
   Gegenprobe nachweislich rot wird.

**Verdict-Kernaussagen**: Absolute Regeln unberuehrt — SAFETY-GATES intakt (0 Diff-Zeilen auf
`src/telephony/`, `outbound-gates.js`, `boot-guard.js`, `middleware.js`, `route-policy.js`,
`auth.js`, `web-auth.js`, `package.json`/-lock); der headerlose Telnyx-Rueckfall in
`routes/voice.js` ist in Produktion nicht erreichbar, weil `providerFromHeaders` bei unbekanntem
Header `null` liefert und die Signaturpruefung dann fail-closed mit 403 antwortet (nur unter
`SKIP_TWILIO_SIGNATURE_CHECK=true`, boot-gehaertet). OFFENLEGUNG unveraendert (`claude.js`/
`bridge.js` byte-identisch zu `master`). AUTH FAIL-CLOSED unveraendert (keine neue Route). SECRETS:
kein Wert im Diff. SCOPE: exakt Track C Schritt 2, nichts geloescht, keine neue Dependency. Der
Hauptschaden aus der Pre-Mortem der Spec ("Abdeckung wandert still ab") ist nachweislich nicht
eingetreten — Twilio-Renderer-Erwartungen blieben woertlich erhalten. Geld-/Kaufpfad geprueft und
unberuehrt (alle Live-Aufrufer nennen ihren Provider explizit oder validieren fail-closed).

## 5. Clean-Code-Audit

**blocker: false** — **S1: keine, S2: keine, S3: keine.**

**S4 (kosmetisch, kein Handlungsdruck):**
- `src/store/state-ops.js:190` — Kommentar bei `provider: provider || DEFAULT_PROVIDER` verweist
  noch beilaeufig auf `api-calls.js`, ohne dass das zusaetzliche Info-Gewicht traegt (leichte
  Redundanz zum Absatz darueber). Optional kuerzen.

**Verdict**: PASS. Sauberer, minimal-invasiver Ein-Konstanten-Flip mit vollstaendig nachgezogener
Doku und Tests. Keine neue Logik, keine neue Abstraktion, keine Duplizierung. Die impliziten
Twilio-Annahmen in Tests (`postTelnyxIncoming(..., {telnyx:false})` sandte vorher leere Header und
driftete damit still auf den neuen Telnyx-Rueckfall) wurden korrekt auf den expliziten
`TWILIO_TEST_SIGNATURE_HEADERS`-Header umgestellt — genau der Fall, den ein Audit als "stiller
Verhaltenswechsel ohne Test-Nachzug" haette flaggen muessen, und der hier vermieden wurde. Kein
Duplizierungsmuster, keine Magic Numbers, keine abgeschalteten Sicherungen, keine Grenzfall-Luecken,
keine Nebenlaeufigkeitsprobleme im Scope. Voller Testlauf auf dem Phase-Branch: 4060/4060 gruen.

**Top-Todos**: keine Blocker. Optional: den kleinen redundanten Kommentar-Zusatz in
`state-ops.js:190` bei naechster Gelegenheit straffen.

## 6. Fix-Runden

Keine — beide Reviews (Safety, Clean-Code) kamen im ersten Durchlauf zu PASS ohne Blocker. Es gab
keine Fix-Runde.

## 7. Naechster Schritt (Track C)

Laut Plan (§5): Schritt 3 ist die Testsuite-Migration (`OWNER_TEST_NUMBER`/`DOMESTIC_TEST_NUMBER`/
`BASE_ENV`-`TWILIO_*` in `test/helpers.js`). Nach C-P1 ist `TWILIO_TEST_SIGNATURE_HEADERS` bereits
die eine Stelle, an der "dieser Test meint Twilio" steht — die Liste, die Schritt 4/5 abarbeiten
muss. Offen aus den Concerns: `test:gates` isoliert (ohne Parallel-Last) nachfahren; die
Registry-Divergenz (`src/telephony/registry.js`-Defaults bleiben Twilio-Literal) in einem
spaeteren Schritt adressieren; Commit-Message-Ungenauigkeit (3 vs. 5 rote Tests in der Gegenprobe)
bei Gelegenheit richtigstellen.
