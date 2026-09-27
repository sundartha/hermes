# Phase E9 — Rechtstexte: Falschaussagen korrigieren, Auftragsverarbeiter nennen

**Gate:** PASS
**finalBranch:** `phase/openai-e9-rechtstexte-fix1`
**headCommit (Impl):** `77fe671b80c01db2b2df2971e2cde32c4f86a2af`
**Grundlage:** `tasks/openai-e9-spec.md` (autoritativ), `tasks/openai-fix/S7-rechtstexte.md` (Ermittlung), `PLAN-OPENAI.md` Etappe 9, `.claude/refs/clean-code.md`

---

## Plan (gekürzt)

Ausgangslage: `privacy.de.json` (5x `[OFFEN:`), `imprint.de.json` (6x), `terms.de.json` (5x). GAP-15 ist nur wegen fehlender `*.en.json` rot (Assertion "0 Platzhalter-Treffer" bereits grün, muss grün bleiben).

**Bewusste Abweichungen von der Spec (vorab benannt):**

| # | Spec sagt | Plan macht | Warum |
|---|---|---|---|
| D-a | Test T4: `indexLegalContent` akzeptiert alle drei Dateien | Kein neuer Test, Verweis-Kommentar | `test/legal-content.test.js` deckt das bereits ("Echtdaten-Gate"); zweiter identischer Fall wäre G5-Duplizierung |
| D-b | Marker enthält interne Kennung `OE-4`/`OE-5` | Marker benennt nur den Betreiber als Schließenden | Interne Ticket-Kennungen gehören nicht in einen zu veröffentlichenden Rechtstext |
| D-c | Marker nennt `npm run elevenlabs:drift` | Marker sagt „Messung an der Live-Konfiguration des Anbieters" | Ein Shell-Kommando ist Betriebs-, kein Rechtstext |
| D-d | A1-Tabelle listet Microsoft/Azure nicht mehr | Azure-Satz entfällt, Ersatzsatz: „Telnyx setzt eigene Unterauftragsverarbeiter ein; die Liste führt der Anbieter" | Azure-Behauptung am Code nicht belegbar (U-4 UNKNOWN); ersatzloses Streichen würde Existenz von Unterauftragsverarbeitern verschweigen |

**Umfang:** Neue Testdatei `test/openai-e9-rechtstexte.test.js` (4 Regressionsfälle + 2 Abnahmekriterien ABNAHME-E9-1/2, bewusst rot). Edits: `privacy.de.json` (A1–A7, ein Zug: note, Daten aus Anrufen, Empfänger/Auftragsverarbeiter komplett neu inkl. DeepSeek/Exa, neuer Abschnitt "Anbindung an einen KI-Assistenten", Übermittlung in Drittländer, Speicherdauer, Deine Rechte), `PLAN-SECURITY.md` (2 neue Einträge: E9-LOESCHWEG, E9-ANBIETER-RETENTION), `render.yaml`/`.env.example` (je 3 reine Kommentarzeilen, kein Wert geändert). `imprint.de.json`/`terms.de.json` bleiben byte-identisch (OE-1/OE-7 fehlen).

**Pre-Mortem-Punkte:** DeepSeek ohne AVV → `[OFFEN:`-Marke bleibt, Merge≠Veröffentlichung; abgeschaltete, aber genannte Empfänger → Zweck an Funktionsschalter gebunden; T1 wird bei Adapter-Refactoring gewollt rot (Textzeile+Karteneintrag als Fix, kein Abschalten); Löschweg-Lücke → als offener Posten (Träger Etappe 10) dokumentiert statt versteckt; `retention_days=-1` → als Launch-Blocker eingetragen, nicht verschwiegen.

---

## Impl-Zusammenfassung

Phase exakt gemäß Plan umgesetzt, lokal committed auf `phase/openai-e9-rechtstexte` (77fe671), kein Push/Merge/Deploy.

**Edits (`git diff --stat` matched Plan exakt, 5 Dateien, imprint/terms nicht genannt):**
- `privacy.de.json`: A7 (note), A2 (Audio-Mitschnitt beim EL-Anbieter), A1 (Empfänger/Auftragsverarbeiter komplett neu: ElevenLabs führt das Gespräch statt nur Sprachsynthese, DeepSeek + Exa neu genannt, Microsoft/Azure- und Zoho-Nennung entfernt/ersetzt gemäß D-d), A5 (neuer Abschnitt "Anbindung an einen KI-Assistenten"), A6 (Übermittlung in Drittländer: ElevenLabs vor Anthropic, DeepSeek/Exa/MCP-Host als neue OFFEN-Marke), A3 (Speicherdauer: EL-Retention -1 Tage gemessen 20.09.2026), A4 (Deine Rechte: Löschumfang auf `eraseTenantData`-Realität zurückgeschnitten). Markenzählung: imprint 6→6, terms 5→5 (unverändert), privacy 5→9 (+4).
- `PLAN-SECURITY.md`: zwei neue Einträge (E9-LOESCHWEG, E9-ANBIETER-RETENTION mit `retention_days=-1` als Launch-Blocker).
- `render.yaml`/`.env.example`: je 3 reine Kommentarzeilen vor RESEARCH_ENABLED/LOOKUP_ENABLED/IN_CALL_CONSULT_ENABLED, kein Wert geändert.
- `test/openai-e9-rechtstexte.test.js` (neu): 4 Regressionsfälle (Anbieter-Naht gegen die 4 gebauten Adapter, Negativ-Kontrolle, keine widerlegte Aussage mehr, Assistenten-Abschnitt) + 2 Abnahmekriterien.

Abweichungen D-a bis D-d wie im Plan benannt umgesetzt.

**Verifikation:** `node --check`, alle drei legal-JSONs valide; `npm test` (--test-concurrency=4): 6151 Tests, 0 fail; `npm run test:abnahme`: 13/16 erfüllt, 3 rot (1 unveränderter Altfall ABNAHME-AS10 + die 2 neuen E9-Kriterien, erwartet); `npm run lint`: 0 Fehler; Astro-Build (mit `PUBLIC_GATEWAY_URL` gesetzt): Exit 0, alle 11 Seiten inkl. `/datenschutz`; `git diff --stat`: exakt die erwarteten Dateien, imprint/terms nicht genannt.

**Deviations (Impl-Runde, zusätzlich zu D-a bis D-d):**
- Astro-Build-Smoke brauchte lokal `PUBLIC_GATEWAY_URL` als Dummy-Env (pre-existing fail-closed-Verhalten, unabhängig von dieser Änderung).
- Server-Boot-Smoke nicht durchgeführt: lokale `.env` fehlt `ANTHROPIC_API_KEY`/`PUBLIC_URL`; kein Blocker, da diese Etappe keinen Laufzeitpfad berührt (nur JSON/Test/Doku).

---

## Safety-Urteil

**approved: true** — alle Kern-Checks (testsPassIndependently, safetyGatesIntact, disclosureIntact, authFailClosedIntact, noSecretsLeaked, scopeRespected, behaviorAsIntended) erfüllt, keine Blocker.

**Unabhängige Verifikation:** `npm test` (frischer Worktree, review-e9-r1 = fix1-Branch): 6173 Tests, 0 fail, inkl. der 6 neuen E9-Fälle grün. `npm run test:abnahme`: 718 Tests, 3 rot (E9-1/E9-2 by design + Altfall ABNAHME-AS10), Schlusszeile "13 von 16". `npm run test:gates`: 783 Tests, 3 rot (GAP-15 EN-Fassung fehlt — Bestandsgrund unverändert — plus unverwandte GAP-05/E2E-03); Platzhalter-Assertion von GAP-15 bleibt grün. Astro-Build mit `PUBLIC_GATEWAY_URL` grün. Diff `master..fix1`: genau 5 Dateien, **keine** unter `src/`, keine package.json-Änderung.

**Concerns (nicht blockierend):**
1. Neuer Abschnitt "Anbindung an einen KI-Assistenten" nennt nicht die Rufnummer/Kennung der Gegenstelle, die über MCP tatsächlich hinausgeht (`mcp-tools.js` `pickCall`→`counterparty`, `INBOX_ENTRY`→`caller`) — spec-konform (A5 listet genau vier Punkte), aber sachliche Lücke; gehört nach Etappe 10 oder in Owner-Prüfung vor Veröffentlichung. Gleiche Lücke im Drittländer-Abschnitt.
2. Zusage "Audio-Mitschnitt beim Plattform-Anbieter abgeschaltet" beruht auf Owner-Messung vom 20.09.2026, nicht unabhängig nachmessbar im Review; Anbieter-Default ist `true` (Dashboard-Klick kann lautlos umdrehen); einziger Wächter ist manueller `npm run elevenlabs:drift`. Empfehlung: Drift-Lauf als Pflichtschritt vor jedem Live-Schalten im RUNBOOK verankern.
3. Text stellt öffentlich fest, dass Aufbewahrung beim Plattform-Anbieter auf -1 (unbegrenzt) steht — wahr und transparent, aber zugleich der in `PLAN-SECURITY.md` eingetragene Launch-Blocker; Veröffentlichung vor Rückdrehen publiziert diese Aussage. Owner-Entscheidung, kein Review-Blocker.
4. Spec-Abweichung T4 (kein eigener `indexLegalContent`-Mechanik-Test) geprüft und bestätigt: `test/legal-content.test.js:138` "Echtdaten-Gate" deckt dieselbe Funktion über die drei realen JSON-Dateien ab. Vertretbar.
5. Abnahmekommando `npm --prefix apps/web run build` schlägt ohne gesetztes `PUBLIC_GATEWAY_URL` fehl (pre-existing, nichts mit E9 zu tun) — wer das blind abfährt, hält E9 fälschlich für rot.

**Fachlich gegengeprüft und bestätigt:** letzte 6 Transkriptzeilen über `get_call_status` (`mcp-tools.js:169`), `get_transcript` gibt nie das Roh-Transkript, `eraseTenantData`-Umfang inkl. unangetasteter settings/profiles/numbers/calendar/usage (`state-ops.js:534-560`), Teil-Export hinter `internalOnly` (`api-read.js:119`), Azure-Stimmen auf dem Telnyx-Weg (`render.js:48-51`), Exa als In-Call-Suchadapter.

---

## Clean-Code-Audit (s1–s4)

**Ergebnis: s1=[], s2=[], s3=[], s4=[] — blocker: false — PASS**

Geprüft: `.env.example`, `render.yaml`, `PLAN-SECURITY.md`, `privacy.de.json`, `test/openai-e9-rechtstexte.test.js`.

Notizen:
- Kein Produktionscode verändert; nur Rechtstext, Doku und synchron gehaltene Kommentare in `.env.example`/`render.yaml` (Repo-Konvention: absichtliche Spiegelung, keine Duplizierung im S2-Sinn).
- Neuer Test deckt neues Verhalten (Anbieter-Adapter-Naht mit Negativ-Kontrolle, Regressionsschutz gegen die drei widerlegten Vor-E9-Aussagen — verifiziert scharf, nicht leer bestehend — neuer Abschnitt "Anbindung an einen KI-Assistenten").
- Bewusst kein eigener Mechanik-Test für `indexLegalContent` (D-a); Verweis auf `test/legal-content.test.js` verifiziert, vermeidet G5-Duplizierung.
- JSON-/JS-Syntax beider geänderten/neuen Dateien fehlerfrei (`node --check`, JSON-Parse).
- Zweibahnen-Aufteilung (Regressionsbank vs. ABNAHME-E9-1/2) folgt korrekt dem Katalog-ID-Präfix-Muster.
- Fix-Commit `c952a90` behebt zwei echte S1-Funde aus vorheriger Review-Runde (Zoho-Widerspruch, fehlendes Microsoft/Azure) sauber mit Codebeleg statt Vermutung.
- `PLAN-SECURITY.md`-Ergänzung hält offene Lücken transparent fest statt sie zu verstecken.

---

## Fix-Runden

**r1:** Beide Review-Blocker in `privacy.de.json` (Abschnitt "Empfänger und Auftragsverarbeiter" / "Übermittlung in Drittländer") behoben:

1. Zoho-Widerspruch: „Brevo und Zoho verarbeiten in der EU" behauptete einen bekannten Verarbeitungsort für den SMTP-Ersatzweg-Anbieter, obwohl dieser laut Plan/D-c unbekannt ist bzw. `[OFFEN:`-markiert bleiben muss — korrigiert.
2. Fehlendes Microsoft/Azure gemäß D-d: Azure-Satz durch generischen Unterauftragsverarbeiter-Satz für Telnyx ersetzt.

Fix-Commit `c952a90`, verifiziert durch Codebeleg statt Vermutung; anschließend Safety- und Clean-Code-Review final: PASS.

---

## Offene Punkte (nicht Teil dieser Etappe)

- U-4 (Azure als Unterauftragsverarbeiter): weiterhin UNKNOWN, bewusst durch generischen Satz ersetzt (D-d).
- OE-7-Folgeänderung im Buchungsvorgang: offen.
- OE-9 (EN-Fassungen der Rechtstexte): offen, GAP-15 bleibt aus demselben Grund rot.
- E9-LOESCHWEG (`PLAN-SECURITY.md`): Löschweg deckt weniger ab als der alte Rechtstext versprach; kein Netz-Endpunkt, kein Audit-Eintrag, Anbieterseite nicht erfasst. Träger: Etappe 10.
- E9-ANBIETER-RETENTION (`PLAN-SECURITY.md`): `retention_days=-1` beim Plattform-Anbieter — **Launch-Blocker vor erstem Fremdkunden**. Fix: `npm run elevenlabs:push`.
- Veröffentlichung der Website bleibt getrennter Owner-Schritt mit Rechtsprüfung; Merge ist nicht Veröffentlichung.
