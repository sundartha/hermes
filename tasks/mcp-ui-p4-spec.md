# P4 — Erstes Callback-Widget (Schreib-Aktion) — Einzel-Spec

Autoritative Scope-/Invarianten-/Sicherheits-Spec fuer Phase **P4** der MCP-Rich-UI-Kette.
Verbindlich vor dem Umbrella-Doc. Umbrella: `docs/mcp-ui-strategy.md` (v.a. Abschnitt 5.3
Widget-Callbacks, 5.5 Mapping-Tabelle, Pre-Mortem #3). Ketten-Doc: `tasks/mcp-ui-chain.md` §P4.
Baseline `master`. **Dies ist das HARTE SICHERHEITS-GATE der Kette.**

## Ziel (ein Satz)

Beweisen, dass ein Widget eine Schreib-Aktion (Tool-Callback) ausloesen kann, ohne irgendein
Safety-Gate zu umgehen — der Callback ist ein **normaler authentisierter `/mcp`-Tool-Call** durch
ALLE bestehenden Gates, es gibt KEINEN privilegierten Seitenkanal.

## Kern-Erkenntnis (Grounding — das ist der Sicherheits-Anker)

P4 fuegt **KEINEN neuen Call-Ausloese-Codepfad** hinzu. Die Tools `place_call`
(`src/mcp-tools.js:179`) und `cancel_call` (`src/mcp-tools.js:289`) existieren bereits und laufen
ueber das Gateway durch die volle Outbound-Kette: `kycGateError` -> `numberGateError` ->
`outboundFrom` (`src/server.js:1015-1061`). Ein Widget-Button ruft NUR diesen bereits gegateten
Tool ueber den Standard-MCP-Tool-Call-Mechanismus des Hosts zurueck. P4 ist also: **ein Widget +
Verdrahtung an Stufe 1 + Tests/Beweis, dass die Gates greifen** — kein neues Geld/Call-Risiko im
Code, nur eine neue UI-Ausloese-Oberflaeche.

## Scope (genau dies, NICHTS darueber hinaus — Regel 6)

1. **Callback-Ziel = `cancel_call`** (NICHT `place_call`). Begruendung (Pre-Mortem #3, akzeptiertes
   Risiko-Minimum): Das ERSTE Callback-Widget demonstriert die Schreib-Aktion an der **am
   wenigsten gefaehrlichen** Aktion — Abbrechen eines EIGENEN, bereits laufenden Calls ist
   reversibel/defensiv und kann KEINEN ungewollten Outbound, keine Kosten-Explosion, keinen
   Toll-Fraud ausloesen (das exakte Pre-Mortem-#3-Szenario). `place_call` als Callback bleibt einer
   spaeteren Phase vorbehalten, NACHDEM der Callback-Mechanismus hier hart bewiesen ist. Falls der
   Plan-Agent stattdessen `place_call` fuer noetig haelt: NICHT eigenmaechtig — als Deviation
   melden und beim Owner rueckfragen.
2. **Neues Widget `call-result`** (Mockup-Referenz `design-system/mcp/call-result.html`): als
   self-contained HTML nach `src/ui/widgets/call-result.html` (Tokens inline, KEIN `@import` —
   muss den P5-`check:tokens` bestehen). Eintrag im host-agnostischen Katalog
   `src/ui/widget-catalog.js` (`WIDGET_CALL_RESULT`, analog `WIDGET_CALL_STATUS`/`WIDGET_TRANSCRIPT`)
   + `WIDGET_DEFS`. KEINE Seam-Kern-Aenderung (contract/ports/registry/adapters bleiben unberuehrt
   — Beweis der Seam-Wiederverwendung wie P2/P3).
3. **Stufe-1-Verdrahtung** des Widgets an ein read-only-Tool, das den aktiven Call zeigt (Vorschlag
   `get_call_status` ODER ein dedizierter Rueckgabepunkt), sodass der Host das Widget rendert und
   sein Abbrechen-Control `cancel_call` als normalen Tool-Call zurueckruft. Nutze den bestehenden
   `enableWidgetUi(widgetId)`-Helper (`src/mcp-tools.js:144`); KEINE neue _meta-Mechanik.
4. **Daten-Kontrakt (Whitelist) fuer das Widget:** nur die schon offengelegten Eigen-Call-Felder
   (`call_id`, `status`, ggf. `duration_s`/`last_transcript_lines` desselben Tenants) — exakt wie
   der bestehende `pickCallStatus`-Filter. KEINE neuen Felder, kein PII/Secret/Cross-Tenant/Audio.

## Harte Sicherheits-Invarianten (Definition-blockierend, alle als Test beweisen)

- **Regel 1 / Pre-Mortem #3:** Der Widget-Callback durchlaeuft denselben `/mcp`+`mcpAuth`-Eingang
  und ALLE Safety-Gates wie jeder Tool-Call. Es gibt KEINEN unauthentisierten Postback/Seitenkanal.
  **Beweis-Test:** der Callback (`cancel_call`) ohne gueltige Auth/falscher Tenant -> abgelehnt
  (kein fremder Call abbrechbar; Tenant-Isolation via `tenantOwnsCall`/`requestTenant`).
- **Q3 bestaetigt:** Belege per Test, dass der Callback ein regulaerer authentisierter Tool-Call ist
  (kein neuer Endpunkt, kein Bypass). Dokumentiere den Q3-Nachweis im Report.
- **Regel 2 Offenlegung:** Der Disclosure-Pfad (`disclosureSentence`, claude.js/bridge.js) ist
  UNBERUEHRT — kein Widget-Setting beruehrt ihn (P4 fasst den Call-Pfad nicht an). Verifiziere,
  dass der Diff claude.js/bridge.js NICHT anfasst.
- **Regel 3 Auth fail-closed:** kein neuer offener Endpunkt; unbekannter/unfaehiger Host -> Stufe 0
  (kein Widget, kein Resource-Block) ueber die bestehende Registry. Master-Schalter
  `config.mcpUiEnabled` Default AUS = byte-identisch zum heutigen Verhalten.
- **Regel 4 Secrets / Regel 5 Audio:** kein Key/Provider-Internum, kein Audio ins Widget/`_meta`.
- **Bestehende Gate-Tests bleiben unveraendert gruen** (Allowlist/Denylist/Land/Stundenlimit/
  Budget global+pro-Tenant/Max-Dauer/Signatur) — P4 weicht KEIN Gate auf.

## Abgrenzung (NICHT beruehren)

- KEINE Aenderung an den Safety-Gate-Funktionen (`kycGateError`/`numberGateError`/`outboundFrom`),
  am Call-Pfad, an `claude.js`/`bridge.js`, am Disclosure-Satz.
- KEINE Seam-Kern-Aenderung (contract/ports/registry/adapters) — nur additiver Katalog-Eintrag +
  Widget-HTML + Verdrahtung in `mcp-tools.js` + Tests.
- KEIN neuer npm-Dependency. KEIN Build-Step. ESM. Deutsche Kommentare OHNE Umlaute.
- `place_call` NICHT als Callback verdrahten (siehe Scope 1).

## Definition of Done

- Neues `call-result`-Widget gerendert ueber den UNVERAENDERTEN Seam-Kern (P2/P3-Muster); besteht
  `npm run check:tokens` (self-contained, kein `@import`).
- Callback (`cancel_call`) laeuft beweisbar durch alle Gates + Tenant-Isolation; Gate-Tests gruen.
- Beweis-Tests: (a) Callback = authentisierter Tool-Call kein Seitenkanal; (b) fremder Tenant kann
  fremden Call NICHT abbrechen; (c) Whitelist haelt (kein PII/Secret/Audio/Cross-Tenant im Widget);
  (d) Flag aus -> Stufe-0-only byte-identisch; (e) Disclosure/Call-Pfad-Diff leer.
- `node --check` auf jeder neuen/geaenderten `.js`. Bestandssuite unveraendert gruen + neue Tests
  (Baseline aktuell 1117, fail 0).
- Dualer Review PASS (Safety APPROVED + Clean-Code keine S1/S2). **Hartes Gate** — im Zweifel
  blockieren.
