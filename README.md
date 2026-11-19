# AniVerse

A mobile anime website rendered with React, styled with Tailwind CSS and custom Figma styles, and connected to Supabase. It keeps the Figma layout, artwork, fonts, and orange/dark colors. Version **2.7.0**.

## Start in VS Code

1. Stop any older AniVerse server with **Ctrl + C**.
2. Extract this ZIP into a new folder. Open **AniVerse_Updated**, the folder containing package.json, in VS Code.
3. Install Node.js **22 or newer**.
4. In the VS Code terminal, run:

```powershell
npm.cmd ci --include=dev
npm.cmd run dev
```

On macOS/Linux, use `npm` instead of `npm.cmd`. Open the address printed in the terminal, normally **http://localhost:3000**. Leave that terminal running while using the local website. Do not open index.html directly or use a separate Live Server.

The startup output must show **AniVerse 2.7.0**, your current folder, and the source of the account settings. If another server already uses port 3000, stop it and start this folder again.

## If the old account warning still appears

The browser can display a previously saved app even when localhost is stopped. This version disables offline caching during local development and retires its old local worker before loading the forms. It preserves browser watchlists, account storage, and local video files.

- Keep `npm.cmd run dev` running. A connection-refused error means the server is not running at that address.
- After starting this version, press **Ctrl + Shift + R** once if an older page is still visible.
- Run `npm.cmd run check` to print the project folder, version, configuration source, and Supabase connection result. It does not print keys or passwords.
- Check the terminal folder/version before opening another downloaded copy.

## Accounts and database

This copy includes the public connection settings for your restored **mjslm’s Project** (`rnxugkmsobyaddbmkkpw`). Its five AniVerse tables and ownership policies are already created. **Do not run supabase/schema.sql again on this project.** The SQL file is retained for review or setting up a separate empty project later.

| Table | Purpose |
| --- | --- |
| profiles | Display names |
| watchlist | Saved anime and statuses |
| watch_progress | Episode positions and completion |
| user_settings | Playback/app preferences |
| user_notes | Private anime notes |

The original calculations table was left intact. AniVerse’s private tables reject anonymous access and restrict signed-in users to their own rows. The project also has existing schema-discovery/password-protection advisor notices; these do not indicate that the account connection is missing.

Create an AniVerse account using your own email and a new password. Confirm the email in the same browser before logging in. Actual signup, email delivery, password recovery, and cross-device sync still need a real-account walkthrough. Configure custom SMTP in Supabase before inviting ordinary public users if the default sender restricts delivery.

The Site URL is `http://localhost:3000`. These local redirects have already been added in Supabase Authentication → URL Configuration:

```text
http://localhost:3000/?auth=confirmed
http://localhost:3000/?auth=recovery
```

### Change the connection later

`app.config.json` is the default public configuration. Startup and builds always generate `dist/config.js` from it, so a blank generated file does not leave the account form disconnected.

To use another project, copy `.env.example` to `.env` beside package.json and fill **both** settings:

```dotenv
SUPABASE_URL=https://YOUR_PROJECT_REF.supabase.co
SUPABASE_PUBLISHABLE_KEY=sb_publishable_YOUR_PUBLIC_KEY
```

Environment variables take priority over .env, followed by app.config.json. Partial/invalid overrides stop startup with an explanation. Publishable keys are intended for browsers. Use the Supabase secret key only as a server environment variable. Do not put it in app.config.json or dist/. The .env file is ignored by Git.

## Features and videos

- Home/Search suggestions match partial titles such as **demon**, alternate names, and small typing mistakes. Tap a suggestion or use arrow keys and Enter.
- Browse supports readable scrolling genre buttons, combined filters, sorting, and grid/list views.
- Watchlists, private notes, resume records, account sync, and backup import/export are included.
- Profile Settings follows the supplied profile design. Tap your name to edit details or the camera to choose a JPG/PNG/WebP avatar (up to 5 MB). Photos stay on this device, separately for each account. Watch statistics and XP come from actual saved activity.
- Profile shows the membership badge and sync status. Password recovery is under Account & Security. Library Backup includes guest import and manual sync retry. Quality, audio, captions, notifications, and Wi-Fi toggles save your choices. Play Next Episode is inside the quality dialog or player settings.
- Device details show this browser; a remote device registry is not implemented.
- Buttons, cards, pages, and dialogs have transitions that respect reduced-motion settings.
- Each of the 13 titles has a matching official publisher trailer, limited in-app to 60 seconds. The sample label remains visible; these are not full episodes.
- Provider branding stays inside its embedded player. For an episode using AniVerse’s own player, use **Video source** to choose a file or direct video URL.
- Only your configured video files support in-app offline downloads. Uploaded files remain on the device; they are not uploaded to Supabase.

Edit the catalog in `dist/content/catalog.js`. Default trailer IDs, attribution, and original publisher links are in `dist/content/previews.js`. Public episode sources can override samples in `dist/content/media.js`, using keys such as `oshi:s1:2`. Search automatically includes titles added to the catalog.

The included metadata API needs no key:

```text
GET /api/health
GET /api/videos?anime=oshi&preview=1
GET /api/videos?anime=oshi&season=s1&episode=2
```

A YouTube watch page is not a direct MP4 URL. Publisher availability can change; the player provides retry/original-video options.

## Frontend source

React renders each screen and dialog. The existing HTML layouts are passed to React to preserve the design and behavior while those templates are still maintained in JavaScript. Tailwind compiles common layout styles without Preflight. The rest of the Figma styling lives in `dist/styles.css`.

The build emits `dist/vendor/react-ui.js` and `dist/tailwind.css` from `src/`. Edit the source files and restart the development server to rebuild them.

## Check the project

```powershell
npm.cmd test
npm.cmd run build
npm.cmd run check
```

Tests cover search, routes, auth adapters, account isolation, SQL ownership policies, startup configuration, local-cache recovery, and offline startup files. The build verifies imports and referenced assets. Physical iOS/Android and real-account testing are still recommended before your instructor’s live review.

## VIP membership

Open the membership screen, choose Basic, Standard, or Premium, then tap **Subscribe & Start Watching**. Signed-in users get the **VIP** badge and a 30-day membership saved in Supabase. A plan change during an active membership keeps the original expiry. Payment options remain selectable for the checkout layout. The total due is ₱0.00 and no billing provider is required. Video features depend on the available source.

For a fresh database, run `supabase/schema.sql`, then apply all files in `supabase/migrations/` in filename order. The bundled project already has these migrations.

## Deploy manually with GitHub

Commit the extracted project to your own GitHub repository. Keep the app.config.json file, package files, dist, api, scripts, tests, supabase, and vercel.json together. Node_modules and local environment files are excluded by .gitignore. Nothing in the project publishes the website automatically.

| Setting | Vercel | Render |
| --- | --- | --- |
| Service type | Framework: Other | Node Web Service |
| Root directory | Folder containing package.json | Folder containing package.json |
| Install command | `npm ci --include=dev` | Included in build command |
| Build command | `npm run build` | `npm ci --include=dev && npm run build` |
| Start command | Managed by Vercel | `npm start` |
| Output directory | `dist` | Served by the Node server |
| Health endpoint | `/api/health` | `/api/health` |

Vercel uses root api/ for server functions. Render uses the included server, which reads PORT and binds to 0.0.0.0; a Render Static Site would not run that API. The included public config works as-is, or you can set the same two public Supabase environment variables before building.

After your own HTTPS deployment, add that exact website’s confirmation/recovery URLs in Supabase. Install the PWA through Android Chrome’s Install app/Add to Home screen, or iPhone Safari’s Share → Add to Home Screen. Offline shell caching is enabled on public hosting, while localhost development stays fresh.

## Source map

| Folder/file | Contents |
| --- | --- |
| dist/app.js | Page layouts, browser integrations, and app actions |
| src/frontend.jsx | React rendering for routes and dialogs |
| src/tailwind.css | Shared layout classes compiled from Tailwind utilities |
| dist/modules | Search, accounts, player, and shared logic |
| dist/content | Anime catalog and video sources |
| dist/assets | Referenced Figma assets, icons, and fonts |
| dist/vendor | Pinned browser client and required license notices |
| scripts | Configuration, server, build, validation, and diagnostics |
| tests | Regression tests |
| supabase/schema.sql | Account database schema |

Anime names and artwork remain with their owners. Third-party client license notices remain included. See [Supabase API keys](https://supabase.com/docs/guides/getting-started/api-keys), [email setup](https://supabase.com/docs/guides/auth/auth-smtp), and [redirect URLs](https://supabase.com/docs/guides/auth/redirect-urls).
