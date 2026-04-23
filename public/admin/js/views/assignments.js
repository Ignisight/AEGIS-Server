const AssignmentsView = {
  async load() {
    const data = await API.assignments();
    if (!data) return;
    State.data.assignments = data.assignments || [];
    this.render();
  },

  render() {
    const h = document.getElementById('tableHead');
    const b = document.getElementById('tableBody');
    const r = document.getElementById('tableActionRight');
    const l = document.getElementById('tableActionLeft');

    h.innerHTML = '<th class="px-8 py-5">Professor</th><th class="px-8 py-5">Assigned Subject</th><th class="px-8 py-5 text-right">Management</th>';
    r.innerHTML = `<button onclick="AssignmentsView.openAdd()" class="bg-indigo-600 px-6 py-2.5 rounded-xl font-bold text-xs">Create Association</button>`;
    l.innerHTML = `<span class="text-[10px] font-black text-slate-500">Teacher ↔️ Subject Bridge Active</span>`;
    
    b.innerHTML = State.data.assignments.map(a => `
      <tr>
        <td class="px-8 py-6"><div class="font-bold">${sanitize(a.teacherName)}</div><div class="text-[9px] text-slate-500 font-bold">${sanitize(a.teacherEmail)}</div></td>
        <td class="px-8 py-6"><div class="font-bold text-indigo-400">${sanitize(a.courseId)}</div><div class="text-[9px] text-slate-400 uppercase font-black tracking-widest">${sanitize(a.courseName)}</div></td>
        <td class="px-8 py-6 text-right"><button onclick="AssignmentsView.delete('${a._id}')" class="text-rose-500 font-bold text-xs uppercase opacity-40 hover:opacity-100 italic">Destroy Link</button></td>
      </tr>`).join('');
  },

  async openAdd() {
    const [tData, cData] = await Promise.all([API.data(), API.courses()]);
    if (!tData || !cData) return;

    const ts = document.getElementById('a-teacher');
    const cs = document.getElementById('a-course');
    
    ts.innerHTML = '<option value="">Select Faculty</option>' + (tData.approvedTeachers || []).map(t => `<option value="${t.email}">${t.name}</option>`).join('');
    cs.innerHTML = '<option value="">Select Subject</option>' + (cData.courses || []).map(c => `<option value="${c.courseId}">${c.courseId} - ${c.name}</option>`).join('');
    
    document.getElementById('a-msg').textContent = '';
    Modal.open('assignment');
  },

  async confirmAdd() {
    const teacherEmail = document.getElementById('a-teacher').value;
    const courseId = document.getElementById('a-course').value;
    const msg = document.getElementById('a-msg');
    
    if (!teacherEmail || !courseId) return;
    
    const d = await API.addAssignment(teacherEmail, courseId);
    if (d.success) {
      Modal.close('assignment');
      this.load();
    } else {
      msg.textContent = d.error;
      msg.className = 'text-rose-400';
    }
  },

  async delete(id) {
    Confirm.ask('Destroy Linkage?', 'This will decouple the teacher from this subject.', async () => {
      await API.deleteAssignment(id);
      this.load();
    });
  }
};
