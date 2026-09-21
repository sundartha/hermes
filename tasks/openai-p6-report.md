# P6 — Abschlussbericht: Auth I, `WWW-Authenticate`-Challenge auf allen 401-Pfaden von `/mcp`

Branch: `phase/openai-p6-auth-challenge`. Spec: `tasks/openai-p6-spec.md`. IDs dieser Phase: **T-13**, **T-5**
(Quelle: `tasks/openai-audit/00-openai-anforderungen.md:38` [T-5], `:46` [T-13]).

**Commit-Hinweis (wichtig fuer den Merge):** der Auftrag nennt Commit `54259c9`. Der tatsaechliche
Branch-HEAD ist zum Zeitpunkt dieses Berichts **`7c51540`**, einen Commit weiter. Per `git reflog`
im Worktree nachvollzogen: `54259c9` ist der Stand nach Review-Runde 1, `30b3d2c` (identischer
Commit-Text, per Cherry-Pick auf den finalen Branch gebracht) derselbe Inhalt, und `7c51540`
("Review Runde 2") ist ein **weiterer, dokumentierter Fix-Commit** obendrauf, der zwei
Review-Runde-2-Befunde behebt (PLAN-SECURITY.md-Beleg korrigiert; `eslint.config.js`-Datei-Ausnahme
fuer `no-param-reassign` zurueckgenommen zugunsten einer engen, gezaehlten Bulk-Suppression). Dieser
Bericht bewertet **`7c51540`** (den echten HEAD), nicht `54259c9` — bei `54259c9` wuerde ein Lead
eine bereits ueberholte, schwaechere Fassung mergen. Diff `54259c9..7c51540`: `PLAN-SECURITY.md`,
`eslint-suppressions.json`, `eslint.config.js`, `src/auth.js` (4 Dateien, +13/-21 Zeilen) — selbst
gegengeprueft, siehe Abschnitt 3.

---

## 1. Was NICHT erfuellt ist — zuerst, nicht versteckt

- **T-13 ist nur im `oauth`-Modus wahrheitsgemaess erfuellt.** Der OpenAI-Wortlaut verlangt einen
  Header, der "auf die Protected-Resource-Metadata zeigt". Im `token`- und Legacy-Modus (`""`)
  bekommt der Client bewusst **keinen** `resource_metadata`-Verweis (Design-Entscheidung der Phase,
  Begruendung: dieser Zweig spricht kein OAuth, ein Verweis wuerde in eine Sackgassen-Discovery
  fuehren). `oauth` ist der live laufende Modus (P0 D0-3), aber ob er es am Tag der Einreichung
  bleibt, ist Konfiguration, kein Code-Fakt dieser Phase.
- **Keine neue Boot-Sperre fuer `MCP_AUTH=""`/`token` in Produktion.** Explizite Lead-Entscheidung
  im Auftrag (P6-2): eine `PRODUCTION_FOOTGUNS`-Zeile dafuer waere maximal wirksam (verweigerter
  Boot legt auch eingehende Anrufe lahm), wurde bewusst NICHT gebaut. Fiele der Dashboard-Wert
  live auf `""`/`token` zurueck, bootet der Server trotzdem — nur der 401-Header selbst zeigt es
  noch (kein `resource_metadata`). Offen als **O-7** in `PLAN-SECURITY.md`.
- **Kein WARN-Log** beim Boot in einem Nicht-`oauth`-Modus in Produktion. Laut Spec erlaubt, nicht
  Pflicht — nicht gebaut (Begruendung: kein Mensch liest Boot-Logs automatisch mit, der 401-Header
  macht den Zustand von aussen per `curl` messbar).
- **T-14** (`_meta["mcp/www_authenticate"]`, Error-Result-Feld fuer Auth-UI im Chat) ist laut Spec
  gegenstandslos fuer P6 (P0 D0-6, kein Ausloesepfad im Code) und gehoert zu P7. Nicht Teil dieser
  Phase.
- **`MCP_AUTH_TOKEN generateValue: true` in `render.yaml` unveraendert.** Ob live tatsaechlich ein
  Wert im Dashboard steht, ist **UNKNOWN** (O-6) — aus dem Repo nicht lesbar, nicht Teil des
  Auftrags (Konfigurations-Entscheidung, keine Challenge-Arbeit).
- **Provider-Signaturpruefung `/voice` (Telnyx Ed25519) unberuehrt.** Eigenes Gate, per
  Lead-Entscheidung 4 explizit ausgenommen — kein Fund, sondern Scope-Grenze.
- **Der dokumentierte Fail-closed-Diff-Waechter liefert einen Treffer, nicht null.** Der in
  `PLAN-SECURITY.md` selbst vorgeschriebene Grep
  (`git diff master...HEAD -U0 -- src/auth.js | grep -E '^[-+][^-+].*(next\(|if \(|safeEqual|...)'`)
  ist NICHT leer — er trifft eine Zeile in `discoverJwksUri` (Zeile 36, `if (!r.ok)` ->
  `if (!response.ok)`), eine reine Variablenumbenennung ohne Logikaenderung, ausserhalb jedes
  401-Pfads. Das ist in `PLAN-SECURITY.md` (Abschnitt "OpenAI-P6", Review-Runde 2) korrekt als
  bekannter, harmloser False-Positive benannt — die urspruengliche Spec-Beweiszeile ("liefert
  keine Ausgabe") war falsch und wurde in Runde 2 korrigiert. Ich habe das selbst nachgemessen
  (Abschnitt 3) und komme zum selben Ergebnis: ein Treffer, ausschliesslich der Rename.
- **Zwei Abweichungen von der woertlichen Spec-Beweiszeile** (inhaltlich neutral, s.u. Abschnitt 4):
  `grep -c "status(401)" src/auth.js` liefert **0** statt der von der Spec verlangten `1`, weil
  `401` durch die benannte Konstante `HTTP_UNAUTHORIZED` ersetzt wurde (Magic-Number-Verbot,
  CLAUDE.md). Der eigentliche Anspruch ("ein einziger Sender") ist stattdessen ueber
  `grep -c 'res.set(' src/auth.js` -> `1` belegt, selbst nachgemessen.

---

## 2. Was diese Phase erfuellt — ID fuer ID mit Beweisstelle

### T-13 — `401` + `WWW-Authenticate` bei fehlgeschlagener Token-Pruefung

| Zweig | Vorher | Nachher | Beweisstelle (Code) | Beweisstelle (Test) |
|---|---|---|---|---|
| `oauth`, kein Token | 401, Header vorhanden | unveraendert (byte-identisch) | `src/auth.js:87-90` (`verifyOauth`) ruft `deny401` (`:74-77`) | `test/openai-p6-challenge.test.js` P6-T5 (byte-exakter String-Vergleich) |
| `oauth`, Token ungueltig | 401, Header vorhanden | unveraendert (byte-identisch) | `src/auth.js:103-106` | mittelbar durch `test/oauth.test.js` (unveraendert, Diff leer, Abschnitt 3) |
| `token`, kein/falsches Bearer | 401, **kein** Header | 401, Header `Bearer error="invalid_token"` | `src/auth.js:115-119`, `:123-126` (`sendBearer401` mit `STATIC_BEARER_CHALLENGE`, `:83`) | P6-T1, P6-T2a, P6-T2b |
| Legacy (`""`), Token gesetzt+falsch | 401, kein Header | 401, Header wie oben | `src/auth.js:115-119` | P6-T3 |
| Legacy (`""`), kein Token, Produktion | 401, kein Header | 401, Header wie oben | `src/auth.js:127-131` | P6-T4 (In-Process-Express, echter HTTP-Listener) |
| Legacy (`""`), kein Token, ausserhalb Produktion | Bypass (`next()`) | **unveraendert** Bypass | `src/auth.js:127` (`legacyLocalBypassAllowed`) | P6-T4b (Gegenprobe: Handler erreicht) |
| `token`/Legacy, korrektes Bearer | 200 | **unveraendert** 200 | `src/auth.js:116` (`safeEqual`) | P6-T2c (Positiv-Kontrolle) |

Einziger 401-Sender im Modul (Fail-closed-Eigenschaft, "genau eine Stelle setzt Header+Status"):
`src/auth.js:66-70` (`sendBearer401`), selbst nachgemessen: `grep -c 'res.set(' src/auth.js` -> `1`,
`grep -c "status(401)" src/auth.js` -> `0` (s. Abweichung oben; die Konstante `HTTP_UNAUTHORIZED`
verschiebt den Treffer auf `grep -n "HTTP_UNAUTHORIZED" src/auth.js` -> 2 Treffer, beide im Sender).

### T-5 — Haertung des nicht-OAuth-Zweigs + Konfigurations-Drift

- `token`/Legacy-Zweig traegt jetzt eine RFC-6750-konforme Bearer-Challenge ohne
  `resource_metadata` (Design-Entscheidung, s. Abschnitt 1) — `src/auth.js:79-83`.
- `render.yaml:357-358`: `MCP_AUTH` von `value: ""` auf `sync: false` umgestellt — ein
  Blueprint-Sync kann den Dashboard-Live-Wert (`oauth`) nicht mehr stillschweigend auf `""`
  zurueckziehen. Selbst nachgemessen: `grep -n -A2 "key: MCP_AUTH$" render.yaml` -> Zeile nach dem
  Key ist `sync: false`, kein `value:`.
- `PLAN-SECURITY.md`, neuer Abschnitt `## OpenAI-P6 …` (Zeile 4960 im aktuellen Stand): Vorher/
  Nachher-Tabelle, Risiko-Eintrag U-1/O-7. Selbst nachgemessen: `grep -n "OpenAI-P6" PLAN-SECURITY.md`
  -> 1 Treffer (Ueberschrift); `grep -n "O-7" PLAN-SECURITY.md` -> Treffer im neuen Abschnitt sowie
  am vorgezogenen Verweis (`:2059`).

---

## 3. Berührte Pfade — vollständig?

| Pfad | Beruehrt? | Punkt erfuellt? |
|---|---|---|
| HTTP `/mcp`, mcp-natives Protokoll | ja | ja (`mcpAuth` sitzt einmal vor der Adapter-Wahl, `src/routes/mcp.js:112` laut Spec — Aufrufort selbst nicht Teil des Diffs, unveraendert) |
| HTTP `/mcp`, ChatGPT-Adapter | ja (teilt denselben `mcpAuth`) | ja, aus demselben Grund |
| stdio (`src/mcp-server.js`) | **nein** | entfaellt — keine Auth-Schicht, kein HTTP, kein 401 moeglich; nicht Teil des Diffs (bestaetigt: `git diff master...HEAD --stat` listet `src/mcp-server.js` nicht) |
| Browser-/Operator-Routen (`webAuthGateMiddleware`, `src/web-auth.js`) | nein | ausserhalb T-13 (Spec-Aussage); `test/auth-p6-operator-routes.test.js:218-222` pinnt dort weiterhin `www-authenticate === null` — selbst gelesen, unveraendert |
| `/voice/*` (Telnyx-Signaturpruefung) | nein | eigenes Gate, nicht angefasst |
| `render.yaml` (Laufzeit) | nein zur Laufzeit | Render-Dienst ist laut `render.yaml:14-17` Dashboard-verwaltet; ein Push macht nichts live (UNKNOWN, ob je Blueprint-synchronisiert wird, s. Spec Abschnitt 6) |

Fuer den einzigen tatsaechlich betroffenen Pfad (`/mcp`, beide Adapter, alle drei `mcpAuth`-Modi)
ist der Punkt auf ALLEN Zweigen erfuellt: `oauth` byte-identisch, `token`+Legacy neu mit Header.
Einzige Einschraenkung: der Legacy-Zweig ueber einen echten Nicht-Loopback-Socket hat nur einen
maschinenabhaengigen Test (`test/security.test.js:143-146`, skippt ohne externe Interface-IP) —
die Beweislast dafuer traegt P6-T4 (In-Process-HTTP, kein echter externer Socket).

---

## 4. Was ein fremder Pruefer nachmessen sollte

Neutral formuliert — jede Zeile beschreibt eine pruefbare Behauptung, nicht deren Bestaetigung.

1. **Steht der zu bewertende Code wirklich auf `7c51540`, nicht auf `54259c9`?**
   `git -C <worktree> log --oneline -1` und `git -C <worktree> log --oneline 54259c9..HEAD`
   (Erwartung laut diesem Bericht: ein weiterer Commit, "Review Runde 2").
2. **Ist "genau ein 401-Sender mit Header" im Modul wahr?**
   `grep -c 'res.set(' src/auth.js` und `grep -n "HTTP_UNAUTHORIZED\|res.status(" src/auth.js` —
   liegen beide Treffer im selben Funktionsrumpf (`sendBearer401`)?
3. **Liefert der Fail-closed-Diff-Waechter wirklich nur den dokumentierten Rename-Treffer?**
   `git diff master...phase/openai-p6-auth-challenge -U0 -- src/auth.js | grep -E '^[-+][^-+].*(next\(|if \(|safeEqual|legacyLocalBypassAllowed|mcpAuth ===|isLocalSocket|jwtVerify)'`
   — ist die einzige Ausgabe die `r`->`response`-Zeile in `discoverJwksUri`, oder gibt es
   weitere, unerwaehnte Treffer in Bedingungen/`next()`?
4. **Ist der oauth-Zweig wirklich byte-identisch?**
   `git diff master...phase/openai-p6-auth-challenge -- test/oauth.test.js test/auth-mcp-bypass.test.js`
   — ist die Ausgabe leer? Und: ist die Challenge-String-Konstruktion in `deny401`
   (`src/auth.js:75`) zeichengleich mit dem Stand auf `master`?
5. **Bekommt der token-/Legacy-Zweig wirklich `resource_metadata` NICHT?**
   `grep -n "resource_metadata" src/auth.js` — tauchen die Treffer ausschliesslich in `deny401`
   und in Kommentaren auf, nicht in `STATIC_BEARER_CHALLENGE`?
6. **Belegt der neue Testfall tatsaechlich einen vorher fehlenden Header, nicht nur eine
   Formalität?** Testdatei `test/openai-p6-challenge.test.js` in einen Checkout von `master`
   (Commit `4e81f42`) kopieren und mit `NODE_ENV=test node --test --test-concurrency=4
   test/openai-p6-challenge.test.js` fahren — werden P6-T1, P6-T2a, P6-T2b, P6-T3, P6-T4 rot
   (Header `null`), waehrend P6-T2c, P6-T4b, P6-T5 gruen bleiben?
7. **Laesst der neue Header einen gueltigen Request weiterhin durch?**
   Ergebnis von P6-T2c (`token`-Modus, korrektes Bearer) und P6-T4b (Legacy, ausserhalb
   Produktion) pruefen — Status ungleich 401, Handler tatsaechlich erreicht?
8. **Bleibt `webAuthGateMiddleware` unberuehrt?**
   `test/auth-p6-operator-routes.test.js` lesen, Zeilen um 211-224 — bestaetigt der Test
   weiterhin `www-authenticate === null` auf den Operator-Routen?
9. **Ist `render.yaml` fuer `MCP_AUTH` wirklich `sync: false` ohne `value:`, und bricht das
   keine `prodEnv()`-Spawns?**
   `grep -n -A2 "key: MCP_AUTH$" render.yaml`, dann
   `NODE_ENV=test node --test --test-concurrency=4 test/prod-config-smoke.test.js
   test/e2e-05-us-launch-full-chain.test.js test/p10-world-default-language-switch.test.js
   test/env-docs-spend-cap-coherence.test.js` — liefern dieselben Pass/Fail-Zahlen wie auf `master`?
10. **Ist die volle Suite tatsaechlich gruen (mindestens Baseline, keine Regression)?**
    `npm test -- -- --test-concurrency=4` im Worktree — `# fail 0`, `# pass` mindestens auf
    Baseline-Hoehe (6206) plus die neuen P6-Faelle? Jeder rote Fall zaehlt erst, wenn er isoliert
    (`NODE_ENV=test node --test --test-concurrency=4 test/<datei>`) erneut rot ist.
11. **Ist `eslint-suppressions.json` fuer `src/auth.js` eng (gezaehlt), nicht dateiweit?**
    `eslint-suppressions.json` an der Stelle `"src/auth.js"` lesen — steht dort ein `count`, kein
    pauschaler Datei-Ausschluss in `eslint.config.js`? `npx eslint .` — 0 Fehler?
12. **Bleibt die per-Tenant-Kostendecke, der Offenlegungssatz und die Telnyx-Signaturpruefung
    unangetastet?** `git diff master...phase/openai-p6-auth-challenge --stat` — taucht dort etwas
    ausserhalb der sechs genannten Dateien auf?

---

## 5. Restrisiko

Das Kernrisiko liegt nicht im Diff selbst — der Fail-closed-Charakter ist am Diff maschinell
belegt (bis auf einen dokumentierten, inhaltlich harmlosen Rename-Treffer), der oauth-Zweig ist
byte-identisch, und neun neue Draht-Tests plus eine Rot-gegen-alt-Gegenprobe zeigen, dass vorher
wirklich kein Header lief und jetzt einer laeuft, ohne dass ein gueltiger Request blockiert wuerde.
Das verbleibende Risiko ist ein **bewusst akzeptiertes Konfigurations-Risiko**: fiele der
Dashboard-Wert von `MCP_AUTH` in Produktion auf `""`/`token` zurueck (Bedienfehler, verlorene
Render-Variable, versehentlicher Blueprint-Sync vor dieser Phase), bootet der Server weiterhin und
liefert unbemerkt eine schwaechere Auth-Form (statisches Bearer-Token statt OAuth 2.1) — nur am
401-Header selbst (kein `resource_metadata`) von aussen erkennbar, nicht durch eine Boot-Sperre.
Diese Entscheidung ist im Auftrag ausdruecklich getroffen (Lead-Entscheidung P6-2) und in
`PLAN-SECURITY.md` als offenes O-7 gefuehrt, nicht stillschweigend liegen gelassen. Zweitens bleibt
unklar (UNKNOWN, nicht klaerbar aus dem Repo), ob `render.yaml` fuer den Live-Dienst je per
Blueprint synchronisiert wird und welcher Wert aktuell in `MCP_AUTH_TOKEN` steht — die Aenderung in
Schritt 4 ist damit Vorsorge, kein bestaetigter Fix eines aktiven Zustands. Drittens: T-13 ist im
OpenAI-Wortlaut nur erfuellt, solange am Einreichungstag tatsaechlich `oauth` laeuft — das ist eine
Konfigurations-, keine Code-Garantie dieser Phase.

---

## 6. Testzahlen (selbst nachgemessen)

- `test/openai-p6-challenge.test.js` isoliert: `NODE_ENV=test node --test --test-concurrency=4
  test/openai-p6-challenge.test.js` -> **9 pass / 0 fail** (P6-T1, P6-T2a/b/c, P6-T3, P6-T4, P6-T4b,
  P6-T5).
- Rot-gegen-alt auf `master` (4e81f42), dieselbe Testdatei unveraendert kopiert: **3 pass / 6 fail**
  — rot: P6-T1, P6-T2a, P6-T2b, P6-T3, P6-T4 (Header `null`); gruen: P6-T2c, P6-T4b, P6-T5. Deckt
  sich exakt mit der Spec-Erwartung.
- Kombinierter Lauf der laut Spec beruehrten Bestandsdateien (`test/oauth.test.js
  test/auth-mcp-bypass.test.js test/auth-p7-gate-removed.test.js test/security.test.js
  test/s2-mcp-origin.test.js test/e4-mandantentrennung-default.test.js` plus die neue P6-Datei):
  **112 pass / 0 fail**.
- Volle Suite (`npm test -- -- --test-concurrency=4`), **selbst im Worktree auf `7c51540`
  gestartet und bis zum Ende durchlaufen lassen** (Dauer ca. 423 s): **`# tests 6215`,
  `# pass 6215`, `# fail 0`**, danach `testbaenke-run`-Korrektur um 20 Datei-Wrapper ohne
  echten Test -> `6195 / 6195 / 0`. Deckt sich exakt mit der im Auftrag genannten und in der
  Commit-Nachricht von `7c51540` selbst zitierten Zahl.
- `npx eslint .`: 0 Fehler (69 vorbestehende Warnungen in unberuehrten Testdateien, nicht Teil
  dieser Phase).
- `node --check src/auth.js`: Exit 0, keine Ausgabe.
