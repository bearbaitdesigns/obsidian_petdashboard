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
    if (se.points.length <= 40) se.points.forEach((p) => { s += `<circle cx="${X(p.x).toFixed(1)}" cy="${Y(p.y).toFixed(1)}" r="2.6" fill="${se.color}">${o.hover ? '' : `<title>${esc(p.title || f(p.y))}</title>`}</circle>`; });
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
