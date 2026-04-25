const MonitoringView = {
  async load() {
    await Promise.all([this.fetchStats(), this.fetchReport(), this.fetchNetworkSettings()]);
  },

  async fetchNetworkSettings() {
    const data = await API.fetchSettings();
    if (!data || !data.success || !data.settings) return;
    
    document.getElementById('campus-ip-input').value = data.settings.campus_public_ips || '';
    document.getElementById('campus-wifi-input').value = data.settings.campus_wifi_ssid || '';
  },

  async saveNetworkSettings() {
    const ips = document.getElementById('campus-ip-input').value;
    const ssid = document.getElementById('campus-wifi-input').value;
    
    const d = await API.saveSettings({
      campus_public_ips: ips,
      campus_wifi_ssid: ssid
    });
    
    if (d.success) {
      alert('Network Security updated successfully!');
      this.fetchNetworkSettings();
    } else {
      alert('Error saving network settings: ' + d.error);
    }
  },

  async fetchStats() {
    const data = await API.stats();
    if (!data) return;
    
    document.getElementById('stat-teachers').textContent = data.counts.teachers;
    document.getElementById('stat-sessions').textContent = data.counts.sessions;
    document.getElementById('stat-attendance').textContent = data.counts.attendance;
    document.getElementById('stat-devices').textContent = data.counts.devices;
    document.getElementById('health-latency').textContent = data.performance.dbLatency + 'ms';
    document.getElementById('health-uptime').textContent = this.formatUptime(data.performance.uptime);
    document.getElementById('health-memory').textContent = data.performance.memoryUsage + 'MB';
    
    this.updateCharts(data.distribution);
  },

  formatUptime(sec) {
    const h = Math.floor(sec / 3600);
    const m = Math.floor((sec % 3600) / 60);
    return (h > 0 ? h + 'h ' : '') + m + 'm';
  },

  updateCharts(dist) {
    const chartStyles = { 
      plugins: { 
        legend: { 
          position: 'bottom', 
          labels: { color: '#64748b', font: { family: 'Outfit', weight: 'bold', size: 10 } } 
        } 
      } 
    };

    if (State.ui.charts.branch) State.ui.charts.branch.destroy();
    State.ui.charts.branch = new Chart(document.getElementById('branchChart'), {
      type: 'doughnut',
      data: { 
        labels: Object.keys(dist.branches), 
        datasets: [{ 
          data: Object.values(dist.branches), 
          backgroundColor: ['#6366f1', '#a855f7', '#ec4899', '#f43f5e', '#f59e0b', '#10b981'], 
          borderWidth: 0, 
          hoverOffset: 15 
        }] 
      },
      options: { ...chartStyles, cutout: '80%', maintainAspectRatio: false }
    });

    if (State.ui.charts.hourly) State.ui.charts.hourly.destroy();
    State.ui.charts.hourly = new Chart(document.getElementById('hourlyChart'), {
      type: 'bar',
      data: { 
        labels: Array.from({length: 24}, (_, i) => i + ':00'), 
        datasets: [{ 
          label: 'Signals', 
          data: dist.hourly, 
          backgroundColor: 'rgba(99, 102, 241, 0.4)', 
          borderRadius: 6, 
          hoverBackgroundColor: '#6366f1' 
        }] 
      },
      options: { ...chartStyles, maintainAspectRatio: false, scales: { y: { grid: { color: 'rgba(255,255,255,0.03)' }, ticks: { color: '#475569', font:{size:10} } }, x: { grid: { display: false }, ticks: { color: '#475569', font:{size:10} } } } }
    });
  },

  async fetchReport() {
    const strip = document.getElementById('att-summary-strip');
    const panel = document.getElementById('att-defaulters-panel');
    
    strip.innerHTML = '<div class="text-center text-slate-600 py-6 col-span-4 text-sm">Calculating...</div>';
    panel.innerHTML = '<div class="text-center text-slate-600 py-6 text-sm">Calculating...</div>';

    const data = await API.attendanceReport();
    if (!data) return;

    if (data.threshold !== undefined) {
      document.getElementById('att-threshold-input').value = data.threshold;
    }
    
    State.data.lastAttReport = data.report;
    this.renderReport(data.report);
  },

  async saveThreshold() {
    const val = parseInt(document.getElementById('att-threshold-input').value);
    if (isNaN(val) || val < 1 || val > 100) { alert('Enter a number between 1 and 100'); return; }
    
    const d = await API.saveThreshold(val);
    if (d.success) this.fetchReport();
    else alert('Error saving: ' + d.error);
  },

  renderReport(report) {
    const strip = document.getElementById('att-summary-strip');
    const panel = document.getElementById('att-defaulters-panel');
    const badge = document.getElementById('att-total-defaulters');

    if (!report.length) {
      strip.innerHTML = '<div class="col-span-4 text-center text-slate-600 py-6 text-sm">No courses with completed sessions yet. Sessions must be named like "CS301 - Lecture 1" for tracking.</div>';
      panel.innerHTML = '<div class="text-center text-slate-600 py-6 text-sm">Nothing to report.</div>';
      badge.textContent = '0 at risk';
      return;
    }

    const totalDefaulters = report.reduce((s, c) => s + c.defaulterCount, 0);
    badge.textContent = totalDefaulters + ' at risk';
    
    const badgeEl = document.getElementById('att-total-defaulters-badge');
    if (totalDefaulters > 0) {
      badgeEl.textContent = totalDefaulters;
      badgeEl.classList.remove('hidden');
    } else {
      badgeEl.classList.add('hidden');
    }

    strip.innerHTML = report.map(c => {
      const pct = c.avgAttendance;
      const color = pct >= 75 ? 'text-emerald-400' : 'text-rose-400';
      const bg = c.defaulterCount > 0 ? 'border border-rose-500/20' : 'border border-white/5';
      return `
        <div class="glass-card ${bg} rounded-2xl p-5 flex flex-col gap-2 cursor-pointer hover:scale-[1.02] transition-transform" onclick="MonitoringView.scrollToCourse('${c.courseId}')">
          <span class="text-[10px] font-bold text-slate-500 uppercase tracking-widest">${sanitize(c.courseId)}</span>
          <span class="${color} text-3xl font-black">${pct}%</span>
          <div class="text-[11px] text-slate-500">${sanitize(c.courseName)}</div>
          <div class="flex gap-2 mt-1">
            <span class="text-[10px] font-bold bg-white/5 px-2 py-0.5 rounded-full">${c.totalSessions} sessions</span>
            ${c.defaulterCount > 0 ? `<span class="text-[10px] font-bold bg-rose-500/10 text-rose-400 px-2 py-0.5 rounded-full">${c.defaulterCount} defaulters</span>` : `<span class="text-[10px] font-bold bg-emerald-500/10 text-emerald-400 px-2 py-0.5 rounded-full">All passing</span>`}
          </div>
        </div>`;
    }).join('');

    const coursesWithDefaulters = report.filter(c => c.defaulterCount > 0);
    if (!coursesWithDefaulters.length) {
      panel.innerHTML = '<div class="text-center py-12"><div class="text-4xl mb-3">✨</div><div class="text-emerald-400 font-bold">All enrolled students are above the threshold!</div></div>';
      return;
    }

    panel.innerHTML = coursesWithDefaulters.map(c => `
      <div class="glass-card rounded-3xl overflow-hidden" id="defaulter-course-${c.courseId}">
        <div class="flex items-center justify-between px-6 py-4 bg-rose-500/5 border-b border-rose-500/10">
          <div class="flex items-center gap-3">
            <span class="text-rose-400 font-black text-lg">${sanitize(c.courseId)}</span>
            <span class="text-slate-400 text-sm">${sanitize(c.courseName)}</span>
            <span class="text-[10px] font-bold bg-rose-500/20 text-rose-400 px-2 py-0.5 rounded-full">${c.defaulterCount} of ${c.totalEnrolled} students below ${c.threshold}%</span>
          </div>
          <span class="text-slate-500 text-[10px] font-bold">${c.totalSessions} sessions held</span>
        </div>
        <table class="w-full text-left">
          <thead class="bg-slate-900/40">
            <tr class="text-[10px] font-bold text-slate-500 uppercase tracking-widest">
              <th class="px-6 py-3">Student Email</th>
              <th class="px-6 py-3">Sessions Attended</th>
              <th class="px-6 py-3">Attendance %</th>
              <th class="px-6 py-3">Status</th>
            </tr>
          </thead>
          <tbody class="divide-y divide-white/5">
            ${c.defaulters.map(d => `
              <tr class="hover:bg-white/2 transition">
                <td class="px-6 py-3 font-bold text-sm">${sanitize(d.email)}</td>
                <td class="px-6 py-3 text-slate-400 text-sm font-mono">${d.attended} / ${d.totalSessions}</td>
                <td class="px-6 py-3"><span class="text-rose-400 font-black text-lg">${d.percentage}%</span></td>
                <td class="px-6 py-3"><span class="text-[10px] font-bold text-rose-400 bg-rose-500/10 px-2 py-0.5 rounded-full">⚠️ Defaulter</span></td>
              </tr>`).join('')}
          </tbody>
        </table>
      </div>
    `).join('');
  },

  scrollToCourse(courseId) {
    const el = document.getElementById('defaulter-course-' + courseId);
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
};
