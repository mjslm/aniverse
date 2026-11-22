# AniVerse

AniVerse is a mobile-friendly anime catalog and watchlist built with React, Tailwind CSS, and Supabase. It supports title previews, saved watchlists, and offline playback for configured episode videos.

[Live site](https://aniverse-slmn.vercel.app/) · [GitHub repository](https://github.com/mjslm/aniverse)

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
https://aniverse-slmn.vercel.app/?auth=confirmed
https://aniverse-slmn.vercel.app/?auth=recovery
```

Import the repository into Vercel and use these settings:

| Setting | Value |
| --- | --- |
| Application Preset | Other |
| Root Directory | `./` |
| Install Command | `npm ci --include=dev` |
| Build Command | `npm run build` |
| Output Directory | `dist` |

Add `SUPABASE_URL` and `SUPABASE_PUBLISHABLE_KEY` in **Settings → Environment Variables** for Production. Add them to Preview if you use preview builds. [Vercel environment variables guide](https://vercel.com/docs/environment-variables)
