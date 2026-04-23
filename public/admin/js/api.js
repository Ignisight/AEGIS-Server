const API = {
  async get(endpoint) {
    try {
      const res = await fetch('/admin-api/' + endpoint, { headers: Auth.headers() });
      if (res.status === 401) { Auth.logout(); return null; }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.json();
    } catch (err) {
      console.warn(`GET ${endpoint} failed:`, err.message);
      return null;
    }
  },

  async post(endpoint, body) {
    try {
      const res = await fetch('/admin-api/' + endpoint, {
        method: 'POST',
        headers: Auth.headers(),
        body: JSON.stringify(body)
      });
      if (res.status === 401) { Auth.logout(); return null; }
      return await res.json();
    } catch (err) {
      console.warn(`POST ${endpoint} failed:`, err.message);
      return { success: false, error: err.message };
    }
  },

  async put(endpoint, body) {
    try {
      const res = await fetch('/admin-api/' + endpoint, {
        method: 'PUT',
        headers: Auth.headers(),
        body: JSON.stringify(body)
      });
      if (res.status === 401) { Auth.logout(); return null; }
      return await res.json();
    } catch (err) {
      console.warn(`PUT ${endpoint} failed:`, err.message);
      return { success: false, error: err.message };
    }
  },

  async delete(endpoint) {
    try {
      const res = await fetch('/admin-api/' + endpoint, {
        method: 'DELETE',
        headers: Auth.headers()
      });
      if (res.status === 401) { Auth.logout(); return null; }
      return await res.json();
    } catch (err) {
      console.warn(`DELETE ${endpoint} failed:`, err.message);
      return { success: false, error: err.message };
    }
  },

  async patch(endpoint, body) {
    try {
      const res = await fetch('/admin-api/' + endpoint, {
        method: 'PATCH',
        headers: Auth.headers(),
        body: JSON.stringify(body)
      });
      if (res.status === 401) { Auth.logout(); return null; }
      return await res.json();
    } catch (err) {
      console.warn(`PATCH ${endpoint} failed:`, err.message);
      return { success: false, error: err.message };
    }
  },

  // Named Endpoints
  stats: () => API.get('stats'),
  attendanceReport: () => API.get('attendance-report'),
  saveThreshold: (val) => API.post('settings', { attendanceThreshold: val }),
  data: () => API.get('data'),
  departments: () => API.get('departments'),
  addDept: (deptId, name) => API.post('departments', { deptId, name }),
  deleteDept: (id) => API.delete(`departments/${id}`),
  courses: () => API.get('courses'),
  addCourse: (course) => API.post('courses', course),
  updateCourse: (id, course) => API.put(`courses/${id}`, course),
  deleteCourse: (id) => API.delete(`courses/${id}`),
  assignments: () => API.get('teacher-courses'),
  addAssignment: (teacherEmail, courseId) => API.post('teacher-courses', { teacherEmail, courseId }),
  deleteAssignment: (id) => API.delete(`teacher-courses/${id}`),
  groups: () => API.get('course-groups'),
  addGroup: (name) => API.post('course-groups', { name }),
  deleteGroup: (id, flush) => API.delete(`course-groups/${id}?flush=${flush}`),
  addCourseToGroup: (groupId, courseId) => API.patch(`course-groups/${groupId}/add-course`, { courseId }),
  removeCourseFromGroup: (groupId, courseId, flush) => API.patch(`course-groups/${groupId}/remove-course`, { courseId, flush }),
  enrollments: (courseId) => API.get(`enrollments?courseId=${encodeURIComponent(courseId)}`),
  removeEnrollment: (courseId, email) => API.delete(`enrollments/${encodeURIComponent(courseId)}/${encodeURIComponent(email)}`),
  clearEnrollments: (courseId) => API.delete(`enrollments/${encodeURIComponent(courseId)}`),
  addTeacher: (name, email) => API.post('approved-teachers', { name, email }),
  deleteTeacher: (email) => API.delete(`approved-teachers/${encodeURIComponent(email)}`),
  deleteStudent: (email) => API.delete(`student/${encodeURIComponent(email)}`),
  emailLogs: () => API.get('email-logs')
};
