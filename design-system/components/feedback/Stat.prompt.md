**Stat** — a single KPI tile for the dashboard stat grid; lay several out in a 4-up CSS grid.

```jsx
<div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:"var(--space-gap)"}}>
  <Stat value="128" label="Calls this week" />
  <Stat value="3" label="Active now" />
</div>
```

26px heavy value over a 13px muted label, inset on `--color-surface` with a hairline border.
