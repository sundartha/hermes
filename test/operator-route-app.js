// ---- Test-Helfer fuer die AUTH-P6-Migration (KEIN Produktionscode) ---------------
// Bestandstests, die makeBillingRoutes/makeOnboardRoutes in-process mounten, brauchen
// seit AUTH-P6 ein operatorAuth-Objekt, sonst mounten die sechs Betreiber-Routen gar
// nicht (fail-closed, s. src/wiring/operator-routes.js). Diese Bestandstests pruefen
// NICHT die Admin-Sitzung (das tun test/auth-p6-operator-routes.test.js und
// test/auth-p6-mount-gate.test.js mit den ECHTEN Middlewares) - sie brauchen nur, dass
// die Route ueberhaupt existiert. Eine Durchreiche-Attrappe genuegt (G5: EINE Quelle
// statt 15x derselben zwei Zeilen kopiert).
//
// BEWUSST ANDERS BENANNT als die Produktions-Middlewares (webAuthMw/adminMw): niemand
// soll das fuer echte Auth halten oder versehentlich in Produktionscode importieren.
export function operatorAuthPassThrough() {
  return {
    webAuthMw: (_req, _res, next) => next(),
    adminMw: (_req, _res, next) => next(),
  };
}

// EIN Express-Server ueber einem fertigen Router (Muster: mountProbe in
// test/auth-p5-internal-only.test.js). Fuer Tests, die nur einen Router (nicht die
// volle App) in-process pruefen.
export async function startRouterApp(router) {
  const express = (await import("express")).default;
  const app = express();
  app.use(express.json());
  app.use(router);
  const server = await new Promise((resolve) => {
    const s = app.listen(0, "127.0.0.1", () => resolve(s));
  });
  return {
    base: `http://127.0.0.1:${server.address().port}`,
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}
