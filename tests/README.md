# Tests

```
cd tests
npm install            # once (Playwright also needs: npx playwright install chromium)
npm test               # every suite
node run-all.mjs sql   # only suites whose name contains "sql"
npm run lint           # static analysis of the app's JavaScript
```

- **unit-***: matching score and question maths.
- **sql-***: the whole database schema (`supabase/schema.sql`) loaded into an in-memory Postgres (PGlite): matching parity with the JavaScript, sign-up, moderation, health, compliance and the audit fixes.
- **e2e-***: the app and both consoles driven in a real browser, in demo mode.
- **a11y**: axe-core WCAG 2.1 AA scan of every screen.

The suites never touch the live database. Nothing in this folder is deployed.
