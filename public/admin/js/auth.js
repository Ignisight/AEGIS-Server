const Auth = {
  get user() { return State.auth.user; },
  get pass() { return State.auth.pass; },

  headers() {
    if (this.isExpired()) {
      this.logout();
      return {};
    }
    return {
      'Content-Type': 'application/json',
      'x-admin-user': this.user,
      'x-admin-password': this.pass
    };
  },

  isExpired() {
    if (!State.auth.user || !State.auth.pass) return true;
    const t = State.auth.loginTime;
    if (!t) return true;
    return (Date.now() - parseInt(t)) > 8 * 60 * 60 * 1000; // 8 hours
  },

  async login(user, pass) {
    const res = await fetch('/admin-api/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: user, password: pass })
    });

    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data.error || `Access Denied (${res.status})`);
    }

    const data = await res.json();
    if (data.success) {
      State.auth.user = user;
      State.auth.pass = pass;
      State.auth.loginTime = Date.now();
      
      sessionStorage.setItem('adminUser', user);
      sessionStorage.setItem('adminPass', pass);
      sessionStorage.setItem('loginTime', State.auth.loginTime);
      return true;
    }
    throw new Error('Invalid Credentials');
  },

  logout() {
    localStorage.clear();
    sessionStorage.clear();
    State.auth.user = '';
    State.auth.pass = '';
    State.auth.loginTime = null;
    location.reload();
  }
};
