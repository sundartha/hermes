import keinQuelltextAlsText from "./kein-quelltext-als-text.js";
import keineKommentare from "./keine-kommentare.js";
import namenOhneBegruendung from "./namen-ohne-begruendung.js";

export default {
  meta: { name: "hermes" },
  rules: {
    "keine-kommentare": keineKommentare,
    "kein-quelltext-als-text": keinQuelltextAlsText,
    "namen-ohne-begruendung": namenOhneBegruendung,
  },
};
