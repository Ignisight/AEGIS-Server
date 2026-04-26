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
      const data = await API.get(`face/search?q=${encodeURIComponent(q)}`);
      if (!data) throw new Error('Network timeout or AI service unavailable.');
      if (!data.success) throw new Error(data.error || 'Unknown server error');

      if (data.list.length === 0) {
        body.innerHTML = '<tr><td colspan="4" class="px-8 py-20 text-center text-slate-500 font-bold">No students found matching your query.</td></tr>';
        return;
      }

      body.innerHTML = data.list.map(s => {
        const driftColor = s.driftScore > 0.1 ? 'text-amber-400' : 'text-slate-400';
        const isFlagged = s.flagged;
        const flaggedClass = isFlagged ? 'bg-rose-500/20 text-rose-400 border-rose-500/30' : 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20';
        
        // Advanced security labeling
        let statusTag = '';
        if (s.faceEnabled) {
          statusTag = `<span class="px-3 py-1 rounded-full ${flaggedClass} text-[10px] font-bold border uppercase tracking-widest">${isFlagged ? '🚨 FLAG ALERT' : '✅ VERIFIED'}</span>`;
        } else {
          statusTag = '<span class="px-3 py-1 rounded-full bg-slate-500/10 text-slate-500 text-[10px] font-bold border border-white/5 uppercase tracking-widest">Not Enrolled</span>';
        }

        return `
          <tr class="hover:bg-white/[0.02] transition-colors">
            <td class="px-8 py-5">
              <div class="font-bold text-slate-200">${s.email}</div>
              <div class="flex items-center gap-4 mt-1">
                <span class="text-[10px] text-slate-600 font-mono">Drift: <span class="${driftColor}">${(s.driftScore || 0).toFixed(3)}</span></span>
                <span class="text-[10px] text-slate-600 font-mono">Updates: <span class="text-slate-400">${s.updateCount || 0}</span></span>
              </div>
            </td>
            <td class="px-8 py-5">
              <div class="text-slate-400 text-xs">${s.faceRegisteredAt ? new Date(s.faceRegisteredAt).toLocaleDateString() : '—'}</div>
              <div class="text-[10px] text-slate-600">${s.faceRegisteredAt ? new Date(s.faceRegisteredAt).toLocaleTimeString() : ''}</div>
            </td>
            <td class="px-8 py-5">
              <div class="flex flex-col gap-2">
                ${statusTag}
                ${isFlagged ? `<div class="text-[9px] font-bold text-rose-400/80 italic leading-tight max-w-[150px]">${s.flaggedReason || 'Suspicious Activity'}</div>` : ''}
              </div>
            </td>
            <td class="px-8 py-5 text-right space-x-2">
              ${s.faceEnabled 
                ? `
                   <button onclick="FaceView.restoreGolden('${s.email}')" class="text-indigo-400 hover:text-indigo-300 font-bold text-[10px] border border-indigo-500/20 px-3 py-1.5 rounded-xl hover:bg-indigo-500/5 transition">Reset Template</button>
                   <button onclick="FaceView.unbind('${s.email}')" class="text-rose-400 hover:text-rose-300 font-bold text-[10px] border border-rose-500/20 px-3 py-1.5 rounded-xl hover:bg-rose-500/5 transition">Nuclear Unbind</button>
                  `
                : `<button onclick="FaceView.unbind('${s.email}')" class="text-slate-400 hover:text-slate-300 font-bold text-[10px] border border-white/10 px-3 py-1.5 rounded-xl hover:bg-white/5 transition">Force Unbind</button>`
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
          const res = await API.post('face/restore-golden', { email });
          if (res && res.success) {
            this.search();
            alert('Template successfully restored.');
          } else {
            alert('Failed: ' + (res ? res.error : 'Service timeout. Try again.'));
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
          const res = await API.post('student/unbind', { email });
          if (res && res.success) {
            this.search();
            alert('Student successfully unbound. They can now register fresh.');
          } else {
            alert('Failed: ' + (res ? res.error : 'Service timeout. Try again.'));
          }
        } catch (err) {
          alert('Error: ' + err.message);
        }
      }
    );
  }
};
