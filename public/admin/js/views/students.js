const StudentsView = {
  async load() {
    const data = await API.data();
    if (!data) return;
    
    State.data.students = (data.students || []).map(s => {
      const parts = s.email.split('@');
      const local = parts[0];
      const match = local.match(/^(\d{4})(ug|pg)([a-z]+)(\d+)$/i);
      return {
        ...s,
        domain: parts[1] || '?',
        year: match?.[1] || '-',
        program: match?.[2]?.toUpperCase() || '-',
        branch: match?.[3]?.toUpperCase() || '-'
      };
    });
    
    this.setupFilters();
    this.applyFilters();
  },

  setupFilters() {
    const l = document.getElementById('tableActionLeft');
    const r = document.getElementById('tableActionRight');

    l.innerHTML = `
      <span class="text-[10px] font-black text-indigo-500 uppercase px-2">Scope Filters:</span>
      <select id="f-year" onchange="StudentsView.applyFilters()" class="bg-white/5 border border-white/10 rounded-lg px-2 py-1 text-[10px] font-bold outline-none"><option value="">Year</option></select>
      <select id="f-branch" onchange="StudentsView.applyFilters()" class="bg-white/5 border border-white/10 rounded-lg px-2 py-1 text-[10px] font-bold outline-none"><option value="">Branch</option></select>
    `;
    
    r.innerHTML = `<button onclick="StudentsView.massDelete()" id="massBtn" class="text-rose-400 font-bold text-xs bg-rose-500/5 border border-rose-500/10 px-4 py-2 rounded-xl">Wipe Matched Hardware</button>`;

    const y = document.getElementById('f-year');
    const b = document.getElementById('f-branch');
    y.innerHTML = '<option value="">Year</option>' + [...new Set(State.data.students.map(s => s.year))].sort().map(v => `<option value="${v}">${v}</option>`).join('');
    b.innerHTML = '<option value="">Branch</option>' + [...new Set(State.data.students.map(s => s.branch))].sort().map(v => `<option value="${v}">${v}</option>`).join('');
  },

  applyFilters() {
    const yr = document.getElementById('f-year').value;
    const br = document.getElementById('f-branch').value;
    
    State.ui.renderedStudents = State.data.students.filter(s => (!yr || s.year === yr) && (!br || s.branch === br));
    document.getElementById('massBtn').textContent = `Wipe ${State.ui.renderedStudents.length} Nodes`;
    
    const h = document.getElementById('tableHead');
    const b = document.getElementById('tableBody');
    
    h.innerHTML = '<th class="px-8 py-5">Student Identity</th><th class="px-8 py-5">Metadata Block</th><th class="px-8 py-5 text-right">HW Link</th>';
    b.innerHTML = State.ui.renderedStudents.map(s => `
      <tr class="hover:bg-white/[0.01]">
        <td class="px-8 py-6">
          <div class="font-bold text-slate-200">${sanitize(s.email)}</div>
          <div class="text-[9px] text-slate-600 font-bold uppercase">${sanitize(s.domain)}</div>
        </td>
        <td class="px-8 py-6"><span class="px-2 py-1 bg-white/5 rounded-lg text-[9px] font-black">${s.year} • ${s.program} • ${s.branch}</span></td>
        <td class="px-8 py-6 text-right font-mono text-[9px] text-slate-500">${s.deviceId.substring(0, 24)}... <button onclick="StudentsView.delete('${s.email}')" class="ml-4 text-rose-500 font-bold">🗑️</button></td>
      </tr>`).join('');
  },

  async delete(email) {
    Confirm.ask('Sever Link?', "This will reset the student's device binding.", async () => {
      await API.deleteStudent(email);
      this.load();
    });
  },

  async massDelete() {
    if (!State.ui.renderedStudents.length) return;
    Confirm.ask('Wipe Bindings?', `Permanently wipe hardware bindings for ${State.ui.renderedStudents.length} matched students? This CANNOT be undone.`, async () => {
      for (const s of State.ui.renderedStudents) {
        await API.deleteStudent(s.email);
      }
      this.load();
    });
  }
};
