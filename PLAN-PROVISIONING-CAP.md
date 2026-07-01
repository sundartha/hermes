# PLAN — Provisioning-Cap: Zaehlung robust + Sichtbarkeit (Fix A+B)

## 0. Kontext

Root-Cause-Analyse: `2026-07-01_vodafone-agent_telnyx-provisioning-strategie.md` (Larry-Deliverable) + `HANDOVER-TELNYX-402.md` (historischer Balance-Blocker, heute nicht mehr ursaechlich). Dieses PLAN-Doc ist die Lean-Template-Umsetzung der dort dokumentierten "Strukturell (Code, non-trivial)"-Fixes #1+#2. Strategie-Entscheidung (Phasenschnitt, Scope-Grenze, Invarianten) von Opus 4.8 getroffen, Ausfuehrung/Doku ueber Sonnet 5 (Modell-Wahl-Regel `~/.claude/CLAUDE.md`).

## 1. Root Cause (kurz — volle Analyse im Larry-Deliverable)

- `src/store/state-ops.js:921` prueft `liveNumbers(s).length >= maxNumbers` (Default 5, `src/config.js:273`) **bevor** ein Telnyx-`orderNumber`-Call ausgeloest wird. `liveNumbers` zaehlt vermutlich auch tote/Test-Nummern mit — der Cap greift dadurch faelschlich, obwohl echte zahlende Kapazitaet frei waere.
- Bei Cap-Skip: Abo/Payment laeuft durch (`outcome=ok`), Nummer bleibt aber aus (`webhook_provision_skipped grund=global_cap`) — rein internes Log, kein sichtbares Signal fuer Kunde oder Operator.

## 2. Harte Invarianten (diese Phase — zusaetzlich zu den generischen Safety-Gates aus CLAUDE.md)

- **Cap darf durch die Zaehl-Korrektur nur strenger, nie lockerer werden.** "Nur echte zahlende Tenant-Nummern zaehlen" darf nicht zu Unterzaehlung fuehren, die mehr Nummern durchlaesst als Cap ODER Billing-Zustand decken. Bei Ambiguitaet einer Nummer: konservativ **mitzaehlen** (fail toward not-provisioning), nicht wegzaehlen.
- **Sichtbarkeits-Fix ist reine Observability, kein Aktor.** Das Status-Signal darf Provisioning weder ausloesen noch retriggern noch den Cap-Check umgehen.
- **Kein False-Positive-Success, kein Leak.** Tenant mit aktivem Abo aber geskippter Nummer muss als recoverabler pending/blocked-Status erscheinen (nie als "provisioned"). Kein Secret-/Fremd-Tenant-Leak in state-API/Dashboard.
- Generisch (CLAUDE.md): Safety-Gates/Disclosure-Satz/Auth fail-closed unveraendert. Kein ungefragter neuer Endpunkt ohne dieselben Gates.

## 3. Phasenplan

Konvention: **Ziel · Scope (in/out) · Dateien-Hinweis · deterministisch erwartetes Ergebnis · Verifikation** (Verifikation ist der Feedback-Loop, workflow.md Regel 7).

### Phase A — Cap-Zaehlung robust + Skip sichtbar machen

- **Ziel:** `liveNumbers`-Zaehlung zaehlt nachweisbar nur echte, zahlende Tenant-Nummern (keine toten/Test-Nummern); ein Cap-Skip erzeugt ein fuer Kunde/Operator sichtbares Status-Signal statt eines stillen internen Logs.
- **Scope IN:** Zaehl-Logik in `src/store/state-ops.js` (Cap-Check-Pfad); Status-Feld im Self-Service-State (`src/store/portal.js`/API) plus ggf. Operator-Sicht, das den `global_cap`-Skip fuer den betroffenen Tenant erkennbar macht.
- **Scope OUT:** Kein Aendern von `MAX_NUMBERS` selbst (Env-Wert bleibt Operator-Entscheidung, siehe § 5). Kein dynamischer Cap/Monitoring (§ 4, deferred). Keine Aenderung an Telnyx-`orderNumber`-Aufrufkette selbst.
- **Dateien (Hinweis, keine Zeilennummern):** `src/store/state-ops.js` (Cap-Check + `liveNumbers`), `src/store/portal.js` oder `src/store/views.js` (Self-Service-State-Shape), `src/server.js` nur falls neues Feld durchgereicht werden muss. Bestehender Audit-Log (`webhook_provision_skipped grund=global_cap`) als Quelle nutzen, nicht duplizieren.
- **Erwartet (deterministisch):**
  - `node:test`: Cap-Check mit gemischtem Bestand (aktive + tote/Test-Nummern) zaehlt nur aktive korrekt; Cap greift NICHT vorzeitig, wenn echte Kapazitaet frei ist.
  - `node:test`: Self-Service-State fuer einen Tenant mit `global_cap`-Skip zeigt einen erkennbaren Status (nicht "provisioned", nicht stillschweigend leer).
  - Bestandssuite weiterhin gruen (kein Verhalten fuer nicht-betroffene Tenants geaendert).
- **Verifikation:** `npm test` (neue + Bestandstests, beide Backends json+pglite). Smoke best-effort: lokaler Server, Tenant mit simulierten toten Nummern seeden, State-Endpoint curlen.

## 4. Explizit NICHT in Scope dieser Phase

**Dynamischer Cap / Monitoring-Alerting** (harter globaler Cap=5 skaliert strukturell nicht mit der "Millionen-Nutzer"-Vision, CLAUDE.md) — bewusst **deferred als separates Owner-Entscheidungs-Thema**. Undesignte Architektur-Frage; im selben Lauf mitzunehmen waere BDUF. Die Sofortmassnahme (§ 5) kauft ohnehin Laufzeit, Deferral ist risikolos. Braucht eigenes Research/Design, bevor es zu einer Phase wird.

## 5. Operator-Sofortmassnahme (unabhaengig von dieser Phase, VOR/parallel — nicht Teil dieses PLAN-Docs)

`MAX_NUMBERS` Render-Env 5→20 + Retry-Call fuer Jonas' Tenant (siehe Larry-Deliverable § "Sofort"). Zero-Code, entsperrt heute zahlende Kunden sofort. Bleibt Owner-Aktion (Render-Dashboard-Zugriff + Produktions-Trigger) — **nicht** Teil der automatisierten Umsetzung hier. Fix A bleibt trotzdem noetig: 20 zaehlt sonst weiter tote Nummern mit und der Cap greift irgendwann wieder faelschlich.

## 6. Umsetzung

Ausschliesslich ueber `phase-impl-lean` (Worktree-isoliert, dualer Review, Self-Fix-Loop, Report-Datei). Kein automatisches Merge/Push — Branch-Review + manuelles Push bleibt bei Jonas (bestehendes Protokoll).
