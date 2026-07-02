import React from "react";

export interface SwitchProps {
  /** Controlled on/off. */
  checked?: boolean;
  defaultChecked?: boolean;
  onChange?: (checked: boolean) => void;
  disabled?: boolean;
  style?: React.CSSProperties;
}

/** Brand-navy on/off toggle for permission rows and settings. */
export function Switch(props: SwitchProps): JSX.Element;
