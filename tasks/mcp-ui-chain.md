# MCP Rich-UI Chain — Lean-Phasen-Kette (P0 -> P1 -> P2 -> P3 -> P4 -> P5)

Umbrella-Doku: `docs/mcp-ui-strategy.md` (Zielbild, Zwei-Stufen-Modell, Seam, Pre-Mortem).
Diese Datei ist die **autoritative Scope-/Invarianten-Spec pro Phase** (verbindlich vor dem
Umbrella-Doc). P1 hat zusaetzlich eine detaillierte Einzel-Spec: `tasks/mcp-ui-p1-spec.md`.

Status: **Analyse/Plan, KEIN Code geschrieben.** Jede Phase laeuft (sobald gestartet) als eigener
Lean-Workflow (`phase-impl-lean`), Phase hart gepinnt, Baseline `master`, sequenzielle Merges.

## Kontext in einem Satz

Heute geben alle MCP-Tools nur `{content:[{type:'text'}]}` zurueck (`src/mcp-tools.js:101-260`).
Ziel: Progressive Enhancement — Stufe 0 (Text + `structuredContent`, universell) IMMER, Stufe 1
(optionale `ui://`-UI-Resource) nur fuer faehige Hosts, mit automatischem Fallback. Renderer hinter
einem Host-abstrakten Port (analog `src/telephony/ports.js`/`registry.js`).

## Owner-Entscheidungen (ENTSCHIEDEN, verbindlich; siehe Strategie-Doc Abschnitt 8)

1. **Q4 erstes Widget = ENTSCHIEDEN**: erstes Widget (P1) ist `get_call_status`
   (`design-system/mcp/call-status.html`), read-only, kein Callback -> kleinste Angriffsflaeche.
2. **Q5 Resource-Format = ENTSCHIEDEN**: Seam-Kern ist MCP-nativ (`ui://`-Resource, Claude MCP Apps);
   P1-Referenz-Impl ist MCP-nativ. Port host-abstrakt; ChatGPT Apps SDK kommt in P3 als zweiter
   Renderer/Adapter daneben.
3. **Q1 Standard-Konvergenz = ENTSCHIEDEN** (aufgeloest durch Q5): zwei Host-Konventionen werden
   dauerhaft akzeptiert, NICHT auf Protokoll-Konvergenz gewartet.
4. **Q6 Token-Pull-Gate = ENTSCHIEDEN**: Token-Sync `apps/web/src/styles/tokens/` ->
   `design-system/_shared/tokens.css` wird verpflichtendes CI-/Review-Gate (in P5 verankert); Drift
   automatisch verhindert.
5. **Q3 Callback-Eingang = ENTSCHIEDEN (Architektur-Invariante, greift in P4)**: Widget-Callbacks
   laufen verbindlich ueber denselben authentisierten `/mcp`+`mcpAuth`-Eingang, kein offener Postback.
   Schon jetzt fixiert; Bestaetigung per Gate-Test in P4. P1 ist read-only, daher nicht betroffen.

**Offen (KEINE Owner-Entscheidung, P0-Forschungsauftrag):**

- **Q2 Host-Erkennung** — empirisch in P0 belegen, welcher real existierende Host das gewaehlte
  `ui://`-Format mit Stand 2026 rendert; bis belegt fail-closed (unbekannt -> Stufe 0). Siehe das
  harte P0-Akzeptanzkriterium im P0-Abschnitt.

## Driver-Protokoll (Lead bleibt duenn)

- Pro Phase ein gepinnter Lean-Workflow; Plan -> Impl (Worktree) -> dualer Review -> Self-Fix bis
  PASS -> `tasks/<phase>-report.md` -> Postage-Stamp.
- **Lead liest NIE Diffs/Code.** Nur das Postage-Stamp (gate/finalBranch/testPassCount).
- **Gate=PASS** -> Lead merged `finalBranch` nach `master` (`git merge --no-ff`), dann naechste
  Phase. **Gate=BLOCKED** -> Kette stoppt, `remainingBlockers` an Owner.
- **Baseline aller Phasen: `master`** (sequenziell). **KEIN Push** zu origin/upstream/live
  (separate Owner-Entscheidung).

## Absolute Regeln (gelten in JEDER Phase, siehe CLAUDE.md)

- Safety-Gates (Allowlist/Denylist/Land/Stundenlimit/Budget global+pro-Tenant/Max-Dauer +
  Provider-Signaturpruefung) NIE entfernen/aufweichen/per-Default umgehen. Widget-Callbacks =
  normale authentisierte Tool-Calls durch ALLE Gates.
- Offenlegungssatz (`disclosureSentence`) bleibt fest verdrahtet; kein Widget-Setting schaltet ihn
  ab. Rich-UI beruehrt den Call-Pfad nicht.
- Auth fail-closed: `/mcp` bleibt hinter `mcpAuth`; KEIN neuer offener Endpunkt. Unbekannter Host
  -> Stufe 0 (kein Resource-Block).
- Secrets nur via env, nie ins `structuredContent`/Widget/Log; Fehler generisch/provider-frei.
- Audio nie durch MCP -> nie ins Widget (nur Transkript/Status/Summary).
- SCOPE: NUR die jeweilige Phase, EIN Widget/Host. Kein BDUF-UI-Framework vor dem ersten
  sichtbaren Widget. Kein neuer npm-Dep ohne Spec-Freigabe.
- Stufe 0 ist additiv: der heutige `{type:'text'}`-Pfad bleibt erhalten (Legacy/stdio
  byte-kompatibel, soweit eine Phase ihn nicht explizit zum Ziel hat).

---

## P0 — Vorklaerung (kein Code)

- **Ziel:** Owner-Fragen Q1-Q6 (Strategie-Doc Abschnitt 8) beantworten; Q2/Q3 sind P1-blockierend.
  Q2 (Host-Erkennung) ist der echte Engpass.
- **Scope:** Entscheidungen festschreiben (in dieser Datei). Keine Code-Aenderung.
- **DoD:** Q2 (Host-Erkennung) und Q4 (erstes Widget) entschieden; Q3 fuer read-only-P1 als
  "nicht relevant in P1" bestaetigt; Q5/Q6 fixiert.
- **Hartes P0-Akzeptanzkriterium (vor P1-Start):** P0 belegt mit Stand 2026 KONKRET, welcher real
  existierende Host (Claude MCP Apps und/oder ChatGPT Apps SDK) das gewaehlte `ui://`-Resource-Format
  (Q5) tatsaechlich rendert — mit Quelle/Doku-Beleg, nicht als Annahme. Sonst Risiko, dass der Seam
  um ein Format gebaut wird, das real KEIN Host rendert (P1 liefe ins Leere). Stufe 0 traegt zwar
  immer (gut gehedged, Stufe-1-Ausfall ist nicht fatal), aber genau dieser Beleg ist hier explizit
  Pflicht, nicht "spaeter pruefen".
- **Abhaengigkeit:** keine. Blockiert P1.

## P1 — Duenne vertikale Scheibe (EIN Tool, EIN Host, Seam + Fallback)

- **Ziel:** EIN read-only-Tool gibt Stufe 0 (`text`+`structuredContent`) UND eine Stufe-1-
  `ui://`-UI-Resource zurueck; EIN faehiger Host rendert; der `UiRenderer`-Seam beweist sich; der
  Fallback (nicht-faehiger Host -> Stufe 0) ist getestet.
- **Scope:** Vorschlag `get_call_status` (`src/mcp-tools.js:136-151`, Widget-Entwurf
  `design-system/mcp/call-status.html`). Seam-Skelett: `UiRenderer`-Port + Registry + EIN
  MCP-nativer Adapter. Daten-Kontrakt-Filter (Whitelist) fuer dieses eine Tool. Tokens aus
  `design-system/_shared/tokens.css` (kein zweiter Satz).
- **DoD:** Detailliert in `tasks/mcp-ui-p1-spec.md` (Akzeptanzkriterien inkl. Fallback-Test,
  Whitelist-Test, Token-Self-contained-Check). Dualer Review PASS; `npm test` gruen; lokaler Smoke.
- **Abhaengigkeit:** P0 (Q2/Q4).

## P2 — Zweites read-only-Widget

- **Ziel:** Seam-Wiederverwendung beweisen: ein weiteres read-only-Widget ohne Seam-Aenderung.
- **Scope:** Vorschlag `get_transcript` (`call-status` war P1) bzw. `get_agent_status`
  (`design-system/mcp/{transcript,agent-status}.html`). **Daten-Kontrakt-Kritisch bei
  `get_transcript`:** nur `result_summary`+`objective_achieved`, NIE Roh-Transkript (DSGVO-Purge,
  `mcp-tools.js:153-176`).
- **DoD:** Nur neuer `widgetId`+Template+Whitelist; Seam unveraendert; Fallback+Whitelist-Test;
  Review PASS.
- **Abhaengigkeit:** P1.

## P3 — Zweiter Host-Adapter (ChatGPT Apps SDK)

- **Ziel:** Host-Abstraktion beweisen: ein zweiter Renderer hinter demselben Port, MCP-nativer
  Kern unberuehrt.
- **Scope:** Neuer Adapter neben dem MCP-nativen; Registry waehlt anhand Host-Hinweis (Q2).
  KEIN Tool-Handler-Code aendert sich (nur der Renderer-Adapter + Registry).
- **DoD:** Bestehende Widgets rendern in beiden Hosts; unbekannter Host weiter Stufe 0; Review PASS.
- **Abhaengigkeit:** P1 (Seam steht), P0/Q2 endgueltig geklaert.

## P4 — Erstes Widget mit Callback (Schreib-Aktion)

- **Ziel:** Ein Widget, das ein Tool ZURUECKRUFT (z.B. `place_call`/`cancel_call`), unter voller
  Re-Validierung aller Safety-Gates.
- **Scope:** Callback = normaler authentisierter `/mcp`-Tool-Call (Q3 bestaetigt). ALLE Safety-Gates
  (Allowlist/Denylist/Land/Stundenlimit/Budget/Max-Dauer/Signatur) + Offenlegung gelten unveraendert.
  Kandidat-Widget `call-result.html` (`place_call`).
- **DoD:** Gate-Tests beweisen, dass der Callback durch alle Gates laeuft; kein Seitenkanal;
  Disclosure unberuehrt; Review PASS. **Hartes Sicherheits-Gate.**
- **Abhaengigkeit:** P1-P3, Q3 final.

## P5 — Token-Pull-Disziplin + Restschuld

- **Ziel:** Token-Sync-Gate verankern, Drift verhindern, Doku/STATUS nachziehen.
- **Scope:** Token-Pull (`apps/web/src/styles/tokens/` -> `design-system/_shared/tokens.css`) als
  Akzeptanzkriterium/Check; `@dsCard`-Index + `@import`-Verbot pruefen; offene Owner-Fragen aus
  P0/Q1/Q5 endgueltig schliessen.
- **DoD:** Token-Sync-Check gruen; Doku aktualisiert; Review PASS.
- **Abhaengigkeit:** P1 (mind. ein Widget live).

---

## Reihenfolge / Abhaengigkeits-Graph

```
P0 (Klaerung) --> P1 (Scheibe) --> P2 (2. read-only)
                       |---------> P3 (2. Host-Adapter)
                       |---------> P4 (Callback, hartes Gate; braucht Q3)
                       |---------> P5 (Token-Disziplin)
```

P1 ist der Engpass: ohne bewiesenen Seam + Fallback startet keine Verbreiterung. Read-only (P1/P2)
strikt vor Callback (P4). Ein Host (P1) vor zwei Hosts (P3).
