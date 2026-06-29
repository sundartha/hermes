**PillCTA** — the marketing site's white pill call-to-action; use it as the single primary action on the navy hero.

```jsx
<div className="on-dark">
  <PillCTA href="/app">Get started</PillCTA>
</div>
```

Must sit inside an `.on-dark` container (it reads dark-scope tokens: `--pill-bg`, `--pill-ink`, Space Grotesk). White background, full 999px radius, soft drop shadow, lifts 1px on hover.
