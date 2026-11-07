import { createCipheriv, createDecipheriv, createHmac, hkdfSync, randomBytes } from "node:crypto";

export const WEBHOOK_ZUSTELLUNG_SECRET_MIN_LENGTH = 32;
const GUELTIGKEIT_S = 300;
const HKDF_KEY_LENGTH = 32;
const HKDF_INFO_ANKER = Buffer.from("hermes-webhook-zustellung-anker-v1", "utf8");
const HKDF_INFO_KOERPER = Buffer.from("hermes-webhook-zustellung-koerper-v1", "utf8");
const CIPHER = "aes-256-gcm";
const IV_BYTES = 12;
const TAG_BYTES = 16;
const KENNUNG_BYTES = 16;

export function leiteSchluesselAb(secret) {
  if (typeof secret !== "string" || secret.length < WEBHOOK_ZUSTELLUNG_SECRET_MIN_LENGTH) return null;
  const ableiten = (info) => Buffer.from(hkdfSync("sha256", secret, "", info, HKDF_KEY_LENGTH));
  return { anker: ableiten(HKDF_INFO_ANKER), koerper: ableiten(HKDF_INFO_KOERPER) };
}

const zusatzdaten = ({ ankerHash, kennung, status, contentType, callSid }) =>
  Buffer.from(JSON.stringify([ankerHash, kennung, status, contentType ?? "", callSid]), "utf8");

function verschluesseln(schluessel, { bindung, inhalt }) {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(CIPHER, schluessel, iv, { authTagLength: TAG_BYTES });
  cipher.setAAD(zusatzdaten(bindung));
  const koerper = Buffer.concat([cipher.update(inhalt), cipher.final()]);
  return { iv, koerper, tag: cipher.getAuthTag() };
}

function entschluesseln(schluessel, { ankerHash, zeile, callSid }) {
  if (!zeile.koerper || !zeile.iv || !zeile.tag) return null;
  try {
    const decipher = createDecipheriv(CIPHER, schluessel, zeile.iv, { authTagLength: TAG_BYTES });
    const { kennung, status, content_type: contentType } = zeile;
    decipher.setAAD(zusatzdaten({ ankerHash, kennung, status, contentType, callSid }));
    decipher.setAuthTag(zeile.tag);
    return Buffer.concat([decipher.update(zeile.koerper), decipher.final()]);
  } catch {
    return null;
  }
}

async function inTransaktion(client, arbeit, abschluss = () => "COMMIT") {
  await client.query("BEGIN");
  try {
    const ergebnis = await arbeit();
    await client.query(abschluss(ergebnis));
    return ergebnis;
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  }
}

const ABGELAUFENE_LOESCHEN_SQL = `DELETE FROM webhook_zustellung
  WHERE anker = ANY($1::text[]) AND angenommen_um <= now() - make_interval(secs => $2)`;
const ANNEHMEN_SQL = `INSERT INTO webhook_zustellung (anker, kennung)
  SELECT anker, $2 FROM unnest($1::text[]) AS anker ON CONFLICT (anker) DO NOTHING RETURNING anker`;
const AELTESTE_ANNAHME_SQL = `SELECT anker, kennung, status, content_type, iv, koerper, tag
  FROM webhook_zustellung WHERE anker = ANY($1::text[]) ORDER BY angenommen_um, anker LIMIT 1`;
const LIES_SQL = `SELECT anker, kennung, status, content_type, iv, koerper, tag
  FROM webhook_zustellung WHERE kennung = $1 AND anker = ANY($2::text[]) ORDER BY anker`;
const BEANTWORTEN_SQL = `UPDATE webhook_zustellung
  SET status = $3, content_type = $4, iv = $5, koerper = $6, tag = $7
  WHERE anker = $1 AND kennung = $2`;

export function makeWebhookZustellung({ runner, schluessel }) {
  const ankerHash = (anker) => createHmac("sha256", schluessel.anker).update(anker).digest("hex");
  const hashesVon = (anker) => [...new Set(anker.map(ankerHash))].sort();

  function antwortAus(zeile, { hashes, callSid }) {
    if (!hashes.includes(zeile.anker)) return null;
    const inhalt = entschluesseln(schluessel.koerper, { ankerHash: zeile.anker, zeile, callSid });
    if (!inhalt) return null;
    return { status: zeile.status, contentType: zeile.content_type, body: inhalt };
  }

  async function annehmenIn(client, { hashes, callSid }) {
    const kennung = randomBytes(KENNUNG_BYTES).toString("hex");
    await client.query(ABGELAUFENE_LOESCHEN_SQL, [hashes, GUELTIGKEIT_S]);
    const { rowCount } = await client.query(ANNEHMEN_SQL, [hashes, kennung]);
    if (rowCount === hashes.length) return { eigen: true, kennung };
    const { rows } = await client.query(AELTESTE_ANNAHME_SQL, [hashes]);
    if (!rows.length) return { eigen: false, kennung: null, antwort: null };
    return { eigen: false, kennung: rows[0].kennung, antwort: antwortAus(rows[0], { hashes, callSid }) };
  }

  async function liesIn(client, { kennung, bindung }) {
    const hashes = hashesVon(bindung.anker);
    const { rows } = await client.query(LIES_SQL, [kennung, hashes]);
    const antworten = rows.map((zeile) => antwortAus(zeile, { hashes, callSid: bindung.callSid }));
    const antwort = antworten.find(Boolean) ?? null;
    return { antwort, offen: !antwort && rows.length > 0 && rows.every((zeile) => !zeile.koerper) };
  }

  return {
    lies(kennung, bindung) {
      return runner.withClient((client) => liesIn(client, { kennung, bindung }));
    },

    annehmen({ anker, callSid }) {
      const hashes = hashesVon(anker);
      const festschreiben = (ergebnis) => (ergebnis.eigen ? "COMMIT" : "ROLLBACK");
      return runner.withClient((client) =>
        inTransaktion(client, () => annehmenIn(client, { hashes, callSid }), festschreiben),
      );
    },

    beantworten(kennung, { anker, callSid }, antwort) {
      const inhalt = Buffer.from(antwort.body);
      return runner.withClient((client) =>
        inTransaktion(client, async () => {
          for (const hash of hashesVon(anker)) {
            const bindung = {
              ankerHash: hash,
              kennung,
              status: antwort.status,
              contentType: antwort.contentType,
              callSid,
            };
            const { iv, koerper, tag } = verschluesseln(schluessel.koerper, { bindung, inhalt });
            await client.query(BEANTWORTEN_SQL, [
              hash,
              kennung,
              antwort.status,
              antwort.contentType ?? null,
              iv,
              koerper,
              tag,
            ]);
          }
        }),
      );
    },
  };
}
