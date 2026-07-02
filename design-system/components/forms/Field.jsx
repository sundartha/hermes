import React from "react";

/**
 * Field — labelled text input. Uppercase eyebrow label over a bordered input
 * that turns brand-navy on focus. Mirrors `.field-label` / `.field-input`.
 */
export function Field({ label, id, value, defaultValue, placeholder, type = "text", onChange, style, ...rest }) {
  const [focus, setFocus] = React.useState(false);
  const fieldId = id || (label ? String(label).toLowerCase().replace(/\s+/g, "-") : undefined);
  return (
    <label htmlFor={fieldId} style={{ display: "flex", flexDirection: "column", gap: "var(--space-tight)", ...style }}>
      {label && (
        <span
          style={{
            fontSize: "var(--text-eyebrow)",
            fontWeight: "var(--weight-label)",
            textTransform: "uppercase",
            letterSpacing: "var(--tracking-label)",
            color: "var(--color-muted)",
          }}
        >
          {label}
        </span>
      )}
      <input
        id={fieldId}
        type={type}
        value={value}
        defaultValue={defaultValue}
        placeholder={placeholder}
        onChange={onChange}
        onFocus={() => setFocus(true)}
        onBlur={() => setFocus(false)}
        style={{
          width: "100%",
          padding: "var(--space-cozy)",
          border: `var(--border-width) solid ${focus ? "var(--color-field-border-focus)" : "var(--color-field-border)"}`,
          borderRadius: "var(--radius-control)",
          background: "var(--color-card)",
          color: "var(--color-text)",
          fontFamily: "var(--font-body)",
          fontSize: "var(--text-body)",
          outline: "none",
        }}
        {...rest}
      />
    </label>
  );
}
