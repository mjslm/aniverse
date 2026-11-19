# AniVerse — Setup and Source Code Guide

AniVerse is a mobile-friendly anime catalog and watchlist web app. It uses React for rendering, Tailwind CSS and custom styles for the interface, and Supabase for authentication and saved account data.

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
4. Save an anime to the Watchlist. In Profile, choose a membership plan to see how the app stores VIP status. Membership activation is free. The payment choices are display controls.
5. To check the video API, open [http://localhost:3000/api/health](http://localhost:3000/api/health) and look for `"ok": true`.

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

Import the GitHub repository into Vercel with the following settings.

| Setting | Value |
| --- | --- |
| Framework Preset | Other |
| Root Directory | Folder containing `package.json` and `vercel.json` |
| Install Command | `npm ci --include=dev` |
| Build Command | `npm run build` |
| Output Directory | `dist` |

The public configuration in `app.config.json` works by default. For a separate Supabase project, set the same two environment variables in Vercel. After deployment, set Supabase’s Site URL to the production URL and add that domain with `/?auth=confirmed` and `/?auth=recovery` to the redirect list. Keep the localhost entries for local testing.
