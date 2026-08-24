# Native shells and Google Calendar

Magistrate Wizard stays one React + Supabase app. Capacitor (Android/iOS)
and Electron (Windows) wrap the same `dist/` build. Docket events remain
the legal source of truth; Google Calendar only mirrors **when/where**.

Version is `package.json` (`0.2.0` for this release). Native build number
is `native/version.json` `versionCode` (starts at `2`). After changing
either, run:

```bash
npm run native:sync-version
```

Settings → About shows `APP_VERSION` and `APP_BUILD`.

## Local credentials

Keep secrets in `.env` / `.env.local` (gitignored). Copy `.env.example`.

| Variable | Web / Windows | Android emulator |
|---|---|---|
| `VITE_SUPABASE_URL` | `http://127.0.0.1:55321` | `http://10.0.2.2:55321` |
| `VITE_SUPABASE_ANON_KEY` | from `npm run db:status` | same key |

Google OAuth uses **PKCE public clients** (no client secret in the app).
Enable the Calendar API in Google Cloud, then create OAuth clients:

- Web — redirect `http://127.0.0.1:5373/settings` (and the production origin `/settings`)
- Desktop / Electron — loopback `http://127.0.0.1/oauth/google/callback` (any ephemeral port)
- Android — package `gy.magistrate.wizard` + debug SHA-1; custom scheme `magistratewizard://oauth/google/callback`
- iOS — bundle id `gy.magistrate.wizard`; same custom scheme

Put the client IDs in:

```
VITE_GOOGLE_OAUTH_CLIENT_ID_WEB=
VITE_GOOGLE_OAUTH_CLIENT_ID_DESKTOP=
VITE_GOOGLE_OAUTH_CLIENT_ID_ANDROID=
VITE_GOOGLE_OAUTH_CLIENT_ID_IOS=
```

Scopes: `calendar.events` and `calendar.calendars` so the app can create a
dedicated calendar named **Magistrate Wizard** instead of writing on the
user’s primary calendar.

OAuth tokens and the chosen Google calendar id live on-device
(`localStorage` on web/Electron, Capacitor Preferences on native). They
are never stored in Postgres.

## Next steps

Work left after this branch. Do these in order; later items need the
Google Cloud clients from step 1.

1. **Google Cloud (local).** Enable Calendar API. Create PKCE public
   OAuth clients (no secrets in the app) for Web, Desktop/Electron,
   Android (`gy.magistrate.wizard` + debug SHA-1), and iOS (same bundle
   id). Redirect URIs are listed above. Put the client IDs in
   `.env.local` from `.env.example`.
2. **Apply the database migration** on any environment that is not this
   local instance: `0073_docket_event_calendar_links.sql`.
3. **Android emulator.** `VITE_SUPABASE_URL=http://10.0.2.2:55321`,
   `npm run native:android`, `npx cap open android`. Sign in, open
   Calendar, create a hearing, Connect Google Calendar, confirm the
   event on the dedicated **Magistrate Wizard** calendar.
4. **Windows Electron.** Keep `http://127.0.0.1:55321`.
   `npm run native:electron:dev` for the same Calendar + Google flow.
   `npm run native:electron:dist` for the NSIS installer under
   `release/`.
5. **iOS (Mac).** The `ios/` project is already in the repo. On a Mac:
   `pod install` in `ios/App`, `npx cap sync ios`, open
   `ios/App/App.xcworkspace`. This Windows tree cannot compile an IPA.
6. **Disconnect.** Settings → Disconnect. Further docket edits must not
   call Google. Existing Google events stay in place and stop updating.
7. **Out of scope until you ask.** App Store / Play listing, signing
   certs, push notifications, offline Postgres replica, merging this
   branch to `main`.

Automated checks that should stay green:
`npm run test:calendar-map`, `npm run test:calendar-sync`,
`npm run test:docket-procedure`, `npm run test:protected-route`,
`npm run test:pentest`.

## Scripts

```bash
npm run native:android          # vite build → cap sync android
npx cap open android            # Android Studio / emulator
npm run native:ios              # Mac only: cap sync ios
npx cap open ios                # Xcode (Mac)
npm run native:electron:dev     # Vite + Electron against 127.0.0.1:5373
npm run native:electron:dist    # NSIS installer under release/
```

This Windows machine can produce an Android APK and a Windows installer.
iOS still needs a Mac (or a later CI macOS runner). The `ios/` project
is already generated; on a Mac:

```bash
cd ios/App && pod install && cd ../..
npx cap sync ios
open ios/App/App.xcworkspace
```

Out of scope for v1: App Store / Play listing, signing certs, push
notifications, offline Postgres replica.

## Calendar UI

Authenticated route `/calendar` (Court nav). Month and agenda views list
`docket_events` the caller can already `SELECT`. Click opens the matter
Events tab. All-day when `scheduled_time` is null. Cancelled /
`entered_in_error` stay visible but muted.

## Google sync contract

| Direction | Behaviour |
|---|---|
| Push | Title = case number + matter title; start = date[+time]; location; description = type + deep link only |
| Push | `cancelled` / `entered_in_error` → Google `cancelled` |
| Pull | If Google start/location changed → update only `scheduled_date`, `scheduled_time`, `location` |
| Pull | Ignore description/attendees; never create a Docket row from a random Google event |
| Disconnect | Leave Google events in place and stop updating |

Per-user mappings live in `docket_event_calendar_links`. The old
`docket_events.external_calendar_*` columns stay unused.

## Manual checklist

1. **Android emulator:** set `VITE_SUPABASE_URL=http://10.0.2.2:55321`,
   `npm run native:android`, open the emulator, sign in, open Calendar,
   create a hearing. With OAuth clients configured, Settings → Connect
   Google Calendar, then confirm an event on the dedicated calendar.
2. **Windows Electron:** keep `127.0.0.1` for Supabase,
   `npm run native:electron:dev`, same Calendar + Google flow. The
   installer is `npm run native:electron:dist`.
3. **iOS:** on a Mac, `pod install` in `ios/App`, then `npx cap sync ios`
   and open `ios/App/App.xcworkspace`.
4. **Disconnect:** Settings → Disconnect. Further docket edits must not
   call Google. Existing Google events are **left in place** (not
   cancelled) and are no longer updated.

Automated: `npm run test:calendar-map`, `npm run test:calendar-sync`,
`npm run test:docket-procedure`, `npm run test:protected-route`,
`npm run test:pentest` (anon/outsider must not read
`docket_event_calendar_links`).
