import { createHash } from "node:crypto";

import { TTS_ABLAGE_DB_FRIST_MS, TTS_ABLAGE_TAKT_MS } from "../begriffe/speicher.js";
import { MS_PER_SECOND, sleep } from "../utils/timer.js";

const FRIST_SQL = `SELECT set_config('statement_timeout', $1, true), set_config('lock_timeout', $1, true)`;
const RESERVIEREN_SQL = `INSERT INTO tts_ablage (token_hash, expires_at) VALUES ($1, now() + make_interval(secs => $2))`;
const FUELLEN_SQL = `UPDATE tts_ablage SET content_type = $2, bytes = $3 WHERE token_hash = $1 AND expires_at > now()`;
const VERWERFEN_SQL = `DELETE FROM tts_ablage WHERE token_hash = $1`;
const ABGELAUFENE_LOESCHEN_SQL = `DELETE FROM tts_ablage WHERE expires_at <= now()`;
const ENTNEHMEN_SQL = `DELETE FROM tts_ablage WHERE token_hash = $1 AND expires_at > now() AND bytes IS NOT NULL
  RETURNING bytes, content_type AS "contentType"`;
const NOCH_GUELTIG_SQL = `SELECT 1 FROM tts_ablage WHERE token_hash = $1 AND expires_at > now()`;

const hashVon = (token) => createHash("sha256").update(token).digest("hex");

export function makePostgresTtsAblage(runner, { ttlMs }) {
  const inTransaktion = (arbeit) =>
    runner.withClient(async (client) => {
      await client.query("BEGIN");
      try {
        await client.query(FRIST_SQL, [String(TTS_ABLAGE_DB_FRIST_MS)]);
        const ergebnis = await arbeit(client);
        await client.query("COMMIT");
        return ergebnis;
      } catch (fehler) {
        await client.query("ROLLBACK").catch(() => {});
        throw fehler;
      }
    });

  async function fuellen(token, { bytes, contentType }) {
    const { rowCount } = await inTransaktion((client) =>
      client.query(FUELLEN_SQL, [hashVon(token), contentType, bytes]),
    );
    return rowCount === 1;
  }

  async function verwerfen(token) {
    try {
      await inTransaktion((client) => client.query(VERWERFEN_SQL, [hashVon(token)]));
    } catch (fehler) {
      console.error("[tts-ablage] Zeile nicht verworfen, bleibt bis zum Ablauf:", fehler.message);
    }
  }

  async function fuellenOderVerwerfen(token, contentType, synthese) {
    try {
      const { bytes, fehler } = await synthese;
      if (fehler) throw fehler;
      return await fuellen(token, { bytes, contentType });
    } catch (fehler) {
      console.error("[tts-ablage] Satz nicht abgelegt:", fehler.message);
      await verwerfen(token);
      return false;
    }
  }

  async function ablegen(token, audio) {
    const synthese = Promise.resolve(audio.bytes).then(
      (bytes) => ({ bytes }),
      (fehler) => ({ fehler }),
    );
    await inTransaktion((client) => client.query(RESERVIEREN_SQL, [hashVon(token), ttlMs / MS_PER_SECOND]));
    return { fertig: fuellenOderVerwerfen(token, audio.contentType, synthese) };
  }

  async function entnehmenOderPruefen(token) {
    return inTransaktion(async (client) => {
      await client.query(ABGELAUFENE_LOESCHEN_SQL);
      const { rows } = await client.query(ENTNEHMEN_SQL, [hashVon(token)]);
      if (rows.length === 1) return { audio: rows[0] };
      const gueltig = await client.query(NOCH_GUELTIG_SQL, [hashVon(token)]);
      return { wartet: gueltig.rows.length === 1 };
    });
  }

  async function holen(token) {
    try {
      for (;;) {
        const { audio, wartet } = await entnehmenOderPruefen(token);
        if (audio) return audio;
        if (!wartet) return null;
        await sleep(TTS_ABLAGE_TAKT_MS);
      }
    } catch (fehler) {
      console.error("[tts-ablage] Abruf nicht moeglich, wird abgelehnt:", fehler.message);
      return null;
    }
  }

  return { ablegen, holen };
}
