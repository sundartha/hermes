# Prompt fuer die naechste Session — Strategiedokument "Ist-Kosten statt Schaetzung"

Alles ab der Trennlinie ist der Prompt. In einer **frischen Session** einfuegen.

---

Erstelle ein Strategiedokument `PLAN-LIVE-COST-TRACING.md` im Repo-Root, das den Umbau von
**geschaetzten auf gemessene Kosten** in Phasen plant. Du planst und schreibst das
Dokument — du setzt NICHTS um. Die Umsetzung ist eine spaetere Kette.

## Das Problem in einem Satz

Der Dienst bucht Kosten als `minuten * konfigurierter_tarif` — **auch nach dem Anruf**. An
keiner Stelle wird je gegen den echten Provider-Preis geprueft. Der konfigurierte Tarif lag
um Faktor 5 daneben, und niemand konnte es sehen.

## Ausgangslage (GEMESSEN am 2026-07-19/20, nicht neu herleiten)

Alle Zahlen stammen aus den Telnyx Usage Reports
(`GET /v2/usage_reports?product=<p>&dimensions=<d>&metrics=cost,billed_sec,completed&start_date=<ISO8601>&end_date=<ISO8601>`,
Fenster max. 31 Tage, Dimensionen kommagetrennt) und aus der Prod-DB.

| Kostenart | gemessen | im Code gebucht? |
| --- | --- | --- |
| Telefonie (sip-trunking + call-control) | 3,9 €ct/min | ja, als `minuten * tarif` |
| Speech-to-Text (Deepgram im Gather) | 0,6 €ct/min | **nein** |
| Text-to-Speech (Telnyx) | 0,6 €ct/min | **nein** |
| Recording + Inference | 0,05 €ct/min | **nein** |
| Claude-Tokens | 0,27 €ct/min | ja, ueber `trackUsage` |
| **Variabel gesamt** | **5,4 €ct/min** | — |
| ElevenLabs | **6,00 USD/Monat FIX** (Starter, ~40k Zeichen) | **nein** |
| DID-Miete | **nie gemessen** | **nein** |

Konfiguriert war `VOICE_TARIFF_DOMESTIC_CENTS=20` — laut `.env.example` ausdruecklich ein
"Worst-Case-Default, live mit dem Provider-Tarif abgleichen". Das wurde nie getan.
Folge: 779 Cent gebucht, wo 282 real angefallen waren (**Faktor 2,1 ueberbucht**).

**KI ist NICHT der Kostentreiber (~7 %), Telefonie dominiert.** Wer optimiert, optimiert
die Leitung, nicht das Modell.

## Die harte Grenze, die den Entwurf bestimmt

**Das Gate muss VOR dem Anruf reservieren, die Ist-Kosten kennt man erst DANACH.**
Live-Messung kann die Schaetzung deshalb nie ersetzen, nur kalibrieren. Ein Entwurf, der
das ignoriert, ist falsch.

## Vorgeschlagene Stufen (pruefen, nicht ungeprueft uebernehmen)

1. **Abrechnung auf Ist-Kosten.** Nach dem Anruf den echten Preis aus dem Provider-CDR
   holen und *den* buchen statt `minuten * tarif`. Danach ist `costCents` Wahrheit statt
   Annahme. Risikoarm — die Reserve bleibt unberuehrt. **Das allein haette den Vorfall
   verhindert.**
2. **Reserve-Tarif rollend nachkalibrieren.** Pro Ziel-Praefix ein p95 der letzten N echten
   Anrufe, gedeckelt durch einen harten Konfig-Hoechstwert.
3. **Decken aus dem Abo ableiten.** `cap = includedMinutes * kalibrierter_satz * Faktor`.
   Kontrolle: Starter 30 min * 3,9 ct * 2,5 = 2,93 EUR, Business 120 min * 3,9 ct * 1,45 =
   6,79 EUR — deckungsgleich mit den vom Owner gesetzten 3 / 9 EUR.

Zusaetzlich zu klaeren: **STT, TTS, ElevenLabs und DID-Miete gehoeren heute in KEINE
Kostenachse.** Entscheide begruendet, was davon in `costCents` gehoert (variabel,
pro Tenant zurechenbar) und was Plattform-Fixkost bleibt.

## Pre-Mortem, das im Dokument stehen MUSS

- **Ein selbstjustierender Wert auf dem Geld-Pfad ist neue Angriffsflaeche fuer Regel 1.**
  Heute ist der Tarif dumm und falsch, aber vorhersagbar. Danach ist er klug und beweglich.
- **Rueckkopplung:** die Kalibrierung speist sich aus Anrufen, die das Gate durchgelassen
  hat. Sinkt der Satz faelschlich, gehen mehr Anrufe durch. Nur in einem Band bewegen,
  Hoechstwert bleibt Konfiguration.
- **CDR-Verzug:** Ist-Kosten kommen verzoegert. Das Gate laeuft zwischenzeitlich auf altem
  Stand — fuer eine langsame Groesse wie einen Tarif akzeptabel, aber bewusst zu entwerfen.
- **Ausfall der Messung darf NIE "kein Limit" bedeuten.** Provider-API weg -> letzter
  bekannter guter Wert, sonst konservativer Konfig-Default. Das ist die
  fail-open-durch-Vergessen-Klasse, die P1 gerade geschlossen hat.
- **Premium-Ziele:** ein rollender Durchschnitt unterschaetzt den ERSTEN teuren Anruf einer
  neuen Destination immer. Pro Praefix, harter Deckel fuer Unbekanntes.
- **ElevenLabs-Kontingent als unsichtbare Wand:** ~40.000 Zeichen/Monat bei ~83
  Zeichen/Minute = **~480 Sprechminuten plattformweit**. Vier Business-Kunden bei voller
  Nutzung erschoepfen es, dann faellt TTS aus — und kein Budget-Gate warnt, weil es ein
  Festpreis-Abo ist. Gehoert in den Plan.

## Umgebungs-Randbedingungen (nicht dagegen planen)

- Render **Free Tier**: kein Cron, kein preDeploy, keine Shell. Migrationen laufen bei
  `migrate()` im DB-Connect.
- Der Live-Dienst ist **Dashboard-managed**, `render.yaml` ist nur Doku, und
  **`autoDeploy` steht auf `no`** — ein Push deployt NICHTS, der Deploy wird manuell
  ausgeloest.
- Deploy-Remote ist `upstream` (jonas986), nicht `origin`.
- `hermes-db` laeuft am **2026-07-24** ab.
- Secrets liegen lokal in `.env` (Telnyx, ElevenLabs, Anthropic), die Prod-DB-URL in
  `~/.config/hermes/db-url`. Unter `FORCE ROW LEVEL SECURITY` liefert ein naives SELECT
  **0 Zeilen** — pro Tenant `set app.current_tenant = '<id>'` setzen; `tenant` selbst hat
  keine RLS.

## Vorgehen fuer diese Session

Nutze einen **dynamischen Workflow** (Workflow-Tool) mit mehreren Agenten:
Recherche/Messung parallel -> Entwurf -> **adversarialer Review** -> **Clean-Code-Review**
gegen `.claude/refs/clean-code.md` -> Synthese. Modell-Pins explizit pro `agent()`
(Opus fuer Entwurf und Safety-Review, Sonnet fuer Recherche/Audit/Report) — **nie erben
lassen**.

Das Zieldokument folgt dem Aufbau von `PLAN-BUDGET-AXES.md`: Lage, Messung (Beweis),
Befunde, Begriffsmodell, Phasen mit Abhaengigkeiten und Rot-vor-Fix-Tests, Reihenfolge mit
Schutzniveau je Zwischenstand, offene Entscheidungen, Pre-Mortem, bewusste
Nicht-Ziele. Text OHNE Umlaute (Repo-Konvention).

## Zwei Regeln, die aus dem Vorfall stammen

1. **Erst messen, dann planen.** Der Vorgaengerplan behandelte 20 ct/min als gegeben und
   baute darauf eine siebenphasige Kette. Falsifiziere jede Kostenannahme am Provider,
   BEVOR du eine Phase darauf stuetzt.
2. **Bei Kostenfragen ALLE Produkte des Providers aufzaehlen**, nicht die naheliegenden.
   STT, TTS und ElevenLabs wurden zweimal uebersehen; das verschob das Ergebnis um 56 %.

## Was NICHT Teil dieser Session ist

Kein Code, kein Deploy, keine Env-Aenderung. Nur das Dokument.

## Stand des Vorgaengerprojekts (Kontext)

`PLAN-BUDGET-AXES.md` P1-P7 sind auf `master` gemergt (`590a6c0`, Suite 2638/0) und seit
dem Deploy live. `BUDGET_MONTH_ENABLED` steht auf `false` — der Monats-Reset ist gebaut,
aber nicht scharf. Offen aus jener Kette: **P7b** (Plattform-Cap aus der Summe der
Tenant-Decken ableiten statt fest setzen) und **P8a** (Flag entfernen, braucht einen vollen
Monatszyklus mit Flag AN). Phasen-Reports unter `tasks/budget-axes-*-report.md`.
