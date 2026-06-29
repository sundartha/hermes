import React from "react";

export interface FieldProps {
  /** Uppercase eyebrow label above the input. */
  label?: React.ReactNode;
  id?: string;
  type?: string;
  value?: string;
  defaultValue?: string;
  placeholder?: string;
  onChange?: (e: React.ChangeEvent<HTMLInputElement>) => void;
  style?: React.CSSProperties;
}

/**
 * Labelled text input — focus turns the border brand-red.
 *
 * @startingPoint section="Forms" subtitle="Labelled text input" viewport="700x150"
 */
export function Field(props: FieldProps): JSX.Element;
