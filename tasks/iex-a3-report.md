# Phase IEX-A3: Ein-Satz-Eröffnung mit Riegel

**Gate:** PASS
**finalBranch:** `phase/iex-a3-ein-satz-eroeffnung`
**Basis:** master `543f8e1` (IEX-A1 und IEX-A2 gemergt)
**Commit:** `0ee69e5`

---

## Plan (gekürzt)

Ziel: Auf dem ElevenLabs-Inbound-Pfad ersetzt eine vom Agenten gesprochene Ein-Satz-Eröffnung
(`first_message`) den bisherigen serverseitigen Pflichtsatz vor `<Dial><Sip>`. Der Hinweis
(KI-Kennzeichnung + Transkriptions-/Zusammenfassungs-Hinweis) steckt jetzt im Namenssatz-Anfang
der Eröffnung, gesichert durch einen zweifachen fail-closed-Riegel.

**Befunde am Code, die den Plan geprägt haben:**
- Namenssatz fehlte bisher nur als interner Helfer (IEX-A2) — der Riegel (E3a) braucht
  `bundle.inboundNameSatz`, kommt daher neu ans Bundle.
- GAP-31 (`test/locale-field-consumers.test.js`) verlangt für jedes Bundle-Feld eine Lesestelle
  außerhalb von `locales.js` — deshalb `inboundFrage` NICHT als Bundle-Feld (siehe D1).
- Kein eigenes Transkript mehr für die Anbieter-Zeilen (Nachlauf hängt sie nur an).
- Test B6-12 wird umgebaut, weil Stufe 3b den bisherigen Auslöser (Name mit `{{`) jetzt vorher
  mit 404 abfängt.
- `agent.language` ist immer ein LOCALES-Schlüssel (aus `callLocaleFor`/`localeFor`) — Bundle-
  Sprache und `agent.language` laufen nicht auseinander.

### Abweichungen von der Spec (geplant, mit Grund)

| # | Spec | Plan | Grund |
|---|---|---|---|
| D1 | Bundle-Feld `inboundFrage` | Nur Modul-Konstante `INBOUND_FRAGE` in `locales.js` | Ohne Leser in `src` würde GAP-31 rot |
| D2 | Init-Test "defektes Bundle (Spion)" | Echter Datendefekt an der Route (Name mit `{{`); reine Riegel-Tabelle separat mit manipulierten Bundles | Ein manipuliertes Bundle erreicht die Route nur über eine testexklusive Einspeisung |
| D3 | IEL-B6-12 "Antwort-Wächter nach Bindung" | Auslöser jetzt werfender Store-Leser (`tenantTimezone`) nach der Bindung | `{{`-Namen fängt jetzt Stufe 3b vorher ab |
| D4 | – | `i18n/inbound-opening.js` importiert `PLACEHOLDER_OPENER` aus `elevenlabs/outbound.js` | Eine Quelle für `{{` (G5); kein Importzyklus |
| D5 | – | IEL-B8-5 entfällt | Test prüfte `voiceId` der (jetzt nicht mehr existenten) Pflichtsatz-Direktive |
| D6 | – | Nur Kommentare in 5 weiteren Dateien nachgezogen (`config.js`, `inbound-bridges.js`, `directives.js`, `tts/directive-synth.js`, `i18n/greeting-catalog.js`), kein Verhalten | Kommentare würden durch A3 sonst falsch |

### Offene Review-Concerns, die A3 betreffen (als Restrisiken in PLAN-SECURITY dokumentiert)
- Länge von `ownerName` vor dem Hinweis (Restrisiko nach PLAN-SECURITY IEL-B8 §6, eigene
  Owner-Entscheidung für beide Richtungen nötig).
- Fenster a2→a5 (Hinweis möglicherweise abschneidbar) — Runbook-Thema, nicht Code (M-U1 offen).
- M-U1 (Unterbrechbarkeit der Override-Eröffnung) gehört zu IEX-A6/Runbook, nicht A3.

### Kern-Design (Auszug)
- Neue reine Datei `src/i18n/inbound-opening.js`: `inboundEroeffnungDefekte({text, bundle,
  ownerName})` prüft vier Defekte — (a) `NAMENSSATZ_FEHLT`, (b) `HINWEIS_WORTLAUT_FEHLT`,
  (c) `HINWEIS_MERKMALE_FEHLEN`, (d) `PLATZHALTER` — und liefert nur Defekt-Namen (nie Werte,
  Regel 4).
- `locales.js`: `makeInboundNameSatz`, `makeNachNameSatz` (eine Zusammensetzung für Eröffnung
  UND Fehlersatz, G5), `makeInboundEroeffnung`, neue Bundle-Felder `inboundNameSatz` und
  `inboundEroeffnung`; `INBOUND_FRAGE` bleibt Modul-Konstante (D1).
- `inbound-initiation.js`: `inboundEroeffnungFuer` als EINE Quelle für Text/Sprache/Bundle/Name;
  Riegel läuft als Stufe 3b VOR der Bindung (`inboundEroeffnungsDefekteFuer`, Route) und erneut
  am fertigen Antwortkörper im Builder-Wächter (`assertAntwortSicher`/`eroeffnungsDefekteDer`).
- `webhooks-elevenlabs-init.js`: neue Stufe 3b zwischen bisheriger Stufe 3 und 4, Log-Grund
  `eroeffnung`, neue Kalibrierzeile `ms_seit_annahme`.
- `inbound-rueckfall.js`: `msSeitIso` als gemeinsame Basis für `msSeitBindung` und neues
  `msSeitAnnahme`; `elUebergabeDirektiven` liefert nur noch `[dialSip(...), redirect(...)]`
  (kein Sprech-Verb mehr davor).
- `routes/voice.js`: `sendElUebergabe` ohne `addTranscript` und ohne Pflichtsatz-Direktive.
- `PLAN-SECURITY.md`: IEL-B6 (Stufenliste + §4), IEL-B8 (Einleitung, §2, §5, §6 mit drei neuen
  Restrisiken) nachgezogen.

### Pre-Mortem (Auszug)
| Szenario | Entschärfung |
|---|---|
| Riegel schlägt fälschlich an | Kein Regex, Positiv-Kontrollen je Sprache/Name-Fall |
| Anrufer hört keinen Hinweis | Doppelter Riegel; Unterbrechbarkeit bleibt M-U1/Runbook a5 → Notaus |
| Falsche Sprache | Eine Auflösung für Text/`agent.language`/Stimme |
| Outbound kaputt | `outbound.js`, `convai.js`, `disclosure`, `call-locale.js` unverändert |
| Budget-Regression | Golden-Test |
| Benachrichtigungs-Verschiebung bei leerem Anbieter-Transkript | Bewusst getragen, als Restrisiko (iii) dokumentiert |

---

## Impl-Zusammenfassung

Auf Branch `phase/iex-a3-ein-satz-eroeffnung` (Basis master `543f8e1`), Commit `0ee69e5`.

Auf dem EL-Pfad ist `<Dial><Sip>` jetzt das erste Verb. Kein serverseitiger Pflichtsatz, keine
Transkript-Zeile mehr.
- Agent spricht als `first_message` `inboundEroeffnung(ownerName)`: Namenssatz mit
  KI-Kennzeichnung, dann unveränderter `INBOUND_NOTICES`-Hinweis, dann Frage.
- Neuer reiner Riegel `src/i18n/inbound-opening.js` mit vier Defekten, liefert nur Namen.
- Riegel greift zweimal: Init-Route Stufe 3b vor der Bindung (404, Log `grund=eroeffnung`) und
  im Builder-Wächter am tatsächlich gesendeten Körper (`eroeffnung.<defekt>`).
- Sprache, Name, Text aus einer Quelle (`inboundEroeffnungFuer`).
- Neue Bundle-Felder `inboundNameSatz`, `inboundEroeffnung`; `INBOUND_FRAGE` nur Modul-Konstante.
- `begruessungOhnePflichtsatz` entfernt.
- `msSeitIso` gemeinsame Basis für `msSeitBindung` und `msSeitAnnahme`; Logzeile
  `[el-init] gebunden` trägt jetzt `ms_seit_annahme`.
- Kommentare in den 5 D6-Dateien sowie PLAN-SECURITY (IEL-B6 Stufenliste/§4, IEL-B8 Einleitung/
  §2/§5/§6 mit 3 neuen Restrisiken) nachgezogen.

**Prüfungen:** `node --check` auf alle geänderten Dateien grün. `rg begruessungOhnePflichtsatz
src test` kein Treffer. `rg "first_message:" src` genau 2 Treffer (`inbound-initiation.js`,
`outbound.js`). Golden-Fixture unverändert. Abnahme-Dateien 62/0, zweiter Satz 46/0.
`npm test -- --test-concurrency=4`: 5866 pass / 0 fail. Keine neue Dependency, keine neue
Env-Variable, keine neue Route.

**Smoke-Test:** Boot-Guard verhinderte direkten Server-Start im Worktree (fehlende .env-Werte);
stattdessen Node-Skript über `test/helpers.js startServer`. Ergebnis: `/healthz` 200,
`/voice/incoming` 200 mit `<Response><Dial`, kein `<Say`/`<Play`; `/webhooks/elevenlabs/init`
200 mit korrektem `first_message`; Log `[el-init] gebunden call=<id> ms_seit_annahme=9`. Kein
echter Anruf.

### Deviations (Impl vs. Plan)

1. `test/iel-b8-weiche.test.js`: Helfer `innerXml` zusätzlich entfernt (ohne Nutzer nach Wegfall
   der `sayXml`-Erwartungen, G12) — im Plan nicht genannt.
2. `test/iel-init-webhook.test.js`: zusätzlicher Helfer `agentDerAntwort`, weil die
   projektweite ESLint-Regel G36 (Aufrufkette zu tief) den ersten Commit-Versuch für IEX-A3-8
   blockierte. Danach lief nur die Datei selbst erneut (25/0), nicht die volle Bank — die volle
   Bank (5866/0) lief vorher.
3. Tests IEX-A3-5 bis -9 wie geplant in `iel-init-webhook.test.js`; Kopfzeile nennt zusätzlich
   das Präfix IEX-A3.
4. IEL-B8-12 prüft über den Plan hinaus per Schleife auf `<Say`, `<Play`, `<Gather` — inhaltlich
   deckungsgleich mit dem Plan.
5. PLAN-SECURITY: kleine Grammatik-Korrektur ("geprüften" statt "geprüfte"); drei Restrisiken
   als eigene Aufzählungspunkte in IEL-B8 §6.

---

## Safety-Urteil

**approved: true** — testsPassIndependently, safetyGatesIntact, disclosureIntact,
authFailClosedIntact, noSecretsLeaked, scopeRespected, behaviorAsIntended: alle true.
Keine Blocker.

**Verdict:** PASS. IEX-A3 implementiert O1/O4/A2/E1/E2/E3 wie in der Spec beschrieben.

- **Handover:** `sendElUebergabe` ohne `addTranscript` und ohne Pflichtsatz-Play; `<Dial>` ist
  erstes Verb, gefolgt von `<Redirect>` (IEL-B8-12 bestätigt kein `<Say>`/`<Play>`/`<Gather>`).
- **Eröffnung:** `first_message = bundle.inboundEroeffnung(ownerName)`, Sprache/Stimme/Bundle
  aus einer Quelle (`inboundElLocaleOf`), Name aus `tenantContext`.
- **Riegel (fail-closed):** Stufe 3b vor der Bindung (404 `grund=eroeffnung`, keine Bindung,
  keine Fristen gelöscht, kein Name im Log) und erneut am fertigen Körper im Builder. Ein Wurf
  im Riegel ergibt 500 ohne Bindung → Anbieter bricht ab → Fehlersatz.
- **Riegel-Checks:** (a) Namenssatz am Anfang, (b) Hinweis wörtlich, (c) `hasInboundNotice`,
  (d) kein `{{`; O4-Form ohne Namen trägt weiterhin KI/AI/IA.
- **Wortlaut:** de/en/fr byte-exakt gegen Literale gepinnt.
- **Offenlegung/geschützte Dateien:** `claude.js`, `outbound.js`, `convai.js`, `call-locale.js`,
  `route-policy.js`, `app.js`, `package.json` unverändert. `first_message` hat genau einen
  Schreiber je Richtung (Grep-Test). Outbound-Offenlegung unangetastet.
- **Budget-Pfad:** byte-identisch (Golden-Test grün).
- **Sieben Sicherungen** in `/voice/incoming` unverändert (nur Kommentar im Diff).
- **Auth:** keine neuen Routen; Init-Token (`safeEqual`) bleibt Schritt 1.
- **Secrets:** keine neuen Secret-/PII-Ausgaben; einziger neuer Logwert `ms_seit_annahme` ist
  eine Zahl.
- **Dependencies:** keine neuen.
- **Fehlerpfade:** IEX-A2-Verhalten unverändert.
- **Docs:** PLAN-SECURITY aktualisiert (IEL-B6 3b, IEL-B8 §2/§5/§6, M-U1 offen).

**Concerns (nicht blockierend):**
1. `inboundFrage` als Modul-Konstante statt Bundle-Feld (D1/GAP-31) — kein Safety-Effekt, da
   Wortlaut byte-exakt gepinnt.
2. Layering: `src/i18n/inbound-opening.js` importiert `PLACEHOLDER_OPENER` aus
   `src/elevenlabs/outbound.js` — zieht `state-ops`, `convai` u.a. dahinter mit rein; kein
   Zyklus, aber i18n hängt jetzt von elevenlabs ab. Clean-Code-Thema, kein Safety-Thema.
3. Owner-akzeptiert (O1/A2, in PLAN-SECURITY dokumentiert): Hinweis hängt jetzt komplett davon
   ab, dass der Anbieter das `first_message`-Override respektiert, und von M-U1
   (Unterbrechungssperre für das Override, noch unbelegt). Vorher sprach der Server den Hinweis
   selbst als ununterbrechbares Play. Runbook a5 (Notaus bei ROT) muss direkt nach Deploy laufen.
4. Bis IEX-A4 (`answerOnBridge`) landet: `<Dial>` nimmt den Anruf sofort an — die Zeit bis zum
   ersten Audio ist jetzt Stille statt Pflichtsatz. Von der Spec akzeptiert (Folgephase A4).
5. Dokumentierte Verhaltensänderung: gebundener Anruf mit Status `completed` und leerem
   Anbieter-Transkript läuft jetzt in `finishCall`s fehlgeschlagen-Zweig (keine serverseitige
   Hinweis-Zeile mehr im Transkript). Kein Verstoß gegen O3, da die Übergabe erfolgreich war.
6. Reine Kommentar-Edits außerhalb der Spec-Dateiliste (`config.js`, `inbound-bridges.js`,
   `greeting-catalog.js`, `directives.js`, `directive-synth.js`) — kein Verhalten geändert.

**independentTestSummary:** Frischer Worktree, Branch `review-iex-a3` =
`phase/iex-a3-ein-satz-eroeffnung` (merge-base master `543f8e1`, 1 Commit `0ee69e5`).
`node --check` auf allen 12 geänderten src-Dateien: OK. Batch 1 (Diff-Dateien + Abnahme-Dateien,
`--test-concurrency=4`): 128 Tests, 128 pass, 0 fail. Batch 2 (indirekt betroffene EL-Inbound-
Tests): 165 Tests, 165 pass, 0 fail. Grep auf `begruessungOhnePflichtsatz`: 0 Treffer.

---

## Clean-Code-Audit

**verdict: PASS** — keine S1/S2-Befunde.

### s1 (Blocker)
Keine.

### s2 (Blocker)
Keine.

### s3 (Ausdrucksstärke, gebündelt, keine Blocker)
- Funktions-/Variablennamen konsistent deutsch und aussagekräftig (`inboundEroeffnungFuer`,
  `eroeffnungSicher`, `msSeitAnnahme`); keine Verstöße gefunden.
- Hinweis (kein Flag): `eroeffnungSicher` (Stufe 3b, `webhooks-elevenlabs-init.js`) und
  `assertAntwortSicher` (Builder) rufen beide letztlich `inboundEroeffnungDefekte` auf
  ähnlichem Text auf — keine Logik-Duplizierung (G5), sondern bewusste
  Verteidigung-in-der-Tiefe (Riegel vor UND nach der Bindung), im Code und in
  `PLAN-SECURITY.md` explizit begründet.

### s4 (Anzahl/Struktur, gebündelt, keine Blocker)
- Neue Datei `src/i18n/inbound-opening.js` nutzt Tabellen-Dispatch (`PRUEFUNGEN`) statt
  if/else-Kette (G23/G27); angemessen klein gehalten, keine Über-Fragmentierung.

### Fazit
Der Diff ersetzt den serverseitigen Pflichtsatz vor `<Dial><Sip>` durch eine vom Agenten
gesprochene Ein-Satz-Eröffnung (`first_message`), gesichert durch einen doppelten
fail-closed-Riegel (vor der Bindung an der Init-Route UND am fertigen Antwortkörper im
Builder). Alle 73 einschlägigen Tests grün; `node --check` auf allen geänderten src-Dateien
sauber. Neues Verhalten durchgehend getestet (positiv, Fehlerfälle a-d, Nicht-String
fail-closed, Log-Grund `eroeffnung`, Reihenfolge Schalter-vor-Riegel, Kalibrierzeile
`ms_seit_annahme`). `PLAN-SECURITY.md` konsistent nachgezogen inkl. offen dokumentiertem
Restrisiko M-U1 (Unterbrechbarkeit der Override-`first_message` noch unbelegt, mit
Owner-Test-Ankündigung und Notaus-Klausel).

**passNotes:** Eine Quelle für Namenssatz+Eröffnung+Fehlersatz (`makeNachNameSatz`, G5); eine
Sprach-/Stimm-Auflösung (`inboundElLocaleOf`) für Init-Antwort und Fehlersatz; Riegel liefert
nur Defekt-Namen, nie Werte (Regel 4/PII); tote Exporte (`begruessungOhnePflichtsatz`) korrekt
entfernt, keine verwaisten Imports; Log-Grund `eroeffnung` und Stufenreihenfolge in Route,
Kommentar und `PLAN-SECURITY.md` deckungsgleich; `answeredAt`/`msSeitAnnahme`-Kalibrierzeile
per eigener Testreihe (IEX-A3-9) abgesichert; `sayWithVoiceId`/Fehlersatz-Pfad unberührt und
weiterhin getestet.

**topTodos:**
1. M-U1 (Unterbrechbarkeit der Override-Eröffnung) zeitnah per Owner-Testanruf klären, wie in
   `PLAN-SECURITY.md` angekündigt — bis dahin akzeptiertes, aber offenes Risiko an der
   Offenlegungsgarantie.
2. Keine Code-Änderungen nötig vor Merge aus Clean-Code-Sicht; Review ist aus S1/S2-Sicht grün.

---

## Security-Review (final)

**approved: true**, keine Blocker.

**Verdict:** PASS (Security). Diff master..`phase/iex-a3-ein-satz-eroeffnung` (1 Commit
`0ee69e5`, 18 Dateien) geprüft. Abnahme-Tests grün, 84/84 mit `--test-concurrency=4`.
`rg begruessungOhnePflichtsatz src test` findet nichts.

Keine neue oder geänderte öffentliche Route, keine neue Env-Variable, keine neue Dependency.
`/webhooks/elevenlabs/init` behält Stufe 1 (`safeEqual` + Mindestlänge) und Stufe 2
(Bindungs-Token per `safeEqual`). Neue Stufe 3b läuft nach Token/Zuordnung/Schalter und vor
`bindInboundElConversation`, antwortet mit konstantem 404-Körper `INIT_ANTWORT.KEIN_ANRUF`, Log
nennt nur `grund=eroeffnung` und callId (kein Name/Text). Wurf im Riegel landet im vorhandenen
try/catch → generische 500 ohne Bindung, fail-closed.

Offenlegung doppelt geprüft (Stufe 3b und Builder am tatsächlich gesendeten `first_message`).
Outbound-Offenlegung, Budget-Pfad und Golden-Test nicht angefasst. Die sieben Sicherungen in
`/voice/incoming` unverändert. SIP-Passwort liest weiterhin nur `sendElUebergabe`, wird nur
gerendert. Tenant-Bestimmung in Riegel und Builder beide über `call.tenantId` des per Token
zugeordneten Calls.

**Concerns:**
1. Die Wirkung beim Anbieter lässt sich im Code nicht belegen (Override-Gewinn gegenüber
   `language_preset`, aktive Override-Berechtigung, Unterbrechungssperre = M-U1). Prüfung liegt
   jetzt beim Owner-Test #2. Runbook muss Notaus bei ROT wirklich auslösen; Deploy für gepinnte
   Tenants darf nicht vor diesem Test live gehen.
2. `ownerName` nicht längenbegrenzt, steht vor dem Hinweis. Tenant kann nur eigene Anrufer
   betreffen, Kosten auf eigener Decke. KI-Kennzeichnung/Hinweis folgen trotzdem per Riegel. In
   PLAN-SECURITY dokumentiert, benannte Obergrenze (Defekt e) wäre die saubere Härtung.
3. Name mit `{{` sperrt Inbound für den eigenen Tenant komplett (Fehlersatz bei jedem Anruf) —
   fail-closed korrekt, aber stiller Selbst-DoS ohne Dashboard-Hinweis, nur im Log sichtbar.
4. Server schreibt nicht mehr selbst ins Transkript, dass der Hinweis gesprochen wurde — als
   Art.-50-Nachweis bleibt nur das Anbieter-Transkript. Bei leerem Anbieter-Transkript läuft
   `finishCall` in den Zweig "fehlgeschlagen" (dokumentiert in PLAN-SECURITY IEL-B8 §6).

---

## Fix-Runden

Keine Fix-Runden nötig — Review lief PASS ohne Blocker in beiden Reviews (Safety und
Clean-Code) sowie im separaten Security-Review, direkt nach Implementierung.
