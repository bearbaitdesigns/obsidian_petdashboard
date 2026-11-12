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

    // top bar
    const top = h('div', { class: 'pd-wi-top' });
    top.append(h('div', { class: 'pd-wi-sandbox' }, h('span', { class: 'pd-wi-sandbox-icon' }, icon('flask-conical')),
      h('span', { text: 'Sandbox — nothing here changes your pets’ records or insurance. Scenarios are saved so you can come back to them.' })));
    const acts = h('div', { class: 'pd-wi-top-actions' });
    const shared = sharedPolicies(data, this.pet);
    if (shared.length) {
      const v = h('select', { class: 'dropdown', 'aria-label': 'View' }, shared.map((p) => h('option', { value: p.id, text: `Whole plan: ${policyLabel(p)}` })), h('option', { value: 'pet', text: `${petLabel(this.pet)}’s share` }));
      v.value = this.base.ctx.kind === 'plan' ? this.base.ctx.policy.id : 'pet';
      v.addEventListener('change', () => { this.insScope = v.value; this.render(); });
      acts.append(h('label', { class: 'pd-wi-ctl' }, h('span', { text: 'View' }), v));
    }
    const hz = h('select', { class: 'dropdown', 'aria-label': 'Figures as of' }, WI_HORIZONS.map(([k, l]) => h('option', { value: k, text: l })));
    hz.value = st.horizon; hz.addEventListener('change', async () => { st.horizon = hz.value; await this.persist(); });
    acts.append(h('label', { class: 'pd-wi-ctl' }, h('span', { text: 'Figures as of' }), hz));
    acts.append(btn('Save as PDF', () => this.exportPDF(), { icon: 'file-down', cls: 'mod-cta' }));
    acts.append(btn('', () => new InsuranceHelpModal(this.app, this.plugin).open(), { icon: 'help-circle', cls: 'pd-icon-btn pd-wi-help', title: 'How pet insurance and these figures work' }));
    top.append(acts);
    c.append(top);
    c.append(h('div', { class: 'pd-wi-predict', role: 'note' }, icon('alert-triangle'), h('div', {}, h('strong', { text: 'Estimate, not a guarantee. ' }),
      'Results use your policy terms as recorded and simple claim maths (deductible, then the reimbursement rate, up to the limit). Your insurer makes the real decisions. Not financial advice.')));

    if (!this.base.pol) {
      c.append(h('div', { class: 'pd-welcome' }, h('h3', { text: 'Add a policy first' }), h('p', { text: `The planner tests changes against an insurance policy. Add ${petLabel(this.pet)}’s policy on the Insurance tab, then come back.` })));
      return;
    }
    const lay = h('div', { class: 'pd-wi-layout' }), side = h('div', { class: 'pd-wi-side' }), main = h('div', { class: 'pd-wi-main' });
    lay.append(side, main); c.append(lay);
    this.renderSide(side); this.renderMain(main);
    main.scrollTop = scroll;
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
