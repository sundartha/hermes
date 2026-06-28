import React from "react";

export interface ButtonProps {
  children?: React.ReactNode;
  /** Visual style. `primary` = brand-navy fill, `ghost` = subtle gray. */
  variant?: "primary" | "ghost";
  /** Padding scale. */
  size?: "sm" | "md" | "lg";
  disabled?: boolean;
  /** Render as an anchor when set. */
  href?: string;
  onClick?: () => void;
  style?: React.CSSProperties;
}

/**
 * Primary app action control — brand-navy fill, 18px radius, Cardo.
 *
 * @startingPoint section="Core" subtitle="Primary & ghost buttons" viewport="700x220"
 */
export function Button(props: ButtonProps): JSX.Element;
