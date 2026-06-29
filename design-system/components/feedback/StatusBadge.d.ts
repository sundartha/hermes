import React from "react";

export interface StatusBadgeProps {
  /** Semantic state → tinted surface + text color. */
  tone?: "active" | "completed" | "cancelled" | "failed" | "info" | "neutral";
  children?: React.ReactNode;
  style?: React.CSSProperties;
}

/**
 * Small uppercase status pill for call / item state.
 *
 * @startingPoint section="Feedback" subtitle="Status pills" viewport="700x150"
 */
export function StatusBadge(props: StatusBadgeProps): JSX.Element;
