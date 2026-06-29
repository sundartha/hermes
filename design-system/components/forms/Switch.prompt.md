**Switch** — on/off toggle for permission rows and settings.

```jsx
<Switch defaultChecked onChange={(on) => save(on)} />
<Switch checked={enabled} onChange={setEnabled} />
```

Track is `--color-indicator-off` gray when off, `--color-action` red when on; the white knob slides 20px. Works controlled (`checked`) or uncontrolled (`defaultChecked`).
