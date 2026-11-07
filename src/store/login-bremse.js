import { createHmac, hkdfSync } from "node:crypto";

const HKDF_INFO_LOGIN_BREMSE = Buffer.from("hermes-login-bremse-v1", "utf8");
const HKDF_KEY_LENGTH = 32;

const ZAEHLEN_SQL = `
  INSERT INTO login_bremse AS b (schluessel, anzahl, beginn_ms)
  VALUES ($1, 1, $2)
  ON CONFLICT (schluessel) DO UPDATE SET
    anzahl = CASE WHEN b.beginn_ms + $3 <= $2 THEN 1 ELSE b.anzahl + 1 END,
    beginn_ms = CASE WHEN b.beginn_ms + $3 <= $2 THEN $2 ELSE b.beginn_ms END
  RETURNING anzahl, beginn_ms`;

function deriveLoginBremseKey(sessionSecret) {
  return Buffer.from(hkdfSync("sha256", sessionSecret, "", HKDF_INFO_LOGIN_BREMSE, HKDF_KEY_LENGTH));
}

export function makeLoginBremse(runner, sessionSecret) {
  const key = deriveLoginBremseKey(sessionSecret);
  const schluesselFuer = (ip) => createHmac("sha256", key).update(String(ip)).digest("hex");

  return {
    async zaehlen({ ip, nowMs, windowMs }) {
      const { rows } = await runner.withClient((client) =>
        client.query(ZAEHLEN_SQL, [schluesselFuer(ip), nowMs, windowMs]),
      );
      return { anzahl: Number(rows[0].anzahl), beginnMs: Number(rows[0].beginn_ms) };
    },
  };
}
