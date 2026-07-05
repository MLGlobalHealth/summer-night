#!/usr/bin/env python3
"""Build per-city overnight-heat climatology from ERA5 reanalysis.

Writes data/climatology.json, consumed by the epi site to express tonight's
forecast as a percentile / return period against each city's own history, and
to show a per-year time series of hot nights.

Source: Open-Meteo historical archive API (ERA5), hourly temperature,
relative humidity and 10 m wind, 2005-2024. "Feels like" is the same Steadman
apparent temperature used elsewhere in the project.

This is expensive-ish (one multi-year request per city) and the climate moves
slowly, so run it infrequently (e.g. monthly or on demand), not on the hourly
forecast cron. Standard library only.
"""

import json
import math
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import date, datetime, timedelta
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
OUT_PATH = REPO_ROOT / "data" / "climatology.json"
ARCHIVE_API = "https://archive-api.open-meteo.com/v1/archive"

START_YEAR, END_YEAR = 2005, 2024
WARM_MONTHS = {5, 6, 7, 8, 9}          # evening-date months counted as "summer"
NIGHT_START, NIGHT_HOURS = 21, 12
THRESHOLDS = [20, 25]

# Same city list as the forecast script.
from importlib import import_module  # noqa: E402
sys.path.insert(0, str(REPO_ROOT / "scripts"))
CITIES = import_module("update_forecast").CITIES


def log(msg):
    print(f"[build_climatology] {msg}", file=sys.stderr)


def fetch_json(url, params, retries=3, timeout=120):
    full = f"{url}?{urllib.parse.urlencode(params)}"
    last_err = None
    for attempt in range(1, retries + 1):
        try:
            req = urllib.request.Request(full, headers={"User-Agent": "summer-night/1.0"})
            with urllib.request.urlopen(req, timeout=timeout) as resp:
                return json.loads(resp.read().decode("utf-8"))
        except (urllib.error.URLError, TimeoutError, json.JSONDecodeError) as err:
            last_err = err
            log(f"attempt {attempt}/{retries} failed: {err}")
            time.sleep(20 * attempt)  # back off hard on 429
    raise RuntimeError(f"failed after {retries} attempts: {last_err}")


def apparent_temp(t, rh, ws):
    rh = max(rh, 1.0)
    e = (rh / 100.0) * 6.105 * math.exp(17.27 * t / (237.7 + t))
    return t + 0.33 * e - 0.70 * ws - 4.0


def percentile(sorted_vals, p):
    if not sorted_vals:
        return None
    k = (len(sorted_vals) - 1) * p
    lo, hi = math.floor(k), math.ceil(k)
    if lo == hi:
        return sorted_vals[int(k)]
    return sorted_vals[lo] + (sorted_vals[hi] - sorted_vals[lo]) * (k - lo)


def quantile_table(values, n=101):
    """101-point quantile table (0..100th percentile) for CDF inversion."""
    s = sorted(values)
    return [round(percentile(s, i / (n - 1)), 2) for i in range(n)]


def build_city(city):
    data = fetch_json(ARCHIVE_API, {
        "latitude": city["lat"],
        "longitude": city["lon"],
        "start_date": f"{START_YEAR}-01-01",
        "end_date": f"{END_YEAR}-12-31",
        "hourly": "temperature_2m,relative_humidity_2m,wind_speed_10m",
        "wind_speed_unit": "ms",
        "timezone": "auto",
    })
    h = data["hourly"]
    times, temps, rhs, winds = h["time"], h["temperature_2m"], h["relative_humidity_2m"], h["wind_speed_10m"]
    idx_of = {ts: i for i, ts in enumerate(times)}

    min_feels, hours20, hours25 = [], [], []
    per_year = {}  # year -> counts
    d = date(START_YEAR, 1, 1)
    last = date(END_YEAR, 12, 31)
    while d <= last:
        if d.month in WARM_MONTHS:
            start_ts = f"{d.isoformat()}T{NIGHT_START:02d}:00"
            i0 = idx_of.get(start_ts)
            if i0 is not None and i0 + NIGHT_HOURS <= len(times):
                window = []
                ok = True
                for i in range(i0, i0 + NIGHT_HOURS):
                    t, rh, ws = temps[i], rhs[i], winds[i]
                    if None in (t, rh, ws):
                        ok = False
                        break
                    window.append(apparent_temp(t, rh, ws))
                if ok:
                    mn = min(window)
                    min_feels.append(mn)
                    h20 = sum(1 for v in window if v >= 20)
                    h25 = sum(1 for v in window if v >= 25)
                    hours20.append(h20)
                    hours25.append(h25)
                    y = per_year.setdefault(d.year, {"nights": 0, "tn20": 0, "tn25": 0, "sum_min": 0.0})
                    y["nights"] += 1
                    y["sum_min"] += mn
                    if mn >= 20:
                        y["tn20"] += 1   # "tropical night" by feels-like min
                    if mn >= 25:
                        y["tn25"] += 1
        d += timedelta(days=1)

    if len(min_feels) < 500:
        raise RuntimeError(f"too few climatology nights for {city['id']}: {len(min_feels)}")

    yearly = [
        {
            "year": y,
            "nights": per_year[y]["nights"],
            "tropical_nights_20": per_year[y]["tn20"],
            "nights_25": per_year[y]["tn25"],
            "mean_summer_min_feels": round(per_year[y]["sum_min"] / per_year[y]["nights"], 1),
        }
        for y in sorted(per_year)
    ]

    s = sorted(min_feels)
    return {
        "id": city["id"],
        "name": city["name"],
        "country": city["country"],
        "n_nights": len(min_feels),
        "min_feels_q": quantile_table(min_feels),
        "hours_ge_q": {str(th): quantile_table(hrs) for th, hrs in ((20, hours20), (25, hours25))},
        "stats": {
            "median_min_feels": round(percentile(s, 0.5), 1),
            "p90_min_feels": round(percentile(s, 0.90), 1),
            "p98_min_feels": round(percentile(s, 0.98), 1),
            "p99_min_feels": round(percentile(s, 0.99), 1),
            "max_min_feels": round(s[-1], 1),
            "mean_tropical_nights_20": round(sum(y["tropical_nights_20"] for y in yearly) / len(yearly), 1),
        },
        "yearly": yearly,
    }


def main():
    force = "--force" in sys.argv
    previous = {}
    if OUT_PATH.exists() and not force:
        try:
            previous = {c["id"]: c for c in json.loads(OUT_PATH.read_text()).get("cities", [])}
        except (json.JSONDecodeError, KeyError):
            pass

    by_id = dict(previous)
    failures = []
    for city in CITIES:
        if city["id"] in by_id and not force:
            log(f"skip (already present): {city['id']}")
            continue
        try:
            by_id[city["id"]] = build_city(city)
            log(f"ok: {city['id']} ({by_id[city['id']]['n_nights']} nights)")
            time.sleep(8)  # heavy archive requests: pace to avoid HTTP 429
        except Exception as err:
            failures.append(city["id"])
            log(f"FAILED {city['id']}: {err}")
            time.sleep(20)

    cities = [by_id[c["id"]] for c in CITIES if c["id"] in by_id]
    if not cities:
        log("all cities failed; aborting")
        sys.exit(1)

    out = {
        "generated_utc": datetime.utcnow().strftime("%Y-%m-%dT%H:%M:%SZ"),
        "source": "Open-Meteo historical archive (ERA5 reanalysis)",
        "baseline_period": f"{START_YEAR}-{END_YEAR}",
        "warm_season_months": sorted(WARM_MONTHS),
        "night_window": {"start_hour": NIGHT_START, "hours": NIGHT_HOURS},
        "thresholds": THRESHOLDS,
        "note": "Percentiles are over warm-season (May-Sep) overnight windows only.",
        "cities": cities,
    }
    OUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    OUT_PATH.write_text(json.dumps(out, separators=(",", ":")))
    log(f"wrote {OUT_PATH} ({OUT_PATH.stat().st_size // 1024} KB)")
    if failures:
        log(f"completed with failures: {', '.join(failures)}")
        sys.exit(2)


if __name__ == "__main__":
    main()
