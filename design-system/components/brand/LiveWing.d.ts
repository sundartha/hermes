import React from "react";

export type WingStatus = "idle" | "connecting" | "working" | "success" | "error";

export interface LiveWingProps {
  /** Square edge in pixels (a real WebGL canvas of this size). */
  size?: number;
  /** Call-lifecycle state driving the mesh deformation. */
  status?: WingStatus;
  /** Flight cadence used for the `working` loop. */
  preset?: "classic" | "olympian";
  style?: React.CSSProperties;
}

/**
 * The real lab wing — a deformable Pixi mesh driven through the MCP call
 * lifecycle. Requires `components/brand/wing-engine.js` on the page.
 *
 * @startingPoint section="Brand" subtitle="Live mesh wing — the five call states" viewport="760x420"
 */
export function LiveWing(props: LiveWingProps): JSX.Element;
