# Phase P0b — Charakterisierungs-Test `POST /api/action-items/:id/toggle`

**Gate:** PASS
**finalBranch:** `phase/slim-p0b-action-items-toggle-test`
**headCommit:** `c60d0bf0b10184de2cde7d23f90fe2fbc888ca53`

---

## Plan (gekuerzt)

### Grounding (verifiziert gegen `master`)

Route in `src/server.js` (working tree == `git show master:src/server.js`, byte-identisch), aktuell Zeile 1473-1477:

```js
app.post("/api/action-items/:id/toggle", (req, res) => {
  const item = store.toggleActionItem(req.params.id);
  if (!item) return res.status(404).json({ error: "not found" });
  res.json(item);
});
```

| Fakt | Fundstelle |
|---|---|
| `toggleActionItem(s, id)` sucht `s.actionItems.find(a => a.id === id)`, kippt bei Treffer `item.done = !item.done` | `src/store/state-ops.js:455` |
| Bei Treffer rufen `json.js`/`pg.js` `save()` | Store-Backends |
| Item-Shape (aus `addActionItem`): genau `{ id, callId, text, type, done, createdAt }` | `src/store/state-ops.js` |
| Fehlende/unbekannte id -> 404 `{"error":"not found"}` | beobachtetes IST-Verhalten |
| Vorhandenes Item -> 200, Body = Item mit gekipptem `done`; `store.save`-Seiteneffekt persistiert | beobachtetes IST-Verhalten |
| Endpunkt ist NICHT tenant-gescopt (kein `requireTenant`, anders als `/api/settings`/`/api/calendar`) | beobachtetes IST-Verhalten, Observation fuer P8 |
| Zugriff ueber `srv.localUrl` (127.0.0.1) ist `isTrustedLocalCaller`-exempt -> kein Auth-Header noetig | analog P0a-Praxis |
| Kein bestehender HTTP-Test trifft die Route (`grep -rln "action-items" test/` leer; `/toggle`-Referenz nur in `test/store-pg.test.js`, dort Store-Ebene) | verifiziert |

Pre-Mortem h greift -> P0b ist gerechtfertigt: ohne HTTP-Test waere der spaetere Move nach `routes/api-tenant-write.js` (P8) nicht byte-beweisbar.

### Neue Datei

`test/api-action-items-toggle.test.js` — Spawn-Test (node:test) nach P0a-Muster (`startServer`, `PORT=0`, Temp-`DATA_DIR`, `BASE_ENV` aus `helpers.js`), offline (kein externer Dienst beteiligt), 2 Faelle:

- **(A)** fehlende/unbekannte id -> 404 mit exaktem Body `{"error":"not found"}`
- **(B)** vorhandenes Item (geseedet ueber `seedState({ actionItems: [...] })`) -> 200 mit vollem 6-Feld-Shape und gekipptem `done`; Store-Persistenz per `srv.readStore()` geprueft; zweiter Aufruf kippt echt zurueck (kein "mark done")

Bausteine: `toggle(srv, id)`-Helfer (POST-Aufruf, 2 Argumente), `ITEM`-Konstante (`Object.freeze`) als eine Quelle fuer Fixture und Erwartungswert (G5), `done:false` bewusst gewaehlt, damit `runRetention` (`RETENTION_DAYS=0`, `keepActionItem = !done || createdAt>=cutoff`) das Item am Boot garantiert behaelt.

### Edits an bestehenden Dateien

Keine. `src/server.js` bleibt byte-identisch (reine Test-Phase), keine Aenderung an bestehenden Tests, `helpers.js` unangetastet, keine neue Env-Var, keine neue Dependency.

### Deterministisch pruefbares Ergebnis (Plan-Vorgabe)

```
node --check test/api-action-items-toggle.test.js   -> Exit 0
node --test test/api-action-items-toggle.test.js    -> "# tests 2", "# pass 2", "# fail 0"
npm test                                             -> vollstaendig gruen
grep -c "^export" src/server.js                      -> 0
grep -rF "Hermes Gateway laeuft auf http://localhost" src/ | wc -l  -> 1
git diff --stat -- src/server.js                     -> leer
git show master:src/server.js | sed -n '1473,1477p'  -> Route unveraendert
```

### Deviations / Observations (aus dem Plan)

- Keine Abweichung von der P0b-Spec: beide Spec-Erwartungen (404 not-found; 200 mit getoggeltem Item) entsprechen dem beobachteten IST-Verhalten.
- Observation fuer P8 (kein Blocker jetzt): Die Route traegt kein `requireTenant`/403-Gate. P8 ist eine reine Verschiebung — das Fehlen des Tenant-Scopes muss byte-identisch mitwandern, kein Nachruesten eines 403-Pfads im Zuge des Moves. Der Test nagelt genau das fest (erwartet bewusst keinen 403-Pfad).

Blast-Radius: eine neue Datei, null Produktions-/Bestandstest-Aenderungen.

---

## Impl-Zusammenfassung

P0b exakt nach Plan umgesetzt: eine neue Datei `test/api-action-items-toggle.test.js` (59 Zeilen, 2 Faelle) als Charakterisierungstest fuer `POST /api/action-items/:id/toggle`. `src/server.js` byte-identisch zu `master` geblieben (Route Zeile 1473-1477 exakt geprueft und deckungsgleich), keine andere Datei angefasst.

- Test A pinnt 404 `{"error":"not found"}` bei unbekannter id.
- Test B pinnt 200 mit dem vollen 6-Feld-Item-Shape und gekipptem `done`, Store-Persistenz (`srv.readStore()`) und echtes Rueck-Toggle im zweiten Aufruf.

Beide Faelle liefen isoliert gruen (`node --test`, JSON- und pglite-Backend) UND als Teil der vollen Suite (`npm test`: 2274 pass / 0 fail).

**Globale Verifikation bestanden:**
- `node --check` fuer neue Datei + `src/server.js` sauber
- `grep -c "^export" src/server.js` = 0
- Boot-Log-Zeile genau 1 Treffer unter `src/`
- `git diff --stat -- src/server.js` leer (byte-identisch)

**Smoke-Test (best effort):** Server lokal gestartet (Port 3999, `SKIP_TWILIO_SIGNATURE_CHECK=true`, Dummy-Env). `curl -X POST /api/action-items/ai_missing/toggle` -> 404 `{"error":"not found"}`, `GET /healthz` -> `{"ok":true}`. Positiv-Pfad (200 mit getoggeltem Item) bereits durch den Spawn-Test (B) deterministisch abgedeckt.

**Commit:** `c60d0bf` auf Branch `phase/slim-p0b-action-items-toggle-test` (von `master`), nur `test/api-action-items-toggle.test.js` gestaged/committed (kein `git add -A`), `node_modules`-Symlink nicht committet (nur lokal fuer den Testlauf).

### Testdateien / Faelle

- `test/api-action-items-toggle.test.js`: "fehlende id: POST /api/action-items/:id/toggle -> 404 {error:'not found'}"
- `test/api-action-items-toggle.test.js`: "vorhandenes Item: POST toggle -> 200 mit getoggeltem Item, persistiert, kippt zurueck"

### Deviations

Keine Abweichung von der P0b-Spec/vom Plan: beide gepinnten Verhalten (404 not-found; 200 mit getoggeltem Item) entsprechen dem beobachteten IST-Verhalten, Test-Datei wortgleich zum Plan-Vorschlag implementiert.

Observation (kein Blocker, aus dem Plan uebernommen): die Route traegt kein `requireTenant`/403-Gate (anders als Nachbar-Routen `/api/settings`, `/api/calendar`) — relevant fuer P8 (reine Verschiebung, kein Nachruesten eines Tenant-Scopes).

### Clean-Code-Selfcheck (Impl)

`.claude/refs/clean-code.md` gelesen und angewandt: G5 (keine Duplizierung — `ITEM`-Fixture als eine Quelle via `Object.freeze`, `toggle()`-Helper statt Inline-fetch in jedem Test), F1 (`toggle(srv,id)` = 2 Argumente), P13 (Build/Operate/Check klar getrennt je Test), P14 (ein Konzept pro Test: A=not-found, B=Toggle+Persistenz+Rueck-Toggle als zusammenhaengendes Konzept), keine Magic Numbers, keine toten/auskommentierten Codezeilen, deutsche Kommentare ohne Umlaute, keine bruechigen Datei:Zeile-Referenzen im Kommentar-Text der Testdatei selbst.

---

## Safety-Urteil (final)

**Verdict: APPROVED**

- testsPassIndependently: true
- safetyGatesIntact: true
- disclosureIntact: true
- authFailClosedIntact: true
- noSecretsLeaked: true
- behaviorAsIntended: true
- scopeRespected: true
- blockers: keine

**Concerns:**
1. Endpunkt `POST /api/action-items/:id/toggle` ist im Bestand NICHT tenant-gescopt (kein `requireTenant`, anders als `/api/settings` und `/api/calendar`). Der Test charakterisiert dieses Ist-Verhalten korrekt und liegt damit im P0b-Scope; die fehlende Tenant-Scoping-Absicherung ist bestehendes Verhalten und beim spaeteren P8-Move zu beobachten, gehoert aber nicht in diese reine Test-Phase.

**Independent Test Summary:** Frischer Worktree, `node_modules` symlinked, Branch `review-slim-p0b` off `phase/slim-p0b-action-items-toggle-test`. Neuer Test `test/api-action-items-toggle.test.js` isoliert: 2/2 gruen auf JSON-Backend UND auf pg(pglite)-Backend (`STORE_BACKEND=pg`). Volle `npm test`: 2274 pass / 0 fail / 0 skipped (~102s) — kein `p5-gate-proof`-Flake in diesem Lauf. `node --check` gruen fuer beide `test/api-action-items-toggle.test.js` und `src/server.js`. `grep -c "^export" src/server.js` = 0; Boot-Log-Zeile genau 1 Treffer unter `src/`.

**Fazit:** P0b fuegt genau eine Charakterisierungs-Testdatei hinzu; `src/server.js` ist byte-identisch (`git diff` leer), keine Aenderung an `helpers.js`/anderen Tests/Quellcode, keine neue npm-Dependency. Der Test pinnt das exakte IST-Verhalten des Handlers (`server.js:1473-1477`): fehlende id -> 404 `{"error":"not found"}`; vorhandenes Item -> 200 mit vollem 6-Feld-Shape und gekipptem `done`, plus echtes Zurueck-Toggle und `store.save`-Persistenz. Keine Abweichung zwischen beobachtetem Verhalten und Spec. Alle Invarianten INV-1..INV-11 trivial erhalten (`server.js` unveraendert); Safety-Gates, `disclosureSentence` (`claude.js`/`bridge.js` unberuehrt) und Auth fail-closed intakt; keine Secrets/PII. Tests laufen unabhaengig gruen (isoliert beide Backends + volle Suite 2274/0).

---

## Clean-Code-Audit (final)

**Verdict: PASS** (kein Blocker)

### S1 (Blocker)
Keine.

### S2 (Blocker)
Keine.

### S3
Keine.

### S4
Keine.

### Pass-Notes

Diff `master..phase/slim-p0b-action-items-toggle-test` ist ein einziger Commit (`c60d0bf`), eine einzige neue Datei `test/api-action-items-toggle.test.js` (59 Zeilen, rein additiv, keine Loeschungen). `src/server.js` und alle sonstigen Dateien unveraendert (`git diff --name-only` bestaetigt genau eine Datei) — der im Kommentar behauptete "byte-identisch"-Anspruch an `server.js` stimmt nachweislich. Beide neuen Tests laufen isoliert gruen (`node --test`: 2/2 pass) und die volle Suite ist gruen (`npm test`: 2198/2198 pass, 0 fail, dieser Audit-Lauf).

Alle im Kommentar behaupteten Fakten wurden gegen den echten Code verifiziert:

1. `POST /api/action-items/:id/toggle` in `src/server.js:1908-1912` gibt bei fehlendem Item exakt 404 `{error:"not found"}` zurueck, sonst 200 mit dem getoggelten Item — Test A/B decken beide Pfade.
2. `addActionItem` in `state-ops.js:439-452` erzeugt exakt die sechs Felder `{id, callId, text, type, done, createdAt}` — identisch zur `ITEM`-Fixture im Test, die als `Object.freeze()` eine Quelle fuer beide Assertions ist (G5-bewusst, im Kommentar selbst referenziert).
3. `toggleActionItem` (`state-ops.js:454-458`) mutiert `done` und liefert das Item zurueck (oder `undefined` -> 404-Branch) — Store-Persistenz per `readStore()` geprueft, echtes Toggle (Ruecktoggle im zweiten Call) verifiziert.
4. Der Retention-Kommentar (`RETENTION_DAYS=0`, `keepActionItem = !done || createdAt>=cutoff`, `state-ops.js:1613`) stimmt mit `BASE_ENV` (`RETENTION_DAYS:"0"`, `helpers.js:100`) und `runRetention()` beim Boot vor dem "laeuft auf http"-Log ueberein (`server.js:2517-2528`) — die Begruendung fuer `done:false` in der Fixture ist korrekt und noetig (`createdAt` liegt vor dem Testlauf-Zeitpunkt, ohne `done:false` wuerde Retention das Item sonst am Boot entfernen).

`assert.deepEqual` ist die dominante Konvention im Repo (110 von 111 Dateien, die `deepEqual`/`deepStrictEqual` nutzen), keine Abweichung. Struktur/Stil ist konsistent zum unmittelbaren Vorlaeufer-Commit `cc97ae8` (P0a, gleiches Pre-Mortem-Muster, gleiche Kommentarstruktur) — G24 erfuellt. F1 (Argumentzahl), F2-F4, G5/G9/G12/G25/G26, C1-C5: keine Verstoesse gefunden. Keine Aenderung an Safety-Gates, Auth, Secrets, Audio oder Offenlegungssatz — Absolute Regeln nicht beruehrt.

Sauber: reine additive Testdatei, `server.js` unangetastet (verifiziert per `git diff --name-only`). Build->Operate->Check klar getrennt (P13). Eine kanonische `ITEM`-Fixture als Single Source of Truth fuer beide Assertion-Bloecke statt dupliziertem Literal (G5, im Kommentar selbst benannt). Kommentare praezise, technisch korrekt und gegen echten Code verifiziert (Retention-Timing, Feld-Shape, 404/200-Pfade) — keine Ueberholtheit (C2), kein Auskommentiertes (C5). Konsistent zur etablierten P0a-Konvention (gleiches Kommentar-/Testmuster, gleiche Pre-Mortem-Begruendung). Beide Tests isoliert und im Vollauf gruen (2198/2198). Kein Zugriff auf Safety-Gates/Auth/Secrets/Audio.

### Top-Todos

- Keine Blocker — Phase P0b ist mergefaehig.
- Optional (kein Blocker): bei zukuenftigen P0-Charakterisierungstests denselben Kommentar-/Fixture-Stil (`Object.freeze`-Single-Source, Pre-Mortem-Referenz) beibehalten, wie hier und in P0a etabliert.

---

## Fix-Runden

Keine. Beide Reviews (Safety + Clean-Code) kamen im ersten Durchlauf zu PASS/APPROVED ohne Blocker; es waren keine Fix-Runden noetig.
