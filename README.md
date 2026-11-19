# AniVerse — Setup and Source Code Guide

AniVerse is a mobile-friendly anime catalog and watchlist web app. It uses React for rendering, Tailwind CSS and custom styles for the interface, and Supabase for authentication and saved account data.

- [Live AniVerse website](https://aniverse-slmn.vercel.app/)
- [GitHub repository](https://github.com/mjslm/aniverse)

## Run locally

1. Install **Node.js 22 or newer**.
2. Clone the repository or extract the submitted ZIP.
3. Open the folder containing `package.json` in VS Code.
4. Run these commands in the terminal:

```powershell
npm.cmd ci --include=dev
npm.cmd run dev
```

Use `npm` instead of `npm.cmd` on macOS and Linux. Open [http://localhost:3000](http://localhost:3000) or the address printed in the terminal. Keep the terminal running while using the app.

## Review the app

1. As a guest, search for **demon**, open **Demon Slayer**, and try the title preview.
2. Confirm that guests can browse the catalog and that membership options are hidden.
3. Create an account or log in. If email confirmation is enabled, open the confirmation link in the same browser.
4. Save an anime and check that it appears in the Watchlist.
5. Sign in with an account without active VIP. The Premium upgrade card should appear on Home. Choose a plan and subscribe, then return to Home. The card should disappear and Profile should show active VIP. Membership activation is free. The payment choices are display controls.
6. To check the video API, open [http://localhost:3000/api/health](http://localhost:3000/api/health) and look for `"ok": true`.

The catalog includes official title previews. Playback and offline downloads for an episode depend on its configured video source.

## Run checks

Open a second terminal in the project folder while the dev server is running, or stop the server with **Ctrl+C** first.

```powershell
npm.cmd test
npm.cmd run build
npm.cmd run check
```

`test` runs automated tests. `build` compiles the frontend and validates project assets. `check` reports the Supabase connection status.

## Find the source code

| Path | What to review |
| --- | --- |
| `dist/app.js` | Screen templates, navigation, watchlist, playback, and membership actions |
| `src/frontend.jsx` | React rendering for screens and dialogs |
| `src/tailwind.css`, `dist/styles.css` | Tailwind layout rules and custom interface styles |
| `dist/modules/` | Authentication, account sync, search, and video helpers |
| `dist/content/` | Anime catalog, preview metadata, and video sources |
| `api/` | Video metadata and health endpoints |
| `supabase/schema.sql`, `supabase/migrations/` | Database schema, ownership policies, and membership functions |
| `scripts/`, `tests/` | Development server, build scripts, and automated tests |
| `dist/manifest.webmanifest`, `dist/sw.js` | PWA installation metadata and offline caching |

The build generates `dist/tailwind.css` and `dist/vendor/react-ui.js`. Edit the source files under `src/` to change these outputs.

## Supabase setup

The submission includes public connection settings in `app.config.json`. Use the existing project for review as long as it’s available. Its database is already set up.

To run against a separate, empty Supabase project, run `supabase/schema.sql` once, then the files in `supabase/migrations/` in filename order. Copy `.env.example` to `.env` and fill in both values:

```dotenv
SUPABASE_URL=https://YOUR_PROJECT_REF.supabase.co
SUPABASE_PUBLISHABLE_KEY=sb_publishable_YOUR_PUBLIC_KEY
```

Use the Supabase publishable key and keep local `.env` files out of Git. Under **Authentication → URL Configuration**, set the local Site URL to `http://localhost:3000` and allow the following redirects:

```text
http://localhost:3000/?auth=confirmed
http://localhost:3000/?auth=recovery
```

## Deploy to Vercel

AniVerse is deployed at [aniverse-slmn.vercel.app](https://aniverse-slmn.vercel.app/). To deploy another copy, import the GitHub repository into Vercel with these settings.

| Setting | Value |
| --- | --- |
| Application Preset | Other |
| Root Directory | `./` |
| Install Command | `npm ci --include=dev` |
| Build Command | `npm run build` |
| Output Directory | `dist` |

The public configuration in `app.config.json` works by default. For a separate Supabase project, set the same two environment variables in Vercel.

For the live site, use `https://aniverse-slmn.vercel.app` as the Supabase **Site URL** and allow these redirects:

```text
https://aniverse-slmn.vercel.app/?auth=confirmed
https://aniverse-slmn.vercel.app/?auth=recovery
```

Keep the localhost redirects for local testing. Pushes to `main` trigger a Vercel deployment while the GitHub integration is connected. The live site updates after a successful build.
