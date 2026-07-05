# Research notes: choosing the index, thresholds and metrics

These notes summarise the literature review that shaped the site's methodology
(overnight heat and health, temperate-European context). Claims below were each
cross-checked against multiple primary sources.

## 1. Index: apparent temperature, not WBGT

- There is **no universal best heat-stress metric**, and for heat **mortality** in
  temperate Europe **plain air temperature predicts about as well as any
  humidity-inclusive index**. Adding humidity or switching to WBGT/wet-bulb yields
  little improvement.
  - Lo et al. 2023 (*Int. J. Climatology*), 604 locations / 39 countries: dry-bulb
    best in ~40% of countries, **apparent temperature best in ~40% (dominant in N/E
    Europe)**, wet-bulb optimal only in a few tropical countries.
  - Armstrong et al. 2019 (*EHP*), 445 cities / 24 countries: adding humidity did not
    substantially improve mortality prediction; apparent temperature did not beat
    temperature.
  - Urban & Kyselý 2014 (Czech cardiovascular mortality): air temperature, UTCI, PET
    and apparent temperature gave similar heat effects.
- **WBGT** is designed for **daytime, in-the-sun physical exertion** and is not the
  validated choice for overnight sleep or temperate mortality.
- Choosing a single humidity index purely by mortality regression is **fragile**:
  different indices disagree even on the *sign* of humidity's effect (Simpson et al.
  2023, *npj Clim. Atmos. Sci.*).

**Decision:** use **Steadman apparent temperature (shade formula)** — the one
humidity-inclusive index with support in temperate Europe, with no solar term (right
for night). Air temperature is shown alongside it.

## 2. Two outcomes, two metrics

### Sleep / comfort — continuous, single-night
- The dose-response of night temperature on sleep is **continuous / monotonic**, not
  a sharp threshold (systematic review of 36 studies, *Sleep Medicine Reviews* 2024;
  Minor et al., ~7M accelerometer-nights / 68 countries).
- Indoor bedroom evidence: sleep is most efficient at **20–25 °C**, with a 5–10%
  sleep-efficiency drop from 25 °C to 30 °C (Baniassadi et al. 2023, elderly cohort).
- The UK's static **26 °C** bedroom overheating threshold derives from a 1975 study of
  21 adults and is acknowledged as outdated.

**Decision:** keep a per-night value with **20 °C / 25 °C as labelled benchmarks on a
continuous scale**, not a hard safe/dangerous switch.

### Vulnerable-group mortality — multi-night, non-recovery
- Paris 2003 case-control (Laaidi/Vandentorren, 241 elderly deaths): significant
  predictors were **multi-day average *minimum* (night) temperature**; daytime
  temperature was not significant (OR ≈ 2.2 for the hottest multi-day night exposure).
- 2025 *Nature Communications* (34 European countries, elderly): **consecutive
  day-night "compound" heat extremes carried >2× the mortality risk** of daytime-only
  extremes of equal duration — i.e. lack of nighttime cooling is the driver. It uses
  a health-risk-based, **location-specific** Humidex threshold (≈98th percentile).

**Decision:** flag **runs of consecutive "no overnight relief" nights** (feels-like
minimum never dropping below 20 °C). This is the multi-day non-recovery signal the
literature supports, communicated simply.

## 3. Thresholds: absolute vs relative

- State-of-the-art mortality thresholds are **relative / percentile-based and
  location-specific**, because temperate populations acclimatize.
- We use **absolute** 20/25 °C for readability across cities. Moving the mortality
  flag to a **per-city percentile** is the most defensible future refinement.

## 4. Quantity of interest

- **"Hours above X"** is communicable but is *not* the specifically validated quantity;
  the validated quantities are nightly minimum, multi-day average minimum, and
  consecutive-night counts. We keep hours-above-X as a readable summary and add the
  consecutive-night / no-relief metric for mortality.

## 5. Key caveat: indoor vs outdoor

- Nearly all threshold evidence is **indoor bedroom** temperature; the site uses
  **outdoor** forecasts. Non-AC bedrooms often run warmer and cool more slowly, so
  outdoor feels-like is a proxy that may **understate** the exposure that drives sleep
  loss and mortality. This is stated prominently on the site.

## Primary sources

- Lo et al. 2023, *Int. J. Climatology* — https://rmets.onlinelibrary.wiley.com/doi/10.1002/joc.8160
- Armstrong et al. 2019, *EHP* — https://ehp.niehs.nih.gov/doi/full/10.1289/EHP5430
- Urban & Kyselý 2014 — https://www.ncbi.nlm.nih.gov/pmc/articles/PMC3924484/
- Simpson et al. 2023, *npj Clim. Atmos. Sci.* — https://www.nature.com/articles/s41612-023-00408-0
- Laaidi/Vandentorren, Paris 2003 — https://pmc.ncbi.nlm.nih.gov/articles/PMC3279432/
- Compound day-night heat, 2025, *Nature Communications* — https://www.nature.com/articles/s41467-025-62871-y
- Sleep & temperature systematic review 2024 — https://www.medrxiv.org/content/10.1101/2023.03.28.23287841v2.full
- Baniassadi et al. 2023, bedroom temperature & sleep — https://pmc.ncbi.nlm.nih.gov/articles/PMC10529213/
