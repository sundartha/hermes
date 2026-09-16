// IEP-P1 Rotprobe: die vier Riegel der Ohrzeugen-Gruppe und der Vorlauf-Beleg.
//
// REIN UND IN-PROCESS: scripts/iel-mess-ohrzeuge.mjs kennt weder fetch noch config noch eine
// Uhr - jede Eingabe kommt als Argument. Deshalb prueft dieser Test die Sperre selbst und
// nicht nur, dass irgendein Lauf verweigert.
//
// Die wichtigste Einzelheit: die Aufweich-Gegenprobe. Ein Gate, das alles ablehnt, besteht
// jeden Negativ-Test. Erst der Nachweis, dass eine PRAEFIX-Variante desselben Vergleichs
// echte Faelle durchliesse, belegt, dass die Strenge wirkt und nicht Zufall ist.

import { strict as assert } from "node:assert";
import { describe, it } from "node:test";

import {
  KOPFRAUM_MIN_CENTS,
  VORLAUF_MAX_ALTER_MS,
  ohrzeugeSperrenGrund,
  ohrzeugeVorlaufGrund,
} from "../scripts/iel-mess-ohrzeuge.mjs";

// Die gepinnte Mess-DID der Rotprobe und die zweite, verkehrsfreie Nummer des Inventars.
const PIN = "+18643028341";
const ZWEITE_INVENTAR_NUMMER = "+15739090177";
const MESS_TENANT = "tenant-mess";
const JETZT_MS = Date.parse("2026-09-17T12:00:00.000Z");
const SEKUNDEN_JE_MINUTE = 60;
const MS_JE_S = 1000;
const MINUTE_MS = SEKUNDEN_JE_MINUTE * MS_JE_S;
// Die Gegenprobe zaehlt als bestanden, wenn eine Aufweichung mehrere echte Faelle durchliesse.
const MIN_AUFGEWEICHTE_TREFFER = 2;

const UMGEBUNG = Object.freeze({ outboundFrozen: false, inboundTenantIds: [MESS_TENANT], inboundScope: "allowlist" });

function guterFall(ueberschreibungen = {}) {
  return {
    art: "texml-ohrzeuge",
    zaehler: "ohrzeuge",
    ziel_e164: PIN,
    anrufer_kennung: ZWEITE_INVENTAR_NUMMER,
    dial_timeout_s: 20,
    sprechspur_nach_s: 12,
    eltern_auflegen_nach_s: null,
    mitschnitt: true,
    ...ueberschreibungen,
  };
}

function guterVorlauf(ueberschreibungen = {}) {
  return {
    belegt_am: new Date(JETZT_MS - MINUTE_MS).toISOString(),
    tenant_id: MESS_TENANT,
    ziel_did: PIN,
    sms_summary_opt_in: false,
    private_number_treffer: false,
    kostendecke_rest_cents: KOPFRAUM_MIN_CENTS,
    ...ueberschreibungen,
  };
}

function kontoNummernFuer(...nummern) {
  return Object.fromEntries(nummern.map((nummer) => [nummer, [{ phone_number: nummer, status: "active" }]]));
}

function vorlaufGrund({ fall = guterFall(), vorlauf = guterVorlauf(), kontoNummern = kontoNummernFuer(PIN, ZWEITE_INVENTAR_NUMMER), umgebung = UMGEBUNG } = {}) {
  return ohrzeugeVorlaufGrund({ fall, vorlauf, kontoNummern, umgebung, jetztMs: JETZT_MS });
}

// Die Aufweichung, gegen die geprueft wird: ein Praefix-Vergleich in beide Richtungen -
// genau das, was ein fluechtig geschriebener Ziel-Riegel tut.
function aufgeweichterZielVergleich(ziel, pin) {
  return typeof ziel === "string" && (ziel.startsWith(pin) || pin.startsWith(ziel));
}

describe("IEP-P1 Riegel 1: Ziel ist EIN gepinnter Wert, strikte String-Gleichheit", () => {
  const abweichendeZiele = [
    "+18643028342",
    "18643028341",
    "+1864302834",
    "+186430283410",
    ZWEITE_INVENTAR_NUMMER,
    "",
    null,
    " +18643028341",
  ];

  it("weist jedes abweichende Ziel ab - auch die zweite Nummer des eigenen Inventars", () => {
    for (const ziel of abweichendeZiele) {
      const grund = ohrzeugeSperrenGrund({ fall: guterFall({ ziel_e164: ziel }), pin: PIN, umgebung: UMGEBUNG });
      assert.ok(grund, `ziel_e164=${JSON.stringify(ziel)} haette verweigert werden muessen`);
    }
  });

  it("laesst genau den gleichen String durch (Positiv-Kontrolle)", () => {
    assert.equal(ohrzeugeSperrenGrund({ fall: guterFall(), pin: PIN, umgebung: UMGEBUNG }), null);
  });

  it("Aufweich-Gegenprobe: ein Praefix-Vergleich liesse mindestens zwei dieser Faelle durch", () => {
    const durchgelassen = abweichendeZiele.filter((ziel) => aufgeweichterZielVergleich(ziel, PIN));
    assert.ok(durchgelassen.length >= MIN_AUFGEWEICHTE_TREFFER, `Gegenprobe traegt nicht: ${JSON.stringify(durchgelassen)}`);
  });

  it("leerer Pin - der ausgelieferte Zustand - verweigert jeden Lauf", () => {
    const grund = ohrzeugeSperrenGrund({ fall: guterFall(), pin: "", umgebung: UMGEBUNG });
    assert.match(grund, /Ziel-Pin nicht gesetzt/);
  });

  it("verweigert, wenn der Mess-Tenant nicht eindeutig gepinnt ist", () => {
    const mehrere = { ...UMGEBUNG, inboundTenantIds: [MESS_TENANT, "tenant-zwei"] };
    const keiner = { ...UMGEBUNG, inboundTenantIds: [] };
    const andererScope = { ...UMGEBUNG, inboundScope: "registrierte_dids" };
    for (const umgebung of [mehrere, keiner, andererScope]) {
      assert.match(ohrzeugeSperrenGrund({ fall: guterFall(), pin: PIN, umgebung }), /nicht eindeutig gepinnt/);
    }
  });
});

describe("IEP-P1 Riegel 2: OUTBOUND_FROZEN sperrt vor allem anderen", () => {
  it("verweigert bei stehendem Notaus, auch wenn sonst alles passt", () => {
    const grund = ohrzeugeSperrenGrund({ fall: guterFall(), pin: PIN, umgebung: { ...UMGEBUNG, outboundFrozen: true } });
    assert.match(grund, /OUTBOUND_FROZEN steht/);
  });

  it("meldet den Notaus VOR jedem anderen Grund", () => {
    const kaputt = guterFall({ ziel_e164: "unsinn", anrufer_kennung: null });
    const grund = ohrzeugeSperrenGrund({ fall: kaputt, pin: "", umgebung: { ...UMGEBUNG, outboundFrozen: true } });
    assert.match(grund, /OUTBOUND_FROZEN steht/);
  });
});

describe("IEP-P1 Riegel 3: Denylist aus der Bestandsquelle", () => {
  it("verweigert ein gesperrtes Ziel und nennt den treffenden Praefix", () => {
    const gesperrtesZiel = "+19001234567";
    const grund = ohrzeugeSperrenGrund({
      fall: guterFall({ ziel_e164: gesperrtesZiel }),
      pin: gesperrtesZiel,
      umgebung: UMGEBUNG,
    });
    assert.match(grund, /Denylist-Treffer \(\+1900\)/);
  });

  it("verweigert einen gesperrten Absender und nennt den treffenden Praefix", () => {
    const grund = ohrzeugeSperrenGrund({ fall: guterFall({ anrufer_kennung: "+5351234567" }), pin: PIN, umgebung: UMGEBUNG });
    assert.match(grund, /Denylist-Treffer \(\+53\)/);
  });

  it("Positiv-Kontrolle: gewoehnliche US-Nummern kommen durch die Denylist", () => {
    assert.equal(ohrzeugeSperrenGrund({ fall: guterFall(), pin: PIN, umgebung: UMGEBUNG }), null);
  });
});

describe("IEP-P1 Riegel 4: Absender und kein Anbieter-Schreibzugriff", () => {
  it("verweigert fehlenden, nicht-E.164- und mit dem Ziel identischen Absender", () => {
    for (const absender of [null, "", "15739090177", "+0573909017", PIN]) {
      const grund = ohrzeugeSperrenGrund({ fall: guterFall({ anrufer_kennung: absender }), pin: PIN, umgebung: UMGEBUNG });
      assert.ok(grund, `anrufer_kennung=${JSON.stringify(absender)} haette verweigert werden muessen`);
    }
  });

  it("nennt den Selbstanruf ausdruecklich", () => {
    const grund = ohrzeugeSperrenGrund({ fall: guterFall({ anrufer_kennung: PIN }), pin: PIN, umgebung: UMGEBUNG });
    assert.match(grund, /Selbstanruf/);
  });

  it("verweigert jedes Feld, das einen Anbieter-Schreibzugriff ausloesen wuerde", () => {
    for (const feld of ["digest", "el_registrierung_id", "braucht_setup", "inbound_patch", "registrierung_erwartet"]) {
      const grund = ohrzeugeSperrenGrund({ fall: guterFall({ [feld]: true }), pin: PIN, umgebung: UMGEBUNG });
      assert.match(grund, new RegExp(`keinen Anbieter-Schreibzugriff \\(${feld}\\)`));
    }
  });
});

describe("IEP-P1 Vorlauf-Beleg und Telnyx-Eigentumsbeleg", () => {
  it("Positiv-Kontrolle: vollstaendiger Beleg liefert keinen Grund", () => {
    assert.equal(vorlaufGrund(), null);
  });

  it("verweigert ohne Beleg, mit unlesbarem, zu altem oder zukuenftigem Datum", () => {
    assert.match(vorlaufGrund({ vorlauf: null }), /Vorlauf-Beleg fehlt/);
    assert.match(vorlaufGrund({ vorlauf: guterVorlauf({ belegt_am: "vorgestern" }) }), /lesbares belegt_am/);
    const zuAlt = new Date(JETZT_MS - VORLAUF_MAX_ALTER_MS - MINUTE_MS).toISOString();
    assert.match(vorlaufGrund({ vorlauf: guterVorlauf({ belegt_am: zuAlt }) }), /aelter als 24 h/);
    const zukunft = new Date(JETZT_MS + MINUTE_MS).toISOString();
    assert.match(vorlaufGrund({ vorlauf: guterVorlauf({ belegt_am: zukunft }) }), /aelter als 24 h|Zukunft/);
  });

  it("verweigert falsche ziel_did und fremden Tenant", () => {
    assert.match(vorlaufGrund({ vorlauf: guterVorlauf({ ziel_did: ZWEITE_INVENTAR_NUMMER }) }), /andere ziel_did/);
    assert.match(vorlaufGrund({ vorlauf: guterVorlauf({ tenant_id: "tenant-fremd" }) }), /nicht der gepinnte Mess-Tenant/);
  });

  it("verweigert, solange die Summary-SMS nicht nachweislich aus ist", () => {
    for (const wert of [true, null, undefined]) {
      assert.match(vorlaufGrund({ vorlauf: guterVorlauf({ sms_summary_opt_in: wert }) }), /sms_summary_opt_in/);
    }
  });

  it("verweigert, wenn der Absender als private_number stehen koennte", () => {
    assert.match(vorlaufGrund({ vorlauf: guterVorlauf({ private_number_treffer: true }) }), /private_number/);
  });

  it("verweigert unter der Kopfraum-Schwelle der pro-Tenant-Kostendecke", () => {
    assert.match(vorlaufGrund({ vorlauf: guterVorlauf({ kostendecke_rest_cents: KOPFRAUM_MIN_CENTS - 1 }) }), /Kopfraum/);
    assert.match(vorlaufGrund({ vorlauf: guterVorlauf({ kostendecke_rest_cents: null }) }), /Kopfraum/);
  });

  it("verlangt je Nummer GENAU EINEN aktiven Konto-Treffer mit exakter Gleichheit", () => {
    const leer = { [PIN]: [], [ZWEITE_INVENTAR_NUMMER]: [{ phone_number: ZWEITE_INVENTAR_NUMMER, status: "active" }] };
    assert.match(vorlaufGrund({ kontoNummern: leer }), /Ziel ist keine eindeutig aktive Nummer/);

    const doppelt = {
      ...kontoNummernFuer(ZWEITE_INVENTAR_NUMMER),
      [PIN]: [{ phone_number: PIN, status: "active" }, { phone_number: PIN, status: "active" }],
    };
    assert.match(vorlaufGrund({ kontoNummern: doppelt }), /Ziel ist keine eindeutig aktive Nummer/);

    // Telnyx' filter[phone_number] matcht TEILWEISE: die kuerzere Nummer darf nicht zaehlen.
    const teiltreffer = { ...kontoNummernFuer(ZWEITE_INVENTAR_NUMMER), [PIN]: [{ phone_number: "+1864302834", status: "active" }] };
    assert.match(vorlaufGrund({ kontoNummern: teiltreffer }), /Ziel ist keine eindeutig aktive Nummer/);

    const inaktiv = { ...kontoNummernFuer(ZWEITE_INVENTAR_NUMMER), [PIN]: [{ phone_number: PIN, status: "pending" }] };
    assert.match(vorlaufGrund({ kontoNummern: inaktiv }), /Ziel ist keine eindeutig aktive Nummer/);

    const absenderFehlt = { ...kontoNummernFuer(PIN), [ZWEITE_INVENTAR_NUMMER]: [] };
    assert.match(vorlaufGrund({ kontoNummern: absenderFehlt }), /Absender ist keine eindeutig aktive Nummer/);
  });
});
