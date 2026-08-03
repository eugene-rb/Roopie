<div align="center">

<img src="docs/img/logo.png" alt="Roopie" width="96">

# Roopie

**A Chromium-based browser you can rearrange to fit you.**
Built around making tracking visible and around profiles that live per window.

[![Release](https://github.com/eugene-rb/Roopie/actions/workflows/release.yml/badge.svg)](https://github.com/eugene-rb/Roopie/actions/workflows/release.yml)
[![Latest release](https://img.shields.io/github/v/release/eugene-rb/Roopie)](https://github.com/eugene-rb/Roopie/releases/latest)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Platform](https://img.shields.io/badge/Windows-10%20%2F%2011-0078D4?logo=windows11&logoColor=white)](https://github.com/eugene-rb/Roopie/releases/latest)

[**Download**](https://github.com/eugene-rb/Roopie/releases/latest) ・
[日本語 README](README.md)

<img src="docs/img/01-start.png" alt="Roopie start page" width="880">

</div>

> [!NOTE]
> Roopie's user interface is Japanese only for now. The documentation below is a summary —
> the [Japanese README](README.md) is the complete one.

## Highlights

- **Tracking you can actually see** — ads and trackers are blocked by default, and the "Tracking" side panel
  works out *which companies currently hold a unique ID on you* from the cookie store, company by company,
  so you can delete them. The interest categories it infers stay on your machine.
- **Profiles are per window** — open work and personal side by side. Cookies and login sessions are fully
  separated; bookmarks, history, passwords, autofill, gestures and themes can each be shared or kept apart.
  Any profile can route through **Tor**, which ships with the app — no extra install.
- **Side panel (F4)** — bookmarks, downloads, history, notes, reading list, tracking, timers, now playing,
  plus **web panels** that keep any site docked next to your page.
- **Split view and real tab handling** — split a window into two pages, group tabs, put the tab strip on the
  left, and **drag tabs between windows without reloading them** (video keeps playing).
- **Appearance per profile** — light/dark, solid, gradient, pattern, Windows 11 acrylic, accent color, custom CSS.
  The start page is a grid of widgets (clock, calendar, notes, weather, news) and shortcuts you arrange yourself.
- **Background tabs stay silent** — a background tab loads but is not allowed to *start* playing until you
  select it. Not muted, not "play then pause".
- Page and selection translation, mouse gestures, password/address autofill, per-site permissions,
  a floating media player, partial Chrome Web Store extension support, and automatic updates.

## Install

Download `Roopie-Setup-x.x.x.exe` from the [latest release](https://github.com/eugene-rb/Roopie/releases/latest)
(Windows 10 / 11, x64). The installer is not code-signed, so SmartScreen shows a warning on first run —
choose "More info" → "Run anyway", or build it yourself with `npm run dist`.

## Development

Requires Node.js 24+ on Windows.

```bash
npm ci
npm start              # run
npm run start:verify   # run with all renderer console errors printed to the terminal
npm run build:css      # tailwind.css -> src/renderer/pages/app.css (never edit the generated file)
npm run dist           # build the installer locally (dist/)
```

Behaviour is verified with the reusable scripts in `scripts/` (`npx electron scripts/<name>.js`); each one
prints its own OK / NG lines. See [CONTRIBUTING.md](CONTRIBUTING.md) — note that contributions and issues are
handled in Japanese, but English is welcome too.

## Known limitations

- Blocking-type extensions such as uBlock Origin do not work (an Electron limitation; the built-in ad blocker
  covers this instead), and extensions do not run in incognito windows.
- Bridges for censored networks are not supported (pluggable transports are not bundled).
- Windows only for now.

## License

[MIT](LICENSE) © eugene-rb
