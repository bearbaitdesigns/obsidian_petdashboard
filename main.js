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
  totalCost: ['Your total cost', 'Everything you paid for vet care over the period: vet bills plus premiums, minus what insurance paid back (and the pending estimate, if counted).'],
  limitLeft: ['Annual limit left', 'How much more the insurer would pay this policy year before the annual limit is reached.'],
  runningNet: ['Running net benefit', 'Reimbursements so far minus premiums so far. Above zero, the insurance has paid back more than it cost.'],
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
/* ---------------- data model ---------------- */
const DEFAULT_SETTINGS = {
  currency: 'USD',
  dateFormat: 'MMM D, YYYY',
  weightUnit: 'lb',
  analysisPeriod: 'all',      // all | 12m | policyYear | ytd
  goodRatio: 1.0,
  fairRatio: 0.5,
  includePending: true,
  emergencyExample: 5000,
  pdfFolder: 'Pet Dashboard/Reports',
  pageSize: 'Letter',
  openAfterExport: true,
  ownerName: '',
  photoSize: 'medium',        // small | medium | large
  photoFolder: 'Pet Dashboard/Photos',
  speciesList: ['Dog', 'Cat', 'Rabbit', 'Bird', 'Guinea pig', 'Hamster', 'Ferret', 'Fish', 'Turtle', 'Lizard', 'Snake', 'Horse'],
};
/* per-pet lists; policies, premium changes and claims are household-level */
const LIST_KEYS = ['visits', 'meds', 'vaccines', 'weights', 'observations', 'notes'];

function newPet(name) {
  const p = { id: uid(), name: name || '', species: 'Dog', breed: '', sex: '', dob: '', color: '', microchip: '',
    primaryVet: '', vetPhone: '', vetAddress: '', emergencyVet: '', emergencyPhone: '', emergencyAddress: '', allergies: '', conditions: '', titleMode: 'default', customTitle: '', photo: '', archived: false, archivedDate: '', archiveReason: '', archiveNote: '' };
  LIST_KEYS.forEach((k) => (p[k] = []));
  return p;
}
function normalizeData(raw) {
  const d = Object.assign({ pets: [], activePetId: null, settings: {}, policies: [], premiumChanges: [], claims: [] }, raw || {});
  d.settings = Object.assign({}, DEFAULT_SETTINGS, d.settings || {});
  ['policies', 'premiumChanges', 'claims'].forEach((k) => { if (!Array.isArray(d[k])) d[k] = []; });
  d.pets = (d.pets || []).map((p) => {
    const out = Object.assign(newPet(), p);
    LIST_KEYS.forEach((k) => { if (!Array.isArray(out[k])) out[k] = []; });
    // migrate older per-pet insurance lists
    (out.policies || []).forEach((x) => { if (!x.petIds) x.petIds = [out.id]; d.policies.push(x); });
    (out.premiumChanges || []).forEach((x) => d.premiumChanges.push(x));
    (out.claims || []).forEach((x) => { x.petId = x.petId || out.id; d.claims.push(x); });
    delete out.policies; delete out.premiumChanges; delete out.claims;
    return out;
  });
  d.policies.forEach((p) => { if (!Array.isArray(p.petIds)) p.petIds = []; if (!p.split) p.split = 'equal'; if (!p.shares) p.shares = {}; });
  if (!d.whatIf || !Array.isArray(d.whatIf.scenarios)) d.whatIf = { scenarios: [], selected: 'base', horizon: '12m' };
  if (!d.pets.length) d.pets.push(newPet(''));
  if (!d.pets.find((p) => p.id === d.activePetId)) d.activePetId = d.pets[0].id;
  return d;
}
function dashboardTitle(pet) {
  if (!pet) return 'Pet Dashboard';
  if (pet.titleMode === 'custom' && pet.customTitle) return pet.customTitle;
  if (pet.titleMode === 'pet' && pet.name) return `${pet.name} Dashboard`;
  return 'Pet Dashboard';
}
/* age: exact birth date, or an estimate (years + months as of a date) that keeps counting up */
function birthInfo(pet) {
  if (pet.dobMode === 'estimated' && (num(pet.ageYears) || num(pet.ageMonths))) {
    const asOf = pet.ageAsOf || todayISO();
    return { dob: addMonths(asOf, -Math.round(num(pet.ageYears) * 12 + num(pet.ageMonths))), estimated: true, asOf };
  }
  return pet.dob ? { dob: pet.dob, estimated: false } : null;
}
/* archived pets: history kept, reminders stop, age stops at the archive date */
function isArchived(pet) { return !!(pet && pet.archived); }
function refDate(pet) { const t = todayISO(); return isArchived(pet) && pet.archivedDate && pet.archivedDate < t ? pet.archivedDate : t; }
function archiveVerb(pet) { return ({ passed: 'Crossed rainbow bridge', rehomed: 'Rehomed', lost: 'Lost', other: 'Archived' })[pet.archiveReason] || 'Archived'; }
function ageLabel(pet) {
  const b = birthInfo(pet); if (!b) return '';
  const a = ageText(b.dob, refDate(pet)), est = b.estimated;
  if (isArchived(pet)) return `${est ? 'about ' : ''}${a}${est ? ' (estimated)' : ''} ${pet.archiveReason === 'passed' ? 'when they crossed the rainbow bridge' : 'when archived'}`;
  return est ? `about ${a} (estimated)` : a;
}
function ageShort(pet) { const b = birthInfo(pet); if (!b) return ''; const a = ageText(b.dob, refDate(pet)); return (b.estimated ? '~' : '') + a + (isArchived(pet) ? ' †' : ''); }
function bornLabel(pet, fmt) {
  const b = birthInfo(pet); if (!b) return '';
  return b.estimated ? `Date of birth unknown · born around ${MONTHS[parseISO(b.dob).getMonth()]} ${parseISO(b.dob).getFullYear()} (age estimated on ${fmtDate(b.asOf, fmt)})` : fmtDate(b.dob, fmt);
}
/* What deleting a pet would remove, and the removal itself */
function deletePlan(data, pet) {
  const own = data.policies.filter((p) => p.petIds.includes(pet.id) && p.petIds.filter((id) => data.pets.some((x) => x.id === id)).length === 1);
  const shared = data.policies.filter((p) => p.petIds.includes(pet.id) && !own.includes(p));
  const claims = data.claims.filter((c) => c.petId === pet.id);
  const sc = ((data.whatIf && data.whatIf.scenarios) || []).filter((s) => (s.events || []).some((e) => wiEventUsesPet(e, pet, claims)));
  return { own, shared, claims, scenarios: sc, counts: { visits: pet.visits.length, meds: pet.meds.length, vaccines: pet.vaccines.length, weights: pet.weights.length, observations: pet.observations.length, notes: pet.notes.length } };
}
function wiEventUsesPet(e, pet, claims) {
  return e.petId === pet.id || e.who === pet.id || (e.claimId && e.claimId !== '*open*' && claims.some((c) => c.id === e.claimId));
}
function deletePetData(data, pet) {
  const plan = deletePlan(data, pet), ownIds = new Set(plan.own.map((p) => p.id)), claimIds = new Set(plan.claims.map((c) => c.id));
  data.policies = data.policies.filter((p) => !ownIds.has(p.id));
  data.premiumChanges = data.premiumChanges.filter((c) => !ownIds.has(c.policyId));
  data.policies.forEach((p) => {
    p.petIds = p.petIds.filter((id) => id !== pet.id);
    ['shares', 'petStart', 'petEnd'].forEach((k) => { if (p[k]) delete p[k][pet.id]; });
  });
  data.claims = data.claims.filter((c) => c.petId !== pet.id && !ownIds.has(c.policyId));
  const st = data.whatIf;
  if (st && Array.isArray(st.scenarios)) st.scenarios.forEach((s) => { s.events = (s.events || []).filter((e) => !wiEventUsesPet(e, pet, plan.claims) && !(e.claimId && claimIds.has(e.claimId))); });
  data.pets = data.pets.filter((p) => p.id !== pet.id);
  if (!data.pets.length) data.pets.push(newPet(''));
  if (!data.pets.some((p) => p.id === data.activePetId)) data.activePetId = (data.pets.find((p) => !isArchived(p)) || data.pets[0]).id;
  return plan;
}
function petLabel(pet) { return (pet && pet.name) || 'Unnamed pet'; }
function policyLabel(p) { return `${p.provider || 'Policy'}${p.plan ? ' – ' + p.plan : ''}`; }

const CLAIM_STATUS = {
  draft: 'Not sent', submitted: 'Submitted', review: 'In review', approved: 'Paid', partial: 'Partly paid', denied: 'Denied',
};
const PAID = ['approved', 'partial'];
const PENDING = ['submitted', 'review'];

/* ---------------- insurance context ----------------
   A context is either one pet (its share of every policy covering it) or one
   whole policy (all pets on it). All insurance maths runs on a context. */
/* each pet can join a policy after it starts, and leave before it ends */
function petJoin(policy, petId) { const j = policy.petStart && policy.petStart[petId]; return j && j > policy.start ? j : policy.start; }
function petLeave(policy, petId) { const e = policy.petEnd && policy.petEnd[petId]; return e && (!policy.end || e < policy.end) ? e : (policy.end || ''); }
function petOnPolicyAt(policy, petId, iso) {
  if (!policy.petIds.includes(petId) || !activeOn(policy, iso)) return false;
  const l = petLeave(policy, petId); return petJoin(policy, petId) <= iso && (!l || l >= iso);
}
function policyShare(data, policy, petId, iso) {
  const d = iso || todayISO();
  let ids = policy.petIds.filter((id) => data.pets.some((p) => p.id === id));
  const act = ids.filter((id) => { const l = petLeave(policy, id); return petJoin(policy, id) <= d && (!l || l >= d); });
  if (act.length) ids = act; else if (d >= policy.start && (!policy.end || d <= policy.end)) return 0;
  if (!ids.includes(petId)) return 0;
  if (policy.split === 'custom') {
    const tot = ids.reduce((a, id) => a + num(policy.shares[id]), 0);
    if (tot > 0) return num(policy.shares[petId]) / tot;
  }
  return 1 / ids.length;
}
function petsOnPolicy(data, policy) { return data.pets.filter((p) => policy.petIds.includes(p.id)); }
function petCtx(data, pet) {
  return {
    kind: 'pet', data, pet, id: pet.id, name: petLabel(pet),
    policies: data.policies.filter((p) => p.petIds.includes(pet.id)),
    premiumChanges: data.premiumChanges,
    claims: data.claims.filter((c) => c.petId === pet.id),
    visits: pet.visits.map((v) => Object.assign({ _pet: pet }, v, { _ref: v })),
    share: (p, iso) => policyShare(data, p, pet.id, iso),
    petsCovered: [pet],
  };
}
function planCtx(data, policy) {
  const pets = petsOnPolicy(data, policy);
  return {
    kind: 'plan', data, policy, id: policy.id, name: policyLabel(policy),
    policies: [policy], premiumChanges: data.premiumChanges,
    claims: data.claims.filter((c) => c.policyId === policy.id),
    visits: pets.flatMap((pt) => pt.visits.map((v) => Object.assign({ _pet: pt }, v, { _ref: v }))),
    share: () => 1, petsCovered: pets,
  };
}
function sharedPolicies(data, pet) { return data.policies.filter((p) => p.petIds.includes(pet.id) && petsOnPolicy(data, p).length > 1); }

/* ---------------- insurance calculations ---------------- */
function activeOn(p, iso) { return p.start && p.start <= iso && (!p.end || p.end >= iso); }
function coveringPolicy(ctx, iso, petId) {
  const pid = petId || (ctx.kind === 'pet' ? ctx.pet.id : null);
  return ctx.policies.filter((p) => (pid ? petOnPolicyAt(p, pid, iso) : activeOn(p, iso))).sort(byDate('start', true))[0] || null;
}
function currentPolicy(ctx) {
  return coveringPolicy(ctx, todayISO()) || ctx.policies.slice().sort(byDate('start', true))[0] || null;
}
function rateAt(ctx, policy, iso) {
  const ch = ctx.premiumChanges.filter((c) => c.policyId === policy.id && c.date && c.date <= iso).sort(byDate('date'));
  return ch.length ? num(ch[ch.length - 1].amount) : num(policy.premium);
}
function annualPremium(ctx, policy, iso) {
  const r = rateAt(ctx, policy, iso) * ctx.share(policy, iso);
  return policy.frequency === 'annual' ? r : r * 12;
}
function billingDates(policy, from, to) {
  if (!policy.start) return [];
  const step = policy.frequency === 'annual' ? 12 : 1;
  const stop = [to, policy.end || '9999-12-31', todayISO()].sort()[0];
  const out = []; let i = 0, d = policy.start;
  while (d <= stop && i < 2400) { if (d >= from) out.push(d); i++; d = addMonths(policy.start, i * step); }
  return out;
}
function premiumPayments(ctx, from, to) {
  return ctx.policies.flatMap((p) => billingDates(p, from, to).map((d) => ({ date: d, amount: rateAt(ctx, p, d) * ctx.share(p, d), full: rateAt(ctx, p, d), policyId: p.id })))
    .filter((x) => ctx.kind === 'plan' || x.amount > 0);
}
function policyYearStart(policy, iso) {
  let i = 0;
  while (addMonths(policy.start, (i + 1) * 12) <= iso && i < 200) i++;
  return addMonths(policy.start, i * 12);
}
function nextRenewal(policy) {
  if (!policy || !policy.start) return null;
  const t = todayISO(); let i = 1;
  while (addMonths(policy.start, i * 12) <= t && i < 200) i++;
  const r = addMonths(policy.start, i * 12);
  return policy.end && r > policy.end ? null : r;
}
function dedUse(policy, claims) {
  const cl = claims.filter((c) => c.status !== 'denied' && c.status !== 'draft');
  const ded = num(policy.deductible);
  const explicit = cl.filter((c) => hasVal(c.deductibleApplied));
  const met = Math.min(ded, explicit.length ? sum(explicit, 'deductibleApplied') : sum(cl, 'amountClaimed'));
  return { met, used: sum(cl.filter((c) => PAID.includes(c.status)), 'reimbursed') };
}
/* deductible + limit for the policy year containing iso.
   petId given: that pet's view (shared scopes count every pet's claims). */
function deductibleStatus(data, policy, iso, petId) {
  const ys = policyYearStart(policy, iso), ye = addDays(addMonths(ys, 12), -1);
  const all = data.claims.filter((c) => c.policyId === policy.id && c.serviceDate >= ys && c.serviceDate <= ye);
  const pets = petsOnPolicy(data, policy), ded = num(policy.deductible), lim = num(policy.annualLimit);
  const dedShared = policy.deductibleScope === 'shared', limShared = policy.limitScope === 'shared';
  const per = pets.map((pt) => { const u = dedUse(policy, all.filter((c) => c.petId === pt.id)); return { pet: pt, met: u.met, used: u.used }; });
  const tot = dedUse(policy, all);
  let deductible, met, limit, used;
  if (petId) {
    const mine = per.find((x) => x.pet.id === petId) || { met: 0, used: 0 };
    deductible = ded; met = dedShared ? tot.met : mine.met;
    limit = lim; used = limShared ? tot.used : mine.used;
  } else {
    deductible = dedShared ? ded : ded * pets.length; met = dedShared ? tot.met : sum(per, 'met');
    limit = lim ? (limShared ? lim : lim * pets.length) : 0; used = tot.used;
  }
  return { yearStart: ys, yearEnd: ye, deductible, met, remaining: Math.max(0, deductible - met), limit, used,
    limitRemaining: limit > 0 ? Math.max(0, limit - used) : Infinity, per, dedShared, limShared };
}
/* Estimate what pending claims will pay, applying deductible + rate in date order */
function estimatePending(ctx, pending) {
  let total = 0; const per = {}, groups = {};
  pending.slice().sort(byDate('serviceDate')).forEach((c) => {
    const p = ctx.data.policies.find((x) => x.id === c.policyId) || coveringPolicy(ctx, c.serviceDate);
    if (!p) return;
    const scopeKey = p.deductibleScope === 'shared' ? 'all' : c.petId;
    const key = p.id + '|' + policyYearStart(p, c.serviceDate) + '|' + scopeKey;
    if (!groups[key]) { const ds = deductibleStatus(ctx.data, p, c.serviceDate, c.petId); groups[key] = { ded: ds.remaining, lim: ds.limitRemaining }; }
    const g = groups[key];
    const amt = num(hasVal(c.eligibleAmount) ? c.eligibleAmount : c.amountClaimed);
    const afterDed = Math.max(0, amt - g.ded); g.ded = Math.max(0, g.ded - amt);
    const est = Math.min(afterDed * num(p.reimbursement) / 100, g.lim); g.lim -= est;
    per[c.id] = est; total += est;
  });
  return { total, per };
}
/* What a single bill would cost with the policy, starting from an unused deductible */
function billWithPolicy(p, bill) {
  if (!p) return bill;
  const ded = num(p.deductible), rate = num(p.reimbursement) / 100, lim = num(p.annualLimit) || Infinity;
  return bill - Math.min(Math.max(0, bill - ded) * rate, lim);
}

function analysisRange(ctx, s, override) {
  const t = todayISO();
  const mode = override || s.analysisPeriod;
  const first = ctx.policies.map((p) => (ctx.kind === 'pet' ? petJoin(p, ctx.pet.id) : p.start)).filter(Boolean).sort()[0];
  if (mode === '12m') return { from: addDays(addMonths(t, -12), 1), to: t, label: 'Last 12 months' };
  if (mode === 'ytd') return { from: t.slice(0, 4) + '-01-01', to: t, label: 'Year to date' };
  if (mode === 'policyYear') {
    const p = currentPolicy(ctx);
    if (p && p.start) return { from: policyYearStart(p, t), to: t, label: 'Current policy year' };
  }
  return { from: first && first < t ? first : addDays(addMonths(t, -12), 1), to: t, label: first ? 'Since coverage began' : 'Last 12 months' };
}

function insuranceStats(ctx, s, range) {
  const t = todayISO();
  const inR = (d) => d && d >= range.from && d <= range.to;
  const pays = premiumPayments(ctx, range.from, range.to);
  const premiums = sum(pays, 'amount');
  const visitsR = ctx.visits.filter((v) => inR(v.date) && v.date <= t);
  const insuredVisits = visitsR.filter((v) => coveringPolicy(ctx, v.date, v._pet.id));
  const vetCosts = sum(insuredVisits, 'cost');
  const claimsR = ctx.claims.filter((c) => inR(c.serviceDate));
  const paid = claimsR.filter((c) => PAID.includes(c.status));
  const reimbursed = sum(paid, 'reimbursed');
  const pending = claimsR.filter((c) => PENDING.includes(c.status));
  const est = estimatePending(ctx, pending);
  const denied = claimsR.filter((c) => c.status === 'denied');
  const decided = paid.length + denied.length;
  const turn = paid.filter((c) => c.submittedDate && c.paidDate).map((c) => daysBetween(c.submittedDate, c.paidDate));
  const claimedIds = new Set(ctx.data.claims.map((c) => c.visitId).filter(Boolean));
  const unclaimed = insuredVisits.filter((v) => num(v.cost) > 0 && !claimedIds.has(v.id) && !v.notClaimable && v.date >= addDays(t, -365));
  const drafts = claimsR.filter((c) => c.status === 'draft');
  const benefit = reimbursed + (s.includePending ? est.total : 0);
  const net = benefit - premiums;
  const ratio = premiums > 0 ? benefit / premiums : null;
  const pol = currentPolicy(ctx);
  let policy = null;
  if (pol && pol.start) {
    const ann = annualPremium(ctx, pol, t), rate = num(pol.reimbursement);
    const changes = pol.petIds.flatMap((id) => [petJoin(pol, id), petLeave(pol, id)]).filter((d) => d && d > pol.start && d <= t).sort();
    const since = changes.length ? changes[changes.length - 1] : pol.start;
    const startRate = rateAt(ctx, pol, since), nowRate = rateAt(ctx, pol, t), share = ctx.share(pol, t);
    const ded = deductibleStatus(ctx.data, pol, t, ctx.kind === 'pet' ? ctx.pet.id : null);
    const nPets = Math.max(1, petsOnPolicy(ctx.data, pol).length);
    // break-even: eligible spend at which reimbursement = premiums for this context
    const dedForBE = ded.deductible;
    policy = {
      policy: pol, annual: ann, rateNow: nowRate * share, rateFull: nowRate, share, active: activeOn(pol, t), nPets,
      breakEven: rate > 0 ? ann / (rate / 100) + dedForBE : null,
      ded, renewal: nextRenewal(pol),
      increase: startRate > 0 ? (nowRate - startRate) / startRate : null, increaseSince: since, petsChanged: since !== pol.start,
      emergencyWith: billWithPolicy(pol, num(s.emergencyExample)) + ann,
    };
  }
  const months = []; let mk = monthKey(range.from); const endK = monthKey(range.to);
  while (mk <= endK && months.length < 600) { months.push(mk); mk = monthKey(addMonths(mk + '-01', 1)); }
  const series = months.map((m) => ({
    month: m,
    premiums: sum(pays.filter((p) => monthKey(p.date) === m), 'amount'),
    reimbursed: sum(paid.filter((c) => monthKey(c.serviceDate) === m), 'reimbursed'),
    vet: sum(insuredVisits.filter((v) => monthKey(v.date) === m), 'cost'),
  }));
  let cp = 0, cr = 0;
  series.forEach((r) => { cp += r.premiums; cr += r.reimbursed; r.cumPremiums = cp; r.cumReimbursed = cr; });
  const byPet = ctx.petsCovered.map((pt) => {
    const cl = paid.filter((c) => c.petId === pt.id);
    return { pet: pt, vet: sum(insuredVisits.filter((v) => v._pet.id === pt.id), 'cost'), reimbursed: sum(cl, 'reimbursed'),
      claims: claimsR.filter((c) => c.petId === pt.id).length,
      premiums: ctx.kind === 'plan' ? sum(pays, (x) => x.full * policyShare(ctx.data, ctx.policy, pt.id, x.date)) : premiums };
  });
  const st = {
    ctx, range, premiums, payments: pays, vetCosts, vetCostsAll: sum(visitsR, 'cost'), claims: claimsR, paid, reimbursed, pending, pendingClaimed: sum(pending, 'amountClaimed'),
    pendingEst: est.total, pendingPer: est.per, denied, drafts, approvalRate: decided ? paid.length / decided : null,
    turnaround: turn.length ? sum(turn) / turn.length : null, unclaimed, unclaimedTotal: sum(unclaimed, 'cost'),
    benefit, net, ratio, coverage: vetCosts > 0 ? reimbursed / vetCosts : null, oopWith: vetCosts - reimbursed + premiums, oopWithout: vetCosts,
    policy, series, byPet, months: monthsBetween(range.from, range.to), hasPolicy: ctx.policies.length > 0,
  };
  st.verdict = makeVerdict(st, s);
  st.review = insuranceReviewPoints(st, s);
  return st;
}

function makeVerdict(st, s) {
  const M = (n, w) => fmtMoney(n, s.currency, w);
  if (!st.hasPolicy) return { level: 'none', label: 'No policy added', text: 'Add your pet insurance policy to start tracking whether it is worth the cost.' };
  if (st.premiums <= 0) return { level: 'none', label: 'Not enough data', text: 'No premiums fall in this period yet. Check the policy start date and premium.' };
  const r = st.ratio;
  let level, label;
  if (r >= s.goodRatio) { level = 'good'; label = 'Paying off'; }
  else if (r >= s.fairRatio) { level = 'fair'; label = 'Partly paying off'; }
  else { level = 'poor'; label = 'Costing more than it returns'; }
  const parts = [];
  parts.push(`For every ${M(1)} paid in premiums you have got back ${M(r)}${s.includePending && st.pendingEst > 0 ? ' (including pending claims)' : ''}.`);
  parts.push(st.net >= 0 ? `You are ${M(st.net, true)} ahead of paying the vet bills yourself.` : `You have paid ${M(-st.net, true)} more in premiums than you got back.`);
  if (st.months < 6) parts.push('It is early: one large claim can change this quickly.');
  if (level !== 'good' && st.policy) {
    parts.push(`That is common in a healthy year; insurance earns its keep in a bad one. A ${M(num(s.emergencyExample), true)} emergency would cost you about ${M(st.policy.emergencyWith, true)} for the year with this policy (premiums included), against ${M(num(s.emergencyExample), true)} without it.`);
  }
  return { level, label, text: parts.join(' '), meter: Math.max(0, Math.min(1, r / Math.max(1.5, s.goodRatio * 1.5))) };
}

function insuranceReviewPoints(st, s) {
  const M = (n) => fmtMoney(n, s.currency, true), out = [];
  if (st.policy && st.policy.increase != null && st.policy.increase > 0.001)
    out.push(`Premium has risen ${fmtPct(st.policy.increase)} since ${st.policy.petsChanged ? 'the last pet joined or left on ' + fmtDate(st.policy.increaseSince, s.dateFormat) : 'the policy started'} (now ${fmtMoney(st.policy.rateFull, s.currency)} per ${st.policy.policy.frequency === 'annual' ? 'year' : 'month'}${st.policy.nPets > 1 ? ' for ' + st.policy.nPets + ' pets' : ''}).`);
  if (st.unclaimed.length) out.push(`${plural(st.unclaimed.length, 'visit')} while insured (${M(st.unclaimedTotal)}) ${st.unclaimed.length === 1 ? 'has' : 'have'} no claim recorded.`);
  if (st.drafts.length) out.push(`${plural(st.drafts.length, 'claim')} not yet sent to the insurer.`);
  const old = st.pending.filter((c) => c.submittedDate && daysBetween(c.submittedDate, todayISO()) > 30);
  if (old.length) out.push(`${plural(old.length, 'claim')} pending for more than 30 days.`);
  if (st.denied.length) out.push(`${plural(st.denied.length, 'claim')} denied in this period; check the reasons against the policy wording.`);
  if (st.policy && st.policy.renewal && daysBetween(todayISO(), st.policy.renewal) <= 45)
    out.push(`Policy renews on ${fmtDate(st.policy.renewal, s.dateFormat)}; a good time to compare plans.`);
  if (st.policy && st.policy.breakEven && st.vetCosts > 0 && st.months >= 11) {
    const perYear = st.vetCosts / (st.months / 12);
    if (perYear < st.policy.breakEven * 0.5) out.push(`Vet spending averages about ${M(perYear)} a year, under half the ${M(st.policy.breakEven)} needed to break even.`);
  }
  return out;
}

/* ---------------- health calculations ---------------- */
function vaccineStatus(pet) {
  const t = todayISO(), soon = addDays(t, 30), latest = {};
  pet.vaccines.forEach((v) => {
    const k = (v.name || '').trim().toLowerCase(); if (!k) return;
    if (!latest[k] || (v.dateGiven || '') > (latest[k].dateGiven || '')) latest[k] = v;
  });
  return Object.values(latest).map((v) => ({
    v, status: isArchived(pet) || !v.nextDue ? 'none' : v.nextDue < t ? 'overdue' : v.nextDue <= soon ? 'soon' : 'ok',
  })).sort((a, b) => String(a.v.nextDue || '9999').localeCompare(String(b.v.nextDue || '9999')));
}
function currentMeds(pet) {
  const t = refDate(pet);
  return pet.meds.filter((m) => (!m.end || m.end >= t) && (!m.start || m.start <= t));
}
function healthStats(pet, s, range) {
  const t = todayISO();
  const inR = (d) => d && d >= range.from && d <= range.to;
  const past = pet.visits.filter((v) => v.date && v.date <= t).sort(byDate('date', true));
  const visitsR = past.filter((v) => inR(v.date));
  const upcoming = [];
  pet.visits.filter((v) => v.date > t).forEach((v) => upcoming.push({ date: v.date, kind: 'Appointment', text: v.reason || v.type || 'Vet visit', sub: v.clinic }));
  pet.visits.filter((v) => v.followUpDate && v.followUpDate >= t).forEach((v) => {
    if (!pet.visits.some((x) => x.date >= v.followUpDate && x.date <= addDays(v.followUpDate, 3) && x.id !== v.id))
      upcoming.push({ date: v.followUpDate, kind: 'Follow-up', text: `Recheck: ${v.reason || v.type || 'visit'}`, sub: v.clinic });
  });
  const vacc = vaccineStatus(pet);
  vacc.filter((x) => x.status === 'overdue' || x.status === 'soon').forEach((x) => upcoming.push({ date: x.v.nextDue, kind: x.status === 'overdue' ? 'Overdue vaccine' : 'Vaccine due', text: x.v.name, overdue: x.status === 'overdue' }));
  const meds = currentMeds(pet);
  meds.filter((m) => m.refillDue && m.refillDue <= addDays(t, 14)).forEach((m) => upcoming.push({ date: m.refillDue, kind: 'Refill', text: `${m.name}${m.dose ? ' ' + m.dose : ''}`, overdue: m.refillDue < t }));
  upcoming.sort(byDate('date'));
  const nextAppt = upcoming.find((u) => (u.kind === 'Appointment' || u.kind === 'Follow-up'));
  const weights = pet.weights.filter((w) => w.date && hasVal(w.weight)).sort(byDate('date'));
  const wR = weights.filter((w) => inR(w.date));
  const latestW = weights[weights.length - 1] || null;
  const firstW = wR[0] || null, lastW = wR[wR.length - 1] || null;
  const wChange = firstW && lastW && firstW !== lastW ? num(lastW.weight) - num(firstW.weight) : null;
  const wPct = wChange != null && num(firstW.weight) ? wChange / num(firstW.weight) : null;
  const obsR = pet.observations.filter((o) => inR(o.date)).sort(byDate('date', true));
  const obs30 = pet.observations.filter((o) => o.date && o.date >= addDays(t, -30) && o.date <= t);
  const counts = {};
  obsR.forEach((o) => { const c = o.category || 'Other'; counts[c] = (counts[c] || 0) + 1; });
  const stoppedR = pet.meds.filter((m) => m.end && m.end < t && m.end >= range.from);
  const st = {
    range, past, visitsR, last: past[0] || null, upcoming, nextAppt, vacc, meds, stoppedR,
    overdue: vacc.filter((x) => x.status === 'overdue'), dueSoon: vacc.filter((x) => x.status === 'soon'),
    refills: meds.filter((m) => m.refillDue && m.refillDue <= addDays(t, 7)),
    weights, wR, latestW, wChange, wPct, obsR, obs30, counts, spend: sum(visitsR, 'cost'),
    notesR: pet.notes.filter((n) => inR(n.date)).sort(byDate('date')),
  };
  st.discuss = healthDiscussPoints(pet, st, s);
  if (isArchived(pet)) { st.upcoming = []; st.nextAppt = null; st.refills = []; st.overdue = []; st.dueSoon = []; st.discuss = []; }
  return st;
}
function healthDiscussPoints(pet, st, s) {
  const out = [];
  if (st.wPct != null && Math.abs(st.wPct) >= 0.05)
    out.push(`Weight ${st.wChange > 0 ? 'up' : 'down'} ${fmtPct(Math.abs(st.wPct), 1)} (${fmtNum(Math.abs(st.wChange))} ${s.weightUnit}) over the period.`);
  st.overdue.forEach((x) => out.push(`${x.v.name} vaccine overdue since ${fmtDate(x.v.nextDue, s.dateFormat)}.`));
  Object.entries(st.counts).filter(([, n]) => n >= 3).forEach(([c, n]) => out.push(`${c} noted ${n} times in the period.`));
  const severe = st.obsR.filter((o) => String(o.severity) === '3');
  if (severe.length) out.push(`${plural(severe.length, 'severe observation')} logged (${severe.map((o) => o.category).filter((v, i, a) => a.indexOf(v) === i).join(', ')}).`);
  const asNeeded = st.meds.filter((m) => m.asNeeded);
  if (asNeeded.length) out.push(`As-needed medication on hand: ${asNeeded.map((m) => m.name).join(', ')}. Mention how often it is used.`);
  return out;
}

/* combined alerts for overview */
function overviewAlerts(data, pet, s) {
  const t = todayISO(), hs = healthStats(pet, s, { from: addMonths(t, -12), to: t });
  const ctx = defaultInsCtx(data, pet);
  const is = insuranceStats(ctx, s, analysisRange(ctx, s));
  const mine = insuranceStats(petCtx(data, pet), s, analysisRange(petCtx(data, pet), s));
  const a = [];
  if (isArchived(pet)) a.push({ tone: 'info', tab: 'overview', text: `${petLabel(pet)} is archived (${archiveVerb(pet).toLowerCase()}${pet.archivedDate ? ' ' + fmtDate(pet.archivedDate, s.dateFormat) : ''}). Health reminders are off; insurance items still show until they are settled.` });
  hs.overdue.forEach((x) => a.push({ tone: 'bad', tab: 'health', text: `${x.v.name} vaccine overdue (due ${fmtDate(x.v.nextDue, s.dateFormat)})` }));
  hs.dueSoon.forEach((x) => a.push({ tone: 'warn', tab: 'health', text: `${x.v.name} vaccine due ${fmtDate(x.v.nextDue, s.dateFormat)}` }));
  hs.refills.forEach((m) => a.push({ tone: m.refillDue < t ? 'bad' : 'warn', tab: 'health', text: `Refill ${m.name} by ${fmtDate(m.refillDue, s.dateFormat)}` }));
  if (hs.nextAppt && daysBetween(t, hs.nextAppt.date) <= 14) a.push({ tone: 'info', tab: 'health', text: `${hs.nextAppt.kind}: ${hs.nextAppt.text} on ${fmtDate(hs.nextAppt.date, s.dateFormat)}` });
  if (mine.unclaimed.length) a.push({ tone: 'warn', tab: 'insurance', text: `${plural(mine.unclaimed.length, 'vet visit')} (${fmtMoney(mine.unclaimedTotal, s.currency, true)}) with no insurance claim` });
  if (mine.drafts.length) a.push({ tone: 'warn', tab: 'insurance', text: `${plural(mine.drafts.length, 'claim')} not yet sent` });
  if (mine.pending.length) a.push({ tone: 'info', tab: 'insurance', text: `${plural(mine.pending.length, 'claim')} pending, about ${fmtMoney(mine.pendingEst, s.currency, true)} expected` });
  if (is.policy && is.policy.renewal && daysBetween(t, is.policy.renewal) <= 30) a.push({ tone: 'info', tab: 'insurance', text: `Policy renews ${fmtDate(is.policy.renewal, s.dateFormat)}` });
  return { alerts: a, hs, is };
}
/* shared plan → judge the whole plan by default; otherwise the pet */
function defaultInsCtx(data, pet, scope) {
  if (scope === 'pet') return petCtx(data, pet);
  const sp = sharedPolicies(data, pet);
  const pick = (scope && sp.find((p) => p.id === scope)) || sp.filter((p) => activeOn(p, todayISO()))[0] || (scope ? null : sp[0]);
  return pick ? planCtx(data, pick) : petCtx(data, pet);
}
/* ---------------- SVG charts (shared by dashboard and PDF) ---------------- */
function niceTicks(min, max, count = 4) {
  if (min === max) { max = min + 1; }
  const span = max - min, step0 = span / count, mag = Math.pow(10, Math.floor(Math.log10(step0)));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => span / s <= count) || 10 * mag;
  const lo = Math.floor(min / step) * step, hi = Math.ceil(max / step) * step, out = [];
  for (let v = lo; v <= hi + step / 2; v += step) out.push(+v.toFixed(6));
  return out;
}
/* series: [{name, color, points:[{x, y}], dash}] ; xTicks: [{x,label}] */
function lineChartSVG(o) {
  const W = o.w || 640, H = o.h || 220, L = o.left || 56, R = 14, T = 12, B = 28;
  const pts = o.series.flatMap((s) => s.points);
  if (!pts.length) return `<div class="pd-empty">No data yet</div>`;
  let xmin = Math.min(...pts.map((p) => p.x)), xmax = Math.max(...pts.map((p) => p.x));
  if (xmin === xmax) { xmin -= 1; xmax += 1; }
  let ymin = o.zero ? 0 : Math.min(...pts.map((p) => p.y)), ymax = Math.max(...pts.map((p) => p.y));
  if (!o.zero) { const pad = (ymax - ymin || Math.abs(ymax) || 1) * 0.15; ymin -= pad; ymax += pad; }
  const ticks = niceTicks(ymin, ymax, 4); ymin = ticks[0]; ymax = ticks[ticks.length - 1];
  const X = (x) => L + (x - xmin) / (xmax - xmin) * (W - L - R), Y = (y) => T + (1 - (y - ymin) / (ymax - ymin)) * (H - T - B);
  o._g = { kind: 'line', X, Y, W, H, T, B, L, R };
  const grid = o.grid || '#ddd', txt = o.text || '#777', f = o.yFmt || ((v) => v);
  let s = `<svg class="pd-chart" viewBox="0 0 ${W} ${H}" width="100%" preserveAspectRatio="xMidYMid meet" role="img" aria-label="${esc(o.label || 'chart')}" style="font-family:inherit">`;
  ticks.forEach((t) => { s += `<line x1="${L}" x2="${W - R}" y1="${Y(t)}" y2="${Y(t)}" stroke="${grid}" stroke-width="1"/><text x="${L - 6}" y="${Y(t) + 3.5}" text-anchor="end" font-size="10" fill="${txt}">${esc(f(t))}</text>`; });
  (o.xTicks || []).forEach((t) => { if (t.x < xmin || t.x > xmax) return; s += `<text x="${X(t.x)}" y="${H - 9}" text-anchor="middle" font-size="10" fill="${txt}">${esc(t.label)}</text>`; });
  (o.refLines || []).forEach((r) => { s += `<line x1="${L}" x2="${W - R}" y1="${Y(r.y)}" y2="${Y(r.y)}" stroke="${r.color || txt}" stroke-dasharray="4 3"/><text x="${W - R}" y="${Y(r.y) - 4}" text-anchor="end" font-size="9" fill="${txt}">${esc(r.label)}</text>`; });
  o.series.forEach((se) => {
    if (!se.points.length) return;
    const d = se.points.map((p, i) => `${i ? 'L' : 'M'}${X(p.x).toFixed(1)},${Y(p.y).toFixed(1)}`).join('');
    if (se.area) s += `<path d="${d}L${X(se.points[se.points.length - 1].x).toFixed(1)},${Y(ymin)}L${X(se.points[0].x).toFixed(1)},${Y(ymin)}Z" fill="${se.color}" fill-opacity="0.12"/>`;
    s += `<path d="${d}" fill="none" stroke="${se.color}" stroke-width="2.2" stroke-linejoin="round" stroke-linecap="round"${se.dash ? ' stroke-dasharray="5 4"' : ''}/>`;
    if (!se.noDots && se.points.length <= 40) se.points.forEach((p) => { s += `<circle cx="${X(p.x).toFixed(1)}" cy="${Y(p.y).toFixed(1)}" r="2.6" fill="${se.color}">${o.hover ? '' : `<title>${esc(p.title || f(p.y))}</title>`}</circle>`; });
  });
  return s + '</svg>';
}
/* grouped bars: labels[], series:[{name,color,values}] */
function barChartSVG(o) {
  const W = o.w || 640, H = o.h || 200, L = o.left || 56, R = 10, T = 12, B = 28;
  const all = o.series.flatMap((s) => s.values);
  if (!o.labels.length) return `<div class="pd-empty">No data yet</div>`;
  const ticks = niceTicks(0, Math.max(1, ...all), 4), ymax = ticks[ticks.length - 1];
  const Y = (y) => T + (1 - y / ymax) * (H - T - B);
  o._g = { kind: 'bar', W, H, T, B, L, R, Y, gw: (W - L - R) / o.labels.length };
  const gw = (W - L - R) / o.labels.length, bw = Math.max(2, Math.min(22, (gw * 0.75) / o.series.length));
  const grid = o.grid || '#ddd', txt = o.text || '#777', f = o.yFmt || ((v) => v);
  const every = Math.ceil(o.labels.length / 12);
  let s = `<svg class="pd-chart" viewBox="0 0 ${W} ${H}" width="100%" role="img" aria-label="${esc(o.label || 'chart')}" style="font-family:inherit">`;
  ticks.forEach((t) => { s += `<line x1="${L}" x2="${W - R}" y1="${Y(t)}" y2="${Y(t)}" stroke="${grid}"/><text x="${L - 6}" y="${Y(t) + 3.5}" text-anchor="end" font-size="10" fill="${txt}">${esc(f(t))}</text>`; });
  o.labels.forEach((lab, i) => {
    const gx = L + i * gw + (gw - bw * o.series.length) / 2;
    o.series.forEach((se, j) => {
      const v = se.values[i] || 0; if (v <= 0) return;
      s += `<rect x="${(gx + j * bw).toFixed(1)}" y="${Y(v).toFixed(1)}" width="${(bw - 1).toFixed(1)}" height="${(Y(0) - Y(v)).toFixed(1)}" rx="1.5" fill="${se.color}">${o.hover ? '' : `<title>${esc(se.name + ' ' + lab + ': ' + f(v))}</title>`}</rect>`;
    });
    if (i % every === 0) s += `<text x="${(L + i * gw + gw / 2).toFixed(1)}" y="${H - 9}" text-anchor="middle" font-size="10" fill="${txt}">${esc(lab)}</text>`;
  });
  return s + '</svg>';
}
/* Interactive hover for a chart drawn by lineChartSVG / barChartSVG.
   o.hover = { label(x|i) -> title, value(v, seriesName) -> text, extra(x|i) -> [[label, text]] } */
function attachChartHover(wrap, o) {
  const svg = wrap.querySelector('svg'), g = o._g;
  if (!svg || !g || !o.hover) return;
  const NS = 'http://www.w3.org/2000/svg', doc = wrap.ownerDocument;
  wrap.classList.add('pd-chart-hover'); svg.setAttribute('tabindex', '0');
  svg.setAttribute('aria-label', (o.label || 'Chart') + '. Hover, or use the arrow keys, to see values.');
  const layer = doc.createElementNS(NS, 'g'); layer.setAttribute('class', 'pd-hover-layer'); layer.style.pointerEvents = 'none'; svg.appendChild(layer);
  const tip = doc.createElement('div'); tip.className = 'pd-chart-tip'; tip.setAttribute('role', 'status'); tip.style.display = 'none'; wrap.appendChild(tip);
  const fmt = o.hover.value || o.yFmt || ((v) => v);
  let keys; // hover positions
  if (g.kind === 'line') {
    const xs = [...new Set(o.series.flatMap((s) => s.points.map((p) => p.x)))].sort((a, b) => a - b);
    keys = xs.map((x) => ({ x, px: g.X(x), rows: o.series.map((s) => ({ s, p: s.points.find((p) => p.x === x) })).filter((r) => r.p) }));
  } else {
    keys = o.labels.map((lab, i) => ({ i, px: g.L + i * g.gw + g.gw / 2, rows: o.series.map((s) => ({ s, v: s.values[i] || 0 })) }));
  }
  if (!keys.length) return;
  let cur = -1;
  const el = (tag, attrs) => { const e = doc.createElementNS(NS, tag); Object.entries(attrs).forEach(([k, v]) => e.setAttribute(k, v)); return e; };
  const show = (idx) => {
    idx = Math.max(0, Math.min(keys.length - 1, idx)); if (idx === cur) return; cur = idx;
    const k = keys[idx]; while (layer.firstChild) layer.removeChild(layer.firstChild);
    if (g.kind === 'line') {
      layer.appendChild(el('line', { x1: k.px, x2: k.px, y1: g.T, y2: g.H - g.B, stroke: 'var(--text-faint, #999)', 'stroke-dasharray': '3 3' }));
      k.rows.forEach((r) => layer.appendChild(el('circle', { cx: k.px, cy: g.Y(r.p.y), r: 5, fill: r.s.color, stroke: 'var(--background-primary, #fff)', 'stroke-width': 2 })));
    } else {
      layer.appendChild(el('rect', { x: g.L + k.i * g.gw, y: g.T, width: g.gw, height: g.H - g.T - g.B, fill: 'var(--text-normal, #000)', 'fill-opacity': 0.06, rx: 3 }));
    }
    const title = o.hover.label ? o.hover.label(g.kind === 'line' ? k.x : k.i) : '';
    const rows = k.rows.map((r) => `<div class="pd-tip-row"><i style="background:${r.s.color}"></i><span>${esc(r.s.name)}</span><b>${esc(fmt(g.kind === 'line' ? r.p.y : r.v, r.s.name))}</b></div>`).join('');
    const extra = (o.hover.extra ? o.hover.extra(g.kind === 'line' ? k.x : k.i, idx) : []).filter(Boolean)
      .map(([l, v, tone]) => `<div class="pd-tip-row pd-tip-extra"><span>${esc(l)}</span><b class="${tone || ''}">${esc(v)}</b></div>`).join('');
    tip.innerHTML = `<div class="pd-tip-title">${esc(title)}</div>${rows}${extra ? '<div class="pd-tip-sep"></div>' + extra : ''}`;
    tip.style.display = 'block';
    const sr = svg.getBoundingClientRect(), wr = wrap.getBoundingClientRect(), scale = sr.width / g.W;
    const x = sr.left - wr.left + k.px * scale, tw = tip.offsetWidth;
    let left = x + 14; if (left + tw > wr.width) left = x - tw - 14; if (left < 0) left = Math.max(0, Math.min(wr.width - tw, x - tw / 2));
    tip.style.left = left + 'px'; tip.style.top = Math.max(0, sr.top - wr.top + g.T * scale) + 'px';
  };
  const hide = () => { cur = -1; tip.style.display = 'none'; while (layer.firstChild) layer.removeChild(layer.firstChild); };
  const nearest = (clientX) => {
    const sr = svg.getBoundingClientRect(), vx = (clientX - sr.left) * g.W / sr.width;
    let best = 0, bd = Infinity; keys.forEach((k, i) => { const d = Math.abs(k.px - vx); if (d < bd) { bd = d; best = i; } }); return best;
  };
  svg.addEventListener('pointermove', (e) => show(nearest(e.clientX)));
  svg.addEventListener('pointerdown', (e) => show(nearest(e.clientX)));
  svg.addEventListener('pointerleave', (e) => { if (e.pointerType === 'mouse') hide(); });
  svg.addEventListener('blur', hide);
  svg.addEventListener('focus', () => show(cur < 0 ? keys.length - 1 : cur));
  svg.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight' || e.key === 'Home' || e.key === 'End') {
      e.preventDefault(); const c = cur < 0 ? keys.length - 1 : cur;
      show(e.key === 'Home' ? 0 : e.key === 'End' ? keys.length - 1 : c + (e.key === 'ArrowLeft' ? -1 : 1));
    } else if (e.key === 'Escape') hide();
  });
}
function legendHTML(items) {
  return `<div class="pd-legend">${items.map((i) => `<span><i style="background:${i.color}${i.dash ? ';height:2px' : ''}"></i>${esc(i.name)}</span>`).join('')}</div>`;
}
function monthTicks(months) {
  const every = Math.ceil(months.length / 8);
  return months.map((m, i) => ({ x: i, label: i % every === 0 ? monthLabel(m, months.length > 12 && (i === 0 || m.endsWith('-01'))) : '' })).filter((t) => t.label);
}
function dateTicks(isoList) {
  if (!isoList.length) return [];
  const a = parseISO(isoList[0]), b = parseISO(isoList[isoList.length - 1]);
  const out = []; const d = new Date(a.getFullYear(), a.getMonth(), 1);
  const totalM = (b.getFullYear() - a.getFullYear()) * 12 + b.getMonth() - a.getMonth();
  const step = Math.max(1, Math.ceil(totalM / 7));
  while (d <= b) { if (d >= a) out.push({ x: d.getTime(), label: MONTHS[d.getMonth()] + (d.getMonth() === 0 ? ' ' + String(d.getFullYear()).slice(2) : '') }); d.setMonth(d.getMonth() + step); }
  return out;
}

/* ---------------- forms ---------------- */
function speciesOptions(data) {
  const out = [], seen = new Set();
  (data.settings.speciesList || []).concat(data.pets.map((p) => p.species)).forEach((x) => { const v = String(x || '').trim(); if (v && !seen.has(v.toLowerCase())) { seen.add(v.toLowerCase()); out.push(v); } });
  return out;
}
function speciesIcon(species) {
  const s = String(species || '').toLowerCase();
  const map = [[/dog|puppy|canine/, 'dog'], [/cat|kitten|feline/, 'cat'], [/rabbit|bunny/, 'rabbit'], [/bird|parrot|budgie|parakeet|cockatiel|canary|finch|chicken|duck/, 'bird'],
    [/fish|goldfish|betta|koi/, 'fish'], [/turtle|tortoise|lizard|gecko|dragon|reptile|iguana/, 'turtle'], [/snake|python/, 'worm'],
    [/hamster|guinea|rat|mouse|mice|gerbil|chinchilla|degu/, 'rat'], [/ferret|squirrel/, 'squirrel'], [/snail/, 'snail'], [/spider|tarantula|insect|beetle/, 'bug']];
  const m = map.find(([re]) => re.test(s)); return m ? m[1] : 'paw-print';
}
const VISIT_TYPES = ['Wellness / check-up', 'Sick visit', 'Emergency', 'Vaccination', 'Dental', 'Surgery', 'Follow-up', 'Specialist', 'Lab work / imaging', 'Other'];
const OBS_CATS = ['Appetite', 'Drinking', 'Energy', 'Behavior', 'Vomiting', 'Stool', 'Urination', 'Skin & coat', 'Itching', 'Mobility / limping', 'Eyes / ears', 'Breathing / cough', 'Dental / mouth', 'Seizure', 'Other'];
const MED_FORMS = ['Tablet', 'Capsule', 'Chewable', 'Liquid', 'Injection', 'Topical', 'Drops', 'Collar', 'Other'];
const VACCINES = ['Rabies', 'DHPP', 'Leptospirosis', 'Bordetella', 'Canine influenza', 'Lyme', 'FVRCP', 'FeLV', 'RHDV2', 'Myxomatosis'];

class FormModal extends Modal {
  constructor(app, o) { super(app); this.o = o; this.vals = Object.assign({}, o.initial || {}); this.inputs = {}; }
  set(key, v) { this.vals[key] = v; const i = this.inputs[key]; if (i && i.tagName) { if (i.type === 'checkbox') i.checked = !!v; else i.value = v == null ? '' : v; } }
  setOptions(key, options) {
    const i = this.inputs[key]; if (!i || i.tagName !== 'SELECT') return; const cur = i.value; clear(i);
    options.forEach((op) => { const [val, txt] = Array.isArray(op) ? op : [op, op]; i.append(h('option', { value: val, text: txt })); });
    i.value = options.some((o) => (Array.isArray(o) ? o[0] : o) === cur) ? cur : ''; this.vals[key] = i.value;
  }
  setLabel(key, text) { const i = this.inputs[key]; const row = i && i.closest ? i.closest('.pd-form-row') : null; const l = row && row.querySelector('label'); if (l) l.textContent = text; }
  showRow(key, show) { const i = this.inputs[key]; const row = i && (i.closest ? i.closest('.pd-form-row') : null); if (row) row.style.display = show ? '' : 'none'; }
  onOpen() {
    const { contentEl, o } = this;
    this.modalEl.addClass && this.modalEl.addClass('pd-modal');
    contentEl.append(h('h3', { class: 'pd-modal-title', text: o.title }));
    if (o.intro) contentEl.append(h('p', { class: 'pd-muted', text: o.intro }));
    const form = h('form', { class: 'pd-form' });
    o.fields.forEach((f) => {
      if (f.type === 'heading') { form.append(h('div', { class: 'pd-form-heading', text: f.label })); return; }
      const id = 'pd-f-' + f.key + '-' + uid();
      const lab = h('label', { for: id }, f.tip ? term(f.tip, f.label) : f.label, f.required ? h('span', { class: 'pd-req', text: ' *' }) : null);
      let input; const v = this.vals[f.key];
      if (f.type === 'pets') {
        const cur = new Set(v || []);
        input = h('div', { id, class: 'pd-checklist' });
        f.pets.forEach((pt) => {
          const cb = h('input', { type: 'checkbox', value: pt.id }); cb.checked = cur.has(pt.id);
          cb.addEventListener('change', () => { this.vals[f.key] = [...input.querySelectorAll('input:checked')].map((x) => x.value); f.onChange && f.onChange(this.vals[f.key], this); });
          input.append(h('label', { class: 'pd-check-item' }, cb, ' ', petLabel(pt)));
        });
        this.vals[f.key] = [...cur];
        this.inputs[f.key] = input;
        form.append(h('div', { class: 'pd-form-row pd-wide', 'data-key': f.key }, h('label', {}, f.tip ? term(f.tip, f.label) : f.label, f.required ? h('span', { class: 'pd-req', text: ' *' }) : null), input, f.help ? h('div', { class: 'pd-help', text: f.help }) : null));
        return;
      }
      if (f.type === 'shares') {
        const cur = Object.assign({}, v || {});
        input = h('div', { id, class: 'pd-shares' });
        f.pets.forEach((pt) => {
          const isDate = f.inputType === 'date';
          const ni = h('input', { type: isDate ? 'date' : 'number', step: isDate ? null : 'any', min: isDate ? null : '0', 'data-pet': pt.id, 'aria-label': `${petLabel(pt)} ${f.label}` }); ni.value = hasVal(cur[pt.id]) ? cur[pt.id] : '';
          ni.addEventListener('input', () => { cur[pt.id] = ni.value === '' ? '' : (isDate ? ni.value : num(ni.value)); this.vals[f.key] = cur; });
          ni.addEventListener('change', () => { cur[pt.id] = ni.value === '' ? '' : (isDate ? ni.value : num(ni.value)); this.vals[f.key] = cur; });
          input.append(h('label', { class: 'pd-share-item' + (isDate ? ' is-date' : ''), 'data-pet': pt.id }, h('span', { text: petLabel(pt) }), ni, isDate ? null : h('span', { class: 'pd-muted', text: '%' })));
        });
        this.vals[f.key] = cur; this.inputs[f.key] = input;
        form.append(h('div', { class: 'pd-form-row pd-wide' }, h('label', {}, f.tip ? term(f.tip, f.label) : f.label), input, f.help ? h('div', { class: 'pd-help', text: f.help }) : null));
        return;
      }
      if (f.type === 'select') {
        input = h('select', { id });
        (f.options || []).forEach((op) => { const [val, txt] = Array.isArray(op) ? op : [op, op]; input.append(h('option', { value: val, text: txt })); });
        input.value = v == null ? (f.default != null ? f.default : '') : v;
        if (input.value === '' && f.options && f.options.length && !f.allowBlank) input.selectedIndex = 0;
      } else if (f.type === 'textarea') {
        input = h('textarea', { id, rows: f.rows || 3, placeholder: f.placeholder || '' }); input.value = v || '';
      } else if (f.type === 'checkbox') {
        input = h('input', { id, type: 'checkbox' }); input.checked = !!v;
      } else {
        const t = f.type === 'date' ? 'date' : (['money', 'number', 'percent'].includes(f.type) ? 'number' : 'text');
        input = h('input', { id, type: t, placeholder: f.placeholder || '', step: f.type === 'money' ? '0.01' : (f.step || 'any'), min: f.min });
        input.value = v == null ? (f.default != null ? f.default : '') : v;
        if (f.suggest) { const dl = h('datalist', { id: id + '-dl' }, f.suggest.map((x) => h('option', { value: x }))); form.append(dl); input.setAttribute('list', id + '-dl'); }
      }
      this.inputs[f.key] = input;
      const read = () => { this.vals[f.key] = f.type === 'checkbox' ? input.checked : input.value; };
      input.addEventListener('input', read);
      input.addEventListener('change', () => { read(); f.onChange && f.onChange(this.vals[f.key], this); });
      const row = h('div', { class: 'pd-form-row' + (f.type === 'checkbox' ? ' pd-check' : '') + (f.wide ? ' pd-wide' : '') }, lab, input);
      if (f.help) row.append(h('div', { class: 'pd-help', text: f.help }));
      form.append(row);
    });
    const err = h('div', { class: 'pd-error' });
    const actions = h('div', { class: 'pd-form-actions' });
    if (o.onDelete) actions.append(btn('Delete', () => { this.close(); confirmBox(this.app, 'Delete this record?', o.onDelete); }, { cls: 'mod-warning', icon: 'trash-2' }));
    if (o.onDeleteDirect) actions.append(btn(o.onDeleteLabel || 'Delete', () => { this.close(); o.onDeleteDirect(); }, { cls: 'mod-warning', icon: 'trash-2' }));
    actions.append(h('span', { class: 'pd-spacer' }));
    actions.append(btn('Cancel', () => this.close()));
    const save = btn(o.submitLabel || 'Save', () => form.requestSubmit ? form.requestSubmit() : submit(), { cls: 'mod-cta' });
    actions.append(save);
    const submit = async () => {
      const out = {};
      for (const f of o.fields) {
        if (f.type === 'heading') continue;
        let v = this.vals[f.key];
        if (f.type === 'pets') { v = Array.isArray(v) ? v : []; if (f.required && !v.length) { err.textContent = `Choose at least one pet for ${f.label.toLowerCase()}.`; return; } out[f.key] = v; continue; }
        if (f.type === 'shares') { out[f.key] = v || {}; continue; }
        if (f.type === 'checkbox') v = !!v;
        else if (['money', 'number', 'percent'].includes(f.type)) v = v === '' || v == null ? '' : num(v);
        else v = v == null ? '' : String(v).trim();
        if (f.required && (v === '' || v == null)) { err.textContent = `${f.label} is required.`; this.inputs[f.key].focus && this.inputs[f.key].focus(); return; }
        out[f.key] = v;
      }
      if (o.validate) { const m = o.validate(out); if (m) { err.textContent = m; return; } }
      this.close();
      await o.onSubmit(Object.assign({}, o.initial || {}, out));
    };
    form.addEventListener('submit', (e) => { e.preventDefault(); submit(); });
    form.append(err, actions);
    contentEl.append(form);
    o.onReady && o.onReady(this);
    setTimeout(() => { const first = form.querySelector('input,select,textarea'); first && first.focus(); }, 30);
  }
  onClose() { this.contentEl.empty ? this.contentEl.empty() : clear(this.contentEl); Tip.hide(); }
}
class ConfirmModal extends Modal {
  constructor(app, msg, onYes, yesLabel) { super(app); this.msg = msg; this.onYes = onYes; this.yesLabel = yesLabel; }
  onOpen() {
    this.contentEl.append(h('p', { text: this.msg }),
      h('div', { class: 'pd-form-actions' }, h('span', { class: 'pd-spacer' }), btn('Cancel', () => this.close()),
        btn(this.yesLabel || 'Delete', async () => { this.close(); await this.onYes(); }, { cls: 'mod-warning' })));
  }
  onClose() { clear(this.contentEl); }
}
function confirmBox(app, msg, onYes, yes) { new ConfirmModal(app, msg, onYes, yes).open(); }

/* field schemas */
function toggleDob(f) {
  const est = f.vals.dobMode === 'estimated';
  f.showRow('dob', !est); ['ageYears', 'ageMonths', 'ageAsOf'].forEach((k) => f.showRow(k, est));
  if (est && !f.vals.ageAsOf) f.set('ageAsOf', todayISO());
}
function petFields(data) {
  const fields = [
    { key: 'name', label: 'Name', required: true },
    { key: 'species', label: 'Species', suggest: speciesOptions(data), placeholder: 'Pick from the list or type your own', help: 'Type any species, e.g. Axolotl or Bearded dragon.' },
    { key: 'breed', label: 'Breed' },
    { key: 'sex', label: 'Sex', type: 'select', allowBlank: true, options: ['', 'Male', 'Male (neutered)', 'Female', 'Female (spayed)', 'Unknown'] },
    { key: 'dobMode', label: 'Date of birth', type: 'select', options: [['known', 'I know the date'], ['estimated', 'Unknown — estimate the age']], onChange: (v, f) => toggleDob(f) },
    { key: 'dob', label: 'Date of birth', type: 'date' },
    { key: 'ageYears', label: 'Estimated age: years', type: 'number', min: '0', step: '1', placeholder: 'e.g. 4' },
    { key: 'ageMonths', label: 'and months', type: 'number', min: '0', step: '1', placeholder: '0–11' },
    { key: 'ageAsOf', label: 'Age estimated on', type: 'date', help: 'The age counts up from this date. Use the date a shelter or vet gave the estimate, or today.' },
    { key: 'color', label: 'Color / markings' },
    { key: 'microchip', label: 'Microchip number', tip: 'microchip' },
    { type: 'heading', label: 'Primary vet' },
    { key: 'primaryVet', label: 'Clinic' },
    { key: 'vetPhone', label: 'Phone' },
    { key: 'vetAddress', label: 'Address', type: 'textarea', rows: 2, wide: true },
    { type: 'heading', label: 'Emergency vet' },
    { key: 'emergencyVet', label: 'Clinic', help: 'Where to go after hours or in an emergency.' },
    { key: 'emergencyPhone', label: 'Phone' },
    { key: 'emergencyAddress', label: 'Address', type: 'textarea', rows: 2, wide: true },
    { type: 'heading', label: 'Health' },
    { key: 'allergies', label: 'Allergies', type: 'textarea', rows: 2, wide: true },
    { key: 'conditions', label: 'Ongoing conditions', type: 'textarea', rows: 2, wide: true },
  ];
  fields.onReady = toggleDob;
  fields.validate = (v) => {
    if (v.dobMode === 'estimated') {
      if (!(num(v.ageYears) || num(v.ageMonths))) return 'Enter an estimated age in years and/or months.';
      if (num(v.ageMonths) > 11) return 'Months should be 0–11; put whole years in the years box.';
      if (num(v.ageYears) < 0 || num(v.ageMonths) < 0) return 'Age cannot be negative.';
    } else if (v.dob && v.dob > todayISO()) return 'The date of birth is in the future.';
    return null;
  };
  return fields;
}
function policyFields(data) {
  const toggleShares = (f) => {
    const custom = f.vals.split === 'custom', ids = new Set(f.vals.petIds || []);
    f.showRow('shares', custom);
    ['shares', 'petStart', 'petEnd'].forEach((k) => { const box = f.inputs[k]; if (box) box.querySelectorAll('.pd-share-item').forEach((l) => { l.style.display = ids.has(l.getAttribute('data-pet')) ? '' : 'none'; }); });
    const multi = ids.size > 1; ['split', 'deductibleScope', 'limitScope', 'petStart', 'petEnd'].forEach((k) => f.showRow(k, multi)); if (!multi) f.showRow('shares', false);
  };
  const fields = [
    { type: 'heading', label: 'Pets covered' },
    { key: 'petIds', label: 'Pets on this policy', type: 'pets', pets: data.pets, required: true, help: 'Tick every pet this policy covers, for example a multi-pet plan.', onChange: (v, f) => toggleShares(f) },
    { key: 'split', label: 'Split the premium', type: 'select', options: [['equal', 'Equally between pets'], ['custom', 'By percentage']], onChange: (v, f) => toggleShares(f), help: 'Used to show each pet’s share of the cost.' },
    { key: 'shares', label: 'Share of premium', type: 'shares', pets: data.pets, help: 'Percentages are scaled to add up to 100% among the pets on the policy at each payment.' },
    { key: 'petStart', label: 'Joined the policy on', type: 'shares', inputType: 'date', pets: data.pets, help: 'For a pet added after the policy started. Blank = covered from the start date. Record the new premium with “Rate change” (reason: pet added).' },
    { key: 'petEnd', label: 'Left the policy on (optional)', type: 'shares', inputType: 'date', pets: data.pets, help: 'For a pet removed from the policy while it continues for the others.' },
    { key: 'deductibleScope', label: 'Deductible applies', type: 'select', tip: 'deductible', options: [['perPet', 'Separately to each pet'], ['shared', 'Once, shared by all pets']] },
    { key: 'limitScope', label: 'Annual limit applies', type: 'select', tip: 'annualLimit', options: [['perPet', 'Separately to each pet'], ['shared', 'Shared by all pets']] },
    { type: 'heading', label: 'Provider' },
    { key: 'provider', label: 'Insurance company', required: true },
    { key: 'plan', label: 'Plan name' },
    { key: 'policyNumber', label: 'Policy number' },
    { key: 'coverage', label: 'Coverage type', type: 'select', options: ['Accident & illness', 'Accident & illness + wellness', 'Accident only', 'Wellness only', 'Other'] },
    { key: 'start', label: 'Start date', type: 'date', required: true },
    { key: 'end', label: 'End / cancel date', type: 'date', help: 'Leave blank while the policy is active.' },
    { type: 'heading', label: 'Cost and terms' },
    { key: 'premium', label: 'Starting premium', type: 'money', tip: 'premium', required: true, help: 'The total for the policy (all pets on it). Record later price changes with “Rate change”.' },
    { key: 'frequency', label: 'Billed', type: 'select', options: [['monthly', 'Monthly'], ['annual', 'Yearly']] },
    { key: 'deductible', label: 'Deductible', type: 'money', tip: 'deductible' },
    { key: 'deductibleType', label: 'Deductible type', type: 'select', tip: 'deductibleType', options: [['annual', 'Annual'], ['condition', 'Per condition'], ['incident', 'Per incident'], ['lifetime', 'Lifetime per condition']] },
    { key: 'reimbursement', label: 'Reimbursement rate (%)', type: 'percent', tip: 'reimbursement', required: true, placeholder: '80' },
    { key: 'annualLimit', label: 'Annual limit', type: 'money', tip: 'annualLimit', help: '0 or blank = unlimited.' },
    { key: 'waitingPeriod', label: 'Waiting period (days)', type: 'number', tip: 'waitingPeriod' },
    { key: 'exclusions', label: 'Exclusions', type: 'textarea', tip: 'exclusion', rows: 2, wide: true },
    { type: 'heading', label: 'Contact' },
    { key: 'phone', label: 'Claims phone' },
    { key: 'website', label: 'Website / portal' },
    { key: 'notes', label: 'Notes', type: 'textarea', rows: 2, wide: true },
  ];
  fields.onReady = toggleShares;
  fields.validate = (v) => {
    const ids = v.petIds || [];
    for (const id of ids) {
      const pt = data.pets.find((p) => p.id === id), j = (v.petStart || {})[id], e = (v.petEnd || {})[id];
      if (j && v.start && j < v.start) return `${petLabel(pt)} can’t join before the policy start date.`;
      if (j && v.end && j > v.end) return `${petLabel(pt)} joins after the policy ends.`;
      if (e && j && e < j) return `${petLabel(pt)} leaves before joining.`;
      if (e && v.start && e < v.start) return `${petLabel(pt)} leaves before the policy starts.`;
    }
    return null;
  };
  return fields;
}
function rateFields(data, policies) {
  return [
    { key: 'policyId', label: 'Policy', type: 'select', options: (policies || data.policies).map((p) => [p.id, policyLabel(p)]) },
    { key: 'date', label: 'Effective date', type: 'date', required: true },
    { key: 'amount', label: 'New premium (whole policy)', type: 'money', tip: 'premium', required: true },
    { key: 'reason', label: 'Reason', placeholder: 'Renewal, pet added…', suggest: ['Renewal', 'Pet added', 'Pet removed', 'Age increase', 'Plan change', 'Price increase', 'Discount applied'] },
  ];
}
function claimFields(data, s) {
  const visitOpts = (petId) => {
    const pt = data.pets.find((p) => p.id === petId);
    return [['', '— not linked —']].concat((pt ? pt.visits : []).slice().sort(byDate('date', true)).map((v) => [v.id, `${fmtDate(v.date, s.dateFormat)} · ${v.reason || v.type || 'Visit'}${hasVal(v.cost) ? ' · ' + fmtMoney(num(v.cost), s.currency) : ''}`]));
  };
  const polOpts = (petId) => data.policies.filter((p) => !petId || p.petIds.includes(petId)).map((p) => [p.id, policyLabel(p)]);
  const fields = [
    { key: 'petId', label: 'Pet', type: 'select', options: data.pets.map((p) => [p.id, petLabel(p)]),
      onChange: (val, f) => { f.setOptions('visitId', visitOpts(val)); f.setOptions('policyId', polOpts(val)); } },
    { key: 'visitId', label: 'Vet visit', type: 'select', allowBlank: true, options: visitOpts(null),
      onChange: (val, f) => {
        const pt = data.pets.find((p) => p.id === f.vals.petId); const v = pt && pt.visits.find((x) => x.id === val); if (!v) return;
        f.set('serviceDate', v.date); if (hasVal(v.cost)) f.set('amountClaimed', v.cost);
        if (!f.vals.condition) f.set('condition', v.diagnosis || v.reason || '');
        const p = data.policies.find((x) => x.petIds.includes(pt.id) && activeOn(x, v.date)); if (p) f.set('policyId', p.id);
      } },
    { key: 'policyId', label: 'Policy', type: 'select', options: polOpts(null), required: true },
    { key: 'serviceDate', label: 'Date of treatment', type: 'date', required: true },
    { key: 'condition', label: 'Condition / reason' },
    { key: 'amountClaimed', label: 'Amount claimed', type: 'money', tip: 'claim', required: true },
    { key: 'status', label: 'Status', type: 'select', options: Object.entries(CLAIM_STATUS) },
    { key: 'submittedDate', label: 'Date sent', type: 'date' },
    { key: 'claimNumber', label: 'Claim number' },
    { type: 'heading', label: 'Outcome (from the explanation of benefits)' },
    { key: 'eligibleAmount', label: 'Eligible amount', type: 'money', tip: 'eligible' },
    { key: 'deductibleApplied', label: 'Deductible applied', type: 'money', tip: 'deductibleApplied' },
    { key: 'reimbursed', label: 'Amount paid to you', type: 'money' },
    { key: 'paidDate', label: 'Date paid / decided', type: 'date' },
    { key: 'denialReason', label: 'Denial reason', placeholder: 'e.g. pre-existing, wellness not covered' },
    { key: 'notes', label: 'Notes', type: 'textarea', rows: 2, wide: true },
  ];
  fields.onReady = (f) => {
    const vid = f.vals.visitId, pid = f.vals.policyId;
    f.setOptions('visitId', visitOpts(f.vals.petId)); f.setOptions('policyId', polOpts(f.vals.petId));
    f.set('visitId', vid || ''); if (pid) f.set('policyId', pid); else if (f.inputs.policyId.options.length) f.set('policyId', f.inputs.policyId.options[0].value);
  };
  return fields;
}
function visitFields(s) {
  return [
    { key: 'date', label: 'Date', type: 'date', required: true, help: 'A future date records an upcoming appointment.' },
    { key: 'type', label: 'Visit type', type: 'select', options: VISIT_TYPES },
    { key: 'reason', label: 'Reason', required: true },
    { key: 'clinic', label: 'Clinic' },
    { key: 'vet', label: 'Veterinarian' },
    { key: 'diagnosis', label: 'Diagnosis / findings' },
    { key: 'treatment', label: 'Treatment / next steps', type: 'textarea', rows: 2, wide: true },
    { key: 'weight', label: `Weight (${s.weightUnit})`, type: 'number', help: 'Also added to the weight log.' },
    { key: 'cost', label: 'Total cost', type: 'money' },
    { key: 'followUpDate', label: 'Follow-up by', type: 'date', tip: 'followUp' },
    { key: 'notClaimable', label: 'Not covered by insurance (don’t flag as unclaimed)', type: 'checkbox', tip: 'wellness' },
    { key: 'notes', label: 'Notes', type: 'textarea', rows: 2, wide: true },
  ];
}
function medFields() {
  return [
    { key: 'name', label: 'Medication', required: true },
    { key: 'dose', label: 'Strength', placeholder: 'e.g. 16 mg' },
    { key: 'form', label: 'Form', type: 'select', options: MED_FORMS },
    { key: 'frequency', label: 'How to give', placeholder: 'e.g. 1 tablet twice a day with food' },
    { key: 'purpose', label: 'For' },
    { key: 'prescriber', label: 'Prescribed by' },
    { key: 'start', label: 'Start date', type: 'date' },
    { key: 'end', label: 'End date', type: 'date', help: 'Blank = still taking.' },
    { key: 'asNeeded', label: 'Given as needed', type: 'checkbox', tip: 'prn' },
    { key: 'refillDue', label: 'Refill due', type: 'date', tip: 'refill' },
    { key: 'whyStopped', label: 'Why stopped' },
    { key: 'notes', label: 'Notes', type: 'textarea', rows: 2, wide: true },
  ];
}
function vaccineFields() {
  return [
    { key: 'name', label: 'Vaccine', required: true, suggest: VACCINES },
    { key: 'dateGiven', label: 'Date given', type: 'date', required: true },
    { key: 'nextDue', label: 'Next due', type: 'date', tip: 'nextDue' },
    { key: 'clinic', label: 'Clinic' },
    { key: 'lot', label: 'Lot / tag number' },
    { key: 'notes', label: 'Notes', type: 'textarea', rows: 2, wide: true },
  ];
}
function weightFields(s) {
  return [
    { key: 'date', label: 'Date', type: 'date', required: true },
    { key: 'weight', label: `Weight (${s.weightUnit})`, type: 'number', required: true },
    { key: 'notes', label: 'Notes' },
  ];
}
function obsFields() {
  return [
    { key: 'date', label: 'Date', type: 'date', required: true },
    { key: 'category', label: 'Category', type: 'select', options: OBS_CATS },
    { key: 'severity', label: 'Severity', type: 'select', options: [['1', 'Mild'], ['2', 'Moderate'], ['3', 'Severe']] },
    { key: 'note', label: 'What you noticed', type: 'textarea', rows: 3, wide: true, required: true },
  ];
}
function noteFields() {
  return [
    { key: 'date', label: 'Date', type: 'date', required: true },
    { key: 'title', label: 'Title' },
    { key: 'text', label: 'Note', type: 'textarea', rows: 4, wide: true, required: true },
  ];
}
/* ---------------- dashboard UI ---------------- */
const VIEW_COLORS = {
  premium: 'var(--color-orange, #d9822b)', reimb: 'var(--color-green, #2a9d6f)', vet: 'var(--color-blue, #3f7fd0)',
  weight: 'var(--interactive-accent, #7b6cd9)', grid: 'var(--background-modifier-border, #ddd)', text: 'var(--text-muted, #777)',
};

class DashboardUI {
  constructor(plugin, root, opts = {}) {
    this.plugin = plugin; this.root = root; this.tab = opts.tab || 'overview'; this.view = opts.view || null;
    this.embedded = !!opts.embedded; this.expanded = new Set();
  }
  get data() { return this.plugin.data; }
  get s() { return this.plugin.data.settings; }
  get pet() { return (this.fixedPetId && this.data.pets.find((p) => p.id === this.fixedPetId)) || this.plugin.activePet(); }
  async selectPet(id, scope) { if (scope !== undefined) this.insScope = scope; if (this.fixedPetId) { this.fixedPetId = id; this.render(); } else { this.data.activePetId = id; await this.save(); } }
  get app() { return this.plugin.app; }
  M(n, w) { return fmtMoney(n, this.s.currency, w); }
  D(iso) { return fmtDate(iso, this.s.dateFormat); }
  async save() { await this.plugin.saveAll(); }
  setTab(t) { this.tab = t; this.render(); if (this.view && this.view.app) this.view.app.workspace.requestSaveLayout && this.view.app.workspace.requestSaveLayout(); }

  render() {
    const y = this.root.closest && this.root.closest('.view-content') ? this.root.closest('.view-content').scrollTop : 0;
    clear(this.root);
    this.root.classList.add('pd-root');
    const wrap = h('div', { class: 'pd-wrap' });
    wrap.append(this.header(), this.tabs()); const pb = this.petBar(); if (pb) wrap.append(pb);
    const body = h('div', { class: 'pd-body' });
    if (this.tab === 'insurance') this.renderInsurance(body);
    else if (this.tab === 'health') this.renderHealth(body);
    else this.renderOverview(body);
    wrap.append(body);
    this.root.append(wrap);
    if (this.view) this.view.refreshTitle();
    const vc = this.root.closest && this.root.closest('.view-content'); if (vc) vc.scrollTop = y;
  }

  /* ---------- header, tabs ---------- */
  header() {
    const pet = this.pet;
    const left = h('div', { class: 'pd-title-wrap' }, this.avatar(pet, 'title'),
      h('h1', { class: 'pd-title', text: dashboardTitle(pet) }),
      btn('', () => this.openTitleModal(), { icon: 'pencil', cls: 'pd-icon-btn', title: 'Rename dashboard' }));
    const pets = h('div', { class: 'pd-pets' });
    const archived = this.data.pets.filter(isArchived), showArch = this.showArchived || isArchived(pet);
    if (archived.length) pets.append(btn(showArch ? 'Hide archived' : `Archived (${archived.length})`, () => { this.showArchived = !showArch; if (!this.showArchived && isArchived(pet)) { const p = this.data.pets.find((x) => !isArchived(x)); if (p) { this.selectPet(p.id); return; } } this.render(); }, { icon: 'archive', cls: 'pd-pet-add', title: 'Show or hide archived pets' }));
    pets.append(btn('Add pet', () => this.addPet(), { icon: 'plus', cls: 'pd-pet-add' }));
    return h('div', { class: 'pd-header' }, left, pets);
  }
  /* pet (and, on Insurance, whole-plan) selector, shown under the tabs when there is more than one pet */
  petBar() {
    const data = this.data, pet = this.pet, t = todayISO();
    if (data.pets.length < 2) return null;
    const showArch = this.showArchived || isArchived(pet);
    const ins = this.tab === 'insurance';
    const row = h('div', { class: 'pd-petbar', role: 'tablist', 'aria-label': ins ? 'Whole plan or one pet' : 'Pet' });
    const pill = (content, active, onClick, o = {}) => {
      const b = h('button', { type: 'button', role: 'tab', 'aria-selected': String(active), class: 'pd-petpill' + (active ? ' is-active' : '') + (o.cls ? ' ' + o.cls : ''), title: o.title }, content);
      b.addEventListener('click', () => { if (!active) onClick(); });
      row.append(b);
    };
    let planId = null;
    if (ins) {
      const ctx = defaultInsCtx(data, pet, this.insScope);
      planId = ctx.kind === 'plan' ? ctx.policy.id : null;
      const plans = data.policies.filter((p) => petsOnPolicy(data, p).length > 1)
        .sort((a, b) => Number(activeOn(b, t)) - Number(activeOn(a, t)) || String(b.start).localeCompare(String(a.start)));
      plans.forEach((p) => {
        const on = petsOnPolicy(data, p);
        pill([icon('users'), h('span', { class: 'pd-petpill-text' }, h('span', { class: 'pd-petpill-name', text: plans.length > 1 ? `Whole plan · ${p.provider}` : 'Whole plan' }), h('span', { class: 'pd-petpill-sub', text: on.map(petLabel).join(' + ') }))],
          planId === p.id,
          () => { if (p.petIds.includes(pet.id)) { this.insScope = p.id; this.render(); } else this.selectPet(on[0].id, p.id); },
          { cls: 'is-plan', title: `${policyLabel(p)}: every covered pet’s claims against the full premium` });
      });
      if (plans.length) row.append(h('span', { class: 'pd-petbar-sep', 'aria-hidden': 'true' }));
    }
    const visible = data.pets.filter((p) => !isArchived(p) || showArch);
    if (visible.length < 2 && !row.querySelector('.is-plan')) return null;
    visible.forEach((p) => {
      const src = this.plugin.photoSrc(p);
      const shareTxt = ins && sharedPolicies(data, p).length ? 'share' : '';
      pill([src ? h('img', { class: 'pd-chip-photo', src, alt: '' }) : icon(speciesIcon(p.species)),
        h('span', { class: 'pd-petpill-text' }, h('span', { class: 'pd-petpill-name', text: petLabel(p) }), shareTxt ? h('span', { class: 'pd-petpill-sub', text: `${petLabel(p)}’s share` }) : null)],
        p.id === pet.id && !planId,
        () => this.selectPet(p.id, ins ? 'pet' : undefined),
        { cls: isArchived(p) ? 'is-archived' : '', title: isArchived(p) ? `${petLabel(p)} (archived)` : ins && shareTxt ? `${petLabel(p)}’s claims against ${petLabel(p)}’s share of the premium` : `Show ${petLabel(p)}` });
    });
    return row;
  }
  tabs() {
    const t = h('div', { class: 'pd-tabs', role: 'tablist' });
    [['overview', 'Overview', 'layout-dashboard'], ['insurance', 'Insurance', 'shield-check'], ['health', 'Health', 'stethoscope']].forEach(([k, l, ic]) => {
      const b = btn(l, () => this.setTab(k), { icon: ic, cls: 'pd-tab' + (this.tab === k ? ' is-active' : '') });
      b.setAttribute('role', 'tab'); b.setAttribute('aria-selected', String(this.tab === k));
      t.append(b);
    });
    return t;
  }
  /* photo (or species icon) for the title bar and profile */
  avatar(pet, where) {
    const src = this.plugin.photoSrc(pet), size = this.s.photoSize || 'medium';
    const sp = speciesIcon(pet.species);
    const el = h('button', { type: 'button', class: `pd-avatar pd-avatar-${where} size-${size}` + (src ? ' has-photo' : ''),
      title: src ? `Change ${petLabel(pet)}’s photo` : `Add a photo of ${petLabel(pet)}`, 'aria-label': src ? 'Change photo' : 'Add photo',
      onclick: () => new PhotoModal(this.app, this.plugin, pet).open() });
    if (src) el.append(h('img', { src, alt: `Photo of ${petLabel(pet)}` }));
    else { el.append(icon(where === 'title' ? 'paw-print' : sp)); if (where === 'profile') el.append(h('span', { class: 'pd-avatar-hint', text: 'Add photo' })); }
    el.append(h('span', { class: 'pd-avatar-edit' }, icon('camera')));
    return el;
  }
  contact(name, phone, address, big) {
    if (!name && !phone && !address) return null;
    const tel = phone ? h('a', { href: 'tel:' + String(phone).replace(/[^0-9+]/g, ''), text: phone, class: 'pd-tel' }) : null;
    return h('span', { class: 'pd-contact' + (big ? ' is-big' : '') },
      h('span', {}, name ? h('span', { class: 'pd-contact-name', text: name }) : null, name && tel ? ' · ' : '', tel),
      address ? h('span', { class: 'pd-contact-addr', text: address }) : null);
  }
  memorial(pet) {
    const passed = pet.archiveReason === 'passed', b = birthInfo(pet);
    const years = b ? `${parseISO(b.dob).getFullYear()}${b.estimated ? ' (est.)' : ''} – ${pet.archivedDate ? parseISO(pet.archivedDate).getFullYear() : ''}` : '';
    return h('div', { class: 'pd-memorial' + (passed ? ' is-passed' : '') },
      icon(passed ? 'rainbow' : 'archive'),
      h('div', {},
        h('div', { class: 'pd-memorial-title', text: passed ? `In loving memory of ${petLabel(pet)}` : `${petLabel(pet)} · ${archiveVerb(pet)}` }),
        h('div', { class: 'pd-muted', text: [passed ? `Crossed the rainbow bridge${pet.archivedDate ? ' on ' + this.D(pet.archivedDate) : ''}` : (pet.archivedDate ? `Archived ${this.D(pet.archivedDate)}` : ''), years].filter(Boolean).join(' · ') }),
        pet.archiveNote ? h('div', { class: 'pd-memorial-note', text: pet.archiveNote }) : null,
        h('div', { class: 'pd-small pd-muted', text: 'History is kept. Health reminders are off; open claims and shared-plan figures still update.' })));
  }
  async restorePet() {
    const pet = this.pet;
    confirmBox(this.app, `Restore ${petLabel(pet)} to your active pets? Reminders turn back on. Any insurance end dates set when archiving stay as they are; edit the policy to change them.`, async () => {
      pet.archived = false; await this.save(); new Notice(`${petLabel(pet)} restored.`);
    }, 'Restore');
  }
  openTitleModal() { new TitleModal(this.app, this.plugin, this.pet).open(); }
  addPet() {
    const pf = petFields(this.data);
    new FormModal(this.app, { title: 'Add a pet', fields: pf, onReady: pf.onReady, validate: pf.validate, initial: { species: 'Dog', dobMode: 'known' }, submitLabel: 'Add pet',
      onSubmit: async (v) => { const p = Object.assign(newPet(), v); p.titleMode = 'default'; this.data.pets.push(p); this.data.activePetId = p.id; this.tab = 'overview'; await this.save(); new PhotoModal(this.app, this.plugin, p, { afterAdd: true }).open(); } }).open();
  }

  /* ---------- generic pieces ---------- */
  section(title, actions = [], opts = {}) {
    const body = h('div', { class: 'pd-section-body' });
    const el = h('section', { class: 'pd-section ' + (opts.cls || '') },
      h('div', { class: 'pd-section-head' }, h('h3', {}, title), h('div', { class: 'pd-actions' }, actions)), body);
    return { el, body };
  }
  tile(label, value, sub, o = {}) {
    return h('div', { class: 'pd-tile' + (o.tone ? ' tone-' + o.tone : ''), onclick: o.onClick, style: o.onClick ? { cursor: 'pointer' } : null },
      h('div', { class: 'pd-tile-label' }, o.tip ? term(o.tip, label) : label),
      h('div', { class: 'pd-tile-value' }, value),
      sub ? h('div', { class: 'pd-tile-sub' }, sub) : null,
      o.progress != null ? h('div', { class: 'pd-progress' }, h('span', { style: { width: Math.round(Math.min(1, Math.max(0, o.progress)) * 100) + '%' } })) : null);
  }
  table(key, cols, rows, onEdit, opts = {}) {
    if (!rows.length) return h('div', { class: 'pd-empty', text: opts.empty || 'Nothing recorded yet.' });
    const limit = opts.limit || 8, showAll = this.expanded.has(key), shown = showAll ? rows : rows.slice(0, limit);
    const t = h('table', { class: 'pd-table' });
    t.append(h('thead', {}, h('tr', {}, cols.map((c) => h('th', { class: c.cls || '' }, c.tip ? term(c.tip, c.label) : c.label)), onEdit ? h('th', { class: 'pd-col-act' }) : null)));
    const tb = h('tbody');
    shown.forEach((r) => {
      const tr = h('tr', { class: (opts.rowClass && opts.rowClass(r)) || '' });
      cols.forEach((c) => { const v = c.render(r); tr.append(h('td', { class: c.cls || '', 'data-label': c.label }, v == null || v === '' ? '–' : v)); });
      if (onEdit) tr.append(h('td', { class: 'pd-col-act' }, btn('', () => onEdit(r), { icon: 'pencil', cls: 'pd-icon-btn', title: 'Edit' })));
      tb.append(tr);
    });
    t.append(tb);
    const out = h('div', { class: 'pd-table-wrap' }, t);
    if (rows.length > limit) out.append(btn(showAll ? 'Show fewer' : `Show all ${rows.length}`, () => { showAll ? this.expanded.delete(key) : this.expanded.add(key); this.render(); }, { cls: 'pd-link-btn' }));
    return out;
  }
  pill(text, tone) { return h('span', { class: 'pd-pill tone-' + (tone || 'neutral'), text }); }
  chart(svg, legend, o) {
    const d = h('div', { class: 'pd-chart-wrap' }); d.innerHTML = svg + (legend ? legendHTML(legend) : '');
    if (o && o.hover) requestAnimationFrame(() => attachChartHover(d, o));
    return d;
  }
  edit(owner, list, fields, title, rec, after, init) {
    new FormModal(this.app, {
      title: (rec ? 'Edit ' : 'Add ') + title, fields, initial: rec || init || {}, onReady: fields.onReady, validate: fields.validate,
      onDelete: rec ? async () => { owner[list] = owner[list].filter((x) => x.id !== rec.id); await this.save(); } : null,
      onSubmit: async (v) => {
        if (rec) Object.assign(rec, v); else { v.id = uid(); owner[list].push(v); }
        after && after(rec || v);
        await this.save();
      },
    }).open();
  }
  pdfButton(kind) { return btn('PDF', () => new ReportModal(this.app, this.plugin, this.pet, kind).open(), { icon: 'file-down', title: 'Create a PDF report' }); }

  /* ---------- overview ---------- */
  renderOverview(body) {
    const pet = this.pet, s = this.s, t = todayISO();
    const { alerts, hs, is } = overviewAlerts(this.data, pet, s);
    body.append(h('div', { class: 'pd-page-head' }, h('h2', { text: 'Overview' }), h('div', { class: 'pd-actions' }, this.pdfButton('full'))));
    if (isArchived(pet)) body.append(this.memorial(pet));

    if (!pet.name && !pet.visits.length && !this.data.policies.length) {
      body.append(h('div', { class: 'pd-welcome' },
        h('h3', { text: 'Welcome to your pet dashboard' }),
        h('p', { text: 'Start by adding your pet’s details, then record vet visits and your insurance policy. Want to look around first? Load two sample pets.' }),
        h('div', { class: 'pd-actions' }, btn('Add pet details', () => this.editPet(), { cls: 'mod-cta', icon: 'pencil' }),
          btn('Load sample pets', () => this.plugin.loadSample(), { icon: 'sparkles' }))));
    }

    // pet profile + alerts
    const prof = this.section('Profile', [btn(this.plugin.photoSrc(pet) ? 'Photo' : 'Add photo', () => new PhotoModal(this.app, this.plugin, pet).open(), { icon: 'camera' }), btn('Edit', () => this.editPet(), { icon: 'pencil' }),
      isArchived(pet) ? btn('Restore', () => this.restorePet(), { icon: 'archive-restore', title: 'Move back to active pets' }) : btn('Archive', () => new ArchiveModal(this.app, this.plugin, pet).open(), { icon: 'archive', title: 'Archive this pet and keep its history' }),
      btn('Delete', () => new DeletePetModal(this.app, this.plugin, pet).open(), { icon: 'trash-2', cls: 'pd-danger', title: 'Delete this pet and all its records' })]);
    const kv = (k, v) => v ? h('div', { class: 'pd-kv' }, h('span', { class: 'pd-k' }, k), h('span', { class: 'pd-v' }, v)) : null;
    prof.body.append(h('div', { class: 'pd-profile' },
      this.avatar(pet, 'profile'),
      h('div', { class: 'pd-profile-main' },
        h('div', { class: 'pd-profile-name', text: petLabel(pet) }),
        h('div', { class: 'pd-muted', text: [pet.species, pet.breed, pet.sex].filter(Boolean).join(' · ') }),
        h('div', { class: 'pd-kvs' },
          kv('Age', birthInfo(pet) && isArchived(pet) ? ageLabel(pet) : birthInfo(pet) ? (birthInfo(pet).estimated ? h('span', {}, ageLabel(pet), h('span', { class: 'pd-muted', text: ` · birth date unknown, estimated ${this.D(birthInfo(pet).asOf)}` })) : `${ageText(pet.dob)} (born ${this.D(pet.dob)})`) : ''),
          kv('Weight', hs.latestW ? `${fmtNum(num(hs.latestW.weight))} ${s.weightUnit} · ${this.D(hs.latestW.date)}` : ''),
          kv('Color', pet.color),
          kv(term('microchip', 'Microchip'), pet.microchip),
          kv('Vet', this.contact(pet.primaryVet, pet.vetPhone, pet.vetAddress)),
          kv('Emergency vet', this.contact(pet.emergencyVet, pet.emergencyPhone, pet.emergencyAddress)),
          kv('Allergies', pet.allergies),
          kv('Conditions', pet.conditions)))));
    const al = this.section('Needs attention');
    if (!alerts.length) al.body.append(h('div', { class: 'pd-empty', text: 'All caught up. Nothing due in the next two weeks.' }));
    else al.body.append(h('ul', { class: 'pd-alerts' }, alerts.map((a) => h('li', { class: 'tone-' + a.tone, onclick: () => this.setTab(a.tab) }, h('span', { class: 'pd-dot' }), a.text))));
    body.append(h('div', { class: 'pd-grid-2' }, prof.el, al.el));

    // health snapshot
    const hsx = this.section('Health snapshot', [btn('Open health', () => this.setTab('health'), { icon: 'arrow-right' })]);
    hsx.body.append(h('div', { class: 'pd-tiles' },
      this.tile('Last visit', hs.last ? this.D(hs.last.date) : '–', hs.last ? hs.last.reason : 'No visits yet'),
      this.tile('Next appointment', hs.nextAppt ? this.D(hs.nextAppt.date) : 'None booked', hs.nextAppt ? hs.nextAppt.text : ''),
      this.tile('Medications', String(hs.meds.length), hs.meds.filter((m) => m.asNeeded).length ? `${hs.meds.filter((m) => m.asNeeded).length} as needed` : 'current'),
      this.tile('Vaccines', hs.overdue.length ? `${hs.overdue.length} overdue` : hs.dueSoon.length ? `${hs.dueSoon.length} due soon` : 'Up to date', `${hs.vacc.length} tracked`, { tone: hs.overdue.length ? 'bad' : hs.dueSoon.length ? 'warn' : 'good' }),
      this.tile('Vet spending', this.M(hs.spend, true), 'last 12 months')));
    body.append(hsx.el);

    // insurance snapshot
    const isx = this.section(is.ctx.kind === 'plan' ? `Insurance snapshot · ${is.ctx.name} (${is.ctx.petsCovered.map(petLabel).join(' + ')})` : 'Insurance snapshot', [btn('Open insurance', () => this.setTab('insurance'), { icon: 'arrow-right' })]);
    isx.body.append(this.verdictCard(is, true));
    if (is.hasPolicy) isx.body.append(h('div', { class: 'pd-tiles' },
      this.tile('Premiums paid', this.M(is.premiums, true), is.range.label, { tip: 'premium' }),
      this.tile('Reimbursed', this.M(is.reimbursed, true), is.pendingEst ? `+ ${this.M(is.pendingEst, true)} pending` : `${is.paid.length} paid claims`),
      this.tile('Net benefit', (is.net >= 0 ? '+' : '−') + this.M(Math.abs(is.net), true), is.net >= 0 ? 'ahead' : 'behind', { tip: 'netBenefit', tone: is.net >= 0 ? 'good' : 'bad' })));
    body.append(isx.el);

    // spending chart, 12 months
    const months = []; for (let i = 11; i >= 0; i--) months.push(monthKey(addMonths(t.slice(0, 7) + '-01', -i)));
    const pctx = petCtx(this.data, pet), pays = premiumPayments(pctx, months[0] + '-01', t);
    const vals = (f) => months.map(f);
    const sp = this.section(sharedPolicies(this.data, pet).length ? `Money in the last 12 months · ${petLabel(pet)}’s share of premiums` : 'Money in the last 12 months');
    const bo = {
      labels: months.map((m) => monthLabel(m)), yFmt: (v) => this.M(v, true), grid: VIEW_COLORS.grid, text: VIEW_COLORS.text, label: 'Monthly vet bills, premiums and reimbursements',
      hover: { label: (i) => monthLabel(months[i], true), value: (v) => this.M(v),
        extra: (i) => { const sr = bo.series; const n = sr[2].values[i] - sr[0].values[i] - sr[1].values[i]; const visits = pet.visits.filter((v) => v.date && v.date <= t && monthKey(v.date) === months[i]).length;
          return [['Vet visits', String(visits)], ['Your net cost', this.M(-n), n >= 0 ? 'pd-pos' : '']]; } },
      series: [
        { name: 'Vet bills', color: VIEW_COLORS.vet, values: vals((m) => sum(pet.visits.filter((v) => v.date && v.date <= t && monthKey(v.date) === m), 'cost')) },
        { name: 'Premiums', color: VIEW_COLORS.premium, values: vals((m) => sum(pays.filter((p) => monthKey(p.date) === m), 'amount')) },
        { name: 'Reimbursed', color: VIEW_COLORS.reimb, values: vals((m) => sum(pctx.claims.filter((c) => PAID.includes(c.status) && monthKey(c.paidDate || c.serviceDate) === m), 'reimbursed')) },
      ],
    };
    sp.body.append(this.chart(barChartSVG(bo), [{ name: 'Vet bills', color: VIEW_COLORS.vet }, { name: 'Premiums', color: VIEW_COLORS.premium }, { name: 'Reimbursed', color: VIEW_COLORS.reimb }], bo));
    body.append(sp.el);

    // recent activity
    const ev = [];
    pet.visits.filter((v) => v.date <= t).forEach((v) => ev.push({ date: v.date, icon: 'stethoscope', text: `Vet visit: ${v.reason || v.type}`, sub: hasVal(v.cost) ? this.M(num(v.cost)) : '' }));
    pctx.claims.forEach((c) => ev.push({ date: c.paidDate || c.submittedDate || c.serviceDate, icon: 'receipt', text: `Claim ${CLAIM_STATUS[c.status].toLowerCase()}: ${c.condition || ''}`, sub: PAID.includes(c.status) ? this.M(num(c.reimbursed)) : this.M(num(c.amountClaimed)) }));
    pet.observations.forEach((o) => ev.push({ date: o.date, icon: 'eye', text: `${o.category}: ${o.note}` }));
    pet.meds.filter((m) => m.start).forEach((m) => ev.push({ date: m.start, icon: 'pill', text: `Started ${m.name}` }));
    pet.vaccines.forEach((v) => ev.push({ date: v.dateGiven, icon: 'syringe', text: `${v.name} vaccine` }));
    const ra = this.section('Recent activity');
    const recent = ev.filter((e) => e.date && e.date <= t).sort(byDate('date', true)).slice(0, 8);
    ra.body.append(recent.length ? h('ul', { class: 'pd-timeline' }, recent.map((e) => h('li', {}, icon(e.icon), h('span', { class: 'pd-tl-date', text: this.D(e.date) }), h('span', { class: 'pd-tl-text', text: e.text }), e.sub ? h('span', { class: 'pd-tl-sub', text: e.sub }) : null))) : h('div', { class: 'pd-empty', text: 'Nothing recorded yet.' }));
    body.append(ra.el);

    // all pets
    if (this.data.pets.length > 1) {
      const ap = this.section('All pets');
      ap.body.append(this.table('allpets', [
        { label: 'Pet', render: (p) => h('span', {}, h('a', { href: '#', onclick: (e) => { e.preventDefault(); this.selectPet(p.id); } }, petLabel(p)), isArchived(p) ? h('span', {}, ' ', this.pill(archiveVerb(p), 'neutral')) : null) },
        { label: 'Species', render: (p) => [p.species, p.breed].filter(Boolean).join(' · ') },
        { label: 'Age', render: (p) => ageShort(p) },
        { label: 'Next due', render: (p) => { const x = healthStats(p, s, { from: addMonths(t, -12), to: t }).upcoming[0]; return x ? `${this.D(x.date)} · ${x.text}` : ''; } },
        { label: 'Insurance (own share)', render: (p) => { const c = petCtx(this.data, p); const v = insuranceStats(c, s, analysisRange(c, s)).verdict; return this.pill(v.label, v.level === 'good' ? 'good' : v.level === 'fair' ? 'warn' : v.level === 'poor' ? 'bad' : 'neutral'); } },
      ], this.data.pets, null));
      body.append(ap.el);
    }
  }
  editPet() {
    const pet = this.pet;
    const pf = petFields(this.data);
    new FormModal(this.app, { title: `Edit ${petLabel(pet)}`, fields: pf, onReady: pf.onReady, validate: pf.validate, initial: Object.assign({ dobMode: pet.dob || !pet.ageYears ? 'known' : 'estimated' }, pet),
      onDeleteLabel: 'Delete pet', onDeleteDirect: () => new DeletePetModal(this.app, this.plugin, pet).open(),
      onSubmit: async (v) => { Object.assign(pet, v); await this.save(); } }).open();
  }

  /* ---------- insurance ---------- */
  verdictCard(is, compact) {
    const v = is.verdict;
    const c = h('div', { class: 'pd-verdict level-' + v.level },
      h('div', { class: 'pd-verdict-top' }, h('div', { class: 'pd-verdict-kicker', text: 'Is insurance worth it?' }),
        h('div', { class: 'pd-verdict-label', text: v.label }),
        is.ratio != null ? h('div', { class: 'pd-verdict-ratio' }, h('strong', { text: fmtNum(is.ratio, 2) }), ' ', term('returnRatio', 'back per 1 paid')) : null),
      h('p', { class: 'pd-verdict-text', text: compact ? v.text.split('. ').slice(0, 2).join('. ').replace(/\.?$/, '.') : v.text }));
    if (v.meter != null) {
      const m = h('div', { class: 'pd-meter', title: 'Left: costing more than it returns · middle line: break-even' },
        h('span', { class: 'pd-meter-fill', style: { width: Math.round(v.meter * 100) + '%' } }),
        h('span', { class: 'pd-meter-mark', style: { left: Math.round(this.s.goodRatio / Math.max(1.5, this.s.goodRatio * 1.5) * 100) + '%' } }));
      c.append(m, h('div', { class: 'pd-meter-scale' }, h('span', { text: '0' }), h('span', { text: 'break-even' }), h('span', { text: '1.5×+' })));
    }
    return c;
  }
  renderInsurance(body) {
    const pet = this.pet, s = this.s, data = this.data;
    const shared = sharedPolicies(data, pet);
    if (this.insScope && this.insScope !== 'pet' && !shared.some((p) => p.id === this.insScope)) this.insScope = null;
    const ctx = defaultInsCtx(data, pet, this.insScope);
    const isPlan = ctx.kind === 'plan';
    const range = analysisRange(ctx, s), is = insuranceStats(ctx, s, range);
    const period = h('select', { class: 'dropdown pd-period', 'aria-label': 'Period' });
    [['all', 'Since coverage began'], ['policyYear', 'Current policy year'], ['12m', 'Last 12 months'], ['ytd', 'Year to date']].forEach(([k, l]) => period.append(h('option', { value: k, text: l })));
    period.value = s.analysisPeriod;
    period.addEventListener('change', async () => { s.analysisPeriod = period.value; await this.save(); });
    body.append(h('div', { class: 'pd-page-head' }, h('h2', { text: 'Insurance' }),
      h('div', { class: 'pd-actions' }, period, btn(wiStore(this.data).scenarios.length ? `What if… (${wiStore(this.data).scenarios.length})` : 'What if…', () => new WhatIfModal(this.app, this.plugin, this.pet, this.insScope).open(), { icon: 'flask-conical', cls: 'mod-cta pd-whatif-btn', title: 'What-if planner: test claims paid or denied, new bills, premium changes, cancelling, or a different plan' }), this.pdfButton('insurance'),
        btn('', () => new InsuranceHelpModal(this.app, this.plugin).open(), { icon: 'help-circle', cls: 'pd-help-btn', title: 'How this works and settings' }))));

    if (shared.length) {
      body.append(h('p', { class: 'pd-muted pd-small', text: isPlan
        ? 'Showing the whole multi-pet policy: every covered pet’s claims against the full premium.'
        : `Showing ${petLabel(pet)}’s part: ${petLabel(pet)}’s claims against ${petLabel(pet)}’s share of each premium (set the split in the policy).` }));
    }

    if (!is.hasPolicy) {
      body.append(h('div', { class: 'pd-welcome' }, h('h3', { text: `Track ${pet.name ? pet.name + '’s' : 'your pet’s'} insurance` }),
        h('p', {}, 'Add the policy, then log claims as you make them. The dashboard compares what you pay in ', term('premium', 'premiums'), ' with what comes back, so you can see whether the cover is worth it. One policy can cover several pets.'),
        h('div', { class: 'pd-actions' }, btn('Add policy', () => this.editPolicy(), { cls: 'mod-cta', icon: 'plus' }),
          data.policies.length ? btn('Add to an existing policy', () => this.editPolicy(data.policies[0]), { icon: 'link' }) : null)));
      return;
    }
    body.append(this.verdictCard(is));
    body.append(h('div', { class: 'pd-tiles' },
      this.tile('Premiums paid', this.M(is.premiums), `${is.payments.length} payments · ${range.label.toLowerCase()}${!isPlan && shared.length ? ' · share' : ''}`, { tip: 'premium' }),
      this.tile('Reimbursed', this.M(is.reimbursed), `${plural(is.paid.length, 'paid claim')}`),
      this.tile('Net benefit', (is.net >= 0 ? '+' : '−') + this.M(Math.abs(is.net)), s.includePending && is.pendingEst ? 'incl. pending estimate' : 'reimbursed − premiums', { tip: 'netBenefit', tone: is.net >= 0 ? 'good' : 'bad' }),
      this.tile('Vet bills while insured', this.M(is.vetCosts), `${fmtPct(is.coverage)} paid back`, { tip: 'coverage' }),
      this.tile('Out of pocket', this.M(is.oopWith), `vs ${this.M(is.oopWithout, true)} with no insurance`, { tip: 'outOfPocket' }),
      this.tile('Pending claims', is.pending.length ? this.M(is.pendingEst) : 'None', is.pending.length ? `estimated from ${this.M(is.pendingClaimed, true)} claimed` : '', { tip: 'pending' }),
      this.tile('Approval rate', fmtPct(is.approvalRate), `${is.paid.length} paid · ${is.denied.length} denied`, { tip: 'approvalRate' }),
      this.tile('Days to pay', is.turnaround != null ? fmtNum(is.turnaround, 0) : '–', 'average', { tip: 'turnaround' })));

    if (isPlan) {
      const bp = this.section('By pet');
      bp.body.append(this.table('bypet', [
        { label: 'Pet', render: (r) => h('strong', { text: petLabel(r.pet) }) },
        { label: 'On the plan', render: (r) => { const j = petJoin(ctx.policy, r.pet.id), l = petLeave(ctx.policy, r.pet.id); return `${this.D(j)} – ${l && l < todayISO() ? this.D(l) : 'now'}`; } },
        { label: 'Share now', cls: 'num', render: (r) => petOnPolicyAt(ctx.policy, r.pet.id, todayISO()) ? fmtPct(policyShare(data, ctx.policy, r.pet.id)) : '–' },
        { label: 'Premiums (share)', cls: 'num', render: (r) => this.M(r.premiums) },
        { label: 'Vet bills', cls: 'num', render: (r) => this.M(r.vet) },
        { label: 'Reimbursed', cls: 'num', render: (r) => this.M(r.reimbursed) },
        { label: 'Net', cls: 'num', render: (r) => { const n = r.reimbursed - r.premiums; return h('span', { class: n >= 0 ? 'pd-pos' : 'pd-neg', text: (n >= 0 ? '+' : '−') + this.M(Math.abs(n)) }); } },
        { label: 'Claims', cls: 'num', render: (r) => String(r.claims) },
      ], is.byPet, null));
      body.append(bp.el);
    }

    const ch = this.section('Premiums vs reimbursements (running total)');
    const months = is.series.map((r) => r.month);
    const co = {
      zero: true, yFmt: (v) => this.M(v, true), grid: VIEW_COLORS.grid, text: VIEW_COLORS.text, xTicks: monthTicks(months), label: 'Cumulative premiums and reimbursements',
      hover: { label: (i) => `${monthLabel(is.series[i].month, true)} · running total`, value: (v) => this.M(v),
        extra: (i) => { const r = is.series[i], n = r.cumReimbursed - r.cumPremiums;
          return [['This month: premiums', this.M(r.premiums)], ['This month: vet bills', this.M(r.vet)], ['This month: reimbursed', this.M(r.reimbursed)],
            ['Running net', (n >= 0 ? '+' : '−') + this.M(Math.abs(n)), n >= 0 ? 'pd-pos' : 'pd-neg'], ['Return per 1 paid', r.cumPremiums ? fmtNum(r.cumReimbursed / r.cumPremiums, 2) : '–']]; } },
      series: [
        { name: 'Premiums', color: VIEW_COLORS.premium, points: is.series.map((r, i) => ({ x: i, y: r.cumPremiums, title: `${monthLabel(r.month, true)}: ${this.M(r.cumPremiums)} paid` })) },
        { name: 'Reimbursed', color: VIEW_COLORS.reimb, area: true, points: is.series.map((r, i) => ({ x: i, y: r.cumReimbursed, title: `${monthLabel(r.month, true)}: ${this.M(r.cumReimbursed)} back` })) },
      ],
    };
    ch.body.append(this.chart(lineChartSVG(co), [{ name: 'Premiums paid', color: VIEW_COLORS.premium }, { name: 'Reimbursed', color: VIEW_COLORS.reimb }], co));
    ch.body.append(h('p', { class: 'pd-muted pd-small', text: 'Hover over the chart (or focus it and use the arrow keys) for each month’s figures. When the green line is above the orange one, the policy has paid back more than it has cost.' }));
    body.append(ch.el);

    if (is.policy) {
      const P = is.policy, pol = P.policy, ded = P.ded;
      const py = this.section(h('span', {}, 'This ', term('policyYear', 'policy year'), ` · ${policyLabel(pol)} · ${this.D(ded.yearStart)} – ${this.D(ded.yearEnd)}`));
      const dedSub = (ded.remaining > 0 ? `${this.M(ded.remaining, true)} to go` : 'Met for this year') + (P.nPets > 1 ? (ded.dedShared ? ' · shared' : (isPlan ? ' · all pets combined' : ' · this pet')) : '');
      py.body.append(h('div', { class: 'pd-tiles' },
        this.tile('Deductible met', `${this.M(ded.met, true)} of ${this.M(ded.deductible, true)}`, dedSub, { tip: 'deductible', progress: ded.deductible ? ded.met / ded.deductible : 1 }),
        this.tile('Annual limit used', ded.limit ? `${this.M(ded.used, true)} of ${this.M(ded.limit, true)}` : this.M(ded.used, true), ded.limit ? `${this.M(ded.limitRemaining, true)} left` : 'Unlimited plan', { tip: 'annualLimit', progress: ded.limit ? ded.used / ded.limit : null }),
        this.tile(P.share < 1 ? 'Premium now (share)' : 'Premium now', `${this.M(P.rateNow)}`, `per ${pol.frequency === 'annual' ? 'year' : 'month'}${P.share < 1 ? ` · ${fmtPct(P.share)} of ${this.M(P.rateFull)}` : ''}${P.increase ? ` · ${P.increase > 0 ? '+' : ''}${fmtPct(P.increase)} since ${P.petsChanged ? this.D(P.increaseSince) : 'start'}` : ''}`, { tip: 'premium', tone: P.increase > 0.1 ? 'warn' : null }),
        this.tile('Break-even', P.breakEven != null ? this.M(P.breakEven, true) : '–', `eligible vet bills a year${isPlan && P.nPets > 1 ? ', all pets' : ''}`, { tip: 'breakEven' }),
        this.tile('Renews', P.renewal ? this.D(P.renewal) : P.active ? '–' : 'Ended', P.renewal ? `in ${plural(daysBetween(todayISO(), P.renewal), 'day')}` : '', { tip: 'renewal' })));
      if (isPlan && P.nPets > 1 && !ded.dedShared) {
        py.body.append(h('div', { class: 'pd-chips' }, ded.per.map((x) => h('span', { class: 'pd-chip' }, `${petLabel(x.pet)}: deductible ${this.M(x.met, true)} of ${this.M(num(pol.deductible), true)}`, h('b', { text: x.met >= num(pol.deductible) ? ' ✓' : '' })))));
      }
      body.append(py.el);
    }

    if (is.review.length) {
      const rv = this.section('Worth reviewing');
      rv.body.append(h('ul', { class: 'pd-bullets' }, is.review.map((x) => h('li', { text: x }))));
      body.append(rv.el);
    }

    const petName = (id) => petLabel(data.pets.find((p) => p.id === id));
    const cl = this.section('Claims', [btn('Add claim', () => this.editClaim(), { icon: 'plus' })]);
    const tone = { approved: 'good', partial: 'warn', denied: 'bad', submitted: 'info', review: 'info', draft: 'neutral' };
    const cols = [
      { label: 'Treatment', render: (c) => this.D(c.serviceDate) },
      isPlan ? { label: 'Pet', render: (c) => petName(c.petId) } : null,
      { label: 'Condition', render: (c) => c.condition },
      { label: 'Claimed', cls: 'num', tip: 'claim', render: (c) => this.M(num(c.amountClaimed)) },
      { label: 'Status', render: (c) => this.pill(CLAIM_STATUS[c.status] || c.status, tone[c.status]) },
      { label: 'Paid to you', cls: 'num', render: (c) => PAID.includes(c.status) ? this.M(num(c.reimbursed)) : PENDING.includes(c.status) && is.pendingPer[c.id] != null ? h('span', { class: 'pd-muted', text: `~${this.M(is.pendingPer[c.id])}` }) : c.status === 'denied' ? (c.denialReason || '') : '' },
      { label: 'Days', cls: 'num', tip: 'turnaround', render: (c) => c.submittedDate && c.paidDate ? String(daysBetween(c.submittedDate, c.paidDate)) : '' },
    ].filter(Boolean);
    cl.body.append(this.table('claims', cols, ctx.claims.slice().sort(byDate('serviceDate', true)), (c) => this.editClaim(c), { empty: 'No claims yet.' }));
    body.append(cl.el);

    if (is.unclaimed.length) {
      const uc = this.section(h('span', {}, term('unclaimed', 'Possibly unclaimed visits')));
      uc.body.append(this.table('unclaimed', [
        { label: 'Date', render: (v) => this.D(v.date) }, isPlan ? { label: 'Pet', render: (v) => petLabel(v._pet) } : null,
        { label: 'Reason', render: (v) => v.reason }, { label: 'Cost', cls: 'num', render: (v) => this.M(num(v.cost)) },
        { label: '', render: (v) => h('span', { class: 'pd-actions' }, btn('Create claim', () => this.editClaim(null, v), { cls: 'pd-small-btn' }),
          btn('Not covered', async () => { v._ref.notClaimable = true; await this.save(); }, { cls: 'pd-small-btn', title: 'Mark as not covered so it stops showing here' })) },
      ].filter(Boolean), is.unclaimed, null));
      body.append(uc.el);
    }

    const myPolicies = isPlan ? [ctx.policy] : ctx.policies;
    const ps = this.section(isPlan ? 'Policy' : 'Policies', [btn('Rate change', () => this.edit(data, 'premiumChanges', rateFields(data, myPolicies), 'rate change', null, null, { policyId: myPolicies[0].id }), { icon: 'trending-up' }), btn('Add policy', () => this.editPolicy(), { icon: 'plus' })]);
    myPolicies.slice().sort(byDate('start', true)).forEach((p) => {
      const kv = (k, v) => h('div', { class: 'pd-kv' }, h('span', { class: 'pd-k' }, k), h('span', { class: 'pd-v' }, v || '–'));
      const active = activeOn(p, todayISO()), pets = petsOnPolicy(data, p), scope = (x) => pets.length > 1 ? (x === 'shared' ? ', shared' : ', per pet') : '';
      ps.body.append(h('div', { class: 'pd-card' },
        h('div', { class: 'pd-card-head' }, h('div', {}, h('strong', { text: p.provider }), p.plan ? h('span', { class: 'pd-muted', text: ' · ' + p.plan }) : null, ' ', this.pill(active ? 'Active' : p.start > todayISO() ? 'Not started' : 'Ended', active ? 'good' : 'neutral'), pets.length > 1 ? h('span', {}, ' ', this.pill(`Multi-pet · ${pets.length}`, 'info')) : null),
          btn('', () => this.editPolicy(p), { icon: 'pencil', cls: 'pd-icon-btn', title: 'Edit policy' })),
        h('div', { class: 'pd-kvs pd-kvs-3' },
          kv('Pets covered', h('span', { class: 'pd-pet-lines' }, pets.map((pt) => h('span', {}, h('strong', { text: petLabel(pt) }), ` ${this.petTerm(p, pt)}`)))),
          kv('Policy no.', p.policyNumber), kv('Coverage', p.coverage), kv('Dates', `${this.D(p.start)} – ${p.end ? this.D(p.end) : 'ongoing'}`),
          kv(term('premium', 'Premium now'), `${this.M(rateAt(ctx, p, todayISO()))} / ${p.frequency === 'annual' ? 'year' : 'month'}${pets.length > 1 ? ' total' : ''}`),
          kv(term('deductible', 'Deductible'), `${this.M(num(p.deductible), true)} (${({ annual: 'annual', condition: 'per condition', incident: 'per incident', lifetime: 'lifetime' })[p.deductibleType] || 'annual'}${scope(p.deductibleScope)})`),
          kv(term('reimbursement', 'Reimbursement'), `${num(p.reimbursement)}%`),
          kv(term('annualLimit', 'Annual limit'), num(p.annualLimit) ? this.M(num(p.annualLimit), true) + scope(p.limitScope) : 'Unlimited'),
          kv(term('waitingPeriod', 'Waiting period'), hasVal(p.waitingPeriod) ? plural(num(p.waitingPeriod), 'day') : ''),
          kv('Contact', [p.phone, p.website].filter(Boolean).join(' · '))),
        p.exclusions ? h('div', { class: 'pd-small pd-muted' }, term('exclusion', 'Exclusions'), ': ' + p.exclusions) : null));
    });
    const rc = data.premiumChanges.filter((c) => myPolicies.some((p) => p.id === c.policyId)).sort(byDate('date', true));
    if (rc.length) {
      ps.body.append(h('h4', { class: 'pd-subhead', text: 'Premium history (whole policy)' }));
      ps.body.append(this.table('rates', [
        { label: 'Effective', render: (c) => this.D(c.date) },
        { label: 'Policy', render: (c) => policyLabel(data.policies.find((p) => p.id === c.policyId) || {}) },
        { label: 'New premium', cls: 'num', render: (c) => this.M(num(c.amount)) },
        { label: 'Change', cls: 'num', render: (c) => { const p = data.policies.find((x) => x.id === c.policyId); if (!p) return ''; const prev = rateAt(ctx, p, addDays(c.date, -1)); return prev ? `${num(c.amount) >= prev ? '+' : ''}${fmtPct((num(c.amount) - prev) / prev, 1)}` : ''; } },
        { label: 'Reason', render: (c) => c.reason },
      ], rc, (c) => this.edit(data, 'premiumChanges', rateFields(data), 'rate change', c)));
    }
    body.append(ps.el);
  }
  petTerm(p, pt) {
    const j = petJoin(p, pt.id), l = petLeave(p, pt.id), t = todayISO(), multi = petsOnPolicy(this.data, p).length > 1;
    const share = multi && petOnPolicyAt(p, pt.id, t) ? `${fmtPct(policyShare(this.data, p, pt.id, t))} of premium · ` : '';
    const when = l && l < t ? `${this.D(j)} – ${this.D(l)} (left)` : j > t ? `joins ${this.D(j)}` : `since ${this.D(j)}${j > p.start ? ' (joined later)' : ''}`;
    return `${share}${when}`;
  }
  editPolicy(p) {
    const fields = policyFields(this.data);
    const init = p ? null : { petIds: [this.pet.id], split: 'equal', shares: {}, frequency: 'monthly', deductibleType: 'annual', deductibleScope: 'perPet', limitScope: 'perPet', coverage: 'Accident & illness', start: todayISO() };
    this.edit(this.data, 'policies', fields, 'policy', p || null, null, init);
  }
  editClaim(c, visit) {
    const data = this.data, pet = visit ? visit._pet : this.pet;
    if (!data.policies.length) { new Notice('Add an insurance policy first.'); return; }
    const pol = coveringPolicy(petCtx(data, pet), todayISO(), pet.id) || data.policies.find((p) => p.petIds.includes(pet.id)) || data.policies[0];
    let init = null;
    if (!c) {
      init = { petId: pet.id, status: 'submitted', submittedDate: todayISO(), policyId: pol.id };
      if (visit) Object.assign(init, { visitId: visit.id, serviceDate: visit.date, amountClaimed: visit.cost, condition: visit.diagnosis || visit.reason,
        policyId: (data.policies.find((p) => p.petIds.includes(pet.id) && activeOn(p, visit.date)) || pol).id });
    }
    this.edit(data, 'claims', claimFields(data, this.s), 'claim', c || null, null, init);
  }

  /* ---------- health ---------- */
  renderHealth(body) {
    const pet = this.pet, s = this.s, t = todayISO();
    const hs = healthStats(pet, s, { from: addDays(addMonths(t, -12), 1), to: t });
    body.append(h('div', { class: 'pd-page-head' }, h('h2', { text: 'Health' }), h('div', { class: 'pd-actions' }, this.pdfButton('health'))));
    if (isArchived(pet)) body.append(this.memorial(pet));
    body.append(h('div', { class: 'pd-tiles' },
      this.tile('Last visit', hs.last ? this.D(hs.last.date) : '–', hs.last ? hs.last.reason : ''),
      this.tile('Next appointment', hs.nextAppt ? this.D(hs.nextAppt.date) : 'None booked', hs.nextAppt ? hs.nextAppt.text : ''),
      this.tile('Visits', String(hs.visitsR.length), `last 12 months · ${this.M(hs.spend, true)}`),
      this.tile('Medications', String(hs.meds.length), hs.refills.length ? `${hs.refills.length} refill due` : 'current', { tone: hs.refills.length ? 'warn' : null }),
      this.tile('Vaccines', hs.overdue.length ? `${hs.overdue.length} overdue` : hs.dueSoon.length ? `${hs.dueSoon.length} due soon` : 'Up to date', `${hs.vacc.length} tracked`, { tone: hs.overdue.length ? 'bad' : hs.dueSoon.length ? 'warn' : 'good' }),
      this.tile('Weight', hs.latestW ? `${fmtNum(num(hs.latestW.weight))} ${s.weightUnit}` : '–', hs.wChange != null ? `${hs.wChange >= 0 ? '+' : '−'}${fmtNum(Math.abs(hs.wChange))} ${s.weightUnit} in 12 months` : '', { tip: 'bcs', tone: hs.wPct != null && Math.abs(hs.wPct) >= 0.05 ? 'warn' : null }),
      this.tile('Observations', String(hs.obs30.length), 'last 30 days')));

    const cs = this.section('Vet contacts', [btn('Edit', () => this.editPet(), { icon: 'pencil' })]);
    const pv = this.contact(pet.primaryVet, pet.vetPhone, pet.vetAddress, true), ev = this.contact(pet.emergencyVet, pet.emergencyPhone, pet.emergencyAddress, true);
    cs.body.append(h('div', { class: 'pd-contacts' },
      h('div', { class: 'pd-contact-card' }, h('div', { class: 'pd-tile-label', text: 'Primary vet' }), pv || h('span', { class: 'pd-empty', text: 'Not set' })),
      h('div', { class: 'pd-contact-card is-emergency' }, h('div', { class: 'pd-tile-label' }, icon('siren'), ' Emergency vet'), ev || h('span', { class: 'pd-empty', text: 'Not set — add one before you need it' }))));
    body.append(cs.el);
    const up = this.section('Coming up');
    up.body.append(hs.upcoming.length ? h('ul', { class: 'pd-alerts' }, hs.upcoming.slice(0, 8).map((u) => h('li', { class: 'tone-' + (u.overdue ? 'bad' : u.kind === 'Appointment' || u.kind === 'Follow-up' ? 'info' : 'warn') }, h('span', { class: 'pd-dot' }), h('strong', { text: this.D(u.date) }), ` · ${u.kind}: ${u.text}${u.sub ? ' · ' + u.sub : ''}`))) : h('div', { class: 'pd-empty', text: 'Nothing scheduled or due.' }));
    if (hs.discuss.length) up.body.append(h('div', { class: 'pd-discuss' }, h('strong', { text: 'To mention at the next visit' }), h('ul', { class: 'pd-bullets' }, hs.discuss.map((x) => h('li', { text: x })))));
    body.append(up.el);

    const afterVisit = (v) => {
      if (hasVal(v.weight) && !pet.weights.some((w) => w.date === v.date)) pet.weights.push({ id: uid(), date: v.date, weight: num(v.weight), notes: 'From vet visit' });
    };
    const vs = this.section('Vet visits', [btn('Add visit', () => this.edit(pet, 'visits', visitFields(s), 'vet visit', null, afterVisit), { icon: 'plus' })]);
    vs.body.append(this.table('visits', [
      { label: 'Date', render: (v) => v.date > t ? h('span', {}, this.D(v.date), ' ', this.pill('Upcoming', 'info')) : this.D(v.date) },
      { label: 'Type', render: (v) => v.type },
      { label: 'Reason', render: (v) => v.reason },
      { label: 'Findings / next steps', render: (v) => [v.diagnosis, v.treatment].filter(Boolean).join(' — ') },
      { label: 'Clinic', render: (v) => [v.clinic, v.vet].filter(Boolean).join(' · ') },
      { label: 'Cost', cls: 'num', render: (v) => hasVal(v.cost) ? this.M(num(v.cost)) : '' },
    ], pet.visits.slice().sort(byDate('date', true)), (v) => this.edit(pet, 'visits', visitFields(s), 'vet visit', v, afterVisit), { empty: 'No vet visits recorded.' }));
    body.append(vs.el);

    const ms = this.section('Medications', [btn('Add medication', () => this.edit(pet, 'meds', medFields(), 'medication', null), { icon: 'plus' })]);
    const medCols = [
      { label: 'Medication', render: (m) => h('span', {}, h('strong', { text: m.name }), m.dose ? ` ${m.dose}` : '', m.form ? h('span', { class: 'pd-muted', text: `, ${m.form}` }) : '') },
      { label: 'How to give', render: (m) => h('span', {}, m.frequency || '', m.asNeeded ? h('span', {}, ' ', this.pill('as needed', 'info')) : '') },
      { label: 'For', render: (m) => m.purpose },
      { label: 'Since', render: (m) => m.start ? this.D(m.start) : '' },
      { label: 'Refill due', tip: 'refill', render: (m) => m.refillDue ? (m.refillDue <= addDays(t, 7) ? this.pill(this.D(m.refillDue), m.refillDue < t ? 'bad' : 'warn') : this.D(m.refillDue)) : '' },
    ];
    ms.body.append(this.table('meds', medCols, hs.meds.sort(byDate('start', true)), (m) => this.edit(pet, 'meds', medFields(), 'medication', m), { empty: 'No current medications.' }));
    const past = pet.meds.filter((m) => m.end && m.end < t).sort(byDate('end', true));
    if (past.length) {
      ms.body.append(h('h4', { class: 'pd-subhead', text: 'Stopped' }));
      ms.body.append(this.table('pastmeds', [
        { label: 'Medication', render: (m) => `${m.name}${m.dose ? ' ' + m.dose : ''}` }, { label: 'For', render: (m) => m.purpose },
        { label: 'Taken', render: (m) => `${m.start ? this.D(m.start) : '?'} – ${this.D(m.end)}` }, { label: 'Why stopped', render: (m) => m.whyStopped },
      ], past, (m) => this.edit(pet, 'meds', medFields(), 'medication', m), { limit: 4 }));
    }
    body.append(ms.el);

    const vx = this.section('Vaccinations', [btn('Add vaccine', () => this.edit(pet, 'vaccines', vaccineFields(), 'vaccination', null), { icon: 'plus' })]);
    const stTone = { overdue: 'bad', soon: 'warn', ok: 'good', none: 'neutral' }, stTxt = { overdue: 'Overdue', soon: 'Due soon', ok: 'Up to date', none: 'No due date' };
    vx.body.append(this.table('vacc', [
      { label: 'Vaccine', render: (x) => h('strong', { text: x.v.name }) },
      { label: 'Last given', render: (x) => this.D(x.v.dateGiven) },
      { label: 'Next due', tip: 'nextDue', render: (x) => x.v.nextDue ? this.D(x.v.nextDue) : '' },
      { label: 'Status', render: (x) => this.pill(stTxt[x.status], stTone[x.status]) },
      { label: 'Clinic', render: (x) => x.v.clinic },
    ], hs.vacc, (x) => this.edit(pet, 'vaccines', vaccineFields(), 'vaccination', x.v), { empty: 'No vaccinations recorded.' }));
    if (pet.vaccines.length > hs.vacc.length) vx.body.append(h('p', { class: 'pd-muted pd-small', text: `Showing the latest dose of each vaccine. ${pet.vaccines.length} doses recorded in total; the PDF lists them all.` }));
    body.append(vx.el);

    const ws = this.section('Weight', [btn('Add weight', () => this.edit(pet, 'weights', weightFields(s), 'weight', null), { icon: 'plus' })]);
    if (hs.weights.length) {
      const W = hs.weights, U = s.weightUnit;
      const wo = {
        h: 190, grid: VIEW_COLORS.grid, text: VIEW_COLORS.text, yFmt: (v) => `${fmtNum(v)} ${U}`, xTicks: dateTicks(W.map((w) => w.date)), label: 'Weight over time',
        hover: { label: (x) => this.D(toISO(new Date(x))), value: (v) => `${fmtNum(v)} ${U}`,
          extra: (x, i) => { const w = W.find((q) => parseISO(q.date).getTime() === x), prev = W.filter((q) => parseISO(q.date).getTime() < x).pop(), first = W[0];
            const ch = (a, b) => { const d = num(a.weight) - num(b.weight); return `${d >= 0 ? '+' : '−'}${fmtNum(Math.abs(d))} ${U} (${fmtPct(Math.abs(d) / num(b.weight), 1)})`; };
            return [prev ? ['Since previous', ch(w, prev)] : null, first && first !== w ? ['Since first', ch(w, first)] : null, w && w.notes ? ['Note', w.notes] : null]; } },
        series: [{ name: 'Weight', color: VIEW_COLORS.weight, area: true, points: W.map((w) => ({ x: parseISO(w.date).getTime(), y: num(w.weight) })) }],
      };
      ws.body.append(this.chart(lineChartSVG(wo), null, wo));
    }
    ws.body.append(this.table('weights', [
      { label: 'Date', render: (w) => this.D(w.date) }, { label: 'Weight', cls: 'num', render: (w) => `${fmtNum(num(w.weight))} ${s.weightUnit}` }, { label: 'Notes', render: (w) => w.notes },
    ], hs.weights.slice().reverse(), (w) => this.edit(pet, 'weights', weightFields(s), 'weight', w), { limit: 5, empty: 'No weights logged.' }));
    body.append(ws.el);

    const os = this.section('Observations', [btn('Add observation', () => this.edit(pet, 'observations', obsFields(), 'observation', null), { icon: 'plus' })]);
    const cnt = Object.entries(hs.counts).sort((a, b) => b[1] - a[1]);
    if (cnt.length) os.body.append(h('div', { class: 'pd-chips' }, cnt.map(([c, n]) => h('span', { class: 'pd-chip' }, c, h('b', { text: ' ' + n })))));
    const sev = { 1: ['Mild', 'neutral'], 2: ['Moderate', 'warn'], 3: ['Severe', 'bad'] };
    os.body.append(this.table('obs', [
      { label: 'Date', render: (o) => this.D(o.date) }, { label: 'Category', render: (o) => o.category },
      { label: 'Severity', render: (o) => { const x = sev[o.severity] || sev[1]; return this.pill(x[0], x[1]); } }, { label: 'Note', render: (o) => o.note },
    ], pet.observations.slice().sort(byDate('date', true)), (o) => this.edit(pet, 'observations', obsFields(), 'observation', o), { empty: 'Log anything unusual: appetite, energy, vomiting, limping…' }));
    body.append(os.el);

    const ns = this.section('Notes', [btn('Add note', () => this.edit(pet, 'notes', noteFields(), 'note', null), { icon: 'plus' })]);
    ns.body.append(this.table('notes', [
      { label: 'Date', render: (n) => this.D(n.date) }, { label: 'Title', render: (n) => h('strong', { text: n.title || '' }) }, { label: 'Note', render: (n) => n.text },
    ], pet.notes.slice().sort(byDate('date', true)), (n) => this.edit(pet, 'notes', noteFields(), 'note', n), { limit: 5, empty: 'No notes.' }));
    body.append(ns.el);
  }
}
/* ---------------- modals ---------------- */
class TitleModal extends Modal {
  constructor(app, plugin, pet) { super(app); this.plugin = plugin; this.pet = pet; }
  onOpen() {
    const { contentEl, pet } = this; this.modalEl.addClass && this.modalEl.addClass('pd-modal');
    contentEl.append(h('h3', { class: 'pd-modal-title', text: 'Rename dashboard' }));
    contentEl.append(h('p', { class: 'pd-muted', text: `Each pet keeps its own dashboard name. This changes the name shown for ${petLabel(pet)}.` }));
    let mode = pet.titleMode || 'default';
    const custom = h('input', { type: 'text', placeholder: 'Custom name', value: pet.customTitle || '' });
    const opt = (val, label, disabled) => {
      const r = h('input', { type: 'radio', name: 'pd-title-mode', value: val }); r.checked = mode === val; r.disabled = !!disabled;
      r.addEventListener('change', () => { mode = val; custom.disabled = val !== 'custom'; });
      return h('label', { class: 'pd-radio' + (disabled ? ' is-disabled' : '') }, r, ' ', label);
    };
    contentEl.append(h('div', { class: 'pd-radios' },
      opt('default', 'Pet Dashboard (default)'),
      opt('pet', pet.name ? `${pet.name} Dashboard` : '[pet’s name] Dashboard — add a name in the profile first', !pet.name),
      h('div', { class: 'pd-radio-custom' }, opt('custom', 'Custom:'), custom)));
    custom.disabled = mode !== 'custom';
    contentEl.append(h('div', { class: 'pd-form-actions' }, h('span', { class: 'pd-spacer' }), btn('Cancel', () => this.close()),
      btn('Save', async () => { pet.titleMode = mode; pet.customTitle = custom.value.trim(); this.close(); await this.plugin.saveAll(); }, { cls: 'mod-cta' })));
  }
  onClose() { clear(this.contentEl); }
}

function insuranceSettings(container, plugin, opts = {}) {
  const s = plugin.data.settings, save = () => plugin.saveAll();
  new Setting(container).setName('Currency').setDesc('Used for every amount on the dashboard and in reports.')
    .addDropdown((d) => { ['USD', 'CAD', 'EUR', 'GBP', 'AUD', 'NZD', 'CHF', 'SEK', 'NOK', 'DKK', 'ISK', 'JPY', 'ZAR', 'INR', 'MXN', 'BRL'].forEach((c) => d.addOption(c, c)); d.setValue(s.currency).onChange(async (v) => { s.currency = v; await save(); }); });
  new Setting(container).setName('Period to judge').setDesc('Which stretch of time the insurance summary covers.')
    .addDropdown((d) => d.addOption('all', 'Since coverage began').addOption('policyYear', 'Current policy year').addOption('12m', 'Last 12 months').addOption('ytd', 'Year to date')
      .setValue(s.analysisPeriod).onChange(async (v) => { s.analysisPeriod = v; await save(); }));
  new Setting(container).setName('“Paying off” at').setDesc('Return per 1 paid at or above this counts as paying off. 1.00 = break-even.')
    .addText((t) => { t.inputEl && (t.inputEl.type = 'number', t.inputEl.step = '0.05'); t.setValue(String(s.goodRatio)).onChange(async (v) => { if (num(v) > 0) { s.goodRatio = num(v); await save(); } }); });
  new Setting(container).setName('“Partly paying off” at').setDesc('Below the line above but at or above this is “partly paying off”; lower is “costing more than it returns”.')
    .addText((t) => { t.inputEl && (t.inputEl.type = 'number', t.inputEl.step = '0.05'); t.setValue(String(s.fairRatio)).onChange(async (v) => { if (num(v) >= 0) { s.fairRatio = num(v); await save(); } }); });
  new Setting(container).setName('Count pending claims').setDesc('Include the estimated payout of claims still being processed in the verdict and net benefit.')
    .addToggle((t) => t.setValue(!!s.includePending).onChange(async (v) => { s.includePending = v; await save(); }));
  new Setting(container).setName('Emergency example').setDesc('A sample large bill used to show what the policy protects you from.')
    .addText((t) => { t.inputEl && (t.inputEl.type = 'number'); t.setValue(String(s.emergencyExample)).onChange(async (v) => { s.emergencyExample = num(v); await save(); }); });
  if (opts.all) {
    new Setting(container).setName('Date format')
      .addDropdown((d) => { ['MMM D, YYYY', 'D MMM YYYY', 'YYYY-MM-DD', 'MM/DD/YYYY', 'DD/MM/YYYY'].forEach((f) => d.addOption(f, fmtDate(todayISO(), f))); d.setValue(s.dateFormat).onChange(async (v) => { s.dateFormat = v; await save(); }); });
    new Setting(container).setName('Weight unit')
      .addDropdown((d) => d.addOption('lb', 'Pounds (lb)').addOption('kg', 'Kilograms (kg)').setValue(s.weightUnit).onChange(async (v) => { s.weightUnit = v; await save(); }));
  }
}

class InsuranceHelpModal extends Modal {
  constructor(app, plugin) { super(app); this.plugin = plugin; }
  onOpen() {
    const { contentEl } = this, data = this.plugin.data, s = data.settings, M = (n) => fmtMoney(n, s.currency, true);
    this.modalEl.addClass && this.modalEl.addClass('pd-modal', 'pd-help-modal');
    const pet = this.plugin.activePet(), pol = currentPolicy(petCtx(data, pet));
    const ded = pol ? num(pol.deductible) : 250, rate = pol ? num(pol.reimbursement) : 80, bill = 1000;
    const pay = Math.max(0, bill - ded) * rate / 100;
    const sec = (title, ...kids) => h('details', { class: 'pd-help-sec', open: title === 'How a claim is paid' ? true : null }, h('summary', { text: title }), h('div', {}, kids));
    contentEl.append(h('h3', { class: 'pd-modal-title', text: 'How pet insurance tracking works' }));
    contentEl.append(h('p', {}, 'Pet insurance pays back part of your vet bills in return for a regular ', term('premium'), '. This dashboard compares what you pay with what comes back so you can judge whether the policy is worth the cost. Hover over or tab to any underlined word for a plain-language definition.'));
    contentEl.append(
      sec('How a claim is paid',
        h('p', {}, `Using ${pol ? 'your current policy' : 'an example policy'}: a ${M(bill)} eligible bill, a ${M(ded)} `, term('deductible'), ` and an ${rate}% `, term('reimbursement', 'reimbursement rate'), '.'),
        h('ol', {},
          h('li', { text: `You pay the vet ${M(bill)} and send a claim.` }),
          h('li', { text: `If the deductible is not yet met, the first ${M(ded)} is yours: ${M(bill)} − ${M(ded)} = ${M(Math.max(0, bill - ded))}.` }),
          h('li', { text: `The insurer pays ${rate}% of what is left: ${M(pay)} back to you.` }),
          h('li', { text: `Your cost for this visit: ${M(bill - pay)}, plus the premiums you pay anyway.` })),
        h('p', { class: 'pd-muted' }, 'Once the deductible is met for the ', term('policyYear', 'policy year'), ', later claims are paid at the full rate until the ', term('annualLimit', 'annual limit'), ' is reached.')),
      sec('Multi-pet policies',
        h('p', {}, 'One policy can cover several pets: tick them under “Pets on this policy”. Its premium is the total for all of them.'),
        h('ul', {},
          h('li', { text: 'Whole plan view: all covered pets’ claims against the full premium. This answers “is this plan worth it for the household?”' }),
          h('li', { text: 'A pet’s share view: that pet’s claims against its share of the premium, split equally or by the percentages you set.' }),
          h('li', { text: 'Deductibles and annual limits can apply to each pet separately (most common) or once for the whole policy. Set this in the policy.' }))),
      sec('How each number is calculated',
        h('ul', { class: 'pd-formulas' },
          h('li', {}, h('b', { text: 'Premiums paid' }), ' = every billing date from the policy start (monthly or yearly) up to today, at the premium in force on that date. Rate changes take effect from their date. In a pet’s share view each payment is multiplied by that pet’s share.'),
          h('li', {}, h('b', { text: 'Reimbursed' }), ' = “amount paid to you” on claims marked Paid or Partly paid, by date of treatment.'),
          h('li', {}, h('b', {}, term('pending', 'Pending estimate')), ` = for each submitted claim: (eligible or claimed amount − deductible still to meet) × reimbursement rate, capped at the limit left. Counted in the verdict only when “Count pending claims” is on.`),
          h('li', {}, h('b', {}, term('netBenefit')), ' = reimbursed (+ pending estimate) − premiums paid.'),
          h('li', {}, h('b', {}, term('returnRatio')), ' = reimbursed (+ pending estimate) ÷ premiums paid.'),
          h('li', {}, h('b', {}, term('coverage')), ' = reimbursed ÷ vet bills from visits while a policy was active.'),
          h('li', {}, h('b', {}, term('outOfPocket')), ' = vet bills − reimbursed + premiums. Compared with the vet bills alone (no insurance).'),
          h('li', {}, h('b', {}, term('breakEven')), ' = yearly premium ÷ reimbursement rate + deductible. Below that much eligible spending in a year, the premiums cost more than they return.'),
          h('li', {}, h('b', {}, 'Deductible met'), ' = “deductible applied” from your claims this policy year. If you leave that blank, the claimed amounts are used, up to the deductible.'),
          h('li', {}, h('b', {}, term('approvalRate')), ' = paid or partly paid claims ÷ claims that have been decided (paid or denied).'),
          h('li', {}, h('b', {}, term('unclaimed', 'Possibly unclaimed')), ' = visits in the last year while insured, with a cost and no claim linked, unless marked “not covered”.'))),
      sec('What-if planner',
        h('p', { text: 'The What if… button on the Insurance tab opens a sandbox for testing changes without touching your records. Scenarios are saved so you can come back to them.' }),
        h('ul', {},
          h('li', { text: 'Create as many scenarios as you like: start blank, use a quick idea, or duplicate one.' }),
          h('li', { text: 'Add changes: a claim outcome, a new vet bill, ongoing treatment, a premium change, or cancelling (or taking one pet off the plan). Each can start now, in a number of months, at the pet’s age, or on a date.' }),
          h('li', { text: 'Change the plan terms (premium, deductible, reimbursement rate, annual limit) to see how a different plan would have done with your real history.' }),
          h('li', { text: 'Compare results against your current plan, today or looking ahead 6 or 12 months or to the end of the policy year, and save the comparison as a PDF.' }))),
      sec('How the verdict works',
        h('p', { text: `Paying off: return of ${fmtNum(s.goodRatio, 2)} or more. Partly paying off: ${fmtNum(s.fairRatio, 2)} to ${fmtNum(s.goodRatio, 2)}. Costing more than it returns: below ${fmtNum(s.fairRatio, 2)}.` }),
        h('p', { class: 'pd-muted' }, 'A low return in a healthy year is normal: you are paying for protection against a large bill. The verdict therefore also shows what a sample emergency would cost with and without the policy. Change the thresholds and the example below.')),
      sec('Glossary', h('dl', { class: 'pd-glossary' }, ['premium', 'deductible', 'deductibleType', 'reimbursement', 'coinsurance', 'annualLimit', 'waitingPeriod', 'preExisting', 'exclusion', 'wellness', 'claim', 'eligible', 'eob', 'policyYear', 'renewal', 'returnRatio', 'netBenefit', 'breakEven', 'coverage', 'outOfPocket', 'pending', 'approvalRate', 'turnaround', 'unclaimed'].map((k) => [h('dt', { text: GLOSSARY[k][0] }), h('dd', { text: GLOSSARY[k][1] })]))));
    const set = h('div', { class: 'pd-help-settings' });
    contentEl.append(h('h4', { class: 'pd-subhead', text: 'Settings' }), set);
    insuranceSettings(set, this.plugin);
    contentEl.append(h('div', { class: 'pd-form-actions' }, h('span', { class: 'pd-spacer' }), btn('Done', () => this.close(), { cls: 'mod-cta' })));
  }
  onClose() { clear(this.contentEl); Tip.hide(); }
}

class ReportModal extends Modal {
  constructor(app, plugin, pet, kind) { super(app); this.plugin = plugin; this.pet = pet; this.kind = kind || 'health'; }
  onOpen() {
    const { contentEl } = this, data = this.plugin.data, s = data.settings, pet = this.pet;
    this.modalEl.addClass && this.modalEl.addClass('pd-modal');
    contentEl.append(h('h3', { class: 'pd-modal-title', text: 'Create PDF report' }));
    const row = (label, el) => h('div', { class: 'pd-form-row' }, h('label', { text: label }), el);
    const kind = h('select', {}, [['health', 'Health report'], ['insurance', 'Insurance summary'], ['full', 'Full report (summary + health + insurance)']].map(([v, t]) => h('option', { value: v, text: t })));
    kind.value = this.kind;
    const period = h('select', {}, [['6m', 'Last 6 months'], ['12m', 'Last 12 months'], ['ytd', 'Year to date'], ['policy', 'Since insurance began'], ['all', 'Everything recorded'], ['custom', 'Custom dates']].map(([v, t]) => h('option', { value: v, text: t })));
    period.value = this.kind === 'insurance' ? 'policy' : '6m';
    const from = h('input', { type: 'date', value: addMonths(todayISO(), -6) }), to = h('input', { type: 'date', value: todayISO() });
    const custom = h('div', { class: 'pd-form-row pd-wide pd-inline' }, h('label', { text: 'From / to' }), h('div', { class: 'pd-inline-inputs' }, from, to));
    const shared = sharedPolicies(data, pet);
    const scope = h('select', {}, shared.map((p) => h('option', { value: p.id, text: `Whole plan: ${policyLabel(p)}` })), h('option', { value: 'pet', text: `${petLabel(pet)}’s share only` }));
    const scopeRow = row('Insurance view', scope);
    const size = h('select', {}, ['Letter', 'A4'].map((v) => h('option', { value: v, text: v }))); size.value = s.pageSize;
    const sync = () => { custom.style.display = period.value === 'custom' ? '' : 'none'; scopeRow.style.display = shared.length && kind.value !== 'health' ? '' : 'none'; };
    period.addEventListener('change', sync); kind.addEventListener('change', sync);
    contentEl.append(h('div', { class: 'pd-form' }, row('Report', kind), row('Period', period), custom, scopeRow, row('Page size', size)));
    contentEl.append(h('p', { class: 'pd-muted pd-small', text: `Saved to “${s.pdfFolder}” in your vault (change it in the plugin settings).` }));
    sync();
    contentEl.append(h('div', { class: 'pd-form-actions' }, h('span', { class: 'pd-spacer' }), btn('Cancel', () => this.close()),
      btn('Create PDF', async () => {
        const t = todayISO(); let range;
        const ctx = defaultInsCtx(data, pet, shared.length ? scope.value : null);
        switch (period.value) {
          case '12m': range = { from: addDays(addMonths(t, -12), 1), to: t }; break;
          case 'ytd': range = { from: t.slice(0, 4) + '-01-01', to: t }; break;
          case 'policy': range = analysisRange(ctx, s, 'all'); break;
          case 'all': range = { from: allDates(data, pet)[0] || addMonths(t, -12), to: t }; break;
          case 'custom': range = { from: from.value || addMonths(t, -6), to: to.value || t }; break;
          default: range = { from: addDays(addMonths(t, -6), 1), to: t };
        }
        if (range.from > range.to) { new Notice('The start date is after the end date.'); return; }
        s.pageSize = size.value; await this.plugin.saveData(data);
        this.close();
        await createReport(this.plugin, pet, kind.value, range, ctx);
      }, { cls: 'mod-cta', icon: 'file-down' })));
  }
  onClose() { clear(this.contentEl); }
}
function allDates(data, pet) {
  const d = [];
  pet.visits.forEach((v) => d.push(v.date)); pet.meds.forEach((m) => d.push(m.start)); pet.vaccines.forEach((v) => d.push(v.dateGiven));
  pet.weights.forEach((w) => d.push(w.date)); pet.observations.forEach((o) => d.push(o.date));
  data.policies.filter((p) => p.petIds.includes(pet.id)).forEach((p) => d.push(p.start));
  return d.filter((x) => x && x <= todayISO()).sort();
}

/* ---------------- pet photo: choose, frame (pan + zoom), save ---------------- */
class PhotoModal extends Modal {
  constructor(app, plugin, pet, opts = {}) { super(app); this.plugin = plugin; this.pet = pet; this.opts = opts; this.img = null; this.zoom = 1; this.ox = 0; this.oy = 0; }
  onOpen() {
    const { contentEl, pet, plugin } = this, V = 260;
    this.modalEl.addClass && this.modalEl.addClass('pd-modal', 'pd-photo-modal');
    contentEl.append(h('h3', { class: 'pd-modal-title', text: this.opts.afterAdd ? `Add a photo of ${petLabel(pet)}?` : `Photo of ${petLabel(pet)}` }));
    contentEl.append(h('p', { class: 'pd-muted', text: 'A head shot works best: face toward the camera, filling most of the frame, in good light. After choosing, drag to position and use the slider to zoom. It is shown in a circle.' }));
    const canvas = h('canvas', { width: V * 2, height: V * 2, class: 'pd-crop-canvas', style: { width: V + 'px', height: V + 'px' }, 'aria-label': 'Photo framing preview' });
    this.canvas = canvas; this.V = V;
    const cur = plugin.photoSrc(pet);
    const empty = h('div', { class: 'pd-crop-empty' }, icon('camera'), h('span', { text: cur ? '' : 'No photo yet' }));
    const stage = h('div', { class: 'pd-crop-stage', style: { width: V + 'px', height: V + 'px' } }, canvas, empty);
    const zoom = h('input', { type: 'range', min: '1', max: '4', step: '0.01', value: '1', 'aria-label': 'Zoom', disabled: true });
    zoom.addEventListener('input', () => { const z = num(zoom.value); const k = z / this.zoom; this.ox *= k; this.oy *= k; this.zoom = z; this.clamp(); this.draw(); });
    const file = h('input', { type: 'file', accept: 'image/png,image/jpeg,image/webp,image/gif,image/heic', style: { display: 'none' } });
    file.addEventListener('change', () => { const f = file.files && file.files[0]; if (f) this.load(f, zoom, empty, save); });
    const choose = btn(cur ? 'Choose a different photo' : 'Choose photo…', () => file.click(), { icon: 'image', cls: 'mod-cta' });
    const save = btn('Save photo', async () => {
      const blob = await this.exportBlob(); if (!blob) return;
      this.close(); await plugin.savePhoto(pet, blob); new Notice('Photo saved.');
    }, { cls: 'mod-cta' });
    save.disabled = true;
    // drag to pan
    let drag = null;
    canvas.addEventListener('pointerdown', (e) => { if (!this.img) return; drag = { x: e.clientX, y: e.clientY, ox: this.ox, oy: this.oy }; canvas.setPointerCapture && canvas.setPointerCapture(e.pointerId); });
    canvas.addEventListener('pointermove', (e) => { if (!drag) return; this.ox = drag.ox + (e.clientX - drag.x); this.oy = drag.oy + (e.clientY - drag.y); this.clamp(); this.draw(); });
    const end = () => { drag = null; }; canvas.addEventListener('pointerup', end); canvas.addEventListener('pointercancel', end);
    canvas.addEventListener('wheel', (e) => { if (!this.img) return; e.preventDefault(); zoom.value = String(Math.min(4, Math.max(1, this.zoom - e.deltaY * 0.002))); zoom.dispatchEvent(new Event('input')); }, { passive: false });
    // drop a file onto the frame
    stage.addEventListener('dragover', (e) => { e.preventDefault(); stage.classList.add('is-drop'); });
    stage.addEventListener('dragleave', () => stage.classList.remove('is-drop'));
    stage.addEventListener('drop', (e) => { e.preventDefault(); stage.classList.remove('is-drop'); const f = e.dataTransfer.files && e.dataTransfer.files[0]; if (f && /^image\//.test(f.type)) this.load(f, zoom, empty, save); });
    contentEl.append(h('div', { class: 'pd-crop' }, stage, h('div', { class: 'pd-crop-side' }, choose, file,
      h('label', { class: 'pd-zoom' }, h('span', { class: 'pd-muted pd-small', text: 'Zoom' }), zoom),
      h('div', { class: 'pd-small pd-muted', text: 'You can also drop an image onto the frame.' }),
      h('div', { class: 'pd-small pd-muted', text: `Saved in your vault under “${plugin.data.settings.photoFolder}”.` }))));
    const actions = h('div', { class: 'pd-form-actions' });
    if (cur) actions.append(btn('Remove photo', () => { this.close(); confirmBox(this.app, `Remove ${petLabel(pet)}’s photo? The image file is moved to the trash.`, async () => { await plugin.removePhotoFile(pet); pet.photo = ''; await plugin.saveAll(); }, 'Remove'); }, { cls: 'mod-warning', icon: 'trash-2' }));
    actions.append(h('span', { class: 'pd-spacer' }), btn(this.opts.afterAdd ? 'Skip' : 'Cancel', () => this.close()), save);
    contentEl.append(actions);
    if (cur) { const im = new Image(); im.onload = () => { this.img = im; this.zoom = 1; this.ox = this.oy = 0; empty.style.display = 'none'; this.draw(); }; im.src = cur; }
  }
  load(f, zoom, empty, save) {
    const url = URL.createObjectURL(f), im = new Image();
    im.onload = () => { this.img = im; this.fresh = true; this.zoom = 1; this.ox = 0; this.oy = 0; zoom.value = '1'; zoom.disabled = false; empty.style.display = 'none'; save.disabled = false; this.draw(); };
    im.onerror = () => new Notice('That image could not be opened. Try a JPG or PNG.');
    im.src = url;
  }
  base() { const im = this.img; return Math.max(this.V / im.naturalWidth, this.V / im.naturalHeight) * this.zoom; }
  clamp() {
    const s = this.base(), w = this.img.naturalWidth * s, hh = this.img.naturalHeight * s;
    const mx = Math.max(0, (w - this.V) / 2), my = Math.max(0, (hh - this.V) / 2);
    this.ox = Math.min(mx, Math.max(-mx, this.ox)); this.oy = Math.min(my, Math.max(-my, this.oy));
  }
  paint(ctx, size) {
    const k = size / this.V, s = this.base() * k, im = this.img;
    const w = im.naturalWidth * s, hh = im.naturalHeight * s;
    ctx.clearRect(0, 0, size, size);
    ctx.drawImage(im, size / 2 - w / 2 + this.ox * k, size / 2 - hh / 2 + this.oy * k, w, hh);
  }
  draw() {
    const c = this.canvas, ctx = c.getContext('2d'), S = c.width;
    this.paint(ctx, S);
    // dim outside the circle
    ctx.save(); ctx.fillStyle = 'rgba(0,0,0,0.45)'; ctx.beginPath(); ctx.rect(0, 0, S, S); ctx.arc(S / 2, S / 2, S / 2 - 2, 0, Math.PI * 2, true); ctx.fill('evenodd');
    ctx.strokeStyle = 'rgba(255,255,255,0.9)'; ctx.lineWidth = 3; ctx.beginPath(); ctx.arc(S / 2, S / 2, S / 2 - 2, 0, Math.PI * 2); ctx.stroke(); ctx.restore();
  }
  exportBlob() {
    if (!this.img) return Promise.resolve(null);
    const out = document.createElement('canvas'); out.width = out.height = 600;
    const ctx = out.getContext('2d'); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, 600, 600); this.paint(ctx, 600);
    return new Promise((res) => out.toBlob((b) => res(b), 'image/jpeg', 0.88));
  }
  onClose() { clear(this.contentEl); }
}

/* ---------------- archive a pet ---------------- */
class ArchiveModal extends Modal {
  constructor(app, plugin, pet) { super(app); this.plugin = plugin; this.pet = pet; }
  onOpen() {
    const { contentEl, pet, plugin } = this, data = plugin.data, s = data.settings, D = (d) => fmtDate(d, s.dateFormat);
    this.modalEl.addClass && this.modalEl.addClass('pd-modal');
    contentEl.append(h('h3', { class: 'pd-modal-title', text: `Archive ${petLabel(pet)}` }));
    contentEl.append(h('p', { class: 'pd-muted', text: `${petLabel(pet)}’s records stay exactly as they are and can still be viewed, edited and printed. Reminders (vaccines, refills, appointments) stop. You can restore the pet at any time.` }));
    const row = (label, el, help) => h('div', { class: 'pd-form-row' }, h('label', { text: label }), el, help ? h('div', { class: 'pd-help', text: help }) : null);
    const reason = h('select', {}, [['passed', 'Crossed rainbow bridge'], ['rehomed', 'Rehomed'], ['lost', 'Lost'], ['other', 'Other']].map(([v, t]) => h('option', { value: v, text: t })));
    const date = h('input', { type: 'date', value: todayISO() });
    const note = h('textarea', { rows: 3, placeholder: 'A few words to remember them by (optional)' });
    const form = h('div', { class: 'pd-form' }, row('Reason', reason), row('Date', date), h('div', { class: 'pd-form-row pd-wide' }, h('label', { text: 'Note' }), note));
    contentEl.append(form);
    // insurance
    const t = todayISO();
    const pols = data.policies.filter((p) => p.petIds.includes(pet.id) && (!p.end || p.end >= t) && (!petLeave(p, pet.id) || petLeave(p, pet.id) >= t));
    const checks = [];
    if (pols.length) {
      const box = h('div', { class: 'pd-archive-ins' }, h('div', { class: 'pd-form-heading', text: 'Insurance' }));
      pols.forEach((p) => {
        const others = petsOnPolicy(data, p).filter((x) => x.id !== pet.id && !isArchived(x));
        const cb = h('input', { type: 'checkbox' }); cb.checked = true;
        const what = others.length ? `Remove ${petLabel(pet)} from ${policyLabel(p)} on this date. It continues for ${others.map(petLabel).join(', ')}; ${petLabel(pet)}’s past claims and premium share stay in the figures.`
          : `End ${policyLabel(p)} on this date (${petLabel(pet)} is the only pet on it). Past premiums and claims stay in the figures.`;
        checks.push({ cb, p, shared: others.length > 0 });
        box.append(h('label', { class: 'pd-check-item pd-archive-check' }, cb, h('span', { text: what })));
      });
      box.append(h('div', { class: 'pd-help', text: 'Remember to tell the insurer as well. If the premium changes for the remaining pets, record it with “Rate change” (reason: pet removed).' }));
      contentEl.append(box);
    }
    const open = data.claims.filter((c) => c.petId === pet.id && (PENDING.includes(c.status) || c.status === 'draft'));
    if (open.length) contentEl.append(h('p', { class: 'pd-small' }, h('strong', { text: `${plural(open.length, 'claim')} still open: ` }), open.map((c) => `${D(c.serviceDate)} ${c.condition || ''} (${CLAIM_STATUS[c.status]})`).join('; '), '. They stay on the Insurance tab until you record the outcome.'));
    const future = pet.visits.filter((v) => v.date > t);
    if (future.length) contentEl.append(h('p', { class: 'pd-small pd-muted', text: `${plural(future.length, 'upcoming appointment')} will no longer be shown as reminders. Remember to cancel ${future.length === 1 ? 'it' : 'them'} with the clinic.` }));
    contentEl.append(h('div', { class: 'pd-form-actions' }, h('span', { class: 'pd-spacer' }), btn('Cancel', () => this.close()),
      btn('Archive', async () => {
        const d = date.value || t;
        pet.archived = true; pet.archivedDate = d; pet.archiveReason = reason.value; pet.archiveNote = note.value.trim();
        checks.filter((c) => c.cb.checked).forEach(({ p, shared }) => {
          if (shared) { p.petEnd = Object.assign({}, p.petEnd || {}); p.petEnd[pet.id] = d; }
          else p.end = d;
        });
        // end ongoing medications on the archive date so they no longer show as current
        pet.meds.forEach((m) => { if (!m.end || m.end > d) { m.end = d; m.whyStopped = m.whyStopped || archiveVerb(pet); } });
        if (reason.value === 'passed' && pet.archiveNote) pet.notes.push({ id: uid(), date: d, title: 'In memory', text: pet.archiveNote });
        this.close();
        const next = data.pets.find((p) => !isArchived(p));
        await plugin.saveAll();
        new Notice(`${petLabel(pet)} archived.`);
      }, { cls: 'mod-cta', icon: 'archive' })));
  }
  onClose() { clear(this.contentEl); }
}

/* ---------------- delete a pet ---------------- */
class DeletePetModal extends Modal {
  constructor(app, plugin, pet) { super(app); this.plugin = plugin; this.pet = pet; }
  onOpen() {
    const { contentEl, pet, plugin } = this, data = plugin.data, plan = deletePlan(data, pet), name = petLabel(pet);
    this.modalEl.addClass && this.modalEl.addClass('pd-modal', 'pd-delete-modal', 'pd-root');
    contentEl.append(h('h3', { class: 'pd-modal-title' }, `Delete ${name}?`));
    contentEl.append(h('p', {}, `This permanently removes ${name} and everything recorded for them. It can’t be undone.`));
    const c = plan.counts, list = [];
    const add = (n, w) => { if (n) list.push(plural(n, w)); };
    add(c.visits, 'vet visit'); add(c.meds, 'medication'); add(c.vaccines, 'vaccination'); add(c.weights, 'weight'); add(c.observations, 'observation'); add(c.notes, 'note'); add(plan.claims.length, 'insurance claim');
    const items = [h('li', { text: list.length ? `Health and insurance records: ${list.join(', ')}.` : 'The profile (no records yet).' })];
    if (pet.photo) items.push(h('li', { text: 'The photo (moved to your vault’s trash).' }));
    if (plan.own.length) items.push(h('li', { text: `${plural(plan.own.length, 'policy', 'policies')} that only covered ${name}: ${plan.own.map(policyLabel).join(', ')}, with its premium history.` }));
    if (plan.shared.length) items.push(h('li', { text: `${name} is taken off ${plan.shared.map(policyLabel).join(', ')}. The plan stays for ${plan.shared.flatMap((p) => petsOnPolicy(data, p)).filter((p) => p.id !== pet.id).map(petLabel).filter((v, i, a) => a.indexOf(v) === i).join(', ')}, but ${name}’s past share of premiums and claims will no longer count in its figures.` }));
    if (plan.scenarios.length) items.push(h('li', { text: `Changes about ${name} in ${plural(plan.scenarios.length, 'What-if scenario')}.` }));
    if (data.pets.length === 1) items.push(h('li', { text: `${name} is your only pet, so the dashboard starts again with a blank profile.` }));
    contentEl.append(h('ul', { class: 'pd-bullets' }, items));
    if (!isArchived(pet)) contentEl.append(h('div', { class: 'pd-delete-alt' }, icon('archive'), h('div', {},
      h('strong', { text: 'Want to keep the history? ' }), `Archive ${name} instead. Records stay viewable and printable, reminders stop, and shared plans keep their figures.`),
      btn('Archive instead', () => { this.close(); new ArchiveModal(this.app, plugin, pet).open(); }, { icon: 'archive' })));
    const input = h('input', { type: 'text', id: 'pd-delete-confirm', autocomplete: 'off', placeholder: name, 'aria-label': `Type ${name} to confirm` });
    contentEl.append(h('div', { class: 'pd-form-row pd-delete-confirm' }, h('label', { for: 'pd-delete-confirm' }, 'Type ', h('strong', { text: name }), ' to confirm'), input));
    const del = btn(`Delete ${name}`, async () => {
      if (input.value.trim().toLowerCase() !== name.trim().toLowerCase()) return;
      this.close();
      await plugin.removePhotoFile(pet);
      deletePetData(data, pet);
      await plugin.saveAll();
      new Notice(`${name} deleted.`);
    }, { cls: 'mod-warning', icon: 'trash-2' });
    del.disabled = true;
    input.addEventListener('input', () => { del.disabled = input.value.trim().toLowerCase() !== name.trim().toLowerCase(); });
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !del.disabled) del.click(); });
    contentEl.append(h('div', { class: 'pd-form-actions' }, h('span', { class: 'pd-spacer' }), btn('Cancel', () => this.close()), del));
    setTimeout(() => input.focus(), 30);
  }
  onClose() { clear(this.contentEl); }
}
/* ---------------- What-if planner (sandbox, modelled on the Finance Dashboard planner) ----------------
   Scenarios are saved in data.whatIf. Each scenario = plan-term overrides + a list of changes.
   Every simulation runs on a copy of the data, so nothing in the dashboard is touched. */
const SC_COLORS = ['#F58518', '#4C78A8', '#B279A2', '#E45756', '#72B7B2', '#9D755D', '#EECA3B', '#FF9DA6'];
const BASE_COLOR = '#54A24B';
const WI_EVENTS = {
  claim: { label: 'Claim outcome', icon: 'receipt', hint: 'A claim is paid, paid a set amount, or denied' },
  bill: { label: 'New vet bill', icon: 'stethoscope', hint: 'An illness, injury or emergency' },
  recurring: { label: 'Ongoing treatment', icon: 'repeat', hint: 'A monthly cost such as medication or therapy' },
  premium: { label: 'Premium change', icon: 'trending-up', hint: 'A price rise or discount from a date' },
  cancel: { label: 'Cancel or remove a pet', icon: 'circle-slash', hint: 'Stop the policy, or take one pet off it' },
};
const WI_TERMS = ['premium', 'deductible', 'reimbursement', 'annualLimit'];
const WI_TERM_LABELS = { premium: 'Premium (whole policy)', deductible: 'Deductible', reimbursement: 'Reimbursement rate', annualLimit: 'Annual limit' };
const WHEN_LABELS = { now: 'Now', months: 'In … months', age: 'At the pet’s age …', date: 'On a date', never: 'Until the end of the period', count: 'For … months' };
const WI_HORIZONS = [['today', 'Today'], ['6m', 'In 6 months'], ['12m', 'In 12 months'], ['renewal', 'End of this policy year']];

function cloneData(d) { return normalizeData(JSON.parse(JSON.stringify(d))); }
function wiStore(data) { if (!data.whatIf || !Array.isArray(data.whatIf.scenarios)) data.whatIf = { scenarios: [], selected: 'base', horizon: '12m' }; return data.whatIf; }

/* "when" specs: { mode: now | months | age | date | never | count, value, date } */
function whenDate(spec, pet, from) {
  const t = from || todayISO();
  if (!spec || spec.mode === 'now') return t;
  if (spec.mode === 'months') return addMonths(t, Math.max(0, Math.round(num(spec.value))));
  if (spec.mode === 'date') return spec.date || t;
  if (spec.mode === 'age') { const b = pet && birthInfo(pet); if (b) { const d = addMonths(b.dob, Math.round(num(spec.value) * 12)); return d < t ? t : d; } }
  return t;
}
function whenText(spec, pet, D) {
  if (!spec || spec.mode === 'now') return 'now';
  if (spec.mode === 'months') return `in ${plural(num(spec.value), 'month')} (${D(whenDate(spec, pet))})`;
  if (spec.mode === 'age') return `when ${petLabel(pet)} is ${fmtNum(num(spec.value))} (${D(whenDate(spec, pet))})`;
  return `on ${D(spec.date)}`;
}
function wiHorizonDate(data, pet, insScope, h) {
  const t = todayISO();
  if (h === '6m') return addMonths(t, 6);
  if (h === '12m') return addMonths(t, 12);
  if (h === 'renewal') { const p = currentPolicy(defaultInsCtx(data, pet, insScope)), r = p && nextRenewal(p); return r ? addDays(r, -1) : addMonths(t, 12); }
  return t;
}

function payoutFor(data, policy, claim) {
  const saved = claim.status; claim.status = 'draft';
  const ds = deductibleStatus(data, policy, claim.serviceDate, claim.petId);
  claim.status = saved;
  const elig = num(hasVal(claim.eligibleAmount) ? claim.eligibleAmount : claim.amountClaimed);
  return { pay: Math.round(Math.min(Math.max(0, elig - ds.remaining) * num(policy.reimbursement) / 100, ds.limitRemaining) * 100) / 100, dedUsed: Math.min(elig, ds.remaining) };
}
function readjudicate(data, policy) {
  const dedLeft = {}, limLeft = {}, rate = num(policy.reimbursement) / 100;
  data.claims.filter((c) => c.policyId === policy.id && c.status !== 'denied' && c.status !== 'draft').sort(byDate('serviceDate')).forEach((c) => {
    const ys = policyYearStart(policy, c.serviceDate);
    const kd = ys + '|' + (policy.deductibleScope === 'shared' ? '*' : c.petId), kl = ys + '|' + (policy.limitScope === 'shared' ? '*' : c.petId);
    if (dedLeft[kd] == null) dedLeft[kd] = num(policy.deductible);
    if (limLeft[kl] == null) limLeft[kl] = num(policy.annualLimit) || Infinity;
    const elig = num(hasVal(c.eligibleAmount) ? c.eligibleAmount : c.amountClaimed), d = Math.min(elig, dedLeft[kd]);
    dedLeft[kd] -= d; const pay = Math.min((elig - d) * rate, limLeft[kl]); limLeft[kl] -= pay;
    c.deductibleApplied = d;
    if (PAID.includes(c.status)) c.reimbursed = Math.round(pay * 100) / 100;
  });
}
/* the terms the scenario starts from: today's premium and the policy's current terms */
function wiBaseTerms(ctx, pol) {
  return pol ? { premium: rateAt(ctx, pol, todayISO()), deductible: num(pol.deductible), reimbursement: num(pol.reimbursement), annualLimit: num(pol.annualLimit) } : {};
}
function wiEffectiveTerms(ctx, pol, sc) { const b = wiBaseTerms(ctx, pol), o = (sc && sc.terms) || {}; const e = Object.assign({}, b); WI_TERMS.forEach((k) => { if (hasVal(o[k])) e[k] = num(o[k]); }); return e; }

/* run one scenario (or the current plan when sc is null) */
function wiSimulate(data0, petId, insScope, sc, horizon) {
  const s = data0.settings, data = cloneData(data0), prev = TODAY_OVERRIDE;
  const pet = data.pets.find((p) => p.id === petId) || data.pets[0];
  const petById = (id) => data.pets.find((p) => p.id === id) || pet;
  try {
    const ctx0 = defaultInsCtx(data, pet, insScope), pol0 = currentPolicy(ctx0);
    const pol = pol0 && data.policies.find((x) => x.id === pol0.id);
    const terms = wiEffectiveTerms(ctx0, pol0, sc); // before any change is applied
    if (sc && pol) {
      // 1. plan terms (applied to the whole history, so it reads as "if we'd had this plan")
      const o = sc.terms || {}, b = wiBaseTerms(ctx0, pol);
      if (hasVal(o.premium) && b.premium > 0) {
        const f = num(o.premium) / b.premium; pol.premium = num(pol.premium) * f;
        data.premiumChanges.forEach((c) => { if (c.policyId === pol.id) c.amount = num(c.amount) * f; });
      }
      let terms = false;
      if (hasVal(o.deductible)) { pol.deductible = num(o.deductible); terms = true; }
      if (hasVal(o.reimbursement)) { pol.reimbursement = num(o.reimbursement); terms = true; }
      if (hasVal(o.annualLimit)) { pol.annualLimit = num(o.annualLimit); terms = true; }
      if (terms) readjudicate(data, pol);
      // 2. changes, in a fixed order so a bill after a cancellation is not covered
      const evs = sc.events || [], bills = [];
      evs.filter((e) => e.type === 'premium').forEach((e) => {
        const d = whenDate(e.start, pet), cur = rateAt(ctx0, pol, d);
        const amount = e.mode === 'pct' ? Math.round(cur * (1 + num(e.value) / 100) * 100) / 100 : num(e.value);
        data.premiumChanges.push({ id: uid(), policyId: pol.id, date: d, amount, reason: 'What-if' });
      });
      evs.filter((e) => e.type === 'cancel').forEach((e) => {
        const target = e.who && e.who !== 'policy' ? petById(e.who) : null, d = whenDate(e.start, target || pet);
        if (target) { pol.petEnd = Object.assign({}, pol.petEnd || {}); pol.petEnd[target.id] = d; } else pol.end = d;
      });
      evs.filter((e) => e.type === 'claim').forEach((e) => {
        const ids = e.claimId === '*open*' ? ctx0.claims.filter((c) => PENDING.includes(c.status) || c.status === 'draft').map((c) => c.id) : [e.claimId];
        ids.forEach((id) => {
          const c = data.claims.find((x) => x.id === id), p = c && data.policies.find((x) => x.id === c.policyId); if (!c || !p) return;
          if (e.outcome === 'denied') { c.status = 'denied'; c.reimbursed = 0; c.deductibleApplied = ''; return; }
          c.status = 'review'; c.deductibleApplied = ''; c.reimbursed = '';
          const est = payoutFor(data, p, c);
          c.status = 'approved'; c.reimbursed = e.outcome === 'custom' && hasVal(e.amount) ? num(e.amount) : est.pay; c.deductibleApplied = est.dedUsed;
          c.paidDate = c.paidDate || addDays(c.submittedDate || c.serviceDate, 14);
        });
      });
      evs.filter((e) => e.type === 'bill').forEach((e) => { const pt = petById(e.petId); bills.push({ pet: pt, date: whenDate(e.start, pt), amount: num(e.amount), label: e.label || 'Vet bill', covered: e.covered !== false }); });
      evs.filter((e) => e.type === 'recurring').forEach((e) => {
        const pt = petById(e.petId), start = whenDate(e.start, pt);
        const end = e.end && e.end.mode === 'count' ? addDays(addMonths(start, Math.max(1, Math.round(num(e.end.value)))), -1) : e.end && e.end.mode === 'date' ? e.end.date : horizon;
        for (let i = 0, d = start; d <= end && d <= horizon && i < 240; i++, d = addMonths(start, i)) bills.push({ pet: pt, date: d, amount: num(e.amount), label: e.label || 'Ongoing treatment', covered: e.covered !== false });
      });
      bills.sort(byDate('date')).forEach((bl) => {
        if (!bl.amount) return;
        const v = { id: uid(), date: bl.date, type: 'Sick visit', reason: bl.label, cost: bl.amount, notClaimable: !bl.covered };
        bl.pet.visits.push(v);
        const p = bl.covered && data.policies.find((x) => petOnPolicyAt(x, bl.pet.id, bl.date));
        if (p) {
          const c = { id: uid(), petId: bl.pet.id, visitId: v.id, policyId: p.id, serviceDate: bl.date, amountClaimed: bl.amount, condition: bl.label, status: 'review', submittedDate: bl.date };
          data.claims.push(c);
          const est = payoutFor(data, p, c); c.status = 'approved'; c.reimbursed = est.pay; c.deductibleApplied = est.dedUsed; c.paidDate = addDays(bl.date, 14);
        }
      });
    }
    TODAY_OVERRIDE = horizon;
    const ctx = defaultInsCtx(data, pet, insScope);
    const range = analysisRange(ctx, s); range.to = horizon; if (range.from > horizon) range.from = horizon;
    const st = insuranceStats(ctx, s, range);
    // monthly series of every bill (not only insured ones) for the total-cost line
    let cb = 0;
    const series = st.series.map((r) => {
      const bills = sum(ctx.visits.filter((v) => v.date && v.date <= horizon && v.date >= range.from && monthKey(v.date) === r.month), 'cost');
      cb += bills;
      return { month: r.month, premiums: r.premiums, reimbursed: r.reimbursed, bills, net: r.cumReimbursed - r.cumPremiums, cost: cb + r.cumPremiums - r.cumReimbursed };
    });
    const total = st.vetCostsAll + st.premiums - st.benefit;
    return { st, series, total, terms, pol: pol0, ctx: ctx0 };
  } finally { TODAY_OVERRIDE = prev; }
}

function wiPresets(data, pet, insScope, M) {
  const ctx = defaultInsCtx(data, pet, insScope), pol = currentPolicy(ctx);
  if (!pol) return [];
  const open = ctx.claims.filter((c) => PENDING.includes(c.status) || c.status === 'draft').length, s = data.settings;
  const r = nextRenewal(pol), ded = num(pol.deductible), out = [];
  if (open) out.push({ label: `Open claims are paid (${open})`, sc: { name: 'Open claims paid', events: [{ type: 'claim', claimId: '*open*', outcome: 'approved' }] } });
  if (open) out.push({ label: 'Open claims are denied', sc: { name: 'Open claims denied', events: [{ type: 'claim', claimId: '*open*', outcome: 'denied' }] } });
  out.push({ label: `${M(num(s.emergencyExample), true)} emergency next month`, sc: { name: 'Emergency next month', events: [{ type: 'bill', petId: pet.id, label: 'Emergency', amount: num(s.emergencyExample), start: { mode: 'months', value: 1 }, covered: true }] } });
  out.push({ label: `Ongoing meds ${M(80, true)}/mo for a year`, sc: { name: 'Ongoing medication', events: [{ type: 'recurring', petId: pet.id, label: 'Ongoing medication', amount: 80, start: { mode: 'now' }, end: { mode: 'count', value: 12 }, covered: true }] } });
  out.push({ label: 'Premium +15% at renewal', sc: { name: 'Premium +15% at renewal', events: [{ type: 'premium', mode: 'pct', value: 15, start: r ? { mode: 'date', date: r } : { mode: 'months', value: 1 } }] } });
  if (activeOn(pol, todayISO())) out.push({ label: 'Cancel today', sc: { name: 'Cancel today', events: [{ type: 'cancel', who: ctx.kind === 'pet' && petsOnPolicy(data, pol).length > 1 ? pet.id : 'policy', start: { mode: 'now' } }] } });
  if (num(pol.reimbursement) < 90) out.push({ label: '90% reimbursement plan', sc: { name: '90% reimbursement', terms: { reimbursement: 90 } } });
  out.push({ label: `Higher deductible (${M(Math.max(500, ded * 2), true)})`, sc: { name: 'Higher deductible', terms: { deductible: Math.max(500, ded * 2) } } });
  return out;
}

function wiDescribe(e, data, pet, ctx, M0, D) {
  const M = (n) => M0(n, Math.round(num(n) * 100) % 100 === 0);
  const pt = data.pets.find((p) => p.id === e.petId) || pet;
  if (e.type === 'claim') {
    const c = data.claims.find((x) => x.id === e.claimId);
    const what = e.claimId === '*open*' ? 'All open claims' : c ? `${D(c.serviceDate)} ${c.condition || 'claim'} (${M(num(c.amountClaimed))})` : 'A claim that no longer exists';
    return `${what} ${e.claimId === '*open*' ? 'are' : 'is'} ${e.outcome === 'denied' ? 'denied' : e.outcome === 'custom' ? `paid ${M(num(e.amount))}` : 'paid (estimated from the policy terms)'}.`;
  }
  if (e.type === 'bill') return `${M(num(e.amount))} ${(e.label || 'vet bill').toLowerCase()} for ${petLabel(pt)} ${whenText(e.start, pt, D)}${e.covered === false ? ' · not covered' : ''}.`;
  if (e.type === 'recurring') {
    const end = e.end && e.end.mode === 'count' ? ` for ${plural(num(e.end.value), 'month')}` : e.end && e.end.mode === 'date' ? ` until ${D(e.end.date)}` : '';
    return `${M(num(e.amount))}/month ${(e.label || 'ongoing treatment').toLowerCase()} for ${petLabel(pt)} from ${whenText(e.start, pt, D).replace(/^on /, '')}${end}${e.covered === false ? ' · not covered' : ''}.`;
  }
  if (e.type === 'premium') return e.mode === 'pct' ? `Premium ${num(e.value) >= 0 ? '+' : ''}${fmtNum(num(e.value))}% ${whenText(e.start, pet, D)}.` : `Premium becomes ${M(num(e.value))} ${whenText(e.start, pet, D)}.`;
  if (e.type === 'cancel') { const who = e.who && e.who !== 'policy' ? data.pets.find((p) => p.id === e.who) : null; return who ? `${petLabel(who)} is removed from the plan ${whenText(e.start, who, D)}.` : `The policy is cancelled ${whenText(e.start, pet, D)}.`; }
  return '';
}

function wiFieldsWhen(p, label, modes) {
  return [
    { key: p + 'Mode', label, type: 'select', options: modes.map((m) => [m, WHEN_LABELS[m]]), onChange: (v, f) => wiToggleWhen(f, p) },
    { key: p + 'Value', label: 'How many', type: 'number', min: '0', step: 'any' },
    { key: p + 'Date', label: 'Date', type: 'date' },
  ];
}
function wiToggleWhen(f, p) {
  const m = f.vals[p + 'Mode'];
  f.showRow(p + 'Value', ['months', 'age', 'count'].includes(m)); f.showRow(p + 'Date', m === 'date');
  f.setLabel(p + 'Value', m === 'age' ? 'Pet’s age (years)' : m === 'count' ? 'Number of months' : 'Months from now');
}
function wiWhenVals(p, spec, def) { spec = spec && spec.mode ? spec : def; return { [p + 'Mode']: spec.mode, [p + 'Value']: hasVal(spec.value) ? spec.value : '', [p + 'Date']: spec.date || todayISO() }; }
function wiWhenRead(p, v) {
  const mode = v[p + 'Mode'];
  if (['months', 'age', 'count'].includes(mode)) return { mode, value: num(v[p + 'Value']) };
  if (mode === 'date') return { mode, date: v[p + 'Date'] };
  return { mode };
}

class WhatIfModal extends Modal {
  /* never use this.scope: Obsidian's Modal owns it */
  constructor(app, plugin, pet, insScope) { super(app); this.plugin = plugin; this.pet = pet; this.insScope = insScope; }
  get data() { return this.plugin.data; }
  get store() { return wiStore(this.data); }
  get s() { return this.data.settings; }
  M(n, w) { return fmtMoney(n, this.s.currency, w); }
  D(d) { return fmtDate(d, this.s.dateFormat); }
  async persist() { await this.plugin.saveAll(); this.render(); }
  current() { return this.store.scenarios.find((x) => x.id === this.store.selected) || null; }
  nextColor() { const used = new Set(this.store.scenarios.map((x) => x.color)); return SC_COLORS.find((c) => !used.has(c)) || SC_COLORS[this.store.scenarios.length % SC_COLORS.length]; }
  addScenario(preset, save = true) {
    const p = preset ? JSON.parse(JSON.stringify(preset)) : {};
    const sc = Object.assign({ name: `Scenario ${this.store.scenarios.length + 1}`, visible: true, terms: {}, events: [], notes: '' }, p, { id: uid(), color: this.nextColor(), created: todayISO() });
    sc.events = (sc.events || []).map((e) => Object.assign({}, e, { id: uid() }));
    this.store.scenarios.push(sc); this.store.selected = sc.id;
    if (save) this.persist();
    return sc;
  }
  duplicate(sc) { const c = JSON.parse(JSON.stringify(sc)); delete c.id; delete c.color; c.name = `${sc.name} (copy)`; this.addScenario(c); }
  remove(sc) {
    confirmBox(this.app, `Delete “${sc.name}”? Your dashboard is not affected.`, async () => {
      this.store.scenarios = this.store.scenarios.filter((x) => x.id !== sc.id); this.store.selected = 'base'; await this.persist();
    }, 'Delete');
  }
  onOpen() {
    this.modalEl.addClass && this.modalEl.addClass('pd-modal', 'pd-whatif-modal', 'pd-root');
    if (this.titleEl && this.titleEl.setText) this.titleEl.setText('What-if planner');
    else this.modalEl.insertBefore(h('div', { class: 'modal-title', text: 'What-if planner' }), this.contentEl);
    this.render();
  }
  onClose() { Tip.hide(); clear(this.contentEl); }

  render() {
    const oldMain = this.contentEl.querySelector('.pd-wi-main'), scroll = oldMain ? oldMain.scrollTop : 0;
    Tip.hide(); clear(this.contentEl);
    const c = this.contentEl; c.classList.add('pd-wi-content');
    const data = this.data, st = this.store;
    if (!WI_HORIZONS.some((x) => x[0] === st.horizon)) st.horizon = '12m';
    this.hz = wiHorizonDate(data, this.pet, this.insScope, st.horizon);
    this.base = wiSimulate(data, this.pet.id, this.insScope, null, this.hz);
    this.sims = new Map(st.scenarios.map((x) => [x.id, wiSimulate(data, this.pet.id, this.insScope, x, this.hz)]));
    if (st.selected !== 'base' && !this.current()) st.selected = 'base';

    // 1. estimate disclaimer, first row
    c.append(h('div', { class: 'pd-wi-predict', role: 'note' }, icon('alert-triangle'), h('div', {}, h('strong', { text: 'Estimate, not a guarantee. ' }),
      'Results use your policy terms as recorded and simple claim maths (deductible, then the reimbursement rate, up to the limit). Your insurer makes the real decisions. Not financial advice.')));
    // 2. what is being evaluated, right under the disclaimer
    if (this.base.pol) c.append(this.viewBar());
    // 3. sandbox note + figures as of, PDF, help
    const top = h('div', { class: 'pd-wi-top' });
    top.append(h('div', { class: 'pd-wi-sandbox' }, h('span', { class: 'pd-wi-sandbox-icon' }, icon('flask-conical')),
      h('span', { text: 'Sandbox — nothing here changes your pets’ records or insurance. Scenarios are saved so you can come back to them.' })));
    const acts = h('div', { class: 'pd-wi-top-actions' });
    const hz = h('select', { class: 'dropdown', 'aria-label': 'Figures as of' }, WI_HORIZONS.map(([k, l]) => h('option', { value: k, text: l })));
    hz.value = st.horizon; hz.addEventListener('change', async () => { st.horizon = hz.value; await this.persist(); });
    acts.append(h('label', { class: 'pd-wi-ctl' }, h('span', { text: 'Figures as of' }), hz));
    acts.append(btn('Save as PDF', () => this.exportPDF(), { icon: 'file-down', cls: 'mod-cta' }));
    acts.append(btn('', () => new InsuranceHelpModal(this.app, this.plugin).open(), { icon: 'help-circle', cls: 'pd-icon-btn pd-wi-help', title: 'How pet insurance and these figures work' }));
    top.append(acts);
    c.append(top);
    if (!this.base.pol) {
      c.append(h('div', { class: 'pd-welcome' }, h('h3', { text: 'Add a policy first' }), h('p', { text: `The planner tests changes against an insurance policy. Add ${petLabel(this.pet)}’s policy on the Insurance tab, then come back.` })));
      return;
    }
    const lay = h('div', { class: 'pd-wi-layout' }), side = h('div', { class: 'pd-wi-side' }), main = h('div', { class: 'pd-wi-main' });
    lay.append(side, main); c.append(lay);
    this.renderSide(side); this.renderMain(main);
    main.scrollTop = scroll;
  }

  viewBar() {
    const data = this.data, ctx = this.base.ctx, pet = this.pet, shared = sharedPolicies(data, pet);
    if (!shared.length) {
      const pol = this.base.pol;
      return h('div', { class: 'pd-wi-view is-compact', role: 'note', title: `Counts ${petLabel(pet)}’s vet bills and claims against the premium.` },
        h('span', { class: 'pd-wi-view-label' }, icon('paw-print'), h('span', { text: 'Viewing' })),
        h('span', { class: 'pd-wi-view-who' }, h('strong', { text: petLabel(pet) }), pol ? ` · ${policyLabel(pol)}` : ''));
    }
    const bar = h('div', { class: 'pd-wi-view', role: 'group', 'aria-label': 'What the planner is evaluating' });
    bar.append(h('div', { class: 'pd-wi-view-label' }, icon(ctx.kind === 'plan' ? 'users' : 'paw-print'), h('span', { text: 'Viewing' })));
    {
      const seg = h('div', { class: 'pd-wi-seg', role: 'radiogroup' });
      const opt = (value, title, sub, active) => {
        const b = h('button', { type: 'button', class: 'pd-wi-seg-btn' + (active ? ' is-active' : ''), role: 'radio', 'aria-checked': String(active) },
          h('span', { class: 'pd-wi-seg-title', text: title }), h('span', { class: 'pd-wi-seg-sub', text: sub }));
        b.addEventListener('click', () => { if (!active) { this.insScope = value; this.render(); } });
        seg.append(b);
      };
      shared.forEach((p) => opt(p.id, 'Whole plan', `${policyLabel(p)} · ${petsOnPolicy(data, p).map(petLabel).join(' + ')}`, ctx.kind === 'plan' && ctx.policy.id === p.id));
      const pol = currentPolicy(ctx) || shared[0], share = policyShare(data, pol, pet.id);
      opt('pet', `${petLabel(pet)}’s share`, `${petLabel(pet)} only · ${fmtPct(share)} of the premium`, ctx.kind === 'pet');
      bar.append(seg);
    }
    bar.append(h('div', { class: 'pd-wi-view-hint', text: ctx.kind === 'plan'
      ? `Counts every covered pet’s vet bills and claims against the full premium. Answers “is this plan worth it for the household?”`
      : `Counts only ${petLabel(pet)}’s vet bills and claims against ${petLabel(pet)}’s share of the premium.` }));
    return bar;
  }
  itemSub(x) { const v = x.st.verdict; return `${v.label} · net ${(x.st.net >= 0 ? '+' : '−') + this.M(Math.abs(x.st.net), true)}`; }
  renderSide(side) {
    const st = this.store;
    side.append(h('div', { class: 'pd-wi-side-head' }, h('span', { class: 'pd-wi-side-title', text: 'Scenarios' }), btn('New', () => this.addScenario(), { icon: 'plus', cls: 'pd-small-btn' })));
    const list = h('div', { class: 'pd-wi-list' });
    const item = (id, name, color, x, sc) => {
      const it = h('div', { class: 'pd-wi-item' + (st.selected === id ? ' is-active' : '') + (sc && sc.visible === false ? ' is-hidden' : ''), role: 'button', tabindex: '0' });
      const sw = h('span', { class: 'pd-swatch pd-wi-sw' + (sc ? '' : ' is-dashed') }); sw.style.setProperty('--sw', color);
      it.append(sw, h('div', { class: 'pd-wi-item-text' }, h('div', { class: 'pd-wi-item-name', text: name }), h('div', { class: 'pd-wi-item-sub', text: this.itemSub(x) })));
      if (sc) it.append(btn('', async () => { sc.visible = sc.visible === false; await this.persist(); }, { icon: sc.visible === false ? 'eye-off' : 'eye', cls: 'pd-icon-btn pd-wi-eye', title: sc.visible === false ? 'Show on chart' : 'Hide from chart' }));
      const pick = () => { st.selected = id; this.persist(); };
      it.addEventListener('click', pick); it.addEventListener('keydown', (e) => { if (e.key === 'Enter') pick(); });
      list.append(it);
    };
    item('base', 'Current plan', BASE_COLOR, this.base, null);
    st.scenarios.forEach((sc) => item(sc.id, sc.name, sc.color, this.sims.get(sc.id), sc));
    if (!st.scenarios.length) list.append(h('div', { class: 'pd-wi-empty', text: 'No scenarios yet — start a new one or pick a quick idea.' }));
    side.append(list);
    const chips = h('div', { class: 'pd-wi-chips' });
    wiPresets(this.data, this.pet, this.insScope, (n, w) => this.M(n, w)).forEach((p) => chips.append(h('button', { class: 'pd-wi-chip', type: 'button', text: p.label, onclick: () => this.addScenario(p.sc) })));
    side.append(h('div', { class: 'pd-wi-ideas' }, h('div', { class: 'pd-wi-side-title', text: 'Quick ideas' }), chips));
  }

  renderMain(main) {
    const data = this.data, base = this.base, sc = this.current(), x = sc ? this.sims.get(sc.id) : base;
    const M = (n, w) => this.M(n, w), D = (d) => this.D(d);
    // head
    const head = h('div', { class: 'pd-wi-head' });
    const hsw = h('span', { class: 'pd-swatch pd-wi-head-sw' + (sc ? '' : ' is-dashed') }); hsw.style.setProperty('--sw', sc ? sc.color : BASE_COLOR); head.append(hsw);
    if (sc) {
      const name = h('input', { class: 'pd-wi-name', type: 'text', 'aria-label': 'Scenario name' }); name.value = sc.name;
      name.addEventListener('change', async () => { sc.name = name.value.trim() || sc.name; await this.persist(); });
      name.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); name.blur(); } });
      head.append(name, h('div', { class: 'pd-wi-head-actions' }, btn('Duplicate', () => this.duplicate(sc), { icon: 'copy', cls: 'pd-small-btn' }), btn('Delete', () => this.remove(sc), { icon: 'trash-2', cls: 'pd-small-btn pd-danger' })));
    } else {
      const when = this.store.horizon === 'today' ? 'today' : `as of ${D(this.hz)}`;
      head.append(h('div', { class: 'pd-wi-head-text' }, h('h3', { text: 'Your current plan' }),
        h('div', { class: 'pd-muted', text: `What your records show ${when}${this.store.horizon === 'today' ? '' : ', if premiums carry on and nothing else happens'}. Create a scenario to test changes side by side.` })),
        btn('New scenario', () => this.addScenario(), { icon: 'plus', cls: 'mod-cta' }));
    }
    main.append(head);

    // tiles
    const tiles = h('div', { class: 'pd-wi-tiles' }), cmp = !!sc;
    const dMoney = (v) => (Math.abs(v) < 0.5 ? '' : `${v > 0 ? '+' : '−'}${M(Math.abs(v), true)}`);
    const tone = (v, upGood = true) => (Math.abs(v) < 0.5 ? 'flat' : (v > 0) === upGood ? 'good' : 'bad');
    const tile = (label, tip, value, o = {}) => {
      const t = h('div', { class: 'pd-wi-tile' }, h('div', { class: 'pd-wi-tile-label' }, term(tip, label)));
      const v = h('div', { class: 'pd-wi-tile-value', text: value }); if (o.badge) v.append(this.badge(o.badge)); t.append(v);
      if (cmp && o.delta !== undefined) t.append(h('div', { class: `pd-wi-delta is-${o.delta ? o.tone : 'flat'}`, text: o.delta ? `${o.delta} vs current` : 'Same as current' }));
      if (o.sub) t.append(h('div', { class: 'pd-wi-tile-sub', text: o.sub }));
      tiles.append(t);
    };
    const a = base.st, b = x.st;
    const dr = b.ratio != null && a.ratio != null && Math.abs(b.ratio - a.ratio) >= 0.005 ? `${b.ratio > a.ratio ? '+' : '−'}${fmtNum(Math.abs(b.ratio - a.ratio), 2)}` : '';
    tile('Back per $1 paid', 'returnRatio', b.ratio != null ? fmtNum(b.ratio, 2) : '–', { badge: b.verdict.level, delta: dr, tone: tone((b.ratio || 0) - (a.ratio || 0)) });
    tile('Net benefit', 'netBenefit', (b.net >= 0 ? '+' : '−') + M(Math.abs(b.net), true), { delta: dMoney(b.net - a.net), tone: tone(b.net - a.net), sub: 'Reimbursed − premiums' });
    tile('Your total cost', 'totalCost', M(x.total, true), { delta: dMoney(x.total - base.total), tone: tone(x.total - base.total, false), sub: `vs ${M(b.vetCostsAll, true)} with no insurance` });
    tile('Premiums paid', 'premium', M(b.premiums, true), { delta: dMoney(b.premiums - a.premiums), tone: tone(b.premiums - a.premiums, false), sub: b.policy ? `${M(b.policy.rateNow)}/${b.policy.policy.frequency === 'annual' ? 'yr' : 'mo'} ${b.policy.active ? 'now' : '(ended)'}` : '' });
    tile('Reimbursed', 'claim', M(b.benefit, true), { delta: dMoney(b.benefit - a.benefit), tone: tone(b.benefit - a.benefit), sub: `${plural(b.paid.length, 'paid claim')}${this.s.includePending && b.pendingEst ? ` · incl. ${M(b.pendingEst, true)} pending` : ''}` });
    const lim = (s) => (s.policy ? s.policy.ded.limitRemaining : null);
    const la = lim(a), lb = lim(b);
    tile('Limit left this year', 'limitLeft', lb == null ? '–' : lb === Infinity ? 'Unlimited' : M(lb, true),
      { delta: la != null && lb != null && isFinite(la) && isFinite(lb) ? dMoney(lb - la) : '', tone: tone((lb || 0) - (la || 0)), sub: b.policy ? `Deductible met ${M(b.policy.ded.met, true)} of ${M(b.policy.ded.deductible, true)}` : '' });
    main.append(tiles);

    // chart
    const cc = h('div', { class: 'pd-wi-card' });
    cc.append(h('div', { class: 'pd-wi-card-head' }, h('h4', {}, term('runningNet', 'Running net benefit')), h('span', { class: 'pd-muted', text: 'Reimbursed minus premiums, month by month' })));
    const lines = [{ id: 'base', name: 'Current plan', color: BASE_COLOR, x: base, dashed: !!sc }];
    this.store.scenarios.forEach((s2) => { if (s2.visible !== false || s2 === sc) lines.push({ id: s2.id, name: s2.name, color: s2.color, x: this.sims.get(s2.id) }); });
    const months = base.series.map((r) => r.month), sel = sc ? sc.id : 'base';
    const co = {
      h: 250, grid: VIEW_COLORS.grid, text: VIEW_COLORS.text, xTicks: monthTicks(months), yFmt: (v) => M(v, true), label: 'Running net benefit for each scenario',
      refLines: [{ y: 0, label: 'Break-even' }],
      series: lines.map((l) => ({ name: l.name, color: l.color, dash: l.dashed, noDots: true, area: l.id === sel, points: l.x.series.map((r, i) => ({ x: i, y: r.net })) })),
      hover: { label: (i) => monthLabel(months[i], true), value: (v) => (v >= 0 ? '+' : '−') + M(Math.abs(v)),
        extra: (i) => { const r = x.series[i]; return r ? [[`${sc ? sc.name : 'Current plan'}: bills this month`, M(r.bills)], ['Premiums this month', M(r.premiums)], ['Reimbursed this month', M(r.reimbursed)], ['Total cost so far', M(r.cost)]] : []; } },
    };
    const wrap = h('div', { class: 'pd-chart-wrap' }); wrap.innerHTML = lineChartSVG(co);
    const leg = h('div', { class: 'pd-legend' }, lines.map((l) => { const sw = h('span', { class: 'pd-swatch' + (l.dashed ? ' is-dashed' : '') }); sw.style.setProperty('--sw', l.color); return h('span', {}, sw, ' ', l.name); }));
    cc.append(wrap, leg); main.append(cc);
    requestAnimationFrame(() => attachChartHover(wrap, co));

    if (sc) {
      const cols = h('div', { class: 'pd-wi-cols' });
      // plan terms
      const ac = h('div', { class: 'pd-wi-card' }), changed = WI_TERMS.filter((k) => sc.terms && hasVal(sc.terms[k]));
      ac.append(h('div', { class: 'pd-wi-card-head' }, h('h4', { text: 'Plan terms' }), h('div', { class: 'pd-actions' },
        changed.length ? btn('Reset', async () => { sc.terms = {}; await this.persist(); }, { icon: 'rotate-ccw', cls: 'pd-small-btn' }) : null,
        btn('Edit', () => this.editTerms(sc), { icon: 'pencil', cls: 'pd-small-btn' }))));
      const bt = wiBaseTerms(base.ctx, base.pol), et = x.terms;
      const ft = (k, v) => (k === 'reimbursement' ? `${fmtNum(v)}%` : k === 'annualLimit' && !num(v) ? 'Unlimited' : k === 'premium' ? `${M(v)}/${base.pol.frequency === 'annual' ? 'yr' : 'mo'}` : M(v, true));
      ac.append(h('table', { class: 'pd-table pd-wi-assume' }, h('thead', {}, h('tr', {}, h('th', { text: '' }), h('th', { class: 'num', text: 'Current plan' }), h('th', { class: 'num', text: 'This scenario' }))),
        h('tbody', {}, WI_TERMS.map((k) => h('tr', { class: changed.includes(k) ? 'is-changed' : '' }, h('td', {}, term(k === 'premium' ? 'premium' : k, WI_TERM_LABELS[k])), h('td', { class: 'num pd-muted', text: ft(k, bt[k]) }), h('td', { class: 'num', text: ft(k, et[k]) }))))));
      if (changed.length) ac.append(h('div', { class: 'pd-small pd-muted', text: 'Applied to your whole history, as if you had had this plan all along: past claims are re-worked with these terms.' }));
      // changes
      const ec = h('div', { class: 'pd-wi-card' });
      ec.append(h('div', { class: 'pd-wi-card-head' }, h('h4', { text: 'Changes' }), h('span', { class: 'pd-muted', text: `${(sc.events || []).length} in this scenario` })));
      const list = h('div', { class: 'pd-wi-events' });
      if (!(sc.events || []).length) list.append(h('div', { class: 'pd-wi-empty', text: 'No changes yet. Add one below — for example a claim being denied or an emergency next month.' }));
      (sc.events || []).forEach((e) => {
        const row = h('div', { class: 'pd-wi-event', role: 'button', tabindex: '0' },
          h('span', { class: `pd-wi-event-icon is-${e.type}` }, icon((WI_EVENTS[e.type] || {}).icon || 'circle')),
          h('div', { class: 'pd-wi-event-text' }, h('div', { class: 'pd-wi-event-type', text: (WI_EVENTS[e.type] || {}).label || 'Change' }), h('div', { text: wiDescribe(e, data, this.pet, base.ctx, M, D) })),
          h('div', { class: 'pd-wi-event-actions' }, btn('', () => this.editEvent(sc, e), { icon: 'pencil', cls: 'pd-icon-btn', title: 'Edit change' }),
            btn('', async () => { sc.events = sc.events.filter((y) => y !== e); await this.persist(); }, { icon: 'trash-2', cls: 'pd-icon-btn pd-danger', title: 'Remove change' })));
        row.addEventListener('click', () => this.editEvent(sc, e)); row.addEventListener('keydown', (ev) => { if (ev.key === 'Enter') this.editEvent(sc, e); });
        list.append(row);
      });
      ec.append(list, h('div', { class: 'pd-wi-add' }, h('div', { class: 'pd-wi-add-label', text: 'Add a change' }), this.eventChips((type) => this.editEvent(sc, null, type))));
      cols.append(ac, ec); main.append(cols);
      // notes
      const ta = h('textarea', { class: 'pd-wi-notes', rows: 2, placeholder: 'Why you’re testing this, what you learned… (included in the PDF)' }); ta.value = sc.notes || '';
      ta.addEventListener('change', async () => { sc.notes = ta.value; await this.plugin.saveAll(); });
      main.append(h('div', { class: 'pd-wi-card' }, h('div', { class: 'pd-wi-card-head' }, h('h4', { text: 'Notes' })), ta));
    } else {
      const chips = this.eventChips((type) => { const ns = this.addScenario({ name: WI_EVENTS[type].label }, false); this.render(); this.editEvent(ns, null, type, true); });
      const b2 = h('button', { class: 'pd-wi-chip has-icon', type: 'button' }, icon('sliders-horizontal'), h('span', { text: 'Different premium, deductible or rate' }));
      b2.addEventListener('click', () => { const ns = this.addScenario({ name: 'Different plan terms' }, false); this.render(); this.editTerms(ns, true); });
      chips.append(b2);
      main.append(h('div', { class: 'pd-wi-card pd-wi-start' }, h('div', { class: 'pd-wi-card-head' }, h('h4', { text: 'Try a change' })),
        h('div', { class: 'pd-muted', text: 'Start a scenario with one change, then add more. Test a claim being paid or denied, a new vet bill or emergency, ongoing treatment, a premium change, cancelling (or taking one pet off the plan), or a plan with different terms.' }), chips));
    }

    // comparison
    if (this.store.scenarios.length) {
      const card = h('div', { class: 'pd-wi-card' }, h('div', { class: 'pd-wi-card-head' }, h('h4', { text: 'All scenarios compared' }), h('span', { class: 'pd-muted', text: 'Click a row to open it' })));
      const tb = h('tbody');
      const row = (id, name, color, y, dashed) => {
        const sw = h('span', { class: 'pd-swatch' + (dashed ? ' is-dashed' : '') }); sw.style.setProperty('--sw', color);
        const tr = h('tr', { class: 'is-clickable' + (this.store.selected === id ? ' is-selected' : '') },
          h('td', {}, sw, h('span', { class: 'pd-wi-cmp-name', text: ' ' + name })),
          h('td', { class: 'num' }, y.st.ratio != null ? fmtNum(y.st.ratio, 2) + ' ' : '–', this.badge(y.st.verdict.level)),
          h('td', { class: 'num', text: (y.st.net >= 0 ? '+' : '−') + M(Math.abs(y.st.net), true) }),
          h('td', { class: 'num', text: M(y.total, true) }), h('td', { class: 'num', text: M(y.st.premiums, true) }), h('td', { class: 'num', text: M(y.st.benefit, true) }));
        tr.addEventListener('click', () => { this.store.selected = id; this.persist(); });
        tb.append(tr);
      };
      row('base', 'Current plan', BASE_COLOR, base, true);
      this.store.scenarios.forEach((s2) => row(s2.id, s2.name, s2.color, this.sims.get(s2.id), false));
      const th = (t, tip, n) => h('th', { class: n ? 'num' : '' }, tip ? term(tip, t) : t);
      card.append(h('div', { class: 'pd-table-wrap' }, h('table', { class: 'pd-table pd-wi-compare' }, h('thead', {}, h('tr', {}, th('Scenario'), th('Back per $1', 'returnRatio', 1), th('Net benefit', 'netBenefit', 1), th('Your total cost', 'totalCost', 1), th('Premiums', 'premium', 1), th('Reimbursed', 'claim', 1))), tb)));
      main.append(card);
    }
  }
  badge(level) { const t = { good: 'Paying off', fair: 'Partly', poor: 'Costing more', none: 'No data' }[level] || ''; return h('span', { class: `pd-badge is-${level}`, text: t }); }
  eventChips(onPick) {
    const chips = h('div', { class: 'pd-wi-chips' });
    Object.entries(WI_EVENTS).forEach(([type, t]) => { const b = h('button', { class: 'pd-wi-chip has-icon', type: 'button', title: t.hint }, icon(t.icon), h('span', { text: t.label })); b.addEventListener('click', () => onPick(type)); chips.append(b); });
    return chips;
  }

  editTerms(sc, isNew) {
    const base = this.base, bt = wiBaseTerms(base.ctx, base.pol), et = Object.assign({}, bt, sc.terms || {});
    const per = base.pol.frequency === 'annual' ? 'year' : 'month', nPets = petsOnPolicy(this.data, base.pol).length;
    let saved = false;
    const m = new FormModal(this.app, {
      title: `Plan terms · ${sc.name}`, intro: 'Change any of these for this scenario only. They are applied to your whole history, as if you had had this plan all along.',
      initial: et, submitLabel: 'Apply to scenario',
      fields: [
        { key: 'premium', label: `Premium per ${per}${nPets > 1 ? ' (whole policy)' : ''}`, type: 'money', tip: 'premium', help: `Now ${this.M(bt.premium)}. Past premiums are scaled by the same proportion.` },
        { key: 'deductible', label: 'Deductible', type: 'money', tip: 'deductible', help: `Now ${this.M(bt.deductible, true)}.` },
        { key: 'reimbursement', label: 'Reimbursement rate (%)', type: 'percent', tip: 'reimbursement', help: `Now ${fmtNum(bt.reimbursement)}%.` },
        { key: 'annualLimit', label: 'Annual limit (0 = unlimited)', type: 'money', tip: 'annualLimit', help: `Now ${bt.annualLimit ? this.M(bt.annualLimit, true) : 'unlimited'}.` },
      ],
      validate: (v) => (num(v.reimbursement) < 0 || num(v.reimbursement) > 100 ? 'The reimbursement rate should be between 0 and 100%.' : num(v.premium) < 0 ? 'The premium cannot be negative.' : null),
      onSubmit: async (v) => {
        sc.terms = {}; WI_TERMS.forEach((k) => { if (hasVal(v[k]) && Math.abs(num(v[k]) - num(bt[k])) > 0.004) sc.terms[k] = num(v[k]); });
        saved = true; await this.persist();
      },
    });
    if (isNew) { const close = m.onClose.bind(m); m.onClose = () => { close(); if (!saved) this.dropIfEmpty(sc); }; }
    m.open();
  }
  dropIfEmpty(sc) {
    if ((sc.events || []).length || Object.keys(sc.terms || {}).length) return;
    this.store.scenarios = this.store.scenarios.filter((y) => y !== sc); this.store.selected = 'base'; this.render();
  }
  editEvent(sc, ev, type, isNew) {
    type = ev ? ev.type : type;
    const data = this.data, base = this.base, ctx = base.ctx, pol = base.pol, e0 = ev || {};
    const petsHere = ctx.kind === 'plan' ? ctx.petsCovered : [this.pet];
    const petOpts = petsHere.map((p) => [p.id, petLabel(p)]);
    const ageOK = petsHere.some((p) => birthInfo(p));
    const startModes = ['now', 'months'].concat(ageOK ? ['age'] : [], ['date']);
    let fields = [], vals = {};
    if (type === 'claim') {
      const cl = ctx.claims.slice().sort(byDate('serviceDate', true));
      const open = cl.filter((c) => PENDING.includes(c.status) || c.status === 'draft').length;
      const opts = (open ? [['*open*', `All open claims (${open})`]] : []).concat(cl.map((c) => [c.id, `${this.D(c.serviceDate)} · ${petLabel(data.pets.find((p) => p.id === c.petId))} · ${c.condition || 'claim'} · ${this.M(num(c.amountClaimed))} · ${CLAIM_STATUS[c.status]}`]));
      if (!opts.length) { new Notice('There are no claims to test yet. Try “New vet bill” instead.'); if (isNew) this.dropIfEmpty(sc); return; }
      fields = [
        { key: 'claimId', label: 'Claim', type: 'select', options: opts, wide: true },
        { key: 'outcome', label: 'Outcome', type: 'select', options: [['approved', 'Paid (estimated from the policy terms)'], ['custom', 'Paid this amount'], ['denied', 'Denied']], onChange: (v, f) => f.showRow('amount', v === 'custom') },
        { key: 'amount', label: 'Amount paid', type: 'money' },
      ];
      fields.onReady = (f) => f.showRow('amount', f.vals.outcome === 'custom');
      vals = { claimId: e0.claimId || opts[0][0], outcome: e0.outcome || 'denied', amount: hasVal(e0.amount) ? e0.amount : '' };
    } else if (type === 'bill' || type === 'recurring') {
      const rec = type === 'recurring';
      fields = [
        petOpts.length > 1 ? { key: 'petId', label: 'Pet', type: 'select', options: petOpts } : null,
        { key: 'label', label: 'What for', placeholder: rec ? 'e.g. Allergy medication' : 'e.g. Broken leg' },
        { key: 'amount', label: rec ? 'Cost per month' : 'Amount', type: 'money', required: true },
        ...wiFieldsWhen('start', rec ? 'Starts' : 'When', startModes),
        ...(rec ? wiFieldsWhen('end', 'Lasts', ['never', 'count', 'date']) : []),
        { key: 'covered', label: 'Covered by the policy (a claim is made and paid at the estimated amount)', type: 'checkbox', tip: 'eligible' },
      ].filter(Boolean);
      fields.onReady = (f) => { wiToggleWhen(f, 'start'); if (rec) wiToggleWhen(f, 'end'); };
      vals = Object.assign({ petId: e0.petId || this.pet.id, label: e0.label || (rec ? 'Ongoing medication' : 'Illness or injury'), amount: hasVal(e0.amount) ? e0.amount : (rec ? 80 : 1500), covered: e0.covered !== false },
        wiWhenVals('start', e0.start, rec ? { mode: 'now' } : { mode: 'months', value: 1 }), rec ? wiWhenVals('end', e0.end, { mode: 'count', value: 12 }) : {});
    } else if (type === 'premium') {
      const r = nextRenewal(pol);
      fields = [
        { key: 'mode', label: 'Change by', type: 'select', options: [['pct', 'A percentage'], ['amount', 'Set a new amount']], onChange: (v, f) => f.setLabel('value', v === 'pct' ? 'Change (%) — negative for a discount' : 'New premium (whole policy)') },
        { key: 'value', label: 'Change (%)', type: 'number', step: 'any', required: true, help: `Now ${this.M(rateAt(ctx, pol, todayISO()))} per ${pol.frequency === 'annual' ? 'year' : 'month'}${petsOnPolicy(data, pol).length > 1 ? ' for the whole policy' : ''}.` },
        ...wiFieldsWhen('start', 'From', startModes),
      ];
      fields.onReady = (f) => { wiToggleWhen(f, 'start'); f.setLabel('value', f.vals.mode === 'pct' ? 'Change (%) — negative for a discount' : 'New premium (whole policy)'); };
      vals = Object.assign({ mode: e0.mode || 'pct', value: hasVal(e0.value) ? e0.value : 15 }, wiWhenVals('start', e0.start, r ? { mode: 'date', date: r } : { mode: 'months', value: 1 }));
    } else if (type === 'cancel') {
      const onPol = petsOnPolicy(data, pol);
      const whoOpts = [['policy', `Cancel the whole policy${onPol.length > 1 ? ` (${onPol.map(petLabel).join(' + ')})` : ''}`]].concat(onPol.length > 1 ? onPol.map((p) => [p.id, `Take ${petLabel(p)} off the plan (it carries on for the others)`]) : []);
      fields = [{ key: 'who', label: 'What', type: 'select', options: whoOpts, wide: true }, ...wiFieldsWhen('start', 'When', ['now', 'months', 'date'])];
      fields.onReady = (f) => wiToggleWhen(f, 'start');
      vals = Object.assign({ who: e0.who || (ctx.kind === 'pet' && onPol.length > 1 ? this.pet.id : 'policy') }, wiWhenVals('start', e0.start, { mode: 'now' }));
    }
    let saved = false;
    const m = new FormModal(this.app, {
      title: `${ev ? 'Edit' : 'Add'} ${(WI_EVENTS[type].label).toLowerCase()} · ${sc.name}`, intro: `${WI_EVENTS[type].hint}. Only affects this scenario.`,
      fields, initial: vals, onReady: fields.onReady, submitLabel: ev ? 'Save change' : 'Add change',
      onDelete: ev ? async () => { sc.events = sc.events.filter((y) => y !== ev); await this.persist(); } : null,
      validate: (v) => {
        if ((type === 'bill' || type === 'recurring') && !(num(v.amount) > 0)) return 'Enter an amount.';
        if (type === 'claim' && v.outcome === 'custom' && !hasVal(v.amount)) return 'Enter the amount paid.';
        if (type === 'premium' && v.mode === 'amount' && !(num(v.value) > 0)) return 'Enter the new premium.';
        if (v.startMode === 'date' && !v.startDate) return 'Pick a date.';
        if (['months', 'age'].includes(v.startMode) && !hasVal(v.startValue)) return v.startMode === 'age' ? 'Enter the pet’s age.' : 'Enter how many months from now.';
        if (v.endMode === 'count' && !(num(v.endValue) >= 1)) return 'Enter how many months it lasts.';
        if (v.endMode === 'date' && v.endDate && v.startMode === 'date' && v.endDate < v.startDate) return 'The end must be after the start.';
        return null;
      },
      onSubmit: async (v) => {
        const out = { id: ev ? ev.id : uid(), type };
        if (type === 'claim') Object.assign(out, { claimId: v.claimId, outcome: v.outcome, amount: v.amount });
        if (type === 'bill' || type === 'recurring') Object.assign(out, { petId: v.petId || this.pet.id, label: v.label, amount: num(v.amount), covered: !!v.covered, start: wiWhenRead('start', v) }, type === 'recurring' ? { end: wiWhenRead('end', v) } : {});
        if (type === 'premium') Object.assign(out, { mode: v.mode, value: num(v.value), start: wiWhenRead('start', v) });
        if (type === 'cancel') Object.assign(out, { who: v.who, start: wiWhenRead('start', v) });
        if (ev) Object.assign(ev, out); else sc.events.push(out);
        saved = true; await this.persist();
      },
    });
    if (isNew) { const close = m.onClose.bind(m); m.onClose = () => { close(); if (!saved) this.dropIfEmpty(sc); }; }
    m.open();
  }

  exportPDF() {
    const scs = this.store.scenarios;
    if (!scs.length) { this.makePDF([]); return; }
    const md = new Modal(this.app);
    md.onOpen = () => {
      md.modalEl.addClass && md.modalEl.addClass('pd-modal');
      const boxes = scs.map((sc) => { const cb = h('input', { type: 'checkbox' }); cb.checked = sc.visible !== false; const sw = h('span', { class: 'pd-swatch' }); sw.style.setProperty('--sw', sc.color); return { sc, cb, el: h('label', { class: 'pd-check-item' }, cb, ' ', sw, ' ', sc.name) }; });
      md.contentEl.append(h('h3', { class: 'pd-modal-title', text: 'Save what-if scenarios as PDF' }), h('p', { class: 'pd-muted', text: 'Choose the scenarios to include. Your current plan is always included for comparison.' }),
        h('div', { class: 'pd-checklist pd-col' }, boxes.map((b) => b.el)),
        h('div', { class: 'pd-form-actions' }, h('span', { class: 'pd-spacer' }), btn('Cancel', () => md.close()), btn('Create PDF', () => { const pick = boxes.filter((b) => b.cb.checked).map((b) => b.sc); md.close(); this.makePDF(pick); }, { cls: 'mod-cta', icon: 'file-down' })));
    };
    md.onClose = () => clear(md.contentEl);
    md.open();
  }
  async makePDF(chosen) {
    R_PHOTOS = {};
    const pets = this.base.ctx.petsCovered;
    for (const p of pets) { const u = await this.plugin.photoDataUrl(p); if (u) R_PHOTOS[p.id] = u; }
    const body = whatIfReportHTML(this, chosen);
    await exportPdf(this.plugin, 'What-if scenarios', body, `${petLabel(this.pet)} – What-if scenarios – ${todayISO()}`, `Pet insurance what-if scenarios · ${petLabel(this.pet)} · estimates only, not financial advice`);
  }
}

/* PDF body for the planner, in the same style as the other reports */
function whatIfReportHTML(m, chosen) {
  const data = m.data, s = data.settings, M = (n, w) => fmtMoney(n, s.currency, w), D = (d) => fmtDate(d, s.dateFormat);
  const base = m.base, ctx = base.ctx, sims = chosen.map((sc) => ({ sc, x: m.sims.get(sc.id) || wiSimulate(data, m.pet.id, m.insScope, sc, m.hz) }));
  const covers = ctx.kind === 'plan' ? `${esc(ctx.name)} — whole plan (${esc(ctx.petsCovered.map(petLabel).join(', '))})` : esc(petLabel(m.pet));
  let o = rHead('Pet insurance what-if scenarios', [`<b>Covers:</b> ${covers}`, `<b>Figures as of:</b> ${esc(D(m.hz))} (${esc((WI_HORIZONS.find((x) => x[0] === m.store.horizon) || [])[1] || '')})`, `Created ${esc(D(todayISO()))} · amounts in ${esc(s.currency)}`], ctx.petsCovered.map((p) => p.id));
  o += `<div class="r-box"><h3>Estimates, not guarantees</h3><p style="margin:0">These scenarios use your policy terms as recorded and simple claim maths (deductible, then the reimbursement rate, up to the annual limit). Your insurer makes the real decisions. Not financial advice.</p></div>`;
  const vt = { good: 'Paying off', fair: 'Partly paying off', poor: 'Costing more than it returns', none: 'Not enough data' };
  const res = (x) => rTiles([
    { l: 'Back per $1 paid', v: x.st.ratio != null ? fmtNum(x.st.ratio, 2) : '–', s: vt[x.st.verdict.level], tone: x.st.verdict.level === 'good' ? 'good' : x.st.verdict.level === 'poor' ? 'bad' : x.st.verdict.level === 'fair' ? 'warn' : '' },
    { l: 'Net benefit', v: (x.st.net >= 0 ? '+' : '−') + M(Math.abs(x.st.net), true), s: 'reimbursed − premiums', tone: x.st.net >= 0 ? 'good' : 'bad' },
    { l: 'Your total cost', v: M(x.total, true), s: `vs ${M(x.st.vetCostsAll, true)} with no insurance` },
    { l: 'Premiums paid', v: M(x.st.premiums, true) }, { l: 'Reimbursed', v: M(x.st.benefit, true), s: s.includePending && x.st.pendingEst ? 'incl. pending estimate' : '' },
    { l: 'Limit left this year', v: x.st.policy ? (x.st.policy.ded.limitRemaining === Infinity ? 'Unlimited' : M(x.st.policy.ded.limitRemaining, true)) : '–' },
  ]);
  o += '<h2>Current plan</h2>' + res(base);
  if (sims.length) {
    o += '<h2>Comparison</h2>' + rTable([
      { l: 'Scenario', html: true, f: (r) => `<span style="display:inline-block;width:9px;height:9px;border-radius:2px;background:${r.color}"></span> ${esc(r.name)}` },
      { l: 'Back per $1', n: true, f: (r) => (r.x.st.ratio != null ? fmtNum(r.x.st.ratio, 2) : '–') }, { l: 'Verdict', f: (r) => vt[r.x.st.verdict.level] },
      { l: 'Net benefit', n: true, f: (r) => (r.x.st.net >= 0 ? '+' : '−') + M(Math.abs(r.x.st.net), true) }, { l: 'Your total cost', n: true, f: (r) => M(r.x.total, true) },
      { l: 'Change in cost', n: true, f: (r) => (r.base ? '–' : `${r.x.total - base.total >= 0 ? '+' : '−'}${M(Math.abs(r.x.total - base.total), true)}`) },
      { l: 'Premiums', n: true, f: (r) => M(r.x.st.premiums, true) }, { l: 'Reimbursed', n: true, f: (r) => M(r.x.st.benefit, true) },
    ], [{ name: 'Current plan', color: BASE_COLOR, x: base, base: true }].concat(sims.map((y) => ({ name: y.sc.name, color: y.sc.color, x: y.x }))));
  }
  const months = base.series.map((r) => r.month);
  const lines = [{ name: 'Current plan', color: BASE_COLOR, x: base, dash: sims.length > 0 }].concat(sims.map((y) => ({ name: y.sc.name, color: y.sc.color, x: y.x })));
  o += `<div class="r-keep"><h2>Running net benefit</h2><p class="r-muted r-small">Reimbursed minus premiums, month by month. Above the break-even line, the insurance has paid back more than it cost.</p><div class="r-chart">${lineChartSVG({ h: 200, grid: RC.grid, text: RC.text, xTicks: monthTicks(months), yFmt: (v) => M(v, true), refLines: [{ y: 0, label: 'Break-even' }], series: lines.map((l) => ({ name: l.name, color: l.color, dash: l.dash, noDots: true, points: l.x.series.map((r, i) => ({ x: i, y: r.net })) })) })}</div>${legendHTML(lines.map((l) => ({ name: l.name, color: l.color })))}</div>`;
  const bt = wiBaseTerms(ctx, base.pol), ft = (k, v) => (k === 'reimbursement' ? `${fmtNum(v)}%` : k === 'annualLimit' && !num(v) ? 'Unlimited' : M(v, k !== 'premium'));
  sims.forEach(({ sc, x }) => {
    o += `<h2><span style="display:inline-block;width:12px;height:12px;border-radius:3px;background:${sc.color};margin-right:6px"></span>${esc(sc.name)}</h2>`;
    if (sc.notes) o += `<p><i>${esc(sc.notes)}</i></p>`;
    const ch = WI_TERMS.filter((k) => sc.terms && hasVal(sc.terms[k]));
    if (ch.length) o += '<h3>Plan terms</h3>' + rTable([{ l: '', f: (k) => WI_TERM_LABELS[k] }, { l: 'Current plan', n: true, f: (k) => ft(k, bt[k]) }, { l: 'This scenario', n: true, f: (k) => ft(k, x.terms[k]) }], ch);
    o += '<h3>Changes</h3>' + ((sc.events || []).length ? `<ul>${sc.events.map((e) => `<li><b>${esc(WI_EVENTS[e.type].label)}:</b> ${esc(wiDescribe(e, data, m.pet, ctx, M, D))}</li>`).join('')}</ul>` : '<p class="r-muted">None (plan terms only).</p>');
    o += '<h3>Results</h3>' + res(x);
  });
  o += `<h2>Appendix: how the scenarios are calculated</h2><div class="r-appendix"><ul>
    <li>Each scenario runs on a copy of your records; nothing is changed.</li>
    <li><b>Plan terms</b> apply to the whole history, as if you had had that plan all along: paid claims are re-worked with the new deductible, rate and limit, and past premiums are scaled to the new premium.</li>
    <li><b>New bills and ongoing treatment</b> become a vet visit and, if covered, a claim paid at (bill − deductible still to meet) × reimbursement rate, capped by the annual limit left.</li>
    <li><b>Claim outcomes</b> replace the recorded or pending outcome. <b>Premium changes</b> apply from their date. <b>Cancelling</b> stops premiums and cover from that date; taking one pet off a multi-pet plan stops only that pet’s share and cover.</li>
    <li>Figures as of ${esc(D(m.hz))}: premiums are assumed to carry on until then; no other new bills are assumed.</li>
    <li><b>Your total cost</b> = vet bills + premiums − reimbursements. <b>Net benefit</b> = reimbursements − premiums. <b>Back per $1</b> = reimbursements ÷ premiums.</li></ul></div>
    <div class="r-disclaimer">Produced by Pet Dashboard for Obsidian. Estimates only, based on the records you entered; not financial advice.</div>`;
  return `<section class="r-report">${o}</section>`;
}
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
/* ---------------- sample data: two pets on a shared plan ---------------- */
function sampleData() {
  const T = todayISO();
  const M = (m, day) => { const d = addMonths(T, m); return day ? d.slice(0, 8) + pad(day) : d; };
  const D = (n) => addDays(T, n);
  const biscuit = Object.assign(newPet('Biscuit'), {
    species: 'Dog', breed: 'Golden Retriever', sex: 'Male (neutered)', dob: '2021-06-14', color: 'Golden', microchip: '985112004567321',
    primaryVet: 'Maple Street Animal Hospital', vetPhone: '(555) 201-3344', vetAddress: '412 Maple Street, Springfield, OR 97477',
    emergencyVet: 'Riverside Veterinary Emergency', emergencyPhone: '(555) 388-9100', emergencyAddress: '88 River Road, Eugene, OR 97401 · open 24/7',
    allergies: 'Chicken protein (suspected)', conditions: 'Seasonal atopic dermatitis', titleMode: 'pet',
  });
  const mochi = Object.assign(newPet('Mochi'), {
    species: 'Cat', breed: 'Domestic Shorthair', sex: 'Female (spayed)', dob: '', dobMode: 'estimated', ageYears: 1, ageMonths: 6, ageAsOf: addMonths(todayISO(), -26), color: 'Grey tabby', microchip: '985112009876543',
    primaryVet: 'Maple Street Animal Hospital', vetPhone: '(555) 201-3344', vetAddress: '412 Maple Street, Springfield, OR 97477',
    emergencyVet: 'Riverside Veterinary Emergency', emergencyPhone: '(555) 388-9100', emergencyAddress: '88 River Road, Eugene, OR 97401 · open 24/7', allergies: '', conditions: '', titleMode: 'default',
  });
  const id = () => uid() + Math.random().toString(36).slice(2, 5);
  const visit = (pet, o) => { const v = Object.assign({ id: id(), clinic: 'Maple Street Animal Hospital', vet: 'Dr. Priya Raman' }, o); pet.visits.push(v); return v; };

  /* policies */
  const old = { id: id(), petIds: [mochi.id], split: 'equal', shares: {}, provider: 'Whisker Shield', plan: 'Cat Essentials', policyNumber: 'WS-448812', coverage: 'Accident & illness',
    start: M(-26, 1), end: addDays(M(-17, 1), -1), premium: 22, frequency: 'monthly', deductible: 100, deductibleType: 'annual', deductibleScope: 'perPet', limitScope: 'perPet',
    reimbursement: 90, annualLimit: 5000, waitingPeriod: 14, exclusions: 'Pre-existing conditions, dental cleaning', phone: '(800) 555-0142', website: 'whiskershield.example', notes: 'Cancelled when we moved both pets to one multi-pet plan.' };
  const plan = { id: id(), petIds: [biscuit.id, mochi.id], split: 'custom', shares: { [biscuit.id]: 65, [mochi.id]: 35 }, petStart: { [mochi.id]: M(-17, 1) }, petEnd: {}, provider: 'Paws & Claws Mutual', plan: 'Multi-Pet Plus',
    policyNumber: 'PCM-2025-77310', coverage: 'Accident & illness', start: M(-20, 1), end: '', premium: 58, frequency: 'monthly', deductible: 250, deductibleType: 'annual',
    deductibleScope: 'perPet', limitScope: 'perPet', reimbursement: 80, annualLimit: 10000, waitingPeriod: 14,
    exclusions: 'Pre-existing conditions, routine dental cleaning, wellness care, breeding', phone: '(800) 555-0199', website: 'pawsandclaws.example', notes: 'Started for Biscuit; Mochi added three months later with a 10% multi-pet discount.' };
  const premiumChanges = [{ id: id(), policyId: plan.id, date: M(-17, 1), amount: 86, reason: 'Pet added (Mochi), 10% multi-pet discount' }, { id: id(), policyId: plan.id, date: M(-8, 1), amount: 94, reason: 'Renewal' }];
  const claims = [];
  const claim = (pet, v, o) => claims.push(Object.assign({ id: id(), petId: pet.id, visitId: v ? v.id : '', policyId: plan.id, serviceDate: v ? v.date : '', amountClaimed: v ? v.cost : 0, condition: v ? (v.diagnosis || v.reason) : '' }, o));

  /* Biscuit visits + claims */
  const b1 = visit(biscuit, { date: M(-19, 6), type: 'Sick visit', reason: 'Head shaking, smelly right ear', diagnosis: 'Otitis externa (yeast)', treatment: 'Ear cleaning, Osurnia in right ear', cost: 210, weight: 68.4 });
  claim(biscuit, b1, { status: 'approved', submittedDate: M(-19, 7), paidDate: M(-19, 18), deductibleApplied: 210, eligibleAmount: 210, reimbursed: 0, claimNumber: 'C-10021', notes: 'All toward deductible.' });
  visit(biscuit, { date: M(-17, 12), type: 'Wellness / check-up', reason: 'Annual exam and vaccines', diagnosis: 'Healthy', treatment: 'Rabies, DHPP, Lepto, Bordetella', cost: 310, weight: 69.0, notClaimable: true });
  const b3 = visit(biscuit, { date: M(-14, 3), type: 'Sick visit', reason: 'Limping on left hind leg', diagnosis: 'Soft-tissue strain, no fracture on X-ray', treatment: 'Carprofen 14 days, leash rest', cost: 640, weight: 69.8, followUpDate: M(-13, 3) });
  claim(biscuit, b3, { status: 'approved', submittedDate: M(-14, 4), paidDate: M(-14, 15), deductibleApplied: 40, eligibleAmount: 640, reimbursed: 480, claimNumber: 'C-10388' });
  visit(biscuit, { date: M(-13, 3), type: 'Follow-up', reason: 'Limp recheck', diagnosis: 'Resolved', cost: 0, notClaimable: true });
  const b4 = visit(biscuit, { date: M(-11, 21), type: 'Emergency', clinic: 'Riverside Veterinary Emergency', vet: 'Dr. Tom Okafor', reason: 'Vomiting, not eating — swallowed a sock', diagnosis: 'Intestinal foreign body', treatment: 'Exploratory surgery, sock removed; 2 nights in hospital', cost: 3850, weight: 70.6, followUpDate: M(-11, 28) });
  claim(biscuit, b4, { status: 'approved', submittedDate: M(-11, 24), paidDate: M(-10, 9), deductibleApplied: 0, eligibleAmount: 3850, reimbursed: 3080, claimNumber: 'C-11042' });
  const b5 = visit(biscuit, { date: M(-8, 9), type: 'Follow-up', reason: 'Incision check, staple removal', diagnosis: 'Healing well', cost: 95, weight: 69.2 });
  claim(biscuit, b5, { status: 'approved', submittedDate: M(-8, 10), paidDate: M(-8, 19), deductibleApplied: 95, eligibleAmount: 95, reimbursed: 0, claimNumber: 'C-11590' });
  visit(biscuit, { date: M(-5, 14), type: 'Wellness / check-up', reason: 'Annual exam', diagnosis: 'Healthy; slightly itchy paws', treatment: 'Lepto and Bordetella boosters', cost: 295, weight: 70.2, notClaimable: true });
  const b7 = visit(biscuit, { date: M(-3, 18), type: 'Sick visit', reason: 'Itching, licking paws, red belly', diagnosis: 'Atopic dermatitis', treatment: 'Started Apoquel; trial salmon diet for 8 weeks', cost: 180, weight: 71.0, followUpDate: D(12) });
  claim(biscuit, b7, { status: 'approved', submittedDate: M(-3, 19), paidDate: M(-3, 30), deductibleApplied: 155, eligibleAmount: 180, reimbursed: 20, claimNumber: 'C-12201' });
  visit(biscuit, { date: M(-2, 8), type: 'Sick visit', reason: 'Hot spot behind left ear', diagnosis: 'Acute moist dermatitis', treatment: 'Clipped and cleaned, topical spray', cost: 165, weight: 71.4 });
  const b9 = visit(biscuit, { date: M(-1, 6), type: 'Dental', reason: 'Dental cleaning under anesthesia', diagnosis: 'Mild tartar, no extractions', cost: 620, weight: 71.6 });
  claim(biscuit, b9, { status: 'denied', submittedDate: M(-1, 7), paidDate: M(-1, 20), reimbursed: 0, denialReason: 'Routine dental cleaning not covered', claimNumber: 'C-12730' });
  const b10 = visit(biscuit, { date: D(-10), type: 'Sick visit', reason: 'Vomited 3 times overnight', diagnosis: 'Acute gastritis, likely dietary', treatment: 'Cerenia injection, bland diet 3 days', cost: 240, weight: 71.2 });
  claim(biscuit, b10, { status: 'submitted', submittedDate: D(-9), claimNumber: 'C-13105' });
  visit(biscuit, { date: D(12), type: 'Follow-up', reason: 'Allergy recheck and diet review' });

  biscuit.meds.push(
    { id: id(), name: 'NexGard Plus', dose: '60.1–121 lb', form: 'Chewable', frequency: '1 chew monthly', purpose: 'Flea, tick and heartworm prevention', prescriber: 'Dr. Priya Raman', start: M(-17, 12), refillDue: D(5) },
    { id: id(), name: 'Apoquel', dose: '16 mg', form: 'Tablet', frequency: '1 tablet once a day with food', purpose: 'Itching (atopic dermatitis)', prescriber: 'Dr. Priya Raman', start: M(-3, 18), refillDue: D(20) },
    { id: id(), name: 'Cerenia', dose: '60 mg', form: 'Tablet', frequency: '1 tablet once a day, up to 5 days', purpose: 'Vomiting', prescriber: 'Dr. Priya Raman', start: D(-10), asNeeded: true },
    { id: id(), name: 'Carprofen', dose: '75 mg', form: 'Chewable', frequency: '1 tablet twice a day with food', purpose: 'Leg strain pain', prescriber: 'Dr. Priya Raman', start: M(-14, 3), end: addDays(M(-14, 3), 14), whyStopped: 'Course finished' },
    { id: id(), name: 'Gabapentin', dose: '300 mg', form: 'Capsule', frequency: '1 capsule every 12 hours', purpose: 'Post-surgery pain', prescriber: 'Dr. Tom Okafor', start: M(-11, 22), end: M(-11, 29), whyStopped: 'Course finished' });
  biscuit.vaccines.push(
    { id: id(), name: 'Rabies', dateGiven: M(-17, 12), nextDue: addMonths(M(-17, 12), 36), clinic: 'Maple Street Animal Hospital', lot: 'RB-22871' },
    { id: id(), name: 'DHPP', dateGiven: M(-17, 12), nextDue: addMonths(M(-17, 12), 36), clinic: 'Maple Street Animal Hospital', lot: 'DH-55102' },
    { id: id(), name: 'Leptospirosis', dateGiven: M(-17, 12), nextDue: M(-5, 12), clinic: 'Maple Street Animal Hospital' },
    { id: id(), name: 'Leptospirosis', dateGiven: M(-5, 14), nextDue: M(7, 14), clinic: 'Maple Street Animal Hospital', lot: 'LP-90134' },
    { id: id(), name: 'Bordetella', dateGiven: M(-17, 12), nextDue: M(-5, 12), clinic: 'Maple Street Animal Hospital' },
    { id: id(), name: 'Bordetella', dateGiven: M(-5, 14), nextDue: M(7, 14), clinic: 'Maple Street Animal Hospital', lot: 'BD-77420' },
    { id: id(), name: 'Canine influenza', dateGiven: M(-13, 2), nextDue: D(-20), clinic: 'Maple Street Animal Hospital', notes: 'Required by the boarding kennel' });
  [[-20, 68.1], [-18, 68.6], [-16, 69.3], [-12, 70.4], [-10, 68.9], [-7, 69.6], [-6, 70.0], [-4, 70.5]].forEach(([m, w]) => biscuit.weights.push({ id: id(), date: M(m, 15), weight: w, notes: m === -10 ? 'After surgery' : '' }));
  biscuit.visits.forEach((v) => { if (hasVal(v.weight)) biscuit.weights.push({ id: id(), date: v.date, weight: v.weight, notes: 'From vet visit' }); });
  biscuit.observations.push(
    { id: id(), date: M(-3, 10), category: 'Itching', severity: '2', note: 'Licking front paws a lot in the evening.' },
    { id: id(), date: M(-3, 15), category: 'Skin & coat', severity: '2', note: 'Red patch on belly.' },
    { id: id(), date: M(-2, 6), category: 'Itching', severity: '3', note: 'Scratching left ear until it bled; hot spot.' },
    { id: id(), date: M(-1, 25), category: 'Itching', severity: '1', note: 'Much better on Apoquel, occasional paw licking.' },
    { id: id(), date: D(-11), category: 'Vomiting', severity: '2', note: 'Vomited yellow foam twice before breakfast.' },
    { id: id(), date: D(-10), category: 'Appetite', severity: '2', note: 'Refused breakfast.' },
    { id: id(), date: D(-4), category: 'Energy', severity: '1', note: 'Back to normal on walks.' });
  biscuit.notes.push(
    { id: id(), date: M(-11, 23), title: 'Sock surgery', text: 'Keep laundry basket lidded. Riverside ER invoice saved in the insurance folder.' },
    { id: id(), date: M(-3, 18), title: 'Food trial', text: 'Switched to salmon and rice kibble for an 8-week elimination trial. No chicken treats.' });

  /* Mochi visits + claims */
  const m0 = visit(mochi, { date: M(-23, 9), type: 'Sick visit', reason: 'Sneezing, watery eyes', diagnosis: 'Upper respiratory infection', treatment: 'Doxycycline 10 days', cost: 180, weight: 9.1 });
  claims.push({ id: id(), petId: mochi.id, visitId: m0.id, policyId: old.id, serviceDate: m0.date, amountClaimed: 180, condition: 'Upper respiratory infection', status: 'approved', submittedDate: M(-23, 10), paidDate: M(-23, 24), deductibleApplied: 100, eligibleAmount: 180, reimbursed: 72, claimNumber: 'WS-3391' });
  visit(mochi, { date: M(-16, 20), type: 'Wellness / check-up', reason: 'Annual exam and vaccines', diagnosis: 'Healthy', treatment: 'FVRCP, rabies', cost: 190, weight: 9.6, notClaimable: true });
  const m2 = visit(mochi, { date: M(-9, 4), type: 'Sick visit', reason: 'Straining in litter box', diagnosis: 'Bacterial cystitis (UTI)', treatment: 'Urine culture; Clavamox 10 days; wet food', cost: 320, weight: 10.2, followUpDate: M(-8, 20) });
  claim(mochi, m2, { status: 'approved', submittedDate: M(-9, 5), paidDate: M(-9, 21), deductibleApplied: 250, eligibleAmount: 320, reimbursed: 56, claimNumber: 'C-11402' });
  visit(mochi, { date: M(-4, 22), type: 'Wellness / check-up', reason: 'Annual exam', diagnosis: 'Healthy; gaining a little weight', treatment: 'Cut dry food by a quarter', cost: 205, weight: 10.8, notClaimable: true });
  const m4 = visit(mochi, { date: D(-6), type: 'Sick visit', reason: 'Vomiting hairballs, eating less', diagnosis: 'Hairball-related gastritis', treatment: 'Laxatone gel, brushing daily', cost: 150, weight: 10.5 });
  claim(mochi, m4, { status: 'review', submittedDate: D(-5), claimNumber: 'C-13140' });
  mochi.meds.push(
    { id: id(), name: 'Revolution Plus', dose: '5.6–11 lb', form: 'Topical', frequency: '1 tube on the skin monthly', purpose: 'Flea, tick, heartworm and ear mite prevention', prescriber: 'Dr. Priya Raman', start: M(-16, 20), refillDue: M(1, 3) },
    { id: id(), name: 'Laxatone', dose: '', form: 'Other', frequency: '1 inch of gel 2–3 times a week', purpose: 'Hairballs', prescriber: 'Dr. Priya Raman', start: D(-6), asNeeded: true },
    { id: id(), name: 'Clavamox', dose: '62.5 mg', form: 'Tablet', frequency: '1 tablet twice a day', purpose: 'Urinary infection', prescriber: 'Dr. Priya Raman', start: M(-9, 4), end: addDays(M(-9, 4), 10), whyStopped: 'Course finished' },
    { id: id(), name: 'Doxycycline', dose: '25 mg', form: 'Liquid', frequency: '1 mL once a day', purpose: 'Upper respiratory infection', prescriber: 'Dr. Priya Raman', start: M(-23, 9), end: addDays(M(-23, 9), 10), whyStopped: 'Course finished' });
  mochi.vaccines.push(
    { id: id(), name: 'FVRCP', dateGiven: M(-16, 20), nextDue: addMonths(M(-16, 20), 36), clinic: 'Maple Street Animal Hospital', lot: 'FV-30984' },
    { id: id(), name: 'Rabies', dateGiven: M(-16, 20), nextDue: M(-4, 20), clinic: 'Maple Street Animal Hospital', notes: '1-year non-adjuvanted' },
    { id: id(), name: 'Rabies', dateGiven: addDays(T, -347), nextDue: D(18), clinic: 'Maple Street Animal Hospital', lot: 'PV-11873', notes: '1-year non-adjuvanted' });
  [[-22, 9.2], [-19, 9.4], [-14, 9.8], [-12, 9.9], [-7, 10.4], [-6, 10.5], [-2, 10.6]].forEach(([m, w]) => mochi.weights.push({ id: id(), date: M(m, 10), weight: w }));
  mochi.visits.forEach((v) => { if (hasVal(v.weight)) mochi.weights.push({ id: id(), date: v.date, weight: v.weight, notes: 'From vet visit' }); });
  mochi.observations.push(
    { id: id(), date: M(-9, 2), category: 'Urination', severity: '2', note: 'Going to the litter box often, small amounts.' },
    { id: id(), date: D(-14), category: 'Vomiting', severity: '1', note: 'Hairball in the hallway.' },
    { id: id(), date: D(-9), category: 'Vomiting', severity: '1', note: 'Hairball again after breakfast.' },
    { id: id(), date: D(-7), category: 'Vomiting', severity: '2', note: 'Vomited twice, left half her food.' },
    { id: id(), date: D(-7), category: 'Appetite', severity: '2', note: 'Ate about half her usual wet food.' },
    { id: id(), date: D(-2), category: 'Appetite', severity: '1', note: 'Eating normally again.' });
  mochi.notes.push({ id: id(), date: M(-26, 1), title: 'Adopted', text: 'Adopted from Lane County Animal Shelter. Birth date unknown; the shelter vet estimated her at about 18 months old.' });
  mochi.notes.push({ id: id(), date: M(-17, 1), title: 'Insurance switch', text: 'Added Mochi to Biscuit’s Paws & Claws plan (now a multi-pet plan) and cancelled Whisker Shield.' });

  return { pets: [biscuit, mochi], policies: [old, plan], premiumChanges, claims };
}

/* ---------------- view + plugin ---------------- */
class PetDashboardView extends ItemView {
  constructor(leaf, plugin) { super(leaf); this.plugin = plugin; this.tab = 'overview'; }
  getViewType() { return VIEW_TYPE; }
  getDisplayText() { return dashboardTitle(this.plugin.activePet()); }
  getIcon() { return 'paw-print'; }
  async onOpen() {
    clear(this.contentEl);
    this.ui = new DashboardUI(this.plugin, this.contentEl, { view: this, tab: this.tab });
    this.plugin.uis.add(this.ui); this.ui.render();
  }
  async onClose() { this.plugin.uis.delete(this.ui); Tip.hide(); }
  getState() { return { tab: this.ui ? this.ui.tab : this.tab }; }
  async setState(st, result) {
    if (st && st.tab) { this.tab = st.tab; if (this.ui) { this.ui.tab = st.tab; this.ui.render(); } }
    return super.setState ? super.setState(st, result) : undefined;
  }
  refreshTitle() {
    const t = this.getDisplayText();
    try { if (this.titleEl) this.titleEl.textContent = t; } catch (e) { }
    try { if (this.leaf.tabHeaderInnerTitleEl) this.leaf.tabHeaderInnerTitleEl.textContent = t; } catch (e) { }
    try { this.leaf.updateHeader && this.leaf.updateHeader(); } catch (e) { }
  }
}

class PetDashboardPlugin extends Plugin {
  async onload() {
    this.uis = new Set();
    this.data = normalizeData(await this.loadData());
    this.registerView(VIEW_TYPE, (leaf) => new PetDashboardView(leaf, this));
    this.addRibbonIcon('paw-print', 'Open pet dashboard', () => this.activate());
    this.addCommand({ id: 'open-dashboard', name: 'Open dashboard', callback: () => this.activate('overview') });
    this.addCommand({ id: 'open-insurance', name: 'Open insurance', callback: () => this.activate('insurance') });
    this.addCommand({ id: 'open-health', name: 'Open health', callback: () => this.activate('health') });
    this.addCommand({ id: 'pdf-health', name: 'Create health report PDF', callback: () => new ReportModal(this.app, this, this.activePet(), 'health').open() });
    this.addCommand({ id: 'pdf-insurance', name: 'Create insurance summary PDF', callback: () => new ReportModal(this.app, this, this.activePet(), 'insurance').open() });
    this.addCommand({ id: 'what-if', name: 'Insurance: What-if planner', callback: () => new WhatIfModal(this.app, this, this.activePet(), null).open() });
    this.addCommand({ id: 'add-visit', name: 'Add vet visit', callback: () => this.quick((ui) => ui.edit(ui.pet, 'visits', visitFields(this.data.settings), 'vet visit', null)) });
    this.addCommand({ id: 'add-observation', name: 'Add observation', callback: () => this.quick((ui) => ui.edit(ui.pet, 'observations', obsFields(), 'observation', null, null, { date: todayISO() })) });
    this.addCommand({ id: 'add-claim', name: 'Add insurance claim', callback: () => this.quick((ui) => ui.editClaim()) });
    this.registerMarkdownCodeBlockProcessor('pet-dashboard', (src, el) => {
      const opt = {}; String(src).split('\n').forEach((l) => { const m = /^\s*(\w+)\s*:\s*(.+?)\s*$/.exec(l); if (m) opt[m[1].toLowerCase()] = m[2]; });
      const ui = new DashboardUI(this, el, { tab: ['overview', 'insurance', 'health'].includes(opt.tab) ? opt.tab : 'overview', embedded: true });
      if (opt.pet) { const p = this.data.pets.find((x) => (x.name || '').toLowerCase() === opt.pet.toLowerCase()); if (p) ui.fixedPetId = p.id; }
      this.uis.add(ui); ui.render();
    });
    this.addSettingTab(new PetDashboardSettingTab(this.app, this));
  }
  onunload() { Tip.hide(); }
  activePet() { return this.data.pets.find((p) => p.id === this.data.activePetId) || this.data.pets.find((p) => !isArchived(p)) || this.data.pets[0]; }
  photoFile(pet) { return pet && pet.photo ? this.app.vault.getAbstractFileByPath(pet.photo) : null; }
  photoSrc(pet) {
    const f = this.photoFile(pet); if (!f) return null;
    try { return this.app.vault.getResourcePath(f); } catch (e) { return this.app.vault.adapter.getResourcePath(pet.photo); }
  }
  async photoDataUrl(pet) {
    const f = this.photoFile(pet); if (!f) return null;
    try {
      const buf = new Uint8Array(await this.app.vault.readBinary(f)); let bin = '';
      for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode.apply(null, buf.subarray(i, i + 0x8000));
      const ext = (f.extension || 'jpg').toLowerCase();
      return `data:image/${ext === 'jpg' ? 'jpeg' : ext};base64,` + btoa(bin);
    } catch (e) { return null; }
  }
  async savePhoto(pet, blob) {
    const folder = await ensureFolder(this, this.data.settings.photoFolder || 'Pet Dashboard/Photos');
    const safe = (petLabel(pet).replace(/[\\/:*?"<>|#^[\]]/g, '-') || 'pet') + '-' + uid().slice(-6);
    const file = await this.app.vault.createBinary(normalizePath(`${folder}/${safe}.jpg`), await blob.arrayBuffer());
    await this.removePhotoFile(pet);
    pet.photo = file.path; await this.saveAll();
  }
  async removePhotoFile(pet) {
    const f = this.photoFile(pet); if (!f) return;
    try { await this.app.vault.trash(f, true); } catch (e) { try { await this.app.vault.trash(f, false); } catch (e2) { console.error('Pet Dashboard: could not trash photo', e2); } }
  }
  quick(fn) { fn(new DashboardUI(this, document.createElement('div'))); }
  async saveAll() { await this.saveData(this.data); this.refreshAll(); }
  refreshAll() {
    for (const ui of [...this.uis]) {
      if (ui.embedded && !ui.root.isConnected) { this.uis.delete(ui); continue; }
      try { ui.render(); } catch (e) { console.error('Pet Dashboard render error', e); }
    }
  }
  async activate(tab) {
    const ws = this.app.workspace;
    let leaf = ws.getLeavesOfType(VIEW_TYPE)[0];
    if (!leaf) { leaf = ws.getLeaf('tab'); await leaf.setViewState({ type: VIEW_TYPE, active: true, state: { tab: tab || 'overview' } }); }
    else if (tab && leaf.view && leaf.view.ui) leaf.view.ui.setTab(tab);
    ws.revealLeaf(leaf);
  }
  loadSample() {
    confirmBox(this.app, 'Add two sample pets (Biscuit the dog and Mochi the cat) with a shared multi-pet insurance plan? Your existing records are kept; delete the samples from each pet’s profile when you are done.', async () => {
      const sd = sampleData(), d = this.data;
      const blank = d.pets.length === 1 && !d.pets[0].name && !d.pets[0].visits.length && !d.policies.length;
      d.pets = (blank ? [] : d.pets).concat(sd.pets);
      d.policies.push(...sd.policies); d.premiumChanges.push(...sd.premiumChanges); d.claims.push(...sd.claims);
      d.activePetId = sd.pets[0].id;
      await this.saveAll(); new Notice('Sample pets added.');
    }, 'Add sample pets');
  }
}

class PetDashboardSettingTab extends PluginSettingTab {
  constructor(app, plugin) { super(app, plugin); this.plugin = plugin; }
  display() {
    const { containerEl } = this, p = this.plugin, s = p.data.settings;
    clear(containerEl);
    containerEl.append(h('h2', { text: 'Pet Dashboard' }));
    containerEl.append(h('h3', { text: 'Dashboard names' }));
    p.data.pets.forEach((pet) => {
      new Setting(containerEl).setName(petLabel(pet)).setDesc(`Shown as “${dashboardTitle(pet)}”.`)
        .addDropdown((d) => d.addOption('default', 'Pet Dashboard').addOption('pet', pet.name ? `${pet.name} Dashboard` : '[pet’s name] Dashboard').addOption('custom', 'Custom')
          .setValue(pet.titleMode || 'default').onChange(async (v) => { pet.titleMode = v; await p.saveAll(); this.display(); }))
        .addText((t) => { t.setPlaceholder('Custom name').setValue(pet.customTitle || '').onChange(async (v) => { pet.customTitle = v; if (v) pet.titleMode = 'custom'; await p.saveAll(); }); })
        .addButton((b) => { b.setButtonText('Delete').onClick(() => { const m = new DeletePetModal(this.app, p, pet); const oc = m.onClose.bind(m); m.onClose = () => { oc(); setTimeout(() => this.display(), 50); }; m.open(); }); if (b.setWarning) b.setWarning(); if (b.setTooltip) b.setTooltip(`Delete ${petLabel(pet)} and all its records`); });
    });
    containerEl.append(h('h3', { text: 'Species' }));
    new Setting(containerEl).setName('Species list').setDesc('Suggestions offered when adding a pet, one per line. You can always type a species that is not listed; it is added to the suggestions automatically.')
      .addTextArea((t) => { t.setValue((s.speciesList || []).join('\n')).onChange(async (v) => { s.speciesList = v.split(/\n|,/).map((x) => x.trim()).filter(Boolean); await p.saveAll(); }); if (t.inputEl) t.inputEl.rows = 6; });
    containerEl.append(h('h3', { text: 'Pet photos' }));
    new Setting(containerEl).setName('Photo size').setDesc('How large pet photos appear next to the dashboard name and in the profile. Click a photo or the paw icon to add or change one.')
      .addDropdown((d) => d.addOption('small', 'Small').addOption('medium', 'Medium').addOption('large', 'Large').setValue(s.photoSize || 'medium').onChange(async (v) => { s.photoSize = v; await p.saveAll(); }));
    new Setting(containerEl).setName('Photo folder').setDesc('Vault folder where pet photos are saved.').addText((t) => t.setValue(s.photoFolder).onChange(async (v) => { s.photoFolder = v; await p.saveAll(); }));
    containerEl.append(h('h3', { text: 'Units and insurance' }));
    insuranceSettings(containerEl, p, { all: true });
    containerEl.append(h('h3', { text: 'PDF reports' }));
    new Setting(containerEl).setName('Owner name').setDesc('Printed on reports (optional).').addText((t) => t.setValue(s.ownerName).onChange(async (v) => { s.ownerName = v; await p.saveAll(); }));
    new Setting(containerEl).setName('Save to folder').setDesc('Vault folder for generated PDFs. Created if missing.').addText((t) => t.setValue(s.pdfFolder).onChange(async (v) => { s.pdfFolder = v; await p.saveAll(); }));
    new Setting(containerEl).setName('Page size').addDropdown((d) => d.addOption('Letter', 'Letter').addOption('A4', 'A4').setValue(s.pageSize).onChange(async (v) => { s.pageSize = v; await p.saveAll(); }));
    new Setting(containerEl).setName('Open PDF after creating').addToggle((t) => t.setValue(!!s.openAfterExport).onChange(async (v) => { s.openAfterExport = v; await p.saveAll(); }));
    containerEl.append(h('h3', { text: 'Data' }));
    new Setting(containerEl).setName('Sample pets').setDesc('Adds Biscuit (dog) and Mochi (cat) on a shared multi-pet plan so you can explore every feature.')
      .addButton((b) => b.setButtonText('Load sample pets').onClick(() => p.loadSample()));
    new Setting(containerEl).setName('Where your data lives').setDesc('Everything is stored in this vault, in .obsidian/plugins/pet-dashboard/data.json. Back it up with the rest of your vault.');
  }
}

module.exports = PetDashboardPlugin;
