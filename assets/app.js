/* Summer Night — renders data/forecast.json. No dependencies. */
(function () {
  "use strict";

  const DATA_URL = "data/forecast.json";
  const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun",
                  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

  let DATA = null;

  // All times in the data are local to each city; parse them as if UTC so
  // arithmetic is consistent and the browser's timezone never interferes.
  function parseLocal(iso) { return Date.parse(iso + (iso.length === 16 ? ":00Z" : "Z")); }

  function nightLabel(isoDate) {
    const d = new Date(parseLocal(isoDate + "T12:00"));
    return `${DAYS[d.getUTCDay()]} ${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`;
  }

  // Unambiguous span: the night runs from this evening (21:00) into the next
  // morning (09:00), so label it with both days, e.g. "Sun 5 → Mon 6 Jul".
  function nightSpan(isoDate) {
    const a = new Date(parseLocal(isoDate + "T12:00"));
    const b = new Date(parseLocal(isoDate + "T12:00") + 86400e3);
    const mo = MONTHS[b.getUTCMonth()];
    const aMo = a.getUTCMonth() === b.getUTCMonth() ? "" : " " + MONTHS[a.getUTCMonth()];
    return `${DAYS[a.getUTCDay()]} ${a.getUTCDate()}${aMo} → ${DAYS[b.getUTCDay()]} ${b.getUTCDate()} ${mo}`;
  }

  // Comfort severity from the feels-like overnight minimum.
  function severity(night) {
    if (night.all_above["25"]) return "danger";
    if (night.all_above["20"]) return "warn";
    return "";
  }

  // Longest run of consecutive no-relief nights and its date span.
  function fmtHours(night, th) {
    const det = night.hours_ge[String(th)];
    const ens = night.ens && night.ens[String(th)];
    if (!ens) return `<span class="big">${det} h</span>`;
    const mid = Math.round(ens.median), lo = Math.round(ens.p10), hi = Math.round(ens.p90);
    // Only show a range when the ensemble actually spans more than one hour.
    const sub = lo === hi ? "" : `<span class="sub range">${lo}–${hi} h likely</span>`;
    return `<span class="big">${mid} h</span>` + sub;
  }

  function esc(s) {
    return String(s).replace(/[&<>"]/g, c =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  }

  /* ---------- sparkline: one night's 12-hour feels-like curve ---------- */
  function sparkline(curve, lo, hi) {
    const W = 150, H = 44, PAD = 3;
    const y = v => H - PAD - ((v - lo) / (hi - lo || 1)) * (H - 2 * PAD);
    const x = i => PAD + (i / (curve.length - 1)) * (W - 2 * PAD);
    let s = `<svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" aria-hidden="true">`;
    for (const th of DATA.thresholds) {
      if (th > lo && th < hi) {
        const col = th >= 25 ? "var(--danger)" : "var(--warn)";
        s += `<line x1="0" x2="${W - 22}" y1="${y(th)}" y2="${y(th)}" stroke="${col}" stroke-width="1" stroke-dasharray="3 3" opacity="0.7"/>`;
        s += `<text x="${W - 2}" y="${(y(th) + 3.5).toFixed(1)}" text-anchor="end" fill="${col}" font-size="10" opacity="0.9">${th}°</text>`;
      }
    }
    const pts = curve.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(" ");
    s += `<polyline points="${pts}" fill="none" stroke="var(--accent)" stroke-width="2"/>`;
    return s + "</svg>";
  }

  /* ---------- main 7-day chart ---------- */
  function bigChart(city) {
    const H = 340, W = 900;
    const M = { l: 44, r: 12, t: 14, b: 34 };
    const times = city.hourly.time.map(parseLocal);
    const nowLocal = Date.now() + city.utc_offset_seconds * 1000;
    const start = nowLocal - 6 * 3600e3;
    const i0 = Math.max(0, times.findIndex(t => t >= start));
    const idx = [];
    for (let i = i0; i < times.length; i++) {
      if (city.hourly.feels[i] !== null || city.hourly.temp[i] !== null) idx.push(i);
    }
    if (idx.length < 2) return "<p>No hourly data.</p>";

    const t0 = times[idx[0]], t1 = times[idx[idx.length - 1]];
    const vals = idx.map(i => city.hourly.feels[i]).filter(v => v !== null);
    let lo = Math.min(...vals, 18), hi = Math.max(...vals, 27);
    lo = Math.floor(lo / 5) * 5; hi = Math.ceil(hi / 5) * 5;

    const x = t => M.l + ((t - t0) / (t1 - t0)) * (W - M.l - M.r);
    const y = v => M.t + (1 - (v - lo) / (hi - lo)) * (H - M.t - M.b);

    let s = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Hourly overnight temperature">`;

    // Night shading
    for (const n of city.nights) {
      const ns = parseLocal(n.date + "T21:00"), ne = ns + 12 * 3600e3;
      const xa = Math.max(x(Math.max(ns, t0)), M.l), xb = Math.min(x(Math.min(ne, t1)), W - M.r);
      if (xb > xa) s += `<rect x="${xa.toFixed(1)}" y="${M.t}" width="${(xb - xa).toFixed(1)}" height="${H - M.t - M.b}" fill="#ffffff" opacity="0.06"/>`;
    }

    // Horizontal gridlines + axis labels
    for (let v = lo; v <= hi; v += 5) {
      s += `<line x1="${M.l}" x2="${W - M.r}" y1="${y(v)}" y2="${y(v)}" stroke="var(--line)" stroke-width="1"/>`;
      s += `<text x="${M.l - 8}" y="${y(v) + 4}" text-anchor="end" fill="var(--muted)" font-size="12">${v}°</text>`;
    }
    // Threshold lines
    for (const th of DATA.thresholds) {
      if (th <= lo || th >= hi) continue;
      const col = th >= 25 ? "var(--danger)" : "var(--warn)";
      s += `<line x1="${M.l}" x2="${W - M.r}" y1="${y(th)}" y2="${y(th)}" stroke="${col}" stroke-width="1.5" stroke-dasharray="5 4" opacity="0.85"/>`;
      s += `<text x="${W - M.r - 2}" y="${y(th) - 3}" text-anchor="end" fill="${col}" font-size="11" opacity="0.9">${th}°</text>`;
    }
    // Day labels at each local noon
    for (let t = t0; t <= t1; t += 3600e3) {
      const d = new Date(t);
      if (d.getUTCHours() === 12) {
        s += `<text x="${x(t).toFixed(1)}" y="${H - 10}" text-anchor="middle" fill="var(--muted)" font-size="12">${DAYS[d.getUTCDay()]} ${d.getUTCDate()}</text>`;
      }
    }
    // "now" marker
    if (nowLocal > t0 && nowLocal < t1) {
      s += `<line x1="${x(nowLocal)}" x2="${x(nowLocal)}" y1="${M.t}" y2="${H - M.b}" stroke="var(--ok)" stroke-width="1.5" opacity="0.8"/>`;
      s += `<text x="${x(nowLocal) + 4}" y="${M.t + 12}" fill="var(--ok)" font-size="11">now</text>`;
    }

    function path(series, dashed) {
      let d = "", pen = false;
      for (const i of idx) {
        const v = series[i];
        if (v === null) { pen = false; continue; }
        d += `${pen ? "L" : "M"}${x(times[i]).toFixed(1)},${y(v).toFixed(1)}`;
        pen = true;
      }
      return `<path d="${d}" fill="none" stroke="var(--accent)" stroke-width="2.5"/>`;
    }
    s += path(city.hourly.feels);
    return s + "</svg>";
  }

  /* ---------- city panel ---------- */
  function renderCity(city) {
    document.getElementById("cityName").textContent =
      `${city.name}, ${city.country}` + (city.stale ? " (older data)" : "");

    const tonight = city.nights[0];

    /* Comfort / sleep headline */
    const head = document.getElementById("headline");
    const sev = severity(tonight);
    head.className = "headline " + sev;
    const ens20 = tonight.ens && tonight.ens["20"];
    let msg = `<span class="tag">SLEEP</span> <strong>Tonight (${nightSpan(tonight.date)}):</strong> ` +
              `the temperature drops to a low of <strong>${tonight.min_feels}°</strong> around ${tonight.min_feels_time}. `;
    if (sev === "danger") {
      msg += `<strong>It stays above 25° all night — oppressive, very poor sleep likely.</strong>`;
    } else if (sev === "warn") {
      msg += `<strong>It stays above 20° all night — a warm, restless night.</strong>`;
    } else if (ens20) {
      const belowMed = Math.round(12 - ens20.median);
      const lo = Math.round(12 - ens20.p90), hi = Math.round(12 - ens20.p10);
      if (belowMed >= 12) {
        msg += `It stays below 20° all night — a comfortably cool night.`;
      } else {
        const range = lo === hi ? "" : ` (likely ${lo}–${hi})`;
        msg += `About <strong>${belowMed} of the 12 overnight hours</strong>${range} stay below 20° — ` +
               `comfortable enough for most sleepers.`;
      }
    } else {
      msg += `${12 - tonight.hours_ge["20"]} of the 12 overnight hours stay below 20°.`;
    }
    if (city.stale) msg += ` <span class="stale-note">⚠ latest fetch failed; showing last good forecast.</span>`;
    head.innerHTML = msg;

    /* Night table */
    const allVals = city.nights.flatMap(n => n.feels_curve);
    const lo = Math.min(...allVals, 18) - 1, hi = Math.max(...allVals, 26) + 1;
    const tbody = document.querySelector("#nightTable tbody");
    tbody.innerHTML = city.nights.map(n => `
      <tr class="${severity(n)}">
        <td class="night-label">${nightSpan(n.date)}${n.no_relief ? ' <span class="norelief" title="Temperature never drops below 20° — no overnight recovery">no relief</span>' : ""}</td>
        <td><span class="big">${n.min_feels}°</span><span class="sub">at ${esc(n.min_feels_time)}</span></td>
        <td>${fmtHours(n, 20)}</td>
        <td>${fmtHours(n, 25)}</td>
        <td>${sparkline(n.feels_curve, lo, hi)}</td>
      </tr>`).join("");

    document.getElementById("chart").innerHTML = bigChart(city);
    document.getElementById("cityPanel").classList.remove("hidden");
  }

  /* ---------- overview grid ---------- */
  function renderOverview() {
    const dates = DATA.cities[0].nights.map(n => n.date);
    document.querySelector("#overview thead").innerHTML =
      "<tr><th>City</th>" + dates.map(d => `<th>${nightLabel(d)}</th>`).join("") + "</tr>";
    document.querySelector("#overview tbody").innerHTML = DATA.cities.map(c => {
      const byDate = Object.fromEntries(c.nights.map(n => [n.date, n]));
      const cells = dates.map(d => {
        const n = byDate[d];
        if (!n) return "<td>–</td>";
        return `<td class="${severity(n)}" title="${esc(c.name)}, ${nightLabel(d)}: min temp ${n.min_feels}°${n.no_relief ? " — no overnight relief" : ""}">${n.min_feels}°</td>`;
      }).join("");
      return `<tr data-city="${esc(c.id)}"><td class="city-cell">${esc(c.name)}${c.stale ? " ⚠" : ""}</td>${cells}</tr>`;
    }).join("");
    document.querySelectorAll("#overview tbody tr").forEach(tr => {
      tr.addEventListener("click", () => selectCity(tr.dataset.city));
    });
  }

  // scroll=false on first load / hash restore so we don't yank the page down.
  function selectCity(id, scroll) {
    const city = DATA.cities.find(c => c.id === id);
    if (!city) return;
    document.querySelectorAll(".city-pills button").forEach(b =>
      b.classList.toggle("active", b.dataset.city === id));
    renderCity(city);
    if (("#" + id) !== location.hash) history.replaceState(null, "", "#" + id);
    if (scroll) document.getElementById("cityPanel").scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function init(data) {
    DATA = data;
    const gen = new Date(data.generated_utc);
    document.getElementById("updated").textContent =
      `Forecast updated ${gen.toUTCString().replace(":00 GMT", " UTC")} · data from Open-Meteo`;

    const pills = document.getElementById("cityPills");
    pills.innerHTML = data.cities.map(c =>
      `<button data-city="${esc(c.id)}">${esc(c.name)}</button>`).join("");
    pills.querySelectorAll("button").forEach(b =>
      b.addEventListener("click", () => selectCity(b.dataset.city, true)));

    renderOverview();
    const initial = data.cities.find(c => c.id === location.hash.slice(1)) ? location.hash.slice(1) : data.cities[0].id;
    selectCity(initial, false);
    // Support back/forward and shared #city links changing after load.
    window.addEventListener("hashchange", () => {
      const id = location.hash.slice(1);
      if (id && data.cities.some(c => c.id === id)) selectCity(id, true);
    });
    if (!location.hash) window.scrollTo(0, 0);
  }

  fetch(DATA_URL + "?t=" + Math.floor(Date.now() / 600000))
    .then(r => { if (!r.ok) throw new Error(r.status); return r.json(); })
    .then(init)
    .catch(err => {
      document.getElementById("updated").textContent =
        "Could not load forecast data (" + err.message + "). Try reloading.";
    });
})();
