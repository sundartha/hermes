# PLAN-SECURITY.md — Sicherheits-Plan (Launch-Fixes)

Sammlung der sicherheitsrelevanten Einträge der Launch-Blocker-Kette (OUT-05/PROV-01/A6,
PLAN-LAUNCH-FIXES.md). Jede sicherheitsrelevante Phase ergänzt hier ihren Eintrag (Pflicht,
CLAUDE.md). Aeltere Phasen-Historie liegt in Git.

## OUT-05 — Budget-/Reserve-Race bei parallelen place_call (nach F2)

> OUT-05 (Reserve-Race): Worst-Case-Reserven pro place_call in einem strukturell ephemeren
> In-Prozess-Ledger (`s.reservations`, nie serialisiert/hydriert); Check+Reserve atomar unter
> `withStoreLock` (Schnittmenge Tenant+global), fail-closed try/catch (Body-Throw = Denial 402).
> Freigabe bei jedem Endzustand: Erfolg via `finishCall`, Fehler via `catch`, UND — unabhaengig vom
> Provider-Callback — via beim Originate armiertem Reserve-Release-Timer (beide Engines) bei
> `maxDur + RESERVE_RELEASE_GRACE_MS`. Restrisiken (akzeptiert, bounded): (a) Multi-Prozess nicht
> abgedeckt (OT-3, single-instance); (b) Freigabe braucht die Live-Call-Referenz -> cross-instance
> blind (OT-3); (c) Hung-Originate laesst eine Reserve bis Boot stehen (selten, boot-begrenzt);
> (d) Ist-Kosten koennen die Reserve um <= 1 Minutentakt (Rundung/Hangup-Latenz) uebersteigen,
> fail-forward. `FAKE_ORIGINATE` ist ein boot-gehaerteter Test-Seam (nur zulaessig wenn
> Signaturpruefung geskippt -> in Prod unmoeglich), keine abgeschaltete Sicherung.
