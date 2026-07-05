# 🌙 Summer Night — overnight heat risk in European cities

A static site showing **overnight "feels like" (Wet Bulb Globe Temperature) forecasts**
for Paris and the 10 largest European cities, with an emphasis on nights where the
feels-like temperature never drops below 20 °C or 25 °C — the nights that are hardest
on human health.

**Live site:** https://mlglobalhealth.github.io/summer-night/

## What it shows

For each city and each night of the coming week (overnight window = **21:00 → 09:00
local time**, labeled by the evening's date):

- **Feels-like minimum** and the hour it occurs, plus the air-temperature minimum
- **Hours at or above 20 °C / 25 °C feels-like**, shown as the ensemble **median with a
  10th–90th percentile range** (e.g. *4 h (2–6)*) — the uncertainty comes from the
  40-member ICON weather ensemble
- A **12-hour sparkline** of the overnight curve, and a 7-day hourly chart
- Row highlighting: **orange** when feels-like stays ≥ 20 °C all night, **red** when it
  stays ≥ 25 °C all night
- An **all-cities overview grid** (cities × nights, colored by severity)

## "Feels like": nighttime WBGT

Humid heat is more dangerous than dry heat because sweating stops working. The
Wet Bulb Globe Temperature (WBGT) combines temperature, humidity, and radiant load.
At night there is no solar load, so we use the standard indoor/no-sun formulation:

```
WBGT_night = 0.7 × T_wetbulb + 0.3 × T_air
```

with the wet-bulb temperature from the Stull (2011) approximation using air
temperature and relative humidity.

### Are 20 °C / 25 °C the right thresholds for WBGT?

They are defensible but note that WBGT runs **a few degrees below air temperature**
(except in saturated air), so these thresholds are *stricter* than the same numbers
applied to air temperature:

- Air-temperature research uses **"tropical nights" (Tmin ≥ 20 °C)** as the classic
  sleep-disruption / excess-mortality indicator. A *feels-like* (WBGT) of 20 °C
  overnight typically corresponds to air temperatures of roughly 23–26 °C.
- Occupational WBGT guidance treats **≥ 25 °C WBGT as high strain even at rest**;
  a whole night at that level means essentially no physiological recovery.

So: **≥ 20 °C WBGT all night ≈ a bad, sleep-disrupting night; ≥ 25 °C WBGT all night
≈ a dangerous one.** If you want thresholds aligned with the older air-temperature
literature instead, 20/25 °C on the *air minimum* column are the classic
"tropical night" / "super-tropical night" definitions.

## Data source

[Open-Meteo](https://open-meteo.com/) — free for non-commercial use, no API key:

- **Forecast API** (`api.open-meteo.com/v1/forecast`): best-estimate hourly
  temperature and relative humidity, 8 days, in each city's local timezone
- **Ensemble API** (`ensemble-api.open-meteo.com/v1/ensemble`, `icon_seamless`):
  40 ensemble members used to compute the uncertainty range on hours-above-threshold

Two requests per city per update (22 total), well within Open-Meteo's free tier.

## Repository layout

```
index.html                  the site (plain HTML/CSS/JS, no build step, no dependencies)
assets/style.css
assets/app.js               rendering, hand-rolled SVG charts
data/forecast.json          generated forecast data (committed by the cron job)
scripts/update_forecast.py  fetches Open-Meteo, computes WBGT + night summaries (stdlib only)
scripts/cron_update.sh      cron wrapper: fetch → commit → push, with lock + log
```

## Reproducing from scratch

```bash
git clone git@github.com:MLGlobalHealth/summer-night.git
cd summer-night
python3 scripts/update_forecast.py   # writes data/forecast.json (needs Python ≥ 3.8, stdlib only)
python3 -m http.server 8000          # open http://localhost:8000
```

## Deployment: GitHub Pages

The site is served straight from the `main` branch root — no build step.

1. Push the repo to GitHub.
2. Repo **Settings → Pages → Build and deployment**: Source = *Deploy from a branch*,
   Branch = `main`, folder = `/ (root)`. Or via CLI:
   ```bash
   gh api -X POST repos/<owner>/<repo>/pages -f 'source[branch]=main' -f 'source[path]=/'
   ```
3. The site appears at `https://<owner>.github.io/<repo>/` within a minute or two.
   Every push to `main` (including the cron job's data commits) redeploys automatically.

## Automation: cron on a Linux server

The update script runs on any machine with `git` push access to the repo (SSH key or
token) and Python 3. Every 3 hours is a good cadence — Open-Meteo model runs update
roughly that often:

```bash
crontab -e
# add:
17 */3 * * * /path/to/summer-night/scripts/cron_update.sh
```

The wrapper:

- takes a lock so overlapping runs are skipped,
- `git pull --rebase` first so pushes don't conflict,
- runs the fetch; on **total** failure it exits without touching `data/forecast.json`
  (the site keeps showing the last good forecast),
- on **partial** failure it publishes the cities that succeeded and keeps each failed
  city's previous data (marked "older data" in the UI),
- commits and pushes only when the data actually changed,
- logs to `logs/update.log` (kept to the last ~2000 lines).

Check on it with `tail logs/update.log`.

## Caveats

- Forecasts, especially beyond 3–4 days, are uncertain — that's what the ranges are
  for. This is not an official heat warning; follow national meteorological services.
- Nighttime WBGT here is a *no-solar* approximation from temperature and humidity at
  a single grid point per city; urban heat islands can make real neighborhoods warmer.
- The ensemble (ICON seamless) is coarser than the deterministic forecast, so the
  central "hours" estimate and the range can disagree slightly.
- All times are local to each city; the overnight window is 21:00–09:00.
