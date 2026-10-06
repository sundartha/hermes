const buildEnv = import.meta.env;
const GATEWAY_URL =
  (buildEnv && buildEnv.PUBLIC_GATEWAY_URL) || process.env.PUBLIC_GATEWAY_URL;
if (!GATEWAY_URL) {
  throw new Error(
    "PUBLIC_GATEWAY_URL fehlt — Build absichtlich abgebrochen (fail-closed). " +
      "Ein relativer Default wuerde den Login-404 sofort zuruckbringen.",
  );
}

export const LOGIN_URL = `${GATEWAY_URL}/auth/login`;

export const COOKIE_CONSENT_URL = `${GATEWAY_URL}/api/cookie-consent`;

export const CANCEL_URL = `${GATEWAY_URL}/app#kuendigen`;
