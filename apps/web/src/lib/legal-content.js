import { indexLegalContent } from "./legal.js";

const modules = import.meta.glob("../data/legal/*.json", { eager: true, import: "default" });

export const LEGAL_CONTENT = indexLegalContent(modules);
