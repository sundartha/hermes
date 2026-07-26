# Phasenreport P13 — Widget und Kanarienvogel

- **IDs:** MCP-09, UI-14, UI-18, MCP-12
- **Gate:** **BLOCKED**
- **finalBranch:** `phase/i18n-p13-widget-kanarienvogel`
- **headCommit (Impl):** `b4a30d9`
- **Basis:** `master` = `e014dbf`

---

## 1. Plan (gekuerzt)

Autoritativ: `PLAN-I18N-FIX.md` Abschnitt „P13 — Widget und Kanarienvogel" + Owner-Entscheidung **E4** (Agentensprache, serverseitig ins Widget-HTML gerendert).

**Ausgangszustand (gemessen):** Isolationslauf der sechs betroffenen Testdateien 79/75/4 — rot exakt die vier P13-IDs. `npm test` vorher 3247/3247/0. `npm run test:gates` vorher 29/21/8 (7 rot vor P13: MCP-09, MCP-12, UI-14, UI-18 + E2E-06, GAP-05, GAP-15). Befund: Planzeile „5 → 1" stimmt mit dem gemessenen Gate-Lauf nicht ueberein (gemessen 7 → 3, Abweichung dokumentiert statt die Zahl passend zu machen).

**Vorbedingung A6 „P12 live" — NICHT ERFUELLT:** `upstream/master` = `566ccd6`, lokales `master` 93 Commits voraus, P10-P12 nicht auf dem Deploy-Remote. Code-Arbeit kann laufen, Phasenabnahme haengt am Deploy.

**Design:**
1. Eine Sprachquelle: `loc.language` (bereits ueber `localeFor` aufgeloest) wird von `enableWidgetUi` bis `widgetHtml` durchgereicht — kein zweiter Fallback im Produktivpfad. `routes/mcp.js`/`mcp-server.js` (stdio) bleiben unangetastet.
2. Sprache als Teil des Cache-Schluessels: `WIDGET_HTML` wird zu einer zweistufigen Matrix (`{locale: {id: html}}`), einmal beim Modul-Load gebaut (kein Lazy-Init, P15). Stufe 1 sprachneutrale Basis, Stufe 2 je Widget x Locale nur die i18n-Injektion.
3. Iframe-Script: `locale` wird als Server-Literal eingesetzt statt `resolveLocale([navigator.language], ...)`; nur die Tabelle der gerenderten Sprache wird projiziert (`widgetDictFor`).
4. Pre-Mortem zu `widget-bind.js`: gepueft und widerlegt, dass MCP-09 dort etwas mitziehen muss (kein Feldnamen-Parsing dort) — bleibt unveraendert.
5. Benannter Blast-Radius: (a) Widget-Chrome folgt nicht mehr dem Browser, sichtbare Aenderung fuer heutige Accounts solange `DEFAULT_LANGUAGE="de"`; (b) UI-19 (zwei Betrachter, zwei Chrome-Sprachen) gilt nicht mehr, ungetestet, als E4-Folge akzeptiert; (c) Host-Session-Cache ueber die sprachfreie `ui://`-URI kann bei Sprachwechsel eine alte Fassung zeigen — akzeptiertes Restrisiko, URI bewusst nicht sprachlich aufgespalten.
6. Ausdruecklich nicht in P13: `get_agent_status`-Textblock-Labels/Leertexte (offener S3 aus P12), `place_call.language`-Schema, `calls.html`/`calendar.html`, `routes/mcp.js`, `mcp-server.js`, `registry.js`. Keine neue Datei/Dependency/Env-Variable/Endpunkt.

**Exakte Edits (Plan-Vorgabe):**
- `src/i18n/mcp-texts.js`: `permissionLabels` je Sprache (de/en/fr), DE-Werte byte-identisch zum Bestand.
- `src/mcp-tools.js`: `permissionsSummary(settings, labels)`, `pickAgentStatus(s, texts)`, `enableWidgetUi` reicht `loc.language` an `registerResource`.
- `src/ui/widget-i18n.js`: `WIDGET_LOCALES`, `resolveWidgetLocale()`, `widgetDictFor()`, `buildI18nScript(locale)` parametrisiert, `I18N_SCRIPT_BY_LOCALE` einmalig gebaut; `navigator.language`-Lesepfad entfernt.
- `src/ui/widget-catalog.js`: zweistufige Matrix `WIDGET_BASE_HTML` -> `WIDGET_HTML_BY_LOCALE`; `widgetHtml(widgetId, language)`.
- `src/ui/contract.js`: `registerResource(server, widgetId, language)`.
- `src/ui/ports.js`: JSDoc nachgezogen (C2).
- Tests: vier Katalog-IDs nach A3-Praezedenz aus dem Launch-Testkatalog in die Regressionssuite umgezogen/umbenannt (kein R5-Loeschfall), plus 7 neue Tests (`T-i18n-server-locale(+fallback+keyset+inject-locale)`, `T11`/`T12` ex MCP-09/MCP-12, `T-W3-AC1c/1d`, `T-P4-07b`).

**Deterministisch pruefbares Ergebnis (Plan Abschnitt 4):** node --check auf 5 Dateien; Isolationslauf 79→86 Tests/0 fail; `npm test` 3247→3258/0; `npm run test:gates` 29/21/8 → 25/21/4 (nur noch E2E-06/GAP-05/GAP-15 rot); grep-Belege fuer EN-Faelle in 3 Testdateien; `grep -c navigator.language` == 0; DE-Byte-Identitaet der Berechtigungen an genau 2 Stellen.

**Commit-Disziplin (Plan-Vorgabe):** ein Commit fuer MCP-09, Widget-Strang (UI-14/UI-18) darf zweiter Commit sein, muss aber im selben Merge landen. Unangetastet: Safety-Gates, `disclosureSentence`, `mcpAuth`/`/mcp`-Routing, Whitelist-Filter, Audio-Pfad.

---

## 2. Impl-Zusammenfassung

P13 (MCP-09, UI-14, UI-18, MCP-12) laut Selbstauskunft des Impl-Agenten exakt gemaess Plan umgesetzt:

- `permissionsSummary()` traegt sprachabhaengige Feldnamen aus `loc.mcp.permissionLabels`, DE bleibt byte-identisch zum Bestand.
- Widget-Sprache wird nicht mehr aus `navigator.language` im Iframe geloest, sondern serverseitig als Agentensprache (`loc.language`) durch `enableWidgetUi` -> `registerResource` -> `widgetHtml` durchgereicht.
- `widget-catalog.js` haelt eine zweistufige Matrix (sprachneutrale Basis x Locale), einmal beim Modul-Load gebaut, Sprache strukturell Teil des Cache-Schluessels.
- Alle vier Katalog-IDs nach A3-Praezedenz in die Regressionssuite umgezogen; MCP-12-Kanarienvogel bleibt als dauerhafter Waechter bestehen.
- Gemessene Zahlen laut Impl-Report: Isolationslauf-Slice 79 -> 86 Tests, 0 Fail. `npm test`: 3258/3258/0. `npm run test:gates`: 25/21/4, verbleibend rot ausschliesslich E2E-06, GAP-05, GAP-15 — alle Plan-Erwartungen laut Selbstauskunft exakt getroffen.
- Smoke: Server-Boot lokal (PORT=3999, SKIP_TWILIO_SIGNATURE_CHECK=true, MCP_UI_ENABLED=true), `/healthz` -> 200, POST `/mcp` initialize -> 200 mit korrekter ui-Capability. Kein separater curl-Test fuer eine konkrete Sprach-Resource (laut Impl-Agent durch die 86 automatisierten Tests inkl. T-W3-AC1c/d abgedeckt).
- `testsPass: true`, `testFailCount: 0`, `testPassCount: 3258`, `committed: true`, `headCommit: b4a30d9`.

**Geaenderte Dateien (Worktree `wf_31a069b0-988-2`):**
`src/i18n/mcp-texts.js`, `src/mcp-tools.js`, `src/ui/widget-i18n.js`, `src/ui/widget-catalog.js`, `src/ui/contract.js`, `src/ui/ports.js`, `test/mcp-tools-i18n.test.js`, `test/mcp-ui-i18n-divergence.test.js`, `test/mcp-tools-language.test.js`, `test/mcp-ui-widget-i18n.test.js`, `test/mcp-ui.test.js`, `test/mcp-tools.test.js`.

### Deviations (Impl-Agent)

1. **grep-Zaehler navigator.language weicht ab:** Plan-Pruefpunkt 6 erwartet `grep -c navigator.language src/ui/widget-i18n.js` == 0, gemessen ist 1 Treffer. Der Treffer liegt in einem erklaerenden Kommentar ("der frueher hier gelesene navigator.language war..."), dessen Wortlaut der Plan selbst in Abschnitt 3.1 vorgibt. Laufzeit-Code liest `navigator.language` an keiner Stelle mehr (per node-Smoke bestaetigt) — nur der exakte grep-Zaehler aus dem Plan trifft nicht zu. Nicht korrigiert, um nicht vom plan-vorgegebenen Kommentartext abzuweichen.
2. **Ein Commit statt optionaler Aufteilung** MCP-09-Commit + UI-14/UI-18-Commit: Plan erlaubt beides und verlangt nur denselben Merge; wegen enger gegenseitiger Abhaengigkeit (`enableWidgetUi`/`widgetHtml`-Signaturaenderung wird von beiden Straengen gemeinsam genutzt) haette ein Split einen Zwischenzustand mit kaputten Tests erzeugt.

---

## 3. Safety-Urteil (final)

`null` — kein Safety-Review-Ergebnis in der uebergebenen Kette dokumentiert.

---

## 4. Clean-Code-Audit (final)

- **s1:** []
- **s2:** []
- **s3:** []
- **s4:** []
- **blocker:** `false`
- **verdict:** PASS. Keine S1/S2-Befunde. `node --check` auf allen 6 geaenderten `src`-Dateien gruen. `npm test` in isoliertem detached Worktree (Commit `b4a30d9`): 3270/3271 gruen; die eine rote Zeile (`T-P4-08` `/api/profiles`, `test/api-routes.test.js`) ist laut Auditor nicht vom Diff betroffen, lief standalone gruen und auf `master` unter Volllast ebenso vereinzelt rot — als bereits bekannter vorbestehender Voll-Last-Flake eingeordnet (Memory „Suite-Flake p5-gate-proof"), kein neuer Befund dieser Phase.
- **passNotes (Auszug):** `registerResource(server, widgetId, language)` sitzt einmal generisch in `contract.js` und bedient beide Host-Adapter ohne Duplizierung. Sprachmatrix in `widget-catalog.js` zweistufig, einmal beim Modul-Load gebaut (P15-konform), Sprache Teil des Objektschluessels, kein stiller Fallback moeglich. `resolveWidgetLocale()` ist die eine Normalisierungsstelle fuer beide Eintrittspunkte. Toter Code sauber entfernt (`primaryLanguage`/`resolveLocale` nicht mehr als Browser-Script injiziert), kommentiert begruendet. Kommentare durchgehend ASCII-transliteriert. `MCP_TEXTS.permissionLabels` vollstaendig fuer de/en/fr, DE bewusst nicht eingedeutscht. Neues Verhalten durchgehend getestet (T-i18n-server-locale-Familie, T-W3-AC1c/1d Verdrahtungsbeweis, T11/T12, T-P4-07b). Argumentzahl-Grenze (max. 3) eingehalten, keine Magic Numbers, keine abgeschalteten Sicherungen.
- **topTodos:** []

---

## 5. Fix-Runden

**r1 (erste):** Uebergebene Blocker-Liste war leer (`[]`) — keine konkreten S1/S2-/Safety-Blocker benannt. Recherche ergab: `review-p13`-Branch identisch zum Phasenbranch `phase/i18n-p13-widget-kanarienvogel` (`git diff` leer); Commit `b4a30d9` enthaelt bereits eine vorherige Fix-Runde (MCP-09/UI-14/UI-18/MCP-12, Wid[gets] ...) — Text im Quellmaterial an dieser Stelle abgeschnitten.

**r1 (zweite Eintragung / Abbruch):** **ABBRUCH** — kein Commit vom Fix-Agenten, Branch `phase/i18n-p13-widget-kanarienvogel-fix1` existiert nicht. Self-Fix-Schleife wurde beendet; die Blocker der Erstreview-Runde bleiben stehen.

---

## Ergebnis

**Gate: BLOCKED.** Trotz eines formal PASS-lautenden Clean-Code-Audits (`blocker: false`) und `Safety: null` konnte die Self-Fix-Schleife die aus der Erstreview uebernommene Blocker-Lage nicht aufloesen: Die uebergebene Blocker-Liste war leer/unklar, ein Fix-Agent hat keinen Commit erzeugt (Fix-Branch existiert nicht), und die Schleife wurde ohne Ergebnis abgebrochen. Der Phasenbranch `phase/i18n-p13-widget-kanarienvogel` steht auf Commit `b4a30d9`, ist aber nicht als abgenommen freigegeben.
