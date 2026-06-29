import React from "react";

/**
 * Card — the standard light-app container: white surface, hairline border, 18px
 * radius, soft shadow. Optional `title` renders a bold 20px heading.
 * Mirrors `.card` from apps/web/src/styles/app.css.
 */
export function Card({ title, children, style, bodyStyle, ...rest }) {
  return (
    <section
      style={{
        background: "var(--color-card)",
        border: "var(--border-width) solid var(--color-border)",
        borderRadius: "var(--radius-card)",
        boxShadow: "var(--shadow-card)",
        padding: "var(--space-card)",
        ...style,
      }}
      {...rest}
    >
      {title && (
        <h3
          style={{
            margin: "0 0 var(--space-stack)",
            fontFamily: "var(--font-heading)",
            fontSize: "var(--text-subtitle)",
            fontWeight: "var(--weight-heading)",
            letterSpacing: "var(--tracking-heading)",
            color: "var(--color-text)",
          }}
        >
          {title}
        </h3>
      )}
      <div style={bodyStyle}>{children}</div>
    </section>
  );
}
