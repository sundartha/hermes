import { ESLint } from "eslint";

const FEHLER = 2;
const ZEILENENDE = "\n";

async function zweckZeilen(fehler) {
  try {
    const { lintZweckZeilen } = await import("./lint-zweck.mjs");
    return lintZweckZeilen(fehler);
  } catch (error) {
    return [`Die Zweck-Texte der Regeln ließen sich nicht laden: ${error.message}`];
  }
}

export default async function format(results, context) {
  const stylish = await new ESLint().loadFormatter("stylish");
  const text = await stylish.format(results, context);
  const fehler = results.flatMap(({ messages }) => messages).filter(({ severity }) => severity === FEHLER);
  if (fehler.length === 0) return text;
  const zeilen = await zweckZeilen(fehler);
  return zeilen.length === 0 ? text : `${text}${zeilen.join(ZEILENENDE)}${ZEILENENDE}`;
}
