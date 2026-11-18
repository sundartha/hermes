export function gatewayUrlForPort(port: number): string {
  return `http://localhost:${String(port)}`;
}

interface GatewayUrlAbhaengigkeiten {
  umgebung: { GATEWAY_URL?: string | undefined };
  stripTrailingSlash: (url: string) => string;
  standardPort: () => number;
}

export function gatewayUrlMit({ umgebung, stripTrailingSlash, standardPort }: GatewayUrlAbhaengigkeiten) {
  let boundGatewayUrl: string | null = null;
  return {
    setBoundGatewayPort(port: number): void {
      boundGatewayUrl = gatewayUrlForPort(port);
    },
    resolveGatewayUrl(): string {
      const konfiguriert = umgebung.GATEWAY_URL;
      if (konfiguriert) {
        return stripTrailingSlash(konfiguriert);
      }
      return stripTrailingSlash(boundGatewayUrl ?? gatewayUrlForPort(standardPort()));
    },
  };
}
