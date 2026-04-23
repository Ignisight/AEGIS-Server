const DepartmentsView = {
  async load() {
    const data = await API.departments();
    if (!data) return;
    State.data.departments = data.departments || [];
    this.render();
  },

  render() {
    const h = document.getElementById('tableHead');
    const b = document.getElementById('tableBody');
    const r = document.getElementById('tableActionRight');
    const l = document.getElementById('tableActionLeft');

    l.innerHTML = '';
    r.innerHTML = `<button onclick="Modal.open('dept')" class="bg-indigo-600 px-6 py-2.5 rounded-xl font-bold text-xs">Provision Dept</button>`;
    
    h.innerHTML = '<th class="px-8 py-5 w-32">Index</th><th class="px-8 py-5">Designation</th><th class="px-8 py-5 text-right">Control</th>';
    b.innerHTML = State.data.departments.map(d => `
      <tr>
        <td class="px-8 py-6 font-black text-indigo-400 text-xs">${sanitize(d.deptId)}</td>
        <td class="px-8 py-6 font-bold">${sanitize(d.name)}</td>
        <td class="px-8 py-6 text-right"><button onclick="DepartmentsView.delete('${d.deptId}')" class="text-rose-400 font-bold text-xs opacity-40 hover:opacity-100">DELETE</button></td>
      </tr>`).join('');
  },

  async add() {
    const deptId = document.getElementById('d-id').value.trim();
    const name = document.getElementById('d-name').value.trim();
    const m = document.getElementById('d-msg');
    
    const d = await API.addDept(deptId, name);
    if (d.success) {
      Modal.close('dept');
      this.load();
    } else {
      m.textContent = d.error;
      m.className = 'text-rose-400';
    }
  },

  async delete(id) {
    Confirm.ask('Destroy Department?', 'This will permanently remove the department and all its children.', async () => {
      await API.deleteDept(id);
      this.load();
    });
  }
};
