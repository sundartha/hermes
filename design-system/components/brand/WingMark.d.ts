import React from "react";

export type WingStatus = "idle" | "connecting" | "working" | "success" | "error";

export interface WingMarkProps {
  /** Square edge of the mark in pixels. */
  size?: number;
  /**
   * Animation state, mirroring the Hermes animation lab:
   * `idle` (gentle hover), `connecting` (two cautious beats),
   * `working` (continuous flap — on the call), `success` (upward snap),
   * `error` (stutter, then droop).
   */
  status?: WingStatus;
  /** Idle drift — perpetual gentle sway. Only applies in the `idle` status. */
  float?: boolean;
  /** Soft drop shadow under the wing. */
  shadow?: boolean;
  alt?: string;
  style?: React.CSSProperties;
}

/**
 * The Hermes wing — the system's constant brand mark, animatable through the
 * MCP call lifecycle (idle → connecting → working → success / error).
 *
 * @startingPoint section="Brand" subtitle="The wing mark and its live statuses" viewport="700x300"
 */
export function WingMark(props: WingMarkProps): JSX.Element;
