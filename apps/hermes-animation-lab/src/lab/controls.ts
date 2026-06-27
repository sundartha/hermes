import { DEFAULT_ROOT } from "../wing/HermesWing.js";
import type { WingApp } from "../wing/WingApp.js";

// Regler-Definitionen fuer die Stage. rootX/rootY steuern gemeinsam den Root,
// die uebrigen jeweils einen Kanal/Gain. Werte werden zentral gehalten und
// koennen als JSON exportiert / zurueckgesetzt werden.

export type SliderKey =
  | "intensity"
  | "speed"
  | "bend"
  | "compression"
  | "tipLag"
  | "rootRotation"
  | "rootX"
  | "rootY"
  | "groupPause";

type SliderSpec = {
  key: SliderKey;
  label: string;
  min: number;
  max: number;
  step: number;
  value: number;
};

const SLIDER_SPECS: readonly SliderSpec[] = [
  { key: "intensity", label: "intensity", min: 0, max: 2, step: 0.01, value: 1 },
  { key: "speed", label: "speed", min: 0.1, max: 2.5, step: 0.01, value: 1 },
  { key: "bend", label: "bend", min: 0, max: 2, step: 0.01, value: 1 },
  { key: "compression", label: "compression", min: 0, max: 2, step: 0.01, value: 1 },
  { key: "tipLag", label: "tipLag", min: 0, max: 2, step: 0.01, value: 1 },
  { key: "rootRotation", label: "rootRotation", min: -1, max: 1, step: 0.01, value: 0 },
  { key: "rootX", label: "Root-X", min: 0, max: 1, step: 0.005, value: DEFAULT_ROOT.x },
  { key: "rootY", label: "Root-Y", min: 0, max: 1, step: 0.005, value: DEFAULT_ROOT.y },
  { key: "groupPause", label: "Pause (s)", min: 0, max: 1.5, step: 0.01, value: 0.12 },
];

export class LabControls {
  private readonly values = new Map<SliderKey, number>();
  private readonly inputs = new Map<SliderKey, HTMLInputElement>();
  private readonly outputs = new Map<SliderKey, HTMLElement>();

  constructor(
    container: HTMLElement,
    private readonly stage: WingApp,
    private readonly onChange: () => void,
  ) {
    for (const spec of SLIDER_SPECS) {
      this.values.set(spec.key, spec.value);
      container.appendChild(this.buildSlider(spec));
    }
    this.applyAll();
  }

  private buildSlider(spec: SliderSpec): HTMLElement {
    const row = document.createElement("label");
    row.className = "slider-row";

    const head = document.createElement("span");
    head.className = "slider-head";
    const name = document.createElement("span");
    name.textContent = spec.label;
    const out = document.createElement("output");
    out.textContent = spec.value.toFixed(2);
    head.append(name, out);
    this.outputs.set(spec.key, out);

    const input = document.createElement("input");
    input.type = "range";
    input.min = String(spec.min);
    input.max = String(spec.max);
    input.step = String(spec.step);
    input.value = String(spec.value);
    input.addEventListener("input", () => {
      this.set(spec.key, Number(input.value));
    });
    this.inputs.set(spec.key, input);

    row.append(head, input);
    return row;
  }

  private set(key: SliderKey, value: number): void {
    this.values.set(key, value);
    this.outputs.get(key)!.textContent = value.toFixed(2);
    this.apply(key);
    this.onChange();
  }

  private apply(key: SliderKey): void {
    const v = this.values.get(key)!;
    switch (key) {
      case "intensity":
        this.stage.setIntensity(v);
        break;
      case "speed":
        this.stage.setSpeed(v);
        break;
      case "bend":
        this.stage.setGains({ bend: v });
        break;
      case "compression":
        this.stage.setGains({ compression: v });
        break;
      case "tipLag":
        this.stage.setGains({ tipLag: v });
        break;
      case "rootRotation":
        this.stage.setRootRotation(v);
        break;
      case "rootX":
      case "rootY":
        this.stage.setRoot(this.values.get("rootX")!, this.values.get("rootY")!);
        break;
      case "groupPause":
        this.stage.setGroupPause(v);
        break;
    }
  }

  private applyAll(): void {
    for (const spec of SLIDER_SPECS) this.apply(spec.key);
  }

  reset(): void {
    for (const spec of SLIDER_SPECS) {
      this.values.set(spec.key, spec.value);
      const input = this.inputs.get(spec.key)!;
      input.value = String(spec.value);
      this.outputs.get(spec.key)!.textContent = spec.value.toFixed(2);
    }
    this.applyAll();
    this.onChange();
  }

  /** Aktuelle Reglerwerte als einfaches Objekt (fuer JSON-Export). */
  snapshot(): Record<SliderKey, number> {
    const out = {} as Record<SliderKey, number>;
    for (const [key, value] of this.values) out[key] = Number(value.toFixed(4));
    return out;
  }
}
