import React from "react";

/**
 * Stat — a single dashboard metric: large value over a small uppercase label,
 * inside a subtle inset tile. Mirrors `.stat` from app.css.
 */
export function Stat({ value, label, style, ...rest }) {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: "var(--space-hairline)",
        padding: "var(--space-cozy)",
        border: "var(--border-width) solid var(--color-border)",
        borderRadius: "var(--radius-control)",
        background: "var(--color-surface)",
        ...style,
      }}
      {...rest}
    >
      <span
        style={{
          fontSize: "var(--text-title)",
          fontWeight: "var(--weight-heading)",
          letterSpacing: "var(--tracking-heading)",
          color: "var(--color-text)",
        }}
      >
        {value}
      </span>
      <span
        style={{
          fontSize: "var(--text-eyebrow)",
          color: "var(--color-muted)",
        }}
      >
        {label}
      </span>
    </div>
  );
}
