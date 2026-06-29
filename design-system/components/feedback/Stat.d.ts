import React from "react";

export interface StatProps {
  /** Large metric value. */
  value?: React.ReactNode;
  /** Small uppercase caption. */
  label?: React.ReactNode;
  style?: React.CSSProperties;
}

/** Single dashboard metric tile — big value over a muted label. */
export function Stat(props: StatProps): JSX.Element;
