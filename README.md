# 🌙 Summer Night — overnight heat risk in European cities

A static site showing **overnight "feels like" (Wet Bulb Globe Temperature) forecasts**
for Paris and other major European cities, with an emphasis on nights where the
feels-like temperature never drops below 20 °C or 25 °C — the nights that are hardest
on human health.

**Live site:** https://mlgh.net/summer-night/
(also https://mlglobalhealth.github.io/summer-night/ — the org's custom Pages domain)

## What it shows

For each city and each night of the coming week (overnight window = **21:00 → 09:00
local time**, labeled by the evening's date):

- **Feels-like minimum** and the hour it occurs, plus the air-temperature minimum
- **Hours at or above 20 °C / 25 °C feels-like**, shown as the ensemble **median with a
  10th–90th percentile range** (e.g. *4 h (2–6)*) — the uncertainty comes from the
  40-member ICON weather ensemble
- The **last two nights of observed temperature** (marked "observed"), before tonight and
  the forecast week, so you can see the trend the forecast is continuing
- A **12-hour sparkline** of the overnight curve, and a 7-day hourly chart (observed portion
  in grey, forecast in blue, split at "now")
- Row highlighting: **orange** when feels-like stays ≥ 20 °C all night, **red** when it
  stays ≥ 25 °C all night
- A **vulnerable-group / mortality banner** flagging *runs of consecutive nights with no
  overnight relief*, and a "no relief" badge on each such night
- An **all-cities overview grid** (cities × nights, colored by severity)

## "Feels like": apparent temperature

"Feels like" is the **Steadman apparent temperature** (the Australian Bureau of
Meteorology *shade* formulation):

```
AT = Ta + 0.33·e − 0.70·ws − 4.0
e  = (RH/100) · 6.105 · exp(17.27·Ta / (237.7 + Ta))       (vapour pressure, hPa)
```

from air temperature `Ta` (°C), relative humidity `RH` (%) and 10 m wind speed
`ws` (m/s). The shade formula has **no solar-radiation term**, which makes it the
correct choice overnight. On humid nights it reads slightly *above* air
temperature; in dry, breezy air slightly below. We compute it identically for the
deterministic forecast and for every ensemble member, so the uncertainty ranges are
internally consistent.

### Why apparent temperature, not WBGT / wet-bulb?

An earlier version used nighttime WBGT. A literature review (see
[`docs/RESEARCH.md`](docs/RESEARCH.md)) changed this:

- **WBGT is built for daytime, in-the-sun physical exertion** and is only the
  best-predicting index for heat mortality in a few tropical countries. It is *not*
  validated for overnight sleep or for temperate-European mortality.
- For heat **mortality** in temperate Europe, plain air temperature predicts about
  as well as any humidity index (Lo et al. 2023, 39 countries; Armstrong et al.
  2019, 445 cities). Where a humidity-inclusive index helps at all in Northern /
  Eastern Europe, it is **apparent temperature** — so that is what we use.

### The two outcomes, and their thresholds

The site answers two different questions with two different signals:

- **Sleep / comfort** — a per-night measure. Sleep degrades *continuously* with
  warmth (no sharp cut-off), but as benchmarks a feels-like that stays **≥ 20 °C**
  all night is a warm, restless night and **≥ 25 °C** all night is oppressive. This
  drives the per-night table and the hours-above-threshold columns.
- **Vulnerable-group mortality** — a *multi-night* measure. Heat deaths in the
  elderly are driven by **consecutive nights with no overnight recovery**, not
  single hot nights: the 2003 Paris study found multi-day *minimum* (night)
  temperature predicted elderly deaths while daytime temperature did not, and a 2025
  study across 34 European countries found back-to-back day-and-night "compound"
  heat carried >2× the mortality risk of daytime-only heat. We flag **runs of nights
  with no overnight relief** — the feels-like minimum never dropping below 20 °C.

Thresholds are **absolute** (20 / 25 °C) for readability. The epidemiology actually
favours *location-specific / percentile* thresholds because temperate populations
acclimatize (22 °C is routine in Rome, alarming in London); moving the mortality
flag to a per-city percentile is the most defensible future refinement.

## Data source

[Open-Meteo](https://open-meteo.com/) — free for non-commercial use, no API key:

- **Forecast API** (`api.open-meteo.com/v1/forecast`): best-estimate hourly
  temperature and relative humidity, 8 days, in each city's local timezone
- **Ensemble API** (`ensemble-api.open-meteo.com/v1/ensemble`, `icon_seamless`):
  40 ensemble members (temperature, humidity, wind) used to compute the uncertainty
  range on hours-above-threshold and the probability of a no-relief night

Two requests per city per update (22 total), well within Open-Meteo's free tier.

Each city is shareable via a URL hash, e.g. https://mlgh.net/summer-night/#rome or
https://mlgh.net/summer-night/epi/#rome.

## Two sites

- **Everyday view** — `/` (https://mlgh.net/summer-night/). "Will you sleep badly and drag
  through work tomorrow?" Per-night feels-like, hours-above-threshold, and a *sleep-debt*
  line for consecutive warm nights. No mortality framing.
- **Epi view** — `/epi/` (https://mlgh.net/summer-night/epi/). The public-health angle:
  a heat-**mortality** signal (consecutive no-relief nights), tonight benchmarked against
  each city's **climatology percentiles** (acclimatization-aware), and each country's
  **historical summer excess mortality**.

## Repository layout

```
index.html                  everyday site (plain HTML/CSS/JS, no build step, no dependencies)
assets/style.css, app.js    shared styles + everyday-site rendering & SVG charts
epi/index.html              epi site
epi/epi.css, epi/app.js     epi-specific styles + rendering (joins the 3 data files)

data/forecast.json          hourly forecast + per-night summaries (cron, ~3-hourly)
data/climatology.json       per-city ERA5 percentiles + hot-nights-per-year (monthly)
data/mortality.json         per-country summer excess mortality from Eurostat (weekly)

scripts/update_forecast.py  Open-Meteo forecast → apparent temp + night summaries (stdlib)
scripts/build_climatology.py Open-Meteo ERA5 archive → per-city climatology percentiles
scripts/update_mortality.py Eurostat weekly deaths → summer excess mortality
scripts/cron_update.sh      forecast cron: fetch → commit → push (lock + log)
scripts/cron_data.sh        slow-data cron: mortality (weekly) / climatology (monthly)
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
17 */3 * * * /path/to/summer-night/scripts/cron_update.sh          # forecast, every 3h
30 4  * * 1 /path/to/summer-night/scripts/cron_data.sh             # mortality, weekly (Mon)
40 4  1 * * /path/to/summer-night/scripts/cron_data.sh climatology # + climatology, monthly
```

The forecast (`cron_update.sh`) is the frequent one. `cron_data.sh` refreshes the epi
datasets: Eurostat mortality weekly, and the heavier ERA5 climatology monthly (pass
`climatology` to rebuild it — otherwise only mortality is fetched).

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

- **Outdoor vs indoor:** we forecast *outdoor* temperature, but sleep and health
  depend on the *bedroom*. Homes without air-conditioning often stay warmer than the
  outside air overnight and cool more slowly, so indoor conditions can be worse than
  these numbers suggest — and nearly all of the threshold evidence in the literature
  is measured indoors. Treat outdoor feels-like as a proxy that may understate risk.
- Forecasts, especially beyond 3–4 days, are uncertain — that's what the ranges are
  for. This is not an official heat warning; follow national meteorological services.
- Apparent temperature here is computed at a single grid point per city; urban heat
  islands can make real neighbourhoods warmer.
- Thresholds are absolute for readability; the epidemiology favours location-specific
  (percentile) thresholds because of acclimatization.
- The ensemble (ICON seamless) is coarser than the deterministic forecast, so the
  central "hours" estimate and the range can disagree slightly.
- All times are local to each city; the overnight window is 21:00–09:00.

See [`docs/RESEARCH.md`](docs/RESEARCH.md) for the literature review behind these
choices, with sources.
