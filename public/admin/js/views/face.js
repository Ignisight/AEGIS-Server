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

      body.innerHTML = data.list.map(s => {
        const driftColor = s.driftScore > 0.1 ? 'text-amber-400' : 'text-slate-400';
        const flaggedClass = s.flagged ? 'bg-rose-500/20 text-rose-400 border-rose-500/30' : 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20';
        const statusText = s.flagged ? '🚨 Flagged: ' + (s.flaggedReason || 'Suspicious Activity') : '✅ Verified';

        return `
          <tr class="hover:bg-white/[0.02] transition-colors">
            <td class="px-8 py-5">
              <div class="font-bold text-slate-200">${s.email}</div>
              <div class="flex items-center gap-4 mt-1">
                <span class="text-[10px] text-slate-600 font-mono">Drift: <span class="${driftColor}">${(s.driftScore || 0).toFixed(3)}</span></span>
                <span class="text-[10px] text-slate-600 font-mono">Updates: <span class="text-slate-400">${s.updateCount || 0}</span></span>
              </div>
            </td>
            <td class="px-8 py-5 text-slate-400 text-xs">
              ${s.faceRegisteredAt ? new Date(s.faceRegisteredAt).toLocaleString() : '—'}
            </td>
            <td class="px-8 py-5">
              ${s.faceEnabled 
                ? `<span class="px-3 py-1 rounded-full ${flaggedClass} text-[10px] font-bold border uppercase tracking-widest">${statusText}</span>`
                : '<span class="px-3 py-1 rounded-full bg-slate-500/10 text-slate-500 text-[10px] font-bold border border-white/5 uppercase tracking-widest">Not Set</span>'
              }
            </td>
            <td class="px-8 py-5 text-right space-x-2">
              ${s.faceEnabled 
                ? `
                   <button onclick="FaceView.restoreGolden('${s.email}')" class="text-indigo-400 hover:text-indigo-300 font-bold text-xs border border-indigo-500/20 px-4 py-2 rounded-xl hover:bg-indigo-500/5 transition">Restore Golden</button>
                   <button onclick="FaceView.unbind('${s.email}')" class="text-rose-400 hover:text-rose-300 font-bold text-xs border border-rose-500/20 px-4 py-2 rounded-xl hover:bg-rose-500/5 transition">Unbind Student</button>
                  `
                : `<button onclick="FaceView.unbind('${s.email}')" class="text-slate-400 hover:text-slate-300 font-bold text-xs border border-white/10 px-4 py-2 rounded-xl hover:bg-white/5 transition">Force Unbind</button>`
              }
            </td>
          </tr>
        `;
      }).join('');

    } catch (err) {
      body.innerHTML = `<tr><td colspan="4" class="px-8 py-20 text-center text-rose-400 font-bold">Error: ${err.message}</td></tr>`;
    }
  },

  async restoreGolden(email) {
    Confirm.show(
      'Restore Golden Template?',
      `This will revert the active face template for ${email} back to the original registration data. Use this if the student is having trouble with failed scans.`,
      async () => {
        try {
          const res = await API.post('/face/restore-golden', { email });
          if (res.success) {
            this.search();
            alert('Template successfully restored.');
          } else {
            alert('Failed: ' + res.error);
          }
        } catch (err) {
          alert('Error: ' + err.message);
        }
      }
    );
  },

  async unbind(email) {
    Confirm.show(
      'Perform Nuclear Unbind?',
      `CRITICAL: This will PERMANENTLY delete the student's hardware binding AND their biometric face records for ${email}. This allows them to register again on a different phone.`,
      async () => {
        try {
          const res = await API.post('/student/unbind', { email });
          if (res.success) {
            this.search();
            alert('Student successfully unbound. They can now register fresh.');
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
