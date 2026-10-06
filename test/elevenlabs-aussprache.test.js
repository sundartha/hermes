import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { providerVoicemailMessage } from "../src/elevenlabs/call-locale.js";
import { LOCALES } from "../src/i18n/locales.js";

const TEMPLATE_REL = "elevenlabs/agent_configs/outbound-agent.template.json";
const TEMPLATE = JSON.parse(readFileSync(new URL(`../${TEMPLATE_REL}`, import.meta.url), "utf8"));

const BESITZ_FELD = "pronunciation_dictionary_locators";
const ART_WERT = "wert";
const VORLAGE_PFAD = "agent.conversation_config.tts.pronunciation_dictionary_locators";
const LIVE_PFAD = "conversation_config.tts.pronunciation_dictionary_locators";

const LOCATOR_PFLICHTFELDER = ["pronunciation_dictionary_id", "version_id"];

const OWNER_VARIABLE = "{{owner_name}}";

const OWNER_NAME_PROBE = "Ausspracheprobe Owner";
const OPENING_PROBE = "Ich rufe wegen einer Terminfrage an.";

const conversationConfig = () => TEMPLATE.agent?.conversation_config ?? {};
const ttsBlock = () => conversationConfig().tts ?? {};
const agentSection = () => conversationConfig().agent ?? {};
const besitzFelder = () => TEMPLATE._besitz?.felder ?? [];
const besitzEintrag = () => besitzFelder().find((eintrag) => eintrag?.feld === BESITZ_FELD);

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
  assert.ok(
    agentSection().first_message?.includes(OWNER_VARIABLE),
    `first_message traegt ${OWNER_VARIABLE} nicht mehr - dann faellt der Name woanders, und die Aussprache-Entscheidung zeigt ins Leere`,
  );
  const gesprochen = providerVoicemailMessage({
    locale: LOCALES.en,
    ownerName: OWNER_NAME_PROBE,
    openingLine: OPENING_PROBE,
  });
  assert.ok(
    gesprochen.includes(OWNER_NAME_PROBE),
    "die Anrufbeantworter-Nachricht traegt den Auftraggeber-Namen nicht mehr unveraendert - " +
      "dieselbe Sache wie bei first_message, zweite Stelle",
  );
});
