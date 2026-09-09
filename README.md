# Test Cricket Scorer

An offline-first web app for scoring a Test match live, built to replace the
`Test_Cricket1.xlsx` template. Runs on iPad and PC (any modern browser),
installs like a native app, and needs no internet connection once loaded.

Only **Test cricket** is implemented for now. One Day (50-over) and T20 are
planned for a future update — the data model already tags a match with a
`format`, so adding them later means new over-limit/innings rules, not a
rewrite.

## What it does

- **New match wizard**: teams, venue, dates, scheduled length (1-5 days),
  toss, optional line-ups (used only as name suggestions for batsmen — the
  app doesn't track bowlers, extras, or fielding stats).
- **Innings tab with 4 sub-tabs**, one per innings, named e.g. "Australia 1st
  Innings" / "England 1st Innings" / "Australia 2nd Innings". Each shows that
  innings' full over list (score/run-rate at every over), fall of wickets,
  partnerships and milestones.
- **One-tap over entry**: a 0-10 number pad for runs scored that over, plus a
  "10+" button for the rare bigger over. No typing, no separate save step.
- **Wicket button**: tap it, say who's out (of the two current batsmen) and
  the score/over.ball it happened, then name the incoming batsman. That's the
  only place player names are used — purely to label partnerships.
- **Partnerships**: shown as the two batsmen involved, runs, balls and run
  rate — the current stand is just shown as-is, not flagged "unbroken". The
  top-level Partnerships tab compares every wicket's stand across all 4
  innings side by side.
- **Team milestones**: when an over pushes the score past a 50/100/150...,
  the app asks which ball it happened on — so the pace-to-milestone numbers
  are exact, not estimated. The top-level Milestones tab compares them across
  all 4 innings.
- **End Session / New Ball buttons**: press "End Session" and every over from
  then on is tagged with the next session automatically (no per-over
  day/session picker). "New Ball" does the same for ball changes, with a
  fresh new ball at the start of every innings by default.
- **Sessions tab**: a match-wide session-by-session table (all innings
  combined) alongside the existing per-innings breakdown, a day-by-day
  summary, and time-lost-to-weather entry (hours/minutes, or mark a session
  completely lost). Each session's expected 30 overs is shown with a
  green/red/white +/- badge — reduced by 2 overs for every innings change
  that happened during it.
- **Follow-on**: automatically flags when a lead reaches the Laws-of-Cricket
  follow-on margin for the scheduled match length (200 runs for a 5-day
  Test, 150 for 3-4 days, 100 for 2 days, 75 for 1 day) and asks whether to
  enforce it when you start the next innings — this correctly reorders which
  team bats in the 3rd/4th innings.
- **Scorecard tab**: one line per innings — "leads/trails by N with W
  wickets remaining" (or "require N to win" for the 4th) — plus a live
  match-status banner shown on every tab ("India won by an innings and 12
  runs!", "England require 45 more runs to win with 6 wickets remaining"),
  with a manual override for a draw/abandonment the logic can't infer on its
  own.
- **Undo last over**, **declare innings**, and editable **Match Info** at any
  time — including the toss, which every innings' batting/bowling team is
  derived from live, so changing it retroactively fixes the whole match
  instead of only new innings.

## Running it

This is a static site (no backend, no build step) but it needs to be served
over `http://`/`https://`, not opened as a `file://` — that's what makes the
installable, offline-capable part (the service worker) work. Any of these
work:

- **Host it once, use it anywhere**: push this repo to GitHub Pages (or any
  static host) and open the URL. After the first visit it keeps working
  offline.
- **On a PC, run it locally**: double-click `run.bat` in this folder — it
  starts a local server (using Python or Node, whichever it finds) and opens
  the app in your default browser. Leave the server window open while you
  use the app; closing it stops the server. (Or do it manually: `npx serve`
  or `python3 -m http.server` from this folder, then open
  `http://localhost:<port>`.)
- **On an iPad**: open the hosted URL in Safari, then *Share → Add to Home
  Screen*. It then launches full-screen like a native app and keeps working
  with the iPad in airplane mode.

All match data is stored on-device (IndexedDB) — nothing is ever sent to a
server. The two things that reach the network are: loading the app itself
the first time, and whatever file-save mechanism your OS/browser uses when
you export a match (see below).

## Saving matches / OneDrive

There's a **match library** on the home screen (matches saved on this
device) and, separately, **export/import to a `.json` file** for backing a
match up or moving it between devices — that's the "save to OneDrive"
piece:

- **Chrome or Edge on PC**: uses the File System Access API. The first
  "Save to file" prompts you to pick a location — point it at your
  OneDrive-synced folder once, and every save after that writes straight to
  that file with no dialog (OneDrive then syncs it in the background, same
  as any other file in that folder). No internet needed for the save itself
  — only for OneDrive's own sync, which happens independently.
- **Safari on iPad (and anywhere else without that API)**: "Save to file"
  triggers a normal download, which opens the Share Sheet / "Save to
  Files" — if you have the OneDrive app installed, OneDrive appears there as
  a save destination. Opening a match later works the same way in reverse
  (Files → OneDrive → pick the file).

Either way, this is manual export/import, not a live sync — which is what
keeps the app itself usable with zero connectivity. "Pull previous
matches" just means opening a previously-exported file (or picking one from
the on-device library) whenever you want, not automatically.

### An alternative you could add later: direct OneDrive integration

If you'd rather browse/open/save your OneDrive files *from inside the app*
without the manual export/import step, that's possible via the
**Microsoft Graph API** with **MSAL.js** for sign-in. It's a legitimate
option, but worth knowing the trade-offs before deciding:

- Requires registering an app in Azure AD/Entra ID (free, but it's an admin
  step) and a sign-in flow the first time (and periodically, as tokens
  expire).
- Requires internet access *for that feature specifically* — it wouldn't
  work mid-match with no signal, unlike the file-based approach above.
- It's a genuinely nicer experience if you always have connectivity and
  want one-click "open my last match from OneDrive" without hunting for a
  file.

I didn't implement this, on the assumption that offline-first was the
priority — say the word if you'd like it added as an optional path
alongside (not instead of) the current export/import.

## Third-party cricket data APIs (not implemented, your call)

You mentioned being open to pulling data from a third party if there's a
compelling option. A few exist, but none are a clean fit for *this* app's
purpose (manually scoring a match you're watching), so I've left them out —
flagging them here in case one is useful to you elsewhere:

- **CricAPI / CricketData.org, RapidAPI cricket feeds, Cricbuzz's unofficial
  API**: live scores, player databases, historical stats. Usable for
  auto-filling a line-up from a real squad, or cross-checking a live score,
  but all require an internet connection and (for most of them) an API key
  / paid tier, which cuts against running fully offline.
- None of them offer a "verify my manual scoring against the official
  feed" mode cheaply — that would mean polling a live-match endpoint
  throughout the day, which is a recurring cost, not a one-off integration.

If a specific use case matters to you — e.g. auto-loading a national
team's current squad as a line-up template — that's a much smaller,
cheaper integration than a full live-data feed, and I'd be glad to scope it
separately.

## Project layout

```
index.html          App shell
css/styles.css       Styling
js/model.js           Data model & cricket over/ball helpers
js/calc.js             Pure calculations (run rate, partnerships, milestones,
                        sessions, follow-on, match-status text)
js/storage.js          IndexedDB match library + saved file handles
js/fileio.js            Export/import to .json (File System Access API +
                          download/open fallback)
js/ui/                   View modules (library, new-match wizard, scorer)
js/app.js                 Router / bootstrap
manifest.json, sw.js, icons/   PWA install + offline caching
```

`js/calc.js` has no DOM dependency and is where the scoring rules live —
that's the file to change if a calculation looks wrong.
