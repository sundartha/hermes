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
export const ZUGRIFF_FRIST_MS = 1000;
const FRIST_SQLSTATES = new Set(["57014", "55P03"]);

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

const ZEITGRENZE_SQL = `SELECT set_config('statement_timeout', $1, true), set_config('lock_timeout', $1, true)`;

const fristFehler = () => Object.assign(new Error("webhook_zustellung: Zugriffsfrist abgelaufen"), { frist: true });

async function inTransaktion(client, { frist, arbeit, abschluss = () => "COMMIT" }) {
  const anweisung = { query: (text, params) => (frist.abgelaufen ? Promise.reject(fristFehler()) : client.query(text, params)) };
  await anweisung.query("BEGIN");
  try {
    await anweisung.query(ZEITGRENZE_SQL, [String(ZUGRIFF_FRIST_MS)]);
    const ergebnis = await arbeit(anweisung);
    await anweisung.query(abschluss(ergebnis));
    return ergebnis;
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  }
}

async function mitZeitgrenze(runner, transaktion) {
  const frist = { abgelaufen: false };
  const ablauf = Promise.withResolvers();
  const zeitgeber = setTimeout(() => {
    frist.abgelaufen = true;
    ablauf.reject(fristFehler());
  }, ZUGRIFF_FRIST_MS);
  try {
    const zugriff = runner.withClient((client) => inTransaktion(client, { frist, ...transaktion }));
    return await Promise.race([zugriff, ablauf.promise]);
  } catch (err) {
    if (FRIST_SQLSTATES.has(err?.code)) err.frist = true;
    throw err;
  } finally {
    clearTimeout(zeitgeber);
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
const FREIGEBEN_SQL = `DELETE FROM webhook_zustellung
  WHERE kennung = $1 AND anker = ANY($2::text[]) AND koerper IS NULL`;
const ALLE_ABGELAUFENEN_LOESCHEN_SQL = `DELETE FROM webhook_zustellung
  WHERE angenommen_um <= now() - make_interval(secs => $1)`;
const FEHLERCODE_UNBEKANNT = "unbekannt";
const FEHLERCODE_FRIST = "frist";

const loeschFehlercode = (err) => err?.code ?? (err?.frist ? FEHLERCODE_FRIST : FEHLERCODE_UNBEKANNT);

export function loescheAbgelaufene(runner) {
  return mitZeitgrenze(runner, { arbeit: (client) => client.query(ALLE_ABGELAUFENEN_LOESCHEN_SQL, [GUELTIGKEIT_S]) });
}

export function planeLoeschtakt({ runner, taktMs, mitAblage }) {
  const loeschen = () =>
    void loescheAbgelaufene(runner).catch((err) =>
      console.error(
        `[webhook-zustellung] loeschen_fehlgeschlagen code=${loeschFehlercode(err)}`,
      ),
    );
  console.log(
    `[webhook-zustellung] loeschtakt_ms=${taktMs} ablage=${mitAblage ? "datenbank" : "speicher"}`,
  );
  loeschen();
  setInterval(loeschen, taktMs).unref();
}

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

  async function beantwortenIn(client, { kennung, bindung: { anker, callSid }, antwort }) {
    const inhalt = Buffer.from(antwort.body);
    for (const hash of hashesVon(anker)) {
      const zusatz = { ankerHash: hash, kennung, status: antwort.status, contentType: antwort.contentType, callSid };
      const { iv, koerper, tag } = verschluesseln(schluessel.koerper, { bindung: zusatz, inhalt });
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
  }

  return {
    freigeben(kennung, bindung) {
      const arbeit = (client) => client.query(FREIGEBEN_SQL, [kennung, hashesVon(bindung.anker)]);
      return mitZeitgrenze(runner, { arbeit });
    },

    lies(kennung, bindung) {
      return mitZeitgrenze(runner, { arbeit: (client) => liesIn(client, { kennung, bindung }) });
    },

    annehmen({ anker, callSid }) {
      const hashes = hashesVon(anker);
      const abschluss = (ergebnis) => (ergebnis.eigen ? "COMMIT" : "ROLLBACK");
      return mitZeitgrenze(runner, { arbeit: (client) => annehmenIn(client, { hashes, callSid }), abschluss });
    },

    beantworten(kennung, bindung, antwort) {
      return mitZeitgrenze(runner, { arbeit: (client) => beantwortenIn(client, { kennung, bindung, antwort }) });
    },
  };
}
