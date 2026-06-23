// ---- makeProfileRoutes (AC7) ----------------------------------------------------
// Extrahierte /api/profiles-Route-Gruppe (Rechteprofile verwalten, Phase 2) als
// Factory mit Dependency-Injection - gleiches Muster wie makeWebAuthRoutes/
// makeAdminRoutes/makeSelfServiceRoutes (web-auth.js ist die bewaehrte Vorlage).
// Template fuer die laufende server.js-Decomposition (P4/OT-5): EINE kohaerente
// Route-Gruppe, behavior-preserving (reine Verschiebung, keine Logik-Aenderung).
//
// Hinter Basic-Auth (server.js deckt /api/* ab). OAuth-MCP-Nutzer erreichen nur
// /mcp, nie /api/* -> kein Self-Service. Es gibt bewusst KEIN MCP-Tool dafuer.
// Der Profil-Schluessel ist die serverseitige Identitaet: req.auth.email, wenn der
// IdP eine email im Token liefert, SONST req.auth.sub (z.B. WorkOS "user_01...").
// Deshalb KEINE strikte Email-Form erzwingen - nur ein sauberer, nicht-leerer
// String ohne Whitespace.
import { Router } from "express";

export const IDENTITY_MAX_LEN = 254; // RFC 5321 (Email-Obergrenze, reicht auch fuer sub)
export const validIdentity = (e) =>
  typeof e === "string" && e.length > 0 && e.length <= IDENTITY_MAX_LEN && !/\s/.test(e);

// deps: { store, audit }. store traegt listProfiles/setProfile/deleteProfile;
// audit ist die util.audit-Funktion (loggt nur Keys, keine Werte/PII).
export function makeProfileRoutes({ store, audit }) {
  const router = Router();

  router.get("/api/profiles", (_req, res) => res.json(store.listProfiles()));

  router.post("/api/profiles", (req, res) => {
    const { email, ...fields } = req.body || {};
    if (!validIdentity(email))
      return res
        .status(400)
        .json({ error: "email/identity (req.auth.email ODER IdP-sub) ist Pflicht" });
    const { profile, changed } = store.setProfile(email, fields);
    // Nur email + Keys loggen - Profil-Werte (z.B. Nummern) gehoeren nicht ins Log.
    audit("profile_update", req, `email=${email} keys=${changed.join(",") || "-"}`);
    res.json({ email, profile });
  });

  router.delete("/api/profiles/:email", (req, res) => {
    const { email } = req.params;
    if (!store.deleteProfile(email)) return res.status(404).json({ error: "not found" });
    audit("profile_delete", req, `email=${email}`);
    res.json({ ok: true });
  });

  return router;
}
