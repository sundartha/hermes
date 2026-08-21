// ---- makeInboxRoutes (PLAN-ANRUF-INBOX, INBOX-P2, E-4) ---------------------------
// Der Konsum-Endpunkt der Anruf-Inbox als EIGENE Factory mit Dependency-Injection -
// Muster makeCallRoutes/makeBillingRoutes.
//
// WARUM NICHT in makeReadRoutes: src/routes/api-read.js ist im Datei-Kopf ausdruecklich
// als Read-/Export-Gruppe beschrieben. Eine vierte, ZUSTANDSVERBRAUCHENDE Route darin
// bricht die Verantwortlichkeit der Factory und macht ihren Kopf-Kommentar falsch (P2).
//
// WARUM POST, nicht GET: der Aufruf AENDERT Zustand - er verbraucht die Inbox
// (inboxSeenAt wird gesetzt). Der Bestand hat keinen mutierenden GET
// (GET /api/calls/:id/consult ist rein lesend); dieser Praezedenzfall bleibt heil.
//
// WARUM NICHT auf /api/state markiert wird: list_calls, list_action_items,
// get_my_number und get_agent_status laufen alle ueber GET /api/state. Wuerde dort
// markiert, konsumierten vier unbeteiligte Werkzeuge die Inbox leer.
//
// AUTH: `internalOnly` (genuin lokaler In-Process-Aufrufer - echter Loopback-Socket OHNE
// X-Forwarded-For), dieselbe benannte Middleware wie die neun MCP-/Legacy-Routen; damit
// Klasse AUTH im Routen-Inventar, KEIN PUBLIC_ROUTES-Eintrag. Zusaetzlich `requireTenant`
// im Handler (nicht requestTenant), weil geschrieben wird: TENANT_REJECT -> 403, nie ein
// Pseudo-Bucket.
// ACHTUNG (R-8): der identitaetslose Loopback-Kanal faellt auf den Bootstrap-Tenant und
// VERBRAUCHT dessen Inbox. Lokale Smoke-Tests deshalb ausschliesslich gegen ein
// Temp-DATA_DIR mit STORE_BACKEND=json, NIE mit einer DATABASE_URL aus der eigenen Shell.
import { Router } from "express";
import { internalOnly } from "../wiring/internal-only.js";

// Deckel je Abruf (G25, benannte Konstante statt nackter Zahl im slice - Muster
// STATE_CALLS in api-read.js). BEWUSST kein Env-Knopf (E-6): das Feature loest keine
// Anrufe aus, ruft keinen Anbieter und beruehrt kein Safety-Gate.
export const INBOX_MAX_ENTRIES = 20;

// deps: { store, audit, tenant }. store traegt takeInboxEntries (die EINE Operation -
// der Handler ruft KEIN save(), sonst floesse jeder Poll doppelt). audit ist util.audit
// (nur Zaehler, nie Inhalte). tenant buendelt requireTenant (REJECT -> 403).
export function makeInboxRoutes({ store, audit, tenant }) {
  const { requireTenant } = tenant;
  const router = Router();

  router.post("/api/inbox/poll", internalOnly, (req, res) => {
    const tenantId = requireTenant(req, res); // schreibender Pfad; REJECT -> 403
    if (!tenantId) return;
    // Fail-closed: alles ausser strikt true ist false. Kein Validierungs-Helfer noetig -
    // es gibt genau einen erlaubten Wert, und der Default ist der sichere.
    const includeSeen = req.body?.include_seen === true;
    const { entries, remaining, marked } = store.takeInboxEntries(tenantId, {
      limit: INBOX_MAX_ENTRIES,
      includeSeen,
    });
    // NUR ZAEHLER. Keine Rufnummern, keine Anruf-Kennungen, keine Gespraechsinhalte -
    // die Zeile beschreibt den Vorgang, nicht seinen Inhalt (Regel 4, Abschnitt 4).
    audit("inbox_poll", req, `neu=${marked} rest=${remaining}`);
    res.json({ entries, remaining });
  });

  return router;
}
