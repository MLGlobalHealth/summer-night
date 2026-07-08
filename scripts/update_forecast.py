#!/usr/bin/env python3
"""Fetch overnight heat-risk forecasts for European cities from Open-Meteo.

Writes data/forecast.json consumed by the static site. Uses only the
Python standard library.

Two API calls per city:
  1. Forecast API  -> best-estimate hourly temperature, humidity, wind
  2. Ensemble API  -> ~40 ICON ensemble members, used to put uncertainty
                      ranges on "hours above threshold" per night

"Feels like" is the Steadman **apparent temperature** (the Australian BoM
shade formulation):
    AT = Ta + 0.33*e - 0.70*ws - 4.0
with vapour pressure e from air temperature and relative humidity and ws
the 10 m wind speed (m/s). The shade formula has no solar-radiation term,
which makes it the right choice overnight. A 2026 literature review found
that for temperate-European heat mortality, apparent temperature is the
humidity-inclusive index that actually adds value (WBGT/wet-bulb do not);
for sleep it tracks the continuous degradation of sleep with warmth.

Two outcomes are summarised per night:
  - comfort/sleep : hours the feels-like stays >= 20 C / >= 25 C
  - mortality     : "no overnight relief" nights (feels-like minimum never
                    drops below 20 C), whose *consecutive runs* the front
                    end turns into an elderly-mortality signal, following
                    the Paris-2003 and 2025 compound-heat findings that
                    multi-day lack of nighttime recovery drives deaths.

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
from datetime import date, datetime, time, timedelta, timezone
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
OUT_PATH = REPO_ROOT / "data" / "forecast.json"
SKILL_PATH = REPO_ROOT / "data" / "skill.json"

FORECAST_API = "https://api.open-meteo.com/v1/forecast"
ENSEMBLE_API = "https://ensemble-api.open-meteo.com/v1/ensemble"

# Overnight window in local time: 21:00 -> 09:00 next morning (12 hours).
NIGHT_START = 21
NIGHT_HOURS = 12
# How many already-elapsed nights to show as "observed" before tonight.
PAST_NIGHTS = 2

# Absolute feels-like thresholds (deg C apparent temperature).
THRESHOLDS = [20, 25]
# A night gives "no overnight relief" (mortality-relevant) if the feels-like
# minimum never drops below this - the body gets no cool recovery window.
RELIEF_FLOOR = 20

# A selection of European cities (capitals + a few others of interest).
CITIES = [
    {"id": "paris", "name": "Paris", "country": "France", "lat": 48.8566, "lon": 2.3522},
    {"id": "istanbul", "name": "Istanbul", "country": "Türkiye", "lat": 41.0082, "lon": 28.9784},
    {"id": "moscow", "name": "Moscow", "country": "Russia", "lat": 55.7558, "lon": 37.6173},
    {"id": "london", "name": "London", "country": "United Kingdom", "lat": 51.5074, "lon": -0.1278},
    {"id": "oxford", "name": "Oxford", "country": "United Kingdom", "lat": 51.7520, "lon": -1.2577},
    {"id": "berlin", "name": "Berlin", "country": "Germany", "lat": 52.5200, "lon": 13.4050},
    {"id": "kaiserslautern", "name": "Kaiserslautern", "country": "Germany", "lat": 49.4401, "lon": 7.7491},
    {"id": "madrid", "name": "Madrid", "country": "Spain", "lat": 40.4168, "lon": -3.7038},
    {"id": "kyiv", "name": "Kyiv", "country": "Ukraine", "lat": 50.4501, "lon": 30.5234},
    {"id": "rome", "name": "Rome", "country": "Italy", "lat": 41.9028, "lon": 12.4964},
    {"id": "bucharest", "name": "Bucharest", "country": "Romania", "lat": 44.4268, "lon": 26.1025},
    {"id": "vienna", "name": "Vienna", "country": "Austria", "lat": 48.2082, "lon": 16.3738},
    {"id": "bratislava", "name": "Bratislava", "country": "Slovakia", "lat": 48.1486, "lon": 17.1077},
    {"id": "copenhagen", "name": "Copenhagen", "country": "Denmark", "lat": 55.6761, "lon": 12.5683},
    {"id": "athens", "name": "Athens", "country": "Greece", "lat": 37.9838, "lon": 23.7275},
    {"id": "marseille", "name": "Marseille", "country": "France", "lat": 43.2965, "lon": 5.3698},
    {"id": "tbilisi", "name": "Tbilisi", "country": "Georgia", "lat": 41.7151, "lon": 44.8271},
    {"id": "edinburgh", "name": "Edinburgh", "country": "United Kingdom", "lat": 55.9533, "lon": -3.1883},
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


def apparent_temp(t, rh, ws):
    """Steadman (BoM shade) apparent temperature. t in C, rh in %, ws in m/s.

    No solar term, so it is appropriate overnight. Vapour pressure from the
    August-Roche-Magnus saturation formula scaled by relative humidity.
    """
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


def hourly_ensemble_stats(ensemble_feels, n_hours):
    """Per-hour median and 10th/90th percentile of feels-like across members."""
    med, p10, p90 = [None] * n_hours, [None] * n_hours, [None] * n_hours
    for i in range(n_hours):
        vals = sorted(m[i] for m in ensemble_feels if i < len(m) and m[i] is not None)
        if len(vals) >= 5:
            med[i] = round(percentile(vals, 0.50), 1)
            p10[i] = round(percentile(vals, 0.10), 1)
            p90[i] = round(percentile(vals, 0.90), 1)
    return med, p10, p90


def summarize_nights(times, temps, feels, feels_med, ensemble_feels, now_local):
    """Build per-night summaries. Nights are labeled by their evening date.

    Includes the two most recent (already-elapsed) nights as *observed*, then
    tonight and the forecast week. Forecast nights are summarised from the
    ensemble-MEDIAN curve (so the table ties to the plotted median line);
    observed / part-observed nights use the actuals and carry no ensemble spread.
    """
    today = now_local.date()
    now_naive = now_local.replace(tzinfo=None)
    tonight_evening = today if now_local.hour >= 9 else today - timedelta(days=1)
    nights = []
    for d in range(-PAST_NIGHTS, 8):
        evening = tonight_evening + timedelta(days=d)
        idx = night_window_indices(times, evening.isoformat())
        if idx is None:
            continue
        w_det = [feels[i] for i in idx]
        t = [temps[i] for i in idx]
        if any(v is None for v in w_det) or any(v is None for v in t):
            continue
        # State of the 21:00 -> 09:00 window relative to "now":
        #   observed      = window fully elapsed (actuals)
        #   part_observed = window in progress (early hours actual, rest forecast)
        #   forecast      = window not yet begun
        window_start = datetime.combine(evening, time(NIGHT_START))
        window_end = window_start + timedelta(hours=NIGHT_HOURS)
        if now_naive >= window_end:
            state = "observed"
        elif now_naive <= window_start:
            state = "forecast"
        else:
            state = "part_observed"
        # Forecast nights summarise the ensemble-median curve; observed/part use actuals.
        w_med = [feels_med[i] for i in idx]
        w = w_med if state == "forecast" and all(v is not None for v in w_med) else w_det
        min_i = min(range(len(w)), key=lambda i: w[i])
        min_feels = min(w)
        min_dt = datetime.fromisoformat(times[idx[min_i]])
        night = {
            "date": evening.isoformat(),
            "observed": state == "observed",
            "part_observed": state == "part_observed",
            "min_feels": round(min_feels, 1),
            "min_feels_time": times[idx[min_i]][11:16],
            "min_observed": bool(min_dt <= now_naive),
            "min_temp": round(min(t), 1),
            "feels_curve": [round(v, 1) for v in w],
            "hours_ge": {},
            "all_above": {},
            # Mortality-relevant: coolest point never drops below the floor,
            # so there is no overnight recovery window.
            "no_relief": bool(min_feels >= RELIEF_FLOOR),
            "ens": {},
        }
        for th in THRESHOLDS:
            night["hours_ge"][str(th)] = sum(1 for v in w if v >= th)
            night["all_above"][str(th)] = bool(min_feels > th)

        if state != "forecast":
            nights.append(night)
            continue  # observed / part-observed nights carry no ensemble spread

        # Ensemble spread on hours-above-threshold and no-relief probability.
        member_hours = {str(th): [] for th in THRESHOLDS}
        member_all_above = {str(th): 0 for th in THRESHOLDS}
        member_no_relief = 0
        n_members = 0
        for member in ensemble_feels:
            vals = [member[i] if i < len(member) else None for i in idx]
            if any(v is None for v in vals):
                continue
            n_members += 1
            m_min = min(vals)
            if m_min >= RELIEF_FLOOR:
                member_no_relief += 1
            for th in THRESHOLDS:
                member_hours[str(th)].append(sum(1 for v in vals if v >= th))
                if m_min > th:
                    member_all_above[str(th)] += 1
        if n_members >= 5:
            night["prob_no_relief"] = round(member_no_relief / n_members, 2)
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
    hourly_vars = "temperature_2m,relative_humidity_2m,wind_speed_10m"
    det = fetch_json(FORECAST_API, {
        "latitude": city["lat"],
        "longitude": city["lon"],
        "hourly": hourly_vars,
        "wind_speed_unit": "ms",
        "forecast_days": 8,
        "past_days": PAST_NIGHTS + 1,  # cover the observed overnight windows
        "timezone": "auto",
    })
    ens = fetch_json(ENSEMBLE_API, {
        "latitude": city["lat"],
        "longitude": city["lon"],
        "hourly": hourly_vars,
        "wind_speed_unit": "ms",
        "models": "icon_seamless",
        "forecast_days": 8,
        "past_days": 1,
        "timezone": "auto",
    })

    times = det["hourly"]["time"]
    temps = det["hourly"]["temperature_2m"]
    rhs = det["hourly"]["relative_humidity_2m"]
    winds = det["hourly"]["wind_speed_10m"]
    feels = [
        apparent_temp(t, rh, ws) if None not in (t, rh, ws) else None
        for t, rh, ws in zip(temps, rhs, winds)
    ]

    # Ensemble: pair temperature / humidity / wind members, compute apparent
    # temperature per member, then align onto the deterministic time axis.
    ens_hourly = ens["hourly"]
    ens_times = ens_hourly["time"]
    time_map = {ts: i for i, ts in enumerate(ens_times)}
    suffixes = sorted(
        k[len("temperature_2m"):] for k in ens_hourly
        if k.startswith("temperature_2m")
        and "relative_humidity_2m" + k[len("temperature_2m"):] in ens_hourly
        and "wind_speed_10m" + k[len("temperature_2m"):] in ens_hourly
    )
    ensemble_feels = []
    for suf in suffixes:
        et = ens_hourly["temperature_2m" + suf]
        er = ens_hourly["relative_humidity_2m" + suf]
        ew = ens_hourly["wind_speed_10m" + suf]
        member = []
        for ts in times:
            j = time_map.get(ts)
            if j is None or j >= len(et) or None in (et[j], er[j], ew[j]):
                member.append(None)
            else:
                member.append(apparent_temp(et[j], er[j], ew[j]))
        ensemble_feels.append(member)

    feels_med, feels_p10, feels_p90 = hourly_ensemble_stats(ensemble_feels, len(times))

    offset = timedelta(seconds=det["utc_offset_seconds"])
    now_local = datetime.now(timezone.utc) + offset

    nights = summarize_nights(times, temps, feels, feels_med, ensemble_feels, now_local)
    if not nights:
        raise RuntimeError(f"no complete nights computed for {city['id']}")

    # Longest run of consecutive no-relief nights within the forecast window.
    max_run = cur = 0
    for n in nights:
        cur = cur + 1 if n["no_relief"] else 0
        max_run = max(max_run, cur)

    return {
        **city,
        "timezone": det["timezone"],
        "utc_offset_seconds": det["utc_offset_seconds"],
        "hourly": {
            "time": times,
            "temp": [None if v is None else round(v, 1) for v in temps],
            "feels": [None if v is None else round(v, 1) for v in feels],
            "feels_med": feels_med,   # ensemble median (null where <5 members / past)
            "feels_p10": feels_p10,   # 10th percentile band edge
            "feels_p90": feels_p90,   # 90th percentile band edge
        },
        "nights": nights,
        "max_no_relief_run": max_run,
        "ensemble_members": len(ensemble_feels),
    }


def update_skill(cities_out, now_utc):
    """Accumulate a forecast-vs-observed log for hours >= 20/25 per night.

    For each night we record the forecast at each lead time (days ahead) and,
    once the night has fully elapsed, the observed value. Comparing the two over
    time measures forecast skill. Grows across runs; pruned to ~30 days.
    """
    try:
        skill = json.loads(SKILL_PATH.read_text()) if SKILL_PATH.exists() else {}
    except json.JSONDecodeError:
        skill = {}
    skill.setdefault("cities", {})

    for city in cities_out:
        if city.get("stale"):
            continue
        cid = city["id"]
        city_today = (now_utc + timedelta(seconds=city["utc_offset_seconds"])).date()
        entry = skill["cities"].setdefault(cid, {"nights": {}})
        entry["name"], entry["country"] = city["name"], city["country"]
        entry.setdefault("nights", {})
        for n in city["nights"]:
            pair = {"h20": n["hours_ge"]["20"], "h25": n["hours_ge"]["25"]}
            rec = entry["nights"].setdefault(n["date"], {"forecasts": {}, "observed": None})
            if n["observed"]:
                rec["observed"] = pair
            elif not n.get("part_observed"):
                lead = (date.fromisoformat(n["date"]) - city_today).days
                if 0 <= lead <= 7:
                    rec["forecasts"][str(lead)] = pair
        cutoff = (city_today - timedelta(days=30)).isoformat()
        entry["nights"] = {k: v for k, v in entry["nights"].items() if k >= cutoff}

    skill["generated_utc"] = now_utc.strftime("%Y-%m-%dT%H:%M:%SZ")
    skill["thresholds"] = THRESHOLDS
    tmp = SKILL_PATH.with_suffix(".json.tmp")
    tmp.write_text(json.dumps(skill, separators=(",", ":")))
    tmp.replace(SKILL_PATH)
    log(f"wrote {SKILL_PATH} ({SKILL_PATH.stat().st_size // 1024} KB)")


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
        "index": "apparent_temperature",
        "night_window": {"start_hour": NIGHT_START, "hours": NIGHT_HOURS},
        "thresholds": THRESHOLDS,
        "relief_floor": RELIEF_FLOOR,
        "cities": cities_out,
    }
    OUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    tmp = OUT_PATH.with_suffix(".json.tmp")
    tmp.write_text(json.dumps(out, separators=(",", ":")))
    tmp.replace(OUT_PATH)
    log(f"wrote {OUT_PATH} ({OUT_PATH.stat().st_size // 1024} KB)")

    try:
        update_skill(cities_out, datetime.now(timezone.utc))
    except Exception as err:
        log(f"skill log update failed (non-fatal): {err}")

    if failures:
        log(f"completed with failures: {', '.join(failures)}")
        sys.exit(2)


if __name__ == "__main__":
    main()
