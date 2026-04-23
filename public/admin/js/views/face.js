const FaceView = {
  init() {
    this.search();
  },

  onSearchChange(e) {
    if (e.key === 'Enter') this.search();
  },

  async search() {
    const q = document.getElementById('face-search-input').value;
    const body = document.getElementById('faceTableBody');
    
    if (!q || q.length < 2) {
      body.innerHTML = '<tr><td colspan="4" class="px-8 py-20 text-center text-slate-500 font-bold">Search for a student to manage their face record</td></tr>';
      return;
    }

    body.innerHTML = '<tr><td colspan="4" class="px-8 py-20 text-center text-slate-500 font-bold animate-pulse">Searching global registry...</td></tr>';

    try {
      const data = await API.get(`/face/search?q=${encodeURIComponent(q)}`);
      if (!data.success) throw new Error(data.error);

      if (data.list.length === 0) {
        body.innerHTML = '<tr><td colspan="4" class="px-8 py-20 text-center text-slate-500 font-bold">No students found matching your query.</td></tr>';
        return;
      }

      body.innerHTML = data.list.map(s => `
        <tr class="hover:bg-white/[0.02] transition-colors">
          <td class="px-8 py-5">
            <div class="font-bold text-slate-200">${s.email}</div>
            <div class="text-[10px] text-slate-500 font-mono mt-1">${s.deviceId}</div>
          </td>
          <td class="px-8 py-5 text-slate-400 text-xs">
            ${s.faceRegisteredAt ? new Date(s.faceRegisteredAt).toLocaleString() : '—'}
          </td>
          <td class="px-8 py-5">
            ${s.faceEnabled 
              ? '<span class="px-3 py-1 rounded-full bg-emerald-500/10 text-emerald-400 text-[10px] font-bold border border-emerald-500/20 uppercase tracking-widest">✅ Verified</span>'
              : '<span class="px-3 py-1 rounded-full bg-slate-500/10 text-slate-500 text-[10px] font-bold border border-white/5 uppercase tracking-widest">Not Set</span>'
            }
          </td>
          <td class="px-8 py-5 text-right">
            ${s.faceEnabled 
              ? `<button onclick="FaceView.resetFace('${s.email}')" class="text-rose-400 hover:text-rose-300 font-bold text-xs border border-rose-500/20 px-4 py-2 rounded-xl hover:bg-rose-500/5 transition">Reset Face</button>`
              : '<span class="text-slate-700 text-xs italic">No record</span>'
            }
          </td>
        </tr>
      `).join('');

    } catch (err) {
      body.innerHTML = `<tr><td colspan="4" class="px-8 py-20 text-center text-rose-400 font-bold">Error: ${err.message}</td></tr>`;
    }
  },

  async resetFace(email) {
    Confirm.show(
      'Reset Face Registration?',
      `This will permanently delete the face record for ${email}. The student will be prompted to re-register their face the next time they scan a QR code.`,
      async () => {
        try {
          const res = await API.delete(`/face/reset/${encodeURIComponent(email)}`);
          if (res.success) {
            this.search();
            alert('Face record successfully cleared.');
          } else {
            alert('Failed: ' + res.error);
          }
        } catch (err) {
          alert('Error: ' + err.message);
        }
      }
    );
  }
};
