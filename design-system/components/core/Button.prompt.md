**Button** — the primary app action control; use for any commit/submit action in the light app UI.

```jsx
<Button variant="primary" onClick={save}>Save changes</Button>
<Button variant="ghost">Cancel</Button>
```

Variants: `primary` (brand navy `#1b4f86`, hover → `#0f2d52`), `ghost` (gray surface). Sizes: `sm` / `md` / `lg`. Pass `href` to render as a link, `disabled` to dim to 60%. For the public marketing site's white pill CTA on the navy hero, use `PillCTA` instead.
