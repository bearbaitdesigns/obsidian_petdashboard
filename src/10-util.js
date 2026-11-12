'use strict';
const obsidian = require('obsidian');
const { Plugin, ItemView, Modal, Notice, PluginSettingTab, Setting, setIcon, normalizePath } = obsidian;
const VIEW_TYPE = 'pet-dashboard-view';

/* ---------------- generic helpers ---------------- */
const DAY = 86400000;
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
const pad = (n) => String(n).padStart(2, '0');
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function toISO(d) { return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; }
function parseISO(s) {
  if (!s) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(s));
  return m ? new Date(+m[1], +m[2] - 1, +m[3]) : null;
}
let TODAY_OVERRIDE = null; // set only while the What-if simulator projects forward
function todayISO() { return TODAY_OVERRIDE || toISO(new Date()); }
function addDays(iso, n) { const d = parseISO(iso); d.setDate(d.getDate() + n); return toISO(d); }
function addMonths(iso, n) {
  const d = parseISO(iso); const day = d.getDate();
  d.setDate(1); d.setMonth(d.getMonth() + n);
  const last = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
  d.setDate(Math.min(day, last)); return toISO(d);
}
function daysBetween(a, b) { return Math.round((parseISO(b) - parseISO(a)) / DAY); }
function monthsBetween(a, b) { return daysBetween(a, b) / 30.44; }
function monthKey(iso) { return iso.slice(0, 7); }
function monthLabel(key, withYear) { const [y, m] = key.split('-'); return MONTHS[+m - 1] + (withYear ? ' ' + y : ''); }

function fmtDate(iso, fmt) {
  const d = parseISO(iso); if (!d) return '–';
  const D = d.getDate(), M = d.getMonth(), Y = d.getFullYear();
  switch (fmt) {
    case 'D MMM YYYY': return `${D} ${MONTHS[M]} ${Y}`;
    case 'YYYY-MM-DD': return toISO(d);
    case 'MM/DD/YYYY': return `${pad(M + 1)}/${pad(D)}/${Y}`;
    case 'DD/MM/YYYY': return `${pad(D)}/${pad(M + 1)}/${Y}`;
    default: return `${MONTHS[M]} ${D}, ${Y}`;
  }
}
function num(v) {
  if (v === '' || v == null) return 0;
  const n = typeof v === 'number' ? v : parseFloat(String(v).replace(/[^0-9.\-]/g, ''));
  return isFinite(n) ? n : 0;
}
function hasVal(v) { return v !== '' && v != null && !(typeof v === 'number' && isNaN(v)); }
function sum(arr, f) { return arr.reduce((a, x) => a + num(f == null ? x : typeof f === 'function' ? f(x) : x[f]), 0); }
function fmtMoney(n, cur, whole) {
  try {
    return new Intl.NumberFormat(undefined, { style: 'currency', currency: cur || 'USD',
      minimumFractionDigits: whole ? 0 : 2, maximumFractionDigits: whole ? 0 : 2 }).format(n || 0);
  } catch (e) { return (cur || '$') + ' ' + (n || 0).toFixed(whole ? 0 : 2); }
}
function fmtNum(n, dp = 1) { return (Math.round(n * Math.pow(10, dp)) / Math.pow(10, dp)).toLocaleString(undefined, { maximumFractionDigits: dp }); }
function fmtPct(r, dp = 0) { return r == null || !isFinite(r) ? '–' : (r * 100).toFixed(dp) + '%'; }
function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
function plural(n, w, p) { return `${n} ${n === 1 ? w : (p || w + 's')}`; }
function byDate(key, desc) { return (a, b) => desc ? String(b[key] || '').localeCompare(String(a[key] || '')) : String(a[key] || '').localeCompare(String(b[key] || '')); }

function ageText(dob, asOf) {
  if (!dob) return '';
  const t = asOf || todayISO(); let m = 0;
  while (addMonths(dob, m + 1) <= t) m++;
  const y = Math.floor(m / 12), mo = m % 12;
  if (y === 0) return plural(mo, 'month');
  return mo ? `${plural(y, 'year')}, ${plural(mo, 'month')}` : plural(y, 'year');
}

/* DOM builder */
function h(tag, a, ...kids) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(a || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') e.className = v;
    else if (k === 'text') e.textContent = v;
    else if (k === 'html') e.innerHTML = v;
    else if (k.startsWith('on') && typeof v === 'function') e.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'style' && typeof v === 'object') Object.assign(e.style, v);
    else e.setAttribute(k, v === true ? '' : v);
  }
  for (const c of kids.flat(Infinity)) {
    if (c == null || c === false) continue;
    e.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return e;
}
function clear(el) { while (el.firstChild) el.removeChild(el.firstChild); }
function icon(name, cls) { const s = h('span', { class: 'pd-icon ' + (cls || '') }); try { setIcon(s, name); } catch (e) { } return s; }
function btn(label, onClick, opts = {}) {
  const b = h('button', { class: 'pd-btn ' + (opts.cls || ''), title: opts.title, 'aria-label': opts.title || label, type: 'button' });
  if (opts.icon) b.append(icon(opts.icon));
  if (label) b.append(h('span', { text: label }));
  b.addEventListener('click', (ev) => { ev.preventDefault(); ev.stopPropagation(); onClick(ev); });
  return b;
}

/* ---------------- glossary + tooltips ---------------- */
const GLOSSARY = {
  premium: ['Premium', 'The fee you pay the insurer to keep the policy active, usually monthly or yearly. You pay it whether or not you make a claim.'],
  deductible: ['Deductible', 'The amount of eligible vet bills you pay yourself before the insurer starts paying you back. Most pet policies reset it every policy year.'],
  deductibleType: ['Deductible type', 'Annual: resets each policy year. Per condition: paid once for each new illness or injury. Per incident: paid for each claim. Lifetime: paid once per condition for the life of the policy.'],
  reimbursement: ['Reimbursement rate', 'The share of an eligible bill the insurer pays back after the deductible. At 80% you get 80 back on an eligible bill of 100 and pay 20 yourself.'],
  coinsurance: ['Co-insurance', 'Your share of an eligible bill after the deductible: 100% minus the reimbursement rate.'],
  annualLimit: ['Annual limit', 'The most the insurer will pay in one policy year. Anything above it is yours to pay. Leave it at 0 for an unlimited plan.'],
  waitingPeriod: ['Waiting period', 'Days after the policy starts before claims are accepted. Problems that start during this time are usually treated as pre-existing.'],
  preExisting: ['Pre-existing condition', 'An illness or injury that showed signs before coverage started or during the waiting period. Most policies will not pay for these.'],
  claim: ['Claim', 'A request you send the insurer, with the vet invoice, asking to be paid back for a visit.'],
  eob: ['Explanation of benefits (EOB)', 'The statement the insurer sends after reviewing a claim. It shows what was eligible, how much deductible was taken and what they paid.'],
  eligible: ['Eligible amount', 'The part of a vet bill the policy covers. Exam fees, wellness care or excluded conditions may not be eligible.'],
  deductibleApplied: ['Deductible applied', 'How much of this claim went toward your deductible. It is on the explanation of benefits. Leave blank and the dashboard estimates it.'],
  policyYear: ['Policy year', 'The 12 months from the policy start date or its anniversary. Deductibles and annual limits usually reset at the start of each policy year.'],
  exclusion: ['Exclusion', 'Something the policy specifically does not pay for, such as pre-existing conditions, breeding or cosmetic procedures.'],
  wellness: ['Wellness care', 'Routine care such as check-ups, vaccines and flea prevention. Accident-and-illness plans usually do not cover it unless you add a wellness plan.'],
  returnRatio: ['Return per 1 paid', 'What you have got back for every 1 paid in premiums. 1.00 is break-even; above 1 means the insurance has paid out more than it cost.'],
  netBenefit: ['Net benefit', 'Reimbursements minus premiums paid. Positive means insurance has saved you money so far; negative means it has cost more than it returned.'],
  breakEven: ['Break-even vet spending', 'How much eligible vet spending in a policy year it takes for the reimbursement to equal that year\'s premiums.'],
  coverage: ['Share of vet bills covered', 'The part of your vet bills (from visits while insured) that the insurer paid back.'],
  outOfPocket: ['Out-of-pocket cost', 'What you really spent: vet bills minus reimbursements, plus premiums.'],
  pending: ['Pending claims', 'Claims sent but not yet paid or denied. The estimate applies your remaining deductible and reimbursement rate.'],
  turnaround: ['Days to pay', 'Average days from sending a claim to getting the money.'],
  unclaimed: ['Possibly unclaimed', 'Vet visits during your coverage that have a cost but no claim recorded. Check your policy\'s claim deadline; many allow a few months.'],
  renewal: ['Renewal', 'The date the policy renews for another year. Premiums often change at renewal.'],
  approvalRate: ['Approval rate', 'Share of decided claims that were paid in full or in part.'],
  emergencyExample: ['Emergency example', 'A sample large vet bill used to show what insurance would save you in a bad year.'],
  prn: ['As needed (PRN)', 'Given only when symptoms occur, rather than on a fixed schedule.'],
  nextDue: ['Next due', 'When the vet says the vaccine or booster should be given again.'],
  microchip: ['Microchip', 'A rice-sized ID chip under the skin. The number links to your contact details in a registry; keep the registration up to date.'],
  followUp: ['Follow-up', 'A recheck the vet asked for after a visit.'],
  refill: ['Refill due', 'The date the current supply will run out, so you can reorder in time.'],
  bcs: ['Weight change', 'Change between the first and latest weight in the period. Gradual change is normal for young animals; unplanned change of 5% or more in adults is worth mentioning to your vet.'],
};

const Tip = {
  el: null,
  show(target) {
    const def = target.getAttribute('data-tip'); if (!def) return;
    this.hide();
    const doc = target.ownerDocument;
    this.el = doc.createElement('div'); this.el.className = 'pd-tooltip'; this.el.textContent = def;
    doc.body.appendChild(this.el);
    const r = target.getBoundingClientRect(), tr = this.el.getBoundingClientRect();
    let left = Math.min(Math.max(8, r.left + r.width / 2 - tr.width / 2), doc.documentElement.clientWidth - tr.width - 8);
    let top = r.top - tr.height - 8;
    if (top < 8) top = r.bottom + 8;
    this.el.style.left = left + 'px'; this.el.style.top = top + 'px';
  },
  hide() { if (this.el) { this.el.remove(); this.el = null; } },
};
function term(key, label) {
  const g = GLOSSARY[key];
  if (!g) return label || key;
  const s = h('span', { class: 'pd-term', tabindex: '0', 'data-tip': g[1], 'aria-label': `${label || g[0]}: ${g[1]}` }, label || g[0]);
  s.addEventListener('mouseenter', () => Tip.show(s));
  s.addEventListener('mouseleave', () => Tip.hide());
  s.addEventListener('focus', () => Tip.show(s));
  s.addEventListener('blur', () => Tip.hide());
  return s;
}
