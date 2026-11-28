# AniVerse

AniVerse is a mobile-friendly anime catalog and watchlist built with React, Tailwind CSS, and Supabase. It supports title previews, saved watchlists, and offline playback for configured episode videos.

[Live site for my system:](https://aniverse-slmn-v2.vercel.app) · [GitHub repository](https://github.com/mjslm/aniverse)

## Run locally

1. Install **Node.js 22 or newer**.
2. Clone the repository or extract the project ZIP. Open the folder containing `package.json` in VS Code.
3. If you already have a configured local `app.config.json`, you can use it. For a fresh clone, copy `.env.example` to `.env` and use the project URL and publishable key from the project owner or your own Supabase project.

   ```dotenv
   SUPABASE_URL=https://YOUR_PROJECT_REF.supabase.co
   SUPABASE_PUBLISHABLE_KEY=sb_publishable_YOUR_PUBLIC_KEY
   ```

4. Run the following in PowerShell. On macOS or Linux, use `npm` in place of `npm.cmd`.

   ```powershell
   npm.cmd ci --include=dev
   npm.cmd run dev
   ```

Open [localhost:3000](http://localhost:3000) or the address printed in the terminal. Keep local configuration files out of Git.

## Try the app

Search for **demon** as a guest to see title suggestions. Sign in to save an anime to your **Watchlist**. The VIP subscription flow is a free demo.

### Offline playback

With the episode auto-save update, place your demo MP4s in `dist/videos/` using these names:

| Season 1, Episode 1 | Filename |
| --- | --- |
| Frieren | `frieren-s1e1.mp4` |
| Demon Slayer | `demon-slayer-s1e1.mp4` |
| Attack on Titan | `attack-on-titan-s1e1.mp4` |
| Jujutsu Kaisen | `jujutsu-kaisen-s1e1.mp4` |

Open the matching episode and press **Play** to start saving in the background, or **Download** to save it directly. Wait for **Downloaded**, then open **My Library → Downloaded → Play Offline** in the same browser. YouTube previews require an internet connection.

The local MP4 folder is ignored by Git. For a deployed copy, configure direct HTTPS video URLs in `dist/content/media.js` for content you have permission to share. The host must allow downloads from your site.

## Run checks

```powershell
npm.cmd test
npm.cmd run build
npm.cmd run check
```

These run the tests, build the frontend, and check the Supabase connection, respectively.

## Source code

| Path | What it contains |
| --- | --- |
| `dist/app.js`, `dist/modules/` | Screens, navigation, search, account sync, and playback |
| `src/frontend.jsx`, `src/tailwind.css`, `dist/styles.css` | React rendering and interface styles |
| `dist/content/`, `api/` | Catalog, video sources, and API endpoints |
| `dist/sw.js`, `dist/manifest.webmanifest` | Offline caching and app installation |
| `supabase/`, `tests/` | Database schema, migrations, and automated tests |

## Supabase and Vercel

For a new, empty Supabase project, run `supabase/schema.sql` and then the files in `supabase/migrations/` in filename order.

In Supabase **Authentication → URL Configuration**, set **Site URL** to your deployed address, or `http://localhost:3000` for a local-only project. Add the redirects for whichever environments you use. [Supabase redirect guide](https://supabase.com/docs/guides/auth/redirect-urls)

```text
http://localhost:3000/?auth=confirmed
http://localhost:3000/?auth=recovery
https://aniverse-slmn-v2.vercel.app/?auth=confirmed
https://aniverse-slmn-v2.vercel.app/?auth=recovery
```

### Password recovery on mobile and desktop

Supabase sends the recovery email; AniVerse displays the **New password** and **Confirm password** form and updates the password after verification.

For the current production site, set **Site URL** to `https://aniverse-slmn-v2.vercel.app`. Add the two exact production callback URLs above to **Redirect URLs**. Keep local or older-domain redirects only if you still use them.

To let someone request a reset on desktop and open the email on mobile (or another browser), deploy this version first, then update **Authentication → Email Templates → Reset Password** to use:

```html
<h2>Reset your AniVerse password</h2>
<p>Open the link below to choose a new password.</p>
<p><a href="{{ .RedirectTo }}&amp;token_hash={{ .TokenHash }}&amp;type=recovery">Reset password</a></p>
<p>If you did not request this, you can ignore this email.</p>
```

This template is specific to AniVerse's reset request, whose redirect always includes `?auth=recovery`. Supabase may also append `sb_flow_id`. The app verifies the one-time token with `verifyOtp({ token_hash, type: "recovery" })`, then removes callback credentials from the address. It enables password updates only after Supabase verifies recovery. Ordinary sign-in/sign-up requests continue to use PKCE. [Supabase email template guide](https://supabase.com/docs/guides/auth/auth-email-templates)

The default `{{ .ConfirmationURL }}` template and previously sent PKCE reset links still need the original browser's verifier. Request a **new** reset email after changing the template. The template and redirect settings are stored in Supabase, so merging code alone does not update them.

Check the complete flow after deployment:

1. Request a reset from **Log In → Forgot password** on desktop.
2. Open the newest email on a phone in another browser. Confirm the new-password form appears and permits submission after verification.
3. Enter matching passwords of at least 8 characters, submit, then check a fresh login with the new password.
4. Repeat with a request from mobile and an email opened on desktop.
5. A used/expired link must offer a new link and keep **Update Password** disabled. Follow **Send a new reset link** and confirm a replacement can be requested without reloading the app. Visiting `/#reset-password` without a valid recovery link must not enable password updates.

Import the repository into Vercel and use these settings:

| Setting | Value |
| --- | --- |
| Application Preset | Other |
| Root Directory | `./` |
| Install Command | `npm ci --include=dev` |
| Build Command | `npm run build` |
| Output Directory | `dist` |

Add `SUPABASE_URL` and `SUPABASE_PUBLISHABLE_KEY` in **Settings → Environment Variables** for Production. Add them to Preview if you use preview builds. [Vercel environment variables guide](https://vercel.com/docs/environment-variables)
