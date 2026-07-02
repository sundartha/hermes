import React from "react";

/**
 * Switch — accessible on/off toggle. Track turns brand-navy and the knob slides
 * when checked. Mirrors `.switch` from app.css.
 */
export function Switch({ checked, defaultChecked, onChange, disabled = false, style, ...rest }) {
  const isControlled = checked !== undefined;
  const [internal, setInternal] = React.useState(!!defaultChecked);
  const on = isControlled ? checked : internal;

  const toggle = (e) => {
    if (disabled) return;
    if (!isControlled) setInternal(e.target.checked);
    onChange && onChange(e.target.checked);
  };

  const W = 44, H = 24, KNOB = 20, PAD = 4;

  return (
    <span
      style={{
        position: "relative",
        display: "inline-block",
        width: W,
        height: H,
        flexShrink: 0,
        opacity: disabled ? 0.6 : 1,
        ...style,
      }}
    >
      <input
        type="checkbox"
        checked={on}
        onChange={toggle}
        disabled={disabled}
        style={{ position: "absolute", opacity: 0, width: 0, height: 0 }}
        {...rest}
      />
      <span
        onClick={(e) => {
          const input = e.currentTarget.previousSibling;
          if (input) input.click();
        }}
        style={{
          position: "absolute",
          inset: 0,
          background: on ? "var(--color-action)" : "var(--color-indicator-off)",
          borderRadius: "var(--radius-badge)",
          cursor: disabled ? "default" : "pointer",
          transition: "background var(--motion-duration) var(--motion-ease)",
        }}
      >
        <span
          style={{
            position: "absolute",
            left: PAD,
            top: PAD,
            width: KNOB,
            height: KNOB,
            background: "var(--color-card)",
            borderRadius: "var(--radius-round)",
            transform: on ? `translateX(${W - KNOB - PAD * 2}px)` : "none",
            transition: "transform var(--motion-duration) var(--motion-ease)",
          }}
        />
      </span>
    </span>
  );
}
