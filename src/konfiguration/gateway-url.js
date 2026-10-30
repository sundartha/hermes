import { stripTrailingSlash } from "./umgebung.js";

export function gatewayUrlForPort(port) {
  return `http://localhost:${port}`;
}

export function gatewayUrlMit(env, lesePort) {
  let boundGatewayUrl = null;

  function setBoundGatewayPort(port) {
    boundGatewayUrl = gatewayUrlForPort(port);
  }

  function resolveGatewayUrl() {
    return stripTrailingSlash(env.GATEWAY_URL || boundGatewayUrl || gatewayUrlForPort(lesePort()));
  }

  return { setBoundGatewayPort, resolveGatewayUrl };
}
