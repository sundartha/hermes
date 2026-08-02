// AUTH-P4: Beweis der ABWESENHEIT der sechs geloeschten Routen (POST /api/settings,
// POST /api/action-items/:id/toggle, POST /api/calendar, GET/POST /api/profiles,
// DELETE /api/profiles/:tenantId). Testpraefix bewusst "AUTH-P4-N" (NICHT DID|E2E|FMT|
// GAP|LANG|LAW|MCP|ORIG|OUT|PAY|PROMPT|UI|VOICE|WEB|WORLD-<Ziffer>): sonst landet die
// Datei still im test:gates-Lauf, wo Rot erlaubt ist und nichts meldet (Lehre
// catalog-id-prefix-misroutes-tests).
//
// Status allein reicht NICHT: zwei der sechs Handler antworteten AUCH gemountet mit
// 404 (POST /api/action-items/:id/toggle bei unbekannter id, DELETE /api/profiles/:id
// bei unbekannter tenantId). Ein Test, der nur status===404 prueft, waere fuer diese
// zwei auch mit noch gemounteter Route gruen - er wuerde die Zusage der Phase nicht
// messen. Der Diskriminator ist der Antwort-KOERPER: alle sechs geloeschten Handler
// antworteten ausnahmslos mit res.json(...); Express' eingebauter 404-Zweig antwortet
// text/html (Cannot POST /api/settings). Zusaetzlich zielen die beiden mehrdeutigen
// Routen (AUTH-P4-2, AUTH-P4-6) auf einen EXISTIERENDEN Datensatz, nicht auf einen
// fehlenden, sodass die gemountete Route 200 haette liefern muessen.
import { test } from "node:test";
import assert from "node:assert/strict";
import { startServer, seedState } from "./helpers.js";
import { BOOTSTRAP_TENANT_ID } from "../src/store/defaults.js";

const postJson = (url, body) =>
  fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

// Beweist, dass KEIN Handler geantwortet hat. Status allein reicht nicht: zwei der
// geloeschten Routen lieferten 404 auch dann, wenn sie gemountet waren - aber IMMER als
// JSON (res.json). Der eingebaute Express-404 antwortet text/html.
function assertRouteEntfernt(res) {
  assert.equal(res.status, 404, "Route muss weg sein");
  assert.ok(
    !(res.headers.get("content-type") || "").includes("application/json"),
    "404 mit JSON-Koerper = die Route ist noch gemountet und hat selbst geantwortet",
  );
}

test("AUTH-P4-1: POST /api/settings ist entfernt - 404 ohne Handler-Antwort, kein Schreibzugriff", async () => {
  const srv = await startServer();
  try {
    const res = await postJson(`${srv.localUrl}/api/settings`, { agentName: "Gekapert" });
    assertRouteEntfernt(res);
    assert.equal(
      srv.readStore().settings[BOOTSTRAP_TENANT_ID].agentName,
      "Hermes",
      "kein Schreibzugriff - der Owner-Bucket bleibt beim Default",
    );
  } finally {
    await srv.stop();
  }
});

test("AUTH-P4-2: POST /api/action-items/:id/toggle ist entfernt - vorhandenes Item bleibt ungetoggelt", async () => {
  const srv = await startServer({
    seed: seedState({
      actionItems: [
        {
          id: "ai_p4",
          callId: "call_p4",
          text: "AUTH-P4-Probe",
          type: "todo",
          done: false,
          createdAt: new Date().toISOString(),
        },
      ],
    }),
  });
  try {
    // Gemountet haette diese Anfrage 200 + done:true geliefert (die id existiert) -
    // deshalb die BEKANNTE id, nicht eine erfundene.
    const res = await postJson(`${srv.localUrl}/api/action-items/ai_p4/toggle`, {});
    assertRouteEntfernt(res);
    const item = srv.readStore().actionItems.find((a) => a.id === "ai_p4");
    assert.equal(item.done, false, "kein Toggle - das Item bleibt unangetastet");
  } finally {
    await srv.stop();
  }
});

test("AUTH-P4-3: POST /api/calendar ist entfernt - kein Termin landet im Store", async () => {
  const srv = await startServer();
  try {
    // Owner-Pfad (kein Header) haette 200 + neuer Eintrag geliefert, wenn die Route noch
    // gemountet waere.
    const res = await postJson(`${srv.localUrl}/api/calendar`, {
      title: "AUTH-P4-Probe",
      start: "2026-07-01T10:00:00Z",
      end: "2026-07-01T11:00:00Z",
    });
    assertRouteEntfernt(res);
    const events = srv.readStore().calendar[BOOTSTRAP_TENANT_ID] ?? [];
    assert.equal(
      events.some((e) => e.title === "AUTH-P4-Probe"),
      false,
      "kein Termin entstanden",
    );
  } finally {
    await srv.stop();
  }
});

test("AUTH-P4-4: GET /api/profiles ist entfernt", async () => {
  const srv = await startServer();
  try {
    // Gemountet haette diese Anfrage 200 + JSON-Objekt geliefert.
    const res = await fetch(`${srv.localUrl}/api/profiles`);
    assertRouteEntfernt(res);
  } finally {
    await srv.stop();
  }
});

test("AUTH-P4-5: POST /api/profiles kann kein unrestricted-Profil mehr anlegen (der geschlossene Vektor)", async () => {
  const srv = await startServer();
  try {
    // Der sicherheitstragende Test der Phase: gemountet haette genau dieser Aufruf ueber
    // profile.unrestricted (src/telephony/outbound-gates.js) das Verifikations-Gate
    // ausgehebelt.
    const res = await postJson(`${srv.localUrl}/api/profiles`, {
      tenantId: "t_p4_angreifer",
      unrestricted: true,
    });
    assertRouteEntfernt(res);
    assert.equal(
      "t_p4_angreifer" in srv.readStore().profiles,
      false,
      "kein Profil angelegt - der Vektor ist geschlossen",
    );
  } finally {
    await srv.stop();
  }
});

test("AUTH-P4-6: DELETE /api/profiles/:tenantId ist entfernt - vorhandenes Profil bleibt bestehen", async () => {
  const srv = await startServer({
    seed: seedState({ profiles: { t_p4_bestand: { unrestricted: false } } }),
  });
  try {
    // Gemountet haette diese Anfrage 200 + {ok:true} geliefert (die tenantId existiert).
    const res = await fetch(`${srv.localUrl}/api/profiles/t_p4_bestand`, { method: "DELETE" });
    assertRouteEntfernt(res);
    assert.equal(
      "t_p4_bestand" in srv.readStore().profiles,
      true,
      "das vorhandene Profil bleibt bestehen",
    );
  } finally {
    await srv.stop();
  }
});

// AUTH-P6: /api/onboard ist seither eine Betreiber-Route (webAuthMw+adminMw, nur MIT
// operatorAuth gemountet) - ein Spawn-Server (json/kein SESSION_SECRET) mountet sie
// darum nicht mehr, der frueher hier gefuehrte 400-Body-Beweis waere ein 404. Der
// eigentliche Boot-Beweis (spawnt der Prozess ueberhaupt, ohne SyntaxError beim Laden
// von api-onboard.js/_validation.js?) bleibt als Spawn-Test - ein fehlender Export in
// _validation.js zerreisst den Import von app.js zur Ladezeit, node --check faengt das
// NICHT. Die beiden 400-Body-Assertionen (tenantId/idpSubject, IDENTITY_MAX_LEN=254 im
// interpolierten Text) sind nach test/onboarding-identity.test.js gewandert
// (In-Process-Mount, dieselbe validIdentity-Kette bleibt dort erreichbar) - NICHT
// geloescht, nur die Naht gewechselt.
test("AUTH-P4-7: der Server bootet nach dem Umzug von validIdentity (kein SyntaxError beim Laden von api-onboard.js)", async () => {
  const srv = await startServer();
  try {
    const health = await fetch(`${srv.localUrl}/healthz`);
    assert.equal(health.status, 200);
  } finally {
    await srv.stop();
  }
});
