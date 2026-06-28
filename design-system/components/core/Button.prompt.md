**Button** — the primary app action control; use for any commit/submit action in the light app UI.

```jsx
<Button variant="primary" onClick={save}>Save changes</Button>
<Button variant="ghost">Cancel</Button>
```

Variants: `primary` (brand red `#e60000`, hover → `#ac1811`), `ghost` (gray surface). Sizes: `sm` / `md` / `lg`. Pass `href` to render as a link, `disabled` to dim to 60%. For the public marketing site's white pill CTA on the navy hero, use `PillCTA` instead.
