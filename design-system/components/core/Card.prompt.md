**Card** — the default content container in the light app; wrap any dashboard panel, form, or list in it.

```jsx
<Card title="Settings">
  <p>Panel content…</p>
</Card>
```

White surface, 1px `--color-border` hairline, 18px radius, soft `0 6px 18px rgba(0,0,0,.07)` shadow, 24px padding. `title` is optional. For the dark marketing site, set a `card-dark` look via the `.on-dark` scope instead.
