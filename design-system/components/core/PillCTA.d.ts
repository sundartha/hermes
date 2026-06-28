import React from "react";

export interface PillCTAProps {
  children?: React.ReactNode;
  href?: string;
  onClick?: () => void;
  style?: React.CSSProperties;
}

/**
 * White pill CTA for the navy marketing hero. Render inside an `.on-dark` scope.
 */
export function PillCTA(props: PillCTAProps): JSX.Element;
