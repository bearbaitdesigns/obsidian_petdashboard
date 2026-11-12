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
