# Phase PA-12 — Config-Namespace-Shim (13 Namespaces als Getter, dual-read)

- **Gate:** PASS
- **finalBranch:** `phase/polish-a-p12`
- **headCommit:** `0a422e98459bf61cf10128712c25d3c233748b86`
- **Charakter:** rein additive, verhaltens-erhaltende zweite Zugriffs-Oberflaeche auf `config` — kein S1, kein "rot-vor-Fix" noetig.

## Plan (gekuerzt)

Ziel: eine **zweite, verschachtelte** Zugriffs-Oberflaeche `config.<namespace>.<key>` fuer alle 99 Flach-Keys von `src/config.js`, **zusaetzlich** zum bestehenden Flach-Alias (`config.<key>` bleibt unveraendert erhalten). Autoritative Quelle: `PLAN-POLISH-A.md` Abschnitt PA-12 + OQ-3/OQ-4/OQ-6 + PM-1. Der Shim-Mechanismus wurde vor der Umsetzung in einem Prototyp gegen eine echte Kopie von `master:src/config.js` ausgefuehrt und alle Ergebnisse waren gruen.

### Kernbefund aus dem Prototyp (die zentrale Falle)

Der bestehende `guardedConfig`-Proxy liefert fuer Objektwerte pro Zugriff eine **frische Wrapper-Proxy** (bewusst ohne Memoisierung). Haengt man eine Namespace-Gruppe als *non-configurable* Data-Property an `rawConfig`, verletzt das die ECMAScript-Proxy-`[[Get]]`-Invariante (der Trap muss bei einer non-writable+non-configurable Data-Property den *exakten* Zielwert liefern) → **`TypeError` beim ersten `config.safety`-Zugriff**.

**Pflicht-Konsequenz:** Die Namespace-Property MUSS `configurable: true` sein. Empirisch bestaetigt: mit `configurable: true` laufen alle 99 Alias-Gleichheiten, die PM-1-Overrides, JSON/await-Duck-Typing und der No-double-eval-Check gruen. Das ist die wichtigste, nicht-offensichtliche Design-Vorgabe der Phase und steht so im Code-Kommentar.

### Bindende Entscheidungen (aus OQ/PM)

- **OQ-4:** EIN Getter-Shim, alle 13 Namespaces auf einmal (kein Cluster-Slicing).
- **OQ-6:** `elevenLabsPlayTts` bleibt eigenstaendiges nested Objekt **innerhalb** `voice` (`config.voice.elevenLabsPlayTts.<key>`) — nicht in `voice`-Blaetter aufgeloest.
- **PM-1 (HART):** Blaetter sind **Getter auf `rawConfig[flatKey]`** — kein zweiter `numEnv`/`boolEnv`, keine Wert-Kopie. Ein Flach-Override (`Object.assign(config, …)`) schlaegt durch, weil der Proxy keinen `set`-Trap hat → `rawConfig[key]` wird geschrieben → der Getter liest live denselben Speicher.
- Leaf-Namen == Flach-Key-Namen (identisch); Migration ab PA-13 ist dadurch mechanisch "`<ns>.` voranstellen".
- `numEnv`/`boolEnv` bleiben eager beim Modul-Import; die Getter lesen nur den fertigen Wert.
- Kein Importeur geaendert, keine neue Env-Var, kein Env-Name geaendert.

### Die 13-Namespace-Karte (99 Flach-Keys, disjunkt)

| Namespace | Count | Schwerpunkt |
|---|---|---|
| safety | 10 | Allowlist/Denylist, Rate-/Call-Limits, Signaturpruefung |
| billing | 15 | Budget, Stripe, Tarife, SMS-Kosten |
| provisioning | 11 | Nummern-Kauf/-Freigabe, Geo |
| auth | 15 | MCP-/OIDC-/Session-Auth, Admin |
| llm | 11 | Anthropic/Claude, Retry/Breaker, Preise |
| telnyx | 2 | `telnyxElevenLabs`, `telnyxAssistant` (nested) |
| voice | 10 | Engine, Realtime, ElevenLabs (nested), STT/SMS-Summary |
| telephony | 8 | Twilio/Telnyx Grunddaten |
| tenancy | 5 | Multi-Tenant-/Feature-Flags |
| server | 7 | Port, URLs, Verzeichnisse, Shutdown |
| store | 3 | Backend, DB-URL, Queue |
| metrics | 1 | `metricsEnabled` |
| privacy | 1 | `retentionDays` |

Sechs Platzierungen sind count-konsistent, aber semantisch diskutabel und wurden als PA-12-neutral markiert (Flach-Alias bleibt in jedem Fall erhalten, Umbuchung ist spaeter ein Ein-Zeilen-Edit): `rateLimitPerMin`/`reserveReleaseGraceMs` → safety, `shutdownDrainTimeoutMs` → server, `sendSmsSummary`/`dailySmsCap` → voice, `mcpUiEnabled`/`assistantContextEnabled`/`profilesSeed` → tenancy.

### Edit an `src/config.js` (exakt, ein Insert)

Unmittelbar vor `export const config = guardedConfig(rawConfig);`:

1. `export const CONFIG_NAMESPACES = Object.freeze({...})` — die 13-Namespace-Karte als Objekt-Literal aus Key-String-Arrays.
2. `attachNamespaces(target, namespaces)` — haengt jede Gruppe als **nicht-enumerable, `configurable: true`** Property an `target` (mutiert `target`); jedes Blatt ist ein **enumerable Getter** `() => target[key]` (Live-Referenz, keine Kopie).
3. Aufruf `attachNamespaces(rawConfig, CONFIG_NAMESPACES)` **vor** `guardedConfig(rawConfig)` — die Gruppen werden dadurch vom bestehenden rekursiven `guardedConfig`-Proxy automatisch mit umschlossen (DRY, kein Zweit-Proxy noetig; erbt `then`/`toJSON`-Ausnahme und TypeError-Guard).

Keine weiteren Aenderungen in `config.js` (Boot-Gates, `assertConfig`, `productionFootguns`, `numEnv`/`boolEnv` bleiben byte-identisch).

### Neue Testdatei `test/config-namespaces.test.js` (6 Tests, geplant)

1. Struktur/Vollstaendigkeit — 13 Counts, disjunkte Union == exakt die 99 Flach-Keys.
2. Default-Alias-Gleichheit fuer alle 99 Keys (`deepEqual` fuer die 3 nested Objekt-Keys wegen frischer Proxy-Huellen, sonst `strictEqual`).
3. PM-1-Override-Durchschlag — fuer alle 93 primitiven Blaetter: Flach-Override via `withConfigOverrides` schlaegt auf `config.<ns>.<key>` durch, inkl. Restore-Assertion.
4. No-double-eval-Regression — Fresh-Import mit ungueltigem `MAX_CALLS_PER_HOUR`, Fatal-Count vor/nach Namespace-Beruehrung identisch.
5. Duck-Typing + Guard auf den neuen Gruppen — `JSON.stringify`/`await` funktionieren, unbekannter Key wirft `TypeError`, `elevenLabsPlayTts`-Nested-Konsistenz.
6. Flach-Oberflaeche unveraendert — `Object.keys(config).length === 99`, Namespaces nicht in `Object.keys(config)`, aber `ns in config === true`.

### Blast-Radius (bewusst NICHT geaendert)

- `test/helpers.js` — keine neue Env-Var, kein Env-Name geaendert, `makeConfigOverrides`/`withConfigOverrides` arbeiten unveraendert.
- `test/config-shape.test.js` — bleibt gueltig (Namespaces sind non-enumerable, nicht serialisiert); neue PA-12-Assertions leben in der neuen Datei (SRP).
- `test/config-money-manifest.test.js` — `Object.keys(config)` bleibt 99, keine Namespace-Namen matchen die Geld-Suffix-Regex.

### Pre-Mortem (zusaetzlich zu PM-1)

- Proxy-`[[Get]]`-Invariante (kritisch) → `configurable: true` Pflicht, sonst `TypeError` beim ersten Namespace-Zugriff.
- `===` auf Nested-Objekt-Keys ist `false` (frische Proxy-Huellen) → Test 2 nutzt `deepEqual` fuer die 3 Nested-Keys.
- Enumerable-Fehlgriff wuerde `JSON.stringify(config)`/`Object.keys(config)` verdoppeln (Geld-Manifest-Scan betroffen) → `enumerable: false` + Test 6.
- Karten-Drift (vergessener/doppelter Key) wuerde durch den Flach-Alias verdeckt → Test 1 erzwingt disjunkte Union == exakt 99.

## Impl-Zusammenfassung

PA-12 exakt gemaess Plan umgesetzt. Branch `phase/polish-a-p12` von `master` (`9222e19`, lokaler Branch-Ref, PA-11-Stand) im isolierten Worktree.

Ein Insert in `src/config.js` unmittelbar vor `export const config = guardedConfig(rawConfig);`: `CONFIG_NAMESPACES` (13 Namespaces, exakt die 99 Flach-Keys, disjunkt, per Skript gegen den echten `rawConfig` verifiziert) + `attachNamespaces(target, namespaces)`, das jede Gruppe als nicht-enumerable, `configurable: true` Property mit enumerable Getter-Blaettern anhaengt (Getter auf denselben `rawConfig`-Speicherort, PM-1 erfuellt). Kein zweiter `numEnv`/`boolEnv`-Aufruf, kein Importeur geaendert, Flach-Alias/Enumeration byte-identisch (`Object.keys(config).length` weiterhin 99).

Neue Testdatei `test/config-namespaces.test.js` mit genau 6 Tests (Struktur/Vollstaendigkeit, Default-Alias-Gleichheit fuer alle 99 Keys, PM-1-Override-Durchschlag ueber alle 93 primitiven Blaetter inkl. Restore-Assertion, No-double-eval-Regression via Fresh-Import mit Query-String-Cache-Buster, Duck-Typing+Guard auf den neuen Gruppen inkl. `elevenLabsPlayTts`-Nested-Konsistenz, Flach-Oberflaeche unveraendert). `node --test test/config-namespaces.test.js` liefert exakt `# pass 6 / # fail 0` wie im Plan Abschnitt 7 gepinnt.

**Ergebnis:** volle Suite (`npm test`, deckt json- UND pglite-Backend in einem Lauf ab) 2408/0. `node --check` auf beiden Dateien sauber. Boot-Smoke: Server mit `SKIP_TWILIO_SIGNATURE_CHECK=true` + Dummy-Env + `OWNER_NUMBER_SEED` gestartet, `/healthz` → 200 `{"ok":true}`. Blast-Radius exakt 2 Dateien (`src/config.js`, `test/config-namespaces.test.js`), kein anderer Importeur beruehrt (per grep bestaetigt). `node_modules`-Symlink nicht committet (gitignored). Kein Push (weder `origin` noch `upstream`), reine Repo-Arbeit im Worktree.

**filesCreated:**
- `test/config-namespaces.test.js`

**filesEdited:**
- `src/config.js`

**testsAddedOrChanged:**
- `test/config-namespaces.test.js`: 6 neue Tests (Struktur/Disjunktheit, Default-Alias-Gleichheit x99, PM-1-Override-Durchschlag x93, No-double-eval-Regression, Duck-Typing+Guard, Flach-Oberflaeche unveraendert)

**cleanCodeSelfCheck (Impl):** G5/Duplizierung — eine Kartenquelle `CONFIG_NAMESPACES`, eine `attachNamespaces`-Schleife, Wiederverwendung von `guardedConfig` statt Zweit-Proxy; Test importiert die Karte statt sie zu duplizieren. G25/Magic — keine Magic Numbers in `src/config.js`; Sentinel `12345` lebt im Test (Datenmodell fuer Override-Beweis). C5/G9 — kein toter/auskommentierter Code. G12 — keine ungenutzten Imports. N7 — `attachNamespaces` (Verb, Kommentar nennt "mutiert target"). F1 — `attachNamespaces(target, namespaces)` = 2 Argumente. G30/G34 — `attachNamespaces` macht genau eine Sache. C2 — keine brittle Datei:Zeile-Kommentare. Kommentare deutsch ohne Umlaute (per grep verifiziert, 0 Treffer). ESM, kein Build-Step, kein TypeScript. P11/T-Serie — neues Verhalten hat 6 automatisierte Tests; die 8 Bestand-`config-*.test.js` liefen unveraendert gruen. Absolute Regeln: keine Safety-Gate-/Disclosure-/Auth-Aenderung, keine Secrets geloggt/exponiert, kein neuer Endpunkt, kein Deploy/Push, keine neue npm-Dependency.

### Deviations

1. Plan schrieb "Sechs Tests" mit Test 1 = "Struktur/Vollstaendigkeit" als EINE beschriebene Pruefung; ein erster Entwurf splittete das versehentlich in zwei `test()`-Aufrufe (7 statt 6 Tests). Vor dem finalen Testlauf zu EINEM `test()` gemerged, damit `node --test test/config-namespaces.test.js` exakt das in Plan Abschnitt 7 deterministisch gepinnte `# pass 6` liefert — keine Abweichung im committeten Endstand.
2. Branch-Basis: `git checkout -b phase/polish-a-p12 master` nutzte den lokalen Branch-Ref `master` (`9222e19`, PA-11-Stand, wie im Plan als Basis genannt), NICHT den HEAD des Worktrees beim Start (`776760e`, ein divergenter spaeterer clean-code-Stand ohne PA-11). Das entspricht wortgetreu Vorgehen-Schritt 2 und dem im Plan-Header genannten Basis-Commit `9222e19`; explizit dokumentiert, falls der Lead einen anderen Merge-Zielpunkt erwartet.

### Smoke-Test

`PORT=3999 SKIP_TWILIO_SIGNATURE_CHECK=true ANTHROPIC_API_KEY=x TWILIO_ACCOUNT_SID=x TWILIO_AUTH_TOKEN=x PUBLIC_URL=http://localhost:3999 DATA_DIR=<temp> OWNER_NUMBER_SEED=+15005550006 OWNER_NUMBER_PROVIDER=twilio npm start`; `curl localhost:3999/healthz` → 200 `{"ok":true}`. `OWNER_NUMBER_SEED` war noetig, weil der Boot-Guard fail-closed eine aktive Owner-Nummer im Store verlangt (unabhaengig von PA-12, Bestandsverhalten) — im Plan nicht explizit genannt, aber dieselbe Env-Var wie in `test/helpers.js` (`OWNER_TEST_NUMBER`) verwendet.

## Safety-Urteil (final)

**approved:** true
**verdict:** APPROVED

- testsPassIndependently: true
- safetyGatesIntact: true
- disclosureIntact: true
- authFailClosedIntact: true
- noSecretsLeaked: true
- behaviorAsIntended: true
- scopeRespected: true
- blockers: keine

**Begruendung:** PA-12 ist eine praezise, rein additive Config-Namespace-Shim: genau `src/config.js` (+44) + neuer Unit-Test, kein Importeur/keine Dependency/keine Auth-/Gate-/Disclosure-Datei angefasst. Alle bindenden Zusatz-Invarianten verifiziert — PM-1 (Getter auf denselben `rawConfig`-Speicherort, keine Wert-Kopie/kein zweiter `numEnv`/`boolEnv`), eager `numEnv`/`boolEnv` ohne Doppel-Eval, Duck-Typing via rekursiven `guardedConfig`-Proxy (JSON.stringify/await funktionieren), TypeError-Guard fuer unbekannte Keys auf beiden Oberflaechen, non-enumerable Namespaces halten Flach-Enumeration/`JSON.stringify(config)` byte-identisch, OQ-3-Karte exakt inkl. Grenzfaelle, OQ-4 EIN Shim/13 auf einmal, OQ-6 `elevenLabsPlayTts` eigenstaendig. Safety-Gates, Disclosure (`claude.js`+`bridge.js`), Auth fail-closed und Secrets alle unveraendert. Unabhaengige Tests komplett gruen (2408/0), Boot `/healthz`=200. Scope strikt eingehalten, keine ungefragten Extras, kein neues npm-Dep.

**Concerns (kein Blocker):**
1. `JSON.stringify(config.<ns>)` serialisiert Secret-Blaetter (z.B. `stripeSecretKey` unter `billing`). Unveraendert gegenueber dem Bestand (das enumerable Flach-`config` serialisierte diese Keys schon), PA-12 fuegt kein neues Leak hinzu (Namespaces non-enumerable → `JSON.stringify(config)` byte-identisch; kein Code loggt/responded `config`). Nur als kuenftiger Hinweis, falls je ein Namespace direkt geloggt wuerde.
2. Der Begriff "flag-off byte-identisch" hat hier keinen echten Laufzeit-Flag: der Shim ist immer aktiv. Byte-Identitaet wird stattdessen ueber non-enumerable Properties + unveraenderte Flach-Keys + keinen geaenderten Importeur erreicht und ist per Test bewiesen.

**independentTestSummary:** Frischer Worktree, `node_modules` symverlinkt, `review-pa-12` von `phase/polish-a-p12`. Voll-Suite (`NODE_ENV=test node --test test/*.test.js`): 2408 pass / 0 fail / 0 skipped, 74s — deckt json UND pg (pglite) via `store-backend-parity` + `*-pg.test.js` ab (alle gruen). PA-12-Test isoliert: 6/6 gruen. Boot-Smoke: `/healthz`=200 `{ok:true}`, Boot-Banner mit aktiven Gates; Boot fail-closed bei fehlendem Pflicht-Env bestaetigt. `node --check src/config.js` OK.

## Clean-Code-Audit (final)

**verdict:** PASS (blocker: false)

**S1:** keine

**S2:** keine

**S3:**
- PA12-S3-1 · `src/config.js` (`CONFIG_NAMESPACES`-Literal, ~Zeile 785-798) · Jede der 13 Namespace-Zeilen listet alle Keys in einer einzigen sehr langen Zeile (bis 358 Zeichen) — erschwert Diff-Review/Scanning · Fix (kosmetisch, kein Verhaltensrisiko): ein Key pro Zeile oder mehrzeilig umbrechen.
- PA12-S3-2 · `src/config.js` (`Object.freeze(CONFIG_NAMESPACES)`) · `Object.freeze` ist nur shallow — die 13 Key-Arrays selbst bleiben zur Laufzeit mutierbar (z.B. `CONFIG_NAMESPACES.safety.push(...)` wuerfe keinen Fehler) · Fix (optional, niedrige Prioritaet): Arrays einzeln zusaetzlich freezen, falls volle Immutabilitaet gewuenscht ist.
- PA12-S3-3 (Design-Hinweis, bewusst akzeptiert) · `src/config.js` `CONFIG_NAMESPACES` vs. `rawConfig`-Objektliteral · Alle 99 Flach-Keys werden als String-Literal ein zweites Mal in `CONFIG_NAMESPACES` genannt (Namens-/Manifest-Duplizierung, keine Logik-Duplizierung) · Nicht als S2 gewertet: Test 1 (`config-namespaces.test.js`) prueft hart auf Disjunktheit + exakte Deckungsgleichheit mit der Flach-Oberflaeche, jede Abweichung (Typo, vergessener/verschobener Key) schlaegt sofort und laut fehl — kein stiller Blast-Radius. Langfristig (PA-13-Migration, laut Code-Kommentar bereits vorgesehen) waere eine Struktur-Loesung (Namespace-Zuordnung direkt an der `rawConfig`-Deklarationsstelle) staerker als die Test-Absicherung (vgl. G27).

**S4:** keine

**Begruendung:** Der Diff (nur `src/config.js` + `test/config-namespaces.test.js`, +197/-0) fuegt einen additiven, nicht-invasiven Config-Namespace-Shim hinzu: 13 Namespaces als nicht-enumerable Getter-Gruppen ueber denselben `rawConfig`-Speicherort (kein Wert-Kopie-Getter, kein zweiter `numEnv`/`boolEnv`-Aufruf). Die kritische Proxy-Invariante (`configurable: true` auf Namespace-Ebene, um `TypeError` bei `config.<ns>`-Zugriff zu vermeiden) ist korrekt begruendet und per Test empirisch verifiziert. Flach-Oberflaeche (`Object.keys`/`JSON.stringify`) bleibt byte-identisch (Test-belegt), kein Doppel-Eval bei ungueltigen Env-Werten (Test-belegt), Duck-Typing/Guard-Verhalten (throw bei unbekanntem Key, `JSON.stringify`/`await` auf Gruppen) bleibt erhalten. Volle Suite gruen: 2408/2408, inkl. 6 neuer gezielter Tests fuer genau dieses Feature. `node --check` sauber. Keine Safety-Gates/Auth/Secrets/Money-Logik beruehrt, kein `eslint-disable`/skip/toter/auskommentierter Code, Kommentarstil (Deutsch ohne Umlaute, dichte Warum-Kommentare) konsistent zum Bestand. Einzige nennenswerte Beobachtung ist eine bewusste, test-abgesicherte Manifest-Duplizierung der 99 Key-Namen als Uebergangsloesung vor der geplanten PA-13-Migration (siehe S3-3) — nicht blockierend.

**passNotes:** (1) Reihenfolge korrekt — `attachNamespaces(rawConfig, ...)` laeuft VOR `export const config = guardedConfig(rawConfig)`, sodass die Namespace-Properties beim Proxy-Aufbau bereits existieren. (2) Die `configurable: true`-Begruendung fuer die Proxy-`[[Get]]`-Invariante ist technisch korrekt und durch Tests (`config.safety`, `config.telnyx.telnyxAssistant.enabled` funktionieren) empirisch bestaetigt. (3) Getter sind Live-Referenzen auf `rawConfig` (keine Kopie) — durch dedizierten PM-1-Test fuer alle 93 primitiven Blaetter verifiziert, inkl. Restore-Check. (4) Non-enumerable Attachment haelt `Object.keys(config)`/`JSON.stringify(config)` unveraendert — verifiziert. (5) Kein Secret-Leak: `CONFIG_NAMESPACES` listet nur Property-Namen (z.B. `stripeSecretKey`), keine Werte, und diese Namen standen bereits als Objektliteral-Keys im Bestand. (6) Test-Datei nutzt bestehende Helper (`makeConfigOverrides` aus `test/helpers.js`) statt eigener Save-Restore-Logik, und den bereits etablierten dynamic-import-Cache-Buster-Pattern (`?query`) wie in `config-boolenv.test.js` — keine neue Duplizierung, folgt Projektkonvention. (7) Scope strikt eingehalten (nur additive Getter-Schicht, keine Aenderung an den bestehenden 774 Zeilen `rawConfig`-Aufbau).

**topTodos:**
- Optional vor/in PA-13: die Namespace-Zuordnung langfristig an der `rawConfig`-Deklarationsstelle selbst verankern statt in einem separaten `CONFIG_NAMESPACES`-Manifest zu pflegen, um die Zweit-Quelle der 99 Key-Namen strukturell (nicht nur testgestuetzt) aufzuloesen.
- Kosmetisch: sehr lange Einzeiler in `CONFIG_NAMESPACES` (bis 358 Zeichen) bei Gelegenheit auf ein-Key-pro-Zeile umbrechen fuer besseres Diff-Review.
- Optional: `CONFIG_NAMESPACES`-Arrays selbst per `Object.freeze` schuetzen, falls die Absicht "vollstaendig unveraenderlich" ueber die Top-Level-Freeze hinaus gelten soll.

## Fix-Runden

Keine — Safety und Clean-Code beide im ersten Durchlauf PASS/APPROVED, keine Blocker, keine Fix-Runde noetig.
