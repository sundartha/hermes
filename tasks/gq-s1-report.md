# Phase GQ-S1 — Sonden: Turn-Herkunft + Inbound-Feldname

**Gate: PASS**
**finalBranch:** `phase/gq-s1-sonden`
**Basis:** `master` @ `544a0f2` (Arbeitsbaum clean)
**headCommit (Impl):** `24a2f8bddbd10b1d53a6fbf00d359a33446beb62`

---

## Plan (gekuerzt)

Rein additive Diagnose-Phase, **kein** Verhalten, **kein** Gate, **kein** Datenmodell, **keine** neue Dependency. Zwei Sonden:

### Entwurfsentscheidungen

- **E1** — Sonde A sitzt nach `watchdog.observeTurn`, nicht am rohen Handler-Eingang: nach Bearer-Gate/ccid-Gate/Call-Resolve (kein Log-Spam vor Auth), `call.id` statt `call_control_id` als Korrelationsschluessel (PII-Regel), `turnSeq` fuer Korrelierbarkeit mit `turn_ok`/`gate`. Restrisiko benannt: ein Telnyx-Retry auf ein 403 kaeme hier nicht an, hat aber eine eigene laute `gate`-Zeile.
- **E2** — Sonde A unconditional, ohne Flag/Env: Kardinalitaet = 1 Zeile je aufgeloestem Turn (wie bestehende `turn_ok`-Zeile), kein neues Config-/`.env.example`-/`BASE_ENV`-Risiko.
- **E3** — kein Wortlaut im Speicher, nur `{atMs, chars, hash}` je Call; "Vorgaenger ist Praefix" wird ueber Hash-Vergleich des gleich langen Anfangsstuecks geprueft.
- **E4** — Telnyx-Header nur als 8-Hex-SHA256-Hash, Allowlist-Praefix `x-telnyx-*`, `authorization` strukturell ausgeschlossen.
- **E5** — Sonde B loggt Body-Schluesselnamen nur im Defektfall (fehlendes Feld) — Erfolgsfall bleibt still.
- **E6** — Pre-Mortem-Tabelle: PII-Leak, Log-Flut, Messung ohne Aussagekraft, Verhaltensaenderung, Speicherleck — je mit Entschaerfung.

### Umsetzung (Skizze)

1. **Neue Datei `src/telnyx-turn-probe.js`**: `TURN_TEXT_RELATION` (`first`/`same`/`extends`/`other`), `makeTurnTextProbe()` als Fabrik (kein Modul-Zustand) mit `observeTurnText(callId, text)`, Fingerprint-Map mit 30-Min-Verfall, Fail-safe bei Nicht-String.
2. **`src/util.js`**: neue Funktion `hashText()` (additiv, ungesalzenes SHA256-Praefix, bewusst ohne Normalisierung im Unterschied zu `hashEmail`), Konstante `TEXT_HASH_LEN = 8`.
3. **`src/telnyx-llm-shim.js`**: Rollen-Allowlist entdoppelt (`boundedRole()` als eine Quelle fuer `roleCounts`/neues `lastMessageRole`), neue `logShimTurnProbe()`/`telnyxHeaderFingerprints()`/`requestOriginShape()`, eine `observeTurnText`-Instanz pro Shim-Fabrik, Sonde direkt nach `watchdog.observeTurn` im Handler — vor Loop-Guard/Rate/Budget.
4. **`src/telnyx-inbound.js`**: neue `inboundHandoffFallbackFinding(body)` (Feldname-Diff + `lookalikeFields`) und `logInboundHandoffFallback({callId, body})` — nur bei fehlendem `CallControlId`-Feld, nur Schluesselnamen.
5. **`src/routes/voice.js`**: Aufruf von `logInboundHandoffFallback` im bestehenden Null-Rueckfallzweig, Verhalten unveraendert.

### Tests (neu, Praefix `GQ-S1-n`, landet korrekt im Regressionslauf da kein Katalog-Praefix-Konflikt)

- `test/gq-s1-turn-origin-probe.test.js`: GQ-S1-1..8 — erster Turn/`first`, Kernabnahme `same`/`extends`/`other`, Call-Isolation, Grenzfaelle (`""`, `null`, Hash-Format), genau eine Log-Zeile ohne Klartext, zwei Handler-Laeufe -> `extends` + numerisches `gapMs`, Header-Hash-Vergleich, Positions-Pin (Zeile steht trotz `budgetExceeded`).
- `test/gq-s1-inbound-field-probe.test.js`: GQ-S1-9..12 — Gegenbeispiel (Feld vorhanden -> keine Zeile), Feldname+`lookalikeFields`, PII-Pin (keine Werte im Log), End-to-End-Serverspawn (Erfolg + Defektfall mit echtem stdout-Beleg).

### Deterministisch pruefbares Ergebnis (laut Plan)

`node --check` auf allen 5 Dateien fehlerfrei; `node --test` der 2 neuen Dateien -> 12/12 gruen; betroffene Bestandssuites unveraendert gruen; `npm test` gruen; `git diff --stat master` zeigt genau 7 Pfade (1 neu src, 4 geaendert src, 2 neu test), nichts an `config.js`/`.env.example`/`render.yaml`/`test/helpers.js`.

Rueckweg: ein `git revert`, kein Flag, keine Migration.

---

## Impl-Zusammenfassung

- **nodeCheckPass:** true
- **testsPass:** true — 3890/3890 gruen (0 fail)
- **committed:** true
- Dateien neu: `src/telnyx-turn-probe.js`, `test/gq-s1-turn-origin-probe.test.js`, `test/gq-s1-inbound-field-probe.test.js`
- Dateien geaendert: `src/util.js`, `src/telnyx-llm-shim.js`, `src/telnyx-inbound.js`, `src/routes/voice.js`
- Tests hinzugefuegt: GQ-S1-1..8 (Sonde A, inkl. Positions-Pin vor dem Budget-Gate), GQ-S1-9..12 (Sonde B, inkl. Spawn-Test mit Erfolgs- und Defektfall)
- Zusammenfassung laut Impl-Agent: exakt gemaess Plan umgesetzt, rein additiv, kein Verhalten/Gate/Datenmodell/Dependency geaendert. `git diff --stat` gegen master zeigt exakt die 7 geplanten Pfade.
- **cleanCodeSelfCheck:** G5 eingehalten (`roleCounts`/`lastMessageRole` teilen `boundedRole`), Magic-Number 8 als benannte `TEXT_HASH_LEN`-Konstante begruendet neben `EMAIL_HASH_LEN`, kein toter/auskommentierter Code, Nebeneffekte im Funktionsnamen, Fabrik statt Modul-/Lazy-Init-Zustand, Funktionen bleiben <=3 Argumente, Bestandstest `P5-1` bleibt unveraendert gruen als Aequivalenzbeleg fuer den `roleCounts`-Umbau.
- **smokePass:** true — kein separater manueller curl-Smoke noetig, da GQ-S1-12 und die unveraenderten `telnyx-p8-inbound.test.js`-Spawn-Tests den echten Server real durchlaufen (beide Faelle: Feld vorhanden/fehlt), inkl. der neuen `handoff_fallback`-Zeile im echten stdout.

### Deviations

Keine (`deviations: []`).

---

## Safety-Urteil (final)

**approved: true — PASS**

- testsPassIndependently: true, safetyGatesIntact: true, disclosureIntact: true, authFailClosedIntact: true, noSecretsLeaked: true, scopeRespected: true, behaviorAsIntended: true

### Unabhaengige Verifikation

Eigener Lauf im frischen Worktree (`review-gq-s1` = `24a2f8b`, master `544a0f2` ist Vorfahr, kein Stale-Base):

1. `npm test`: 3890/3890 gruen, 0 fail, 98,5 s, 0x "not ok". Alle 12 neuen Tests gruen.
2. `npm run test:gates`: haengt reproduzierbar bei `test/auth-p9a-cache-headers.test.js`. Gegenprobe: derselbe Hang existiert identisch auf `master` (544a0f2) — als **vorbestehend**, nicht der Phase zuzurechnen eingestuft. GQ-S1 aendert keine Katalogdatei, neue Tests tragen kein Katalog-Praefix.
3. Eigene Gegenproben: Aequivalenzskript alt/neu `roleCounts` ueber Grenzfaelle identisch; `makeTurnTextProbe` gegen `undefined`/`null`/`{}`/Array/Number/`""` kein Wurf, Relationen wie spezifiziert; `src/claude.js`/`src/bridge.js` byte-identisch master vs. HEAD; `git diff --stat` gegen alle sicherheitsrelevanten Dateien (Gates, Auth, Billing, Store, config.js, route-policy.js, `.env.example`, `render.yaml` etc.) leer. eslint im Worktree technisch nicht lauffaehig (Symlink-Problem, Umgebungsfehler, kein Befund).

### Regel-fuer-Regel

- **Regel 1 (Safety-Gates):** unberuehrt — Diff fasst keine Gate-Dateien an (per `--stat`+sha geprueft). Sonde A liest nur (nach `watchdog.observeTurn`, vor Loop-Guard/Rate/Budget), pinned durch GQ-S1-8. Sonde B sitzt im bestehenden Null-Zweig, Rueckgabe/Verhalten unveraendert (GQ-S1-12).
- **Regel 2 (Offenlegung):** `src/claude.js`/`src/bridge.js` byte-identisch zu master.
- **Regel 3 (Auth fail-closed):** keine neue Route, keine Aenderung an Auth-/Policy-Dateien, `route-auth-inventory`-Gate laeuft gruen mit.
- **Regel 4 (Secrets/PII):** `turn_probe`-Zeile enthaelt nur `callId`/`turnSeq`/`atMs`/`gapMs`/`chars`/`textHash`/`prevRelation`/`messagesCount`/`lastRole`/gehashte `x-telnyx-*`-Header — kein Wortlaut, keine E.164, `authorization` strukturell ausgeschlossen. `handoff_fallback`-Zeile nur sortierte Schluesselnamen. Tests GQ-S1-5/7/11 pinnen Abwesenheit von Klartext.
- **Regel 5 (Audio):** kein MCP-Pfad beruehrt.
- **Regel 6 (Scope):** nur GQ-S1; einziger Nicht-Log-Eingriff (`roleCounts`/`boundedRole`-Auszug) per Aequivalenzskript als verhaltensgleich belegt.

### Concerns (nicht blockierend, 6)

1. Header-Allowlist-Praefix `x-telnyx-` ist selbst geraten — kein Live-Beleg im Repo. Empfehlung vor Owner-Testanruf: alle Header-**Namen** loggen (Werte weiter nur gehasht), kostet nichts, entschaerft das Risiko einer leer laufenden Abnahme.
2. Ungesalzener 8-Hex-SHA256 von kurzen/entropiearmen Aeusserungen ist per Woerterbuch angreifbar — laut Spec so vorgegeben, kein Blocker; bei laengerer Lebensdauer der Sonde waere ein prozess-lokales Salt sinnvoll.
3. `turn_probe`-Zeile steht bewusst vor Loop-Guard/Rate/Budget — neue, unbegrenzte Log-Schreibquelle pro authentifiziertem Request (reine Log-Menge, keine Gate-Wirkung).
4. Beide Sonden haben keinen Ausschalter (kein Env-Flag) — fuer eine Messphase richtig, braucht aber einen Folgeschritt zum Entfernen nach der Messung.
5. Sonde A korreliert ueber interne `call.id` statt `callControlId`/`telnyx_conversation_id` — konsistent mit `turn_ok`/`gate`, aber Join gegen Telnyx-Objekte braucht Umweg ueber den Store.
6. `telnyxHeaders:{}` ist mehrdeutig (kein Header vs. kein Header mit passendem Praefix) — zusammen mit Punkt 1 moegliche Fehlinterpretation beim Ablesen des Testanrufs.

---

## Clean-Code-Audit (final)

- **s1:** keine Funde
- **s2:** keine Funde
- **s3 (2 Funde, kein Blocker):**
  - `src/telnyx-turn-probe.js:24` — Extra-Leerzeichen vor Kommentar in der `TURN_TEXT_RELATION.OTHER`-Zeile (rein kosmetisch, kein G16-Verstoss)
  - `src/telnyx-llm-shim.js:407-414` (`requestOriginShape`) — buendelt `messagesArray()` und `telnyxHeaderFingerprints()` in einem Schritt (G34-Grenzfall), vertretbar da beide Aufrufe reine Ein-Zeiler sind und die Buendelung den Aufrufer entlastet
- **s4:** keine Funde
- **blocker:** false

**Verdict:** PASS. Saubere Trennung reiner Logik von IO, konsequente PII-Vermeidung (nur Laengen/Hashes/Keynamen), vollstaendige gruene Testabdeckung. `hashText()` ist echte Erweiterung, kein Duplikat von `hashEmail`/`maskNumber` (begruendeter Unterschied: keine Normalisierung). Erfolgsfall byte-identisch. Keine Sicherheits-, Test- oder Duplizierungsverstoesse.

**passNotes:** P4/P15 sauber (Fabrik statt Modulzustand, eine Instanz pro Shim injiziert, kein Lazy-Init). G5/S2: `KNOWN_MESSAGE_ROLES`+`boundedRole()` als eine Quelle statt Duplikat-if-Ketten. G25: alle Magic-Strings/-Zahlen benannt. G3/Grenzfaelle getestet (`null`/`undefined`). Sicherheits-Kommentare durch Tests tatsaechlich verifiziert, nicht nur behauptet. Kein Modul-Level-Timer (`dropExpired()` laeuft additiv beim naechsten Aufruf). `voice.js`-Aenderung minimal-invasiv, kein Verhaltenswechsel. 24 Tests (12 neu + 12 bestehende Shim-Tests) gruen, `node --check` auf allen 5 Dateien fehlerfrei.

**topTodos:**
1. Kein Blocker offen — Sonden sind mergefaehig.
2. Optional: Extra-Leerzeichen in `TURN_TEXT_RELATION.OTHER` (`telnyx-turn-probe.js:24`) beim naechsten Touch mitziehen.
3. Betriebshinweis (kein Clean-Code-Befund): beide Sonden erzeugen neuen `console.log`/`warn`-Output je Turn/Fallback — Log-Volumen nach Deploy kurz gegenpruefen.

---

## Fix-Runden

Keine — der Impl-Stand ging ohne Fix-Runde durch beide Reviews (Safety PASS, Clean-Code PASS bei der ersten Pruefung).
