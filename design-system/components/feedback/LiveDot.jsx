import React from "react";

/**
 * LiveDot — small round status indicator. Navy when live, gray when idle.
 * Mirrors `.live-dot` from app.css.
 */
export function LiveDot({ live = false, size = 12, style, ...rest }) {
  return (
    <span
      style={{
        display: "inline-block",
        width: size,
        height: size,
        borderRadius: "var(--radius-round)",
        flexShrink: 0,
        background: live ? "var(--color-indicator-live)" : "var(--color-indicator-off)",
        ...style,
      }}
      {...rest}
    />
  );
}
