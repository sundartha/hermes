# IEP-P0 - Delta-Tabelle Test #1 (9917db7) -> Test #2 (52530ce)

Rein lesende Analyse, keine Aenderung an Code/Prod/Env/EL/Telnyx. Quelle: `git diff 9917db7 52530ce`.
Hintergrund/Praemissen in `tasks/iep-strategie.md`, `tasks/todo.md` ("Owner-Test #2 durchgefallen").
Wird hier nicht wiederholt.

## 0. Umfang

`git diff --stat 9917db7 52530ce`: 117 Dateien, +9563/-1269. Davon 22 Dateien auf dem
Anrufweg (`src/elevenlabs`, `src/routes/voice.js`, `src/routes/webhooks-elevenlabs-init.js`,
`src/i18n`, `src/telephony`) - diese sind unten vollstaendig durchgegangen. Der Rest ist der
gemergte fremde Web-/Billing-Strang (`apps/web/**`, `package.json`, `render.yaml`,
`src/billing/payment-method-type-reconcile.js`, `src/billing/provision-retry-sweep.js`,
`src/db/schema.sql`, `src/onboarding.js`, `src/worker/provisioning-orchestrator.js`,
`scripts/reconcile-payment-method-types.js`, Teile von `src/self-service-routes.js`): reine
Dashboard-/Zahlungs-/Provisioning-Anzeige fuer NEUE Nummern, keine Beruehrung des Anrufwegs
einer bereits aktiven DID. Kurz eingeordnet, nicht vertieft (Auftrag).

`src/routes/webhooks-elevenlabs.js` (der laufende Turn-/Werkzeug-Loop WAEHREND einer bereits
gebundenen EL-Bruecke) hat **keinen Diff** zwischen den beiden Commits - wichtig fuer die
Einordnung unten: nichts an der Mitte des Gespraechs hat sich geaendert.

## 1. Delta-Tabelle (verhaltensrelevant)

| # | Datei:Zeile | vorher -> jetzt | Wirkung | Einstufung |
|---|---|---|---|---|
| D1 | `src/elevenlabs/inbound-rueckfall.js:35` (`EL_DIAL_ANSWER_ON_BRIDGE`) | kein Attribut (Bein wird beim `<Dial>` sofort beantwortet) -> hartkodiert `true`, kein Env-Schalter | Das eingehende Bein bleibt bis zur SIP-Annahme durch EL unbeantwortet; der Anrufer hoert bis dahin das Freizeichen SEINES eigenen Netzes statt sofortiger Stille/Annahme. Belegt: 1,56 s unbeantwortetes Fenster in Test #2 (B4), 1,03 s Annahme in Test #1 | **HOERBAR** (B4/B9 bereits gemessen, keine neue Vermutung) |
| D2 | `src/telephony/adapters/telnyx/render.js:172-177` (`answerOnBridgeAttr`) | kein Attribut am gerenderten `<Dial><Sip>` -> `answerOnBridge="true"` wenn D1 gesetzt ist | Reine Traeger-Mechanik von D1, keine eigene Wirkung | HOERBAR nur als Traeger von D1 |
| D3 | `src/elevenlabs/inbound-initiation.js:139` (`inboundOverride`/`first_message`) | `begruessungOhnePflichtsatz({greeting: gespeicherteBegruessungFuer(...)})` - die INDIVIDUELL hinterlegte Tenant-Begruessung (Pflichtsatz-Praefix entfernt) -> `bundle.inboundEroeffnung(ownerName)`, ein FESTER dreiteiliger Vorlagensatz: Namenssatz + Hinweis-Wortlaut + Frage (`src/i18n/locales.js:274-278` DE) | Anrufer hoert eine andere, generische statt der individuellen Eroeffnung. Owner selbst: "Abweichung nur gegenueber Runde 1 (EIN Satz)" - der Vorlagensatz ist laenger/foermlicher als das, was er von Test #1 in Erinnerung hat | **MOEGLICH HOERBAR** (Aenderung belegt B2, Wirkung auf "duemmer"-Eindruck unbelegt) |
| D4 | `src/routes/voice.js:137-152` (`sendElUebergabe`) + `src/elevenlabs/inbound-rueckfall.js:75-90` (`elUebergabeDirektiven`) | vor dem `<Dial>` stand `sayWithVoiceId(pflichtsatz)` (Server spricht den Pflichtsatz in Agentenstimme) + `store.addTranscript(...)` -> kein eigener Satz mehr, `<Dial>` ist das ERSTE Verb, kein Transkripteintrag von uns | Der Hinweis wandert vollstaendig in die first_message (D3); vor Bindung entsteht keine unabhaengige Server-Aeusserung mehr. Inhaltlich in D3 aufgegangen, aber die REIHENFOLGE (kein eigenes Sprechen vor der Uebergabe) ist ein weiterer Freiheitsgrad fuer D1 (ohne eigenen Satz laesst sich das Bein ueberhaupt erst unbeantwortet lassen) | HOERBAR als Voraussetzung von D1, inhaltlich = D3 |
| D5 | `src/elevenlabs/inbound-rueckfall.js` (`RUECKFALL_ENTSCHEIDUNG`) + `src/i18n/inbound-notice.js` (entfernt: `begruessungOhnePflichtsatz`, `rueckfallBegruessung`) | gescheiterte Uebergabe fuehrte zu `RUECKFALL_STARTEN` -> Budget-Gespraech (mit/ohne Pflichtsatz je nach Quelle) -> jetzt `FEHLERSATZ`: fester Fehlersatz in Agentenstimme + Auflegen, kein Budget-Gespraech mehr | Aendert NUR den Fehlerfall (Bein nie gebunden / Frist abgelaufen). Test #2 hatte eine erfolgreich gebundene Bruecke (3 Turns, `elevenlabsConversationId` gesetzt) - dieser Pfad wurde in Test #2 nicht durchlaufen | **NICHT HOERBAR** fuer Test #2 (Pfad nicht getroffen); echte Verhaltensaenderung fuer kuenftige Fehlerfaelle, gehoert nicht zur Erklaerung von #2 |
| D6 | `src/elevenlabs/inbound-path-decision.js` (`inboundElPathFor` bool -> `inboundPfadEntscheidung` dreiwertig BUDGET/ELEVENLABS/ABGEWIESEN) + `src/config.js:858` (`scope`, Default `allowlist`) | boolesche Weiche -> dreiwertige Weiche mit neuem Scope `registrierte_dids` | Fuer Scope `allowlist` (bestaetigt aktiv laut Boot-Banner "scope=allowlist" in `tasks/todo.md:67`) inhaltsgleich zum Altverhalten (`entscheidungNachAllowlist`) | NICHT HOERBAR (Scope-Bestaetigung liegt vor) |
| D7 | `src/routes/webhooks-elevenlabs-init.js` (neue Stufe 3b `eroeffnungSicher`, `initTokenSchranke` vor Body-Parsern in `src/app.js`) | Riegel prueft zusaetzlich die Eroeffnungs-Bausteine (`inboundEroeffnungsDefekteFuer`); Rate-Limit fuer den Init-Pfad eigenstaendig statt ueber den globalen Limiter | 404 bei defekter Eroeffnung (fail-closed) statt Bindung; fuer eine korrekt gebaute Eroeffnung (wie in Test #2, byte-gleich O1) kein Unterschied | NICHT HOERBAR (Riegel bestand, first_message wurde ausgeliefert - sonst haette es gar kein Gespraech gegeben) |
| D8 | `src/elevenlabs/nummern-registrierung.js`, `src/elevenlabs/inbound-trunk-beleg.js` (neu), `src/boot.js` (`inboundTrunkSweep.runBootSweep()`) | neuer lesender+ggf. schreibender Registrierungs-Beleg-Sweep fuer Scope `registrierte_dids` | Inaktiv, solange Scope `allowlist` ist (`inboundTrunkSchreibenErlaubt` prueft Scope zuerst) - kein Schreibzugriff auf die Owner-DID-Registrierung in diesem Zeitraum | NICHT HOERBAR |
| D9 | `elevenlabs/agent_configs/outbound-agent.template.json:325-329` | reine Kommentar-/Dokuzeile zu `record_voice` (Push-Absicht ab O2, 2026-09-15) | Kein Feld-Wert geaendert, keine neue PATCH-Aktion in diesem Diff selbst; die zugrunde liegende Owner-Entscheidung "record_voice=false" ist laut `tasks/todo.md` schon seit vor Test #1 wirksam (B12: "seit A5") | NICHT HOERBAR |

## 2. Unbeabsichtigte Nebenwirkungen - Suche

- **Entfernte Codepfade mit noch existierenden Aufrufern:** keine gefunden. Grep nach
  `RUECKFALL_STARTEN`, `rueckfallBegruessung`, `begruessungOhnePflichtsatz` in `src/` = 0 Treffer;
  alle drei wurden vollstaendig entfernt UND alle Aufrufer mitgezogen (`voice.js`, `inbound-notice.js`).
- **Reihenfolge-Aenderung beim Prompt-Bau:** keine. `inboundDynamicVariables()` in
  `inbound-initiation.js` ist zwischen den Commits BYTE-IDENTISCH (kein Diff-Hunk beruehrt die
  Funktion) - inkl. der bestehenden Eigenheit, `inbound_situation` immer aus
  `LOCALES.en.prompt.inboundSituation` zu bauen statt aus dem Sprach-Bundle der Anrufsprache. Das
  ist strukturell (B10: "in BEIDEN Tests, nicht neu"), keine neue Regression dieser Kette.
- **`src/i18n/prompts/en.js` (Satz "have already been said ... before you took over",
  Zeile 82):** kein Diff zwischen den Commits. Der Satz war bei Test #1 (Pflichtsatz separat
  gesprochen) UND ist bei Test #2 (Hinweis in first_message) sachlich zutreffend - keine
  Stale-Reference gefunden, dieser Verdacht (gepflegt) ist NICHT bestaetigt.
- **Defaults durch den Merge veraendert:** `ELEVENLABS_INBOUND_SCOPE`-Default ist `allowlist`
  (= Bestandsverhalten). Kein sonstiger Inbound-relevanter Default hat sich durch den Merge
  fremder Commits veraendert (die fremden Dateien beruehren `config.voice.elevenLabsInbound`
  nicht).
- **Fremder Strang beruehrt unseren Anrufweg:** nicht gefunden. `apps/web/**` ist
  Dashboard-/Marketing-Code, `src/billing/payment-method-type-reconcile.js`,
  `src/billing/provision-retry-sweep.js`, `src/onboarding.js`,
  `src/worker/provisioning-orchestrator.js` betreffen NEUE Nummern/Zahlungsmethoden, keine
  Laufzeit-Logik einer bereits aktiven, angerufenen DID. `src/self-service-routes.js` bekommt
  nur eine zusaetzliche Anzeige-Zeile (`numberStatusReason`) im Dashboard - keine Beruehrung des
  Voice-Webhooks.
- **`src/routes/webhooks-elevenlabs.js` unveraendert** (kein Eintrag im Diff-Stat): der
  laufende Turn-Loop, Werkzeug-Sperren (`consult`/`lookup`) und Interrupt-Handling WAEHREND der
  Bruecke sind zwischen den beiden Test-Staenden identisch.

## 3. Die drei Top-Verdaechtigen fuer den Qualitaetsabsturz

1. **D1 (`EL_DIAL_ANSWER_ON_BRIDGE=true`, `src/elevenlabs/inbound-rueckfall.js:35`) fuer das
   "Klingeln".** Bereits weitgehend bewiesen (B4: 1,56 s unbeantwortetes Fenster in #2 gegen
   1,03 s Annahme in #1; B9: Telnyx-eigener Ton existiert nur NACH der Annahme). Gegenprobe
   OHNE Owner-Anruf: IEP-P1-Ohrzeuge (eigene DID, Mitschnitt) vorher/nachher mit `answerOnBridge`
   `true` vs. weggelassen - wenn das unbeantwortete Fenster beim Zuruecksetzen verschwindet und
   die englische Ansage TROTZDEM bleibt, ist D1 als alleinige Erklaerung widerlegt (das deckt
   sich mit der bereits in der Strategie festgehaltenen Arithmetik: die Ansage passt nicht in
   1,56 s, liegt also VOR dem von uns kontrollierten Fenster).

2. **D3/D4 (Eroeffnungsquelle: individuelle Begruessung -> genereller Vorlagensatz) fuer den
   ersten Eindruck "duemmer".** Nicht bewiesen, aber der einzige inhaltliche Unterschied, den der
   Anrufer in den ERSTEN Sekunden tatsaechlich anders hoert (laenger, foermlicher, "Hinweis:
   Sie sprechen mit einer KI..." statt der kurzen eigenen Begruessung). Gegenprobe OHNE
   Owner-Anruf: `scripts/iel-geheimnisse-conversation.mjs --conversation-id` (Ausbau in IEP-P3)
   gegen die beiden bekannten Conversation-IDs von #1 und #2 - Turn-Zahl, Latenz je Turn und
   `interrupted`-Flags vergleichen. Zeigt sich der Bruch (3 statt 5 Turns, Unterbrechung) schon im
   ERSTEN Turn nach der Eroeffnung, spricht das FUER diesen Kandidaten; zeigt er sich erst
   spaeter im Gespraech, ist die Eroeffnung nicht die Erklaerung.

3. **Kein Diff erklaert das "duemmer" WAEHREND des Gespraechs (3 Turns, letzter unterbrochen).**
   `webhooks-elevenlabs.js` (Turn-Loop, Werkzeuge, Interrupt-Handling) ist zwischen den Commits
   unveraendert; LLM/Prompt/Stimme/Sprache/TTS sind laut Forensik identisch (B10). Das deckt sich
   mit der bestehenden Einordnung "U: durch nichts Gemessenes erklaert" - diese Analyse *bestaetigt*
   das, sie widerlegt es nicht. Falls doch eine Erklaerung gesucht wird, ist der einzige
   verbleibende Kandidat AUSSERHALB des Repo-Diffs: eine Live-Aenderung am EL-Agenten-Dashboard
   zwischen den beiden Tests (Kontoebene, gilt fuer BEIDE Richtungen). Dagegen spricht der
   Outbound-Kontrollanruf danach ("gut") - eine Kontoebene-Aenderung haette auch dort wirken
   muessen. Gegenprobe OHNE Owner-Anruf: `check-elevenlabs-drift.mjs` gegen den zum Zeitpunkt von
   Test #1 dokumentierten Feldstand (falls vorhanden) statt gegen den heutigen - zeigt eine
   Abweichung ausserhalb `first_message`, waere das ein neuer, bisher nicht erfasster Befund.

## 4. Kurz-Fazit

Von den 22 anrufweg-relevanten Dateien sind zwei Aenderungen tatsaechlich geeignet, etwas zu
erklaeren, das der Anrufer HOEREN konnte (D1 fuer das Klingeln, D3 fuer die andere Eroeffnung).
Beide sind bereits Gegenstand der geplanten Phasen (IEP-P2 bzw. IEP-P4/Owner-Entscheidung 9).
Alles Weitere in der Aenderungsmenge (Registrierungs-Beleg-Sweep, Scope-Erweiterung, Init-Rate-
Limit, Fehlersatz-statt-Budget-Rueckfall, Billing/Onboarding/Web) ist zwischen den beiden Tests
entweder inaktiv (Scope-Vorbedingung nicht erfuellt) oder betrifft einen Pfad, den Test #2 nicht
durchlaufen hat. Die "duemmer"/Stimme-Beobachtung waehrend des laufenden Gespraechs bleibt ohne
Erklaerung im Diff - dieser Befund bestaetigt die bestehende Einstufung als unbelegt, statt sie
aufzuloesen.
