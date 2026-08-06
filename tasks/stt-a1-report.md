# Phase STT-A1 — Eine Wahl fuer die STT-Engine, pro Adapter uebersetzt (Track A)

**Gate:** PASS
**finalBranch:** `phase/stt-a1-modellwahl`
**headCommit:** `e34537c14dc45e6489930947e3eca8cdc83175bd`
**Basis:** `master` @ `24076a8`

---

## 1. Plan (gekuerzt)

### Ziel

Der Anbieter-String fuer Spracherkennung (STT) stand bisher an drei Code-Orten roh und
unabhaengig voneinander: dem Telnyx-TeXML-Gather (Literal `"Deepgram"` +
`"deepgram/nova-3"`), dem Telnyx-Call-Control-Assistant (Modul-Konstante `STT_MODEL` in
`voice.js`) und dem Twilio-Gather (Literal `"deepgram_nova-2-general"`). Diese Duplizierung
war die strukturelle Ursache des B-7-Befunds: der Assistant-Pfad lief vier Wochen auf einem
Modell, das deutsches Telefon-Audio als Englisch erkannte, ohne dass ein Mechanismus den
Widerspruch zum Gather-Pfad sichtbar machte.

STT-A1 fuehrt eine neutrale Wahl `STT_PROFILE` ein (heute ein Mitglied: `accurate`), die
jeder Adapter in seine eigene Schreibweise uebersetzt — analog zum bestehenden Muster
`VOICE_PROFILE`/`voiceAttrs`.

### Bausteine

- `src/telephony/stt-profile.js` (neu) — reines Enum-Modul, kein IO, kein config-Import,
  nimmt **kein** Sprach-Argument entgegen (Sprachform bleibt strukturell getrennt: Gather
  sendet `de-DE`, Assistant `de`).
- `src/telephony/adapters/telnyx/stt-model.js` (neu) — einzige Telnyx-Uebersetzungstabelle,
  von BEIDEN Telnyx-Konsumenten (Gather in `render.js`, Assistant in `voice.js`) genutzt;
  `engine`+`model` als EIN gefrorener Datensatz, weil der model-Vendor zu
  `transcriptionEngine` passen muss.
- `scripts/telnyx-stt-drift.mjs` (neu, nur lesend) — Drift-Probe fuer den vierten,
  netzlosen Ort der STT-Wahl (das Telnyx-Assistant-Objekt selbst); GET-only, schreibt
  Snapshots ausschliesslich ins gitignorte `data/evidence/telnyx-config/`, loggt nie den
  API-Key.
- Twilio bekommt eine eigene Uebersetzungstabelle direkt in `twilio/render.js`
  (`TWILIO_SPEECH_MODEL`/`speechModelFor`) — bewusst kein eigenes Modul, da nur ein
  Aufrufer.
- `config.voice.sttProfile` (ein einziger Config-Schluessel, `STT_PROFILE`-Env) wird von der
  Registry **lazy zur Render-Zeit** an beide Renderer injiziert (Kompositionsstelle, P15).
- `boot-guard.js`/`boot.js`: `sttProfileFindings` + `assertSttProfile` — ein ungueltiges
  `STT_PROFILE` bricht den Start ab (`exit 1`), statt erst im Render-Pfad eines laufenden
  Anrufs zu werfen.
- `.env.example`, `test/helpers.js` (`BASE_ENV.STT_PROFILE`) entsprechend ergaenzt.

### Ausdruecklich nicht angefasst

`src/bridge.js` (`whisper-1`), jede Sprachform (`de-DE`/`de`), `directives.js`,
`PRESERVED_SAFETY_FIELDS` im Provisionierer, `test/telnyx-assistant-merge-guard.test.js`
(flux-Fixture bleibt).

### Geplante Tests

- `test/stt-model-seam.test.js` (A–E): A = Fail-closed in allen drei Aufrufern
  (verhaltens-rot ohne Fix), B = eine Wahl → drei Adapter-Schreibweisen, C = Fangnetz
  (jedes Enum-Mitglied loest in jedem Adapter auf), D = Fangnetz gegen den
  Sprachform-Angleichungs-Reflex (`de-DE` vs. `de`), E = Boot-Guard End-to-End
  (Server-Spawn, `exit 1`).
- `test/stt-drift-probe.test.js` — reine Vergleichslogik `sttDriftFindings` (6 Faelle).
- Byte-Identitaets-Pruefung ueber alle Voice-Profile x beide Provider (arg-lose Aufrufe
  bleiben unveraendert, da Default-Profil greift).
- Gegenprobe (Literale zurueckdrehen → A/B/E muessen rot werden, C/D bleiben gruen als
  echte Fangnetze).

---

## 2. Impl-Zusammenfassung

- **headCommit:** `e34537c14dc45e6489930947e3eca8cdc83175bd`, `committed: true`
- `node --check` auf allen 10 geaenderten/neuen Dateien: PASS
- `npm test`: PASS, 4054 Tests, 0 fail
- **filesCreated (5):** `src/telephony/stt-profile.js`,
  `src/telephony/adapters/telnyx/stt-model.js`, `scripts/telnyx-stt-drift.mjs`,
  `test/stt-model-seam.test.js`, `test/stt-drift-probe.test.js`
- **filesEdited (11):** `.env.example`, `src/boot-guard.js`, `src/boot.js`, `src/config.js`,
  `src/telephony/adapters/telnyx/render.js`, `src/telephony/adapters/telnyx/voice.js`,
  `src/telephony/adapters/twilio/render.js`, `src/telephony/registry.js`,
  `test/config-namespaces.test.js`, `test/helpers.js`, `test/telephony-registry.test.js`
- **testsAddedOrChanged:**
  - `test/stt-model-seam.test.js` (neu: A–E)
  - `test/stt-drift-probe.test.js` (neu: reine `sttDriftFindings`-Vergleichslogik)
  - `test/telephony-registry.test.js` (Referenz- → Verhaltens-Assertion fuer den jetzt
    lazy-arrow-registrierten Twilio-Renderer)
  - `test/config-namespaces.test.js` (`CONFIG_NAMESPACES.voice` 11→12 Keys, Gesamt 143→144)
  - `test/helpers.js` (`BASE_ENV.STT_PROFILE="accurate"` gepinnt)
- **smokePass:** true — lokaler Server, `POST /voice/incoming` (Twilio) liefert TwiML mit
  `speechModel="deepgram_nova-2-general"`; Telnyx-Pfad per Unit-/Snapshot-Tests belegt (kein
  Live-Zugang in der Sandbox).

### Deviations (aus dem Impl-Report)

1. `test/config-namespaces.test.js` musste zusaetzlich zur einzigen im Plan genannten
   Bestandstestaenderung (`telephony-registry.test.js`) angepasst werden: reine
   Zaehler-Nachfuehrung (`CONFIG_NAMESPACES.voice` 11→12, Gesamt 143→144, `checked` 134→135)
   nach dem neuen `sttProfile`-Config-Schluessel — keine Verhaltensaenderung an der
   Assertion-Logik, im Plan nicht explizit als eigener Punkt gefuehrt.
2. GAP-07-Kommentar in `config.js`: die neue, praezisere Zeile wurde vor die bestehende
   gesetzt und ersetzt sie (keine Duplizierung im Ergebnis) statt sie wie im Plan-Wortlaut
   „zu praezisieren" — inhaltlich identisch, nur die Diff-Form weicht leicht ab.
3. Insert-Position von `sttProfile` in `rawConfig`: Plan-Text war mehrdeutig
   (`twilioEdge:` ist bereits die letzte Zeile des Voice-Engine-Blocks); interpretiert als
   Einfuegen direkt NACH `twilioEdge`, vor dem naechsten Abschnitt — einzige konsistente
   Lesart.

---

## 3. Safety-Urteil (final)

**approved: true** — alle Einzelkriterien PASS (`testsPassIndependently`,
`safetyGatesIntact`, `disclosureIntact`, `authFailClosedIntact`, `noSecretsLeaked`,
`behaviorAsIntended`, `scopeRespected`), **keine Blocker**.

### Unabhaengige Verifikation

- Frischer Worktree, `git checkout -b review-stt-a1 phase/stt-a1-modellwahl`; Merge-Base ==
  `master` (`24076a8`), 1 Commit, 16 Dateien / +551 / -49.
- Regression (`npm test`, Branch): 4054/4054 pass, 0 fail, 159,9 s (korrigiert nach
  Wrapper-Abzug 4034/4034). GRUEN.
- PG-Backend separat (`rls-with-check`, `web-auth-pg`, `store-pg`): 59/59 pass. GRUEN.
- Neue Tests isoliert: `stt-model-seam.test.js` + `stt-drift-probe.test.js` → 11/11 pass.
  Keine Katalog-ID-Praefixe → landen korrekt im Regressionslauf.
- `npm run test:gates`: terminiert NICHT in dieser Umgebung — Haenger in
  `test/auth-p9a-cache-headers.test.js`, per Gegenprobe auf reinem `master`-Baum identisch
  reproduziert → **pre-existing**, nicht durch STT-A1 verursacht.
- Zwei selbst geschriebene Sonden: (1) Byte-Identitaet ueber alle drei `VOICE_PROFILE` x
  beide Provider, master vs. Branch durch den echten Registry-Pfad → `diff` leer. (2)
  Gegenprobe auf `master`: `renderTelnyx`/`renderTwilio` mit `sttProfile:"nicht-existent"`
  werfen dort NICHT, sondern rendern klaglos weiter — bestaetigt, dass Test A verhaltens-rot
  ist (echter Beleg, kein „Modul fehlt"-Rot).
- Lint konnte NICHT laufen (`@eslint/js` fehlt im node_modules des Haupt-Repos) —
  Lint-Sauberkeit unverifiziert.

### Scope

Kein `package.json`/`package-lock.json`-Diff → keine neue npm-Dependency. Keine Aenderung
an `src/routes/`, `src/server.js`, `src/route-policy.js`, `src/auth.js`, `src/web-auth.js`,
`src/middleware.js`, `src/telephony/outbound-gates.js` (je 0 Zeilen Diff).
`src/bridge.js:197` (`whisper-1`) unangetastet.

### Safety-Gates / Offenlegung / Auth / Secrets

- Alle bestehenden Gates (Denylist/Land/Stundenlimit, pro-Tenant-Kostendecke, Max-Dauer,
  `OUTBOUND_FROZEN`, Signaturpruefung) unberuehrt; kein neuer Endpunkt, der Calls/SMS/Geld
  ausloest. Die Drift-Probe ist reines Lese-Skript (nur GET) ausserhalb des Servers.
  NEU hinzu: `assertSttProfile` (exit 1), korrekt vor `rearmActiveCallTimers` einsortiert
  (INV-5 gewahrt).
- `src/claude.js`/`src/bridge.js`: 0 Zeilen Diff → `disclosureSentence` unveraendert.
- Keine Route/Policy/Middleware beruehrt; `route-auth-inventory.test.js` gruen.
- `STT_PROFILE` ist ein Enum-Name, kein Secret; Drift-Probe loggt nie den API-Key
  (`assertTelnyxOk`, `includeDetail` aus), Snapshot-Pfad per `git check-ignore -v` bestaetigt
  ignoriert. Kein MCP-Diff.

### Verhalten

Byte-Identitaet gemessen (nicht nur behauptet) ueber alle Voice-Profile x beide Provider.
Spec-Invarianten eingehalten: kein Sprach-Argument im Enum-Modul, `engine+model` als EIN
gefrorener Datensatz bei Telnyx, beide Telnyx-Pfade speisen sich aus demselben
`config.voice.sttProfile`. `provider-threading.test.js` und
`telnyx-assistant-merge-guard.test.js:52` (flux-Fixture) unveraendert und gruen.

### Concerns (keine Blocker, Nachfassungen fuer den Lead)

1. `render.yaml` nicht angefasst — kein Regressionsrisiko (keine STT_*-Variable dort,
   Default haelt Live-Verhalten unveraendert), sollte aber explizit als bewusst
   uebersprungen dokumentiert sein statt stillschweigend zu fehlen.
2. `scripts/telnyx-stt-drift.mjs`: Operator-Meldung fuer vendorPrefix-gescopte
   Einstellungen (`smart_format`/`numerals`) ist irrefuehrend — `(scope.models ||
   []).join(", ")` ist dort leer, die Meldung endet mit „gilt nur fuer: ". Kosmetisch,
   vom Test nicht gefangen.
3. `sttDriftFindings` kehrt bei Modell-Drift sofort zurueck und unterdrueckt damit die
   Befunde zu inerten Einstellungen im genau relevanten Untersuchungsfall — nachvollziehbar,
   aber nirgends als Absicht dokumentiert.
4. Ein Live-Lauf der Drift-Probe (Spec-Abschnitt 7, Teil der Abnahme) ist in dieser Umgebung
   nicht verifizierbar (braucht echte Telnyx-Credentials) und bleibt offen fuer den Owner;
   kein npm-Script-Alias fuer die Probe.
5. `npm run test:gates` terminiert in dieser Umgebung nicht (Haenger in
   `auth-p9a-cache-headers.test.js`) — identisch auf `master` reproduziert, kein Befund
   dieser Phase, aber ein offener Umgebungs-/Harness-Defekt.
6. `eslint` war nicht lauffaehig (`@eslint/js` fehlt) — Diff-Inspektion zeigt keine
   `eslint-disable`/Skip-Marker, Lint-Regeln selbst aber unverifiziert.

---

## 4. Clean-Code-Audit (final)

**verdict: PASS**, `blocker: false`

- **S1 (hart verboten):** keine Funde.
- **S2 (Duplizierung/Struktur):** keine Funde.
- **S3 (bewusst gepasst, kein Flag):** G26 — `config.js:1386` `.trim()` auf `sttProfile`,
  `isSttProfile()` prueft exakte Enum-Werte — konsistent, kein Flag.
- **S4 (dokumentierter Grenzfall):** G5-Grenzfall — `TELNYX_STT` und `TWILIO_SPEECH_MODEL`
  sind zwei separate Tabellen mit demselben Schluessel `STT_PROFILE.ACCURATE`; keine
  Duplizierung im Sinne von G5, da die Werte je Anbieter verschieden sind (`nova-3` vs.
  `nova-2-general`) und der Kommentar explizit gegen eine Zusammenlegung argumentiert
  (Muster `VOICE_PROFILE`). PASS, kein Flag.

### Begruendung (Kurzfassung)

Saubere Seam-Trennung (`stt-profile.js`/`stt-model.js` rein, kein IO/config-Import,
kein Zyklus). Fail-closed durchgehend: unbekanntes Profil wirft in allen drei Renderern
UND bricht den Boot ab. Vollstaendige Testabdeckung ueber A–E plus 6 Drift-Faelle.
Config-Namespace-Zaehler korrekt mitgezogen, `BASE_ENV` ergaenzt (Lehre
`test-base-env-drift` beachtet). Voller isolierter Testlauf nach Merge: 4054/4054 gruen.

### topTodos (optional, kein Blocker)

1. `sttAttrs()` (Telnyx) und `speechModelFor()` (Twilio) werfen strukturell identische
   Fehlermeldungen an zwei Stellen — bewusst getrennt gehalten; bei einem dritten Adapter
   lohnt sich ein gemeinsamer Validierungs-Helfer in `stt-profile.js`.
2. `scripts/telnyx-stt-drift.mjs` ist reine Diagnose ohne CI-Anbindung — bei
   wiederkehrenden B-7-artigen Regressionen koennte ein periodischer Check erwogen werden.

---

## 5. Fix-Runden

Keine. `=== FIXES ===` ist leer — die Phase erreichte PASS ohne Nacharbeit an Safety- oder
Clean-Code-Befunden.
