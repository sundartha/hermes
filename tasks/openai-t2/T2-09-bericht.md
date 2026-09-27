# T2-09 — Geldpfad: neutrale Fehlertexte an der MCP-Grenze — Abschlussbericht

Branch `phase/openai-t2-09-neutral-error-texts`, HEAD `9dce780` (davor `6246f13`), Basis `fd9cf28`
(gemergte Vorphasen T2-01..T2-08+T2-23, master `33d7f80`). Umfang: O-13, O-20.

## 1. Was diese Phase NICHT erfuellt

- **Review-Status ist FAIL, nicht PASS.** Zuletzt gemessen: `{"safety":"PASS","cleancode":"FAIL"}`
  mit einem offenen Blocker (cleancode) und einem offenen "wichtig"-Befund (safety). Beide drehen
  sich um denselben Punkt: `test/mcp-tools-i18n.test.js:111` (`MCP-05`) kippt durch diese Phase von
  immer-gruen zu abhaengig von `WORLD_DEFAULT_LANGUAGE_ENABLED` (Beleg unten). Der Cleancode-Blocker
  fordert einen Code-/Test-Fix (den Test unabhaengig vom Flag machen); dieser Fix ist NICHT gebaut,
  nur in `PLAN-SECURITY.md` als "kein Code-Fix in dieser Phase, Owner-Punkt" dokumentiert.
  **Damit ist die Phase nach dem eigenen Zwei-Reviewer-Schema noch nicht abnahmefaehig.**

- **Aber: die Tatsachenbehauptung hinter dem Blocker ist teilweise falsch, und das aendert die
  Einordnung des Befunds erheblich.** Ich habe nachgemessen (nicht nur gelesen):
  - Isoliert, ohne Env-Override: `NODE_ENV=test node --test --test-name-pattern="MCP-05"
    test/mcp-tools-i18n.test.js` → **rot** (`actual` enthaelt den deutschen Text). Mit
    `WORLD_DEFAULT_LANGUAGE_ENABLED=true` → gruen. Das stimmt mit dem Review-Befund ueberein.
  - **Der Teil "der GitHub-Actions-Build dieses PRs schlaegt real fehl" und "jeder lokale `npm
    test` ... ebenso" ist nach meiner Messung FALSCH.** `MCP-05` traegt seine Katalog-ID (`MCP-05`)
    am Namensanfang, und `MCP` steht in `package.json` `config.i18nCatalogPattern`
    (`^(Charakterisierung )?(DID|E2E|FMT|GAP|LANG|LAW|MCP|ORIG|OUT|PAY|PROMPT|UI|VOICE|WEB|WORLD)-[0-9]`).
    `npm test` laeuft ueber `test/testbaenke-run.mjs regression`, der GENAU diese ID-Klasse per
    `--test-skip-pattern` ausschliesst. Ich habe den vollen Regressionslauf im Bau-Worktree
    gefahren: `# tests 6375 / # pass 6375 / # fail 0`, korrigiert um Datei-Wrapper `tests 6355 /
    pass 6355 / fail 0` — **`MCP-05` taucht darin ueberhaupt nicht auf** (kein `not ok`, kein
    Eintrag), es wird nicht ausgefuehrt. Genau dieselbe Wrapper-Invocation laeuft in
    `.github/workflows/ci.yml` als Coverage-/Regressions-Schritt; der separate `test:gates`-Schritt
    (der `MCP-05` erfasst) ist im CI-Workflow ausdruecklich `continue-on-error`. Der GitHub-Actions-
    Build dieses PRs bricht also durch `MCP-05` NICHT. Das entspricht der Bestandslehre "Katalog-
    ID-Praefix verschiebt Tests" (ID am Namensanfang landet im Gates-Lauf) — die Reviewer haben
    offenbar nur die isolierte Datei gemessen, nicht die tatsaechliche Wrapper-Route.
  - Was am Befund bestehen bleibt, unabhaengig vom CI-Irrtum: **ein zuvor immer-gruener
    Gates-Katalog-Test wird durch diese Phase real rot**, und die zugrundeliegende
    Sprachfallback-Luecke (`loc.mcp` faellt ohne aufgeloeste Tenant-Sprache auf
    `DEFAULT_LANGUAGE`/`WORLD_DEFAULT_LANGUAGE_ENABLED` zurueck) ist echt und vorbestehend (R7,
    laut PLAN-SECURITY.md-Eintrag dokumentiert, nicht neu erzeugt von T2-09 — T2-09 macht sie fuer
    diesen einen Fall nur erstmals sichtbar/messbar). Nach CLAUDE.md ist ein roter
    `test:gates`-Fund ausdruecklich KEIN Regressionsbruch, sondern ein offener Produktbefund vor
    dem Start — das ist der dafuer vorgesehene Mechanismus, kein Verstoss gegen "npm test muss
    gruen sein" (das bezieht sich auf `npm test`, nicht auf `test:gates`).
  - Der Cleancode-Forderung selbst (Test flag-unabhaengig machen, z.B. `language:'en'` explizit im
    Testaufruf) wuerde ich fachlich zustimmen — sie macht den Test robuster und deckt den echten
    Fall (EN-Tenant ohne aufgeloeste Sprache) praeziser ab, unabhaengig vom CI-Fakt. Sie ist aber
    ausserhalb des T2-09-Scopes (Texte an der MCP-Grenze) minimal invasiv nachziehbar und wurde
    hier bewusst nicht gebaut.

- **Nicht gebaut (laut Bau-Session, unabhaengig vom Review):** T4 (Draht HTTP `/mcp`, OAuth-Modus,
  Nicht-Bootstrap-Tenant, `PAYMENT_ENABLED`/b2-Fixture) wurde in der ersten Nachbesserung
  nachgezogen (s. PLAN-SECURITY.md "T4 nachgezogen") — laut Owner-Notiz in den Tatsachen also
  inzwischen erledigt, aber das war zum Zeitpunkt des urspruenglichen "Nicht gebaut"-Eintrags offen.
  Ich habe den nachgezogenen T4-Test nicht separat am Draht nachgemessen (Zeitbudget) — das ist ein
  **UNKNOWN**: ob T4 tatsaechlich isoliert gruen ist, habe ich nicht selbst verifiziert.

## 2. Was erfuellt ist, ID fuer ID

### O-13 — Datenminimierung (keine internen IDs/Diagnosedaten in Tool-Antworten)

- **`list_action_items` nennt keine interne Item-ID mehr.** Beleg:
  `src/mcp-tools.js` Diff — `open.map((item) => \`${item.type === "appointment" ? ... : ""}${item.text}\`)`
  ersetzt das fruehere `` `[${a.id}] ...` ``. Test: `test/mcp-tools.test.js` (angepasst,
  16 Zeilen Diff).
- **Kein roher REST-Fehlertext (`json.error`) mehr an der Tool-Antwort.** Beleg: `api()` in
  `src/mcp-tools.js` wirft jetzt `new Error("upstream_status")` statt
  `new Error(json.error || \`HTTP ${res.status}\`)`; der Client-Text entsteht ausschliesslich ueber
  die neue Funktion `toolErrorText()` (Kette `knownToolErrorCodeText → denialReasonText →
  err.inputHint → httpStatusClassText → UPSTREAM_UNREACHABLE`). `err.message` wird in `wrapHandler`
  nicht mehr gelesen (fruehere Zeile `err?.message` entfernt).
- **Kein `"fetch failed"`/`"HTTP <n>"` mehr im Client-Text** — dieselbe `toolErrorText`-Kette faengt
  den Netzwerkfehler-Fall im letzten Schritt ab (`UPSTREAM_UNREACHABLE`-Text statt `err.message`).
  Server-seitig bleibt ein `console.error` mit `err.name/err.message` (secret-frei, nur Log, nicht
  Client) — konform mit "AUDIO/SECRETS niemals in Tool-Ausgaben", da Log ≠ Tool-Antwort.
- **Vollstaendigkeitstest gegen die Quelle** (Pre-Mortem b aus dem Plan): `T1: jeder
  Ablehnungsgrund aus outbound-gates.js hat in JEDER Sprache genau einen Tabelleneintrag`
  (`test/openai-t2-09-neutrale-fehlertexte.test.js:80`) leitet die erwarteten Gruende per Regex
  `denialAudit\("([a-z_]+)"\)` **aus dem Quelltext von `outbound-gates.js`** ab, keine gepflegte
  Liste — genau die im Plan geforderte Gegenmassnahme. Ein Struktur-Waechter direkt daneben prueft
  zusaetzlich, dass jeder `denialAudit(`-Aufruf ein String-Literal als erstes Argument hat (sonst
  wuerde die Regex-basierte Extraktion selbst luegen).
- Unbekannter/kuenftiger Ablehnungsgrund faellt NICHT stumm durch: `denialReasonText()` gibt in dem
  Fall `texts.errors[MCP_ERROR_CODE.DENIAL_UNKNOWN]` an den Client und loggt server-seitig eine auf
  `[a-z_]`/40 Zeichen bereinigte Kennung per `console.warn` (Log-Injection-Schutz, Beleg:
  `sanitizedDenialReason()` in `src/mcp-tools.js`).

### O-20 — kein Abo-/Upgrade-Hinweis, kein Checkout-Link an der MCP-Grenze

- **Keine der 21 Ablehnungsgrund-Texte (de/en/fr) in `src/i18n/mcp-denial-texts.js` enthaelt
  "Tarif"/"upgrade"/"plan"/"pricing".** Ich habe den EN-Block (Zeilen 86-141) und den DE-Block
  gelesen: statt "Bitte Tarif anpassen" steht durchgaengig "Bitte den Kontostatus im
  Hermes-Dashboard pruefen" (`abo`, `allowlist`) bzw. "Details stehen im Hermes-Dashboard"
  (`budget_tenant`, `reserve_erschoepft`, `reserve_ueber_rest`) — ein Hinweis auf das eigene
  Dashboard, kein Checkout-Link, kein Preis, keine Aufforderung zum Abo-Abschluss.
  `OUTBOUND_FROZEN` erscheint nicht im `frozen`-Text ("temporarily paused by the Hermes operator").
- Zweite Nachbesserung (24.09., dokumentiert in PLAN-SECURITY.md): `budget_tenant`/
  `reserve_erschoepft` wurden nochmal praezisiert (der alte Wortlaut "ist erreicht" war fuer den
  Fall eines unlesbaren Budget-Zaehlers irrefuehrend) — ohne neue Kennung, reiner Wortlaut, kein
  Test pinnte den alten Text (`test/openai-t2-09-neutrale-fehlertexte.test.js` T1/T2 blieben gruen).

## 3. Beruehrte Pfade — Abdeckung

| Pfad | Abgedeckt? | Beleg |
|---|---|---|
| HTTP `/mcp`, Legacy/Bootstrap-Token | Ja | T3 in `test/openai-t2-09-neutrale-fehlertexte.test.js` |
| HTTP `/mcp`, OAuth, Nicht-Bootstrap-Tenant, echtes Minuten-Gate | Nachgezogen (1. Nachbesserung, "T4 nachgezogen") — von mir NICHT selbst am Draht nachgemessen (UNKNOWN) | PLAN-SECURITY.md Abschnitt "Nachbesserung" |
| stdio-Kindprozess | Ja | T5 gegen Gateway-Attrappe |
| REST-Antwortform (`reason` additiv) | Ja, inkl. Formfehler-Gegenprobe | S1 |
| `place_call` 5xx ohne Gate-Grund (Originate-Fehlschlag) | Ja | T7, Gegenprobe `gate_error` unveraendert |
| `list_action_items` ohne ID | Ja | `test/mcp-tools.test.js` |
| Sprachen de/en/fr | Ja fuer die Denial-Tabelle selbst; **NEIN fuer den Netzwerkfehler-Fallback ohne aufgeloeste Tenant-Sprache** (das ist der MCP-05-Punkt oben — der Fallback ist an `WORLD_DEFAULT_LANGUAGE_ENABLED` gekoppelt, keine T2-09-Neuerung, aber jetzt sichtbar) | s. Abschnitt 1 |

## 4. Was ein unabhaengiger Pruefer nachmessen sollte (neutral)

1. Ist `test/openai-t2-09-neutrale-fehlertexte.test.js` Zeile T1 tatsaechlich quellenabgeleitet
   (Regex gegen `outbound-gates.js`), oder pflegt sie doch eine eigene Liste? — Datei lesen, Regex
   pruefen, `denialAudit(`-Aufrufe in `src/telephony/outbound-gates.js` zaehlen und gegen die
   Schluessel in `src/i18n/mcp-denial-texts.js` (alle drei Sprachbloecke) abgleichen.
2. Enthaelt IRGENDEIN Text in `src/i18n/mcp-denial-texts.js` (alle drei Sprachen) eines der Worte
   "plan", "pricing", "upgrade", "Tarif", "Abo" ausserhalb eines neutralen Kontostatus-Verweises? —
   `grep -in "plan\|pricing\|upgrade\|tarif" src/i18n/mcp-denial-texts.js`.
3. Laeuft `MCP-05` (`test/mcp-tools-i18n.test.js:111`) tatsaechlich unter `npm test`
   (`test/testbaenke-run.mjs regression`) NICHT mit, oder doch? — vollen Regressionslauf fahren und
   auf `MCP-05` grep(pen); parallel isoliert mit/ohne `WORLD_DEFAULT_LANGUAGE_ENABLED=true` pruefen,
   ob der Zustand wie hier beschrieben ist (rot ohne, gruen mit Flag).
4. Ist der `eslint-legacy-exceptions.json`-Pin fuer `src/mcp-tools.js` tatsaechlich GESUNKEN
   (508→494 Zeilen, id-length 28→26), nicht gestiegen? — `git diff master...HEAD --
   eslint-legacy-exceptions.json eslint-suppressions.json`.
5. Wirft `api()` in `src/mcp-tools.js` wirklich nirgends mehr `json.error` oder `HTTP <status>` als
   Fehlermeldung? — Handler lesen, plus `tools/call` am echten stdio-Kindprozess gegen eine
   Gateway-Attrappe fahren, die einen 500 ohne Body liefert, und den `isError`-Text pruefen.

## 5. Owner-Punkte und Restrisiko

- **Owner-Punkt (Deploy-Vorbedingung, weil ein ungemessener Live-Wert das Produktverhalten beim
  naechsten Deploy fuer alle nicht-deutschen Nutzer sichtbar veraendern kann):** pruefen, ob
  `WORLD_DEFAULT_LANGUAGE_ENABLED` im Render-Dashboard fuer den `hermes`-Service live tatsaechlich
  `true` gesetzt ist (Dashboard gilt vor `render.yaml`, der Service ist dashboard-managed;
  `render.yaml` traegt aktuell `"false"`). Ist der Live-Wert `false` (Code-Default), zeigt seit
  T2-09 jeder stdio-Aufruf und jeder HTTP-`/mcp`-Aufruf ohne aufgeloeste Tenant-Sprache bei einem
  Netzwerk-/Serverfehler einen deutschen Text an EN-Tenants — nicht nur bei den neuen T2-09-Texten,
  sondern im gesamten MCP-Textkanal. Weicht der Live-Wert von `render.yaml` ab: `render.yaml`
  nachziehen.
- **Owner-Punkt (Live-Probe nach Deploy, Owner-Regel "Live-Proben in Claude und ChatGPT"):**
  `list_action_items` aufrufen — erwartet keine `[..]`-Kennung vor den Eintraegen; danach
  `place_call` an `112` (feste Notruf-Kurzwahl, `EMERGENCY_SHORT_CODES`,
  `src/telephony/number-denylist.js:11`) — erwartet `isError` mit dem Denylist-Text in der
  Tenant-Sprache, kein `"HTTP"`, kein Env-Name, kein Anruf.
- **Restrisiko in einem Absatz:** Der Kern der Phase (O-13/O-20) ist an mehreren unabhaengigen
  Stellen belegt und die Vollstaendigkeit ist quellenabgeleitet statt gepflegt — das trägt. Das
  offene Risiko liegt nicht im Geldpfad-Text selbst, sondern am Rand: ein zuvor stabiler
  Gates-Katalog-Test ist jetzt vom Weltdefault-Sprachflag abhaengig, und dieselbe Abhaengigkeit
  (nicht neu geschaffen, aber neu sichtbar gemacht) bedeutet, dass der komplette MCP-Fehlertext-
  Kanal bei falscher Live-Konfiguration (Flag aus) fuer nicht-deutsche Tenants deutsche Texte
  zeigen kann — das ist ein Bestandsrisiko (R7), keine T2-09-Neuerung, aber T2-09 macht es fuer den
  Netzwerkfehler-Fall neu real. Der von den Reviewern behauptete CI-Blocker existiert nach meiner
  Messung nicht; wer trotzdem non-blocking-Rot in `test:gates` vermeiden will, muss den MCP-05-Test
  wie vom Cleancode-Reviewer vorgeschlagen auf eine explizite Sprache pinnen — das ist eine
  Kleinigkeit, aber nicht Teil dieser Phase gebaut.

## Unabhaengige Verifikation (gewinnt gegen alles oben)

- **Urteil des Laufs: FAIL** (PASS nur bei beiden Reviews PASS, allen IDs ja, keinem isoliert roten Test).
- **Gemessener Commit:** `9dce780`; **Tests (volle Suite, pass/fail):** 6375/0.
- **Review-Urteile zuletzt:** `{"safety":"PASS","cleancode":"FAIL"}`.
- **Tabelle ID | erfuellt | Beleg | Luecke:**

| ID | erfuellt | Beleg | Luecke |
|---|---|---|---|
| O-13 | ja | `mcp-tools.js api()`: kein roher REST-Fehlertext mehr; `toolErrorText` baut Client-Text nur aus Kennung/Grund/Status. Draht `/mcp`: `frozen` -> "paused by the Hermes operator" ohne Env-Name; 404 neutral; T5 stdio gruen | Keine fuer den Diff. Rest: `list_calls` zeigt `call_id` (von Folgetools benoetigt) und formatierte Anrufzeit (Nutzdatum, keine Diagnose). Item-ID-Entfernung nur per stdio-Test, nicht selbst am HTTP-Draht (Seed griff nicht). |
| O-20 | ja | `mcp-denial-texts.js`: `minutes` ersetzt "Bitte Tarif anpassen" (`outbound-gates.js:921`) durch Hinweis auf naechste Periode; `abo` nur "Kontostatus pruefen". T4 OAuth-Minuten-Gate gruen; `tools/list`: 0 Treffer upgrade/checkout | Keine gefunden. Ausserhalb des Diffs zeigt `get_agent_status` die Minutennutzung in % (keine Plananzeige, kein Upgrade-Aufruf). Gegrept: `ui/`, `mcp-server-info.js`, `failure-reason-texts.js`, ohne Treffer. |

- **Isoliert rot:** keine.
- **Offene Blocker:**
  - Review cleancode: FAIL.
  - cleancode/blocker `test/mcp-tools-i18n.test.js:111` (Test `MCP-05`), Ursache in `src/mcp-tools.js` (`wrapHandler`/`toolErrorText`, ca. Zeile 1090): T2-09 lenkt den Fallback-Text bei unbekannten Tool-Fehlern (Netzwerkfehler etc.) neu ueber die tenant-aufgeloeste Sprache `loc.mcp[UPSTREAM_UNREACHABLE]` statt wie bisher ueber das sprachneutrale `err.message`. Dadurch wird ein bisher immer-gruener Regressionstest erstmals von `WORLD_DEFAULT_LANGUAGE_ENABLED` abhaengig (Code-Default `false`).
  - safety/wichtig `src/mcp-tools.js:1095`: The network-error fallback now always comes from `loc.mcp.errors[UPSTREAM_UNREACHABLE]` instead of passing through `err.message` (`'fetch failed'`). So the text depends on the resolved tenant language, which falls back to `DEFAULT_LANGUAGE`, i.e. `WORLD_DEFAULT_LANGUAGE_ENABLED`. That flag is `"false"` in `render.yaml` (world default de). As a result the previously green gates-run test `MCP-05` (`test/mcp-tools-i18n.test.js:111`) goes red without the flag override. I measured it isolated: red without the flag, green with `WORLD_DEFAULT_LANGUAGE_ENABLED=true`.
