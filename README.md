# 📋 Nexisight Attendance Server (v2.7.0) 

Backend REST API for the QR Attendance System. Handles teacher authentication, attendance sessions, student device binding, OTP password reset, and data export.

**Live Server (App Gateway):** [attendance-server-ddgs.onrender.com](https://attendance-server-ddgs.onrender.com)  
**Admin Dashboard:** [attendance-server-ddgs.onrender.com/admin](https://attendance-server-ddgs.onrender.com/admin)

### 📥 Download the Official App (v2.7.0)
The system now uses **App-Only Security**. Browser-based submission is disabled to ensure device binding and geofencing integrity. Students must use the latest Nexisight app.

👉 [Download Official APK (v2.7.0)](https://expo.dev/artifacts/eas/fHUxobAcfjUCMFsc89j7wt.apk)

---

## 🧰 Tech Stack

| Technology | Purpose |
|---|---|
| **Node.js** | Runtime environment |
| **Express.js** | HTTP server & REST API framework |
| **MongoDB Atlas** | Cloud database (persistent storage) |
| **Mongoose** | MongoDB ODM for schema modeling & queries |
| **bcryptjs** | Password & OTP hashing (salted bcrypt) |
| **Brevo HTTP API** | Transactional email delivery (OTP emails) |
| **multer** | Multipart file upload handling (QR image scan) |
| **Jimp** | Server-side image processing (QR decode from photos) |
| **jsQR** | QR code detection & decoding from image buffers |
| **xlsx** | Excel file generation for attendance exports |
| **cors** | Cross-origin resource sharing middleware |
| **crypto** | HMAC-SHA256 signature validation & secure OTP |
| **winston** | Structured JSON logging for observability |
| **insertMany** | Batch buffer processing for scan bursts |
| **Render** | Cloud deployment platform (free tier) |
| **GitHub Actions** | Keep-alive automation (prevents Render sleep) |

---

## 📁 Project Structure

```
attendance-server/
├── server.js                          # Entire backend (single file)
├── package.json                       # Dependencies & start script
├── .github/workflows/keepalive.yml    # Cron job: pings server every 5 min
└── README.md
```

---

## 🔌 API Endpoints

### Authentication
| Method | Endpoint | Description |
|---|---|---|
| POST | `/api/register` | Create teacher account (name, email, password) |
| POST | `/api/login` | Teacher login with email & password |
| POST | `/api/google-login` | Teacher login via Google OAuth ID token |
| POST | `/api/change-password` | Change password (requires current password) |
| POST | `/api/update-profile` | Update teacher name, college, department |

### Password Reset (OTP)
| Method | Endpoint | Description |
|---|---|---|
| POST | `/api/forgot-password` | Send 6-digit OTP to teacher's email |
| POST | `/api/reset-password` | Verify OTP & set new password |

### Attendance Sessions
| Method | Endpoint | Description |
|---|---|---|
| POST | `/api/start-session` | Start a new QR attendance session |
| POST | `/api/sessions/:id/stop` | Stop an active session |
| GET | `/api/status` | Get current active session status |
| GET | `/api/history` | Get all past sessions with attendance counts |
| POST | `/api/sessions/clear-all` | Delete all sessions and attendance data |

### Student
| Method | Endpoint | Description |
|---|---|---|
| POST | `/api/student/login` | Register student device (1 phone = 1 email) |
| POST | `/api/submit` | Submit attendance via QR code data |
| POST | `/api/scan` | Upload QR code image for server-side decode |
| GET | `/api/responses/:sessionId` | Get all responses for a session |

### Admin Dashboard (Web)
| Method | URL | Description |
|---|---|---|
| GET | `/admin` | Open secure management dashboard |
| POST | `/admin-api/login` | Authenticate using Admin User/Password |
| GET | `/admin-api/data` | Fetch all teachers and student devices |
| DELETE| `/admin-api/teacher/:email` | Remove teacher & stop their sessions |
| DELETE| `/admin-api/student/:email` | Wipe device binding (reset student phone) |

### Export
| Method | Endpoint | Description |
|---|---|---|
| GET | `/api/export` | Download all attendance as Excel (.xlsx) file |

---

## 🍃 Database Schema (MongoDB Atlas)

| Collection | Fields | TTL |
|---|---|---|
| **Teachers** | id, email, name, college, department, password (bcrypt hash) | Permanent |
| **OTPs** | email, otpHash (bcrypt), expiresAt, failedAttempts, lockedUntil, lastRequestedAt | 10 minutes |
| **Sessions** | sessionId, name, code, location, radius, active, createdAt, stoppedAt | 6 months |
| **Attendance** | sessionId, email, name, rollNumber, batchYear, program, branch, location, deviceId | 4 years |
| **Devices** | email, deviceId (SHA-256 hash) | Permanent |

---

## 🔒 Security Features

- **APP_SECRET_KEY** — All `/api/` requests require `x-app-secret` header. Blocks Postman, curl, scripts.
- **bcrypt password hashing** — Passwords salted & hashed with bcrypt (10 rounds).
- **bcrypt OTP hashing** — OTPs hashed before storage, verified via `bcrypt.compare()`.
- **Cryptographic OTP** — Generated with `crypto.randomInt()` (CSPRNG), not `Math.random()`.
- **Rate limiting** — 5 failed OTP attempts → 15-minute lockout.
- **Cooldown** — 60-second wait between OTP requests per email.
- **Zero OTP exposure** — OTP never in API responses, console logs, or client state.
- **Device binding** — Student device IDs hashed with SHA-256, enforced as unique.
- **GPS geofencing** — Attendance only accepted within configured radius of teacher.

---

## ⚙️ Environment Variables (Render)

| Variable | Required | Description |
|---|---|---|
| `MONGO_URI` | ✅ | MongoDB Atlas connection string |
| `APP_SECRET_KEY` | ✅ | API authentication key (must match mobile app) |
| `BREVO_API_KEY` | ✅ | Brevo transactional email API key |
| `EMAIL_FROM` | ❌ | Sender email address (default: `work.anuragkishan@gmail.com`) |
| `EMAIL_FROM_NAME` | ❌ | Sender display name (default: `Attendance System`) |
| `GOOGLE_CLIENT_ID` | ❌ | Google OAuth client ID for Google Sign-In |
| `PORT` | ❌ | Server port (default: `10000`, set by Render) |
| `LEGACY_APP_SECRET` | ❌ | Old key for backward compatibility during APK transitions |
| `ADMIN_USER` | ✅ | Username for Admin Dashboard (Mandatory, no default) |
| `ADMIN_PASSWORD` | ✅ | Password for Admin Dashboard (Mandatory, no default) |

---

## 🚀 Deployment

The server is deployed on **Render** (free tier) with auto-deploy from GitHub `master` branch.

A **GitHub Actions workflow** (`.github/workflows/keepalive.yml`) pings the server every 5 minutes to prevent Render free-tier sleep.

### Run Locally
```bash
npm install
MONGO_URI=your_uri APP_SECRET_KEY=your_key node server.js
```
