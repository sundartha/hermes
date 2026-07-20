# PA-16 — Migration Cluster C: telephony-Rest + store + bridge-Rest + claude.js

**Gate: PASS**
**finalBranch:** `phase/polish-a-p16`
**headCommit:** `9bddb66fc0c692f93520797bd08a9bc8300dab3f`
**Grundlage:** `master` @ `544dbfe` (PA-12 `CONFIG_NAMESPACES` + `attachNamespaces` Dual-Read-Getter-Shim; PA-13/14/15, PA-6, PA-1 gemergt)

---

## 1. Auftrag

Fortsetzung der PA-12-Namespace-Migration `config.<flatKey>` -> `config.<namespace>.<key>` fuer Migrations-Cluster C: die restlichen Telephony-Dateien, beide Store-Backends, den Rest von `bridge.js` und `claude.js`. Rein mechanische Zugriffspfad-Aenderung, keine Logik-Aenderung (`config.js` bietet seit PA-12 beide Oberflaechen parallel auf demselben `rawConfig`-Slot).

---

## 2. Plan (gekuerzt)

### Namespace-Karte (aus `CONFIG_NAMESPACES`, PA-12)

| Flach-Key(s) | Namespace |
|---|---|
| `maxCallDurationS`, `reserveReleaseGraceMs`, `fakeOriginate` | `safety` |
| `voiceEngine`, `sttSpeechTimeoutSec`, `maxEmptyTurns`, `callerSubstanceMinLen`, `realtimeModel`, `realtimeVoice`, `openaiApiKey` | `voice` |
| `telnyxApiKey`, `telnyxApiBase`, `telnyxConnectionId`, `telnyxAccountSid`, `twilioSid`, `twilioToken`, `twilioEdge` | `telephony` |
| `telnyxElevenLabs`, `telnyxAssistant` | `telnyx` |
| `paymentEnabled`, `smsCostCents` | `billing` |
| `provisioningCountry`, `ownerNumberSeed`, `ownerNumberProvider` | `provisioning` |
| `publicUrl`, `dataDir` | `server` |
| `profilesSeed`, `assistantContextEnabled` | `tenancy` |
| `ownerIdpSubject` | `auth` |
| `retentionDays` | `privacy` |
| `anthropicApiKey`, `claudeModel` | `llm` |

Alle Keys mappen eindeutig; kein Grenzfall. Fehl-Zuordnung ist fail-closed (`guardedConfig` wirft `TypeError` bei falschem Blattzugriff).

### Umfang laut Plan

- **Neue Dateien:** keine.
- **Edits pro Datei:** je Flach-Key -> `config.<ns>.<key>` in `src/telephony/adapters/telnyx/{messaging,numbers,voice}.js`, `src/telephony/adapters/twilio/client.js`, `src/telephony/{call-finish,call-lifecycle,provisioning-geo,registry,voice-render}.js`, `src/store/{json,pg}.js`, `src/bridge.js`, `src/claude.js`.
- **Bewusst NICHT angefasst:** `src/telephony/adapters/telnyx/render.js` und `src/telephony/ports.js` — enthalten `config.<key>` nur in Kommentaren, keine Code-Nutzung.
- **`bridge.js` HEIKLE STELLE:** Plan fordert Zeile-fuer-Zeile-Review; nur der Max-Dauer-Timer (~Z.283) sowie WS-Connect (Z.140-146) und `session.update`-Voice-Feld (Z.183) enthalten config-Zugriffe. Barge-in- und Call-Ende-Puffer-Bloecke haben 0 config-Zugriffe -> 0 Edits, byte-identisch.
- **Tests:** Plan sagte eine einzige Testdatei-Anpassung voraus — `test/voice-render-action-url.test.js` — weil dort ein handgerollter Flach-Fake (`{ publicUrl, sttSpeechTimeoutSec }`) injiziert wird, der nach der Migration die neue Namespace-Shape (`{ server: { publicUrl }, voice: { sttSpeechTimeoutSec } }`) braucht. Assertions bleiben unveraendert. Alle anderen Tests bleiben gruen dank Dual-Read-Garantie (`config.<ns>.<key> === config.<flatKey>`, bewiesen durch `test/config-namespaces.test.js` fuer alle 99 Keys).
- **Deterministisches Abnahme-Rezept:** `node --check` je editierter Datei, struktureller Grep-Gate (0 Flach-Zugriffe im Code, nur Kommentar-Treffer erlaubt), volle `npm test`-Suite, Boot-Smoke.

---

## 3. Impl-Zusammenfassung

- **13 Code-Dateien** mechanisch migriert: `src/telephony/adapters/telnyx/{messaging,numbers,voice}.js`, `src/telephony/adapters/twilio/client.js`, `src/telephony/{call-finish,call-lifecycle,provisioning-geo,registry,voice-render}.js`, `src/store/{json,pg}.js`, `src/bridge.js`, `src/claude.js`.
- Namespace-Zuordnung 1:1 aus `CONFIG_NAMESPACES` (PA-12) uebernommen und verifiziert. `render.js` und `ports.js` unangetastet (nur Kommentar-Treffer, wie im Plan vorhergesagt).
- Kein Logik-Diff: reine Zugriffspfad-Aenderung, keine neuen Konstanten/Imports/Signaturen (0 Import-Aenderungen ueber den gesamten Diff).
- **`bridge.js` HEIKLE STELLEN** Zeile-fuer-Zeile gegengelesen (Diff manuell verifiziert): nur der Max-Dauer-Timer (~Z.283, `config.maxCallDurationS` -> `config.safety.maxCallDurationS`), WS-Connect (Z.140-146: `realtimeModel`/`openaiApiKey` -> `config.voice.*`, nur Reflow wegen Zeilenlaenge) und `session.update`-Voice-Feld (Z.183: `realtimeVoice` -> `config.voice.realtimeVoice`, `??`-Operator/`loc.realtimeVoice` unveraendert) trugen config-Zugriffe. Barge-in- und Call-Ende-Puffer-Bloecke: 0 config-Zugriffe, 0 Edits, byte-identisch (per Diff bestaetigt — ausserhalb der 3 Hunks kein Diff). `disclosureSentence` (claude.js Z.171, bridge.js) unberuehrt.
- **Test-Anpassungen:** die geplante Fake-Shape-Nachziehung in `test/voice-render-action-url.test.js` umgesetzt (`config.publicUrl`/`sttSpeechTimeoutSec` -> `{server:{publicUrl},voice:{sttSpeechTimeoutSec}}`), Assertions unveraendert.
- **Verifikation:** Baseline (isolierter git-archive-Snapshot von master, um die Worktree-node_modules/-stash-Falle zu vermeiden) lief 2414/2414 gruen; nach allen Edits ebenfalls 2414/2414 gruen (2x reproduziert). Struktureller Grep-Gate liefert leere Ausgabe fuer alle 15 migrierten Dateien. Named-critical-Tests einzeln gegengelaufen (config-namespaces, config-shape, bridge-openai-event, bridge-hardening, max-duration-rearm/pure/live-cap, telnyx-voice/messaging, twilio-voice, telephony-registry, voice-render-action-url, f1-provisioning-geo, store-pg-*, store-json-*, claude-*, bridge-event-unit, place-call-context-bridge), alle gruen. `node --check` auf allen 13 geaenderten `.js`-Dateien gruen.
- **Boot-Smoke:** echter Server-Start (`SKIP_TWILIO_SIGNATURE_CHECK=true`, Dummy-Env, `DATA_DIR`-Override, bootstrap-tenant geseedet) -> `GET /healthz` 200, `POST /voice/incoming` liefert korrektes TwiML (Gather/Say/Redirect, relative Twilio-Action-URL) ohne Fehler im Log; sauber gestoppt, Temp-Daten geloescht.
- **Prettier-Check:** keine neuen Formatierungsverstoesse gegenueber Baseline (nur die eine umgebrochene `fakeConfig`-Zeile in `voice-render-action-url.test.js`).
- `node_modules`-Symlink nicht committet (gitignored); kein `git stash` verwendet (Lehre `stash-clobbered-by-worktrees` beachtet) — stattdessen isolierter `git-archive`-Snapshot fuer die Baseline-Messung. Gezielt nur die 15 betroffenen Dateien gestaged (kein `git add -A`). Kein Push, kein Deploy.

### Deviations (Abweichungen vom Plan)

1. **Zweite Testdatei-Anpassung ausserhalb Plan-Prognose:** Plan sagte "genau EINE Testdatei muss angepasst werden" voraus. In der Praxis brauchte es eine zweite: `test/telnyx-p9-flag-matrix.test.js` enthielt einen Quelltext-Wiring-Guard (`assert.match` gegen den woertlichen String `"config.voiceEngine === VOICE_ENGINE.REALTIME) return"` in `call-lifecycle.js`), der durch die mechanische Rename-Aenderung brach. Fix: Regex auf den neuen Zugriffspfad (`config\.voice\.voiceEngine ...`) nachgezogen, keine Verhaltens-/Assertion-Semantik-Aenderung. Der Plan hatte diese Kategorie (Source-Text-Assertion statt Werte-Assertion) nicht auf dem Radar, weil seine Dual-Read-Argumentation nur fuer Werte-Vergleiche gilt.
2. **Baseline-Ermittlung ohne Stash:** Statt In-Place-Baseline via `git stash` (im Worktree verboten, Lehre `stash-clobbered-by-worktrees`: `refs/stash` ist worktree-geteilt) wurde ein separater `git-archive`-Snapshot von master in einem Scratch-Verzeichnis gebaut und dort `npm test` gelaufen (2414/0), um die Baseline sauber und risikofrei zu ermitteln.

### Blast-Radius

- Code-Dateien mit Edits: 13.
- Ohne Edits trotz Scope: `render.js`, `ports.js` (nur Kommentar-Treffer).
- Test-Dateien mit Edits: 2 (`voice-render-action-url.test.js` geplant, `telnyx-p9-flag-matrix.test.js` Abweichung/Blast-Radius-Fund).
- Import-Aenderungen: 0. Neue Dateien: 0. Signatur-Aenderungen: 0. Neue Magic Numbers/Konstanten: 0.

---

## 4. Safety-Urteil (final)

**approved: true**

| Kriterium | Ergebnis |
|---|---|
| testsPassIndependently | true |
| safetyGatesIntact | true |
| disclosureIntact | true |
| authFailClosedIntact | true |
| noSecretsLeaked | true |
| scopeRespected | true |
| behaviorAsIntended | true |
| blockers | keine |

**independentTestSummary:** Kanonische json-Suite (direkter `node --test`-Runner): 2414 Tests, 2414 pass, 0 fail, EXIT=0 (ein einmaliges `EXIT=194`-Artefakt des npm-Wrappers mit leerem Output beim Direktlauf sauber gruen reproduziert). Forced global `STORE_BACKEND=pg` ueber die Voll-Suite: 2137 Tests, 2101 pass, 36 fail — Fehlerset Byte-fuer-Byte identisch zum master-Baseline (detached Worktree auf `544dbfe`, gleiches Env), also vorbestehendes Test-Architektur-Artefakt (BASE_ENV pinnt json-Fixtures; globaler pg-Override ist nicht der projekteigene pg-Testpfad), keine Regression. Ziel-Tests (bridge-event/openai/hardening, max-duration-pure/rearm/live-cap, disclosure-outbound/regression, config-namespaces, telnyx-p9-flag-matrix inkl. PA-1-Wiring, voice-render-action-url): 72 Tests, 72 pass, 0 fail. `node --check` auf allen 13 geaenderten src-Dateien: OK.

**Concerns (nicht blockierend):**
- Globales `STORE_BACKEND=pg` ueber die gesamte Suite erzeugt 36 identische (Anzahl+Dateiliste) Fehlschlaege wie auf master-Baseline — vorbestehendes Artefakt, PA-16 fuehrt 0 neue Fehler ein.
- `render.js` (Telnyx-Adapter, formal im Scope `src/telephony/adapters/*`) korrekt NICHT migriert, weil config-frei/pur (`elevenLabs` wird von der Registry als `config.telnyx.telnyxElevenLabs` injiziert).

**Verdict-Kurzfassung:** PA-16 ist eine rein mechanische Zugriffspfad-Migration exakt in der Spec-Oberflaeche, keine Logik-Aenderung. Alle ~30 Mappings gegen `CONFIG_NAMESPACES` verifiziert (inkl. korrekter Telnyx-Split `telephony` vs. `telnyx`). Flach-Zugriff-Gate: 0 Live-Flach-Zugriffe (14 Treffer allesamt in Kommentaren). Absolute Regeln erfuellt: Safety-Gates unveraendert (`maxCallDurationS`->safety, `fakeOriginate`->safety, `paymentEnabled`/`smsCostCents`->billing, `retentionDays`->privacy korrekt genamespaced und wertidentisch; `numberGateError`/`outbound-gates.js` ausserhalb Scope, unangetastet); `disclosureSentence`-Body byte-identisch; Auth/Signatur fail-closed (`signature.js` nicht beruehrt, `twilio/client.js` nur SID/Token/Edge-Zugriffspfad, keine `safeEqual`-Aenderung); keine neuen Secret-Logs/Response-Leaks, Audio weiterhin nicht durch MCP. `bridge.js`: exakt 3 Zugriffspfad-Hunks, hangup/barge-in/call-ende/finalize byte-identisch. Scope: 13 src + 2 test, keine Extras, keine package.json/lock-Aenderung, keine neue Dependency. Kein Deploy/Push. **Merge freigegeben.**

---

## 5. Clean-Code-Audit (final)

| Kategorie | Befunde |
|---|---|
| S1 (Blocker) | keine |
| S2 | keine |
| S3 | 1 gebuendelter Fund (siehe unten) |
| S4 | keine |
| **blocker** | **false** |
| **verdict** | **PASS** |

### S3 (nicht blockierend, gebuendelt)

**C2 · mehrere Dateien:** Kommentare zitieren noch den alten Flach-Pfad, obwohl der danebenstehende Code jetzt den Namespace-Pfad liest (Doku-Drift, nicht falsch, aber inkonsistent zum Codestand). Belege:
- `src/bridge.js:172` (`config.realtimeVoice`)
- `src/claude.js:373` (`config.callerSubstanceMinLen`)
- `src/store/json.js:171/196/432` (`config.profilesSeed`/`config.ownerNumberSeed`/`config.ownerName`)
- `src/store/pg.js:408` (`config.retentionDays`)
- `src/telephony/adapters/telnyx/numbers.js:3` (`config.maxNumbers`)
- `src/telephony/adapters/telnyx/voice.js:160` (`config.telnyxAccountSid`)
- `src/telephony/provisioning-geo.js:14/17/65` (`config.numberSetupFeeCents`)
- `src/telephony/registry.js:33/81` (`config.fakeOriginate`/`config.telnyxElevenLabs`)
- `src/telephony/voice-render.js:2/34/53` (`config.publicUrl`/`config.sttSpeechTimeoutSec`)
- `src/telephony/call-finish.js:77/97` (`config.ownerNumber`/`config.smsCostCents`)

Fix (empfohlen, nicht blockierend): bei Gelegenheit (z.B. naechste Politur-Phase) die Pfad-Nennung in diesen Kommentaren auf `config.<ns>.<key>` nachziehen oder ganz streichen, wenn sie nichts Neues gegenueber dem Code liefert. Alle Fundstellen waren bereits VOR PA-16 im Kommentar so vorhanden (unveraendert im Diff) — reine Doku-Nacharbeit, kein neu eingefuehrter Fehler.

### Verdict (Volltext)

PASS. PA-16 ist eine rein mechanische Fortsetzung der PA-12-Namespace-Migration ueber 13 Quelldateien plus 2 begleitende Test-Anpassungen. Jede der ~35 umgestellten Zugriffsstellen wurde gegen die in `src/config.js` (master, Commit `0a422e9` PA-12) definierte `CONFIG_NAMESPACES`-Tabelle geprueft — alle Namespace/Key-Kombinationen stimmen exakt (keine Tippfehler, keine falsche Gruppe, safety-kritische Keys wie `maxCallDurationS`/`fakeOriginate`/`paymentEnabled`/`telnyxApiKey`/`telnyxAccountSid` landen korrekt in `safety`/`billing`/`telephony`). Grep ueber alle 13 Dateien zeigt: kein uebersehener Flach-Zugriff im Code (nur Kommentare/Imports referenzieren noch den alten Namen). `node --check` auf allen 13 Dateien sauber; die volle Suite laeuft auf dem Phase-Branch gruen durch (2414/2414, 0 Fails). Die zwei Testaktualisierungen sind praezise auf den neuen Zugriffspfad zugeschnitten, keine Aufweichung von Assertions. Kein S1 (keine Sicherheits-/Gate-Regression, Verhalten byte-identisch da nur Getter-Umleitung auf denselben `rawConfig`-Speicherort), kein S2 (keine neue Duplizierung — im Gegenteil, buendelt Zugriffe unter benannten Gruppen). Einziger Fund ist gebuendeltes S3 (stale Kommentar-Pfadnennungen, vorbestehend, nicht vom Diff neu eingefuehrt) — nicht blockierend.

**topTodos:**
1. Optional/nicht blockierend: die ~9 Kommentarstellen mit alter Flach-Pfad-Nennung in einer spaeteren Politur-Phase auf den Namespace-Pfad nachziehen oder streichen.
2. Kein weiterer Blocker — Phase kann wie vorgelegt gemergt werden.

---

## 6. Fix-Runden

Keine. Beide Reviews (Safety final, Clean-Code final) kamen ohne Blocker durch — kein S1/S2, kein Safety-Blocker. Es waren keine Fix-Runden noetig; die Phase wurde direkt approved/PASS.

---

## 7. Abnahme

telephony-Rest/store/bridge-Rest/claude.js namespaced; bridge-HEIKLE-Bloecke Zeile-fuer-Zeile gegengelesen (nur Z.283 im Timer trug einen config-Zugriff, Logik unveraendert); Offenlegungssatz byte-identisch; struktureller Grep-Gate leer; zwei Test-Anpassungen (eine geplant, eine als dokumentierte Abweichung); Voll-Suite gruen (2414/2414); Flach-Alias bleibt fuer den Rest (PA-17/18) aktiv; kein Deploy/Push.
