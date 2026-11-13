export const WEBSOCKET_BEISPIEL_SCHLUESSEL = "dGhlIHNhbXBsZSBub25jZQ==";

export const WEB_SITZUNGS_GEHEIMNIS = "test-secret-012345678901234567890";

export const SMOKE_SITZUNGS_GEHEIMNIS = "bk5-smoke-secret-0123456789";
export const SMOKE_WEBHOOK_GEHEIMNIS = "whsec_bk5_smoke";

export const STRIPE_SIGNATUR_GEHEIMNIS = "whsec_5f2a9c81d7e64b03a1c8e9f27d6b4a50";
export const STRIPE_ROUTEN_GEHEIMNIS = "whsec_8c1e47b2a90d36f5e2b7c4a19d03f6e8";
export const STRIPE_FALSCHES_GEHEIMNIS = "whsec_e03b6d9f14a27c85b9e2d60f3a7c4b18";
export const STRIPE_REGISTER_SCHLUESSEL = "sk_test_register";
export const STRIPE_RESERVIERUNG_SCHLUESSEL = "sk_test_reservierung";
export const STRIPE_LESEN_SCHLUESSEL = "sk_test_lesen";
export const TELNYX_RESERVIERUNG_SCHLUESSEL = "KEYtest-reservierung";
export const TELNYX_MESSZEILE_SCHLUESSEL = "KEYtest-secret";
export const TELNYX_GAP10_SCHLUESSEL = "KEYtest-gap10-schluessel";
export const STRIPE_ALARM_GEHEIMNIS = "whsec_2d7f90c3e5a18b46f0c2d9e7a3b51f64";

export const ANTHROPIC_SCHLUESSEL_BEISPIEL = "test-eroeffnung-3735-key";
export const AUSFALLPROBE_SCHLUESSEL = "ausfallprobe-erfunden-nicht-echt";

export const PASSWORT_BEISPIEL = "Hunter2secret!";

const TOKEN_RUMPF = "Ab3_x-9Q";

export const LANGE_TOKEN = {
  skProj: `sk-proj-${TOKEN_RUMPF.repeat(20)}`,
  skAnt: `sk-ant-api03-${TOKEN_RUMPF.repeat(12)}AA`,
  longJwt: `eyJhbGciOiJSUzI1NiJ9.eyJ${"a".repeat(700)}.${"b".repeat(342)}`,
  githubPat: `github_pat_11ABCDEFG0123456789abc_${"x".repeat(59)}`,
};

export const PEM_RSA_ANFANG = "-----BEGIN RSA PRIVATE KEY-----";
export const PEM_RSA_ENDE = "-----END RSA PRIVATE KEY-----";
export const PGP_ANFANG = "-----BEGIN PGP PRIVATE KEY BLOCK-----";
export const PGP_ENDE = "-----END PGP PRIVATE KEY BLOCK-----";

export const TOKEN_FORMEN = [
  "AKIA1234567890ABCDEF",
  "ghp_a1B2c3D4e5f6G7h8I9j0K1l2M3n4O5p6Q7r8",
  "sk_live_a1B2c3D4e5F6g7H8i9J0",
  "AIzaa1B2c3D4e5F6g7H8i9J0k1L2m3N4o5Pq6r7",
  "sk-a1B2c3D4e5F6g7H8i9J0k1L2",
  "eyJhbGciOiJub25lIn0.eyJzdWIiOiJ0ZXN0LXQyLTE1In0.c2lnbmF0dXJlLXRlc3Q",
  "-----BEGIN PRIVATE KEY-----\nMIIBVwIBADANBgkqhkiG9w0BAQEFAASCAT8w\n-----END PRIVATE KEY-----",
];

export const LLM_LUECKEN_SCHLUESSEL = "sk-3395-nur-im-header";

export const AUSFALLPROBE_MARKER = "ausfallprobe-marker-aufrufer-nicht-echt";

export const STRIPE_ABO_MESSUNG_SCHLUESSEL = "sk_test_messung_abo";
export const STRIPE_ABO_MESSUNG_GEHEIMNIS = "whsec_messung";
export const BREVO_ABO_MESSUNG_SCHLUESSEL = "brevo-messung";
export const OTLP_MESSWERTE_TOKEN = "t".repeat(20);
export const STRIPE_MAIL_ZAHLUNG_MESSUNG_SCHLUESSEL = "sk_test_messung_mail_zahlung";
export const TELNYX_TRUNK_SCHLUESSEL = "KEYtest-trunk-schluessel";
export const TELNYX_PG_EIGENE_NUMMER_SCHLUESSEL = "KEYtest-pg-eigene-nummer-schluessel";
export const TELNYX_EIGENE_NUMMER_SCHLUESSEL = "KEYtest-eigene-nummer-schluessel";
export const TELNYX_NANP_SCHLUESSEL = "KEYtest-nanp-schluessel";
export const TELNYX_IRSF_SCHLUESSEL = "KEYtest-irsf-schluessel";
export const TELNYX_CAP_SCHLUESSEL = "KEYtest-cap-schluessel";
export const TELNYX_SU_SCHLUESSEL = "KEYtest-su-schluessel";
export const EXA_SCHLUESSEL_BEISPIEL = "recherche-verhalten-exa-key";

export const NACHKONTROLLE_LAUF_TOKEN = "lauf-token-erfunden-nachkontrolle";
export const NACHKONTROLLE_UPDATE_TOKEN = "update-token-erfunden-nachkontrolle";
export const LASTLAUF_WERKZEUG_TOKEN = "lastlauf-erfundenes-werkzeug-token-0123456789";

export const KENNZAHLEN_PASSWORT = "Kz-erfunden-Passwort-0001";
export const KENNZAHLEN_PASSWORT_SONDERZEICHEN = "a@b%c";
export const KENNZAHLEN_PASSWORT_SONDERZEICHEN_KODIERT = "a%40b%25c";
export const KENNZAHLEN_PASSWORT_NICHT_DEKODIERBAR = "Kz%zz-roh-0002";
