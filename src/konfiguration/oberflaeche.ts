const SAFE_DUCK_TYPING_PROPS = new Set<string>(["then", "toJSON"]);

export function guardedConfig<T extends object>(target: T, path = "config"): T {
  return new Proxy(target, {
    get(obj, prop, receiver) {
      if (typeof prop === "symbol" || prop in obj) {
        const value: unknown = Reflect.get(obj, prop, receiver);
        const isNestedGroup = value && typeof value === "object" && !Array.isArray(value);
        return isNestedGroup ? guardedConfig(value, `${path}.${String(prop)}`) : value;
      }
      if (SAFE_DUCK_TYPING_PROPS.has(prop)) return undefined;
      throw new TypeError(
        `${path}.${prop} existiert nicht (verschobener/entfernter Config-Key? ` +
          "config.<namespace>.<key> nutzen - Gruppierung in src/config.ts pruefen).",
      );
    },
    set(obj, prop, value) {
      if (typeof prop === "symbol" || prop in obj) return Reflect.set(obj, prop, value);
      throw new TypeError(
        `${path}.${prop} kann nicht gesetzt werden (flache Oberflaeche entfernt; ` +
          "config.<namespace>.<key> nutzen).",
      );
    },
  });
}

function makeNamespaceGroup(keys: readonly string[], storage: Record<string, unknown>): object {
  const group = {};
  for (const key of keys) {
    Object.defineProperty(group, key, {
      enumerable: true,
      get: () => storage[key],
      set: (value: unknown) => {
        Object.assign(storage, { [key]: value });
      },
    });
  }
  return group;
}

export function attachNamespaces(target: Record<string, unknown>, namespaces: Record<string, readonly string[]>): void {
  for (const [namespace, keys] of Object.entries(namespaces)) {
    Object.defineProperty(target, namespace, {
      enumerable: false,
      configurable: true,
      value: makeNamespaceGroup(keys, target),
    });
  }
}

export function buildNamespaceSurface(storage: Record<string, unknown>, namespaces: Record<string, readonly string[]>): object {
  const surface = {};
  for (const [namespace, keys] of Object.entries(namespaces)) {
    Object.defineProperty(surface, namespace, {
      enumerable: true,
      configurable: true,
      value: makeNamespaceGroup(keys, storage),
    });
  }
  return surface;
}
