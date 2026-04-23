const TeachersView = {
  async load() {
    const data = await API.data();
    if (!data) return;
    State.data.teachers = data.approvedTeachers || [];
    this.render();
  },

  render() {
    const h = document.getElementById('tableHead');
    const b = document.getElementById('tableBody');
    const r = document.getElementById('tableActionRight');
    const l = document.getElementById('tableActionLeft');

    l.innerHTML = '';
    r.innerHTML = `<button onclick="TeachersView.openAdd()" class="bg-indigo-600 px-6 py-2.5 rounded-xl font-bold text-xs">Provision New Teacher</button>`;
    
    h.innerHTML = '<th class="px-8 py-5">Full Nomenclature</th><th class="px-8 py-5">Verified Email</th><th class="px-8 py-5 text-right">Operation</th>';
    b.innerHTML = State.data.teachers.map(a => `
      <tr class="hover:bg-white/[0.02]">
        <td class="px-8 py-6 font-bold text-slate-200">${sanitize(a.name)}</td>
        <td class="px-8 py-6 text-slate-400">${sanitize(a.email)}</td>
        <td class="px-8 py-6 text-right"><button onclick="TeachersView.revoke('${a.email}')" class="text-rose-500/50 hover:text-rose-400 font-bold text-xs uppercase tracking-tighter">Revoke Access</button></td>
      </tr>`).join('');
  },

  openAdd() {
    document.getElementById('t-name').value = '';
    document.getElementById('t-email').value = '';
    Modal.open('teacher');
  },

  async confirmAdd() {
    const name = document.getElementById('t-name').value.trim();
    const email = document.getElementById('t-email').value.trim();
    if (!name || !email) return;
    await API.addTeacher(name, email);
    Modal.close('teacher');
    this.load();
  },

  async revoke(email) {
    Confirm.ask('Revoke Faculty?', 'This teacher will no longer be able to log in or start sessions.', async () => {
      await API.deleteTeacher(email);
      this.load();
    });
  }
};
