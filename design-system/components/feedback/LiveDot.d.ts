import React from "react";

export interface LiveDotProps {
  /** Navy (live) vs. gray (idle). */
  live?: boolean;
  /** Diameter in px. */
  size?: number;
  style?: React.CSSProperties;
}

/** Small round live/idle status indicator. */
export function LiveDot(props: LiveDotProps): JSX.Element;
