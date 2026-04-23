const EmailLogsView = {
  async load() {
    const data = await API.emailLogs();
    if (!data) return;
    State.data.emailLogs = data.logs || [];
    this.render();
  },

  render() {
    const h = document.getElementById('tableHead');
    const b = document.getElementById('tableBody');
    const r = document.getElementById('tableActionRight');
    const l = document.getElementById('tableActionLeft');

    h.innerHTML = '<th class="px-8 py-5">Recipient</th><th class="px-8 py-5">Subject</th><th class="px-8 py-5">Status</th><th class="px-8 py-5 text-right">Timestamp</th>';
    r.innerHTML = '';
    l.innerHTML = '<span class="text-[10px] font-black text-slate-500 uppercase">Communication Audit Trail</span>';
    
    b.innerHTML = State.data.emailLogs.map(log => `
      <tr class="hover:bg-white/[0.02]">
        <td class="px-8 py-6 font-bold text-slate-200">${sanitize(log.to)}</td>
        <td class="px-8 py-6 text-slate-400 text-xs">${sanitize(log.subject)}</td>
        <td class="px-8 py-6">
          <span class="px-2 py-1 rounded-lg text-[9px] font-black uppercase ${log.status === 'success' ? 'bg-emerald-500/10 text-emerald-400' : 'bg-rose-500/10 text-rose-400'}">
            ${log.status} ${log.error ? ` - ${sanitize(log.error)}` : ''}
          </span>
        </td>
        <td class="px-8 py-6 text-right font-mono text-[10px] text-slate-500">${new Date(log.sentAt).toLocaleString()}</td>
      </tr>`).join('');
  }
};
