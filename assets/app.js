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
  const hrs = n => `${n} hour${n === 1 ? "" : "s"}`;

  function obsTag(n) {
    if (n.observed) return ' <span class="obs-tag">observed</span>';
    if (n.part_observed) return ' <span class="obs-tag part">part observed</span>';
    return "";
  }

  function fmtHours(night, th) {
    const det = night.hours_ge[String(th)];
    const ens = night.ens && night.ens[String(th)];
    if (!ens) return `<span class="big">${hrs(det)}</span>`;
    const mid = Math.round(ens.median), lo = Math.round(ens.p10), hi = Math.round(ens.p90);
    // Only show a range when the ensemble actually spans more than one hour.
    const sub = lo === hi ? "" : `<span class="sub range">${lo}–${hi} hrs likely</span>`;
    return `<span class="big">${hrs(mid)}</span>` + sub;
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
    // Start at the first shown night (includes the observed nights) or 6h ago.
    const firstNight = city.nights[0];
    const start = firstNight ? parseLocal(firstNight.date + "T21:00") : nowLocal - 6 * 3600e3;
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

    let s = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Hourly overnight temperature for ${esc(city.name)}">`;
    // City name baked into the image so a screenshot of the chart alone is labelled.
    s += `<text x="${M.l}" y="11" fill="var(--text)" font-size="13" font-weight="700">${esc(city.name)} — overnight “feels like” temperature</text>`;

    // Overnight (21:00->09:00) windows: a cool tint marks them clearly. The
    // temperature bottoms out inside these bands; daytime is the gaps between.
    let lastNightCx = null;
    for (const n of city.nights) {
      const ns = parseLocal(n.date + "T21:00"), ne = ns + 12 * 3600e3;
      const xa = Math.max(x(Math.max(ns, t0)), M.l), xb = Math.min(x(Math.min(ne, t1)), W - M.r);
      if (xb <= xa) continue;
      s += `<rect x="${xa.toFixed(1)}" y="${M.t}" width="${(xb - xa).toFixed(1)}" height="${H - M.t - M.b}" fill="#9db8ff" opacity="0.12"/>`;
      if (xb - xa > 26) lastNightCx = (xa + xb) / 2;
    }
    // A single "night" label on the right-most band, clear of the legend and "now".
    if (lastNightCx !== null) {
      s += `<text x="${lastNightCx.toFixed(1)}" y="${M.t + 11}" text-anchor="middle" fill="var(--muted)" font-size="10">night</text>`;
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
    // "now" marker, with the current local time written next to it.
    if (nowLocal > t0 && nowLocal < t1) {
      const nd = new Date(nowLocal);
      const hhmm = `${String(nd.getUTCHours()).padStart(2, "0")}:${String(nd.getUTCMinutes()).padStart(2, "0")}`;
      s += `<line x1="${x(nowLocal)}" x2="${x(nowLocal)}" y1="${M.t}" y2="${H - M.b}" stroke="var(--ok)" stroke-width="1.5" opacity="0.8"/>`;
      s += `<text x="${x(nowLocal) + 4}" y="${M.t + 12}" fill="var(--ok)" font-size="11">now ${hhmm}</text>`;
    }

    // Build [t, v] points and interpolate the value exactly at "now" so the
    // observed (grey) and forecast (blue) segments join without a gap.
    const pts = idx.filter(i => city.hourly.feels[i] !== null).map(i => [times[i], city.hourly.feels[i]]);
    let nowVal = null;
    for (let k = 0; k < pts.length - 1; k++) {
      if (pts[k][0] <= nowLocal && nowLocal <= pts[k + 1][0]) {
        const [ta, va] = pts[k], [tb, vb] = pts[k + 1];
        nowVal = va + (vb - va) * ((nowLocal - ta) / (tb - ta || 1));
        break;
      }
    }
    const draw = (list, stroke, width) =>
      list.length < 2 ? "" :
      `<path d="${list.map((p, j) => `${j ? "L" : "M"}${x(p[0]).toFixed(1)},${y(p[1]).toFixed(1)}`).join("")}" fill="none" stroke="${stroke}" stroke-width="${width}"/>`;
    if (nowVal !== null) {
      const obs = pts.filter(p => p[0] < nowLocal).concat([[nowLocal, nowVal]]);
      const fut = [[nowLocal, nowVal]].concat(pts.filter(p => p[0] > nowLocal));
      s += draw(obs, "var(--muted)", 2);
      s += draw(fut, "var(--accent)", 2.5);
      s += `<line x1="${M.l + 8}" x2="${M.l + 30}" y1="${M.t + 8}" y2="${M.t + 8}" stroke="var(--muted)" stroke-width="2"/>` +
           `<text x="${M.l + 35}" y="${M.t + 12}" fill="var(--muted)" font-size="12">observed</text>` +
           `<line x1="${M.l + 110}" x2="${M.l + 132}" y1="${M.t + 8}" y2="${M.t + 8}" stroke="var(--accent)" stroke-width="2.5"/>` +
           `<text x="${M.l + 137}" y="${M.t + 12}" fill="var(--text)" font-size="12">forecast</text>`;
    } else {
      s += draw(pts, nowLocal >= t1 ? "var(--muted)" : "var(--accent)", 2.5);
    }
    return s + "</svg>";
  }

  /* ---------- city panel ---------- */
  function renderCity(city) {
    document.getElementById("cityName").textContent =
      `${city.name}, ${city.country}` + (city.stale ? " (older data)" : "");

    const tonight = city.nights.find(n => !n.observed) || city.nights[0];

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
      const lo = Math.round(ens20.p10), hi = Math.round(ens20.p90);
      if (hi <= 0) {
        msg += `It stays below 20° all night — a comfortably cool night.`;
      } else {
        const span = lo === hi ? `${hi}` : `${lo} to ${hi}`;
        msg += `<strong>${span} overnight hours</strong> stay above 20° — cooler the rest of the night.`;
      }
    } else {
      const above = tonight.hours_ge["20"];
      msg += above === 0
        ? `It stays below 20° all night — a comfortably cool night.`
        : `<strong>${above} overnight hours</strong> stay above 20°.`;
    }

    // Best-estimate hours at/above a threshold (ensemble median, else actual).
    const hrsGe = (n, th) => {
      const e = n.ens && n.ens[String(th)];
      return e ? Math.round(e.median) : n.hours_ge[String(th)];
    };
    // [warmer/cooler, worse/better] or null if about the same.
    const cmpWord = d => d >= 0.5 ? ["warmer", "worse"] : d <= -0.5 ? ["cooler", "better"] : null;
    const ti = city.nights.indexOf(tonight);

    // Compare tonight to the previous night (observed), including hours above.
    const last = ti > 0 ? city.nights[ti - 1] : null;
    if (last) {
      const d = Math.round((tonight.min_feels - last.min_feels) * 10) / 10;
      const w = cmpWord(d);
      const lead = w
        ? `it's <strong>${Math.abs(d).toFixed(1)}° ${w[0]}</strong> — likely a ${w[1]} night's sleep`
        : `it's about the same`;
      msg += ` Compared to last night (${nightSpan(last.date)}), ${lead}: ` +
             `<strong>${hrsGe(tonight, 20)} h ≥ 20°</strong> and <strong>${hrsGe(tonight, 25)} h ≥ 25°</strong> ` +
             `tonight, versus ${hrsGe(last, 20)} and ${hrsGe(last, 25)} last night.`;
    }

    // Predict tomorrow night relative to tonight (forecast).
    const tmrw = city.nights[ti + 1];
    if (tmrw) {
      const d2 = Math.round((tmrw.min_feels - tonight.min_feels) * 10) / 10;
      const w2 = cmpWord(d2);
      const lead2 = w2 ? `<strong>${Math.abs(d2).toFixed(1)}° ${w2[0]}</strong>` : `about the same`;
      msg += ` Tomorrow night (${nightSpan(tmrw.date)}) looks ${lead2} (low ${tmrw.min_feels}°), ` +
             `with ${hrsGe(tmrw, 20)} h ≥ 20° and ${hrsGe(tmrw, 25)} h ≥ 25°.`;
    }
    if (city.stale) msg += ` <span class="stale-note">⚠ latest fetch failed; showing last good forecast.</span>`;
    head.innerHTML = msg;

    /* Night table */
    const allVals = city.nights.flatMap(n => n.feels_curve);
    const lo = Math.min(...allVals, 18) - 1, hi = Math.max(...allVals, 26) + 1;
    const tbody = document.querySelector("#nightTable tbody");
    tbody.innerHTML = city.nights.map(n => `
      <tr class="${n.observed ? "observed " : ""}${n.part_observed ? "partobs " : ""}${severity(n)}">
        <td class="night-label">${nightSpan(n.date)}${obsTag(n)}${n.no_relief ? ' <span class="norelief" title="Temperature never drops below 20° — no overnight recovery">no relief</span>' : ""}</td>
        <td><span class="big">${n.min_feels}°</span><span class="sub">at ${esc(n.min_feels_time)}${n.part_observed && n.min_observed ? " (observed)" : ""}</span></td>
        <td>${fmtHours(n, 20)}</td>
        <td>${fmtHours(n, 25)}</td>
        <td>${sparkline(n.feels_curve, lo, hi)}</td>
      </tr>`).join("");

    document.getElementById("chartCity").textContent = city.name;
    document.getElementById("chartShare").setAttribute("href", "#" + city.id);
    document.getElementById("chart").innerHTML = bigChart(city);
    document.getElementById("cityPanel").classList.remove("hidden");
  }

  /* ---------- overview grid ---------- */
  function renderOverview() {
    const dates = DATA.cities[0].nights.filter(n => !n.observed).map(n => n.date);
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

    // "share" link: copy the full #city URL to the clipboard when possible.
    const share = document.getElementById("chartShare");
    share.addEventListener("click", (e) => {
      const url = location.origin + location.pathname + share.getAttribute("href");
      if (navigator.clipboard) {
        e.preventDefault();
        history.replaceState(null, "", share.getAttribute("href"));
        navigator.clipboard.writeText(url).then(() => {
          const t = share.querySelector(".sharetext");
          if (t) { const old = t.textContent; t.textContent = "copied!"; setTimeout(() => { t.textContent = old; }, 1500); }
        });
      }
    });

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
