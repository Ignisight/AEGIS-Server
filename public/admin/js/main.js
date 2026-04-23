const Main = {
  init() {
    if (Auth.user && Auth.pass) {
      this.showDashboard();
      this.switchTab('monitoring');
    }

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !document.getElementById('loginScreen').classList.contains('hidden')) {
        this.handleLogin();
      }
    });

    // Attach login listener
    const lBtn = document.getElementById('loginBtn');
    if (lBtn) lBtn.onclick = () => this.handleLogin();
  },

  async handleLogin() {
    const errEl = document.getElementById('loginError');
    const btn = document.getElementById('loginBtn');
    errEl.classList.add('hidden');
    btn.textContent = 'Authenticating...';
    btn.disabled = true;

    try {
      const user = document.getElementById('usernameInput').value;
      const pass = document.getElementById('passwordInput').value;
      if (!user || !pass) throw new Error('Enter both credentials');

      await Auth.login(user, pass);
      this.showDashboard();
      this.switchTab('monitoring');
    } catch (err) {
      errEl.textContent = err.message;
      errEl.classList.remove('hidden');
      alert("LOGIN FAILED: " + err.message);
    } finally {
      btn.textContent = 'Authenticate';
      btn.disabled = false;
    }
  },

  showDashboard() {
    document.getElementById('loginScreen').classList.add('hidden');
    document.getElementById('sidebar').classList.add('flex');
    document.getElementById('sidebar').classList.remove('hidden');
    document.getElementById('dashboard').classList.remove('hidden');
  },

  togglePassword() {
    const p = document.getElementById('passwordInput');
    const open = document.getElementById('eye-icon-open');
    const closed = document.getElementById('eye-icon-closed');
    if (p.type === 'password') {
      p.type = 'text';
      open.classList.add('hidden');
      closed.classList.remove('hidden');
    } else {
      p.type = 'password';
      open.classList.remove('hidden');
      closed.classList.add('hidden');
    }
  },

  switchTab(tab) {
    State.ui.currentTab = tab;
    const ALL_IDS = ['monitoring', 'defaulters', 'departments', 'courses', 'assignments', 'enrollments', 'teachers', 'students', 'face', 'email-logs'];
    
    ALL_IDS.forEach(t => {
      const item = document.getElementById('tab-' + t);
      if (item) {
        item.classList.toggle('sidebar-item-active', t === tab);
        item.classList.toggle('sidebar-item-inactive', t !== tab);
      }
    });

    document.getElementById('currentPageTitle').textContent = tab.charAt(0).toUpperCase() + tab.slice(1).replace('-', ' ');

    // Control Visibility
    document.getElementById('monitoringView').classList.toggle('hidden', tab !== 'monitoring');
    document.getElementById('defaultersView').classList.toggle('hidden', tab !== 'defaulters');
    document.getElementById('enrollmentsPanel').classList.toggle('hidden', tab !== 'enrollments');
    document.getElementById('faceView').classList.toggle('hidden', tab !== 'face');
    
    const isNormalTable = ['teachers', 'students', 'departments', 'courses', 'assignments', 'email-logs'].includes(tab);
    document.getElementById('tableView').classList.toggle('hidden', !isNormalTable);

    // Load Data
    switch(tab) {
      case 'monitoring':
      case 'defaulters':
        MonitoringView.load();
        break;
      case 'teachers':
        TeachersView.load();
        break;
      case 'students':
        StudentsView.load();
        break;
      case 'face':
        FaceView.init();
        break;
      case 'departments':
        DepartmentsView.load();
        break;
      case 'courses':
        CoursesView.load();
        break;
      case 'assignments':
        AssignmentsView.load();
        break;
      case 'enrollments':
        EnrollmentsView.load();
        break;
      case 'email-logs':
        EmailLogsView.load();
        break;
    }

  }
};

// Start the app
document.addEventListener('DOMContentLoaded', () => Main.init());
