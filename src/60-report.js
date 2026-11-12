/* ---------------- PDF reports ---------------- */
const RC = { premium: '#d9822b', reimb: '#2a9d6f', vet: '#3f7fd0', weight: '#6b5bd2', grid: '#e3e5e8', text: '#6b7280' };

const REPORT_CSS = `
*{box-sizing:border-box}
html,body{margin:0;padding:0;background:#fff}
body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;color:#1f2328;font-size:9.4pt;line-height:1.4;-webkit-print-color-adjust:exact;print-color-adjust:exact}
.r-report+.r-report{break-before:page}
.r-head{margin:0 0 14px}
.r-head h1{font-size:21pt;margin:0 0 6px;font-weight:700;letter-spacing:-.01em}
.r-head.with-photo{display:flex;justify-content:space-between;align-items:flex-start;gap:16px}
.r-photos{display:flex;gap:8px;flex:none}
.r-photos img{width:84px;height:84px;border-radius:50%;object-fit:cover;border:2px solid #e3e5e8}
.r-meta{color:#4b5563;font-size:9pt;margin:1px 0}
.r-meta b{color:#1f2328;font-weight:600}
h2{font-size:12.5pt;margin:20px 0 8px;padding-top:10px;border-top:1.5px solid #1f2328;break-after:avoid}
h3{font-size:10pt;margin:14px 0 6px;break-after:avoid}
.r-tiles{display:grid;grid-template-columns:repeat(3,1fr);gap:0;border-top:1px solid #d6d9de;margin:6px 0 4px}
.r-tile{padding:9px 10px 9px 0;border-bottom:1px solid #e6e8eb;break-inside:avoid}
.r-tile .l{font-size:6.8pt;letter-spacing:.07em;text-transform:uppercase;color:#6b7280;font-weight:600}
.r-tile .v{font-size:14pt;font-weight:700;margin-top:2px;line-height:1.2}
.r-tile .s{font-size:8pt;color:#4b5563}
.r-tile.good .v{color:#1d7a55}.r-tile.bad .v{color:#b42318}.r-tile.warn .v{color:#a15c07}
.r-box{background:#f5f6f8;border-left:3px solid #6b7280;padding:9px 12px;margin:10px 0;break-inside:avoid}
.r-box h3{margin:0 0 4px}
.r-box ul{margin:4px 0 0;padding-left:16px}
.r-verdict{border:1.5px solid #d6d9de;border-radius:6px;padding:12px 14px;margin:8px 0 12px;break-inside:avoid}
.r-verdict .k{font-size:6.8pt;letter-spacing:.07em;text-transform:uppercase;color:#6b7280;font-weight:600}
.r-verdict .t{font-size:15pt;font-weight:700;margin:2px 0 4px}
.r-verdict.good{border-color:#2a9d6f;background:#f1faf6}.r-verdict.good .t{color:#1d7a55}
.r-verdict.fair{border-color:#d9a21b;background:#fdf8ec}.r-verdict.fair .t{color:#8a5a00}
.r-verdict.poor{border-color:#d9534f;background:#fdf3f2}.r-verdict.poor .t{color:#b42318}
.r-verdict p{margin:0}
table{width:100%;border-collapse:collapse;font-size:8.3pt;margin:4px 0 6px}
thead{display:table-header-group}
th{text-align:left;font-weight:600;color:#4b5563;border-bottom:1.2px solid #9ca3af;padding:4px 6px 4px 0;font-size:7.6pt;vertical-align:bottom}
td{border-bottom:1px solid #e6e8eb;padding:4px 6px 4px 0;vertical-align:top}
tr{break-inside:avoid}
td.n,th.n{text-align:right;font-variant-numeric:tabular-nums}
.r-kv{display:grid;grid-template-columns:1fr 1fr;column-gap:24px}
.r-kv div{display:flex;gap:8px;border-bottom:1px solid #eef0f2;padding:3px 0}
.r-kv span:first-child{color:#6b7280;min-width:110px}
.r-muted{color:#6b7280}.r-small{font-size:8pt}
.r-chart{margin:4px 0 2px;break-inside:avoid}
.r-keep{break-inside:avoid}
.r-chart svg{width:100%;height:auto;display:block}
.pd-legend{display:flex;gap:14px;font-size:8pt;color:#4b5563;margin:2px 0 6px}
.pd-legend i{display:inline-block;width:10px;height:10px;border-radius:2px;margin-right:5px;vertical-align:-1px}
.r-bars div{display:grid;grid-template-columns:140px 1fr 90px;align-items:center;gap:8px;padding:2px 0}
.r-bars .bar{height:7px;background:#e8eaee;border-radius:4px;overflow:hidden}.r-bars .bar span{display:block;height:100%;background:#6b7280}
.pill{display:inline-block;padding:0 6px;border-radius:9px;font-size:7.4pt;font-weight:600;background:#eef0f3;color:#374151;white-space:nowrap}
.pill.good{background:#e3f4ec;color:#1d7a55}.pill.bad{background:#fbe5e3;color:#b42318}.pill.warn{background:#fcf0d9;color:#8a5a00}.pill.info{background:#e4eefb;color:#1f5aa6}
.r-pos{color:#1d7a55}.r-neg{color:#b42318}
.r-appendix ul{padding-left:16px;margin:4px 0}.r-appendix li{margin:2px 0}
.r-appendix dt{font-weight:600;margin-top:5px}.r-appendix dd{margin:0 0 0 0;color:#374151}
.r-contents td:first-child{width:70%}
.r-disclaimer{margin-top:14px;font-size:7.8pt;color:#6b7280;border-top:1px solid #e6e8eb;padding-top:6px}
`;

function rEsc(v) { return esc(v == null || v === '' ? '–' : v); }
function rTiles(items) { return `<div class="r-tiles">${items.map((t) => `<div class="r-tile ${t.tone || ''}"><div class="l">${esc(t.l)}</div><div class="v">${esc(t.v)}</div>${t.s ? `<div class="s">${esc(t.s)}</div>` : ''}</div>`).join('')}</div>`; }
function rTable(cols, rows, empty) {
  if (!rows.length) return `<p class="r-muted">${esc(empty || 'None recorded in this period.')}</p>`;
  return `<table><thead><tr>${cols.map((c) => `<th class="${c.n ? 'n' : ''}" ${c.w ? `style="width:${c.w}"` : ''}>${esc(c.l)}</th>`).join('')}</tr></thead><tbody>${rows.map((r) => `<tr>${cols.map((c) => { const v = c.f(r); return `<td class="${c.n ? 'n' : ''}">${c.html ? (v || '–') : rEsc(v)}</td>`; }).join('')}</tr>`).join('')}</tbody></table>`;
}
function rKV(pairs) { return `<div class="r-kv">${pairs.filter((p) => p[1]).map(([k, v]) => `<div><span>${esc(k)}</span><span>${esc(v)}</span></div>`).join('')}</div>`; }
function rBox(title, items) { return items.length ? `<div class="r-box"><h3>${esc(title)}</h3><ul>${items.map((i) => `<li>${esc(i)}</li>`).join('')}</ul></div>` : ''; }
function rPill(text, tone) { return `<span class="pill ${tone || ''}">${esc(text)}</span>`; }
let R_PHOTOS = {};
function rHead(title, lines, petIds) {
  const ph = (petIds || []).map((id) => R_PHOTOS[id]).filter(Boolean);
  const pics = ph.length ? `<div class="r-photos">${ph.map((u) => `<img src="${u}" alt="">`).join('')}</div>` : '';
  return `<div class="r-head${ph.length ? ' with-photo' : ''}"><div><h1>${esc(title)}</h1>${lines.filter(Boolean).map((l) => `<div class="r-meta">${l}</div>`).join('')}</div>${pics}</div>`;
}

function healthReportHTML(data, pet, range) {
  const s = data.settings, D = (d) => fmtDate(d, s.dateFormat), M = (n) => fmtMoney(n, s.currency), U = s.weightUnit;
  const hs = healthStats(pet, s, range), t = todayISO();
  const inR = (d) => d && d >= range.from && d <= range.to;
  const days = daysBetween(range.from, range.to) + 1;
  const clinics = {};
  hs.visitsR.forEach((v) => { const k = [v.clinic, v.vet].filter(Boolean).join(' · ') || 'Not recorded'; clinics[k] = clinics[k] || { n: 0, last: '' , type: v.type }; clinics[k].n++; if (v.date > clinics[k].last) clinics[k].last = v.date; });
  const topObs = Object.entries(hs.counts).sort((a, b) => b[1] - a[1])[0];
  let o = rHead('Health report', [
    `<b>Pet:</b> ${esc([petLabel(pet), pet.species, pet.breed, ageLabel(pet)].filter(Boolean).join(' · '))}`,
    s.ownerName ? `<b>Owner:</b> ${esc(s.ownerName)}` : '',
    isArchived(pet) ? `<b>${esc(archiveVerb(pet))}:</b> ${esc(pet.archivedDate ? D(pet.archivedDate) : '')}${pet.archiveReason === 'passed' ? ' · in loving memory' : ''}` : '',
    `<b>Period:</b> ${esc(D(range.from))} – ${esc(D(range.to))} (${days} days)`,
    `Created ${esc(D(t))} · weights in ${esc(U)}`], [pet.id]);
  o += '<h2>Summary</h2>' + rTiles([
    { l: 'Vet visits in period', v: String(hs.visitsR.length), s: plural(Object.keys(clinics).length, 'clinic') },
    { l: 'Vet spending', v: fmtMoney(hs.spend, s.currency, true), s: 'in this period' },
    { l: 'Last visit', v: hs.last ? D(hs.last.date) : '–', s: hs.last ? hs.last.reason : '' },
    { l: 'Next visit', v: hs.nextAppt ? D(hs.nextAppt.date) : 'None booked', s: hs.nextAppt ? hs.nextAppt.text : '' },
    { l: 'Taking now', v: String(hs.meds.length), s: `${hs.meds.filter((m) => m.asNeeded).length} as needed` },
    { l: 'Vaccines', v: hs.overdue.length ? `${hs.overdue.length} overdue` : hs.dueSoon.length ? `${hs.dueSoon.length} due soon` : 'Up to date', s: `${hs.vacc.length} tracked`, tone: hs.overdue.length ? 'bad' : hs.dueSoon.length ? 'warn' : 'good' },
    { l: 'Latest weight', v: hs.latestW ? `${fmtNum(num(hs.latestW.weight))} ${U}` : '–', s: hs.wChange != null ? `${hs.wChange >= 0 ? '+' : '−'}${fmtNum(Math.abs(hs.wChange))} ${U} (${fmtPct(Math.abs(hs.wPct), 1)}) in period` : (hs.latestW ? D(hs.latestW.date) : '') },
    { l: 'Observations', v: String(hs.obsR.length), s: topObs ? `most often: ${topObs[0]}` : 'none logged' },
    { l: 'Coming up', v: String(hs.upcoming.length), s: 'appointments, vaccines and refills' },
  ]);
  o += rBox('Points to discuss with your vet', hs.discuss);
  o += '<h2>Profile</h2>' + rKV([['Name', petLabel(pet)], ['Species', pet.species], ['Breed', pet.breed], ['Sex', pet.sex], ['Age', ageLabel(pet)], ['Born', bornLabel(pet, s.dateFormat)], ['Color', pet.color], ['Microchip', pet.microchip], ['Primary vet', [pet.primaryVet, pet.vetPhone].filter(Boolean).join(' · ')], ['Vet address', pet.vetAddress], ['Emergency vet', [pet.emergencyVet, pet.emergencyPhone].filter(Boolean).join(' · ')], ['Emergency address', pet.emergencyAddress], ['Allergies', pet.allergies || 'None recorded'], ['Ongoing conditions', pet.conditions]]);
  if (hs.upcoming.length) o += '<h3>Coming up</h3>' + rTable([{ l: 'Date', f: (u) => D(u.date), w: '18%' }, { l: 'What', f: (u) => u.kind, w: '20%' }, { l: 'Details', f: (u) => [u.text, u.sub].filter(Boolean).join(' · ') }], hs.upcoming);
  o += '<h2>Vet visits</h2>' + rTable([
    { l: 'Date', f: (v) => D(v.date), w: '12%' }, { l: 'Type', f: (v) => v.type, w: '12%' }, { l: 'With', f: (v) => [v.clinic, v.vet].filter(Boolean).join(', '), w: '17%' },
    { l: 'Reason', f: (v) => v.reason, w: '15%' }, { l: 'Findings and next steps', f: (v) => [v.diagnosis, v.treatment, v.followUpDate ? `Follow up by ${D(v.followUpDate)}` : '', v.notes].filter(Boolean).join('. ') },
    { l: 'Cost', n: true, f: (v) => hasVal(v.cost) ? M(num(v.cost)) : '', w: '9%' },
  ], hs.visitsR.slice().reverse(), 'No vet visits in this period.');
  if (Object.keys(clinics).length) o += '<h3>Care team</h3>' + rTable([{ l: 'Clinic / vet', f: (r) => r[0] }, { l: 'Visits', n: true, f: (r) => String(r[1].n) }, { l: 'Last', f: (r) => D(r[1].last) }], Object.entries(clinics));
  o += '<h2>Medications</h2><h3>Taking now</h3>' + rTable([
    { l: 'Medication', f: (m) => `${m.name}${m.dose ? ' ' + m.dose : ''}${m.form ? ', ' + m.form : ''}`, w: '24%' }, { l: 'How', f: (m) => `${m.frequency || ''}${m.asNeeded ? ' (as needed)' : ''}` },
    { l: 'For', f: (m) => m.purpose, w: '16%' }, { l: 'Prescriber', f: (m) => m.prescriber, w: '14%' }, { l: 'Since', f: (m) => m.start ? D(m.start) : '', w: '11%' }, { l: 'Refill due', f: (m) => m.refillDue ? D(m.refillDue) : '', w: '11%' },
  ], hs.meds, 'No current medications.');
  if (hs.stoppedR.length) o += '<h3>Stopped in this period</h3>' + rTable([{ l: 'Medication', f: (m) => `${m.name}${m.dose ? ' ' + m.dose : ''}` }, { l: 'Taken', f: (m) => `${m.start ? D(m.start) : '?'} – ${D(m.end)}` }, { l: 'Why stopped', f: (m) => m.whyStopped }], hs.stoppedR);
  const stTxt = { overdue: ['Overdue', 'bad'], soon: ['Due soon', 'warn'], ok: ['Up to date', 'good'], none: ['No due date', ''] };
  o += '<h2>Vaccinations</h2><h3>Status</h3>' + rTable([
    { l: 'Vaccine', f: (x) => x.v.name }, { l: 'Last given', f: (x) => D(x.v.dateGiven) }, { l: 'Next due', f: (x) => x.v.nextDue ? D(x.v.nextDue) : '' },
    { l: 'Status', html: true, f: (x) => rPill(stTxt[x.status][0], stTxt[x.status][1]) }, { l: 'Clinic', f: (x) => x.v.clinic },
  ], hs.vacc, 'No vaccinations recorded.');
  const dosesR = pet.vaccines.filter((v) => inR(v.dateGiven)).sort(byDate('dateGiven'));
  if (dosesR.length) o += '<h3>Given in this period</h3>' + rTable([{ l: 'Date', f: (v) => D(v.dateGiven) }, { l: 'Vaccine', f: (v) => v.name }, { l: 'Clinic', f: (v) => v.clinic }, { l: 'Lot / tag', f: (v) => v.lot }, { l: 'Next due', f: (v) => v.nextDue ? D(v.nextDue) : '' }], dosesR);
  o += '<div class="r-keep"><h2>Weight</h2>';
  const wAll = hs.weights.filter((w) => w.date >= addMonths(range.from, -1) && w.date <= range.to);
  if (wAll.length) {
    o += `<p class="r-muted r-small">Each point is one weigh-in. ${hs.wChange != null ? `Change over the period: ${hs.wChange >= 0 ? '+' : '−'}${fmtNum(Math.abs(hs.wChange))} ${esc(U)} (${fmtPct(Math.abs(hs.wPct), 1)}).` : ''}</p>`;
    o += `<div class="r-chart">${lineChartSVG({ h: 170, grid: RC.grid, text: RC.text, yFmt: (v) => `${fmtNum(v)} ${U}`, xTicks: dateTicks(wAll.map((w) => w.date)), series: [{ name: 'Weight', color: RC.weight, area: true, points: wAll.map((w) => ({ x: parseISO(w.date).getTime(), y: num(w.weight) })) }] })}</div>`;
    o += '</div>'; let prev = null;
    o += rTable([{ l: 'Date', f: (w) => D(w.date) }, { l: 'Weight', n: true, f: (w) => `${fmtNum(num(w.weight))} ${U}` }, { l: 'Change', n: true, f: (w) => { const c = prev == null ? '' : `${num(w.weight) - prev >= 0 ? '+' : '−'}${fmtNum(Math.abs(num(w.weight) - prev))}`; prev = num(w.weight); return c; } }, { l: 'Notes', f: (w) => w.notes }], hs.wR);
  } else o += '<p class="r-muted">No weights logged in this period.</p></div>';
  o += '<h2>Observations</h2>';
  if (hs.obsR.length) {
    const n = hs.obsR.length;
    o += `<p class="r-muted r-small">Share of the ${n} observations in each category.</p><div class="r-bars">${Object.entries(hs.counts).sort((a, b) => b[1] - a[1]).map(([c, k]) => `<div><span>${esc(c)}</span><span class="bar"><span style="width:${Math.round(k / n * 100)}%"></span></span><span>${k} of ${n} (${Math.round(k / n * 100)}%)</span></div>`).join('')}</div>`;
    const sev = { 1: 'Mild', 2: 'Moderate', 3: 'Severe' };
    o += '<h3>Log</h3>' + rTable([{ l: 'Date', f: (x) => D(x.date), w: '13%' }, { l: 'Category', f: (x) => x.category, w: '16%' }, { l: 'Severity', f: (x) => sev[x.severity] || 'Mild', w: '11%' }, { l: 'What was noticed', f: (x) => x.note }], hs.obsR.slice().reverse());
  } else o += '<p class="r-muted">No observations logged in this period.</p>';
  if (hs.notesR.length) o += '<h2>Notes</h2>' + rTable([{ l: 'Date', f: (n) => D(n.date), w: '14%' }, { l: 'Note', f: (n) => (n.title ? n.title + ': ' : '') + n.text }], hs.notesR);
  o += `<h2>Appendix: how this report was calculated</h2><div class="r-appendix"><ul>
    <li>All figures come from what was recorded in the Pet Dashboard for ${esc(petLabel(pet))}; they may be incomplete.</li>
    <li>Vet visits and spending count visits dated inside the period up to today. Future-dated visits are shown as appointments under “Coming up”.</li>
    <li>“Taking now” lists medications with no end date (or an end date in the future). Refills are flagged within 7 days of the refill date.</li>
    <li>Vaccine status uses the latest dose of each vaccine: overdue if the next-due date has passed, due soon within 30 days.</li>
    <li>Weight change compares the first and last weigh-ins inside the period. A change of 5% or more is listed as a point to discuss.</li>
    <li>Observation categories logged 3 or more times in the period, and any severe observation, are listed as points to discuss.</li></ul></div>
    <div class="r-disclaimer">Produced by Pet Dashboard for Obsidian, a personal record-keeping tool. It does not diagnose or treat any condition and is meant to support a conversation with your veterinarian.</div>`;
  return `<section class="r-report">${o}</section>`;
}

function insuranceReportHTML(data, pet, range, ctx) {
  const s = data.settings, D = (d) => fmtDate(d, s.dateFormat), M = (n) => fmtMoney(n, s.currency), MW = (n) => fmtMoney(n, s.currency, true);
  const is = insuranceStats(ctx, s, range), t = todayISO(), isPlan = ctx.kind === 'plan';
  const petName = (id) => petLabel(data.pets.find((p) => p.id === id));
  const covers = isPlan ? `${esc(ctx.name)} — whole plan (${esc(ctx.petsCovered.map(petLabel).join(', '))})` : `${esc(petLabel(pet))}${sharedPolicies(data, pet).length ? ' — share of a multi-pet plan' : ''}`;
  let o = rHead('Pet insurance summary', [`<b>Covers:</b> ${covers}`, s.ownerName ? `<b>Owner:</b> ${esc(s.ownerName)}` : '',
    `<b>Period:</b> ${esc(D(range.from))} – ${esc(D(range.to))} (${daysBetween(range.from, range.to) + 1} days)`, `Created ${esc(D(t))} · amounts in ${esc(s.currency)}`], ctx.petsCovered.map((p) => p.id));
  const v = is.verdict;
  o += `<div class="r-verdict ${v.level}"><div class="k">Is the insurance worth it?</div><div class="t">${esc(v.label)}${is.ratio != null ? ` <span style="font-size:10pt;font-weight:600;color:#4b5563">· ${fmtNum(is.ratio, 2)} back per 1 paid</span>` : ''}</div><p>${esc(v.text)}</p></div>`;
  o += rTiles([
    { l: 'Premiums paid', v: MW(is.premiums), s: `${is.payments.length} payments` },
    { l: 'Reimbursed', v: MW(is.reimbursed), s: `${plural(is.paid.length, 'paid claim')}` },
    { l: 'Net benefit', v: (is.net >= 0 ? '+' : '−') + MW(Math.abs(is.net)), s: s.includePending && is.pendingEst ? 'includes pending estimate' : 'reimbursed − premiums', tone: is.net >= 0 ? 'good' : 'bad' },
    { l: 'Vet bills while insured', v: MW(is.vetCosts), s: `${fmtPct(is.coverage)} paid back` },
    { l: 'Out of pocket', v: MW(is.oopWith), s: `vs ${MW(is.oopWithout)} without insurance` },
    { l: 'Pending claims', v: is.pending.length ? MW(is.pendingEst) : 'None', s: is.pending.length ? `estimate on ${MW(is.pendingClaimed)} claimed` : '' },
    { l: 'Claims sent', v: String(is.claims.filter((c) => c.status !== 'draft').length), s: `approval rate ${fmtPct(is.approvalRate)}` },
    { l: 'Average days to pay', v: is.turnaround != null ? fmtNum(is.turnaround, 0) : '–', s: 'from sending to payment' },
    { l: 'Break-even spending', v: is.policy && is.policy.breakEven ? MW(is.policy.breakEven) : '–', s: 'eligible vet bills per year' },
  ]);
  o += rBox('Points to review', is.review);
  if (isPlan) {
    o += '<h2>By pet</h2>' + rTable([
      { l: 'Pet', f: (r) => petLabel(r.pet) }, { l: 'On the plan', f: (r) => { const j = petJoin(ctx.policy, r.pet.id), l = petLeave(ctx.policy, r.pet.id); return `${D(j)} – ${l && l < t ? D(l) : 'now'}`; } },
      { l: 'Share now', n: true, f: (r) => petOnPolicyAt(ctx.policy, r.pet.id, t) ? fmtPct(policyShare(data, ctx.policy, r.pet.id)) : '–' }, { l: 'Premiums (share)', n: true, f: (r) => M(r.premiums) },
      { l: 'Vet bills', n: true, f: (r) => M(r.vet) }, { l: 'Reimbursed', n: true, f: (r) => M(r.reimbursed) },
      { l: 'Net', n: true, html: true, f: (r) => { const n = r.reimbursed - r.premiums; return `<span class="${n >= 0 ? 'r-pos' : 'r-neg'}">${n >= 0 ? '+' : '−'}${esc(M(Math.abs(n)))}</span>`; } }, { l: 'Claims', n: true, f: (r) => String(r.claims) },
    ], is.byPet);
  }
  const months = is.series.map((r) => r.month);
  o += '<div class="r-keep"><h2>Premiums and reimbursements over time</h2><p class="r-muted r-small">Running totals. When the green line is above the orange one, the policy has returned more than it cost.</p>';
  o += `<div class="r-chart">${lineChartSVG({ h: 190, zero: true, grid: RC.grid, text: RC.text, yFmt: (x) => MW(x), xTicks: monthTicks(months), series: [
    { name: 'Premiums', color: RC.premium, points: is.series.map((r, i) => ({ x: i, y: r.cumPremiums })) },
    { name: 'Reimbursed', color: RC.reimb, area: true, points: is.series.map((r, i) => ({ x: i, y: r.cumReimbursed })) }] })}</div>`;
  o += legendHTML([{ name: 'Premiums paid', color: RC.premium }, { name: 'Reimbursed', color: RC.reimb }]) + '</div>';
  o += '<h3>By month</h3>' + rTable([
    { l: 'Month', f: (r) => monthLabel(r.month, true) }, { l: 'Premiums', n: true, f: (r) => M(r.premiums) }, { l: 'Vet bills', n: true, f: (r) => M(r.vet) },
    { l: 'Reimbursed', n: true, f: (r) => M(r.reimbursed) }, { l: 'Net for month', n: true, html: true, f: (r) => { const n = r.reimbursed - r.premiums; return `<span class="${n >= 0 ? 'r-pos' : 'r-neg'}">${n >= 0 ? '+' : '−'}${esc(M(Math.abs(n)))}</span>`; } },
    { l: 'Running net', n: true, f: (r) => { const n = r.cumReimbursed - r.cumPremiums; return (n >= 0 ? '+' : '−') + M(Math.abs(n)); } },
  ], is.series);
  o += '<h2>Policy details</h2>';
  ctx.policies.slice().sort(byDate('start', true)).forEach((p) => {
    const pets = petsOnPolicy(data, p), sc = (x) => pets.length > 1 ? (x === 'shared' ? ', shared by all pets' : ', per pet') : '';
    o += `<h3>${esc(policyLabel(p))} ${activeOn(p, t) ? rPill('Active', 'good') : rPill('Ended')}</h3>` + rKV([
      ['Pets covered', pets.map((pt) => { const j = petJoin(p, pt.id), l = petLeave(p, pt.id); const sh = pets.length > 1 && petOnPolicyAt(p, pt.id, t) ? `${fmtPct(policyShare(data, p, pt.id))} of premium, ` : ''; return `${petLabel(pt)} (${sh}${l && l < t ? `${D(j)} – ${D(l)}` : `since ${D(j)}`})`; }).join('; ')],
      ['Policy number', p.policyNumber], ['Coverage', p.coverage], ['Dates', `${D(p.start)} – ${p.end ? D(p.end) : 'ongoing'}`],
      ['Premium now', `${M(rateAt(ctx, p, t))} per ${p.frequency === 'annual' ? 'year' : 'month'}${pets.length > 1 ? ' (all pets)' : ''}`],
      ['Starting premium', M(num(p.premium))], ['Deductible', `${MW(num(p.deductible))} (${({ annual: 'annual', condition: 'per condition', incident: 'per incident', lifetime: 'lifetime' })[p.deductibleType] || 'annual'}${sc(p.deductibleScope)})`],
      ['Reimbursement', `${num(p.reimbursement)}%`], ['Annual limit', num(p.annualLimit) ? MW(num(p.annualLimit)) + sc(p.limitScope) : 'Unlimited'],
      ['Waiting period', hasVal(p.waitingPeriod) ? plural(num(p.waitingPeriod), 'day') : ''], ['Exclusions', p.exclusions], ['Contact', [p.phone, p.website].filter(Boolean).join(' · ')], ['Renews', nextRenewal(p) ? D(nextRenewal(p)) : '']]);
    if (is.policy && is.policy.policy.id === p.id) {
      const d = is.policy.ded;
      o += `<p class="r-small">This policy year (${esc(D(d.yearStart))} – ${esc(D(d.yearEnd))}): deductible met ${esc(MW(d.met))} of ${esc(MW(d.deductible))}; ${d.limit ? `limit used ${esc(MW(d.used))} of ${esc(MW(d.limit))}` : `paid out ${esc(MW(d.used))} (no annual limit)`}.</p>`;
    }
  });
  const rc = data.premiumChanges.filter((c) => ctx.policies.some((p) => p.id === c.policyId)).sort(byDate('date'));
  if (rc.length) o += '<h3>Premium history</h3>' + rTable([
    { l: 'Effective', f: (c) => D(c.date) }, { l: 'Policy', f: (c) => policyLabel(data.policies.find((p) => p.id === c.policyId) || {}) }, { l: 'New premium', n: true, f: (c) => M(num(c.amount)) },
    { l: 'Change', n: true, f: (c) => { const p = data.policies.find((x) => x.id === c.policyId); const prev = p ? rateAt(ctx, p, addDays(c.date, -1)) : 0; return prev ? `${num(c.amount) >= prev ? '+' : ''}${fmtPct((num(c.amount) - prev) / prev, 1)}` : ''; } }, { l: 'Reason', f: (c) => c.reason }], rc);
  const tone = { approved: 'good', partial: 'warn', denied: 'bad', submitted: 'info', review: 'info', draft: '' };
  o += '<h2>Claims</h2>' + rTable([
    { l: 'Treatment', f: (c) => D(c.serviceDate), w: '11%' }, isPlan ? { l: 'Pet', f: (c) => petName(c.petId), w: '9%' } : null, { l: 'Condition', f: (c) => c.condition },
    { l: 'Claimed', n: true, f: (c) => M(num(c.amountClaimed)) }, { l: 'Deductible', n: true, f: (c) => hasVal(c.deductibleApplied) ? M(num(c.deductibleApplied)) : '' },
    { l: 'Paid', n: true, f: (c) => PAID.includes(c.status) ? M(num(c.reimbursed)) : PENDING.includes(c.status) && is.pendingPer[c.id] != null ? `~${M(is.pendingPer[c.id])}` : '' },
    { l: 'Status', html: true, f: (c) => rPill(CLAIM_STATUS[c.status], tone[c.status]) + (c.denialReason && c.status === 'denied' ? ` <span class="r-small r-muted">${esc(c.denialReason)}</span>` : '') },
    { l: 'Sent → paid', f: (c) => c.submittedDate ? `${D(c.submittedDate)}${c.paidDate ? ` → ${D(c.paidDate)}` : ''}` : '' },
  ].filter(Boolean), is.claims.slice().sort(byDate('serviceDate')), 'No claims in this period.');
  if (is.unclaimed.length) o += '<h3>Visits with no claim recorded</h3>' + rTable([{ l: 'Date', f: (x) => D(x.date) }, isPlan ? { l: 'Pet', f: (x) => petLabel(x._pet) } : null, { l: 'Reason', f: (x) => x.reason }, { l: 'Cost', n: true, f: (x) => M(num(x.cost)) }].filter(Boolean), is.unclaimed);
  const terms = ['premium', 'deductible', 'reimbursement', 'annualLimit', 'eligible', 'eob', 'policyYear', 'returnRatio', 'netBenefit', 'breakEven', 'outOfPocket', 'pending', 'approvalRate'];
  o += `<h2>Appendix: how this summary was calculated</h2><div class="r-appendix"><ul>
    <li><b>Premiums paid</b>: one payment per billing date (${'monthly or yearly'}) from the policy start to the end of the period, at the premium in force on that date.${!isPlan && sharedPolicies(data, pet).length ? ` Multi-pet premiums are multiplied by ${esc(petLabel(pet))}’s share.` : ''}</li>
    <li><b>Reimbursed</b>: amount paid on claims marked Paid or Partly paid, by date of treatment.</li>
    <li><b>Pending estimate</b>: (eligible or claimed amount − deductible still to meet) × reimbursement rate, capped at the annual limit left. ${s.includePending ? 'Included' : 'Not included'} in the verdict.</li>
    <li><b>Net benefit</b> = reimbursed${s.includePending ? ' + pending estimate' : ''} − premiums. <b>Return per 1 paid</b> = the same total ÷ premiums.</li>
    <li><b>Out of pocket</b> = vet bills while insured − reimbursed + premiums, compared with the vet bills alone.</li>
    <li><b>Break-even spending</b> = yearly premium ÷ reimbursement rate + deductible.</li>
    <li><b>Verdict</b>: paying off at a return of ${fmtNum(s.goodRatio, 2)} or more; partly paying off from ${fmtNum(s.fairRatio, 2)}; below that, costing more than it returns. Emergency example: ${esc(MW(num(s.emergencyExample)))}.</li></ul>
    <h3>Terms</h3><dl>${terms.map((k) => `<dt>${esc(GLOSSARY[k][0])}</dt><dd>${esc(GLOSSARY[k][1])}</dd>`).join('')}</dl></div>
    <div class="r-disclaimer">Produced by Pet Dashboard for Obsidian from the records you entered. It is not financial advice; check figures against your insurer’s statements.</div>`;
  return `<section class="r-report">${o}</section>`;
}

function summaryReportHTML(data, pet, range, ctx) {
  const s = data.settings, D = (d) => fmtDate(d, s.dateFormat), MW = (n) => fmtMoney(n, s.currency, true);
  const hs = healthStats(pet, s, range), is = insuranceStats(ctx, s, analysisRange(ctx, s, 'all'));
  let o = rHead(`${petLabel(pet)} — pet summary`, [`<b>Pet:</b> ${esc([pet.species, pet.breed, pet.sex, ageLabel(pet)].filter(Boolean).join(' · '))}`,
    s.ownerName ? `<b>Owner:</b> ${esc(s.ownerName)}` : '', isArchived(pet) ? `<b>${esc(archiveVerb(pet))}:</b> ${esc(pet.archivedDate ? D(pet.archivedDate) : '')}` : '', `<b>Report period:</b> ${esc(D(range.from))} – ${esc(D(range.to))}`, `Created ${esc(D(todayISO()))}`], [pet.id]);
  const vc = [['Primary vet', [pet.primaryVet, pet.vetPhone, pet.vetAddress].filter(Boolean).join(' · ')], ['Emergency vet', [pet.emergencyVet, pet.emergencyPhone, pet.emergencyAddress].filter(Boolean).join(' · ')]];
  if (vc.some((x) => x[1])) o += rKV(vc);
  o += '<h3>Contents</h3><table class="r-contents"><tbody><tr><td>Summary</td><td>this page</td></tr><tr><td>Health report</td><td>visits, medications, vaccines, weight, observations</td></tr><tr><td>Insurance summary</td><td>verdict, claims, premiums, policy details</td></tr></tbody></table>';
  o += '<h2>Health</h2>' + rTiles([
    { l: 'Last visit', v: hs.last ? D(hs.last.date) : '–', s: hs.last ? hs.last.reason : '' },
    { l: 'Next visit', v: hs.nextAppt ? D(hs.nextAppt.date) : 'None booked', s: hs.nextAppt ? hs.nextAppt.text : '' },
    { l: 'Visits in period', v: String(hs.visitsR.length), s: `${MW(hs.spend)} spent` },
    { l: 'Taking now', v: String(hs.meds.length), s: hs.meds.map((m) => m.name).slice(0, 3).join(', ') },
    { l: 'Vaccines', v: hs.overdue.length ? `${hs.overdue.length} overdue` : hs.dueSoon.length ? `${hs.dueSoon.length} due soon` : 'Up to date', s: `${hs.vacc.length} tracked`, tone: hs.overdue.length ? 'bad' : hs.dueSoon.length ? 'warn' : 'good' },
    { l: 'Latest weight', v: hs.latestW ? `${fmtNum(num(hs.latestW.weight))} ${s.weightUnit}` : '–', s: hs.latestW ? D(hs.latestW.date) : '' },
  ]);
  o += '<h2>Insurance</h2>';
  if (is.hasPolicy) {
    o += `<div class="r-verdict ${is.verdict.level}"><div class="k">${esc(ctx.kind === 'plan' ? `${ctx.name} · whole plan (${ctx.petsCovered.map(petLabel).join(', ')})` : 'Is the insurance worth it?')}</div><div class="t">${esc(is.verdict.label)}</div><p>${esc(is.verdict.text)}</p></div>`;
    o += rTiles([{ l: 'Premiums paid', v: MW(is.premiums), s: 'since coverage began' }, { l: 'Reimbursed', v: MW(is.reimbursed), s: `${is.paid.length} paid claims` },
      { l: 'Net benefit', v: (is.net >= 0 ? '+' : '−') + MW(Math.abs(is.net)), tone: is.net >= 0 ? 'good' : 'bad' }]);
  } else o += '<p class="r-muted">No insurance policy recorded.</p>';
  const notes = hs.discuss.concat(is.review);
  o += rBox('Things to follow up', notes);
  return `<section class="r-report">${o}</section>`;
}

function reportDocument(title, bodyHtml, opts = {}) {
  const page = opts.fallback ? `@page{size:${opts.pageSize || 'Letter'};margin:0.55in 0.55in 0.7in;@bottom-left{content:"${opts.footer.replace(/"/g, '')}";font-size:7.5pt;color:#777}@bottom-right{content:"Page " counter(page) " of " counter(pages);font-size:7.5pt;color:#777}}` : '';
  return `<!doctype html><html><head><meta charset="utf-8"><title>${esc(title)}</title><style>${page}${REPORT_CSS}</style></head><body>${bodyHtml}</body></html>`;
}

async function createReport(plugin, pet, kind, range, ctx) {
  const data = plugin.data, s = data.settings;
  R_PHOTOS = {};
  for (const p of data.pets) { const u = await plugin.photoDataUrl(p); if (u) R_PHOTOS[p.id] = u; }
  let body, title, footer;
  if (kind === 'insurance') { body = insuranceReportHTML(data, pet, range, ctx); title = 'Insurance summary'; footer = `Pet insurance summary · ${petLabel(pet)} · from your own records, not financial advice`; }
  else if (kind === 'full') { body = summaryReportHTML(data, pet, range, ctx) + healthReportHTML(data, pet, range) + insuranceReportHTML(data, pet, range, ctx); title = 'Full report'; footer = `Pet report · ${petLabel(pet)} · owner-recorded · for discussion with your veterinarian`; }
  else { body = healthReportHTML(data, pet, range); title = 'Health report'; footer = `Pet health report · ${petLabel(pet)} · owner-recorded · for discussion with your veterinarian, not a diagnosis`; }
  const name = `${petLabel(pet)} – ${title} – ${todayISO()}`;
  await exportPdf(plugin, title, body, name, footer);
}

function footerTemplate(footer) {
  return `<div style="font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;font-size:7.5px;color:#777;width:100%;padding:0 0.55in;display:flex;justify-content:space-between"><span>${esc(footer)}</span><span>Page <span class="pageNumber"></span> of <span class="totalPages"></span></span></div>`;
}

async function exportPdf(plugin, title, body, baseName, footer) {
  const s = plugin.data.settings;
  let remote = null;
  try { const el = require('electron'); remote = el.remote || null; } catch (e) { }
  if (!remote) { try { remote = require('@electron/remote'); } catch (e) { } }
  if (remote && remote.BrowserWindow) {
    const notice = new Notice('Creating PDF…', 0);
    const win = new remote.BrowserWindow({ show: false, webPreferences: { javascript: false } });
    try {
      await win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(reportDocument(title, body, { footer })));
      const buf = await win.webContents.printToPDF({
        pageSize: s.pageSize || 'Letter', printBackground: true, displayHeaderFooter: true,
        headerTemplate: '<span></span>', footerTemplate: footerTemplate(footer),
        margins: { top: 0.55, bottom: 0.7, left: 0.55, right: 0.55 },
      });
      const file = await saveToVault(plugin, baseName, 'pdf', buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
      notice.hide(); new Notice(`Saved ${file.path}`);
      if (s.openAfterExport) await plugin.app.workspace.getLeaf('tab').openFile(file);
      return;
    } catch (e) {
      notice.hide(); console.error('Pet Dashboard: PDF export failed, falling back to print dialog', e);
    } finally { try { win.destroy(); } catch (e) { } }
  }
  printViaIframe(reportDocument(title, body, { fallback: true, footer, pageSize: s.pageSize }));
}

async function ensureFolder(plugin, folderPath) {
  const vault = plugin.app.vault, folder = normalizePath((folderPath || '').trim() || '/');
  if (folder && folder !== '/') {
    let acc = '';
    for (const part of folder.split('/')) { acc = acc ? acc + '/' + part : part; if (!vault.getAbstractFileByPath(acc)) await vault.createFolder(acc); }
  }
  return folder;
}
async function saveToVault(plugin, baseName, ext, arrayBuffer) {
  const vault = plugin.app.vault;
  const folder = await ensureFolder(plugin, plugin.data.settings.pdfFolder || 'Pet Dashboard/Reports');
  const safe = baseName.replace(/[\\/:*?"<>|#^[\]]/g, '-');
  let path = normalizePath(`${folder}/${safe}.${ext}`), i = 2;
  while (vault.getAbstractFileByPath(path)) path = normalizePath(`${folder}/${safe} (${i++}).${ext}`);
  return vault.createBinary(path, arrayBuffer);
}

function printViaIframe(html) {
  const f = document.createElement('iframe');
  f.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;';
  document.body.appendChild(f);
  const d = f.contentWindow.document; d.open(); d.write(html); d.close();
  setTimeout(() => { try { f.contentWindow.focus(); f.contentWindow.print(); } catch (e) { new Notice('Could not open the print dialog.'); } setTimeout(() => f.remove(), 2000); }, 300);
  new Notice('Choose “Save as PDF” in the print dialog.');
}
