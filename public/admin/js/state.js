const State = {
  auth: { 
    user: sessionStorage.getItem('adminUser') || '', 
    pass: sessionStorage.getItem('adminPass') || '', 
    loginTime: sessionStorage.getItem('loginTime') || null 
  },
  data: {
    teachers: [],
    students: [],
    courses: [],
    departments: [],
    assignments: [],
    groups: [],
    enrollments: [],
    lastAttReport: null,
    emailLogs: []
  },
  ui: {
    currentTab: 'monitoring',
    renderedStudents: [],
    currentGroupId: null,
    charts: { branch: null, hourly: null }
  }
};
