**StatusBadge** — uppercase tinted pill for call/item state; use in call rows, action items, and MCP cards.

```jsx
<StatusBadge tone="active">Active</StatusBadge>
<StatusBadge tone="completed">Completed</StatusBadge>
```

Tones are monochrome navy + neutral (no red/green): `active`→filled navy, `completed`/`info`→soft navy, `failed`→dark ink on gray, `cancelled`/`neutral`→gray. 13px, semibold, 0.12em tracking, pill radius.
