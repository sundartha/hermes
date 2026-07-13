# PLAN-WEBSITE-3D-V2 — "Descent to Olympus" v2

> Source-of-truth-Strategie: aus dem `feature/scroll-fluegel`-One-Pager eine Award-reife,
> in Hermes/Olymp verankerte Scroll-3D-Seite machen. **Bestehenden Build verbessern, kein Rewrite.**
> Synthese aus 6 Research-/Diagnose-Reports (A Referenz-Scout, B Uebergangs-Katalog, C Motion-
> Stabilitaet, D lebendiger Fluegel, E Jitter-Diagnose, F Fluegel-Inventar) + First-hand-Codepruefung.
> Sprache: Deutsch, ohne Umlaute (Repo-Konvention); Code-Bezeichner/Fachbegriffe englisch.

---

## 0. TL;DR — die eine grosse Idee

**Nicht mehr durch EINE Umgebung dollyen — den Boten durch DISTINKTE Welten des Mythos hinab
fliegen lassen, und den Fluegel wirklich fliegen lassen.** Heute ist es eine durchgehende
Kamerafahrt durch einen Nebelraum mit einem starren Fluegel, der nur wippt — daher liest es sich
als "ein Fluegel, der links<->rechts gleitet". v2 re-inszeniert das Scrollen als **fuenf
committete Welten** (Ueber den Wolken -> Der Flug des Boten -> Die Agora -> Die Schwelle -> Der
Tempel), jede mit eigener Licht-/Grade-/Nebel-Identitaet, getrennt durch **benannte kinematische
Naehte** (Nebel-Reveal, Partikel-Uebergabe, EIN fluegelfoermiges Portal, Cross-Dissolve).

**Der Held-Fluegel ist der ECHTE Animation-Lab-Fluegel** — die gemalte Illustration
`hermes-wing.png` mit der bewaehrten Lab-Bewegung (`deform.ts` + Presets `classic`/`rapid`/
`premium`/`olympian`), zum ersten Mal in die 3D-Seite gebracht und weiter veredelt. **Der bisherige
3D-GLB-Fluegel fliegt raus.** Gewinnt, weil es alle vier Owner-Beschwerden an der Wurzel loest:
Abwechslung (distinkte Welten), Leben (echte Schlag-Presets), das Zittern (EINE Glaettungsstufe,
nicht zwei), und der mythische rote Faden (Hermes, der gefluegelte Seelenfuehrer, der zwischen
Welten geleitet) — bei maximaler Wiederverwendung aller bereits vorhandenen Assets.

---

## 1. FLUEGEL-MANDAT (Owner-Korrektur, BINDEND)

Der bisherige 3D-GLB-Fluegel (`/assets/hermes-wing.glb` + `makeNacreMaterial`) ist **RAUS**.
Er ist ein klobiger 3D-Nachbau, der wie ein steifer Faltfaecher aussieht. Held-Fluegel =
**der echte Lab-Fluegel**: die weiche, gemalte Feder-Illustration
`apps/hermes-animation-lab/public/hermes-wing.png` (500x500 RGBA) + die echte Lab-Bewegung,
**nur weiter verbessert. Kein Nachbau, kein Ersatz-Modell.**

**Technisch verifiziert (first-hand, nicht geraten):**

- `apps/hermes-animation-lab/src/wing/deform.ts` ist **reine, engine-unabhaengige Vertex-Mathematik**
  (importiert NUR Typen; kein Pixi, kein DOM). Nimmt Original-Vertex-Positionen + Gewichte + Root +
  einen `HermesMotionState` und schreibt verformte Positionen nach `out`. Kanaele:
  `beat`/`flap`/`bend`/`tipLag`/`rootRotation`/`compression` + `lift` (Ganz-Fluegel-Auftrieb) +
  `intensity`. Bei Ruhe **byte-gleich zur Original-Geometrie** (kein schleichendes Verformen).
- => **Portierbar:** dieselbe `deform()`-Mathe auf eine unterteilte three.js-`PlaneGeometry` (17x25,
  wie der Lab-Mesh `SEGMENTS_X=16 x SEGMENTS_Y=24`) mit der PNG-Textur anwenden. So lebt der ECHTE
  Lab-Fluegel in der 3D-Szene; Fog/Parallax/Grade der Welt greifen auf ihn.
- `presets.ts` (die GSAP-Timelines `classic`/`rapid`/`premium`/`olympian`) sind das eigentliche,
  handgetunte Asset (Anticipation -> Kraftschlag -> Tip-Lag-Follow-through -> Auftriebs-Settle).
  **Verbatim wiederverwenden** — nur der Consumer (Pixi-MeshPlane -> three.js-Plane-Buffer) tauscht.
- Gold ist im Lab default AUS -> exakt der weisse Fluegel. Owner-Lock: **KEIN Gold**, kuehler Nacre.

**Der ehrliche Zielkonflikt (eine Owner-Entscheidung, siehe Abschnitt 5 + 10):** Der Lab-Fluegel
ist eine **flache 2D-Malerei**. Eine flache Ebene in 3D ist ein Billboard und kann sich nicht echt
im Raum drehen (von der Kante = unsichtbar). Genau deshalb entstand der GLB. Loesung ist NICHT der
GLB, sondern: den 2D-Fluegel **in-plane** leben lassen (Schlag/Auftrieb/Kompression via `deform.ts`),
Tiefe ueber Parallax + Licht + Skalierung faken, und Blender **nur zur Kunst-Veredelung** der Malerei
(Relief/Normalmap/hoehere Aufloesung), nicht zum Ersetzen der Silhouette. Details unten.

---

## 2. Wo wir stehen (ehrliche Diagnose)

### Was wirklich gut ist (behalten)
- **Korrektes Render-Fundament:** DPR auf 2 gedeckelt, ein `dt`/Frame mit `DT_CAP_SEC=0.05`-Clamp,
  framerate-unabhaengiges `damp()` (`1 - pow(1-ease, dt*60)`), `setSize(w,h,false)`, Resize
  aktualisiert Renderer+Composer+Kamera im Gleichschritt.
- **rAF-Reihenfolge stimmt schon:** `lenis.raf(now)` -> `lenis.progress` lesen -> anwenden ->
  rendern, eine Aufrufstelle, kein Stale-by-one-frame.
- **DOM-Reveals entkoppelt** ueber `IntersectionObserver` (nicht pro Frame gepollt).
- **Ein-Input-treibt-alles** ist schon da: Fog/Bloom/wingRot haengen an EINEM `p` in `poseAt(p)`.
  Der Instinkt ist richtig; der Bug sitzt davor.
- **Das Fluegel-Bewegungsproblem ist schon einmal geloest** — in 2D, im Animation Lab. Vier
  handgetunte Presets mit korrekten Animationsprinzipien + immer laufendes 3-Sinus-Ambient-Schweben.
  **Nichts davon war je an den 3D-Fluegel verdrahtet.** Das ist die Luecke.

### Warum es sich trotzdem langweilig anfuehlt
- **Nur Motion-Layer 3 existiert.** Award-Creature-Scroll-Seiten fahren drei Layer: (1) authored
  Clip/Deform, (2) prozedurales Idle+Banking, (3) Scroll->State-Mapping. Hermes hat Layer 3 (die
  `BEATS`-Tabelle) und einen Stummel von Layer 2 (`sin(clock*0.6)*0.08` Bob + `sin(clock*0.4)*0.03`
  Roll). **Layer 1 fehlt komplett** — der GLB wird nur mit dem Nacre-Material bespielt, sonst
  bewegt sich am Fluegel selbst NICHTS. Diese Abwesenheit, nicht die Tech-Wahl, ist die Wurzel von "flach".
- **Eine durchgehende Dolly = eine Welt.** Gleiches Licht-Rig, nur andere Nebelfarben auf einer
  monotonen Rampe. Keine Welt-eigene Licht-/Grade-Identitaet, keine Naht, die als "neuer Ort" liest.

### Das Zittern — Wurzel mit Code-Evidenz (Report E, bestaetigt durch C)
Zwei unabhaengige Ursachen stapeln sich:

1. **Doppelte Glaettung (kaskadierte Tiefpaesse).** Lenis liefert bereits `progress` *geglaettet und
   nachlaufend*. `onepager.js` gibt das in `scene.setProgress(p)` -> `targetP`, und `scene3d.js`
   filtert es in `frame()` **ein zweites Mal**: `st.p = damp(st.p, targetP, 0.08, dt)`. Zwei
   Tiefpaesse in Serie = System zweiter Ordnung mit Resonanzspitze; ruckartiger Wheel-/Trackpad-Input
   regt sie an -> geringes Ueberschwingen/Nachschwingen = "zittert", am schlimmsten bei
   Scroll-Umkehr und abruptem Stopp.
2. **Frame-Zeit-Rauschen in `damp()`.** `dt` ist das rohe, ungeglaettete rAF-Delta und speist eine
   schwere Kette: `EffectComposer` (RenderPass -> UnrealBloom multi-pass -> Vignette -> OutputPass)
   **plus `antialias:true`** (MSAA + Multi-Pass-Bloom auf demselben Buffer) plus eine `VideoTexture`,
   die jeden Tick neu hochgeladen wird. Jeder GC-/Decode-/Compositor-Stall macht `dt` unregelmaessig
   (12/22/14ms); bei FOV 40 und nur ~6 Einheiten Abstand ist Sub-Prozent-Positionsrauschen sichtbar.

Sekundaer: **C1-unstetige Beat-Interpolation** — `camX` wechselt an fast jedem `BEATS`-Breakpoint das
Vorzeichen; per-Segment-smoothstep garantiert C0, nicht C1 -> ein verrauschtes `st.p` am Breakpoint
kippt die Interpolationsrichtung (lokaler Ruck an 6 Punkten). Und **Bloom-Threshold-Flicker** —
Video-Codec-Rauschen tanzt ueber `BLOOM.threshold=0.9`. `pointermove`-Parallaxe ist ein dritter
verrauschter Kanal in dieselbe Transform. **Fixed-Layer-Desync ist AUSGESCHLOSSEN** — `.wing-stage`
ist sauberes `position:fixed` ohne transformierten Vorfahren (first-hand verifiziert).

---

## 3. Das Konzept: Welten, die beim Scrollen entstehen

**Roter Faden:** Hermes — gefluegelter Bote, Fuehrer zwischen den Welten, Gott der Schwellen und des
Handels — steigt vom Horst ueber den Wolken hinab, fliegt die Botschaft durch den Himmel, quert den
Marktplatz der irdischen Auftraege, durchschreitet die eine wahre Schwelle und kommt im Tempel an,
wo man seiner KI "Fluegel gibt". Der **Fluegel ist der einzige Blick-Anker**: an JEDER harten Naht
on-screen, mitten in Bewegung, lesbar — ein Portal/Cut feuert nie, waehrend der Fluegel in Ruhepose
ist; der Cut-Trigger haengt am Animations-Fortschritt des Fluegels, nicht an einem rohen Scroll-Pixel.

| Welt | Sektion | Was erscheint | Uebergang HINEIN | Rolle des Fluegels |
|---|---|---|---|---|
| **I. Ueber den Wolken** (Horst / Schwelle des Himmels) | Hero | Kuehl-helle Nacre-Luft, hohe duenne Wolkenschelfe, Fluegel am Gipfel des Himmels; hellste/kuehlste Belichtung | — (Eroeffnungszustand) | `premium`-Preset niedrige Intensitaet + 3-Sinus-Ambient: langsam, elegant, atmend — bereit, noch nicht fliegend |
| **II. Der Flug des Boten** (Abstieg durch den Himmel) | How it works | Kamera sinkt durch Parallax-Wolken in dichter werdenden Navy-Nebel; die drei "How"-Beats als Wegpunkte des Flugs | **Nebel-Reveal** + Licht/Belichtung kuehl->tiefer, Dolly *innerhalb* der Welt | `olympian`-Kraftschlaege an jedem Wegpunkt (der lesbare Falt->Spreiz-Goetterschlag), dazwischen `rapid` low-intensity — jetzt fliegt er |
| **III. Die Agora** (Marktplatz der Auftraege — Hermes Gott des Handels) | Use cases | Waermeres, geerdetes Licht; jeder Use-Case (Anruf annehmen -> Termin -> Nachfassen) als leichte Sub-Szene | **Partikel-Uebergabe** (Wolkenmotes waermen zu Agora-Staub) + **Cross-Dissolves** zwischen den Sub-Szenen | `classic`-Preset — getragener, arbeitender Flug; bankt zu jedem Use-Case, als "liefere" er |
| **IV. Die Schwelle** (Tor des Olymp — Hermes Psychopompos) | Pricing | Der Tempel loest sich durch eine **fluegelfoermige Iris** auf, die sich schliesst und als Tuer oeffnet; engste Vignette, warmes Streiflicht | **Portal / Iris-Wipe** — die EINE harte Schwelle der Seite; DOF-Pull-Focus "Atem vor dem Cut" auf den Fluegel (nur Desktop-Tier) | `olympian` Falt->Spreiz-Snap getimt zur Iris: **der Fluegel IST die Tuer** — faltet beim Schliessen, spreizt beim Reveal |
| **V. Der Tempel** (Olymp-Inneres / Ankunft) | CTA | Tempel-Inneres, warmer Bloom, still und ehrfuerchtig; "Give your AI wings" | **Cross-Dissolve** + Licht/Belichtung waermer settle | `classic` Auftriebs-Settle -> Spreiz-Ruhepose; Ambient kehrt zurueck — der Bote ist angekommen |

**Naht-Disziplin (Report B):** weiche Techniken (Fog, Grade, Licht) sind der durchgehende Kleber
*innerhalb/zwischen* jeder Welt und laufen kontinuierlich auf dem einen Progress-Wert; **genau EIN
Portal** (Welt IV), und es ist fluegelfoermig; DOF nur als Ein-Beat-Pre-Portal-Cue und nur Desktop.
Ein `RealmManager` haelt hoechstens eine aktive + eine uebergehende Welt und disposed den Rest ->
reichere Welt-Inhalte bleiben im Ein-Welt-GPU-Budget, Zurueckscrollen instanziiert sauber neu.

---

## 4. Der Fluegel, zum Leben erweckt (KORRIGIERT: der echte Lab-Fluegel)

Kein "Fluegel-Animation von Grund auf"-Problem, sondern eine **Laufzeit-Portierung von bereits
Owner-abgenommenem TypeScript**. Der GLB entfaellt.

### Kern: der Lab-2D-Fluegel in der 3D-Szene
- **Asset:** `hermes-wing.png` (die gemalte Illustration) als Textur auf einer unterteilten three.js-
  `PlaneGeometry` (17x25). Ersetzt den GLB UND den bisherigen Billboard-Platzhalter.
- **Bewegung:** `deform.ts` (`buildWeights` + `deform`) verbatim portieren -> pro Frame die
  Plane-Vertex-Positionen deterministisch aus der Original-Geometrie neu rechnen. Gleiche Gains,
  gleiche Konstanten (`WEIGHT_EXPONENT=1.7`, `TIP_BAND_START=0.45`, `BEAT_GAIN`, `FLAP_GAIN`, ...).
  Root fix, Aussenfedern am staerksten, Tip-Lag auf der Aussenbande. `lift` + Ambient als
  Group-Transform (dieselbe Naht, die heute `wing.position`/`wing.rotation` haelt).
- **Presets:** `presets.ts`-Timelines verbatim; eine Preset-Zuordnung pro Welt (Tabelle unten).
- **Idle-Leben statt Bob:** den einzelnen Bob+Roll durch das **echte Lab-3-Sinus-Ambient**
  (`AMBIENT_X_PX=5`, `AMBIENT_Y_PX=9`, `AMBIENT_ROT=0.022`, phasenversetzt) + einen dezenten
  Atem-Scale-Puls + optionalen Simplex-Micro-Flutter pro Spitze ersetzen. Der Fluegel ist zwischen
  den Schlaegen nie ganz tot.
- **Schimmer -> Nacre, nicht Gold.** Den Lab-Motion-Puls (`shimmer = (max(0,flap)*SHIMMER_FLAP +
  max(0,lift)*SHIMMER_LIFT)*intensity`) auf `envMapIntensity`/`sheen`/`clearcoat` legen — ein kuehler
  Nacre-Glanz auf jeden Schlag. (Owner-Lock: kein Gold.)

### Tiefe: 2D-Billboard vs. sanftes 2.5D (Owner-Entscheidung, siehe Abschnitt 10, Frage 1)
- **A — Reines 2D-Billboard (empfohlen fuer Phase 1):** Ebene immer kamerazugewandt; Schlag/Bank
  rein ueber `deform.ts` (In-Plane-Rotation um den Root + Kompression). Exakt die Lab-Optik, null
  Risiko, die Malerei bleibt immer voll lesbar. Tiefe kommt aus Parallax/Skalierung/Fog.
- **B — Sanftes 2.5D (OWNER-GEWAEHLT 2026-07-07):** die Ebene darf leicht in 3D neigen (kleine
  Yaw/Pitch, nie Richtung Kante), faengt so Welt-Licht/Parallax staerker, wirkt teurer/raeumlicher.
  Mehr Craft, Risiko haesslicher Kanten bei Uebertreibung -> Neigung begrenzen. Umsetzung: Phase 1
  landet den Fluegel pragmatisch (leichte Neigung ok), Phase 3 tunt das 2.5D-Verhalten + die
  Blender-Relief-Veredelung, die mit der Neigung erst richtig traegt.

### Blenders Rolle: die Malerei VEREDELN, nicht ersetzen (optional, Owner-gegated)
Blender baut **kein Ersatzmodell**. Wenn ueberhaupt, dann um das 2D-Asset reicher zu machen:
- **Relief/Normalmap-Bake** der Federstruktur -> die flache Ebene faengt Welt-Licht wie eine
  Reliefflaeche (Tiefe ohne Geometrie, unter dem bestehenden Nacre-Material).
- **Hoehere Aufloesung / saubere Retusche** des Fluegel-Renders (schaerfere Federspitzen, groesser
  skalierbar ohne Unschaerfe).
- **Optional 2.5D-Displacement** einer leichten Woelbung. Kein Draco/meshopt (WASM = CSP-Bruch);
  Assets bleiben lokal + klein.

### Schlag/Atem-Verhalten pro Welt
| Welt | Preset (gefeuert) | Idle dazwischen | Atem/Puls |
|---|---|---|---|
| I Ueber den Wolken | `premium` (langsam) | Ambient 3-Sinus | sanfter Scale-Puls |
| II Flug des Boten | `olympian` Kraftschlag je Wegpunkt | `rapid` low-intensity | Sheen-Puls je Schlag |
| III Agora | `classic` (getragen) | Ambient-Schweben | Puls bei Liefer-Banks |
| IV Schwelle | `olympian` Falt->Spreiz **getimt zur Iris** | keins (mid-motion am Cut gehalten) | starker Sheen beim Spreizen |
| V Tempel | `classic` Auftriebs-Settle -> Spreiz-Ruhe | Ambient kehrt zurueck | langsamer Settle-Puls |

**Determinismus-Leitplanke:** jeder Laufzeit-Kanal MUSS reine Funktion von `(scrollProgress,
clockTime)` sein — nie `+=` akkumuliert. `deform()` rechnet ohnehin jeden Frame aus `original` neu;
der Port muss das spiegeln. Akkumulierte Deltas verstaerken Sub-Pixel-Scroll-Rauschen zum exakten
"zittert"-Symptom -> diese Disziplin ist AUCH Teil des Jitter-Fixes.

---

## 5. Motion & Feel: das Zittern toeten

### Primaerfix — auf EINE Glaettungsstufe kollabieren (entscheidend)
**Empfehlung: Lenis ist die einzige Glaettungsstufe.** Den scene-seitigen zweiten Filter
`st.p = damp(st.p, targetP, 0.08, dt)` entfernen und `poseAt()` direkt aus `lenis.progress` treiben.
Grund: Lenis ist fuer Scroll-Feel gebaut (sein `duration`/`easing` IST der gewuenschte Feel) und
normalisiert Touch/Wheel bereits; den redundanten Downstream-Damp loeschen ist der kleinste,
sauberste Fix. Signale, die Lenis NICHT abdeckt (Maus-Parallaxe, Bloom-Puls, Idle) behalten ihren
EIGENEN einzelnen Damp — das ist anderer Input, keine Doppel-Glaettung.

### Sekundaerfixes — Frame-Zeit-Rauschen stoppen
1. **`dt` glaetten** bevor es Motion treibt: `dtSmoothed += (dt - dtSmoothed) * 0.2`.
2. **`antialias: false`** am Renderer — MSAA + Multi-Pass-Bloom ist die teure Kombi; die Bloom/
   OutputPass-Kette antialiased perzeptiv schon. Billigster Frame-Pacing-Gewinn.
3. **`MAX_DPR` 2 -> 1.5** (oder 2 nur oberhalb einer Breite, wie `MOBILE_BLOOM_BREAKPOINT_PX`).
4. **C1-stetige Beat-Interpolation:** per-Segment-smoothstep in `poseAt()` durch einen monotonen
   Spline ueber das ganze `BEATS`-Array ersetzen (`THREE.CatmullRomCurve3` fuer die 3-Vektoren,
   kleines Hermite fuer Skalare) -> keine diskontinuierliche Geschwindigkeitsumkehr an den 6 Punkten.
5. **Bloom-Threshold `0.9 -> 0.94`** -> Codec-Rauschen flackert den Bloom-Blob nicht mehr.
6. **VideoTexture gaten:** `needsUpdate=true` nur bei `readyState >= HAVE_CURRENT_DATA` und nicht
   pausiert; auf Quell-Framerate (~30fps) raten; ggf. auf leichteren WebM-Loop wechseln.
7. **Parallaxe haerten:** Deadzone (normalisierte Deltas < ~0.005 ignorieren), langsamerer Damp
   (`0.03-0.04`), kleinere Multiplikatoren; `setMouse` waehrend aktivem Scroll ueberspringen.

### STABLE-SCROLL CHECKLIST (bei JEDEM kuenftigen Edit erzwingen)
1. Eine Glaettungsstufe fuer Scroll-Progress, nie zwei — `poseAt()` aus `lenis.progress`.
2. rAF-Reihenfolge fix & singulaer: `lenis.raf(now)` -> `progress` -> anwenden -> rendern, ein Tick.
3. Nicht-Lenis-Signale (Parallaxe, Bloom, Idle) duerfen je EINEN Damp behalten — sichtbar langsamer.
4. Maus-Parallaxe bekommt eine Deadzone vor dem Damp-Target.
5. Animierte DOM-Overlays via `transform: translate3d()`, ganzzahlig gerundet fuer Text; nie top/left.
6. VideoTexture-Updates gegatet, auf Quell-fps geratet.
7. DPR gedeckelt; alle Post-Process-Flaechen zusammen resized (Renderer+Composer+Kamera).
8. Ein `dt`/Frame, gecappt, ueberall durchgereicht.
9. DOM-Reveal bleibt auf `IntersectionObserver` — nie `getBoundingClientRect()` pro Frame.
10. Scroll-Umkehr und abrupten Stopp gezielt testen — die Inputs, die Doppel-Glaettung entlarven.

---

## 6. Visuelle Sprache & Referenzen

**Palette:** Nacht-Navy `#0f2d52` / dunkler `#08182f`, Weiss + kuehle Nacre-/Perl-Glanzlichter.
**KEIN Gold** (Owner-Lock). **Type:** Instrument Serif / "Norse" Display, Space Grotesk Body.
**Grade:** ACESFilmic + Bloom + Vignette (Composer-Kette behalten, pro Welt tunen). **Mood:** premium,
langsam, gelerpt, glossy, atmosphaerisch, mythisch — nie hektisch. **Welt-Looks sind Datensaetze**
(Belichtung + Vignette + Bloom + Fog-Farbe/Dichte + Key-Light-Farbe/Intensitaet), einmal authored ->
ein Kuenstler tunt "der Tempel ist waermer und enger" ohne Kamera-Code (hoechster ROI, geringstes Risiko).

| Referenz | URL | Was wir uebernehmen |
|---|---|---|
| Basement Studio (Nachfolger Studio Freight/DeSo) | https://basement.studio | 7 diskrete Kapitel, je eigener Kamera-Spline, Scroll-interpoliert, Lenis — staerkster Praezedenzfall fuer "distinkte Welten, keine Dolly" |
| Igloo Inc | https://igloo.inc | Kleine Custom-Hero-Geometrie (ihr Eisblock ~ unser Fluegel) traegt eine ganze Premium-Atmosphaere auf schmalem Asset-Budget |
| Lusion | https://lusion.co | "Step into a new world"-Reveal, glossy/transmissives Hero-Grading, der "premium, langsam, gelerpt"-Ton |
| Bruno Simon Portfolio | https://bruno-simon.com | Gegenmittel zu Beschwerde #1: Multi-Achs-Objektbewegung aus einem Behavior-/Physics-State, nicht einer linearen Scroll-Skalare |
| The Solar Journey (John Stejskal) | https://thesolarjourney.com | Der buchstaebliche himmlische Abstieg zu einem Ziel + diskreter Zoom-"World-Swap" in einer stetigen Szene — Cousin des Himmel->Tempel |
| Zajno — 7-Year Journey | https://zajno.com | Scroll-scrubbed 3D mit null sichtbarem Stepping — "voll Scroll-kontrolliertes Timing" als Anti-Jitter-Referenz |
| Lusion — Zero Tech | https://lusion.co/projects/zero_tech | Licht-pro-Kapitel-Materialstudie: wie der Nacre-Fluegel pro Welt anders Licht faengt, ohne neue Geometrie |

---

## 7. Tech-Plan & Leitplanken

- **Stack bleibt:** Astro (kein Framework) + three.js r0.170 **lokal via Vite gebuendelt** + Lenis 1.1.
  Kein GSAP-Dep in `apps/web` heute — der Preset-Port laeuft als reine Mathe/Tweens oder ein winziger
  lokaler Timeline-Helper; KEIN CDN-GSAP. (Falls GSAP gewuenscht: same-origin vendoren.)
- **CSP strikt (`script-src 'self'`, kein eval/wasm):** alles lokal. **Kein Draco/meshopt.** LUTs (falls)
  als lokale Cube-Texturen; Portal/Iris als lokaler Fragment-Shader (`smoothstep`-Kreis-Wipe).
- **prefers-reduced-motion:** EIN gemeinsamer Pfad — den *korrekten committeten Welt-Look* fuer die
  aktuelle Scroll-Position statisch rendern, KEINE Interpolation. Alle Naht-Techniken degradieren
  konsistent (Crossfade -> Zielframe; Portal -> "Tuer schon offen"; Deform -> Snap zur Pose).
- **WebGL-Fail-safe:** fehlt WebGL, faellt es auf den PNG-Billboard + eine nutzbare, scrollbare Seite
  zurueck. Pfad behalten und testen.
- **Mobil-Budget:** DPR <=1.5, `antialias:false`, Device-Tier-Gate nur fuer DOF + Full-Res-LUT
  (alles andere ueberall); Partikel auf Low-Tier halbieren; `RealmManager`-Dispose haelt GPU auf
  Ein-Welt-Kosten; Safari-URL-Bar-Resize-Storm beachten (`setSize(...,false)`, rAF-batch).
- **Workflow:** alles im `feature/scroll-fluegel`-**Worktree**. Lab -> Live via
  `docs/RUNBOOK-LAB-LIVE.md`: Aenderungen ueber `staging` + `hermes-web-staging` (Auto-Deploy,
  noindex, gespiegelte CSP); Live NUR ueber Merge auf `master` + manueller Deploy `hermes-web`.
  Runbook vor jeder Website-Arbeit lesen.

---

## 8. Phasen-Bauplan

Jede Phase eigenstaendig shippbar und reviewbar.

### Phase 1 — Zittern toeten + echten Lab-Fluegel rein (hoechster Impact, geringstes Risiko)
GLB raus. Lab-2D-Fluegel als Deform-Plane rein (Asset `hermes-wing.png` + `deform.ts`/`buildWeights`
portiert), reines 2D-Billboard (Variante A). Idle = echtes Lab-3-Sinus-Ambient + Lift +
Atem-Scale-Puls + Nacre-Sheen-Puls. Zittern: eine Glaettungsstufe (scene-Damp raus, aus
`lenis.progress`), `dt` glaetten, `antialias:false`, DPR->1.5, C1-Catmull-Rom-Beat-Spline, Bloom
0.94, VideoTexture gaten, Parallaxe-Deadzone.
**Fertig wenn:** kein sichtbares Zittern bei Scroll-Umkehr/abruptem Stopp (Desktop + ein echtes
Handy), UND der Fluegel ist sichtbar der schoene Lab-Fluegel mit echtem Mehrkanal-Idle-Leben.

### Phase 2 — Welt-Look-System (billiger "flach"-Fix, orthogonal zum Jitter)
Fuenf **Welt-Look-Datensaetze** (Belichtung + Vignette + Bloom + Fog-Farbe/Dichte + Key-Light),
aus dem einen Progress-Wert getrieben, per Welt ease-in-out (nicht eine globale lineare Rampe).
**Fertig wenn:** jede der fuenf Sektionen rendert eine committete, sichtbar distinkte Licht+Grade+
Fog-Identitaet, als Daten tunebar ohne Kamera-Code.

### Phase 3 — Scroll-getriebene Fluegel-Presets pro Welt (das "weiter verbessert")
`presets.ts`-Timelines portieren; classic/rapid/premium/olympian den Welten zuordnen; Schlag getimt
zu Wegpunkten/Naht. Optional: sanftes 2.5D-Tilt (Variante B). Optional: Blender-Kunst-Veredelung
(Normalmap/Retusche) — nur wenn Owner es will.
**Fertig wenn:** der Fluegel fuehrt einen lesbaren `olympian` Falt->Spreiz-Schlag aus, die vier
Presets treiben ihn pro Welt, Asset bleibt CSP-safe/klein.

### Phase 4 — Welt-Naehte + RealmManager (das "neue Welten entstehen")
Die vier benannten Naehte (Nebel-Reveal, Partikel-Uebergabe+Cross-Dissolve, EIN fluegelfoermiges
Portal/Iris mit Desktop-DOF-Pre-Beat, Cross-Dissolve zum Tempel) hinter einem `RealmManager` (eine
aktive + eine uebergehende Welt, Rest disposed). Hard-Naht-Trigger am Animations-Fortschritt des
Fluegels, nie am rohen Scroll-Pixel.
**Fertig wenn:** jede Naht nutzt ihre Technik, genau EIN Portal, Hoch/Runter-Scrollen instanziiert
ohne WebGL-Leaks neu, GPU nie ueber Ein-Welt-Draw-Kosten.

### Phase 5 — Reduced-motion, Mobil-Tiering, Fail-safe haerten
Ein gemeinsamer reduced-motion-Statik-Pfad; Device-Tier-Gates fuer DOF/LUT; Partikel-Halbierung;
WebGL-missing-Fallback; Resize-Storm-Guard; Perf-Verifikation auf echter Low-Tier-Hardware.
**Fertig wenn:** reduced-motion rendert einen korrekten Statik-Frame pro Sektion, ein No-WebGL-Browser
zeigt eine nutzbare scrollbare Seite, ein Mid-Tier-Handy haelt 60fps oder degradiert sauber ohne Zittern.

---

## 9. Pre-Mortem (ein Jahr spaeter, angenommen es ist gescheitert)

- **"Der 2D-Fluegel wirkt in der 3D-Welt aufgeklebt."** -> Risiko von Variante A. Gegenmittel: Welt-Fog/
  Grade/Bloom greifen auf die Plane (toneMapped, fog:true), Parallax-Tiefe, ggf. Normalmap (Blender)
  oder 2.5D-Tilt (Variante B). Frueh im Vordergrund-Tab visuell abnehmen.
- **"Wieder zu viel gebaut, Perf auf Mobil eingebrochen."** -> RealmManager-Dispose + Ein-Welt-Budget +
  Device-Tiering sind Pflicht, nicht Kür. Perf-Gate in jeder Phase.
- **"Aus Versehen live gegangen / CSP gebrochen."** -> Nur ueber Runbook; kein CDN, kein WASM; Tests
  gruen halten. Nichts deployt ohne bewussten Lab->Live-Schritt.
- **"Der Fluegel wurde beim Portieren wieder 'verschlimmbessert'."** -> `deform.ts`/`presets.ts`
  BYTE-nah uebernehmen; die Lab-Optik ist der Referenz-Wahrheitswert (Keypose-Screenshots vergleichen).

---

## 10. Entscheidungen (gelockt 2026-07-07)

Alle Konzept-Weichen sind mit dem Owner entschieden. Diese Werte sind bindend fuer den Bau.

1. **Fluegel-Tiefe:** sanftes **2.5D (Variante B)** — leichte 3D-Neigung, Neigung begrenzt (nie Kante).
2. **Blender-Rolle:** **Malerei veredeln** — Blender backt Relief-/Normalmap + hoeher aufgeloesten
   Render DESSELBEN Fluegels (kein Ersatzmodell). Traegt zusammen mit dem 2.5D-Tilt.
3. **Video-Backdrop:** **leichter, nahtloser WebM-Loop** statt des schweren Matte-Videos — gegatet,
   weniger Flicker, Budget frei fuer Fluegel + Welten. (Olymp-Look bleibt, nur leichter.)
4. **Portal-Platzierung:** die eine fluegelfoermige Schwelle sitzt bei **Use-cases -> Pricing**
   (Tempel-Reveal = Schwelle zum Abo; durch die Tuer treten = seiner KI Fluegel geben).
5. **Welt-Anzahl:** **fuenf Welten** (eine pro Sektion) — voller mythischer Bogen.
6. **Grading:** pro Welt **Belichtung + Vignette + Bloom lerpen** (leicht, mobil-sicher, kein LUTPass).
   LUT-Cube-Texturen spaeter optional, falls eine Welt mehr Charakter braucht.
7. **Reduced-motion:** **voll statischer, korrekter Welt-Frame** pro Sektion (barrierefrei + sicher),
   kein Dauer-Atmen unter reduced motion.

---

*Erstellt 2026-07-07 aus einem 7-Agenten-Research-Workflow + First-hand-Codepruefung. Fluegel-Mandat
(Abschnitt 1) ist Owner-Korrektur und ueberschreibt jede aeltere GLB-Annahme. Referenzen in
Abschnitt 6 werden per Chrome-Screenshot-Moodboard belegt.*
