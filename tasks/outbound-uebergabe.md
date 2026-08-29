# Uebergabe: Outbound-Resilienz-Kette (Stand 2026-08-29)

Diese Datei ist die vollstaendige Uebergabe an eine frische Sitzung. Sie ersetzt den
Gespraechsverlauf: alles Noetige steht hier oder in den verlinkten Dateien.

## 1. Was passiert ist

Am 27.08.2026 schlugen ALLE Outbound-Anrufe fehl. Wurzel: eine Rufnummer diente gleichzeitig als
DID eines Test-Tenants UND als Absendernummer (ANI) des gesamten Produkt-Outbounds. Der
DSGVO-Loeschweg dieses Test-Kontos gab die Nummer am 24.08. frei, seitdem lehnte Telnyx jedes
SIP-INVITE mit 403 "Unverified origination number" ab. Drei Tage lang bemerkte das niemand.

Der gemessene Hergang steht in **`tasks/befund-outbound-ausfall-2026-08-27.md`** (inkl. der
Behebung in Abschnitt 5). Der Etappenplan steht in **`PLAN-OUTBOUND-RESILIENZ.md`** (1863 Zeilen,
7 Etappen, 26 Pre-Mortem-Risiken). Die offenen Owner-Fragen stehen in
**`tasks/entscheidungen-outbound-resilienz.md`**.

## 2. Der Ausfall selbst ist BEHOBEN (28.08., ohne Deploy)

Der ANI-Override der Telnyx-Connection `3026479542865757220` ("ElevenLabs Spike2") zeigt jetzt auf
`+18643028341` (kontoeigene DID des `owner`-Tenants) statt auf die freigegebene `+15739090177`.
Belegt mit einem echten Anruf: `call_mtd0acq2hq4q`, completed, 29 s, kein `failure_reason`.
**Der MCP-Weg ist demofaehig.** Telnyx-Guthaben lag dabei bei 3,09 USD - vor einem Vorfuehrtermin
auffuellen.

## 3. Was gebaut und gemergt ist (alles LOKAL, nichts gepusht)

`master` steht auf `a9deb74`, **32 Commits vor `origin/master`**. Test-Anker: **5361 pass / 0 fail**
(`LLM_PROVIDER=anthropic npm test`). `npm run test:gates`: 3 rote Faelle (GAP-05, GAP-15, E2E-03) -
das ist der unveraenderte master-Stand, keine Regression.

| Etappe | Merge | Inhalt |
|---|---|---|
| E1 | `ee93638` | Plattform-Nummern-Bindung + dreifacher Freigabe-Riegel (die Wurzel) |
| E2 | `d59b136` | EIN Fehlervokabular ueber alle Engines, getrennt nach Schuld |
| E3a | `cab6c4e` | Der Fehler erreicht den Nutzer; Mail nur bei `not-placed` |
| E3b | `b2fe31e` | Systematischer Ausfall meldet sich beim Betreiber (K0/K1/K2) |
| E4 | `1a87104` | Drift-Waechter - erkennt den Ausfall OHNE dass ein Anruf stattfindet |

Detailberichte je Etappe: `tasks/outbound-e{1,2,3a,3b}-report.md` (E4-Report fehlt, der
Report-Agent starb an einem Session-Limit - kein Verlust, der Inhalt steht im Merge-Commit).

## 4. Was JETZT ansteht: E5 (die Regression)

**Der Owner hat am 29.08. festgestellt, dass hier eine REGRESSION vorliegt, keine Ungenauigkeit.**

- Bis 12.08.2026 lief jeder Outbound ueber Telnyx **mit der DID des Tenants**
  (`src/routes/api-calls.js`: `originateCall({ from: ctx.fromNumber, ... })`).
- Seit 19.08.2026 laeuft alles ueber ElevenLabs; `src/elevenlabs/outbound.js#startCallBody`
  uebergibt nur `agent_id`/`agent_phone_number_id`/`to_number` - die Absendernummer haengt an EINER
  global registrierten Nummer.
- In der Prod-DB nachweisbar: gespeichert `from_e164` = Tenant-DID, tatsaechlich gesendet die
  globale Nummer.
- Folge: der Angerufene sieht eine fremde Nummer. Ruft er zurueck, landet er ueber
  `store.numberRecordByE164(to)` beim BESITZER dieser Nummer, nicht beim anrufenden Tenant. Bei
  einem echten Kunden waere das ein Datenschutz-Vorfall.

**Der Workflow dafuer ist fertig geschrieben und syntaktisch geprueft:**
`.claude/workflows/runs/outbound-e5.js` (noch untracked). Er ist gegenueber dem Plan-Dokument
NEU GESCHNITTEN: nicht nur Buchfuehrung, sondern je Tenant-DID eine eigene
ElevenLabs-Registrierung, deren Kennung am `number`-Datensatz haengt und pro Anruf gewaehlt wird.
Starten mit:

```
Workflow({ scriptPath: "<REPO>/.claude/workflows/runs/outbound-e5.js" })
```

Vier Schritte gehoeren zum Fix, drei davon Code:
1. Je Tenant-DID eine EL-Registrierung (`POST /v1/convai/phone-numbers`, SIP-Trunk) - Provider-
   Schreibzugriff, gehoert hinter dasselbe Gate wie der Nummernkauf im Provisioning.
2. Kennung am `number`-Datensatz speichern (additiv, beide Backends, Backfill-Plan noetig).
3. Beim Anruf die Kennung des anrufenden Tenants waehlen.
4. **OWNER-AKTION:** `ani_override_type` bei Telnyx von `always` wegnehmen - sonst ueberschreibt
   Telnyx die From-Nummer weiterhin. Erst damit wirkt 1-3.

## 5. Zwei Dinge, die mit E5 fallen muessen

- **`outbound-drift-ausnahmen.json`** traegt seit dem 29.08. den Eintrag `config_ani_mismatch`
  mit dem ausdruecklichen Vermerk, dass er zu ENTFERNEN ist, sobald E5 je DID eine eigene
  Registrierung anlegt. Bleibt er stillschweigend stehen, ist der Waechter blind fuer genau den
  Fall, gegen den er gebaut wurde.
- Der Rueckfall auf die globale Nummer (fuer Tenants ohne eigene Registrierung) muss **laut**
  sein - gezaehlt und am Anruf-Datensatz erkennbar, nie stilles Verhalten.

## 6. Offene Owner-Entscheidungen

| # | Frage | Stand |
|---|---|---|
| F-1 | Eigene Plattform-DID kaufen (1 USD + 2 USD/Monat) statt der owner-DID? | Zwischenloesung laeuft, Empfehlung des Plans steht |
| F-4 | Secrets fuer den externen Waechter im GitHub-Repo hinterlegen | offen; VIER Pflicht-Secrets: `TELNYX_API_KEY`, `ELEVENLABS_API_KEY`, `PLATFORM_ANI_E164`, `ELEVENLABS_AGENT_ID` |
| F-5 | ANI-Riegel scharf schalten (Default aus)? | nach einer Woche gruener Waechter-Laeufe |
| F-7 | Telnyx-Guthaben (3,09 USD) und DeepSeek (HTTP 402) auffuellen | offen |
| — | Wann wird gepusht/deployt? | offen, 32 Commits liegen lokal |
| — | `seed-test-payment.mjs` + `seed-card-test-payment.mjs` (gitignoriert, 27.06.) blockieren den pre-commit-Linter | loeschen, reparieren oder aus der eslint-Konfiguration nehmen |

**Vor dem naechsten Deploy zwingend** (sonst startet der Dienst nicht mehr bzw. der Riegel ist
wirkungslos): `PLATFORM_ANI_E164` und `PLATFORM_ALERT_MAIL_TO` sind im Render-Dashboard bereits
gesetzt (28.08.). Kommt eine weitere Instanz dazu, muessen sie dort ebenfalls stehen.

## 7. Arbeitsweise, die sich bewaehrt hat

- **Lead bleibt duenn:** Analyse, Implementierung und Review laufen in Workflow-Subagenten. Der
  Lead liest keinen Code, sondern nur die kompakten Returns - und prueft vor JEDEM Merge selbst
  `git diff --stat` (ein PASS des Workflows ist keine Merge-Freigabe).
- **Eine Bahn zur Zeit.** Nie zwei Workflows parallel.
- **Nach jedem Lauf aufraeumen:** Agenten-Worktrees unter `.claude/worktrees/` entfernen, sonst
  liest `eslint .` sie mit und der pre-commit-Hook scheitert.
- **Blocker-Vermeidungsliste** (steht im E5-Skript): Gegenproben ausfuehren statt behaupten;
  Positiv-Kontrolle immer; Attrappen muessen ihr Argument pruefen; kein stilles Gruen; gepinnte
  Lint-Altlasten nicht anheben; Abnahmepunkte abzaehlen; keine zwei Testlaeufe gleichzeitig;
  Fixtures nicht auf Grenzwerte legen; neue Env-Vars in `config.js` + `.env.example` +
  `render.yaml` + `test/helpers.js` BASE_ENV.
- **Nachbesserung statt Neustart:** endet eine Etappe BLOCKED, ist ein schlanker Lauf mit einem
  Fixer und einem Reviewer (Muster `outbound-e3b-nachbesserung.js`, `outbound-e4-nachbesserung.js`)
  deutlich billiger als eine zweite Vollrunde - 4 Agenten statt 17.

## 8. Was diese Kette gekostet hat

Rund 15,5 Mio Subagent-Token ueber 6 Laeufe. Die adversarialen Reviews haben in jeder Etappe
mindestens einen Defekt gefunden, den die Testsuite nicht gefangen haette - darunter zwei, die
selbst einen groesseren Ausfall erzeugt haetten als den behobenen, und einen ANI-Riegel, der genau
dort wirkungslos war, wo `PLAN-SECURITY.md` Schutz zusicherte.
