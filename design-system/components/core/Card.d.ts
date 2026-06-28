import React from "react";

export interface CardProps {
  /** Optional bold heading rendered at the top of the card. */
  title?: React.ReactNode;
  children?: React.ReactNode;
  style?: React.CSSProperties;
  bodyStyle?: React.CSSProperties;
}

/**
 * Standard light-app container — white surface, hairline border, soft shadow.
 *
 * @startingPoint section="Core" subtitle="Titled content container" viewport="700x240"
 */
export function Card(props: CardProps): JSX.Element;
