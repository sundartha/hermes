export const NACHRICHTEN_MODUS = `
import { appendFileSync as haengeAn, mkdirSync as legeAn, realpathSync as echterPfad } from "node:fs";
import { join as verbinde } from "node:path";
const transkriptDatei = (konfiguration, sitzung) => {
  const transkripte = verbinde(konfiguration, "projects", echterPfad(process.cwd()).replace(/[^A-Za-z0-9]/g, "-"));
  legeAn(transkripte, { recursive: true });
  return verbinde(transkripte, sitzung + ".jsonl");
};
const schreibeNachrichten = async (groessen, { kennung, transkript, melde, text }) => {
  for (const [nummer, groesse] of groessen.entries()) {
    const id = kennung + "-" + nummer;
    const usage = { input_tokens: groesse };
    haengeAn(transkript(), JSON.stringify({ type: "assistant", message: { id, usage } }) + "\\n");
    melde({ type: "assistant", message: { id, content: [{ type: "thinking", thinking: "denkt" }], usage } });
    melde({ type: "assistant", message: { id, content: [{ type: "text", text }], usage } });
  }
};
`;
