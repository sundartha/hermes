// Aussprache des Auftraggeber-Namens: WORAN sie haengt, festgehalten an der
// ElevenLabs-Agenten-Vorlage im Repo (elevenlabs/agent_configs/outbound-agent.template.json).
//
// DER BEFUND (Eigentuemer, Gruppe B, 15.08.2026): "die Stimme hat meinen Namen komisch
// ausgesprochen". Ein Agent, der den Namen seines eigenen Auftraggebers falsch ausspricht,
// ist in der ersten Sekunde unglaubwuerdig.
//
// WAS BELEGT IST (15.08.2026, ausschliesslich LESENDE Aufrufe am eigenen Konto plus
// Anbieter-Doku; der Live-Agent wurde nicht veraendert):
//   - Aussprache-Woerterbuecher sind eine eigene Konto-Ressource (.pls), angelegt ueber
//     POST /v1/pronunciation-dictionaries/add-from-rules (Regel-Arten "alias" und
//     "phoneme"); GET /v1/pronunciation-dictionaries lieferte 200 mit LEERER Liste.
//   - Zugeordnet wird ein Woerterbuch ueber conversation_config.tts.
//     pronunciation_dictionary_locators - eine Liste aus {pronunciation_dictionary_id,
//     version_id}. Am Live-Agenten gemessen: das Feld existiert, Wert heute [].
//   - Phonem-Regeln (IPA/CMU) wirken laut Doku NUR bei eleven_flash_v2 und eleven_v3 und
//     werden von anderen Modellen STILL uebersprungen. Der Live-Agent faehrt
//     eleven_v3_conversational, enable_phoneme_tags steht auf false - der belegte Weg ist
//     damit die modellunabhaengige ALIAS-Regel.
//
// WARUM DIESE DATEI DEN BESITZ PINNT und nicht den Klang: der Klang ist nur mit einem Ohr
// pruefbar. Pruefbar ist dagegen, dass die EINE Stelle, an der die Korrektur haengt, dem
// Repo gehoert - sonst nimmt ein Dashboard-Klick sie wieder ab und niemand sieht es. Das
// Drift-Gate (npm run elevenlabs:drift) vergleicht ausschliesslich, was die Vorlage unter
// _besitz.felder erklaert; faellt dieser Eintrag weg, hoert es lautlos auf, das Feld
// anzusehen. Genau das faengt der erste Fall.
//
// KEIN NETZ, KEIN KONTO: gepinnt wird die VORLAGE IM REPO, nie der Agent im Konto - wie in
// test/elevenlabs-agent-werkzeuge.test.js. Ob beide uebereinstimmen, ist Sache des
// Drift-Gates.
//
// Testnamen tragen bewusst KEINE Katalog-/Abnahme-Kennung am Namensanfang (package.json
// config.i18nCatalogPattern / config.abnahmePattern), sonst landen sie in der falschen Bank
// (Lehre catalog-id-prefix-misroutes-tests). Das Verhalten muss ab sofort dauerhaft gelten,
// gehoert also in den Regressionslauf.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const TEMPLATE_REL = "elevenlabs/agent_configs/outbound-agent.template.json";
const TEMPLATE = JSON.parse(readFileSync(new URL(`../${TEMPLATE_REL}`, import.meta.url), "utf8"));

// Der Feldname der Besitz-Erklaerung und die beiden Pfade stehen hier als LITERALE und
// werden nicht aus der Vorlage abgeleitet: ein Test, der beide Seiten aus derselben Quelle
// zoege, koennte ein Auseinanderlaufen nicht sehen (dieselbe Begruendung wie in
// test/elevenlabs-agent-werkzeuge.test.js).
const BESITZ_FELD = "pronunciation_dictionary_locators";
const ART_WERT = "wert";
const VORLAGE_PFAD = "agent.conversation_config.tts.pronunciation_dictionary_locators";
const LIVE_PFAD = "conversation_config.tts.pronunciation_dictionary_locators";

// Beide Kennungen sind Pflicht: eine Zuordnung ohne version_id zeigt auf kein bestimmtes
// Woerterbuch und ist nicht aufloesbar.
const LOCATOR_PFLICHTFELDER = ["pronunciation_dictionary_id", "version_id"];

// Die dynamische Variable, in der der Name reist.
const OWNER_VARIABLE = "{{owner_name}}";

// In Stufen gelesen statt in einer Kette: das Agenten-Objekt ist mehrere Ebenen tief
// (G36/Demeter, im Lint dieses Repos ein Fehler).
const conversationConfig = () => TEMPLATE.agent?.conversation_config ?? {};
const ttsBlock = () => conversationConfig().tts ?? {};
const agentSection = () => conversationConfig().agent ?? {};
const builtInTools = () => agentSection().prompt?.built_in_tools ?? {};
const voicemailMessage = () => builtInTools().voicemail_detection?.params?.voicemail_message ?? "";
const besitzFelder = () => TEMPLATE._besitz?.felder ?? [];
const besitzEintrag = () => besitzFelder().find((eintrag) => eintrag?.feld === BESITZ_FELD);

// Die Formregel als FUNKTION, damit sie nicht nur an der heutigen (leeren) Liste haengt:
// eine Pruefung, die ausschliesslich gegen [] laeuft, ist gruen, ohne etwas zu pruefen
// (Lehre pruefkommando-ohne-positiv-kontrolle). Liefert je unvollstaendigem Eintrag eine
// Fundzeile mit der fehlenden Kennung.
function unvollstaendigeLocators(liste) {
  if (!Array.isArray(liste)) return [`${BESITZ_FELD} ist keine Liste`];
  return liste.flatMap((eintrag, stelle) => {
    const fehlend = LOCATOR_PFLICHTFELDER.filter((feld) => {
      const wert = eintrag?.[feld];
      return typeof wert !== "string" || wert.trim() === "";
    });
    return fehlend.length === 0 ? [] : [`Eintrag ${stelle}: ${fehlend.join(", ")} fehlt`];
  });
}

test("Aussprache: die Vorlage besitzt das Zuordnungsfeld der Aussprache-Woerterbuecher", () => {
  const eintrag = besitzEintrag();
  assert.ok(
    eintrag,
    `${TEMPLATE_REL}: kein Besitz-Eintrag "${BESITZ_FELD}" - ohne ihn vergleicht das Drift-Gate das Feld nicht mehr, und ein im Dashboard abgehaengtes Woerterbuch faellt niemandem auf`,
  );
  assert.equal(
    eintrag.art,
    ART_WERT,
    'nur art "wert" vergleicht diesen einen Pfad wirklich Wert gegen Wert',
  );
  assert.deepEqual(eintrag.vorlage, [VORLAGE_PFAD]);
  assert.deepEqual(
    eintrag.live,
    [LIVE_PFAD],
    "der Live-Pfad ist am Agenten gemessen (15.08.2026); ein anderer Pfad vergliche eine Stelle, die es nicht gibt",
  );
});

test("Aussprache: der besessene Pfad steht wirklich in der Vorlage und ist eine Liste", () => {
  const tts = ttsBlock();
  assert.ok(
    Object.hasOwn(tts, BESITZ_FELD),
    `${VORLAGE_PFAD} fehlt - ein besessener Pfad, den die Vorlage nicht hat, macht das Drift-Gate fail-closed rot statt etwas zu vergleichen`,
  );
  assert.ok(
    Array.isArray(tts[BESITZ_FELD]),
    "der Anbieter erwartet eine Liste von Zuordnungen; alles andere koennte kein Woerterbuch tragen",
  );
});

test("Aussprache: jede eingetragene Woerterbuch-Zuordnung traegt beide Kennungen", async (ctx) => {
  await ctx.test("die echte Vorlage traegt keine halbe Zuordnung", () => {
    assert.deepEqual(unvollstaendigeLocators(ttsBlock()[BESITZ_FELD]), []);
  });

  // Die Positiv-Kontrollen: ohne sie waere der Fall oben gruen, weil die Liste heute leer
  // ist - und bliebe es auch, wenn die Regel gar nichts prueft.
  await ctx.test("eine vollstaendige Zuordnung ist in Ordnung", () => {
    const vollstaendig = [{ pronunciation_dictionary_id: "pd_1", version_id: "v_1" }];
    assert.deepEqual(unvollstaendigeLocators(vollstaendig), []);
  });

  await ctx.test("eine Zuordnung ohne version_id wird gefunden", () => {
    const ohneVersion = [{ pronunciation_dictionary_id: "pd_1" }];
    const funde = unvollstaendigeLocators(ohneVersion);
    assert.equal(funde.length, 1);
    assert.match(funde[0], /version_id/);
  });

  await ctx.test("eine Zuordnung ohne Woerterbuch-Kennung wird gefunden", () => {
    const funde = unvollstaendigeLocators([{ version_id: "v_1" }]);
    assert.equal(funde.length, 1);
    assert.match(funde[0], /pronunciation_dictionary_id/);
  });
});

test("Aussprache: der Name wird an zwei Stellen gesprochen, die kein Modell erzeugt", () => {
  // Deshalb ist das Woerterbuch der Hebel und nicht der Prompt: first_message und die
  // Anrufbeantworter-Nachricht gehen als FERTIGER Text in die Synthese - die eine sogar vor
  // jedem Modell-Turn (Offenlegung, Artikel 50 EU AI Act). Eine Anweisung im System-Prompt
  // erreicht genau die erste Sekunde des Anrufs nicht, in der der Name faellt.
  assert.ok(
    agentSection().first_message?.includes(OWNER_VARIABLE),
    `first_message traegt ${OWNER_VARIABLE} nicht mehr - dann faellt der Name woanders, und die Aussprache-Entscheidung zeigt ins Leere`,
  );
  assert.ok(
    voicemailMessage().includes(OWNER_VARIABLE),
    `die Anrufbeantworter-Nachricht traegt ${OWNER_VARIABLE} nicht mehr - dieselbe Sache, zweite Stelle`,
  );
});
