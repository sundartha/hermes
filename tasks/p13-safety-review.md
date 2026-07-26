# Nachgezogenes Safety-Urteil P13

Datum: 2026-07-26
Gepruefter Diff: e014dbf..f07669f
Hinweis: Phase P13 ist bereits gemergt (f07669f). Dieses Urteil ist eine NACHTRAEGLICHE
Nachweis-Luecke-Schliessung, kein Vorab-Gate mehr - der Merge liegt bereits vor dieser Pruefung.

## Urteil

**Verdict: FREIGABE (approved)**

P13 haelt allen sieben absoluten Regeln stand. Der Reviewer hat jede Behauptung des
Impl-Reports am Code bzw. an der Laufzeit selbst nachgeprueft, nicht geglaubt.

Diff-Umfang: genau 6 Produktivdateien (src/i18n/mcp-texts.js, src/mcp-tools.js,
src/ui/contract.js, src/ui/ports.js, src/ui/widget-catalog.js, src/ui/widget-i18n.js)
+ 6 Testdateien. Keine neue Datei, keine neue Dependency, keine neue Env-Variable.
Safety-Gates, Offenlegungssatz, Auth-Kette, Telefonie-Schicht (src/claude.js,
src/bridge.js, src/routes/mcp.js, src/telephony/, src/config.js) sind byte-identisch
zu e014dbf unberuehrt geblieben.

Gilt auf dem heutigen master (3707016) weiter: `git diff f07669f master -- src/ui/`
ist leer, die gesamte Widget-Schicht ist byte-identisch; P15/P15b haben mcp-tools.js
zwar angefasst, aber orthogonal (Tool-Beschreibungen, Label-Buendel).

## Einzelflags

| Flag | Wert |
| --- | --- |
| approved | true |
| testsPassIndependently | true |
| safetyGatesIntact | true |
| disclosureIntact | true |
| authFailClosedIntact | true |
| noSecretsLeaked | true |
| audioNeverThroughMcp | true |
| scopeRespected | true |
| behaviorAsIntended | true |
| stillHoldsAtHead | true |

## Eigenstaendige Belege des Reviewers

1. **npm test** (frischer Worktree, Branch review-p13-nachgezogen, f07669f): roh
   3271/3271/0, korrigiert 3258/3258/0 (13 Datei-Wrapper abgezogen) - deckt die
   Selbstauskunft des Impl-Agenten exakt. Beide Store-Backends liefen in diesem
   einen Lauf (json als BASE_ENV-Default, pglite in-process ueber ~30 Testdateien).

2. **npm run test:gates**: korrigiert 25/21/4. Die 4 roten sind ausschliesslich
   E2E-06, GAP-05 und GAP-15 (2 Faelle) - alle ausserhalb P13. Keine der vier
   P13-IDs (MCP-09, MCP-12, UI-14, UI-18) ist rot.

3. **P13-relevante Testscheibe gegen den heutigen master** (via `git archive master`
   extrahiert, um die git-show-Blob-Falle zu vermeiden): test/mcp-ui-widget-i18n +
   mcp-ui + mcp-tools-language + mcp-tools + mcp-tools-i18n + mcp-ui-i18n-divergence
   = 91/91/0.

4. **Eigener End-to-End-Smoke** ueber die echte HTTP-Route (Server-Spawn, POST /mcp,
   resources/read auf ui://hermes/agent-status), den der Impl-Agent NICHT gefahren
   hat - je Tenant-Sprache, auf f07669f UND auf master identisch:
   - `language="de"` -> 200, `var locale = "de"`, "Berechtigungen" im HTML
   - `language="fr"` -> 200, `var locale = "fr"`
   - `language="en"` -> 200, `var locale = "en"`
   - kein language-Feld -> 200, `var locale = "en"` (Weltdefault nach P10)

5. **Eigener End-to-End-Smoke get_agent_status** ueber POST /mcp auf master:
   - de -> `permissions="Summaries=true, PersoenlicheDaten=false, Bankdaten=false"`
     (byte-identisch zum Bestand)
   - fr -> `"Résumés=true, DonnéesPersonnelles=false, DonnéesBancaires=false"`
   - en/ohne Feld -> `"Summaries=true, PersonalData=false, BankData=false"`
   - structuredContent-Keyset in allen Faellen exakt die 11 Whitelist-Felder
     (calls, costEur, model, number, owner, permissions, reservedEur,
     spendMonthCostEur, spendMonthKey, tenantCapEur, voiceEngine) - kein Zusatzfeld.

6. **Adversariale Laufzeitprobe** auf die neue Sprach-Matrix: `widgetHtml('agent-status', X)`
   fuer X in `{__proto__, constructor, toString, hasOwnProperty, valueOf,
   'de"; alert(1); //', '</script><script>alert(1)</script>', 123, {}, [], null,
   undefined, "", "xx", "de-DE", "FR_ch"}` - jeder Nicht-Sprachwert liefert
   byte-identisch die en-Fassung, kein Throw, kein undefined, keine Injektion.
   `navigator.language` kommt in keiner ausgelieferten Fassung mehr vor.

Kein Commit, keine Aenderung durch die Pruefung: `git status --short` leer,
`git log f07669f..HEAD` = 0 Commits.

## Blocker

Keine.

## Concerns

1. **Abnahmekriterium der Phase nicht erfuellt** (PLAN-I18N-FIX.md:1373 und :1386):
   der Plan verlangt woertlich einen "Widget-Smoke im echten claude.ai
   (postMessage-Trace) je Sprache (de/en/fr)" und sagt dazu ausdruecklich "Die
   Suite allein ist hier kein Beweis." Der ist nie gelaufen; der Impl-Report
   (tasks/p13-report.md:51) raeumt das selbst ein. Der Reviewer hat den Beweis
   eine Stufe hoeher geschoben als die Suite (echter Server-Spawn + resources/read
   ueber POST /mcp, s. Beleg 4), aber die Host-Render-Ebene des claude.ai-Doppel-
   Iframes bleibt ungeprueft. Kein Code-Defekt - eine offene manuelle Abnahme.

2. **Vorbedingung A6 "P12 live" war zum Merge-Zeitpunkt nicht erfuellt**
   (tasks/p13-report.md:17: upstream/master = 566ccd6, lokales master 93 Commits
   voraus). PLAN-I18N-FIX.md:1188 haelt fest, dass P10-P13 zusammen deployt werden
   und das Aktivierungsfenster erst nach P13-Abnahme geschlossen wird. Eine
   Release-Reihenfolge-Frage, kein Code-Befund - aber sie steht offen.

3. **Sichtbare Verhaltensaenderung fuer heutige Accounts ohne gesetztes
   settings.language**: sie bekommen ab jetzt ein englisches Widget (e2e-Smoke:
   "kein language-Feld -> var locale = \"en\""), wo vorher navigator.language
   entschied - bei einem deutschen Browser also Deutsch. PLAN-I18N-FIX.md:1380
   entschaerft das mit "nach dem Backfill gibt es keinen Tenant ohne Feld mehr";
   ob dieser P10-Backfill in der Prod-DB tatsaechlich gelaufen ist, laesst sich am
   Code nicht pruefen und war nicht Teil des Auftrags. Vor dem Deploy verifizieren,
   sonst sieht der deutschsprachige Bestand englische Karten.

4. **src/ui/ports.js:14** - der Kommentar sagt weiterhin "Die Resource traegt KEINE
   Tenant-Daten". Seit P13 traegt sie ein - sehr grobkoerniges - Tenant-Attribut,
   naemlich dessen Sprache (`var locale = "de"`). Kein Secret und kein
   Fremd-Tenant-Wert (die ui://-URI ist sprachfrei, aber /mcp baut McpServer+
   Transport pro Request, src/routes/mcp.js:7-11 INV-8, und loest die Sprache ueber
   tenantLanguage(store.load(), scopedTenant) auf - Isolation e2e bestaetigt). Der
   Kommentar ist damit nicht mehr woertlich wahr. Reine Doku-Praezision.

5. **Restrisiko, das der Impl-Agent selbst benennt und der Reviewer bestaetigt**
   (tasks/p13-report.md:24c): die ui://-URI bleibt bewusst sprachfrei. Wechselt ein
   Tenant seine Sprache, kann ein Host-seitiger Session-Cache die alte Fassung
   weiterzeigen, bis er die Resource neu liest. Bewusst akzeptiert, kein Fehler -
   aber im Support-Fall die erste Erklaerung fuer "mein Widget ist noch englisch".

6. **src/i18n/locales.js:362** `localeFor() = LOCALES[language] || LOCALES[DEFAULT_LANGUAGE]`
   nutzt keinen hasOwnProperty-Schutz: `localeFor('__proto__')` liefert
   Object.prototype, damit ist `loc.mcp` undefined und `pickAgentStatus(s, loc.mcp)`
   wirft. Nicht erreichbar - updateSettings validiert language fail-closed gegen
   SUPPORTED_LANGUAGES (src/store/state-ops.js:2646-2657
   isOptionalEnumOverride/OPTIONAL_ENUM_FIELDS), und resolveCallLanguage liest nur
   diesen validierten Wert. Vorbestehend aus P10/P12, NICHT von P13 eingefuehrt;
   P13 verschiebt den Einschlag lediglich vom Fehlerpfad auf den Happy Path von
   get_agent_status. Auswirkung waere eine MCP-Fehlerantwort, kein Leck und kein
   Gate-Bypass. Defense-in-Depth-Notiz, kein Auftrag dieser Phase. Zum Kontrast:
   die neue P13-Stelle selbst macht es richtig - resolveLocale
   (src/ui/widget-i18n.js:121) prueft mit Object.prototype.hasOwnProperty.call.

7. **Der MCP-12-Kanarienvogel** (jetzt T12 in test/mcp-tools-language.test.js) ist
   ein Quelltext-grep (`/language\s*[:=]\s*["']en/` ueber drei Testdateien,
   Schwelle hits > 0). Er waere schon von einem Kommentar mit diesem Text zu
   befriedigen. Das ist die Konstruktion des Katalogautors und wurde woertlich
   uebernommen - genau richtig, denn Pre-Mortem 3 verbietet, die Erwartung
   anzufassen. Vermerk nur, damit die schwache Aussagekraft nicht mit einem
   echten Abdeckungsbeweis verwechselt wird.

8. **Prozess, nicht Code**: tasks/p13-report.md:4 und :93 fuehren die Phase als
   "Gate: BLOCKED" (Self-Fix-Schleife abgebrochen, Fix-Branch nie entstanden,
   Safety-Urteil null) - gemergt wurde sie trotzdem (f07669f). Der Code haelt dem
   Review stand, aber der Merge lief an einem roten Gate vorbei.

## stillHoldsAtHead

`true`. `git diff f07669f master -- src/ui/` ist leer - die gesamte Widget-Schicht
ist byte-identisch zwischen dem gemergten P13-Commit und dem heutigen master
(3707016). In src/mcp-tools.js stehen auf master unveraendert
`permissionsSummary(settings, labels)` (Z.217), `permissions:
permissionsSummary(s.settings, texts.permissionLabels)` (Z.257), `pickAgentStatus(s,
loc.mcp)` (Z.742) und `registerResource(server, widgetId, loc.language)` (Z.363).
P15/P15b haben mcp-tools.js zwar angefasst, aber orthogonal (Tool-Beschreibungen
nach O14 auf Englisch, agentStatus-/Leertext-Labels ins Locale-Buendel). Beweis
nicht nur strukturell: 91/91 P13-Tests gruen am master-Baum und beide
e2e-Smokes (Widget-Sprache, Berechtigungs-Feldnamen) dort mit identischem Ergebnis.
