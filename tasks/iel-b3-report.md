# Phase IEL-B3: Prompt-Variable `inbound_situation`

**Gate: PASS**
**finalBranch:** `phase/iel-b3-prompt-variable`
**headCommit:** `5e93138b3ef957e77b447cb5bc9ef6ab3899fd4c`
**Basis:** master `0775435`

## Plan (gekuerzt)

Ziel: neue dynamische ElevenLabs-Vorlagen-Variable `{{inbound_situation}}` einfuehren, die fuer ausgehende Anrufe IMMER leer gesendet wird (ein Outbound-Anruf ist nie eingehend), plus ein EN-Prompt-Baustein `inboundSituation({owner})` fuer eine spaetere Inbound-Anbindung.

Vorab-Befunde (F1-F4):
- **F1**: Die Spec-Abnahme "`elevenlabs:drift` meldet genau `prompt`" ist so nicht erreichbar — master ist schon heute mit 5 Abweichungen rot. Abnahme wird als Differenz definiert: neu = {`dynamic_variables`, `prompt`}, weg = {}.
- **F2**: `test/el-vorlage-variablen-abgleich.test.js` pinnt `EXPECTED_VARIABLE_COUNT = 15`, muss auf 16.
- **F3**: alle 18 `elevenlabs/test_configs/*.json` brauchen den neuen Schluessel, sonst meldet `check-elevenlabs-tests.js` `uncoveredVariableFindings`.
- **F4**: `test/fixtures/oc-p3-nichtowner-golden.json` ist NICHT betroffen (nur Budget-Engine-Felder).
- Nebenbefund C2: veralteter Kommentar in `outbound.js` ("genau die vierzehn") wird mitkorrigiert.

Geplante Aenderungen:
1. **Neu:** `test/iel-b3-variable.test.js` — 9 Faelle (IEL-B3-1 bis -9), offline ueber die geteilte Attrappe `test/helpers/elevenlabs-anrufstart-attrappe.mjs`, deckt Position/Wert der Variable im Outbound-Koerper, Render-Gleichheit mit master, Inhalt/Form des Blocktexts (Owner-Nennung, kein `{{`, keine Ziffer als Positiv-Kontrolle gegen den Budget-Baustein) und die woertliche Aufhebung der Sektion "SITUATION AND TASK".
2. `src/i18n/prompts/en.js`: neuer Baustein `inboundSituation({owner})` zwischen `calleeRelation` und `situationInbound`, mit Abgrenzungskommentar (Namensnaehe zu `situationInbound`/`claude.js#inboundSituation`).
3. `src/elevenlabs/outbound.js`: `dynamicVariables` sendet `inbound_situation: ""` direkt vor `tenant_token`; Kommentar ueber die Variablenliste neu gefasst ohne feste Zahl.
4. `elevenlabs/agent_configs/outbound-agent.template.json`: genau eine Zeile geaendert — `{{callee_relation}}{{inbound_situation}}` am Ende der PERSONA-Zeile.
5. `test/fixtures/el-anrufstart-fremdziel.json`: eine Zeile `inbound_situation: ""` vor `tenant_token`.
6. `test/el-vorlage-variablen-abgleich.test.js`: `EXPECTED_VARIABLE_COUNT` 15 -> 16.
7. 18 Dateien `elevenlabs/test_configs/*.json`: je eine Zeile `"inbound_situation": ""` nach `callee_relation`.

Bewusst NICHT geaendert: kein Push/Webhook, `claude.js`/`de.js`/`fr.js`, `oc-p3-nichtowner-golden.json`, Override-Whitelist, `PLAN-SECURITY.md`.

Deterministische Pruefungen (Abschnitt 4 des Plans): `node --check`, Zieltests, eslint, `check-elevenlabs-tests.js`, Byte-Vergleich der Vorlage gegen master, `git diff --numstat` (erwartet Dateizahl mit Rechenfehler im Plan, s. Deviations), voller `npm test`, sowie eine Drift-Differenzmessung gegen den Live-Agent (Nr. 8, dem Lead vorbehalten, da der Worktree keine `.env` hat).

Pre-Mortem (Auszug): Rollback-Reihenfolge (Prompt-Push vs. Code-Deploy) ist ausserhalb von B3 zu sichern; Inbound-Agent koennte trotz Block als Anrufer auftreten, falls Ueberschrift in der Vorlage umbenannt wird (IEL-B3-9 pinnt das); CI-Gate `elevenlabs:check` koennte ohne 2.6 still rot werden; Anrufernummer duerfte nie in den Blocktext gelangen (IEL-B3-8).

## Impl-Zusammenfassung

Umgesetzt wie geplant auf Branch `phase/iel-b3-prompt-variable`, Commit `5e93138`, Basis master `0775435`, 24 Dateien geaendert (+189/-8).

- `elevenlabs/agent_configs/outbound-agent.template.json`: genau eine Zeile geaendert (1/1) — `{{inbound_situation}}` direkt hinter `{{callee_relation}}`.
- `src/i18n/prompts/en.js`: neuer Baustein `inboundSituation({owner})`, keine Ziffer, kein `{{`, hebt "SITUATION AND TASK" namentlich auf.
- `src/elevenlabs/outbound.js`: `dynamicVariables` sendet `inbound_situation: ""` direkt vor `tenant_token`; veralteter Kommentar ohne feste Zahl neu gefasst.
- `test/el-vorlage-variablen-abgleich.test.js`: 15 -> 16, Testname "(sechzehn Namen)".
- `test/fixtures/el-anrufstart-fremdziel.json` + 18 `elevenlabs/test_configs/*.json`: je eine Zeile `inbound_situation: ""`, per exakter String-Ersetzung (nicht neu serialisiert).
- Neu: `test/iel-b3-variable.test.js` mit IEL-B3-1 bis IEL-B3-9.

Nachweise: `node --check` OK fuer alle 4 JS-Dateien; Zieltestdateien 49/49 pass; eslint Exit 0; `check-elevenlabs-tests.js` OK; Vorlagen-Byte-Vergleich gegen master "1 IDENTISCH"/"REST IDENTISCH"; `npm test -- --test-concurrency=4` im zweiten Lauf 5593 pass / 0 fail (erster Lauf hatte 1 Flake in `test/telnyx-elevenlabs-inbound.test.js`, isoliert gruen, als Last-Flake eingeordnet, kein Befund). Mutationsproben gefahren und zurueckgesetzt: Schluessel entfernt -> B3-1/2/3/5 rot; Ziffer in Blocktext eingefuegt -> nur B3-8 rot.

Keine Safety-Gates, keine Offenlegung, keine Routen, keine Env-Variablen, keine Dependencies beruehrt.

### Deviations

1. Plan Abschnitt 4 Nr. 6 erwartet "genau 23 Dateien", zaehlt in der eigenen Aufzaehlung aber 24 (Rechenfehler im Plan, keine inhaltliche Abweichung) — tatsaechlich 24 Dateien.
2. Zeilenzahlen weichen leicht von den "ca."-Schaetzungen im Plan ab: `en.js` +24/-0 (Plan ca. +22), `outbound.js` +12/-5 (Plan ca. +11/-5), neuer Test 128 Zeilen wegen einer `BESTANDS_SCHLUESSEL`-Zeile je Eintrag (Prettier-Stil).
3. Nr. 8 (Drift-Differenz gegen den Live-Agent) nicht im Worktree gefahren: keine `.env` vorhanden, laut Plan dem Lead vorbehalten (Hauptcheckout).
4. Erster voller `npm test`-Lauf hatte 1 Flake (`test/telnyx-elevenlabs-inbound.test.js`, 404 statt 200), isoliert gruen bestaetigt; zweiter voller Lauf 0 fail.

## Safety-Urteil

**approved: true** — alle Einzelpruefungen (testsPassIndependently, safetyGatesIntact, disclosureIntact, authFailClosedIntact, noSecretsLeaked, scopeRespected, behaviorAsIntended) true, keine Blocker.

Unabhaengiger Review-Worktree gegen master-HEAD `0775435` aufgesetzt: `node --check` gruen, Spec-Abnahmelauf 48/0, breiter Nachbarschaftslauf (Vorlage/Fixture/test_configs/EN-Prompts betreffende Dateien) 259 pass/0 fail/0 skip mit `--test-concurrency=4`. Mutationsprobe (`inbound_situation` auf `"x"` gesetzt) machte B3-2/3/5 und `OC-P2-A3` rot, danach zurueckgesetzt. Byte-Vergleich: Vorlage minus Platzhalter identisch zu master, gerenderter Outbound-Prompt mit `""` identisch zu master. `first_message` unveraendert.

Verdict-Kernaussagen: genau eine neue Variable, korrekt positioniert und immer leer fuer Outbound; der EN-Blocktext deckt jeden geforderten Inhaltspunkt der Spec ab (eingehender Anruf, Begruessung/KI-Hinweis bereits gesagt und nicht zu wiederholen, nicht der Anrufer, Anliegen klaeren/Nachricht aufnehmen, Terminwunsch ohne Zusage/Kalender, SITUATION AND TASK/Auftrag/Anrufgrund/Eroeffnungszeile gelten nicht, Rest gilt weiter inkl. `end_call`); keine Anrufernummer, kein `{{` im Block. Safety-Gates, `disclosureSentence`/`claude.js`, `first_message`, `/voice/incoming`, Auth und Secrets unangetastet, keine neuen Dependencies/Endpunkte.

Concerns (nicht blockierend, fuer Folgephasen):
- Die Spec-Abnahme "`elevenlabs:drift` meldet genau `prompt`" ist offline nicht pruefbar (braucht Live-API + Secret) — Nachweis obliegt Lead/Owner.
- Fuer B6 (Inbound-Builder): `inboundSituation({owner})` setzt den Owner-Namen ohne `PLACEHOLDER_OPENER`-Schutz (Muster `calleeRelationText`, `outbound.js:662`) ein — bei Owner-Namen mit `{{` bliebe ein Platzhalter im Prompt stehen.
- Fuer B8: die Offenlegung auf dem EL-Inbound-Weg haengt vollstaendig davon ab, dass der Pflichtsatz vor der Uebergabe tatsaechlich gesprochen wurde — das muss fail-closed sichergestellt werden, bevor der Block scharf geschaltet wird.
- Rollback-Regel aus Plan/Spec Abschnitt 7 bleibt in Kraft: sobald der Live-Prompt `{{inbound_situation}}` referenziert, darf kein Codestand ohne B3 deployed werden, bis der Prompt zurueckgerollt ist.

## Clean-Code-Audit (s1-s4)

- **s1:** keine Befunde.
- **s2:** keine Befunde.
- **s3:** N/A, `en.js` — der `inboundSituation()`-Kommentarblock ist ausfuehrlich, folgt aber nicht der Vorlagen-Konvention, pro Prompt-Aenderung ein eigenes `_..._hinweis`-Feld im `template.json` anzulegen (vgl. `_kuerze_hinweis`, `_b1_b2_hinweis`, `_rueckfrage_gate_hinweis`). Nicht blockierend, Begruendung liegt vollstaendig in `outbound.js`/`en.js`/Commit-Message/Testkommentaren vor, nur nicht am gewohnten Ort. Fix optional: `_inbound_situation_hinweis` ergaenzen, falls die Kette fortgesetzt wird.
- **s4:** F4 (grenzwertig), `src/i18n/prompts/en.js:74` — `inboundSituation` hat im gesamten Diff keinen Produktions-Aufrufer, einzige Verwendung ist der neue Test. Laut Kommentar bewusst vorgezogen ("den Blocktext fuer eingehende Anrufe baut der Inbound-Weg, nicht dieser Anrufstart") — liest sich als geplanter naechster Schritt (IEL-B4/B6), nicht als vergessene Anbindung. Nicht als s1 gewertet (dokumentierte Zwischenstufe einer laufenden Kette), aber im Auge behalten: bleibt die Anbindung dauerhaft aus, ist es echter toter Code.

**Verdict:** PASS. Sauberer, eng geschnittener Change: eine neue dynamische Vorlagen-Variable, serverseitig fuer Outbound immer leer, Platzierung konsistent mit dem bestehenden `calleeRelation`-Muster; alle 18 `test_configs` + betroffene Fixture luecken- und diff-verifiziert nachgezogen; neuer und angepasster Test lokal gruen; keine Magic Numbers, keine Duplizierung, keine Sicherheits-/Gate-Beruehrung. Die beiden s3/s4-Hinweise sind reine Beobachtungen fuer die Fortsetzung der Kette, kein Ablehnungsgrund.

Top-Todos fuer Folgephasen: `{{inbound_situation}}` fuer echte eingehende Anrufe befuellen (sonst bleibt `inboundSituation()` toter Code ausserhalb der Tests); optional `_inbound_situation_hinweis` im Template ergaenzen; `de.js`/`fr.js` brauchen vor mehrsprachigem produktivem Einsatz ein Gegenstueck zu `inboundSituation`.

## Security-Urteil

**approved: true**, keine Blocker. Commit fuegt keine Route, keinen Auth-Pfad, keinen Store-/DB-Zugriff, keine Env-Variable/kein Secret, kein Logging, keine MCP-Ausgabe und keine Dependency hinzu — nichts Neues fuer `route-policy.js`/`route-auth-inventory`. `dynamicVariables` sendet `inbound_situation` mit festem Wert `""`, nichts vom Client/MCP erreicht diesen Wert (keine Injection moeglich). `inboundSituation` ist ein reiner Textbaustein mit `owner` als einzigem, serverseitig gefuellten Input. Vorlagendiff ist exakt ein Token; `first_message`, Offenlegung, Tools, Overrides, Voicemail-Text unveraendert; gerenderter Prompt mit `""` byte-identisch zu master. Getestete Dateien: iel-b3-variable, callee-is-owner-elevenlabs, el-vorlage-variablen-abgleich (49/49) plus Offenlegungs-/i18n-/EL-Prompt-Tests (79/79); voller `npm test` wurde in diesem Review nicht erneut gefahren.

Concerns (Betrieb/Folgephasen, nicht blockierend): Rollback-Reihenfolge beim Prompt-Push ist strikt einzuhalten (B3 deployt, dann Push, Prompt vor jedem Code-Rollback zuruecksetzen — `ELEVENLABS_INBOUND_ENABLED=false` deckt das NICHT ab); die Anweisung "Do NOT repeat" im Blocktext ist nur vertretbar, wenn eine spaetere Phase fail-closed sicherstellt, dass der Pflichtsatz vor der Uebergabe immer gesprochen wurde; `inboundSituation` existiert nur in `en.js` — vor der Verdrahtung pruefen, ob ein fehlender Eintrag in `PROMPT_DE`/`PROMPT_FR` zu `undefined` oder einem stillen Fallback fuehren koennte.

## Fix-Runden

Keine. Alle vier Reviews (Safety, Clean-Code, Security) kamen direkt zu PASS/approved ohne Blocker; es waren keine Fix-Runden noetig.
