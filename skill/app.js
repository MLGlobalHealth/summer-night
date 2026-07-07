/* Summer Night · Skill — forecast vs observed for hours >= 20/25. No deps. */
(function () {
  "use strict";

  const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun",
                  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  let SKILL = null;

  function nightLabel(d) {
    const x = new Date(Date.parse(d + "T12:00Z"));
    return `${DAYS[x.getUTCDay()]} ${x.getUTCDate()} ${MONTHS[x.getUTCMonth()]}`;
  }
  function esc(s) {
    return String(s).replace(/[&<>"]/g, c =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  }
  function errClass(e) {
    const a = Math.abs(e);
    return a <= 1 ? "err-ok" : a <= 3 ? "err-mid" : "err-hi";
  }

  /* ---------- aggregate error by lead ---------- */
  function renderAggregate() {
    const byLead = {};              // lead -> {e20:[], e25:[]}
    let totalPairs = 0, tracked = 0, observed = 0;
    for (const c of Object.values(SKILL.cities)) {
      for (const rec of Object.values(c.nights)) {
        tracked++;
        if (rec.observed) observed++;
        if (!rec.observed) continue;
        for (const [lead, f] of Object.entries(rec.forecasts || {})) {
          (byLead[lead] = byLead[lead] || { e20: [], e25: [] });
          byLead[lead].e20.push(f.h20 - rec.observed.h20);
          byLead[lead].e25.push(f.h25 - rec.observed.h25);
          totalPairs++;
        }
      }
    }
    const mean = a => a.reduce((s, v) => s + v, 0) / a.length;
    const mae = a => mean(a.map(Math.abs));
    const rows = [];
    for (let lead = 0; lead <= 7; lead++) {
      const b = byLead[lead];
      if (!b || !b.e20.length) {
        rows.push(`<tr><td>${lead}</td><td>0</td><td>—</td><td>—</td><td>—</td><td>—</td></tr>`);
        continue;
      }
      const bias20 = mean(b.e20), bias25 = mean(b.e25);
      rows.push(`<tr>
        <td><strong>${lead}</strong></td>
        <td>${b.e20.length}</td>
        <td class="${errClass(mae(b.e20))}">${mae(b.e20).toFixed(1)} h</td>
        <td>${bias20 >= 0 ? "+" : ""}${bias20.toFixed(1)} h</td>
        <td class="${errClass(mae(b.e25))}">${mae(b.e25).toFixed(1)} h</td>
        <td>${bias25 >= 0 ? "+" : ""}${bias25.toFixed(1)} h</td>
      </tr>`);
    }
    document.querySelector("#skillTable tbody").innerHTML = rows.join("");
    document.getElementById("sampleNote").innerHTML = totalPairs
      ? `Based on <strong>${totalPairs}</strong> forecast-vs-observed pairs so far ` +
        `(${observed} nights observed, ${tracked} tracked across ${Object.keys(SKILL.cities).length} cities).`
      : `<strong>No completed forecast-vs-observed pairs yet.</strong> Logging began recently; ` +
        `${observed} nights observed and ${tracked} tracked so far. Pairs appear as forecast nights elapse — ` +
        `check back in a day or two.`;
  }

  /* ---------- per-city night table ---------- */
  function cell(fore, obs) {
    if (!fore) return "—";
    const s = `${fore.h20} / ${fore.h25}`;
    if (!obs) return `<span class="muted">${s}</span>`;
    const e20 = fore.h20 - obs.h20, e25 = fore.h25 - obs.h25;
    return `${s} <span class="sub">(<span class="${errClass(e20)}">${e20 >= 0 ? "+" : ""}${e20}</span>, ` +
           `<span class="${errClass(e25)}">${e25 >= 0 ? "+" : ""}${e25}</span>)</span>`;
  }
  function renderCity(id) {
    const c = SKILL.cities[id];
    document.getElementById("cityLabel").textContent = `— ${c.name}, ${c.country}`;
    document.querySelectorAll(".city-pills button").forEach(b =>
      b.classList.toggle("active", b.dataset.city === id));
    const dates = Object.keys(c.nights).sort().reverse();
    document.querySelector("#nightTable tbody").innerHTML = dates.map(d => {
      const rec = c.nights[d];
      const obs = rec.observed;
      return `<tr>
        <td class="night-label">${nightLabel(d)}</td>
        <td>${obs ? `<strong>${obs.h20} / ${obs.h25}</strong>` : '<span class="muted">pending</span>'}</td>
        <td>${cell(rec.forecasts["1"], obs)}</td>
        <td>${cell(rec.forecasts["3"], obs)}</td>
      </tr>`;
    }).join("") || `<tr><td colspan="4" class="nodata">No nights tracked yet.</td></tr>`;
    if (("#" + id) !== location.hash) history.replaceState(null, "", "#" + id);
  }

  function init() {
    const gen = new Date(SKILL.generated_utc);
    document.getElementById("updated").textContent =
      `Skill log updated ${gen.toUTCString().replace(":00 GMT", " UTC")}`;
    const ids = Object.keys(SKILL.cities);
    const pills = document.getElementById("cityPills");
    pills.innerHTML = ids.map(id =>
      `<button data-city="${esc(id)}">${esc(SKILL.cities[id].name)}</button>`).join("");
    pills.querySelectorAll("button").forEach(b =>
      b.addEventListener("click", () => renderCity(b.dataset.city)));
    renderAggregate();
    const initial = ids.includes(location.hash.slice(1)) ? location.hash.slice(1) : ids[0];
    renderCity(initial);
    window.addEventListener("hashchange", () => {
      const id = location.hash.slice(1);
      if (SKILL.cities[id]) renderCity(id);
    });
  }

  fetch("../data/skill.json?t=" + Math.floor(Date.now() / 600000))
    .then(r => { if (!r.ok) throw new Error(r.status); return r.json(); })
    .then(d => { SKILL = d; init(); })
    .catch(err => {
      document.getElementById("updated").textContent = "Could not load skill data (" + err.message + ").";
    });
})();
