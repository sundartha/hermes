# C-P5 — Report: Twilio-Config, Boot-Pflicht, Env, Doku (Track C, Schritt 5b)

**Gate: PASS** · finalBranch: `phase/c-p5-config-boot` · headCommit: `6f871eb`

---

## 0. Kontext

Basis: `master` @ `9ddf1df` (C-P4 gemergt, `eccbafd`). Ziel dieser Phase: den letzten Twilio-Rest aus Config, Boot-Pflicht, Env-Dateien, Betriebs-Skripten und Doku entfernen — nachdem C-P4 die Adapter/Enum/Registry/Bridge bereits auf reines Telnyx umgestellt hatte.

---

## 1. Vorher-Messungen (gemessen, nicht geschätzt)

| # | Messung | Ergebnis |
|---|---|---|
| M1 | `npm test` auf `master` | `tests 4026 / pass 4026 / fail 0`, korrigiert (i18n-catalog-run-Wrapper abgezogen) `4006/4006`, ~98 s |
| M2 | Spawn mit `TWILIO_ACCOUNT_SID=""`, `TWILIO_AUTH_TOKEN=""`, `TWILIO_EDGE=""` | exit 1, `[Konfiguration fatal] Boot wird verweigert: - fehlt/ungueltig: TWILIO_ACCOUNT_SID / - fehlt/ungueltig: TWILIO_AUTH_TOKEN` — die Boot-Pflicht war real |
| **M3** | Der Offline-Diskriminator (entscheidend für Spec §5.3): `POST /api/calls` gegen BASE_ENV-Spawn (`TWILIO_ACCOUNT_SID: "x"`) | HTTP **500**, Server-Log: `[place_call] originate fehlgeschlagen … Telnyx originateCall: TELNYX_API_KEY fehlt` |

**M3 ist die gemessene neue Ursache**, die überall die falsche Twilio-Begründung ersetzt: `test/helpers.js` `BASE_ENV` pinnt `TELNYX_API_KEY: ""`; `originateCall` in `src/telephony/adapters/telnyx/voice.js` wirft **synchron vor jedem `fetch`**. `POST /api/calls` fängt das ohne `err.providerStatus` → 500. **500 heißt weiterhin: alle Gates passiert, bis zum Provider-Aufruf durchgekommen.** `TWILIO_ACCOUNT_SID: "x"` war seit C-P4 daran unbeteiligt — der Wert war inert, ~16 Tests trugen eine falsche Begründung bei gleichbleibend grüner Assertion.

---

## 2. Plan (gekürzt)

### 2.1 Neue Datei — genau eine, als Rename
`scripts/set-public-url.js` ← `git mv scripts/set-webhooks.js`. Grund: `START-DEMO.command` ruft das Skript, Teil 1 (`PUBLIC_URL` in `.env` schreiben) bleibt gebraucht, nur Teil 2 (Twilio-Webhook-API) entfällt. Ersatzloses Löschen hätte `START-DEMO.command` gebrochen.

### 2.2 Kern: `src/config.js`
- Env-Felder `twilioSid`, `twilioToken`, `twilioEdge` entfernt.
- `CONFIG_NAMESPACES.telephony`: 10 → 7 Keys.
- `assertConfig`: beide Twilio-Presence-Checks entfernt, Kommentar ergänzt (Übergangszustand: Render trägt die Keys noch, werden ignoriert).
- Diverse Kommentare korrigiert (`fakeOriginate`, `rateLimitPerMin`, `voiceEngine`, `sttSpeechTimeoutSec`) — u.a. mit M3 als neuer, wahrer Begründung.
- **Unangetastet**: `skipTwilioSignatureCheck`-Block samt Kommentar, `productionFootguns`, Nicht-Prod-Warnung (Absolute Regel 1).

### 2.3 `src/boot.js`
Boot-Banner-Zeile `Twilio-Webhook:` → `Voice-Webhook:` (Spaltenbreite 16 erhalten); Kommentar am Nummern-Boot-Guard korrigiert. `boot.js:336` (FAKE_ORIGINATE/SKIP_TWILIO_SIGNATURE_CHECK) unangetastet.

### 2.4 `src/mcp-tools.js`, `src/route-policy.js`
Tool-Beschreibung von „Twilio number" befreit; `VOICE_SIGNATURE_REASON` von „Twilio HMAC / Telnyx Ed25519" auf „Telnyx Ed25519" korrigiert (Absolute Regel 3 verlangt zutreffende Begründung für die `/voice`-Ausnahme).

### 2.5 `scripts/check-setup.js`
`twilio`-Import raus; Owner-Nummer ohne Provider-Filter (`findActiveNumber(store.load(), BOOTSTRAP_TENANT_ID)`, kein `"twilio"`-Argument); Twilio-Credential-Check entfernt; kompletter Abschnitt „3. Twilio" gelöscht inkl. `norm()`-Helper (nach Löschung ohne Aufrufer) und `let trialAccount`; Abschnitte 4/5/6 → 3/4/5 renummeriert. **Bewusst kein Ersatz-Telnyx-API-Check** (Scope-Grund, Kandidat für C-P7).

### 2.6 `scripts/set-webhooks.js` → `scripts/set-public-url.js`
`git mv`, Teil 2 + 5 zugehörige Importe gestrichen. ~55 → ~24 Zeilen.

### 2.7 `START-DEMO.command`
Skript-Aufruf umgestellt, neue `echo`-Zeile mit Hinweis, die Telnyx-TeXML-App-Voice-URL manuell im Portal zu stellen (sonst wäre der Demo-Pfad still kaputt).

### 2.8 Tote CLI-Hilfetexte
`scripts/bootstrap-tenant.js`, `scripts/seed-owner-number.js`, `scripts/prod-setup.sh`, `scripts/convo-bench.mjs` — `<twilio|telnyx>` → `telnyx` in Kommentaren/Usage-Strings, kein Verhalten.

### 2.9 `package.json` / `package-lock.json`
`"twilio": "^5.3.0"` entfernt, Lock regeneriert (nicht handeditiert).

### 2.10 `.env.example`
Kompletter Twilio-Block (5 Zeilen) gelöscht; Telnyx-Block-Überschrift/Kommentare auf „einziger Provider" umgeschrieben; STT-/Rate-Limit-/Bootstrap-/OWNER_NUMBER_PROVIDER-Kommentare bereinigt.

### 2.11 `render.yaml`
`TWILIO_ACCOUNT_SID`/`TWILIO_AUTH_TOKEN`/`TWILIO_EDGE` (6 Zeilen) gelöscht; Kommentare nachgezogen. **Löscht in Render selbst nichts** (Dashboard-managed) — das ist ein separater Ops-Schritt.

### 2.12 Doku
`CLAUDE.md` (:7, :15, :62, :131), `README.md` (14 Treffer, ASCII-Diagramm, Engine-Tabelle, Setup-Schritte), `ONBOARDING.md`, `STATUS.md`, `PLAN-SECURITY.md` (Secret-Inventar, Rotationstabelle, Checkliste), `PLAN-AUTH-GATE.md`, drei Runbooks, `PLAN-ANBIETER-PORT.md`-Standtabelle nachgezogen. Owner-Entscheidungs-Block C-P3 (`CLAUDE.md:76-106`) und alle `SKIP_TWILIO_SIGNATURE_CHECK`-Stellen bleiben wörtlich.

### 2.13 Tests
- `test/helpers.js`: `BASE_ENV` verliert `TWILIO_ACCOUNT_SID`/`_AUTH_TOKEN`/`_EDGE`; die M3-Begründung kommt **einmal** an `TELNYX_API_KEY: ""` statt in 16 Kopien.
- `test/boot-failclosed.test.js`: T-P2-07 **gedreht** (leere TWILIO_*-Env bootet, `/healthz` 200 statt Refusal); T-P2-07b **neu** (gesetzte TWILIO_*-Env bootet unverändert — pinnt den Übergangszustand).
- `test/kv-m0-boot-banner-config.test.js`: Nicht-Leak-Wert von `TWILIO_AUTH_TOKEN` auf `TELNYX_API_KEY` umgestellt, Aussage erhalten.
- `test/prod-env.js` + `test/prod-config-smoke.test.js`: `PROD_DUMMY_SECRETS` umgestellt (`TWILIO_*` raus, `TELNYX_API_KEY: ""` explizit rein — verhaltensidentisch, macht Zufall zu Struktur, G27); Kommentar auf M3 umgeschrieben.
- `test/config-namespaces.test.js`: Zählerpin `telephony` 10→7, `EXPECTED_TOTAL_KEYS` 144→141.
- `test/config-prod-footguns.test.js`, `test/single-origin-boot-guard.test.js`, `test/telnyx-p10-config.test.js`: lokale `REQUIRED_OK`-Kopien bereinigt (sonst Proxy-Guard-`TypeError`).
- `test/check-setup-script.test.js`: Test 1 unverändert (Kopplungs-Fänger), Test 2 gedreht (kein Provider-Filter mehr).
- 14 weitere Testdateien (`number-gate`, `dial-target-normalization`, `outbound-frozen`, `e164-trunk-zero-reject`, `profiles`, `profile-tenant-key`, `p2-onboard-retry`, `outbound-reserve-gate`, `outbound-reserve-release-error`, `f1-p8-outbound-lang`, `audit`, `a4-default-profile-zero`, `did-07-onboard-retry-owner-gate`, `auth-p3-bootstrap-fallback`): toter Env-Override raus, Kommentar auf eine wahre Zeile gekürzt, **keine Assertion geändert**.

### 2.14 Deterministisch geprüftes Ergebnis (Plan-Abnahmepunkte)
`npm test` grün+1 Test; `node --check` auf alle geänderten Dateien; `npm run check` läuft ohne TypeError/Crash-Banner; Boot ohne/mit gesetzten TWILIO_*-Env je 200; Boot-Banner ohne „Twilio" außer der legitimen SKIP-Warnung; Gegenprobe (Key zurückinjizieren → TypeError, belegt Proxy-Guard-Kopplung); `npm ls twilio` leer; `test/security.test.js` grün (Telnyx-Ed25519-Beleg); `git grep -in twilio` nur Kategorie (b)+(c).

**Reihenfolge/Blast-Radius**: ein Commit für Code+Tests+Env+Blueprint+Doku+Dependency (Spec §5.5, `test-base-env-drift`-Lehre). ~45 Dateien. Ops-Schritte (Deploy, Verifikation, Render-Keys erst danach löschen) ausdrücklich NICHT Teil der Phase.

**Zwei angekündigte Abweichungen**: (a) `CLAUDE.md:15` trägt denselben Defekt wie :7/:62/:131, wird mitgezogen (Spec listet es nicht); (b) einzelne Trefferzahlen aus Spec §3 weichen um 1-2 vom heutigen Bestand ab — maßgeblich ist der Code.

---

## 3. Impl-Zusammenfassung

C-P5 vollständig umgesetzt und committet (**`6f871eb`**, 50 Dateien, +267/-719).

**Kern**: die unbedingte Boot-Pflicht auf `TWILIO_ACCOUNT_SID`/`TWILIO_AUTH_TOKEN` ist gefallen. `config.js` verliert `twilioSid`/`twilioToken`/`twilioEdge`, `CONFIG_NAMESPACES.telephony` 10→7, zwei `assertConfig`-Zeilen weg. Am laufenden Server beidseitig gemessen: leer gesetzt → `/healthz` 200; gesetzt → `/healthz` 200 (T-P2-07b pinnt den Übergangszustand dauerhaft).

**Inhaltlich wichtigste Änderung**: die Korrektur der falschen Testbegründung in ~16 Dateien — die alte Erklärung des 500-Signals war seit C-P4 falsch, die Tests blieben aus einem anderen Grund grün. Die wahre Ursache (M3, `originateCall` wirft synchron ohne `TELNYX_API_KEY`) steht jetzt einmal an der Ursache in `helpers.js` BASE_ENV, die 14 Konsumenten tragen nur eine Verweis-Notiz. Keine Assertion angefasst.

**Weiter**: `check-setup.js` verliert Twilio-Abschnitt + `twilio`-Import + `norm()` + `trialAccount`; Owner-Nummer ohne Provider-Filter; Abschnitte renummeriert. `set-webhooks.js` → `set-public-url.js` (git mv), Provider-Aufruf entfällt ersatzlos (Telnyx hält Voice-URL an der TeXML-Application), `START-DEMO.command` weist jetzt darauf hin. npm-Dependency `twilio` entfernt. Env/Blueprint/Doku nachgezogen.

**Unangetastet**: `SKIP_TWILIO_SIGNATURE_CHECK` in jeder Form, `twilioSid`/`twilio_sid` am Call-Record und in `schema.sql`, alle Safety-Gates.

**Testergebnis**: `npm test` 4027/4027, fail 0 (korrigiert 4007/4007), zwei reproduzierte grüne Läufe, exit 0. Vorher 4026 → +1 wie geplant (T-P2-07b).

### Deviations (aus IMPL)
- (a)/(b) wie im Plan angekündigt (CLAUDE.md:15, Trefferzahlen-Drift).
- **Nachtrag über den Plan hinaus**: `test/config-namespaces.test.js` pinnt zusätzlich die Zahl primitiver Blätter (135→132, alle drei Twilio-Felder waren primitiv).
- **Nachtrag**: `scripts/check-setup.js:77` verwies auf „Abschnitt 6"; nach Renummerierung 6→5 mitgezogen.
- **Werkzeug-Abweichung**: `package-lock.json` per `npm install --package-lock-only` statt vollem `npm install` (node_modules ist Symlink auf den Eltern-Checkout — voller Install hätte den fremden Arbeitsbaum beschädigt). Lock ist trotzdem tool-regeneriert, nicht handeditiert. Folge: `npm ls twilio` meldet in diesem Worktree `twilio@5.13.1 extraneous` statt leer — physisch noch im geteilten `node_modules`, aber nicht mehr deklariert; verschwindet nach echtem `npm install`/`npm ci` im Hauptarbeitsbaum.
- **Flake-Beobachtung**: erster `npm test`-Lauf `4027/4026/1 fail` (Fehlerzeile beim Abschneiden verloren); zwei folgende vollständig protokollierte Läufe `4027/4027/0`. Passt zum bekannten Volllast-Flake.
- **Rest-Befund**: `scripts/seed-owner-number.js:4` (historisch wahre Aussage) bleibt stehen — Kategorie (c), C-P6-Nachlese.
- **Ops-Schritte**, ausdrücklich nicht Teil der Phase: Deploy → Verifikation (`/healthz` 200 + Commit-Abgleich via `git merge-base --is-ancestor`) → erst dann `TWILIO_ACCOUNT_SID`/`TWILIO_AUTH_TOKEN`/`TWILIO_EDGE` in Render löschen → erneut `/healthz` 200.
- **Bewusste Lücke, Kandidat C-P7**: `check-setup.js` hat keinen Ersatz-Telnyx-API-Check für den gelöschten Twilio-Abschnitt 3 bekommen (Scope). Verlust ist gedeckt: Telnyx-Seite ist fail-closed, Nummern-Boot-Guard bleibt scharf.

---

## 4. Safety-Urteil (final)

**approved: true** — alle Teilurteile true (testsPassIndependently, safetyGatesIntact, disclosureIntact, authFailClosedIntact, noSecretsLeaked, scopeRespected, behaviorAsIntended).

**Verdict: FREIGABE.** Eigener Lauf im frischen Worktree, HEAD `6f871eb`, 1 Commit über `master 9ddf1df`.

- `npm test` Lauf 1: 4025/4027 (2 rote Tests, `al-p10-precall-research` und `finishcall-billing-once` — beide vom C-P5-Diff nicht berührt, Load-Average 10,2 während parallele Workflows liefen). Isoliert nachgefahren: 13/13 grün.
- `npm test` Lauf 2 (ruhige Maschine): 4027/4027, fail 0, exit 0 — deckt sich mit Commit-Behauptung.
- Beide Backends (json + pg via pglite) laufen im selben Durchgang, kein separater pg-Modus im Repo.
- `npm run test:gates` hängt auf `test/auth-p9a-cache-headers.test.js` — **vorbestehend**, identisch auf `master` reproduziert, Datei vom Diff nicht berührt, CI fährt `test:gates` mit `continue-on-error`.

**Alle 10 Plan-Abnahmepunkte selbst gefahren**, inkl. Gegenprobe (7): `config.telephony.twilioSid` testweise injiziert → `npm run check` wirft „existiert nicht" via Proxy-Guard (PA-20) — belegt die Config↔Skript-Kopplung ist real und fail-closed, nicht nur konventionell eingehalten.

**Regelprüfung am Diff**: `assertConfig` verliert ausschließlich die zwei Twilio-Presence-Checks, alle übrigen Pflichtprüfungen unverändert; `src/routes/**`, Outbound-Gates, State-Ops, Activation, Boot-Guard: 0 Zeilen Diff; kein neuer Endpunkt. Signaturprüfung unberührt bis auf den korrigierten Begründungstext in `route-policy.js` (stärkt Regel 3). `claude.js`/`bridge.js`: 0 Zeilen Diff (Offenlegung unangetastet). Keine neue Route, kein Auth-Diff. Keine echten Secrets im Diff, nur Platzhalter.

### Concerns (nicht blockierend)
1. **gitleaks-Allowlist-Drift**: Fixtures `ACtest00000000000000000000000000` und `test-twilio-auth-token` sind von `test/helpers.js` (allowlisted) nach `test/boot-failclosed.test.js` (nicht allowlisted) gewandert. Heute harmlos, aber `gitleaks.toml`-Begründung nennt jetzt eine Datei ohne die Fixtures. Empfohlener Fix vor Merge oder als erster C-P6-Handgriff: Pfad ergänzen oder nicht-SID-förmigen Wert in T-P2-07b verwenden.
2. `scripts/set-public-url.js` ist eine neue Datei, die die Spec nicht namentlich vorsieht — sachlich als git-mv+Strip gerechtfertigt, Owner-Nicken sauberer.
3. Doku-Scope leicht über Twilio hinaus: README-STT-Punkt zusätzlich von `transcriptionEngine="Telnyx"` auf Deepgram/nova-3 korrigiert (gegen Code richtig, aber eigenständige Korrektur).
4. `PLAN-ANBIETER-PORT.md` führt C-P5 bereits als „gemergt" — stimmt erst nach dem Merge.
5. `src/telephony/call-finish.js:141` druckt weiterhin „SMS-fähige Twilio-Nummer?" — Laufzeit-Log-String, Kategorie (c)/C-P6, nicht mit reinen Kommentaren verwechseln.
6. Kein `tasks/c-p5-report.md` im Diff selbst — Spec-§5.6-Berichtspflicht wurde in der Commit-Message aggregiert erfüllt, nicht als separate Datei im Branch (diese Datei hier holt das nach).
7. `npm ls twilio` in diesem Worktree nicht aussagekräftig (Symlink-Bedingung, s. Deviations); auf Lockfile-Ebene verifiziert.
8. `npm run test:gates`-Hänger vorbestehend, nicht C-P5, aber beim Merge im Kopf behalten (Prozess-Leak).

---

## 5. Clean-Code-Audit (final)

**verdict: PASS**, `blocker: false`.

- **S1 (Duplizierung/Sicherheit, Blocker-Kategorie)**: keine Funde.
- **S2 (weitere Blocker-Kategorie)**: keine Funde.
- **S3 (nicht-blockierend)**: derselbe Offline-Diskriminator-Erklärkommentar wortgleich in ~15 Testdateien (`a4-default-profile-zero`, `audit`, `auth-p3-bootstrap-fallback`, `dial-target-normalization`, `did-07-onboard-retry-owner-gate`, `e164-trunk-zero-reject`, `f1-p8-outbound-lang`, `outbound-frozen`, `outbound-reserve-gate`, `outbound-reserve-release-error`, `p2-onboard-retry`, `profile-tenant-key`, `profiles`, `prod-config-smoke`, `prod-env`). Kein Blocker (Kommentar, keine Logik-Duplizierung, dokumentiert konsistent denselben Mechanismus). Möglicher künftiger Fix: zentrales Zitat in `helpers.js` + Kurzverweis statt Volltext an jeder Stelle.
- **S4**: keine Funde.

**passNotes**: sehr sauberer, disziplinierter Cutover — Code, Tests, Doku und Env-Beispiele im selben Zug angefasst statt driften zu lassen. Kommentare erklären WARUM, inkl. dokumentiertem Übergangszustand mit Testabsicherung. Keine Magic Numbers, keine neuen abgeschalteten Sicherungen; `SKIP_TWILIO_SIGNATURE_CHECK` korrekt nicht angefasst (kein Twilio-Schalter, sondern globaler `/voice`-Bypass).

**topTodos** (informativ, kein Blocker):
1. Optional: die 15× wortgleiche Diskriminator-Erklärung in Testkommentaren auf einen `helpers.js`-Verweis kürzen — nur falls die Redundanz künftig als Wartungslast auffällt (Lesbarkeit vor Ort spricht dagegen).
2. Track B (Repo-/Render-Service-Rename `vodafone-agent` → Hermes) bleibt separat offen, keine Aktion in dieser Phase nötig.

---

## 6. Fix-Runden

**Keine** — der Impl-Agent lieferte im ersten Durchlauf ein Ergebnis, das sowohl Safety-Review als auch Clean-Code-Audit ohne Blocker bestand (`=== FIXES ===` Abschnitt der Quelle ist leer). Alle gemeldeten Concerns/TopTodos sind nicht-blockierende Hinweise für C-P6 bzw. den Merge-Zeitpunkt, keine Nacharbeit innerhalb dieser Phase.

---

## 7. Offene Punkte für Folgephasen (aus dieser Phase heraus benannt)

- **C-P6**: Kommentar-Nachlese in `src/` und `test/` (Kategorie-c-Reste: `adapters/telnyx/*`, `answered-by.js`, `turn-budget.js`, `ports.js`, `server.js:1`, `app.js`, `middleware.js`, i18n/locales, `call-finish.js:141`-Log-String, `scripts/seed-owner-number.js:4`, gitleaks-Allowlist-Pfad).
- **C-P7**: Abnahme mit echtem Anruf, braucht den Owner. Kandidat: Ersatz-Telnyx-API-Check in `check-setup.js` (bewusst ausgelassen, Scope-Grund).
- Track B (Repo/Render-Rename) bleibt unverändert separat offen.
