# FB AutoReply — Android WebView App

## Repository Analysis (fb-autoreply-pages)

- **Entry point:** `index.html` (Cloudflare Pages static) + Next.js dashboard under `web/`
- **Live URL:** `https://fb-autoreply-pages.pages.dev`
- **Backend:** `_worker.js` — Cloudflare Pages Function handling FB webhook, talks to Supabase directly (service-role key via env var, anon key fallback)
- **Database:** Supabase (`wbdyjpjbczfunyhhmtry.supabase.co`)
- **Auth:** `src/components/providers/auth-provider.tsx`, Supabase `@supabase/ssr` client (`src/lib/supabase.ts`) — session stored in cookies/localStorage by Supabase's browser client, so standard WebView cookie + DOM storage persistence covers it.
- **Mobile responsive:** viewport meta present (`width=device-width, initial-scale=1, viewport-fit=cover`), Tailwind-based layout — renders fine in WebView.

No backend, database, or worker logic has been touched. This project is a pure WebView wrapper.

## What this app does

Loads `https://fb-autoreply-pages.pages.dev` in a full-screen WebView:
- JS, DOM storage, cookies enabled → persistent Supabase login session across app restarts
- Pull-to-refresh, top progress bar, offline/error screen with retry
- Back button → WebView history, else exit confirmation
- Dashboard-domain and Supabase links open in-app; anything else (OAuth/Facebook login, unrelated external links) opens via Chrome Custom Tabs
- HTTPS only (cleartext disabled), no JS bridge exposed, no secrets bundled

## Build Instructions

### Prerequisites
- Android Studio (Koala+) or command-line Gradle
- JDK 17

### Debug APK
```bash
./gradlew assembleDebug
# output: app/build/outputs/apk/debug/app-debug.apk
```

### Release APK (unsigned, then sign)
```bash
./gradlew assembleRelease
# output: app/build/outputs/apk/release/app-release-unsigned.apk
```
Sign it:
```bash
keytool -genkey -v -keystore fbautoreply.keystore -alias fbautoreply -keyalg RSA -keysize 2048 -validity 10000
apksigner sign --ks fbautoreply.keystore --out app-release-signed.apk app-release-unsigned.apk
```

### Install
```bash
adb install app/build/outputs/apk/debug/app-debug.apk
```
Or just copy the APK to the phone and tap to install (enable "Install unknown apps" for the file source).

## Testing Checklist

- [ ] App launches, splash shows, dashboard loads
- [ ] Login works, session persists after app restart
- [ ] Logout clears session
- [ ] Internal navigation stays in-app
- [ ] Facebook/OAuth login opens via Custom Tab and returns correctly
- [ ] Back button: in-app history → previous page; at root → exit confirm (Yes/Cancel)
- [ ] Airplane mode → offline message + retry button
- [ ] Reconnect + retry → loads normally
- [ ] Pull-to-refresh reloads dashboard
- [ ] AutoReply / Page management / keyword replies work as on web
- [ ] Supabase and Cloudflare Worker connectivity unaffected
- [ ] Rotate/kill/restart app → state recovers (portrait-locked, so mainly process-death recovery)
