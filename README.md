# Test Cricket Scorer

An offline-first web app for scoring a Test match live, built to replace the
`Test_Cricket1.xlsx` template. Runs on iPad and PC (any modern browser),
installs like a native app, and needs no internet connection once loaded.

Only **Test cricket** is implemented for now. One Day (50-over) and T20 are
planned for a future update — the data model already tags a match with a
`format`, so adding them later means new over-limit/innings rules, not a
rewrite.

## What it does

Reproduces the spreadsheet's feature set with a much faster data-entry model:

- **New match wizard**: teams, venue, dates, scheduled length (1-5 days),
  toss, optional line-ups.
- **Over-by-over entry**: tap in runs + wickets for each completed over
  (day/session tagged, optional bowler). No ball-by-ball logging required —
  this mirrors how the spreadsheet was actually used, just faster to type on
  a touchscreen.
- **Fall of wickets**: when a wicket is entered, a quick form captures the
  score, the ball it fell on, batsman/how out/bowler/fielder (all optional
  except the score) — this drives the partnerships table.
- **Partnerships**: runs, balls and over-range for every wicket, including
  the current unbroken stand, with the best partnership highlighted.
- **Run rate & team milestones**: live run rate, and the pace to every team
  50/100/150... (balls faced and run rate for that 50-run segment) —
  interpolated from the over-by-over data, so no extra entry is needed.
- **Sessions & days**: runs/overs/wickets/run-rate broken down by
  morning/afternoon/evening session and by day, plus a day-by-day summary
  and a place to log minutes lost to weather per session.
- **Follow-on**: automatically flags when a lead reaches the Laws-of-Cricket
  follow-on margin for the scheduled match length (200 runs for a 5-day
  Test, 150 for 3-4 days, 100 for 2 days, 75 for 1 day) and asks whether to
  enforce it when you start the next innings.
- **Live match-status sentence**: "England lead by 45 runs with 6 wickets
  remaining in the 3rd innings", "India won by an innings and 12 runs!", etc.
  — generated automatically, with a manual override for a draw/abandonment
  the logic can't infer on its own (e.g. "Drawn — stumps, Day 5").
- **Undo last over** and **declare innings**, so mis-entries and
  declarations are easy to handle mid-match.

## Running it

This is a static site (no backend, no build step) but it needs to be served
over `http://`/`https://`, not opened as a `file://` — that's what makes the
installable, offline-capable part (the service worker) work. Any of these
work:

- **Host it once, use it anywhere**: push this repo to GitHub Pages (or any
  static host) and open the URL. After the first visit it keeps working
  offline.
- **On a PC, run it locally**: from this folder, `npx serve` (or
  `python3 -m http.server`) and open `http://localhost:<port>`.
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
