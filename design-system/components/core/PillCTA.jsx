import React from "react";

/**
 * PillCTA — the marketing site's call-to-action: a white, fully-rounded pill on
 * the navy hero. Reads dark-scope tokens, so render it inside an `.on-dark`
 * container. Mirrors `.pill-cta` from apps/web/src/styles/site.css.
 */
export function PillCTA({ children, href = "#", onClick, style, ...rest }) {
  const [hover, setHover] = React.useState(false);
  return (
    <a
      href={href}
      onClick={onClick}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        display: "inline-block",
        padding: "var(--space-cozy) var(--space-roomy)",
        borderRadius: "var(--radius-pill-cta)",
        background: "var(--pill-bg)",
        color: "var(--pill-ink)",
        fontFamily: "var(--font-grotesk)",
        fontWeight: "var(--weight-medium)",
        fontSize: "var(--text-lead)",
        textDecoration: "none",
        boxShadow: "var(--shadow-pill)",
        transform: hover ? "translateY(-1px)" : "none",
        transition: "transform var(--motion-duration) var(--motion-ease)",
        ...style,
      }}
      {...rest}
    >
      {children}
    </a>
  );
}
