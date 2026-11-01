const ANFRAGE_DAUER_NAME = "hermes.http.server.duration";
const DAUER_GRENZEN_MS = Object.freeze({
  blitz: 10,
  sehrSchnell: 50,
  schnell: 100,
  normal: 250,
  spuerbar: 500,
  langsam: 1000,
  sehrLangsam: 2500,
  nahAmAbbruch: 10_000,
});
const EXPORT_INTERVALL_MS = 60_000;
const EXPORT_FRIST_MS = 5000;
const METRIKEN_PFAD = "/v1/metrics";
const DIENST_NAME = "hermes";
const UNBEKANNT = "unbekannt";
const ANDERE = "andere";
const ERLAUBTE_METHODEN = new Set(["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"]);
const STATUS_KLASSEN_ANZAHL = 6;
const STATUS_KLASSE_STELLE = 100;
const NANOSEKUNDEN_JE_MS = 1_000_000;

export const KEINE_TELEMETRIE = Object.freeze({
  aktiv: false,
  messeAnfrage() {},
  async spuele() {},
  async stoppe() {},
});

function routenMuster(req) {
  const pfad = req.route?.path;
  return typeof pfad === "string" ? pfad : UNBEKANNT;
}

function statusKlasse(code) {
  const stelle = Math.floor(code / STATUS_KLASSE_STELLE);
  return stelle >= 1 && stelle < STATUS_KLASSEN_ANZAHL ? `${stelle}xx` : ANDERE;
}

function anfrageLabels({ route, method, status }) {
  return {
    route,
    method: ERLAUBTE_METHODEN.has(method) ? method : ANDERE,
    status_class: statusKlasse(status),
  };
}

export function anfrageMessung(telemetrie) {
  return function anfrageMessungMiddleware(req, res, next) {
    if (!telemetrie.aktiv) return next();
    const beginn = process.hrtime.bigint();
    res.once("close", () => {
      const dauerMs = Number(process.hrtime.bigint() - beginn) / NANOSEKUNDEN_JE_MS;
      telemetrie.messeAnfrage({ route: routenMuster(req), method: req.method, status: res.statusCode, dauerMs });
    });
    next();
  };
}

function basicAnmeldung(benutzer, token) {
  return `Basic ${Buffer.from(`${benutzer}:${token}`).toString("base64")}`;
}

async function otlpAusfuehrer({ url, benutzer, token }) {
  const { OTLPMetricExporter } = await import("@opentelemetry/exporter-metrics-otlp-http");
  return new OTLPMetricExporter({
    url: `${url.replace(/\/+$/, "")}${METRIKEN_PFAD}`,
    headers: { Authorization: basicAnmeldung(benutzer, token) },
    timeoutMillis: EXPORT_FRIST_MS,
  });
}

const SICHERE_ADRESSE = /^(https:\/\/|http:\/\/(127\.0\.0\.1|localhost)[:/])/;

function otlpKonfiguriert({ url, token }) {
  return typeof url === "string" && SICHERE_ADRESSE.test(url) && Boolean(token);
}

export async function starteTelemetrie({
  url = "",
  benutzer = "",
  token = "",
  instanzKennung,
  version = "",
  intervallMs = EXPORT_INTERVALL_MS,
} = {}) {
  if (!otlpKonfiguriert({ url, token })) return KEINE_TELEMETRIE;
  const [{ MeterProvider, PeriodicExportingMetricReader }, { resourceFromAttributes }] = await Promise.all([
    import("@opentelemetry/sdk-metrics"),
    import("@opentelemetry/resources"),
  ]);
  const leser = new PeriodicExportingMetricReader({
    exporter: await otlpAusfuehrer({ url, benutzer, token }),
    exportIntervalMillis: intervallMs,
    exportTimeoutMillis: Math.min(EXPORT_FRIST_MS, intervallMs),
  });
  const anbieter = new MeterProvider({
    readers: [leser],
    resource: resourceFromAttributes({
      "service.name": DIENST_NAME,
      "service.instance.id": instanzKennung,
      "service.version": version,
    }),
  });
  const dauer = anbieter.getMeter(DIENST_NAME).createHistogram(ANFRAGE_DAUER_NAME, {
    unit: "ms",
    advice: { explicitBucketBoundaries: Object.values(DAUER_GRENZEN_MS) },
  });
  return {
    aktiv: true,
    messeAnfrage(anfrage) {
      dauer.record(anfrage.dauerMs, anfrageLabels(anfrage));
    },
    spuele: () => anbieter.forceFlush(),
    stoppe: () => anbieter.shutdown(),
  };
}
