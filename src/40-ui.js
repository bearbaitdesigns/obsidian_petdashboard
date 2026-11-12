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
