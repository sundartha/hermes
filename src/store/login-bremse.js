import { createHmac, hkdfSync } from "node:crypto";

const HKDF_INFO_LOGIN_BREMSE = Buffer.from("hermes-login-bremse-v1", "utf8");
const HKDF_KEY_LENGTH = 32;

const MAX_GLEICHZEITIG = 4;
const MAX_WARTEND = 32;
const ZAEHL_FRIST_MS = 3000;

const ZAEHLEN_SQL = `
  INSERT INTO login_bremse AS b (schluessel, anzahl, beginn_ms)
  VALUES ($1, 1, $2)
  ON CONFLICT (schluessel) DO UPDATE SET
    anzahl = CASE WHEN b.beginn_ms + $3 <= $2 THEN 1 ELSE b.anzahl + 1 END,
    beginn_ms = CASE WHEN b.beginn_ms + $3 <= $2 THEN $2 ELSE b.beginn_ms END
  RETURNING anzahl, beginn_ms`;

const ABGELAUFENE_ENTFERNEN_SQL = `DELETE FROM login_bremse WHERE beginn_ms <= $1`;

function deriveLoginBremseKey(sessionSecret) {
  return Buffer.from(
    hkdfSync("sha256", sessionSecret, Buffer.alloc(0), HKDF_INFO_LOGIN_BREMSE, HKDF_KEY_LENGTH),
  );
}

export function makeLoginBremse(runner, sessionSecret) {
  const key = deriveLoginBremseKey(sessionSecret);
  const schluesselFuer = (ip) => createHmac("sha256", key).update(String(ip)).digest("hex");

  const zaehleInDatenbank = async ({ ip, nowMs, windowMs }) => {
    const { rows } = await runner.withClient(async (client) => {
      await client.query(ABGELAUFENE_ENTFERNEN_SQL, [nowMs - windowMs]);
      return client.query(ZAEHLEN_SQL, [schluesselFuer(ip), nowMs, windowMs]);
    });
    return { anzahl: Number(rows[0].anzahl), beginnMs: Number(rows[0].beginn_ms) };
  };

  const warteschlange = new Set();
  let laufend = 0;

  const naechste = () => {
    const [eintrag] = warteschlange;
    if (!eintrag) return;
    warteschlange.delete(eintrag);
    starte(eintrag);
  };

  const starte = ({ anfrage, resolve, reject }) => {
    laufend += 1;
    zaehleInDatenbank(anfrage)
      .then(resolve, reject)
      .finally(() => {
        laufend -= 1;
        naechste();
      });
  };

  return {
    zaehlen(anfrage) {
      return new Promise((resolve, reject) => {
        if (warteschlange.size >= MAX_WARTEND) {
          return reject(new Error("login-bremse: Warteschlange voll"));
        }
        const eintrag = { anfrage, resolve, reject };
        const frist = setTimeout(() => {
          warteschlange.delete(eintrag);
          reject(new Error("login-bremse: Zaehlen ueberschreitet die Frist"));
        }, ZAEHL_FRIST_MS);
        const aufraeumen = () => clearTimeout(frist);
        eintrag.resolve = (wert) => (aufraeumen(), resolve(wert));
        eintrag.reject = (fehler) => (aufraeumen(), reject(fehler));
        if (laufend < MAX_GLEICHZEITIG) starte(eintrag);
        else warteschlange.add(eintrag);
      });
    },
  };
}
