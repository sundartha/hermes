# Briefing: Hermes-Website als 3D-Scroll-One-Pager

Status: Vision/Auftrag (noch nicht umgesetzt). Vor der Umsetzung `.claude/refs/workflow.md`,
`.claude/refs/clean-code.md` und `docs/RUNBOOK-LAB-LIVE.md` lesen. **Erst Plan, dann Code.**

## Die Vision in einem Satz

Aus den heutigen Einzelseiten (Hero, `/so-funktionierts`, `/preise`) wird **eine einzige,
durchscrollbare Seite** mit einem echten Wow-Effekt: Man scrollt, und die Geschichte von
Hermes entfaltet sich Abschnitt für Abschnitt — begleitet von den **Hermes-Flügeln, die als
durchgehendes 3D-Motiv nativ durch die Seite schwirren** und die Abschnitte miteinander
verbinden. Premium, ruhig, hochwertig — im Stil von Studio-Freight/Lusion, aber unverkennbar
Hermes (Olymp, Flügel, griechisch/mythologisch, tiefes Nachtblau).

## Der Aufbau (eine Seite, von oben nach unten)

1. **Hero** — bleibt wie heute im Kern: „Give your AI wings.", Olymp/Wolken im Hintergrund,
   Flügel-Logo. Der Einstieg. Ein dezenter Scroll-Hinweis lädt zum Weiterscrollen ein.
2. **How it works** — die drei Schritte (Verbinden → Anrufen/Angerufen werden → Auswerten),
   die beim Scrollen nacheinander erscheinen. Die Flügel „führen" das Auge von Schritt zu Schritt.
3. **Use Cases** — konkrete Beispiele, was der Agent am Telefon macht (z. B. Anrufe entgegennehmen
   und Nachrichten/Termine aufnehmen, Outbound-Anrufe im Auftrag erledigen, mit Claude & Gemini
   über MCP). Jeder Use-Case ein eigener Scroll-Moment.
4. **Preise** — die Abo-Pakete, klar und ruhig präsentiert.
5. **Call-to-Action** — „Get your wings", der Abschluss.

> Empfehlung: `/so-funktionierts` und `/preise` als **schlanke Standalone-Seiten behalten**
> (für Direktlinks, SEO, Rechtliches), aber ihr Inhalt lebt zusätzlich im One-Pager. So verliert
> man nichts und gewinnt das Erlebnis.

## Das Flügel-Motiv (das Herz des Wow-Effekts)

Die Flügel sind nicht nur ein Logo, sondern ein **lebendiges Element, das die ganze Seite
durchzieht**:

- Sie **schwirren/gleiten sanft** durch den Hintergrund, reagieren aufs Scrollen (öffnen sich,
  drehen sich, treiben mit), fühlen sich „lebendig" an — nicht mechanisch.
- Beim Übergang zwischen Abschnitten **tragen sie das Auge weiter** (z. B. ein Flügel fliegt
  von „How it works" nach unten zu den Use Cases).
- Ruhe vor Effekt-Feuerwerk: langsam, elegant, teuer wirkend. Lieber ein starker Moment als zehn
  hektische.

Zwei mögliche Ausbaustufen:

- **Stufe 1 (schnell):** mit den **vorhandenen Flügeln** (PixiJS/Canvas-Wing-Engine, bereits im
  Repo) — scroll-getrieben animiert. Solide, markengetreu, wenig Risiko.
- **Stufe 2 (später):** ein **echtes 3D-Flügelmodell** (in Blender gebaut, per Blender-MCP,
  als GLB) mit Licht/Material für maximalen Tiefen-Effekt.

## Technische Leitplanken (verbindlich)

- **CSP-konform:** keine externen CDN-Skripte. Alles same-origin gebündelt (wie die bestehende
  Wing-Engine). `default-src 'self'` bleibt.
- **Bestehende Wing-Engine wiederverwenden**, nicht bei null neu bauen. Neue Abhängigkeiten nur
  mit Begründung.
- **awwwards-3d-Skill** (`.claude/skills/awwwards-3d/`) für Look, Scroll-Choreografie und
  (in Stufe 2) den Blender-Pipeline-Workflow nutzen.
- **`prefers-reduced-motion` respektieren**, **mobil** performant und lesbar, kein Ruckeln.
- **Marken-Fit:** Nachtblau (#0f2d52), Flügel, Olymp, Schrift wie bisher (Norse/Instrument Serif +
  Space Grotesk). Kein Fremd-Look.

## Arbeitsweise (sicher, nichts geht ungewollt live)

- In einem **eigenen Worktree/Branch** (`feature/scroll-fluegel`) arbeiten — nicht auf master.
- **Lokaler Vorschau-Server** (`npm run dev` in `apps/web`) zeigt alles live, nur auf dem Rechner.
- **Öffentlich live** geht nur bewusst über den Lab→Live-Weg aus `docs/RUNBOOK-LAB-LIVE.md`.
- **Erst Plan, dann Code:** vor der Umsetzung einen Umsetzungsplan vorlegen.

## Kurz-Auftrag für Claude Code

> Lies dieses Briefing (`PLAN-WEBSITE-3D-ONEPAGER.md`) sowie `.claude/refs/workflow.md` und
> `docs/RUNBOOK-LAB-LIVE.md`. Arbeite in einem neuen Worktree/Branch `feature/scroll-fluegel`.
> Setz die Hermes-Startseite als 3D-Scroll-One-Pager um (Hero → How it works → Use Cases → Preise
> → CTA) mit den Flügeln als durchgehendem, scroll-getriebenem Motiv. Nutz die `awwwards-3d`-Skill
> und die bestehende Wing-Engine, CSP-konform, `prefers-reduced-motion` beachten. Starte mit
> Stufe 1 (vorhandene Flügel). Erst Plan vorlegen, nichts deployen, am Ende die lokale
> Vorschau-Adresse nennen.
