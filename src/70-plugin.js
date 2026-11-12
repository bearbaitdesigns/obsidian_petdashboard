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
        .addText((t) => { t.setPlaceholder('Custom name').setValue(pet.customTitle || '').onChange(async (v) => { pet.customTitle = v; if (v) pet.titleMode = 'custom'; await p.saveAll(); }); });
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
