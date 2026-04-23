const CoursesView = {
  async load() {
    const [dData, cData] = await Promise.all([API.departments(), API.courses()]);
    if (!dData || !cData) return;
    
    State.data.departments = dData.departments || [];
    State.data.courses = cData.courses || [];
    
    this.setupUI();
    this.render();
  },

  setupUI() {
    const dd = document.getElementById('c-dept');
    dd.innerHTML = '<option value="">Target Domain</option>' + State.data.departments.map(d => `<option value="${d.deptId}">${d.name}</option>`).join('');
    
    const r = document.getElementById('tableActionRight');
    const l = document.getElementById('tableActionLeft');
    
    l.innerHTML = `<select id="f-course-dept" onchange="CoursesView.render()" class="bg-white/5 border border-white/10 rounded-lg px-3 py-1.5 text-[10px] font-black outline-none text-indigo-400 uppercase tracking-widest"><option value="">All Departments</option>${State.data.departments.map(d => `<option value="${d.deptId}">${d.deptId}</option>`).join('')}</select>`;
    r.innerHTML = `<button onclick="CoursesView.openAdd()" class="bg-indigo-600 px-6 py-2.5 rounded-xl font-bold text-xs">New Subject</button>`;
  },

  render() {
    const dept = document.getElementById('f-course-dept')?.value;
    const filtered = State.data.courses.filter(c => !dept || c.department === dept);
    
    const h = document.getElementById('tableHead');
    const b = document.getElementById('tableBody');
    
    h.innerHTML = '<th class="px-8 py-5">DEPT</th><th class="px-8 py-5">Subject ID</th><th class="px-8 py-5">Name</th><th class="px-8 py-5">SEM</th><th class="px-8 py-5 text-right">Actions</th>';
    b.innerHTML = filtered.map(c => `
      <tr>
        <td class="px-8 py-6"><span class="px-2 py-1 bg-indigo-500/10 text-indigo-400 rounded-lg text-[9px] font-black">${sanitize(c.department || 'N/A')}</span></td>
        <td class="px-8 py-6 font-black text-xs text-slate-400">${sanitize(c.courseId)}</td>
        <td class="px-8 py-6 font-bold text-slate-200">${sanitize(c.name)}</td>
        <td class="px-8 py-6 text-xs font-bold text-slate-500">TERM ${c.semester || '?'}</td>
        <td class="px-8 py-6 text-right space-x-4">
          <button onclick="CoursesView.openEdit('${c.courseId}')" class="text-indigo-400 font-bold text-xs hover:underline">EDIT</button>
          <button onclick="CoursesView.delete('${c.courseId}')" class="text-rose-500/30 hover:text-rose-500 font-bold text-xs uppercase">Unlink</button>
        </td>
      </tr>`).join('');
  },

  openAdd() {
    document.getElementById('course-modal-title').textContent = 'Catalog Subject';
    document.getElementById('course-modal-btn').textContent = 'Append to Catalog';
    document.getElementById('course-modal-btn').onclick = () => this.add();
    document.getElementById('c-id').value = '';
    document.getElementById('c-id').disabled = false;
    document.getElementById('c-name').value = '';
    document.getElementById('c-sem').value = '';
    document.getElementById('c-dept').value = '';
    document.getElementById('c-msg').textContent = '';
    Modal.open('course');
  },

  async add() {
    const courseId = document.getElementById('c-id').value;
    const name = document.getElementById('c-name').value;
    const semester = document.getElementById('c-sem').value;
    const department = document.getElementById('c-dept').value;
    const m = document.getElementById('c-msg');

    const d = await API.addCourse({ courseId, name, semester, department });
    if (d.success) {
      Modal.close('course');
      this.load();
    } else {
      m.textContent = d.error;
      m.className = 'text-rose-400';
    }
  },

  openEdit(id) {
    const c = State.data.courses.find(x => x.courseId === id);
    if (!c) return;
    document.getElementById('course-modal-title').textContent = 'Edit Subject';
    document.getElementById('course-modal-btn').textContent = 'Save Changes';
    document.getElementById('course-modal-btn').onclick = () => this.confirmEdit(id);
    document.getElementById('c-id').value = c.courseId;
    document.getElementById('c-id').disabled = true;
    document.getElementById('c-name').value = c.name;
    document.getElementById('c-sem').value = c.semester || '';
    document.getElementById('c-dept').value = c.department || '';
    document.getElementById('c-msg').textContent = '';
    Modal.open('course');
  },

  async confirmEdit(id) {
    const name = document.getElementById('c-name').value;
    const semester = document.getElementById('c-sem').value;
    const department = document.getElementById('c-dept').value;
    const m = document.getElementById('c-msg');

    const d = await API.updateCourse(id, { name, semester, department });
    if (d.success) {
      Modal.close('course');
      this.load();
    } else {
      m.textContent = d.error;
      m.className = 'text-rose-400';
    }
  },

  async delete(id) {
    Confirm.ask('Destroy Subject?', 'This will remove the course from the catalog.', async () => {
      await API.deleteCourse(id);
      this.load();
    });
  }
};
