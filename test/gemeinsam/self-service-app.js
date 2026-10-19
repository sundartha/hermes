import {
  SESSION_COOKIE_NAME,
  webAuth,
  webAuthAllowPending,
  makeAccounts,
  makeSessions,
  signValue,
} from "../../src/web-auth.js";
import { makeSelfServiceRoutes } from "../../src/self-service-routes.js";
import { startRouterApp } from "../operator-route-app.js";

const SESSION_TTL_S = 3600;

export async function starteSelfServiceApp({
  store,
  runner,
  secret,
  sub,
  tenantId,
  email,
  aktiv = false,
  audit,
  config,
  billing,
  provision,
  auditStore,
}) {
  const accounts = makeAccounts(runner);
  const sessions = makeSessions(runner);
  await accounts.upsertOnFirstLogin({ sub, email });
  if (aktiv) await accounts.setStatus(tenantId, "active");
  const { id: sessionId } = await sessions.create({ sub, tenantId, ttlSeconds: SESSION_TTL_S });

  const { base, close } = await startRouterApp(
    makeSelfServiceRoutes({
      store,
      webAuthMw: webAuth({ secret, sessions, accounts }),
      webAuthPendingMw: webAuthAllowPending({ secret, sessions, accounts }),
      audit,
      config,
      billing,
      accounts,
      provision,
      auditStore,
    }),
  );
  return {
    base,
    accounts,
    cookie: `${SESSION_COOKIE_NAME}=${encodeURIComponent(signValue(sessionId, secret))}`,
    close,
  };
}
