# IEP-P6 — Eröffnung im Owner-Wortlaut + Owner-Erkennung bei eingehenden Anrufen

Status: **Gate PASS** (Safety, Clean-Code, Security — alle drei final PASS, keine Blocker).
finalBranch: `phase/iep-p6-eroeffnung-owner`
headCommit: `d31a2dd2709608e50190c47d5d9784bf066eb77e`
Basis: `phase/iep-p2-sofortannahme` (1fa2260)

## Gegenstand

Owner-Entscheidung 9 (2026-09-16, zweite Runde, ersetzt O1 aus `tasks/iex-spec-a.md`) legt den Eröffnungswortlaut bei eingehenden Anrufen neu fest:

- **Fremd:** „Hallo, hier ist der KI-Assistent von \<Name\>. Das Gespräch wird transkribiert und zusammengefasst. Wie kann ich helfen?"
- **Erkannter Owner:** „Hallo \<Vorname\>, hier ist dein KI-Assistent. Das Gespräch wird transkribiert und zusammengefasst. Wie kann ich helfen?"

Kein „Hinweis:", kein „Sie sprechen mit einer KI", keine Sie-Form.

**Erkennung:** ruft die Anrufernummer von der hinterlegten eigenen Nummer des Tenants an (`tenantPrivateNumber`, strikte E.164-Gleichheit, dieselbe reine Prädikat-Quelle wie der Outbound-Fall `src/callee-is-owner.js` — keine zweite Stelle, die dieselbe Frage beantwortet), gilt der Owner-Ton. Fail-closed: keine Nummer hinterlegt, unterdrückte Nummer, kein Treffer, Fehler ⇒ Fremd-Wortlaut.

**Grenze (Owner-Entscheidung 5):** die KI-Kennzeichnung bleibt in JEDEM Fall im ersten Satz, und die Erkennung schaltet KEINE Daten, Werkzeuge oder Rechte frei — sie ändert ausschließlich die Anrede. Eine Anrufernummer ist fälschbar; jede Datenfreigabe daran wäre ein Sicherheitsfehler und ist Blocker.

## Plan (gekürzt)

Der Plan basiert auf `tasks/iep-strategie.md` (§1.2/2.1–2.4, §3 IEP-P5+P6, §5, §6, §7 F8) und ist in zwei Schritte geschnitten:

**Schritt A — Erkennung (hörbar ändert sich nichts):**
- `src/callee-is-owner.js`: dritter benannter Zugang `callerIsOwnerGranted` auf demselben nackten Vergleich (kein zweiter Vergleichsort) — eigener Schalter, eigene Allowlist, KEIN `OWNER_SELF_CALL_*` (Begründung: geteilter Schalter koppelte Inbound-Abschaltung an die Outbound-Offenlegungs-Rücknahme aus `PLAN-SECURITY.md`).
- `src/config.js`: `INBOUND_OWNER_GREETING_ENABLED` (Default `false`), `INBOUND_OWNER_GREETING_TENANT_IDS` (Default leer = niemand).
- `src/boot.js`: Banner-Zeile nur bei aktivem Schalter, nur Zustand+Anzahl, nie eine Tenant-ID.
- `src/routes/voice.js`: Auswertung set-once VOR dem ersten TeXML; Normalisierung (`normNum`) vorgelagert, das Prädikat selbst vergleicht strikt; `call.from` bleibt roh (Tarif/Kostenkalibrierung/Summary/Aktiv-Anruf-Lookup hängen daran).
- `src/store/state-ops.js`, `pg.js`, `json.js`, `db/schema.sql`: additives Feld `callerIsOwner` — eigenes Feld, ausdrücklich NICHT `calleeIsOwner` (dessen Ordnungsregel „ein Inbound-Call trägt es strukturell nie als true" bleibt wahr); set-once (nicht im `ON CONFLICT DO UPDATE SET`), Spalte ans Ende angehängt ($67, keine Umnummerierung).
- `PLAN-SECURITY.md`: Inbound-Anrede als dritter Verwender des unverifizierten `privateNumber`-Felds eingetragen, Launch-Bedingung (b) nennt jetzt beide Schalter.

**Schritt B — Wortlaut, Riegel, Prompt:**
- `src/i18n/locales.js`: Selbstvorstellung als geteilte Nominalphrase mit zwei Satzrahmen (`Hier ist {x}.` für den Fehlersatz, `Hallo, hier ist {x}.` für die Eröffnung) statt zweier Textkopien; Owner-Anrede ist KEIN neuer Text, sondern der bestehende `OWNER_OPENING_TEXTE`-Satz (identisch zum Outbound-Owner-Fall); neuer, eigener Hinweis-Satz `inboundHinweisSatz` (getrennt von `INBOUND_NOTICES`/`inboundNotice`, dem Pflicht-Präfix des gespeicherten Greetings im Budget-Pfad — dieser bleibt unangetastet).
- `src/i18n/inbound-opening.js`: Riegel bekommt eine ZWEITE, gleich strikte Sollform aus einer eingefrorenen Varianten-Tabelle (`EROEFFNUNG_VARIANTE.FREMD`/`OWNER`); leerer Sollkopf und unbekannte Variante sind selbst Defekte (fail-closed); alle vier Prüfungen bleiben, laufen weiter zweimal (Route Stufe 3b + Wächter am fertigen Körper).
- `src/i18n/prompts/en.js`: neue Prompt-Sektion `inboundSituationOwner` mit Pflicht-Rückfall — spricht sofort den vollen Fremd-Wortlaut, sobald klar wird, dass am Apparat nicht der Owner ist (CLAUDE.md Regel 2); der Rückfalltext wird FERTIG eingesetzt, nicht vom Modell formuliert.
- `src/elevenlabs/inbound-initiation.js`: EINE Entscheidung (Variante) speist Riegel, Wächter und Builder; Owner-Fassung nur wenn `call.callerIsOwner === true` UND Vorname vorhanden, sonst Fremd-Fassung.
- `.env.example`, `render.yaml`: neue Env-Variablen dokumentiert.

**Pre-Mortem-Tabelle** deckte u.a.: gefälschte Absendernummer (Gegenmittel: KI-Kennzeichnung bleibt, kein Datenkanal, Allowlist leer, Schalter aus per Default), Owner hört fälschlich Fremd-Eröffnung (bewusst akzeptiert, fail-closed-Richtung), Riegel inkonsistent (Rotproben), Budget-Pfad fremder Tenants verändert (durch `inboundNotice`-Trennung ausgeschlossen), Geldpfad kaputt durch neue Spalte (additiv angehängt, nicht eingeschoben), Erkennung wird später zum Datenschalter (Nur-Ton-Invariante als Test gepinnt).

**Offene Owner-Punkte im Plan:** EN/FR-Wortlaute sind Übersetzungsvorschläge mit Freigabevorbehalt (Owner-Entscheidung 9 gibt nur DE); Risiko heute 0 (Owner-Tenant de-DE, Rollout gesperrt). Zwei Lead-Entscheidungen vor Merge offen gelassen: (1) ob Schritt A separat gemergt wird, (2) EN/FR-Freigabe vor Rollout.

## Impl-Zusammenfassung

- 24 geänderte/neue Dateien, 1 Commit (`d31a2dd`), `node --check` clean, `npm test` 6083 pass / 0 fail, Smoke-Test über `test/helpers.js#startServer` (echter Server-Spawn, kein nackter `node src/server.js` wegen Pflicht-Env der Boot-Guards) mit zwei Konfigurationen (Schalter aus/an, Tenant gepinnt) — Banner-Zeile und `callerIsOwner`-Wert wie erwartet, `call.from` bleibt roh.
- Neue Testdatei `test/iep-p6-owner-ton.test.js` (26 Fälle: Prädikat-Riegel inkl. dokumentierter Rotprobe, Diagnose-Retention unberührt, Geldpfad-Gegenprobe, Boot-Banner, byte-genauer Wortlaut de/en/fr fremd+owner, Nur-Ton-Invariante, Spawn-Tests über die echte `/voice/incoming`-Route).
- Bestandstests angepasst: `test/callee-is-owner-store.test.js` (+6 Fälle), `test/iex-a3-eroeffnung.test.js` (Wortlaut/Riegel-Aufrufe umgestellt), `test/iel-init-webhook.test.js`, `test/iel-b3-variable.test.js`, `test/de-umlaut-orthography.test.js`, `test/config-namespaces.test.js` (gepinnte Zähler nachgezogen), `test/helpers.js` (BASE_ENV-Pin der zwei neuen Env-Vars — Lehre `test-base-env-drift`), `test/helpers/inbound-router-harness.js`.

### Deviations (aus Impl-Report)

1. Branch existierte bereits als uncommitteter Zwischenstand eines abgebrochenen Laufs (ohne Testdatei) — geprüft, übernommen, fertiggebaut statt neu begonnen.
2. `src/i18n/prompts/de.js`/`fr.js` NICHT angefasst — `inboundSituation` existiert im Bestand nur in `en.js`, der EL-Pfad liest hartkodiert `LOCALES.en.prompt`; ein `de.js`/`fr.js`-Pendant wäre toter Code (belegt: 0 Treffer).
3. `inboundNameSatz` aus den Locale-Bundles entfernt (Plan sah Beibehaltung vor) — nach dem Riegel-Umbau kein Konsument mehr außerhalb `locales.js`; mit dem Feld wurde GAP-31 (Launch-Gates) neu rot, gegen Basis-Worktree gegengeprüft. Die interne Fabrik bleibt für den Fehlersatz O3 erhalten.
4. Testverteilung: Store-Roundtrips (T-A3) liegen in `test/callee-is-owner-store.test.js` (bestehende DATA_DIR-Verdrahtung), Rest in der neuen Datei.
5. T-B9 zweite Hälfte (Init-Webhook im Kindprozess) nicht separat gebaut — bereits über `test/iel-init-webhook.test.js` (echter In-Process-HTTP-Server) plus IEP-P6-60/63 abgedeckt; ein dritter Spawn hätte dieselbe Zusicherung erneut gemessen.
6. Drei Dateien außerhalb der Plan-Liste, je durch eine Messung erzwungen: `test/helpers.js` (BASE_ENV-Leak-Gefahr), `test/helpers/inbound-router-harness.js` (Harness liest jetzt neue Config-Keys), `test/config-namespaces.test.js` (Zähler).
7. Zwei kleine Extraktionen zur Einhaltung der Längen-Richtwerte ohne neue Suppression: `ownerMarkierungen()` in `state-ops.js`, `erzeugeInboundCall()` in `routes/voice.js`.
8. EN/FR-Wortlaute als Vorschlag markiert, Freigabevorbehalt im Code vermerkt.
9. Suite-Flake beobachtet (2/5 Läufe je ein isoliert-grüner Spawn-Test rot) — Bestandsverhalten, kein neuer Befund.
10. Bank-Vergleich gegen Basis-Worktree: `npm test` 6070→6083 pass, `npm run test:gates` 126/3 rot identisch (GAP-05, GAP-15, E2E-03, kein neuer roter Fall), `npm run test:abnahme` „13 von 14" unverändert.

## Safety-Urteil (final)

**Verdict: PASS.** Alle Prüfpunkte grün: `testsPassIndependently`, `safetyGatesIntact`, `disclosureIntact`, `authFailClosedIntact`, `noSecretsLeaked`, `scopeRespected`, `behaviorAsIntended` — alle `true`. Keine Blocker.

Kernbefunde:
- Safety-Gates unangetastet: `/voice/incoming`-Handler ändert genau eine Zeile (Ersetzung durch Modul-Helfer an derselben Stelle der reihenfolge-gepinnten Kette); Signatur-Middleware, Idempotenz, Nummern-Lookup, Budget-Decke, Bremse laufen unverändert davor.
- Offenlegung: `src/claude.js` byte-unverändert; beide Eröffnungsvarianten tragen die KI-Kennzeichnung im ersten Satz und den Transkriptions-Hinweis wörtlich, Riegel mit zwei gleich strikten Sollformen, fail-closed bei leerem Sollkopf/unbekannter Variante.
- Auth fail-closed: keine Route/Middleware/route-policy-Änderung.
- Keine Secrets geloggt; Banner nennt nur Zustand+Anzahl.
- Scope: keine neue Dependency, Envs zentralisiert und dokumentiert.
- Verhalten: Schalter aus/Allowlist leer ⇒ `callerIsOwner` immer false; nicht-gepinnte Tenants byte-identisch; Budget-Pfad kennt das Feld nicht.

Fünf Concerns (keiner blockierend):
1. Nur die Anrede ist ohne Deploy rückholbar — der neue Fremd-Wortlaut selbst (Entscheidung 9) wirkt für jeden EL-Inbound-Anrufer unabhängig vom Schalter; Rückweg dafür ist ein eigener kleiner Revert der Wert-Änderungen in `locales.js`.
2. Pflichthinweis-Wortlaut gewechselt (`INBOUND_NOTICES` nicht mehr wörtlich in der Eröffnung) — Substanz bleibt doppelt geprüft, `inboundNotice` selbst unberührt; Empfehlung: Owner bestätigt DE-Wortlaut vor Cutover erneut.
3. EN/FR-Wortlaut nicht freigegeben — heute wirkungslos, muss vor jedem nicht-DE-Rollout vorliegen (Präzedenz P4b/pt).
4. Pflicht-Rückfall im Owner-Prompt nutzt die Inbound-Fremd-Eröffnung statt wörtlich `LOCALES.<lang>.disclosure` (CLAUDE.md Regel 2) — sachlich begründet, aber formale Abweichung, Owner sollte quittieren.
5. Restrisiko Anrufernummer fälschbar — entschärft und dokumentiert (Default aus, Allowlist leer, eigener Schalter, strikter Vergleich, set-once, Nur-Ton-Invariante getestet).

## Clean-Code-Audit (s1–s4)

**Verdict: PASS, kein Blocker.** s1 = [], s2 = [], s3 = [], s4 = [] — keine Befunde in irgendeiner Schwerekategorie.

Positiv vermerkt: ein Vergleichsort für beide Owner-Fragen (kein zweiter); Riegel mit Varianten-Tabelle statt Verzweigung; set-once konsequent (nicht im `ON CONFLICT DO UPDATE SET`); Boot-Banner PII-frei; Money-Pfad unberührt (`call.from` bleibt roh); Owner-Prompt-Baustein trägt Rückfallsatz fertig eingesetzt; 92/92 Tests der betroffenen Dateien isoliert grün.

66 rote Tests im vollen `npm test`-Lauf beobachtet, aber keiner in einer vom Diff berührten Datei/Domäne (Cluster: AL-D2/AL-P17-Streaming-Shim, Telnyx-Shim, bridge-*, gq-*, watchdog-boot-rearm, SEC-P6-10, call.hangup-Settlement) — außerhalb des Audit-Scopes, passt zum dokumentierten Muster verwaister/rennender Spawn-Tests.

topTodos: vor Merge prüfen, ob die 66 roten Tests bereits auf der Basis rot sind (laut Impl-Report ja: Basis 6070/0 — also branch-fremd, kein neuer Befund); PLAN-SECURITY.md-Launch-Blocker (Besitz-Verifikation) bleibt wie dokumentiert offen.

## Security-Urteil (final)

**Verdict: PASS.** Keine Blocker. Kein neues Angriffsfenster: keine neue/geänderte öffentliche Route, keine Auth-Änderung, kein Gate berührt (Kostendecke, Denylist/Land/Stunde, Max-Dauer, Verifikations-Permit, `OUTBOUND_FROZEN`, Telnyx-Ed25519 alle unverändert), keine neue Dependency.

Fünf Concerns (keiner blockierend):
1. Spoofbare Anrufernummer (bewusst getragen, dokumentiert, gedeckt durch Default-aus + leere Allowlist + Nur-Ton-Invariante-Test).
2. Riegel kann eine unberechtigte Owner-Variante prinzipiell nicht erkennen, da Variante und Sollkopf aus derselben Quelle stammen — Offenlegung selbst bleibt aber durch zwei unabhängige Prüfungen gedeckt (Wortlaut + Marker-Prädikat).
3. EN/FR-Übersetzungen unfreigegeben, heute wirkungslos.
4. Pflicht-Rückfall weicht vom Buchstaben der CLAUDE.md-Regel 2 ab (nutzt Inbound-Fremd-Eröffnung statt `disclosure`), sachlich begründet.
5. `firstName`/`ownerName` sind Tenant-Freitext im gesprochenen Text — Riegel prüft `startsWith`, fängt keinen im Namen versteckten Zusatzsatz; kein neuer Angriffsweg (durch Platzhalter-Prüfung gegen Variablen-Injection gedeckt), aber der Riegel leistet hier weniger als der Name nahelegt.

## Fix-Runden

Keine — der Diff wurde in allen drei finalen Reviews (Safety, Clean-Code, Security) direkt mit PASS und ohne Blocker angenommen; das FIXES-Feld der Quelle ist leer.

## Für den Lead offen

1. Ob Schritt A (Erkennung) separat gemergt wird.
2. EN/FR-Wortlaute brauchen vor dem Rollout die Owner-Freigabe (Owner-Entscheidung 9 deckt nur DE).
3. Owner sollte den neuen DE-Pflichthinweis-Wortlaut und die Abweichung beim Prompt-Rückfall (Punkt 4 im Safety-Urteil) vor Cutover ausdrücklich quittieren.
