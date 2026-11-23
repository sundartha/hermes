import {
  bumpPlatformTtsQuota,
  platformTtsUsageView,
  PLATFORM_TTS_COST_CENTER_ID,
} from "./zustand/nutzung.js";
import { recordTtsCharacters } from "./state-ops.js";
import { emptyPlatformTtsUsage, emptyUsage } from "./leerzustaende.js";

const FEHLER = "[pg] tts-zaehler fehlgeschlagen:";
const SPALTEN = "cycle_key, characters, warned_cycle, kostenstelle_zeichen";
const LESEN_SQL = `SELECT ${SPALTEN} FROM platform_tts_usage WHERE id = 1`;
const ANLEGEN_SQL = `INSERT INTO platform_tts_usage (id) VALUES (1) ON CONFLICT (id) DO NOTHING`;
const SPERREN_SQL = `${LESEN_SQL} FOR UPDATE`;
const SCHREIBEN_SQL = `UPDATE platform_tts_usage SET cycle_key = $1, characters = $2, warned_cycle = $3, kostenstelle_zeichen = $4 WHERE id = 1`;

function zeileZuAnsicht(zeile) {
  if (!zeile) return { platformTtsUsage: emptyPlatformTtsUsage(), usage: {} };
  const kostenstelle = { ...emptyUsage(), ttsCharacters: Number(zeile.kostenstelle_zeichen) };
  return {
    platformTtsUsage: { cycleKey: zeile.cycle_key, characters: Number(zeile.characters), warnedCycle: zeile.warned_cycle },
    usage: { [PLATFORM_TTS_COST_CENTER_ID]: kostenstelle },
  };
}

const ohneZyklus = (cfg, nowIso) => platformTtsUsageView(zeileZuAnsicht(null), cfg, nowIso).cycleKey === null;

async function imZaehler(client, arbeit) {
  await client.query("BEGIN");
  try {
    const ergebnis = await arbeit();
    await client.query("COMMIT");
    return ergebnis;
  } catch (fehler) {
    await client.query("ROLLBACK");
    throw fehler;
  }
}

export function macheTtsZaehlerSql({ einreihen, runner, protokoll = console }) {
  async function ausfuehren(arbeit) {
    try {
      return await arbeit();
    } catch (fehler) {
      protokoll.error(FEHLER, fehler.message);
      throw fehler;
    }
  }

  function buchen({ zeichen, cfg, nowIso, kostenstelle }) {
    if (ohneZyklus(cfg, nowIso)) return Promise.resolve(null);
    return ausfuehren(() =>
      einreihen((client) =>
        imZaehler(client, async () => {
          await client.query(ANLEGEN_SQL);
          const { rows } = await client.query(SPERREN_SQL);
          const ansicht = zeileZuAnsicht(rows[0]);
          const ergebnis = kostenstelle
            ? recordTtsCharacters(ansicht, zeichen, cfg, nowIso)
            : bumpPlatformTtsQuota(ansicht, { chars: zeichen, cfg, nowIso });
          const { platformTtsUsage: zaehler, usage } = ansicht;
          await client.query(SCHREIBEN_SQL, [
            zaehler.cycleKey,
            zaehler.characters,
            zaehler.warnedCycle,
            usage[PLATFORM_TTS_COST_CENTER_ID].ttsCharacters,
          ]);
          return ergebnis.warning;
        }),
      ),
    );
  }

  return {
    ansicht: (cfg, nowIso) =>
      ausfuehren(async () => {
        const { rows } = await runner.withClient((client) => client.query(LESEN_SQL));
        return platformTtsUsageView(zeileZuAnsicht(rows[0]), cfg, nowIso);
      }),
    buchenPlattform: (zeichen, cfg, nowIso) => buchen({ zeichen, cfg, nowIso, kostenstelle: true }),
    buchenRelay: (zeichen, cfg, nowIso) => buchen({ zeichen, cfg, nowIso, kostenstelle: false }),
  };
}
