# Sierra Leone Connect (SC)

The dating app that links Sierra Leoneans anywhere in the world — Freetown to London, the DMV, Atlanta, Toronto and beyond. Installable PWA, vanilla ES modules, no build step.

## Pages
| Page | Who | What |
|---|---|---|
| `index.html` | Everyone | Landing + login/sign-up, onboarding, Discover, Likes, Chats, Profile |
| `admin.html` | admin, superadmin | Overview, Reports, Verification, Scam Shield, Members |
| `superadmin.html` | superadmin | Everything above + Analytics, Staff & roles, App settings, Audit log |

## What makes it sticky (and easy to match) — v1.1
**Matching**
- **Compatibility questions (OkCupid-style)** — 34 questions across Faith & values, Family, Salone & diaspora, Lifestyle, Love. For each: your answer, answers you'd accept, and importance (Irrelevant → Dealbreaker). Score = geometric mean of both sides' weighted satisfaction (0/1/10/50/250) minus a 1/n margin. Dealbreakers hide incompatible people both ways. Same formula in JS and SQL (parity-tested).
- **Connect Score** blends question compatibility (weight grows with shared answers, up to 60%) with intent, interests, home district/region/heritage, language, distance, faith and activity. "Why you match" chips on every card, e.g. "You agree on Children & Moving home".
- 9 core questions in onboarding (5 required); the rest from Profile → Stand out.
- People who already liked you rank first; new members get a 72-hour "New here 👋" boost.

**Habit loops**
- **Question of the Day** — answer for +1 Oya! super like that day.
- **Like with a comment (Hinge-style)** — heart any photo or prompt and add a note; it shows on their Likes grid and becomes the first message when you match.
- **Match expiry (Bumble-style)** — new matches fade after 7 days unless someone says hi; one free 3-day extension.
- **Voice** — 30-second voice intro on profiles, and voice notes in chat.
- **Salone This or That** — chat game (Jollof or Cassava leaf? Lumley or Tokeh?) with pick reveal.
- Typing indicator, "Seen" receipts, "Your turn" nudges, openers drawn from shared answers, daily streak, Top Picks, match celebration.

## Safety
- 18+ enforced client- and server-side. Only city shown; GPS rounded to ~1 km.
- **Scam Shield** flags money requests, payment apps (Western Union, Orange Money, Afrimoney, Cash App…), gift cards, crypto, phone numbers, links and off-app pulls — warns the recipient and queues for moderators.
- Selfie verification (private bucket, staff-only signed URLs), report + block, unmatch, pause, delete account.
- Staff consoles require TOTP 2FA (aal2) in live mode, enforced in the database.

## Run it now (demo mode)
Upload everything to your web host (or `python3 -m http.server`). With `js/config.js` empty the app runs fully in the browser with 48 sample members (illustrated avatars).  
Demo staff (this device only): `admin@slconnect.demo / Admin#2026`, `super@slconnect.demo / Super#2026`.

## Go live with Supabase
1. Create a Supabase project → SQL editor → run `supabase/schema.sql`.
2. Auth → URL configuration: set Site URL to your domain. Auth → enable MFA (TOTP).
3. Paste the project URL and **anon/publishable** key into `js/config.js`.
4. Sign up in the app, then make yourself SuperAdmin:
   `update public.profiles set role = 'superadmin' where email = 'you@example.com';`
5. Open `superadmin.html`, scan the 2FA QR code, done.

All reads/writes go through `SECURITY DEFINER` RPCs that check auth, account status, blocks, quotas and roles; tables have RLS on and no direct grants (messages has a members-only SELECT policy for Realtime).

## Deploy (IONOS / Apache)
Upload the folder contents to the web root, including the hidden `.htaccess` (HTTPS redirect, CSP, security headers, caching, blocks `/supabase` and dotfiles). Bump `VERSION` in `sw.js` and the `?v=` query strings on each release.

## Live backend (connected)
- Supabase project **Sierra Leone Connect** (`ftxakwsdbrohtniofqov`, us-east-1), org Afribconnect. `js/config.js` already points at it.
- Schema applied as migrations `slc_01`–`slc_06`; storage buckets `photos` (public), `voice` and `verifications` (private); realtime on `messages`.
- Permissions lockdown applied (migration `slc_09_security_lockdown`, verified). `supabase/LOCKDOWN_RUN_ME.sql` stays as the reference copy.
- Auth → URL Configuration: set Site URL to your domain and add it to Redirect URLs. Auth → SMTP: use a custom sender (e.g. Resend) — the built-in mailer is heavily rate-limited.
- First SuperAdmin: sign up in the app, then `update public.profiles set role = 'superadmin' where email = 'you@example.com';` and open `superadmin.html` to enrol 2FA.
- To run the offline demo instead, blank `SUPABASE_URL` and `SUPABASE_ANON_KEY` in `js/config.js`.

## Hosting (Render)
- Live site: https://sierra-leone-connect-5sxz.onrender.com — Render static site `sierra-leone-connect-5sxz` (free), Blueprint `render.yaml`, repo `bkoroma/Sierra-Leone-Connect` (`main`).
- `scripts/render-build.sh` publishes only the public files to `dist/`; security headers (CSP, HSTS, frame/sniff protection) and cache rules live in `render.yaml`.
- Auto-deploy on push needs Render's GitHub app to have access to this repo (GitHub → Settings → Applications → Render → Repository access). Until then, deploy from the Render dashboard (Manual Deploy).
