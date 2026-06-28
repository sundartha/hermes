import React from "react";

/**
 * Button — the primary app action control. Light UI (Inter), brand navy fill,
 * 18px radius. Variants: primary (navy), ghost (gray), and a size scale.
 * Mirrors `.btn` from apps/web/src/styles/app.css.
 */
export function Button({
  children,
  variant = "primary",
  size = "md",
  disabled = false,
  href,
  onClick,
  style,
  ...rest
}) {
  const [hover, setHover] = React.useState(false);

  const pads = {
    sm: "8px 14px",
    md: "20px 16px",
    lg: "22px 28px",
  };

  const palette = {
    primary: {
      bg: hover && !disabled ? "var(--color-action-hover)" : "var(--color-action)",
      fg: "var(--color-on-action)",
    },
    ghost: {
      bg: hover && !disabled ? "var(--color-gray-100)" : "var(--color-gray-75)",
      fg: "var(--color-text)",
    },
  }[variant] || {};

  const base = {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    gap: "var(--space-tight)",
    padding: size === "md" ? "var(--space-gap) var(--space-inline)" : pads[size],
    border: 0,
    borderRadius: "var(--radius-card)",
    background: palette.bg,
    color: palette.fg,
    fontFamily: "var(--font-body)",
    fontSize: "var(--text-body)",
    fontWeight: "var(--weight-label)",
    lineHeight: 1.2,
    textDecoration: "none",
    cursor: disabled ? "default" : "pointer",
    opacity: disabled ? 0.6 : 1,
    transition: "background var(--motion-duration) var(--motion-ease)",
    ...style,
  };

  const handlers = {
    onMouseEnter: () => setHover(true),
    onMouseLeave: () => setHover(false),
    onClick: disabled ? undefined : onClick,
  };

  if (href && !disabled) {
    return (
      <a href={href} style={base} {...handlers} {...rest}>
        {children}
      </a>
    );
  }
  return (
    <button type="button" disabled={disabled} style={base} {...handlers} {...rest}>
      {children}
    </button>
  );
}
