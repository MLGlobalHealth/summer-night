/* Summer Night · Epi — joins forecast + climatology + mortality. No deps. */
(function () {
  "use strict";

  const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun",
                  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

  let FC = null, CLIMO = null, MORT = null;

  function parseLocal(iso) { return Date.parse(iso + (iso.length === 16 ? ":00Z" : "Z")); }
  function nightLabel(d) {
    const x = new Date(parseLocal(d + "T12:00"));
    return `${DAYS[x.getUTCDay()]} ${x.getUTCDate()} ${MONTHS[x.getUTCMonth()]}`;
  }
  // Unambiguous span: evening (21:00) into the next morning (09:00).
  function nightSpan(d) {
    const a = new Date(parseLocal(d + "T12:00")), b = new Date(parseLocal(d + "T12:00") + 86400e3);
    const aMo = a.getUTCMonth() === b.getUTCMonth() ? "" : " " + MONTHS[a.getUTCMonth()];
    return `${DAYS[a.getUTCDay()]} ${a.getUTCDate()}${aMo} → ${DAYS[b.getUTCDay()]} ${b.getUTCDate()} ${MONTHS[b.getUTCMonth()]}`;
  }
  function esc(s) {
    return String(s).replace(/[&<>"]/g, c =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  }

  /* percentile of value x within a 101-point ascending quantile table */
  function pctOf(qtable, x) {
    const n = qtable.length;              // 101 -> percentile == index
    if (x <= qtable[0]) return 0;
    if (x >= qtable[n - 1]) return 100;
    for (let i = 0; i < n - 1; i++) {
      if (x <= qtable[i + 1]) {
        const span = qtable[i + 1] - qtable[i] || 1;
        return ((i + (x - qtable[i]) / span) / (n - 1)) * 100;
      }
    }
    return 100;
  }
  function pctClass(p) { return p >= 95 ? "pctl-hi" : p >= 80 ? "pctl-mid" : "pctl-lo"; }
  function rarity(p) {
    if (p >= 99.5) return "top 0.5%";
    const n = Math.round(1 / (1 - p / 100));
    if (n < 2) return "typical";
    return `~1 in ${n}`;
  }

  function longestRelief(nights) {
    let best = { len: 0 }, cur = 0, start = 0;
    for (let i = 0; i < nights.length; i++) {
      if (nights[i].no_relief) {
        if (cur === 0) start = i;
        cur++;
        if (cur > best.len) best = { len: cur, from: nights[start].date, to: nights[i].date };
      } else cur = 0;
    }
    return best;
  }
  const hrs = n => `${n} hour${n === 1 ? "" : "s"}`;

  function obsTag(n) {
    if (n.observed) return ' <span class="obs-tag">observed</span>';
    if (n.part_observed) return ' <span class="obs-tag part">part observed</span>';
    return "";
  }

  function fmtHours(n, th) {
    const e = n.ens && n.ens[String(th)];
    if (!e) return hrs(n.hours_ge[String(th)]);
    const lo = Math.round(e.p10), hi = Math.round(e.p90);
    const sub = lo === hi ? "" : `<span class="sub range">${lo}–${hi} hrs</span>`;
    return `<span class="big">${hrs(Math.round(e.median))}</span>` + sub;
  }

  /* ---------- generic yearly bar chart ---------- */
  function barChart(series, opts) {
    // series: [{label, value, hi?}]; opts: {avg, unit, neg}
    const W = 430, H = 210, M = { l: 38, r: 8, t: 12, b: 40 };
    if (!series.length) return '<p class="nodata">No data.</p>';
    const vals = series.map(s => s.value);
    let lo = Math.min(0, ...vals), hi = Math.max(...vals, opts.avg || 0);
    hi = hi * 1.1 || 1; if (lo < 0) lo = lo * 1.1;
    const x = i => M.l + (i + 0.5) / series.length * (W - M.l - M.r);
    const bw = (W - M.l - M.r) / series.length * 0.7;
    const y = v => M.t + (1 - (v - lo) / (hi - lo)) * (H - M.t - M.b);
    let s = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="yearly chart">`;
    // zero / gridline
    s += `<line x1="${M.l}" x2="${W - M.r}" y1="${y(0)}" y2="${y(0)}" stroke="var(--line)" stroke-width="1"/>`;
    if (opts.avg != null) {
      s += `<line x1="${M.l}" x2="${W - M.r}" y1="${y(opts.avg)}" y2="${y(opts.avg)}" stroke="var(--accent)" stroke-width="1" stroke-dasharray="4 3" opacity="0.8"/>`;
      s += `<text x="${W - M.r}" y="${y(opts.avg) - 3}" text-anchor="end" fill="var(--accent)" font-size="10">avg ${opts.avg}${opts.unit || ""}</text>`;
    }
    series.forEach((d, i) => {
      const col = d.hi ? "var(--danger)" : d.value < 0 ? "var(--muted)" : "var(--warn)";
      const yy = y(Math.max(d.value, 0)), h0 = Math.abs(y(d.value) - y(0));
      s += `<rect x="${(x(i) - bw / 2).toFixed(1)}" y="${yy.toFixed(1)}" width="${bw.toFixed(1)}" height="${Math.max(h0, 0.5).toFixed(1)}" fill="${col}"><title>${esc(d.label)}: ${d.value}${opts.unit || ""}</title></rect>`;
      const step = series.length > 24 ? 5 : series.length > 14 ? 2 : 1;
      if (i % step === 0) {
        s += `<text x="${x(i).toFixed(1)}" y="${H - 24}" text-anchor="middle" fill="var(--muted)" font-size="9" transform="rotate(45 ${x(i).toFixed(1)} ${H - 24})">${esc(d.label)}</text>`;
      }
    });
    // y labels
    s += `<text x="${M.l - 6}" y="${y(hi) + 4}" text-anchor="end" fill="var(--muted)" font-size="10">${Math.round(hi)}</text>`;
    s += `<text x="${M.l - 6}" y="${y(0) + 4}" text-anchor="end" fill="var(--muted)" font-size="10">0</text>`;
    return s + "</svg>";
  }

  /* ---------- render a city ---------- */
  function renderCity(id, scroll) {
    const city = FC.cities.find(c => c.id === id);
    if (!city) return;
    const climo = CLIMO && CLIMO.cities.find(c => c.id === id);
    if (("#" + id) !== location.hash) history.replaceState(null, "", "#" + id);
    if (scroll) document.getElementById("cityPanel").scrollIntoView({ behavior: "smooth", block: "start" });
    document.getElementById("cityName").textContent = `${city.name}, ${city.country}`;
    document.getElementById("climoName").textContent = city.name;

    /* Mortality banner (consecutive no-relief), with climatology context */
    const run = longestRelief(city.nights);
    const mort = document.getElementById("mortality");
    let lvl = "", msg;
    const ctx = climo
      ? ` For context, ${city.name} averages ${climo.stats.mean_tropical_nights_20} such nights a whole summer.`
      : "";
    if (run.len >= 3) {
      lvl = "danger";
      msg = `<strong>${run.len} consecutive nights with no overnight relief</strong> ` +
            `(${nightLabel(run.from)} → ${nightLabel(run.to)}): the temperature never drops below 20°. ` +
            `This is the multi-day, no-recovery pattern most associated with elderly heat mortality.${ctx}`;
    } else if (run.len >= 1) {
      lvl = "warn";
      msg = `<strong>${run.len} night${run.len > 1 ? "s" : ""} with no overnight relief</strong> ` +
            `(${nightLabel(run.from)}${run.len > 1 ? " → " + nightLabel(run.to) : ""}). ` +
            `Watch for the run extending — risk to vulnerable groups compounds across nights.${ctx}`;
    } else {
      msg = `No no-relief nights forecast this week — every night cools below 20° at some point. ` +
            `Lower risk for vulnerable groups.${ctx}`;
    }
    mort.className = "headline mortality " + lvl;
    mort.innerHTML = `<span class="tag">MORTALITY</span> ` + msg;

    /* Night table with percentile vs climatology */
    const tbody = document.querySelector("#nightTable tbody");
    tbody.innerHTML = city.nights.map(n => {
      let pctCell = '<span class="pctl-lo">—</span>', rareCell = "—";
      if (climo) {
        const p = pctOf(climo.min_feels_q, n.min_feels);
        pctCell = `<span class="pctl ${pctClass(p)}">${p >= 99 ? "99+" : Math.round(p)}${p < 99 ? "th" : ""}</span>` +
                  `<span class="pctl-bar" style="width:${Math.max(4, Math.round(p))}%"></span>`;
        rareCell = `<span class="${pctClass(p)}">${rarity(p)}</span>`;
      }
      return `<tr class="${n.observed ? "observed " : ""}${n.part_observed ? "partobs " : ""}${n.no_relief ? "warn" : ""}">
        <td class="night-label">${nightSpan(n.date)}${obsTag(n)}${n.no_relief ? ' <span class="norelief">no relief</span>' : ""}</td>
        <td><span class="big">${n.min_feels}°</span><span class="sub">${esc(n.min_feels_time)}${n.part_observed && n.min_observed ? " (obs)" : ""}</span></td>
        <td>${pctCell}</td>
        <td>${rareCell}</td>
        <td>${fmtHours(n, 20)}</td>
        <td>${fmtHours(n, 25)}</td>
      </tr>`;
    }).join("");

    /* Climatology chart: tropical nights per year, full record */
    const climoEl = document.getElementById("climoChart");
    const decadeEl = document.getElementById("decadeCompare");
    if (climo) {
      const maxTn = Math.max(...climo.yearly.map(y => y.tropical_nights_20));
      climoEl.innerHTML = barChart(
        climo.yearly.map(y => ({
          label: "'" + String(y.year).slice(2),
          value: y.tropical_nights_20,
          hi: y.tropical_nights_20 >= Math.max(6, maxTn * 0.8),
        })),
        { avg: climo.stats.mean_tropical_nights_20, unit: "" });

      // "Then vs now" decade comparison table: nights >=20, >=25, mean low.
      if (climo.decades && decadeEl) {
        const d = climo.decades.filter(x => x.tropical_nights_20 != null);
        const first = d[0], last = d[d.length - 1];
        const mult = first.tropical_nights_20 > 0
          ? " (×" + (last.tropical_nights_20 / first.tropical_nights_20).toFixed(1) + ")"
          : "";
        const rows = d.map((x, i) => `<tr${i === d.length - 1 ? ' class="now"' : ""}>
            <td>${esc(x.label)}</td>
            <td>${x.tropical_nights_20}</td>
            <td>${x.nights_25}</td>
            <td>${x.mean_summer_min_feels}°</td>
          </tr>`).join("");
        decadeEl.innerHTML =
          `<p class="decade-head">Warm nights are rising fast: in ${first.label}, ${first.name || city.name}
             averaged <strong>${first.tropical_nights_20}</strong> nights a summer above 20°; in
             ${last.label}, <strong>${last.tropical_nights_20}</strong>${mult}.</p>` +
          `<table class="decade-table">
            <thead><tr><th>Decade</th><th>Nights ≥ 20°<br><span class="thin">per summer</span></th>
              <th>Nights ≥ 25°<br><span class="thin">per summer</span></th>
              <th>Mean overnight low<br><span class="thin">feels-like</span></th></tr></thead>
            <tbody>${rows}</tbody></table>`;
      } else if (decadeEl) {
        decadeEl.innerHTML = "";
      }
    } else {
      climoEl.innerHTML = '<p class="nodata">No climatology for this city.</p>';
      if (decadeEl) decadeEl.innerHTML = "";
    }

    /* Mortality chart: country summer excess by year */
    const country = MORT && MORT.countries.find(c => c.cities.includes(id));
    const mortEl = document.getElementById("mortChart");
    const cLabel = document.getElementById("mortCountry");
    if (country) {
      cLabel.textContent = `— ${country.country}, P-score by summer`;
      const maxP = Math.max(...country.yearly.map(y => y.pscore));
      mortEl.innerHTML = barChart(
        country.yearly.map(y => ({
          label: "'" + String(y.year).slice(2),
          value: y.pscore,
          hi: y.pscore >= Math.max(8, maxP * 0.8),
        })),
        { avg: null, unit: "%" });
      document.getElementById("mortNote").innerHTML =
        `All-cause summer excess (weeks 22–36) as a P-score (% above the trailing-5yr baseline), ` +
        `${country.years[0]}–${country.years[1]}. Red = worst summers (heatwave years such as 2003, 2022).`;
    } else {
      const why = (MORT && MORT.uncovered[id]) || "this country";
      cLabel.textContent = "";
      mortEl.innerHTML = `<p class="nodata">No open weekly-mortality series for ${esc(why)} (not in Eurostat).</p>`;
      document.getElementById("mortNote").textContent =
        "Country-level all-cause excess mortality, where Eurostat weekly deaths are available.";
    }

    document.getElementById("cityPanel").classList.remove("hidden");
    document.querySelectorAll(".city-pills button").forEach(b =>
      b.classList.toggle("active", b.dataset.city === id));
  }

  function init() {
    const gen = new Date(FC.generated_utc);
    let line = `Forecast ${gen.toUTCString().replace(":00 GMT", " UTC")}`;
    if (CLIMO) line += ` · climatology ${CLIMO.baseline_period}`;
    if (MORT) line += ` · mortality via Eurostat`;
    document.getElementById("updated").textContent = line;

    const pills = document.getElementById("cityPills");
    pills.innerHTML = FC.cities.map(c => `<button data-city="${esc(c.id)}">${esc(c.name)}</button>`).join("");
    pills.querySelectorAll("button").forEach(b =>
      b.addEventListener("click", () => renderCity(b.dataset.city, true)));
    const initial = FC.cities.find(c => c.id === location.hash.slice(1)) ? location.hash.slice(1) : FC.cities[0].id;
    renderCity(initial, false);
    window.addEventListener("hashchange", () => {
      const id = location.hash.slice(1);
      if (id && FC.cities.some(c => c.id === id)) renderCity(id, true);
    });
  }

  const bust = "?t=" + Math.floor(Date.now() / 600000);
  Promise.all([
    fetch("../data/forecast.json" + bust).then(r => r.json()),
    fetch("../data/climatology.json" + bust).then(r => r.ok ? r.json() : null).catch(() => null),
    fetch("../data/mortality.json" + bust).then(r => r.ok ? r.json() : null).catch(() => null),
  ]).then(([fc, climo, mort]) => {
    FC = fc; CLIMO = climo; MORT = mort;
    init();
  }).catch(err => {
    document.getElementById("updated").textContent = "Could not load data (" + err.message + ").";
  });
})();
