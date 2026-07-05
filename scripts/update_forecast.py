#!/usr/bin/env python3
"""Fetch overnight heat-risk forecasts for European cities from Open-Meteo.

Writes data/forecast.json consumed by the static site. Uses only the
Python standard library.

Two API calls per city:
  1. Forecast API  -> best-estimate hourly temperature + relative humidity
  2. Ensemble API  -> ~40 ICON ensemble members, used to put uncertainty
                      ranges on "hours above threshold" per night

"Feels like" is a nighttime Wet Bulb Globe Temperature: with no solar
load the globe temperature ~= air temperature, so
    WBGT_night = 0.7 * T_wetbulb + 0.3 * T_air
with T_wetbulb from the Stull (2011) approximation.

Fail-safe: if a city's fetch fails, its previous entry from the existing
data/forecast.json is kept, so the site never goes blank.
"""

import json
import math
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timedelta, timezone
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
OUT_PATH = REPO_ROOT / "data" / "forecast.json"

FORECAST_API = "https://api.open-meteo.com/v1/forecast"
ENSEMBLE_API = "https://ensemble-api.open-meteo.com/v1/ensemble"

# Overnight window in local time: 21:00 -> 09:00 next morning (12 hours).
NIGHT_START = 21
NIGHT_HOURS = 12

THRESHOLDS = [20, 25]

# Paris + the 10 largest European cities by population (city proper).
CITIES = [
    {"id": "paris", "name": "Paris", "country": "France", "lat": 48.8566, "lon": 2.3522},
    {"id": "istanbul", "name": "Istanbul", "country": "Türkiye", "lat": 41.0082, "lon": 28.9784},
    {"id": "moscow", "name": "Moscow", "country": "Russia", "lat": 55.7558, "lon": 37.6173},
    {"id": "london", "name": "London", "country": "United Kingdom", "lat": 51.5074, "lon": -0.1278},
    {"id": "saint-petersburg", "name": "Saint Petersburg", "country": "Russia", "lat": 59.9311, "lon": 30.3609},
    {"id": "berlin", "name": "Berlin", "country": "Germany", "lat": 52.5200, "lon": 13.4050},
    {"id": "madrid", "name": "Madrid", "country": "Spain", "lat": 40.4168, "lon": -3.7038},
    {"id": "kyiv", "name": "Kyiv", "country": "Ukraine", "lat": 50.4501, "lon": 30.5234},
    {"id": "rome", "name": "Rome", "country": "Italy", "lat": 41.9028, "lon": 12.4964},
    {"id": "bucharest", "name": "Bucharest", "country": "Romania", "lat": 44.4268, "lon": 26.1025},
    {"id": "vienna", "name": "Vienna", "country": "Austria", "lat": 48.2082, "lon": 16.3738},
]


def log(msg):
    print(f"[update_forecast] {msg}", file=sys.stderr)


def fetch_json(url, params, retries=3, timeout=60):
    qs = urllib.parse.urlencode(params)
    full = f"{url}?{qs}"
    last_err = None
    for attempt in range(1, retries + 1):
        try:
            req = urllib.request.Request(full, headers={"User-Agent": "summer-night/1.0"})
            with urllib.request.urlopen(req, timeout=timeout) as resp:
                return json.loads(resp.read().decode("utf-8"))
        except (urllib.error.URLError, TimeoutError, json.JSONDecodeError) as err:
            last_err = err
            log(f"attempt {attempt}/{retries} failed for {url}: {err}")
            time.sleep(2 * attempt)
    raise RuntimeError(f"failed after {retries} attempts: {url}: {last_err}")


def wet_bulb(t, rh):
    """Stull (2011) wet-bulb temperature approximation (deg C, RH in %)."""
    rh = max(rh, 1.0)
    return (
        t * math.atan(0.151977 * math.sqrt(rh + 8.313659))
        + math.atan(t + rh)
        - math.atan(rh - 1.676331)
        + 0.00391838 * rh ** 1.5 * math.atan(0.023101 * rh)
        - 4.686035
    )


def night_wbgt(t, rh):
    """Nighttime WBGT: no solar load, globe temp ~= air temp."""
    return 0.7 * wet_bulb(t, rh) + 0.3 * t


def percentile(sorted_vals, p):
    if not sorted_vals:
        return None
    k = (len(sorted_vals) - 1) * p
    lo, hi = math.floor(k), math.ceil(k)
    if lo == hi:
        return sorted_vals[int(k)]
    return sorted_vals[lo] + (sorted_vals[hi] - sorted_vals[lo]) * (k - lo)


def night_window_indices(times, evening_date):
    """Indices for evening_date 21:00 through next day 08:00 (12 hours)."""
    start = f"{evening_date}T{NIGHT_START:02d}:00"
    try:
        i0 = times.index(start)
    except ValueError:
        return None
    idx = list(range(i0, i0 + NIGHT_HOURS))
    if idx[-1] >= len(times):
        return None
    return idx


def summarize_nights(times, temps, wbgts, ensemble_wbgt, now_local):
    """Build per-night summaries. Nights are labeled by their evening date."""
    today = now_local.date()
    first_evening = today if now_local.hour >= 9 else today - timedelta(days=1)
    nights = []
    for d in range(0, 8):
        evening = first_evening + timedelta(days=d)
        idx = night_window_indices(times, evening.isoformat())
        if idx is None:
            continue
        w = [wbgts[i] for i in idx]
        t = [temps[i] for i in idx]
        if any(v is None for v in w) or any(v is None for v in t):
            continue
        min_i = min(range(len(w)), key=lambda i: w[i])
        night = {
            "date": evening.isoformat(),
            "min_wbgt": round(min(w), 1),
            "min_wbgt_time": times[idx[min_i]][11:16],
            "min_temp": round(min(t), 1),
            "wbgt_curve": [round(v, 1) for v in w],
            "hours_ge": {},
            "all_above": {},
            "ens": {},
        }
        for th in THRESHOLDS:
            night["hours_ge"][str(th)] = sum(1 for v in w if v >= th)
            night["all_above"][str(th)] = bool(min(w) > th)

        # Ensemble spread on hours-above-threshold for this window.
        member_hours = {str(th): [] for th in THRESHOLDS}
        member_all_above = {str(th): 0 for th in THRESHOLDS}
        n_members = 0
        for member in ensemble_wbgt:
            vals = [member[i] if i < len(member) else None for i in idx]
            if any(v is None for v in vals):
                continue
            n_members += 1
            for th in THRESHOLDS:
                member_hours[str(th)].append(sum(1 for v in vals if v >= th))
                if min(vals) > th:
                    member_all_above[str(th)] += 1
        if n_members >= 5:
            for th in THRESHOLDS:
                hrs = sorted(member_hours[str(th)])
                night["ens"][str(th)] = {
                    "members": n_members,
                    "median": round(percentile(hrs, 0.5), 1),
                    "p10": round(percentile(hrs, 0.10), 1),
                    "p90": round(percentile(hrs, 0.90), 1),
                    "prob_all_above": round(member_all_above[str(th)] / n_members, 2),
                }
        nights.append(night)
    return nights


def build_city(city):
    det = fetch_json(FORECAST_API, {
        "latitude": city["lat"],
        "longitude": city["lon"],
        "hourly": "temperature_2m,relative_humidity_2m",
        "forecast_days": 8,
        "past_days": 1,
        "timezone": "auto",
    })
    ens = fetch_json(ENSEMBLE_API, {
        "latitude": city["lat"],
        "longitude": city["lon"],
        "hourly": "temperature_2m,relative_humidity_2m",
        "models": "icon_seamless",
        "forecast_days": 8,
        "past_days": 1,
        "timezone": "auto",
    })

    times = det["hourly"]["time"]
    temps = det["hourly"]["temperature_2m"]
    rhs = det["hourly"]["relative_humidity_2m"]
    wbgts = [
        night_wbgt(t, rh) if t is not None and rh is not None else None
        for t, rh in zip(temps, rhs)
    ]

    # Ensemble: pair temperature/humidity members, compute WBGT per member,
    # then align onto the deterministic time axis.
    ens_hourly = ens["hourly"]
    ens_times = ens_hourly["time"]
    time_map = {ts: i for i, ts in enumerate(ens_times)}
    suffixes = sorted(
        k[len("temperature_2m"):] for k in ens_hourly
        if k.startswith("temperature_2m") and "relative_humidity_2m" + k[len("temperature_2m"):] in ens_hourly
    )
    ensemble_wbgt = []
    for suf in suffixes:
        et = ens_hourly["temperature_2m" + suf]
        er = ens_hourly["relative_humidity_2m" + suf]
        member = []
        for ts in times:
            j = time_map.get(ts)
            if j is None or j >= len(et) or et[j] is None or er[j] is None:
                member.append(None)
            else:
                member.append(night_wbgt(et[j], er[j]))
        ensemble_wbgt.append(member)

    offset = timedelta(seconds=det["utc_offset_seconds"])
    now_local = datetime.now(timezone.utc) + offset

    nights = summarize_nights(times, temps, wbgts, ensemble_wbgt, now_local)
    if not nights:
        raise RuntimeError(f"no complete nights computed for {city['id']}")

    return {
        **city,
        "timezone": det["timezone"],
        "utc_offset_seconds": det["utc_offset_seconds"],
        "hourly": {
            "time": times,
            "temp": [None if v is None else round(v, 1) for v in temps],
            "wbgt": [None if v is None else round(v, 1) for v in wbgts],
        },
        "nights": nights,
        "ensemble_members": len(ensemble_wbgt),
    }


def main():
    previous = {}
    if OUT_PATH.exists():
        try:
            old = json.loads(OUT_PATH.read_text())
            previous = {c["id"]: c for c in old.get("cities", [])}
        except (json.JSONDecodeError, KeyError) as err:
            log(f"could not parse previous data file: {err}")

    cities_out = []
    failures = []
    for city in CITIES:
        try:
            cities_out.append(build_city(city))
            log(f"ok: {city['id']}")
        except Exception as err:  # keep last good data for this city
            failures.append(city["id"])
            log(f"FAILED {city['id']}: {err}")
            if city["id"] in previous:
                stale = dict(previous[city["id"]])
                stale["stale"] = True
                cities_out.append(stale)
                log(f"kept previous data for {city['id']}")

    if not cities_out:
        log("all cities failed and no previous data exists; aborting")
        sys.exit(1)

    out = {
        "generated_utc": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "source": "Open-Meteo (open-meteo.com), ICON ensemble for uncertainty",
        "night_window": {"start_hour": NIGHT_START, "hours": NIGHT_HOURS},
        "thresholds": THRESHOLDS,
        "cities": cities_out,
    }
    OUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    tmp = OUT_PATH.with_suffix(".json.tmp")
    tmp.write_text(json.dumps(out, separators=(",", ":")))
    tmp.replace(OUT_PATH)
    log(f"wrote {OUT_PATH} ({OUT_PATH.stat().st_size // 1024} KB)")
    if failures:
        log(f"completed with failures: {', '.join(failures)}")
        sys.exit(2)


if __name__ == "__main__":
    main()
