// Die EINZIGE Stelle, die das Content-Verzeichnis kennt (Vite-Glob, Build-Zeit).
// Aus reinem Node NICHT importierbar - die pruefbare Logik liegt in legal.js und
// wird hier nur mit Daten versorgt. Fehlt eine Pflichtdatei oder ist ein Dokument
// unvollstaendig, bricht schon dieser Import den Build ab (fail-closed).
import { indexLegalContent } from "./legal.js";

const modules = import.meta.glob("../data/legal/*.json", { eager: true, import: "default" });

export const LEGAL_CONTENT = indexLegalContent(modules);
