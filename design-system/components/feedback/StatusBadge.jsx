import React from "react";

const TONES = {
  active: { bg: "var(--color-status-positive)", fg: "var(--color-on-action)" },
  completed: { bg: "var(--color-status-positive-surface)", fg: "var(--color-status-positive)" },
  cancelled: { bg: "var(--color-status-neutral-surface)", fg: "var(--color-status-neutral)" },
  failed: { bg: "var(--color-status-critical-surface)", fg: "var(--color-status-critical)" },
  info: { bg: "var(--color-status-info-surface)", fg: "var(--color-status-info)" },
  neutral: { bg: "var(--color-status-neutral-surface)", fg: "var(--color-status-neutral)" },
};

/**
 * StatusBadge — small uppercase pill that conveys call / item state. Tinted
 * surface + matching text. Mirrors `.status-badge` from app.css.
 */
export function StatusBadge({ tone = "neutral", children, style, ...rest }) {
  const t = TONES[tone] || TONES.neutral;
  return (
    <span
      style={{
        display: "inline-block",
        flexShrink: 0,
        padding: "var(--space-hairline) var(--space-cozy)",
        borderRadius: "var(--radius-badge)",
        background: t.bg,
        color: t.fg,
        fontFamily: "var(--font-body)",
        fontSize: "var(--text-eyebrow)",
        fontWeight: "var(--weight-label)",
        textTransform: "uppercase",
        letterSpacing: "var(--tracking-label)",
        whiteSpace: "nowrap",
        ...style,
      }}
      {...rest}
    >
      {children}
    </span>
  );
}
