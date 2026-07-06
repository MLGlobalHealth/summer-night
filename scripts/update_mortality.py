#!/usr/bin/env python3
"""Fetch historical weekly all-cause mortality and compute summer excess.

Writes data/mortality.json, consumed by the epi site to show each country's
history of hot-season excess mortality (the 2003, 2015, 2022, 2023 heat summers
stand out). Standard library only.

Source: Eurostat "Deaths by week and sex" (demo_r_mwk_ts), national level,
2000-present, open API, no key.

Method (deliberately simple and transparent, NOT the official EuroMOMO model):
  expected[year, week] = mean deaths in the same ISO week over the 5 preceding
                         years (>=3 required); a trailing baseline so it tracks
                         the slow rise in deaths as populations age.
  excess  = observed - expected
  P-score = 100 * excess / expected
Summer = ISO weeks 22-36 (~early June to early September).

This is COUNTRY-LEVEL, ALL-CAUSE excess mortality: summer spikes often coincide
with heatwaves but are not heat-attributed. Russia, Ukraine and (some years)
non-EU states are not in Eurostat and are omitted.
"""

import json
import sys
import time
import urllib.error
import urllib.request
from datetime import datetime
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
OUT_PATH = REPO_ROOT / "data" / "mortality.json"
EUROSTAT = ("https://ec.europa.eu/eurostat/api/dissemination/statistics/1.0/data/"
            "demo_r_mwk_ts?format=JSON&sex=T&lang=EN&geo=")

SUMMER_WEEKS = range(22, 37)
BASELINE_YEARS = 5
MIN_BASELINE = 3

# Eurostat geo code per country, and which of our cities map to it.
COUNTRIES = [
    {"geo": "FR", "country": "France", "cities": ["paris"]},
    {"geo": "DE", "country": "Germany", "cities": ["berlin"]},
    {"geo": "ES", "country": "Spain", "cities": ["madrid"]},
    {"geo": "IT", "country": "Italy", "cities": ["rome"]},
    {"geo": "RO", "country": "Romania", "cities": ["bucharest"]},
    {"geo": "AT", "country": "Austria", "cities": ["vienna"]},
    {"geo": "UK", "country": "United Kingdom", "cities": ["london"]},
    {"geo": "TR", "country": "Türkiye", "cities": ["istanbul"]},
    {"geo": "SK", "country": "Slovakia", "cities": ["bratislava"]},
]
# Cities with no Eurostat coverage (shown as "no data" on the site).
UNCOVERED = {"moscow": "Russia", "saint-petersburg": "Russia", "kyiv": "Ukraine"}


def log(msg):
    print(f"[update_mortality] {msg}", file=sys.stderr)


def fetch_weekly_deaths(geo):
    url = EUROSTAT + geo
    last_err = None
    for attempt in range(1, 4):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": "summer-night/1.0"})
            with urllib.request.urlopen(req, timeout=90) as resp:
                data = json.loads(resp.read().decode("utf-8"))
            break
        except (urllib.error.URLError, TimeoutError, json.JSONDecodeError) as err:
            last_err = err
            log(f"  attempt {attempt}/3 failed for {geo}: {err}")
            time.sleep(3 * attempt)
    else:
        raise RuntimeError(f"fetch failed for {geo}: {last_err}")

    index = data["dimension"]["time"]["category"]["index"]  # "2003-W01" -> pos
    values = data["value"]                                  # "pos" -> deaths
    weekly = {}
    for label, pos in index.items():
        v = values.get(str(pos))
        if v is None or "-W" not in label:
            continue
        y, w = label.split("-W")
        try:
            weekly[(int(y), int(w))] = float(v)
        except ValueError:
            continue
    return weekly


def summer_excess(weekly):
    years = sorted({y for (y, _w) in weekly})
    out = []
    for y in years:
        obs_sum = exp_sum = 0.0
        n_weeks = 0
        peak = None
        for w in SUMMER_WEEKS:
            obs = weekly.get((y, w))
            if obs is None:
                continue
            base = [weekly[(y - k, w)] for k in range(1, BASELINE_YEARS + 1) if (y - k, w) in weekly]
            if len(base) < MIN_BASELINE:
                continue
            exp = sum(base) / len(base)
            if exp <= 0:
                continue
            obs_sum += obs
            exp_sum += exp
            n_weeks += 1
            ps = 100 * (obs - exp) / exp
            if peak is None or ps > peak["pscore"]:
                peak = {"week": w, "pscore": round(ps, 1)}
        if n_weeks >= 8 and exp_sum > 0:
            out.append({
                "year": y,
                "excess": round(obs_sum - exp_sum),
                "pscore": round(100 * (obs_sum - exp_sum) / exp_sum, 1),
                "peak": peak,
                "weeks": n_weeks,
            })
    return out


def main():
    countries = []
    failures = []
    for c in COUNTRIES:
        try:
            weekly = fetch_weekly_deaths(c["geo"])
            yearly = summer_excess(weekly)
            if not yearly:
                raise RuntimeError("no summer excess computed")
            countries.append({**c, "yearly": yearly,
                              "years": [yearly[0]["year"], yearly[-1]["year"]]})
            log(f"ok: {c['country']} ({len(yearly)} summers, {yearly[0]['year']}-{yearly[-1]['year']})")
            time.sleep(1)
        except Exception as err:
            failures.append(c["geo"])
            log(f"FAILED {c['country']}: {err}")

    if not countries:
        log("all countries failed; aborting")
        sys.exit(1)

    out = {
        "generated_utc": datetime.utcnow().strftime("%Y-%m-%dT%H:%M:%SZ"),
        "source": "Eurostat demo_r_mwk_ts (deaths by week), national level",
        "method": ("Summer = ISO weeks 22-36. Expected = mean of same ISO week over the "
                   "prior 5 years (>=3 required). Excess = observed - expected; "
                   "P-score = 100*excess/expected. Country-level, all-cause, NOT heat-attributed."),
        "summer_weeks": [SUMMER_WEEKS.start, SUMMER_WEEKS.stop - 1],
        "countries": countries,
        "uncovered": UNCOVERED,
    }
    OUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    OUT_PATH.write_text(json.dumps(out, separators=(",", ":")))
    log(f"wrote {OUT_PATH} ({OUT_PATH.stat().st_size // 1024} KB)")
    if failures:
        log(f"completed with failures: {', '.join(failures)}")
        sys.exit(2)


if __name__ == "__main__":
    main()
