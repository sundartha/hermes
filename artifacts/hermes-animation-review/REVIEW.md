# Hermes Animation Lab — Review

Stand: 2026-06-26. Drei Presets gebaut, deterministisch erfasst und visuell geprueft.
Keypose-Screenshots in diesem Ordner: `<preset>-<keypose>.png`, plus `_legibility-48px.png` /
`_legibility-96px.png`.

## Markenelement / Transparenz

- Genutztes Asset: `apps/hermes-animation-lab/public/hermes-wing.png` — 500x500, **echtes RGBA**
  (~71% transparent, ~1% weiche Kanten, alle Ecken alpha=0). Sichtbare Form x[97..404] y[21..455].
- Die zuerst gelieferte Datei war RGBA, aber **zu 100% opak** (weiss-auf-weiss, keine verlustfreie
  Freistellung moeglich). Der Owner hat die saubere transparente Version nachgeliefert (hier verwendet).

## Globale Verformungs-Gains (`src/wing/deform.ts`)

| Konstante | Wert | Bedeutung |
|---|---|---|
| FLAP_GAIN | 0.26 rad | max. Schlagwinkel der Spitzen pro Einheit `flap` |
| BEND_GAIN | 0.24 rad | Spitzen-Kruemmung pro `bend` (Gewicht w²) |
| TIPLAG_GAIN | 0.22 rad | verzoegertes Nachschwingen pro `tipLag` |
| ROOT_ROT_GAIN | 0.22 rad | Gesamtneigung pro `rootRotation` |
| COMPRESS_GAIN | 0.28 | radiale Stauchung pro `compression` |
| WEIGHT_EXPONENT | 1.7 | konzentriert Bewegung auf die Aussenfedern (kompakter Flatter) |

Root-Default (normiert): **(0.23, 0.88)** = untere linke Fluegelwurzel. Mesh 16×24 Segmente.

## Presets

Jede Schlaggruppe tweent nur die animierten Kanaele (flap/bend/compression/tipLag); GSAP-Eases.

### A · Hermes Classic — `~0.68 s` aktiv
Antizipation (flap −0.28) → Hauptschlag (flap 1.0, bend 0.6, comp 0.45, `power3.out`) →
elastischer Rueckstoss (`elastic.out`) → 2. Schlag (flap 0.55) → Einpendeln. Klarer Logo-Doppelschlag.

### B · Rapid Messenger — `~0.61 s` + Pause
Drei sehr schnelle kleine Schlaege (flap 0.62, bend 0.42, je ~0.17 s, enger Bogen). Fuer „working".

### C · Premium UI — `~0.92 s`
Ruhiger, eleganter Doppelschlag, geringerer Ausschlag (flap 0.6) bei staerkerer Biegung (bend 0.8),
weiche `power`-Eases. Fuer hochwertige Website-Animation.

## Technische Pruefung (visuell bestaetigt)

- Immer genau **ein** Fluegel, **eine** Textur, **ein** Mesh — keine Klone/Spiegelung/Trails.
- Fluegelwurzel bleibt fest; Silhouette teilt sich nie; Seitenansicht erhalten.
- Mesh kehrt bei `idle`/Endpose **exakt** zur Originalform zurueck (von-Original-rechnen, kein Drift).
- Bei **48 px** noch als Fluegel erkennbar.
- Typecheck + Build gruen; Backend-Suite unberuehrt (1022/1022).

## Empfehlung „am stabilsten"

**C · Premium UI.** Geringster Spitzen-Ausschlag bei sanftesten Eases → kleinste Mesh-Dehnung,
sauberste Rueckkehr, ruhigstes Verhalten bei jeder Groesse. (B Rapid ist die natuerliche Wahl fuer
den `working`-Status; A Classic ist der ausdrucksstaerkste Logo-Schlag.)
Finale Auswahl trifft der Owner visuell.
