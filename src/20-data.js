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
