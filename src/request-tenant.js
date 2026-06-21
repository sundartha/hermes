// Reiner Request-Tenant-Resolver, aus server.js extrahiert (A4). Seiteneffektfrei:
// kein app.listen, kein DB-/Netz-Zugriff. Ein Import von server.js startet ueber
// app.listen() den HTTP-Server (deshalb laden alle Tests server.js per Spawn) - der
// Resolver bleibt damit nicht unit-testbar. Hier liegt er ohne Boot importierbar.
// config + OWNER_TENANT_ID werden direkt importiert (beide seiteneffektfrei); der
// store wird per Factory injiziert (Repo-Muster makeSelfServiceRoutes/makeAccounts)
// - das haelt das Modul DB-frei und vermeidet einen Zirkel-Import mit server.js.
import { config } from "./config.js";
import { OWNER_TENANT_ID } from "./store/defaults.js";

// Localhost anhand der echten Socket-Adresse erkennen - req.ip ist hinter trust proxy
// aus X-Forwarded-For abgeleitet und damit von Clients faelschbar.
export const isLocalSocket = (req) => ["127.0.0.1", "::1", "::ffff:127.0.0.1"].includes(req.socket.remoteAddress);

// Identitaet eines internen Aufrufers (Rechteprofile, Phase 2). Die MCP-Tools
// laufen im selben Prozess und rufen die localhost-REST-API mit dem verifizierten
// X-Internal-Identity-Header (aus req.auth.email im /mcp-Handler). Der Header wird
// NUR von localhost-Sockets akzeptiert - von extern ist er faelschbar und wird
// ignoriert (-> Owner). Body-Felder (requestedBy/email) NIE als Identitaet nutzen.
export function internalIdentity(req) {
  if (!isLocalSocket(req)) return null;
  const id = req.headers["x-internal-identity"];
  return typeof id === "string" && id ? id : null;
}

// requestedBy-Marker fuer den Owner (localhost/stdio ohne Identitaet).
export const OWNER_ID = "owner";
// Sentinel fuer ein verifiziertes Token OHNE email UND sub: bewusst NICHT Owner
// (fail-closed), sondern restriktiv (resolveProfile -> DEFAULT_PROFILE).
export const ANON_IDENTITY = "anon";

// Tenant-Achse (I4), getrennt von der Profile-Achse. Marker fuer eine VORHANDENE,
// aber unbekannte/unaufloesbare Identitaet: kein Tenant -> REJECT (NIE Owner).
// In I4 filtert noch KEIN Endpunkt; I5/I6/I7 machen daraus 404/403.
export const TENANT_REJECT = "reject";

// Factory: bindet die zwei Resolver an den konkreten store (Repo-Muster, vermeidet
// einen Zirkel-Import server.js<->request-tenant.js und haelt das Modul DB-frei).
export function makeRequestTenant(store) {
  // Request-Tenant aus der Auth-Identitaet aufloesen (Geschwister zu internalIdentity).
  // Aufloesungs-Reihenfolge (load-bearing):
  //   (1) Flag aus -> Owner byte-identisch (kein Aufloesungs-Pfad; muss ZUERST stehen,
  //       sonst kaeme bei Flag aus ein Session-Tenant statt Owner -> R5).
  //   (2) req.tenant (Web-Session, A4): VOR der req.auth-Logik. req.tenant wird im
  //       ganzen src/ NUR von webAuthMiddleware gesetzt (web-auth.js) - erst nach
  //       signiertem Cookie + gueltiger, nicht-invalidierter DB-Session + aktivem
  //       Account. Das ist die STAERKERE, jederzeit invalidierbare Identitaet und hat
  //       darum Vorrang vor req.auth (nur ein gueltiges JWT, dessen sub erst per
  //       resolveTenant nachgeschlagen wuerde). req.tenant.tenantId wird DIREKT
  //       zurueckgegeben - kein zweiter resolveTenant-Lookup, sonst koennte ein
  //       zweiter Resolver bei einem Tenant ohne idpSubject von der DB-Session
  //       divergieren (R7). fail-closed: leere/fehlende tenantId -> TENANT_REJECT,
  //       NIE Owner. Bewusst `||`, NICHT `??` - `??` liesse `""` durch (R2).
  //   (3) req.auth.sub (MCP-Achse) bzw. localhost-internalIdentity - byte-identisch
  //       zum Bestand. FEHLENDE Identitaet (kein req.auth UND kein localhost-internal,
  //       also localhost/stdio) bleibt Owner. VORHANDENE, aber unbekannte/leere
  //       Identitaet -> TENANT_REJECT (resolveTenant liefert null).
  // Hinweis (I5-Vorbereitung): der REST-X-Internal-Identity-Kanal traegt heute
  // email-first (mcp-tools), die Tenant-Achse keyt aber auf sub. I4 nutzt sub nur
  // auf dem /mcp-Pfad (req.auth direkt); die REST-seitige sub-Durchreichung folgt
  // in I5, wenn ein Lesepfad sie tatsaechlich filtert.
  function requestTenant(req) {
    if (!config.multiTenant) return OWNER_TENANT_ID;
    if (req.tenant) return req.tenant.tenantId || TENANT_REJECT; // Web-Session, fail-closed
    const sub = req.auth ? req.auth.sub : null;
    const internal = req.auth ? null : internalIdentity(req);
    if (!sub && !internal) return OWNER_TENANT_ID; // fehlende Identitaet (localhost/stdio) -> Owner
    const tenantId = store.resolveTenant(sub || internal);
    return tenantId || TENANT_REJECT; // vorhanden-aber-unbekannt -> Reject, NIE Owner
  }

  // I6: Request-Tenant fuer Schreib-/Steuer-Pfade aufloesen UND fail-closed gaten.
  // Eine VORHANDENE, aber unbekannte Identitaet (TENANT_REJECT) wird hart mit 403
  // abgewiesen, statt in einen Pseudo-Tenant-Bucket zu schreiben (Owner-Entscheidung).
  // Liefert den Tenant ODER null (dann ist 403 bereits gesendet -> Handler returnt).
  // Flag AUS / fehlende Identitaet -> requestTenant === OWNER_TENANT_ID, nie REJECT ->
  // Guard inert -> Owner-Pfad byte-identisch. Eigenstaendig von I5's call-404-Helper
  // (requireTenantOwnsCall vergleicht call.tenantId); dieser wrappt nur requestTenant.
  function requireTenant(req, res) {
    const tenant = requestTenant(req);
    if (tenant === TENANT_REJECT) {
      res.status(403).json({ error: "Keine Tenant-Zuordnung fuer diese Identitaet." });
      return null;
    }
    return tenant;
  }

  return { requestTenant, requireTenant };
}
