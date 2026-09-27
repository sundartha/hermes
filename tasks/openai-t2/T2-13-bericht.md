# T2-13 — Geldpfad: serverseitige Bestätigung vor dem Wählen — Abschlussbericht

Branch `phase/openai-t2-13-prepare-call-confirm`, Commit `9862021`. Umfang dieser Phase: **N-10**
(Serverteil; N-10 als Ganzes ist erst mit T2-14 erfüllt — Plan-Zeile 833–835, 927).

Diff-Referenz für alle Belegstellen (Zeilen können bei Nachlese leicht abweichen):
`git -C .../wt-t2-13 diff master...HEAD`

---

## 1. Was diese Phase NICHT erfüllt — zuerst

- **N-10 ist nur zur Hälfte erfüllt.** Ohne T2-14 (Bestätigungs-Ansicht im Call-Widget) sieht der
  Code aus `_meta` niemand außer der Karte selbst — und die Karte zeigt heute noch keinen
  Bestätigungs-Zustand. Plan-Zeile 834f. sagt es explizit: „nach T2-13 allein kann niemand mehr
  wählen". Das ist beabsichtigt, keine Überraschung — aber ohne T2-14 gemergt bricht per MCP JEDE
  Anrufauslösung ab (kein Fallback, kein „alter Weg" — s. Owner-Punkte).
- **Ein Sicherheitsbefund aus der Review ist ungefixt im Commit-Stand:** Der englische Kartentext
  `prepareCallCardHint` (`src/i18n/mcp-texts.js:243`, DE `:134`, FR `:323`) weist das MODELL an,
  sich selbst zu bestätigen („check the code in the Hermes card and call place_call again with the
  same arguments") statt auf eine Nutzerhandlung zu warten. Ich habe das im Diff selbst
  nachgelesen und bestätige den Befund als wahr am aktuellen Stand — er ist NICHT nachgebessert.
  Zusätzlich prüft `hasCard` (`src/mcp-tools.js:1462`) nur den globalen Schalter
  `MCP_UI_ENABLED`, nicht Host-Fähigkeit — auch das steht wortwörtlich im eigenen Kommentar
  (`src/i18n/mcp-texts.js:244–247`: „keine Erkennung einzelner Hosts"). Ein Host ohne Karte, aber
  mit `MCP_UI_ENABLED=true`, bekommt denselben Selbstbestätigungs-Text.
- **Brute-Force-Kommentar ist irreführend.** `src/call-confirmation.js:25–30` behauptet
  P(Treffer) ≈ 1,1e-6 je Gültigkeitsfenster (1200 Versuche / 32^6 Codes). Das gilt nur, wenn ein
  Rateversuch gegen GENAU einen ausgestellten Code prüft. Tatsächlich prüft
  `confirmCode` in `src/routes/api-call-confirmations.js:120` gegen bis zu 8 Slots × 2 Fenster =
  16 Kandidaten gleichzeitig — die reale Trefferwahrscheinlichkeit liegt bis zu 16-fach höher
  (~1,8e-5). `PLAN-SECURITY.md:6240–6244` und `:6300–6306` übernehmen dieselbe zu starke
  Behauptung. Das widerspricht der ausdrücklichen Kickoff-Vorgabe „nichts Stärkeres behaupten".
- **`docs/OPENAI-TOOL-INVENTORY.md:130`** behauptet für `prepare_call`, gleiche Argumente im
  gleichen Fenster lieferten deterministisch denselben Code, „repeating the call changes
  nothing". Seit der Nachbesserung (Slot-Register, Commit `9862021`, Test „Nachbesserung: erneutes
  prepare_call nach Verbrauch liefert einen NEUEN Code") stimmt das nicht mehr: nach Verbrauch
  liefert ein erneutes `prepare_call` einen frischen Code. Der Kommentar an
  `TOOL_ANNOTATIONS.prepare_call` (`src/mcp-tools.js:957`) trägt dieselbe veraltete Begründung.
  `idempotentHint:true` selbst bleibt vertretbar (kein dauerhafter Nebeneffekt), aber die im Text
  gegebene Begründung ist falsch.
- **Kein Draht-Test für Kriterium (f)** (Plan-Abnahme f: `confirmation_code` in
  `inputSchema.properties`, NICHT in `inputSchema.required`, gemessen an echtem `tools/list`).
  Ich habe es manuell nachgemessen (`required = ["to","objective"]`, Feld vorhanden) — heute
  korrekt, aber nicht automatisiert gegen Regression abgesichert.
- **Route-Ebene-Test mit injizierter Uhr für `POST /api/call-confirmations` fehlt** (Plan-Kriterium
  d, „Fenster abgelaufen"). Nur auf Modul-Ebene bewiesen (`test/call-confirmation.test.js`), nicht
  über die Express-Route-Factory selbst mit `now`-Injektion.
- **Kein `outbound-gates.js`-Legacy-Eintrag für die Extraktion von `resolveDialTarget`.** Die
  neue Modul-Funktion (`src/telephony/outbound-gates.js:311–320`) ist ein reiner Extract, aber der
  Call-Site-Ersatz im Gate selbst ist bewusst auf 5 Zeilen aufgebrochen, damit die gepinnte
  Zeilenzahl von `makeOutboundGates` (407, im mechanischen Lint-Wachhund) exakt gleich bleibt.
  Nachgemessen: `eslint-legacy-exceptions.json` enthält KEINEN Schlüssel `src/telephony/outbound-gates.js`
  (per `python3 -c "json.load(...)"` verifiziert). Kollabiert das später jemand zu einer natürlichen
  Ein-Zeiler-Form, bricht der Aufräum-Gate-Check ohne Vorwarnung — genau in der Datei, die die
  Safety-Gate-Kette trägt.

## 2. Was erfüllt ist — ID für ID

### N-10 (Serverteil, T2-13-Anteil)

Belegt am Diff und am eigenen Testlauf (`node --test test/openai-t2-13-bestaetigung.test.js
test/call-confirmation.test.js`, isoliert: **31/31 pass, 0 fail**, Log unter
`.../logs-t2-13/t2-13-tests.log`):

- **Neues Tool `prepare_call`** (lesend): normalisiert `to` über dasselbe `normalize_target`-Gate
  wie `place_call` (`resolveDialTarget`, extrahiert aus `outbound-gates.js:311–320`, von beiden
  Aufrufern geteilt — `src/routes/api-call-confirmations.js:19`), liefert Vorschau
  (`status: "awaiting_confirmation"`) in `content`/`structuredContent` OHNE Code, Code nur in
  `_meta["hermes/confirmation_code"]` (`CONFIRMATION_CODE_META_KEY`, `src/mcp-tools.js:1160`).
  Test (a): Code steht NICHT in `JSON.stringify(content)`/`structuredContent` — grün.
- **`place_call` verlangt den Code faktisch, ohne ihn im Schema zur Pflicht zu machen** —
  `confirmation_code` ist `z.string().optional()` im `inputSchema` (`src/mcp-tools.js:1492–1498`,
  mit Kommentar zum SDK-Grund), die Pflicht setzt der Handler durch
  (`confirmCallHop`/`confirmationRequired`, `src/mcp-tools.js:1503–1510`). Test (b): ohne Code, mit
  leerem String, mit erfundenem Code → jeweils `isError`, KEIN Anruf im Store — grün.
- **Der Fehlertext kommt vom Handler, nicht vom SDK**, nennt normalisiertes `to`, `objective` und
  verweist auf die Hermes-Karte inkl. Hinweis für Hosts ohne Karte (`loc.mcp.confirmationRequired`,
  `src/i18n/mcp-texts.js:242–245`, `:337–338`).
- **Gültiger Code löst genau einen Anruf aus**, danach funktioniert `get_call_status` unverändert
  (Test c, grün).
- **Bindung an exakte Parameter**: geändertes `to`/`objective`, fremder Mandant, zweiter Verbrauch
  desselben Codes → jeweils `isError`, kein Anruf (Test d, grün — inklusive OAuth-Mandantentrennung,
  Test (i): Code von Tenant A wählt nicht für Tenant B).
- **Reine Vorschau ohne Nebenwirkung**: `prepare_call` verändert den Store nicht (SHA-256 vorher =
  nachher) und schreibt kein Gate-Audit (Test e, grün) — die Route
  `POST /api/call-confirmations` fährt laut Kommentar (`src/routes/api-call-confirmations.js:6–11`)
  bewusst keine Gate-Kette.
- **Kein Gate wird umgangen**: gültiger Code + `OUTBOUND_FROZEN` → weiterhin abgelehnt, kein Anruf
  (Test f, grün). Belegt zusätzlich am Diff: `src/routes/api-calls.js` und
  `src/telephony/outbound-gates.js` — die Gate-Kette selbst (`makeOutboundGates`, Permit,
  Denylist/Land/Stunde, Kostendecke, Max-Dauer, Signaturprüfung) ist im Diff NICHT verändert, nur
  die `normalize_target`-Ableitung wurde als reiner Extract in eine gemeinsam genutzte Funktion
  gezogen (git-diff zeigt keine geänderte Bedingung).
- **Fail-closed ohne Secret**: ohne `CALL_CONFIRMATION_SECRET` liefert `prepare_call` `isError`,
  kein Anruf möglich (Test g, grün); `deriveConfirmationKey` gibt `null` bei fehlendem/zu kurzem
  Secret zurück (`src/call-confirmation.js:47–50`, `CONFIRMATION_SECRET_MIN_LENGTH = 32`).
- **Einmal-Verbrauch statt reiner Zustandslosigkeit** (Nachbesserungs-Commit): ein Slot-Register
  sorgt dafür, dass ein verbrauchter Code beim erneuten `prepare_call` einen NEUEN Code liefert
  (Test „Nachbesserung: erneutes prepare_call nach Verbrauch liefert einen NEUEN Code", grün).
- **Pfade**: stdio (echter Kindprozess, Test h) und HTTP OAuth (Test i) sind am echten
  `tools/call`-Draht bewiesen, nicht nur simuliert. HTTP Legacy/Bootstrap ist die Haupt-Abnahmedatei
  selbst. Consult-Kanal (`CONSULT_ENABLED`) stört die Prüfung nicht (letzter Test, grün).
- **Neue Env-Var korrekt verdrahtet**: `CALL_CONFIRMATION_SECRET` in `src/config.js:2087–2091`
  (Namespace `auth`), `.env.example:1097–1103`, `render.yaml:687–691` (Secret, `sync: false`),
  `src/boot-guard.js:714–730` als nicht-fatale WARN-Zeile (Owner-Regel: kein Boot-Refusal), und
  `test/helpers.js:602–604` trägt den Eintrag in `BASE_ENV` (leer) — kein Leck einer lokalen
  `.env` in Spawn-Tests.
- **`eslint-legacy-exceptions.json`** für `src/mcp-tools.js` trägt einen dokumentierten
  „PIN GESENKT 2026-09-24 (T2-13, N-10)"-Eintrag mit neu gemessener Zeilenzahl (459→404) und
  Begründung (Schema-Extraction). Sauber nach Vorgabe.

## 3. Berührte Pfade — Abdeckung

| Pfad | N-10 (Bestätigungssperre) belegt? |
|---|---|
| HTTP, Legacy-Token/Bootstrap | Ja — Hauptabnahmedatei `test/openai-t2-13-bestaetigung.test.js`, Kriterien a–g |
| HTTP, OAuth | Ja, aber nur Kriterium (i) (Mandantentrennung); keine vollständige a–g-Matrix für OAuth |
| stdio | Ja, aber nur ein Rundlauf-Test (h); keine vollständige a–g-Matrix |
| Consult-Kanal (answer_consult aktiv) | Ja, indirekt (letzter Test: Werkzeuge registriert, Bestätigungsprüfung unverändert) |
| Interne Aufrufer (REST direkt, Dashboard, Owner-Selbstanruf `calleeIsOwner`) | NICHT explizit gemessen in dieser Phase — die Bestätigung sitzt ausschließlich im MCP-Handler (`src/mcp-tools.js`), `POST /api/calls` selbst ist unverändert in seiner Gate-Kette (siehe Diff), ein Aufrufer, der die REST-Route direkt trifft (nicht über `prepare_call`/`place_call`), durchläuft die neue Bestätigungsprüfung gar nicht — das ist laut Plan gewollt (Bestätigung ist ein MCP-Zusatz, kein REST-Gate), aber ich habe keinen Test gesehen, der genau das (REST-Direktaufruf bleibt unverändert funktionsfähig) beweist |

Insgesamt: das Kernkriterium (kein Anruf ohne gültigen, gebundenen, einmal verbrauchbaren Code)
ist auf ALLEN vier MCP-Pfaden mindestens einmal am echten Draht bewiesen, aber nicht mit der vollen
Plan-Matrix je Pfad.

## 4. Was ein unabhängiger Prüfer nachmessen sollte (neutral)

1. Ist `prepareCallCardHint` (DE/EN/FR) eine Anweisung an das Modell, sich selbst zu bestätigen,
   oder eine Anweisung, auf den Nutzer zu warten? Wortlaut an `src/i18n/mcp-texts.js:134/243/323`
   lesen und mit dem Pre-Mortem-Fall (a) im Kickoff abgleichen.
2. Prüft `hasCard` (`src/mcp-tools.js:1462`) tatsächlich nur `MCP_UI_ENABLED`, oder gibt es eine
   host-spezifische Erkennung? Ergibt sich daraus ein Host, der den Selbstbestätigungs-Text sieht,
   obwohl er keine Karte rendern kann?
3. Ist die Brute-Force-Rechnung in `src/call-confirmation.js:25–30` und `PLAN-SECURITY.md`
   korrekt für den tatsächlichen Prüfumfang von `confirmCode`
   (`src/routes/api-call-confirmations.js:~120`, MAX_CONFIRMATION_SLOTS × ACCEPTED_WINDOWS
   Kandidaten), oder nur für einen einzelnen ausgestellten Code?
4. Stimmt die Determinismus-Aussage in `docs/OPENAI-TOOL-INVENTORY.md:130` und im Kommentar an
   `TOOL_ANNOTATIONS.prepare_call` (`src/mcp-tools.js:957`) noch mit dem tatsächlichen Verhalten
   nach Codeverbrauch überein (Test „Nachbesserung: erneutes prepare_call nach Verbrauch liefert
   einen NEUEN Code" gegenprüfen)?
5. Gibt es einen Test, der über echtes `tools/list` (HTTP und/oder stdio) prüft, dass
   `confirmation_code` in `place_call.inputSchema.properties` steht und NICHT in
   `inputSchema.required`? (Manuell nachgemessen: heute `required = ["to","objective"]` — aber
   automatisiert abgesichert?)
6. Gibt es einen Test der Route-Factory `makeCallConfirmationRoutes` mit injizierter Uhr
   (Fensterablauf), unabhängig von den Modul-Tests in `test/call-confirmation.test.js`?
7. Hat `src/telephony/outbound-gates.js` einen `eslint-legacy-exceptions.json`-Eintrag für die
   `resolveDialTarget`-Extraktion, oder hängt die Zeilenzahl-Stabilität von `makeOutboundGates`
   allein an der gewählten mehrzeiligen Formatierung des Call-Sites?
8. Sind ALLE Safety-Gates (Permit, `OUTBOUND_FROZEN`, Denylist, Land, Stundenlimit, Tenant-
   Kostendecke, Max-Dauer, Signaturprüfung) im Diff von `src/routes/api-calls.js` und
   `src/telephony/outbound-gates.js` inhaltlich unverändert, oder wurde irgendwo eine Bedingung
   mitverschoben?
9. Läuft ein Aufrufer, der `POST /api/calls` direkt trifft (REST, Dashboard, Owner-Selbstanruf),
   unverändert weiter, ohne durch die neue Bestätigungsprüfung zu müssen — und ist das getestet
   oder nur durch Code-Lesen plausibel?

## 5. Owner-Punkte und Restrisiko

**Owner-Punkte (Deploy-Vorbedingungen, Live-Proben, bewusste Folgen — nach OWNER-REGEL):**

- Deploy-Vorbedingung im Render-Dashboard: `CALL_CONFIRMATION_SECRET` setzen (Zufallswert
  ≥ 32 Zeichen, z. B. `openssl rand -base64 48`, nie im Repo). Fehlt der Wert, läuft die
  Produktion weiter, aber `prepare_call`/`place_call` antworten ausschließlich mit
  `503 confirmation_unavailable` — per MCP wählt dann niemand mehr.
- Deploy NUR gemeinsam mit T2-14 (die einzige Stelle, die den Code je einem Menschen zeigt) UND
  mit Prüfung, dass `MCP_UI_ENABLED` im Dashboard nicht auf `false` steht. Ohne T2-14 kann aus
  JEDEM Host per MCP kein Anruf mehr platziert werden — bewusste, im Plan dokumentierte Folge
  dieser Phase allein, aber ein reales Live-Blockade-Risiko, falls nur T2-13 deployt wird.
- Bewusst zur Kenntnis: Claude Code / stdio ohne Widget-Karte (bzw. `MCP_UI_ENABLED=false`) kann
  ab diesem Deploy per MCP KEINEN Anruf mehr platzieren — Absicht laut Plan Abschnitt 5, keine
  Regression, aber ein Betriebsverhalten, das das Team beim nächsten Testanruf überrascht, wenn es
  nicht vorher kommuniziert wird.
- Live-Probe nach gemeinsamem Deploy (ChatGPT Developer Mode + Claude, sichere Testnummer): vor
  dem Klick das Modell fragen, welcher Code in der Karte steht — es darf ihn nicht kennen. Das ist
  die einzige Stelle, an der sich Pre-Mortem-Fall (a) (Modell bestätigt sich selbst) tatsächlich
  am echten Host widerlegen oder bestätigen lässt; die Code-Lektüre allein reicht nicht, weil der
  offene Befund oben (`prepareCallCardHint`) genau in die falsche Richtung zeigt.

**Restrisiko (ein Absatz):** Die serverseitige Sperre selbst ist sauber gebaut und an allen
Kernstellen bewiesen — kein Anruf ohne gültigen, parametergebundenen, einmal verbrauchbaren Code,
alle bestehenden Gates unverändert, fail-closed ohne Secret. Das größte offene Risiko ist aber
genau das, was Pre-Mortem-Fall (a) vorhersah: der Kartentext weist das Modell aktiv an, sich den
Code selbst zu holen und erneut zu wählen, und die Karten-Erkennung ist rein global
(`MCP_UI_ENABLED`), nicht host-spezifisch — auf einem Host, der `_meta` an das Modell durchreicht,
oder auf einem kartenlosen Host mit dem Schalter an, ist die Bestätigung dann nur noch formal,
und kein automatisierter Test dieser Phase fängt das, weil die Tests selbst simulieren, dass der
Code „vom Nutzer kommt". Zusätzlich ist die dokumentierte Sicherheitsmarge (Brute-Force-Zahl,
Inventar-Determinismus-Aussage) nachweislich zu optimistisch formuliert — kein akutes Loch, aber
eine Doku, die sich selbst widerspricht, sobald jemand nachrechnet. Vor einem Merge sollte
mindestens der Kartentext-Befund (Punkt 1 oben) behoben und die Brute-Force-/Determinismus-Doku
korrigiert werden; beides sind laut Review bereits gemeldete, nicht behobene Befunde im
vorliegenden Commit-Stand.

## Unabhaengige Verifikation (gewinnt gegen alles oben)

- **Urteil des Laufs:** FAIL (PASS nur bei beiden Reviews PASS, allen IDs ja, keinem isoliert roten Test)
- **Gemessener Commit:** 9862021b36692858c504019cf5fda5d32738b93f; Tests (volle Suite, pass/fail): 6466/0
- **Review-Urteile zuletzt:** {"safety":"PASS","cleancode":"PASS"}
- **Tabelle ID | erfuellt | Beleg | Luecke:**

| ID | erfuellt | Beleg | Luecke |
|---|---|---|---|
| N-10 | nein | Der Server blockt: /mcp-Probe place_call ohne, mit falschem oder wiederverwendetem Code isError, gueltiger Code dialing. Extern 403. 31/31 Tests ok (inkl. stdio/OAuth). Live-Rest: ob der Host _meta weitergibt. | Keine Nutzerbestaetigung baubar: Code nur in _meta, call.html liest nur structuredContent, src/ui im Diff unveraendert, Karte zeigt keinen Code. Wer bestaetigt dann? answer_consult/cancel_call (destructive) ohne Bestaetigung. |

- **Isoliert rot:** []
- **Offene Blocker:**
  - N-10: Keine Nutzerbestaetigung baubar: Code nur in _meta, call.html liest nur structuredContent, src/ui im Diff unveraendert, Karte zeigt keinen Code. Wer bestaetigt dann? answer_consult/cancel_call (destructive) ohne Bestaetigung.
  - safety/wichtig `src/i18n/mcp-texts.js:243`: prepareCallCardHint sagt dem MODELL: "To confirm, check the code in the Hermes card and call place_call again with the same arguments." (DE :134, FR :323). Das ist eine Handlungsanweisung an das Modell, sich selbst zu bestaetigen, statt auf die Nutzerhandlung zu warten. Dazu kommt: hasCard (`src/mcp-tools.js:1462`) prueft nur den globalen Schalter MCP_UI_ENABLED. Der Satz erscheint also auch auf Hosts ohne Karte (Claude Code ueber HTTP, stdio).
  - safety/wichtig `src/routes/api-call-confirmations.js:120`: confirmCode prueft einen vorgelegten Code gegen bis zu MAX_CONFIRMATION_SLOTS (8) Slots x ACCEPTED_WINDOWS (2) = 16 Kandidaten, auch gegen Slots, die nie ausgestellt wurden. Kommentar hier und PLAN-SECURITY.md:6300-6306 behaupten, die Brute-Force-Rechnung "bleibt unveraendert" (P ~ 1,1e-6, PLAN-SECURITY.md:6240-6244, call-confirmation.js:25-30). Tatsaechlich ist die Trefferwahrscheinlichkeit je Rateversuch bis zu 16-mal hoeher (~1,8e-5 je 10-Minuten-Fenster bei 1200 Versuchen).
  - safety/wichtig `test/openai-t2-13-bestaetigung.test.js:393`: Plan-Abnahmekriterium (f) verlangt am Draht, dass confirmation_code in inputSchema.properties von place_call steht und NICHT in inputSchema.required. Kein Test prueft das. Die einzige tools/list-Abfrage der Abnahmedatei (Zeile ~405) prueft nur Werkzeugnamen, mcp-tool-annotations nur Annotationen. Manuell gemessen: required = ["to","objective"], die Eigenschaft ist vorhanden. Das Verhalten stimmt also heute.
  - safety/wichtig `docs/OPENAI-TOOL-INVENTORY.md:130`: Das Inventar (fuer die Einreichung) sagt fuer prepare_call: "the same arguments within the same validity window deterministically yield the same code; repeating the call changes nothing". Der Kommentar an TOOL_ANNOTATIONS.prepare_call (`src/mcp-tools.js:957`) sagt dasselbe. Seit der Nachbesserung (Slot-Register) stimmt das nicht mehr: nach einem Verbrauch liefert dasselbe prepare_call einen anderen Code. Zeile 120 sagt ausserdem, der Code werde "on a client that renders the Hermes card" ausgestellt. Tatsaechlich bekommt ihn jeder Host, sobald MCP_UI_ENABLED an ist.
  - cleancode/wichtig `src/telephony/outbound-gates.js:748-756` (ctx.to = resolveDialTarget({...})): Die Extraktion von resolveDialTarget() aus makeOutboundGates() ist inhaltlich ein sauberer, unveraenderter Move (bestaetigt: eslint-suppressions.json fuer diese Datei ist byte-identisch vor/nach dem Diff, alle outbound-gates-Tests bleiben gruen). Aber der Call-Site-Ersatz ist bewusst auf 5 Zeilen aufgebrochen (ctx.to = resolveDialTarget({ store, tenantId: ctx.tenantId, to: ctx.to, });) statt der natuerlichen Ein-Zeiler-Form. Gemessen: makeOutboundGates() hat auf master UND auf dem Branch exakt 407 Zeilen (verifiziert mit npx eslint --suppressions-location eslint-suppressions.empty.json) - die Formatierung wurde erkennbar gewaehlt, um genau diese Zahl zu halten, nicht aus Lesbarkeitsgruenden. outbound-gates.js hat KEINEN Eintrag in eslint-legacy-exceptions.json; sie haengt allein an Stufe 2 ("mechanische Aenderung") von scripts/check-staged-suppressions.js, die eine 1:1-identische ungefilterte Fund-Multimenge verlangt - die max-lines-per-function-Meldung enthaelt die Zeilenzahl WOERTLICH im Message-Text ("has too many lines (407)"), jede Abweichung waere kein mechanischer Durchgang mehr.
  - cleancode/wichtig `test/openai-t2-13-bestaetigung.test.js` (d) / `tasks/openai-t2/T2-13-spec.md` Abschnitt 4: Der von der Phasen-Spec selbst geforderte Abnahme-Fall "Fenster abgelaufen (Uhr injiziert) -> isError" fuer POST /api/call-confirmations ist nicht auf Route-/Draht-Ebene bewiesen, nur auf Modul-Ebene (test/call-confirmation.test.js, injizierte nowMs an matchedWindowIndex/issueConfirmationCode). Der Bauende hat diese Luecke selbst gemeldet.
