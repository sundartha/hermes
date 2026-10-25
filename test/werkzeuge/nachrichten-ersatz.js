import { existsSync, readFileSync, readdirSync, realpathSync } from "node:fs";
import { join } from "node:path";

export const BIS_ZUM_ABBRUCH = "bis zum Abbruch";
export const MIT_DEM_ERGEBNIS = "mit dem Ergebnis";
export const NOTFRIST_MS = 60_000;

export const NACHRICHTEN_MODUS = `
import { appendFileSync as haengeAn, mkdirSync as legeAn, realpathSync as echterPfad } from "node:fs";
import { join as verbinde } from "node:path";
const pause = (ms) => new Promise((fertig) => setTimeout(fertig, ms));
const transkriptDatei = (konfiguration, sitzung) => {
  const transkripte = verbinde(konfiguration, "projects", echterPfad(process.cwd()).replace(/[^A-Za-z0-9]/g, "-"));
  legeAn(transkripte, { recursive: true });
  return verbinde(transkripte, sitzung + ".jsonl");
};
const schreibeNachrichten = async (groessen, { kennung, transkript, melde, text, mitDemErgebnis, warteAuf }) => {
  let nummer = 0;
  for (const groesse of groessen) {
    if (groesse === ${JSON.stringify(BIS_ZUM_ABBRUCH)}) await pause(${NOTFRIST_MS});
    else if (groesse === ${JSON.stringify(MIT_DEM_ERGEBNIS)}) mitDemErgebnis();
    else if (groesse?.nachDemEndeVon) await warteAuf(groesse.nachDemEndeVon);
    else {
      const id = kennung + "-" + nummer;
      const usage = { input_tokens: groesse };
      haengeAn(transkript(), JSON.stringify({ type: "assistant", message: { id, usage } }) + "\\n");
      melde({ type: "assistant", message: { id, content: [{ type: "thinking", thinking: "denkt" }], usage } });
      melde({ type: "assistant", message: { id, content: [{ type: "text", text }], usage } });
      nummer += 1;
    }
  }
};
`;

function transkriptZeilen(konfiguration, wurzel) {
  const verzeichnis = join(konfiguration, "projects", realpathSync(wurzel).replace(/[^A-Za-z0-9]/g, "-"));
  if (!existsSync(verzeichnis)) return [];
  return readdirSync(verzeichnis).flatMap((datei) => readFileSync(join(verzeichnis, datei), "utf8").trim().split("\n").map((zeile) => JSON.parse(zeile)));
}

export function nachrichtenImTranskript(konfiguration, wurzel, schluessel) {
  const jeAufruf = new Map();
  for (const { message } of transkriptZeilen(konfiguration, wurzel)) {
    const [aufruf, nummer] = message.id.startsWith(`${schluessel}-`) ? message.id.slice(schluessel.length + 1).split("-") : [];
    if (nummer !== undefined) jeAufruf.set(aufruf, (jeAufruf.get(aufruf) ?? 0) + 1);
  }
  return [...jeAufruf.values()];
}
