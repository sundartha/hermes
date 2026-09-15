# Phase IEL-B6: Bruecken-Fristen und Init-Webhook-Route

- **Gate:** PASS
- **finalBranch:** `phase/iel-b6-init-webhook`
- **headCommit:** `edc1550022c2263fee6a631f54916bd63c385e4b`
- **Basis:** master `67fecbe` (B1 bis B5 gemergt)

## Plan (gekuerzt)

Ziel: die Bruecken-Fristen fuer wartende Inbound-EL-Anrufe (`src/elevenlabs/inbound-bridges.js`) und die Conversation-Initiation-Webhook-Route (`POST /webhooks/elevenlabs/init`, `src/routes/webhooks-elevenlabs-init.js` + Builder `src/elevenlabs/inbound-initiation.js`).

**Spec-Luecken/Entscheidungen (S1-S8):**
- **S1 (STOPP):** `EL_BRIDGE_START_DEADLINE_MS`/`EL_BINDING_AFTER_ANSWER_MS` haben keine belegten Werte. Vorschlag: 30000 ms / 8000 ms, unbelegt, Nachzug nach Messung 8. Phase gilt ohne Lead-Freigabe als nicht abnahmefaehig.
- S2: Umleitungs-Callback `umleitenOderAuflegen` — vor B7 (kein `redirectCall`) wird immer aufgelegt, nie Stille.
- S3: `begruessungOhnePflichtsatz` schon in B6 in `i18n/inbound-notice.js` angelegt (laut Spec eigentlich B8).
- **S4:** Begruessung fuer Init-Antwort und `/voice/incoming` aus EINER Quelle (Option A: neuer Helfer `gespeicherteBegruessungFuer` in `greeting-catalog.js`, `/voice/incoming` nutzt ihn byte-identisch) statt Kopie.
- S5: Builder-Signatur `buildInitiationResponse({ store, config, call })` statt `(call)`.
- S6: Variablen-Schluesselmenge wird aus `outbound.js#dynamicVariables` abgeleitet (eine Quelle), Laufzeit-Waechter prueft String-Werte, keine `{{`, erlaubte Override-Pfade, `first_message` nicht leer.
- S7: `callee: ""` (Datenminimierung, S7).
- S8: eine Formel fuer Frist-Arm und Re-Arm: `answeredAt + EL_BRIDGE_START_DEADLINE_MS - now`.

Neue Dateien: `inbound-bridges.js` (Fristen, Umleiten/Auflegen, Re-Arm bei Boot), `inbound-initiation.js` (Init-Antwort-Builder, Waechter fail-closed), `routes/webhooks-elevenlabs-init.js` (Route, Stufenfolge Token->Zuordnung->Schalter->Bindung->Antwort, Wiederholungsfenster K1=10000ms).

Edits: `outbound.js` (Exporte + `auftraggeberAusdruck`), `convai.js` (Export `overrideLeafPaths`), `i18n/inbound-notice.js`, `i18n/greeting-catalog.js`, `routes/voice.js` (nur Option A, byte-identisches Verhalten), `route-policy.js` (neuer PUBLIC_ROUTES-Eintrag mit Begruendung), `server.js`, `app.js`, `boot.js` (Re-Arm vor `app.listen`), `scripts/probe-auth.sh`, `PLAN-SECURITY.md` (neuer IEL-B6-Abschnitt).

Tests (Plan): `iel-init-webhook.test.js`, `iel-inbound-bridges.test.js`, `iel-inbound-werkzeuge.test.js`, plus Refactor bestehender Test-Helfer (`el-vorlage-variablen.mjs`, `_iel-inbound-harness.js`, `route-auth-inventory.test.js`).

Pre-Mortem: Frist zu kurz/lang, Waechter-Fehler nach Bindung (Stille-Risiko), Tenant-Daten an falschen INVITE, Token-Raten, Log-Injection, `sip_headers`-Formfehler, Outbound-Bruch, Timer-Leck, Deploy-Ueberlappung, kein Budget-Check an der Init-Route — je mit Entschaerfung/akzeptiertem Risiko benannt.

## Impl-Zusammenfassung

Wie geplant gebaut und auf `phase/iel-b6-init-webhook` (`edc1550`) committet.

- `src/elevenlabs/inbound-bridges.js`: aeussere Frist (ab `answeredAt`, re-armiert bei Boot, setzt nur Timer), innere Frist (B8 armiert sie). Bei Ablauf wird der Call frisch gelesen; nur aktiv+WARTET wird auf `/voice/el-rueckfall?quelle=frist` umgeleitet, sonst aufgelegt. Exportiert `EL_RUECKFALL_PFAD`, `EL_RUECKFALL_QUELLE`, `elRueckfallUrl`, beide Frist-Konstanten fuer B8.
- `src/elevenlabs/inbound-initiation.js`: Variablen aus `dynamicVariables` mit leerem Auftrag abgeleitet, `voicemail_line`/`tenant_token` leer, `inbound_situation` gesetzt, `tenantToolToken` nie aufgerufen. `first_message` = gespeicherte Begruessung ohne Pflichtsatz. Fail-closed-Waechter wirft bei Nicht-String-Werten, `{{`, nicht erlaubten Override-Pfaden oder leerem `first_message`.
- `src/routes/webhooks-elevenlabs-init.js` (`POST /webhooks/elevenlabs/init`): Stufe 1 Token (`safeEqual`, zu kurz/leer = 403 fuer alle), Stufe 2 Zuordnung nur ueber Bindungs-Token an aktiven WARTET-Call oder identische Wiederholung binnen `EL_INIT_WIEDERHOLUNG_FRIST_MS` (10000ms, verankert an `elBoundAt`), Stufe 3 Schalter/Allowlist, Stufe 4 Set-once-Bindung. Fristen werden nur bei Erstbindung geloescht. Builder ist der einzige Aufrufer nach der Bindung. Alle Ablehnungen: konstanter Koerper, keine Daten; Log nur mit bereinigten Schluesselnamen.
- Edits an `outbound.js` (Exporte `PLACEHOLDER_OPENER`, `dynamicVariables`, neue Funktion `auftraggeberAusdruck`), `convai.js` (Export `overrideLeafPaths`), `inbound-notice.js` (`begruessungOhnePflichtsatz`), `greeting-catalog.js` (`gespeicherteBegruessungFuer`), `routes/voice.js` (Option A, Golden-/Disclosure-Tests gruen), `route-policy.js`/`probe-auth.sh`/`PLAN-SECURITY.md` nachgezogen, `server.js`/`app.js`/`boot.js` verdrahtet (Re-Arm vor `app.listen`).
- Tests: `iel-init-webhook.test.js` (21 Faelle inkl. echtem Server), `iel-inbound-bridges.test.js` (12 inkl. Boot-Re-Arm), `iel-inbound-werkzeuge.test.js` (2 Server-Laeufe mit Positiv-Kontrolle), plus Refactor bestehender Helfer.

Keine Safety-Gate angefasst, keine neue Env, keine neue Dependency.

**Ergebnis:** `nodeCheckPass=true`, `testsPass=false` (voller `npm test` zweimal gelaufen, je 1 anderer Flake-Fehler — `elevenlabs-anrufstart` bzw. `inbound-routing`, beide isoliert gruen; als Last-Flake eingeordnet, nicht als Regression). Phasen-Zielt-Tests: 257/257 gruen, alle Grep-Abnahmen bestanden, Lint 0 Fehler.

### Deviations
- **S1 nicht freigegeben:** Werte 30000ms/8000ms uebernommen wie im Plan vorgeschlagen, als unbelegter Startwert kommentiert (Code + PLAN-SECURITY). Laut Plan selbst ist die Phase erst nach Lead-Freigabe abnahmefaehig.
- Test 7 ("de ohne Default-Stimme -> kein tts") nicht erreichbar, da jede unterstuetzte Sprache eine eigene Profilstimme hat; Test stattdessen auf Sprachfolge umgestellt.
- Init-Webhook-Tests nutzen `storeOpsFacade(state)` statt `baueStore(state)` (gleicher Datenpfad, aber echtes `tenantContext` noetig).
- Plan-Testpunkte 6/9/24/27 in Sub-Tests aufgeteilt; Testpunkt 32 (Positiv-Kontrolle) in 30/31 integriert statt eigener Server-Start.
- Kommentarzeile zu `dynamicVariables` sitzt direkt ueber der Funktion, nicht im Dateikopf.
- `gespeicherteBegruessungFuer`-Aufruf in `voice.js` bleibt einzeilig (sonst waechst `makeVoiceRoutes` ueber den gepinnten Suppression-Check).
- Voller `npm test` war nicht gruen: je 1 Flake pro Lauf (unterschiedliche Datei), beide Dateien isoliert gruen — als last-bedingtes Flake eingeordnet, nicht Phasen-verursacht.

## Safety-Urteil

**PASS mit Concerns**, keine Blocker. Safety-Gates unberuehrt (kein Diff in `config.js`, `billing`, `telephony`, `store`), Offenlegung intakt (`claude.js` unveraendert, Outbound-Offenlegung byte-identisch, `/voice/incoming` byte-identisch per Golden-Test — Pflichtsatz-Wegfall in `first_message` ist bewusst, weil B8 ihn vor dem Dial spricht), Auth fail-closed (neue Route korrekt in `route-policy.js`/Inventar/`probe-auth.sh` eingetragen, Token-Pruefung vor jedem Store-Zugriff), keine Secrets geleakt.

Concerns (nicht blockierend):
- Scope-Ausweitung ueber die B6-Dateiliste hinaus (Stuetz-Aenderungen wie `begruessungOhnePflichtsatz`, `overrideLeafPaths`-Export, `auftraggeberAusdruck`, Test-Helfer-Verschiebung), aber Verhalten identisch und getestet.
- Restrisiko "Stille": scheitert der Antwort-Waechter NACH der Bindung, bleibt der Call GEBUNDEN ohne Frist (500). Dokumentiert in PLAN-SECURITY, mit Test 12 festgenagelt, wirkt erst ab B8. Empfehlung fuer B8: Reihenfolge Builder/Bindung/Fristloeschung ueberdenken.
- `called_number`-Normalisierung (`normNum`) ergaenzt kein `+`; fehlendes `+` fuehrt fail-safe zu 404 -> Frist -> Budget-Rueckfall, aber Qualitaetsverlust. Pruefen beim Nach-Deploy-Beleg.
- `route-policy.js` importiert jetzt transitiv das Routenmodul (kein Zyklus, aber Schicht-Vertauschung).
- Log-Hygiene begrenzt Schluesselzahl (20), nicht die Laenge einzelner Namen — nur nach Stufe 1 erreichbar, gering.
- Reihenfolge B7 vor B8 noetig (vor B7 legt jede abgelaufene Frist auf statt umzuleiten, bewusst und getestet). Heute wirkungslos in Produktion, da kein Code `TELNYX_INBOUND_EL_CONVAI` setzt.

Unabhaengiger Security-Check (separat gelaufen): **PASS**, keine Blocker, gleiche Concerns bestaetigt (Stille-Restrisiko, `called_number`-Format, fehlender Budget-Check an der Route, Rate-Limit vor breiter Freischaltung offen).

## Clean-Code-Audit (S1-S4)

- **S1 (Blocker):** keine.
- **S2 (Blocker):** keine.
- **S3 (kosmetisch):** `KEINE_NUMMER`-Array-Pattern in `webhooks-elevenlabs-init.js` fuer einen einfachen Nullish/Leer-Check ist unueblich, aber lesbar; `umleitungFaellig` als Praedikatsname knapp, aber bestandskonsistent. Kein Handlungsbedarf.
- **S4 (Duplikation):** zwei aehnliche lokale Seed-Builder fuer wartende EL-Inbound-Calls in `iel-inbound-bridges.test.js` und `iel-init-webhook.test.js`, koennten zusammengefuehrt werden, aber angesichts unterschiedlicher Testfokusse vertretbar, kein echter G5-Fall.

**Verdict: PASS.** Fail-closed-Stufenfolge deckungsgleich mit umfangreichen Tests (Grenzfaelle: leeres/kurzes Token, Wiederholungsfenster an der Grenze, fremde `agent_id`, Antwort-Waechter-Fehlerpfad). Keine Secrets/PII im Log. G5-Wiederverwendung (Owner-Ausdruck, `dynamicVariables`-Basis, Pfad-Waechter, Begruessungs-Helfer) statt Kopie, jeweils kommentiert begruendet. `route-policy.js`/Inventar/`PLAN-SECURITY.md` konsistent nachgezogen.

## Fix-Runden

Keine Fix-Runde noetig — beide Reviews (Safety, Clean-Code) kamen direkt mit PASS zurueck; die genannten Concerns sind dokumentierte Restrisiken/Hinweise fuer B7/B8, keine Blocker.
