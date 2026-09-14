# Phase IP2 — Hörprobe: welchen Sprechpfad Inbound wirklich nimmt

- **Gate:** PASS
- **finalBranch:** `phase/ip2-hoerprobe`
- **headCommit:** `65e2bb06cc09b6827dcba7e6f91989f951b52041`

## Kontext

Grundlage war `PLAN-INBOUND-PARITAET.md` §"Phase IP2" (autoritativ), §1.2 (W1–W4, B1–B13),
§2 (Leitentscheidung K1), §5 (Clean-Code-Auflagen), sowie `.claude/refs/clean-code.md`. Zum
Zeitpunkt der Phase waren IP1, IP3, IE2, IE3 und IE4 bereits gemerged; IP2 selbst existierte
noch nicht.

Wichtiger Codebefund vorab: Der Telnyx-ElevenLabs-Relay (`telnyx_relay`) ist seit IP3
(`c44367c`) aus `src/telephony/adapters/telnyx/render.js` entfernt — der aktuelle Renderer
kann diese TeXML-Form nicht mehr erzeugen. Die Klassifikationsfunktion behält den Token
trotzdem (Spec verlangt "alle drei TeXML-Formen" als Unit-Test-Fixtures); er ist nur über
den echten `/voice/incoming`-Weg nicht mehr erreichbar — das ist keine Abweichung von der
Phase, sondern der Ist-Zustand, den IP2 dokumentiert.

## Plan (gekürzt)

**Neue Dateien:**
- `scripts/inbound-hoerprobe.mjs` — CLI-Tool nach dem Muster von `scripts/stt-wer.mjs`
  (reine Funktionen exportiert + `if (process.argv[1] === fileURLToPath(...))`-Guard).
  Fährt einen echten `/voice/incoming`-Turn lokal gegen den echten Render-Weg, klassifiziert
  den gerenderten Sprechpfad (`play_tts` / `azure_say` / `telnyx_relay`) über drei benannte
  Regex-Matcher (`SPRECHPFAD_MATCHERS`, Priorität: `<Play>` vor `<Say voice="Azure.*">` vor
  `<Say voice="ElevenLabs.*">`), druckt den gesprochenen Text aus `store.calls[].transcript`
  (funktioniert identisch für alle drei Pfade), lädt bei `play_tts` die Audiodatei einmalig
  über die reale lokale Server-Adresse herunter, und macht bei
  `ELEVENLABS_PLAY_TTS_ENABLED=true` einen **echten** ElevenLabs-Synth-Call (Kosten!) — bewusst,
  das ist der Zweck des Werkzeugs. Secrets werden nur als `gesetzt`/`leer` geloggt, nie im
  Klartext. Latenz-Marken (`[metrics] ...`) werden aus dem mitgeschnittenen Server-stdout
  gefiltert; ein einzelner `/voice/incoming`-Turn löst kein `/voice/turn` aus, leere Liste ist
  Regelfall.
- `test/ip2-sprechpfad-klassifikation.test.js` — nicht in der ursprünglichen Betroffene-Dateien-
  Liste, aber von der Testpflicht zwingend gefordert. 4 Klassifikationsfälle (Play, Azure-Say,
  historische ElevenLabs-Say-Form als literaler TeXML-String, leeres Gather → `null`) + 1
  Integrationstest (Repo-Defaults → `azure_say`/Katja, Regressionsfang für IP3/IP4).

**Edits:**
- `test/helpers.js#seedWithTelnyxNumber` — additiver optionaler `{language}`-Parameter,
  byte-identisch für alle 13 Bestandsaufrufe ohne Argument (`JSON.stringify` lässt `undefined`
  weg). Damit pinnt die Hörprobe `language:"de"` statt vom ambienten
  `WORLD_DEFAULT_LANGUAGE_ENABLED`-Flag abzuhängen.
- `scripts/convo-bench/runner.mjs` + `report.mjs` — `direction` zusätzlich in `meta`,
  Summary-JSON und `fmtRow`-Tabellenzeile (BEW-1: Richtung direkt an der Zahl, nicht mehr
  stillschweigend als Aussage über den anderen Pfad lesbar). Kein Test nötig, da
  `scripts/convo-bench/*` nie Teil von `npm test` ist.
- `package.json` — neuer Skript-Eintrag `inbound:hoerprobe`.
- `knip.json` — neuer CLI-Entry für `scripts/inbound-hoerprobe.mjs` (sonst fälschlich als
  unbenutzt geflaggt).

**Prüfkriterien:** `node --check` auf allen vier berührten Dateien, `npm test -- --test-concurrency=4`
grün inkl. der 5 neuen Fälle, sowie ein manueller Smoke-Test (`npm run inbound:hoerprobe -- --out <dir>`)
mit erwarteter Ausgabe `sprechpfad=azure_say voice=Azure.de-DE-KatjaNeural` bei Repo-Defaults, und
`sprechpfad=play_tts` + reale Audiodatei bei aktivem Flag + echtem Key.

## Impl-Zusammenfassung

Exakt gemäß Plan umgesetzt:
- **Erstellt:** `scripts/inbound-hoerprobe.mjs`, `test/ip2-sprechpfad-klassifikation.test.js`
- **Editiert:** `test/helpers.js`, `scripts/convo-bench/runner.mjs`, `scripts/convo-bench/report.mjs`,
  `package.json`, `knip.json`
- **Tests hinzugefügt:** 5 neue Fälle in `test/ip2-sprechpfad-klassifikation.test.js`
  (4 Klassifikation + 1 Integration)
- **Testlauf:** 6021/6021 grün (finaler committeter Stand), `node --check` sauber auf allen
  vier geprüften Dateien
- **Smoke-Test:** dreimal gefahren, Ausgabe exakt wie spezifiziert: `sprechpfad=azure_say
  voice=Azure.de-DE-KatjaNeural`, Transkript mit Pflicht-Offenlegungssatz, kein `<Play>`,
  keine Latenz-Marken, Exit 0, keine verwaisten Prozesse.
- `npm run lint`: 0 Fehler, 68 Warnungen — byte-identisch zur master-Baseline (vor und nach
  den Änderungen gegengeprüft).

### Deviations (vom wörtlichen Plantext, beide durch harte Repo-Gates erzwungen)

1. **`scripts/convo-bench/runner.mjs`**: eine bestehende Zeile (searchFake-Ternary) wurde von
   3 auf 2 Zeilen zusammengefasst, damit `runScenarioRepeat` exakt bei ihrer bereits gepinnten
   Zeilenzahl (165) bleibt — erzwungen durch den Pflicht-Hook `check-staged-suppressions.js`,
   der sonst jede Änderung an dieser Datei ablehnt, weil die `max-lines-per-function`-Meldung
   die exakte Zeilenzahl trägt. Per eslint gegengeprüft: 0 Diffs in der unfilterten Befundmenge
   vor/nach. Verhalten unverändert.
2. **`scripts/inbound-hoerprobe.mjs`**: liest die ElevenLabs-Konfiguration nicht wie im
   Plantext über rohes `process.env`, sondern über `src/config.js`
   (`config.voice.elevenLabsPlayTts`, Muster `scripts/push-elevenlabs.mjs`) — roher
   `process.env`-Zugriff hätte 5 echte, nicht-suppressbare eslint-Fehler (G35) erzeugt; eine
   frühere Git-Historie zeigte, dass eine pauschale `scripts/**`-Ausnahme von G35 per Review
   bereits explizit zurückgenommen wurde, und eine neue Suppression für eine brandneue Datei
   ist technisch nicht committerbar (`check-staged-suppressions.js` scheitert fail-closed an
   `git show HEAD:<neue Datei>`). Verhalten/Ausgabe unverändert (Smoke-Test dreimal identisch).

## Safety-Urteil

**PASS / approved.** Wichtigste Invariante wörtlich eingehalten: kein einziges Byte unter
`src/` verändert (`git diff master..branch` bestätigt 0 Zeilen Diff in `claude.js`,
`bridge.js`, `route-policy.js`; keine neue Route, kein neuer Endpunkt, keine neue
Env-Variable, keine neue npm-Dependency). Safety-Gates (pro-Tenant-Kostendecke beidseitig,
Denylist/Land-Gate/Stundenlimit, Max-Dauer, Verifikations-Permit, `OUTBOUND_FROZEN`), der fest
verdrahtete Offenlegungssatz und die fail-closed-Auth-Kette (Ed25519 `/voice`,
`webAuthMw`/`adminMw`, `internalOnly`, MCP) sind strukturell unberührt.

Secret-Pfad adversarial geprüft: Skript reicht `ELEVENLABS_API_KEY` nur an den Kindprozess
durch, gibt ausschließlich `gesetzt`/`leer` aus; ein eingeschleuster Kanarienvogel-Wert
(`sk_SUPERSECRET_CANARY_123`) erschien in zwei Läufen (Fehl- und Erfolgspfad) 0 Mal in der
Ausgabe. Fail-safe belegt: Flag an + Anbieter unerreichbar → Werkzeug meldet ehrlich
`azure_say` (was tatsächlich gerendert wurde), nicht die Flag-Absicht. Unabhängiger Testlauf:
6021/6021 grün (nach Korrektur um 19 Datei-Wrapper aus rohen 6040), `npm run lint` 0 Fehler.

**Offene Concerns (keine Blocker):**
- Sachfremde 1-Zeilen-Umformatierung des `searchFake`-Ternary in `runner.mjs` (prettier will
  die master-Form zurück) — reiner Churn, sollte zurückgesetzt werden.
- `direction` wurde an jeder `fmtRow`-Zusammenfassungszeile + `summary.json` ergänzt, nicht in
  der Lauf-Kopfzeile (`scripts/convo-bench.mjs:164`) wie im Spec-Wortlaut — im Code begründet,
  deckt die BEW-1-Absicht nachweislich besser ab (ein Lauf kann Szenarien beider Richtungen
  mischen).
- Zwei neue Zeilen überschreiten `printWidth` 100 (`inbound-hoerprobe.mjs:168`,
  Testdatei:22) — kein Gate fängt das, aber neue Dateien sollten sauber sein.
- Das Skript macht bei aktivem Flag einen echten kostenpflichtigen ElevenLabs-Call — das ist
  ausdrücklich Zweck und im Kopfkommentar dokumentiert, kein Befund.

## Clean-Code-Audit (S1–S4)

- **S1:** keine Befunde
- **S2:** keine Befunde
- **S3:** ein Befund — `scripts/convo-bench/runner.mjs:299`: der `searchFake`-Ternary wurde
  von zwei Zeilen auf eine kollabiert, während der strukturell identische `call`-Ternary
  direkt darunter mehrzeilig bleibt (Inkonsistenz, vgl. G24). Empfehlung: auf die
  ursprüngliche mehrzeilige Form zurückformatieren oder beide Ternaries einheitlich behandeln
  — wirkt wie eine unbeabsichtigte Editor-Nebenwirkung, nicht Teil der IP2-Absicht.
- **S4:** keine Befunde
- **Verdict:** PASS (blocker: false). Alle Änderungen syntaktisch geprüft (`node --check`),
  neuer Testfall läuft grün (5/5 inkl. Integrationstest gegen den echten `/voice/incoming`-Pfad).

**Pass-Notes:** `seedWithTelnyxNumber({language})` additiv und byte-identisch für alle 13
Bestandsaufrufer (verifiziert per grep). Secrets-Regel eingehalten (nur `gesetzt`/`leer`
geloggt). Magic Numbers benannt (`HTTP_OK`, `CALL_SID`, `CLI_ARGS_OFFSET`). Funktionen klein,
Verschachtelung flach, ein Skript = eine Aufgabe. `classifySprechpfad` ist eine reine Funktion,
geteilt von Skript und Unit-Test (kein Duplikat). CLI-Skript selbst bewusst außerhalb von
`npm test` belassen (macht bei aktivem Flag einen echten kostenpflichtigen Call) — laut
CLAUDE.md/clean-code.md zulässig und dokumentiert. `knip.json`/`package.json`-Ergänzungen
konsistent mit Bestandsmuster, `npx knip` zeigt keine neuen Befunde.

**Top-Todo:** die kosmetische Ternary-Kollabierung in `scripts/convo-bench/runner.mjs:299`
rückgängig machen oder bewusst vereinheitlichen (reine Stilinkonsistenz, kein funktionaler
Fehler).

## Fix-Runden

Keine — die finale Bewertung (Safety PASS, Clean-Code PASS, blocker:false) wurde ohne weitere
Fix-Runde erreicht. Die verbliebenen kosmetischen Punkte (Ternary-Kollabierung, prettier-
Überläufe, `direction`-Platzierung) sind als offene, nicht-blockierende Concerns dokumentiert,
nicht behoben.
