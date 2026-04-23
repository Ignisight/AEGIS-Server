// =============================================
// Attendance System — MongoDB Atlas Edition
// =============================================

process.env.TZ = 'Asia/Kolkata';
require('dotenv').config();
console.log('🚀 [STARTUP] A.E.G.I.S Booting Sequence Initiated...');

const express = require('express');
const compression = require('compression');
const cors = require('cors');
const path = require('path');
const os = require('os');
const fs = require('fs');
const XLSX = require('xlsx');
const bcrypt = require('bcryptjs');
const nodemailer = require('nodemailer');
const multer = require('multer');
const { Jimp } = require('jimp');
const jsQR = require('jsqr');
const crypto = require('crypto');
const mongoose = require('mongoose');
const archiver = require('archiver');
// We will use native console.log since Render handles timestamping and log rotation automatically.

const fsFilters = require('fs');
if (!fsFilters.existsSync('./logs')) {
  fsFilters.mkdirSync('./logs');
}

const upload = multer({ storage: multer.memoryStorage() });
const app = express();
app.use(compression());
const PORT = process.env.PORT || 3000;

// ==========================================
// COLLEGE CONFIG
// ==========================================
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || '188263362905-05e73in41h1ib970spt6q3meoidg2fte.apps.googleusercontent.com';
const BREVO_API_KEY = process.env.BREVO_API_KEY;
const EMAIL_FROM = process.env.EMAIL_FROM || 'work.anuragkishan@gmail.com';
const EMAIL_FROM_NAME = process.env.EMAIL_FROM_NAME || 'Attendance System';

// Send email via Brevo HTTP API (works on Render free tier — no SMTP needed, 300 emails/day free)
async function sendEmail(to, subject, html) {
  if (!BREVO_API_KEY) {
    console.log('  ⚠️  BREVO_API_KEY not configured. Email not sent.');
    return { success: false, error: 'Email service not configured. Contact Admin.' };
  }
  try {
    const res = await fetch('https://api.brevo.com/v3/smtp/email', {
      method: 'POST',
      headers: { 'api-key': BREVO_API_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sender: { name: EMAIL_FROM_NAME, email: EMAIL_FROM },
        to: [{ email: to }],
        subject,
        htmlContent: html,
      }),
    });
    const data = await res.json();
    if (res.ok) {
      await EmailLog.create({ to, subject, status: 'success' });
      return { success: true };
    }
    const errorMsg = data.message || 'Email send failed.';
    await EmailLog.create({ to, subject, status: 'failed', error: errorMsg });
    if (res.status === 429) return { success: false, error: 'Daily email limit reached. Please try again tomorrow.' };
    console.error('Brevo API error:', data);
    return { success: false, error: errorMsg };
  } catch (err) {
    console.error('Email send error:', err.message);
    await EmailLog.create({ to, subject, status: 'failed', error: err.message });
    return { success: false, error: 'Email service unreachable.' };
  }
}

function generateSessionCode() {
  return crypto.randomBytes(4).toString('hex');
}

function parseRollInfo(email) {
  const local = email.split('@')[0].toLowerCase();
  const match = local.match(/^(\d{4})(ug|pg)([a-z]{2,4})(\d+)$/i);
  if (match) {
    return {
      year: match[1],
      program: match[2].toUpperCase(),
      branch: match[3].toUpperCase(),
      rollNo: match[4],
      rollNumber: local.toUpperCase(),
    };
  }
  return { year: '-', program: '-', branch: '-', rollNo: '-', rollNumber: local.toUpperCase() };
}

function getSessionFilename(sessionDoc) {
  if (!sessionDoc || !sessionDoc.createdAt) {
    const timestamp = sessionDoc?.sessionId || Date.now();
    const safeName = (sessionDoc?.name || 'Session').replace(/[^a-zA-Z0-9]/g, '_');
    const d = new Date(timestamp);
    const dd = String(d.getDate()).padStart(2, '0');
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const yyyy = d.getFullYear();
    return `attendance_${safeName}_${dd}-${mm}-${yyyy}_${timestamp}.xlsx`;
  }
  const d = new Date(sessionDoc.createdAt);
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const yyyy = d.getFullYear();
  let hh = d.getHours();
  const min = String(d.getMinutes()).padStart(2, '0');
  const ampm = hh >= 12 ? 'PM' : 'AM';
  hh = hh % 12 || 12;
  const hhStr = String(hh).padStart(2, '0');
  const safeName = sessionDoc.name.replace(/[^a-zA-Z0-9]/g, '_');
  return `attendance_${safeName}_${dd}-${mm}-${yyyy}_${hhStr}-${min}${ampm}.xlsx`;
}

function getLocalIP() {
  const interfaces = os.networkInterfaces();
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name]) {
      if (iface.family === 'IPv4' && !iface.internal) return iface.address;
    }
  }
  return 'localhost';
}

function getDistanceFromLatLonInMeters(lat1, lon1, lat2, lon2) {
  const R = 6371000;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
    Math.cos((lat2 * Math.PI) / 180) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2);
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// ==========================================
// MONGOOSE CONNECTION (background, non-blocking)
// ==========================================
const MONGO_URI = process.env.MONGO_URI;

if (!MONGO_URI) {
  console.error('❌  MONGO_URI environment variable is not set.');
  process.exit(1);
}

let dbReady = false;

async function connectDB() {
  for (let attempt = 1; attempt <= 10; attempt++) {
    try {
      await mongoose.connect(MONGO_URI, {
        serverSelectionTimeoutMS: 30000,
        connectTimeoutMS: 30000,
      });
      console.log('  ✅  MongoDB Atlas connected.');
      dbReady = true;
      return;
    } catch (err) {
      console.error(`  ❌  MongoDB attempt ${attempt}/10: ${err.message}`);
      await new Promise(r => setTimeout(r, 5000));
    }
  }
  console.error('  ❌  Could not connect to MongoDB after 10 attempts.');
}

// ==========================================
// MONGOOSE SCHEMAS & MODELS
// ==========================================

// Teacher accounts
const TeacherSchema = new mongoose.Schema({
  id: { type: Number, required: true, unique: true, index: true },
  email: { type: String, required: true, unique: true, lowercase: true, index: true },
  name: { type: String, required: true },
  college: { type: String, default: '' },
  department: { type: String, default: '' },
  allowedDomain: { type: String, default: '' },  // restricts which student emails can attend (e.g. 'nitjsr.ac.in')
  password: { type: String, required: true },
  createdAt: { type: Date, default: Date.now },
});
const Teacher = mongoose.model('Teacher', TeacherSchema);

// OTP store (auto-deletes via MongoDB TTL)
const OTPSchema = new mongoose.Schema({
  email: { type: String, required: true, unique: true, lowercase: true },
  otpHash: { type: String, required: true },              // bcrypt-hashed OTP — NEVER stored as plaintext
  expiresAt: { type: Date, required: true, index: { expires: 0 } }, // TTL: MongoDB auto-deletes expired docs
  failedAttempts: { type: Number, default: 0 },                  // Rate limiting: max 5 failed tries
  lockedUntil: { type: Date, default: null },                 // Lockout timestamp after too many failures
  lastRequestedAt: { type: Date, default: null },                 // Cooldown: 60s between OTP requests
});
const OTP = mongoose.model('OTP', OTPSchema);

// Attendance Sessions (retained 6 months)
const SessionSchema = new mongoose.Schema({
  sessionId: { type: Number, required: true, unique: true, index: true },
  name: { type: String, required: true },
  code: { type: String, required: true, unique: true, index: true },
  teacherEmail: { type: String, default: '', lowercase: true },
  createdAt: { type: Date, default: Date.now },
  active: { type: Boolean, default: true, index: true },
  stoppedAt: { type: Date, default: null },
  lat: { type: Number, default: null },
  lon: { type: Number, default: null },
  radius: { type: Number, default: 80 },  // geofence radius in metres
  durationMs: { type: Number, default: null },  // null = use 10-min auto-close default
});
// TTL: auto-delete sessions older than 6 months
SessionSchema.index({ createdAt: 1 }, { expireAfterSeconds: 183 * 24 * 60 * 60 });
const Session = mongoose.model('Session', SessionSchema);

// Attendance Records (retained 4 years)
const AttendanceSchema = new mongoose.Schema({
  sessionId: { type: Number, required: true, index: true },  // matches Session.sessionId
  email: { type: String, required: true, lowercase: true, index: true },
  name: { type: String },
  regNo: { type: String },
  year: { type: String },
  program: { type: String },
  branch: { type: String },
  rollNo: { type: String },
  submittedAt: { type: Date, default: Date.now },
  date: { type: String },
  time: { type: String },
});
// Compound unique: no double-submission per session per student
AttendanceSchema.index({ sessionId: 1, email: 1 }, { unique: true });
// TTL: auto-delete attendance older than 4 years
AttendanceSchema.index({ submittedAt: 1 }, { expireAfterSeconds: 4 * 365 * 24 * 60 * 60 });
const Attendance = mongoose.model('Attendance', AttendanceSchema);

// Device Bindings (permanent — never auto-deleted)
const DeviceSchema = new mongoose.Schema({
  email: { type: String, required: true, lowercase: true, index: true },
  deviceId: { type: String, required: true, unique: true, index: true }, // stored as SHA-256 hash from client
  registeredAt: { type: Date, default: Date.now },
});
const Device = mongoose.model('Device', DeviceSchema);

// Admin-approved teacher whitelist
const ApprovedTeacherSchema = new mongoose.Schema({
  email: { type: String, required: true, unique: true, lowercase: true, index: true },
  name: { type: String, required: true },
  addedAt: { type: Date, default: Date.now },
});
const ApprovedTeacher = mongoose.model('ApprovedTeacher', ApprovedTeacherSchema);

// Log of outgoing emails (OTPs, etc)
const EmailLogSchema = new mongoose.Schema({
  to: { type: String, required: true, lowercase: true, index: true },
  subject: { type: String },
  status: { type: String }, // 'success' or 'failed'
  error: { type: String },
  sentAt: { type: Date, default: Date.now },
});
const EmailLog = mongoose.model('EmailLog', EmailLogSchema);

// Departments
const DepartmentSchema = new mongoose.Schema({
  deptId: { type: String, required: true, unique: true, uppercase: true, index: true }, // e.g. "CSE"
  name: { type: String, required: true },  // e.g. "Computer Science & Engineering"
  createdAt: { type: Date, default: Date.now },
});
const Department = mongoose.model('Department', DepartmentSchema);

// Courses (master list of subjects)
const CourseSchema = new mongoose.Schema({
  courseId: { type: String, required: true, unique: true, index: true }, // e.g. "CS301"
  name: { type: String, required: true },   // e.g. "Data Structures"
  semester: { type: String, default: '' },       // e.g. "5"
  department: { type: String, default: '' },       // e.g. "CSE"
  createdAt: { type: Date, default: Date.now },
});
const Course = mongoose.model('Course', CourseSchema);

// Teacher ↔ Course assignments
const TeacherCourseSchema = new mongoose.Schema({
  teacherEmail: { type: String, required: true, lowercase: true, index: true },
  courseId: { type: String, required: true, index: true },
  assignedAt: { type: Date, default: Date.now },
});
TeacherCourseSchema.index({ teacherEmail: 1, courseId: 1 }, { unique: true }); // no duplicate assignments
const TeacherCourse = mongoose.model('TeacherCourse', TeacherCourseSchema);

// Student ↔ Course Enrollments (admin uploads via Excel)
const StudentCourseSchema = new mongoose.Schema({
  email: { type: String, required: true, lowercase: true, index: true },
  courseId: { type: String, required: true, index: true },
  enrolledAt: { type: Date, default: Date.now },
});
StudentCourseSchema.index({ email: 1, courseId: 1 }, { unique: true }); // no duplicate enrollments
const StudentCourse = mongoose.model('StudentCourse', StudentCourseSchema);

// Course Groups (admin-created folders that group multiple courses for bulk enrollment)
const CourseGroupSchema = new mongoose.Schema({
  name: { type: String, required: true, unique: true, trim: true },
  courseIds: [{ type: String }], // list of courseId strings in this folder
  createdAt: { type: Date, default: Date.now },
});
const CourseGroup = mongoose.model('CourseGroup', CourseGroupSchema);

// Admin-configurable Settings (key-value store)
const SettingSchema = new mongoose.Schema({
  key: { type: String, required: true, unique: true },
  value: { type: mongoose.Schema.Types.Mixed, required: true },
  updatedAt: { type: Date, default: Date.now },
});
const Setting = mongoose.model('Setting', SettingSchema);

async function getSetting(key, defaultValue) {
  const doc = await Setting.findOne({ key });
  return doc ? doc.value : defaultValue;
}

async function setSetting(key, value) {
  await Setting.findOneAndUpdate({ key }, { value, updatedAt: new Date() }, { upsert: true });
}

// Location Events (student entry/exit flips — retained 7 days)
const LocationEventSchema = new mongoose.Schema({
  email: { type: String, required: true, lowercase: true, index: true },
  deviceId: { type: String, required: true },
  sessionCode: { type: String, required: true, index: true },
  eventType: { type: String, enum: ['entry', 'exit'], required: true },
  lat: { type: Number },
  lon: { type: Number },
  timestamp: { type: Date, default: Date.now },
});
LocationEventSchema.index({ timestamp: 1 }, { expireAfterSeconds: 7 * 24 * 60 * 60 }); // auto-delete after 7 days
const LocationEvent = mongoose.model('LocationEvent', LocationEventSchema);

// FIX: Centralized input validation helpers (Issue #5)
function isValidEmail(email) {
  return typeof email === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
}

function isValidGPS(lat, lon) {
  const latNum = Number(lat);
  const lonNum = Number(lon);
  return !isNaN(latNum) && !isNaN(lonNum) && latNum >= -90 && latNum <= 90 && lonNum >= -180 && lonNum <= 180;
}

// [SECURITY] Request Integrity Validation (Issue #8)
// Verifies request integrity and prevents replay attacks using a cryptographically signed payload
function isValidSignature(payload, signature, timestamp) {
  if (!signature || !timestamp) return false;
  // Check if request is too old (replay protection window: 60s)
  if (Math.abs(Date.now() - Number(timestamp)) > 60000) return false;

  const hash = crypto.createHash('sha256');
  hash.update(payload + timestamp + process.env.APP_SECRET_KEY);
  const expected = hash.digest('hex');
  return signature === expected;
}

// [PERFORMANCE] Attendance Batch Buffer (Issue #9)
// Offloads high-frequency database writes to a background job to handle scan bursts smoothly
let attendanceBuffer = [];
async function flushAttendanceBuffer() {
  if (attendanceBuffer.length === 0) return;
  const batch = [...attendanceBuffer];
  attendanceBuffer = []; // Clear immediately to allow new entries
  try {
    // ordered: false allows valid entries to pass if some are duplicates recorded in parallel
    await Attendance.insertMany(batch, { ordered: false });
    if (batch.length > 5) console.log(`  ⚡ [Performance] Batch-inserted ${batch.length} attendance records.`);
  } catch (err) {
    // Log non-duplicate errors only
    const nonDuplicateCount = batch.length - (err.writeErrors?.length || 0);
    if (nonDuplicateCount > 0) console.log(`  ⚡ [Performance] Batch-inserted ${nonDuplicateCount} records (caught duplicates).`);
  }
}

// FIX: Per-identity rate limiter for /api/student/submit (Issue #4)
const submitRateMap = new Map();
const SUBMIT_RATE_LIMIT = 5;       // max attempts per window (slightly higher for batching)
const SUBMIT_RATE_WINDOW_MS = 60 * 1000; // 60 second window

function checkSubmitRateLimit(identity) {
  const now = Date.now();
  const entry = submitRateMap.get(identity);
  if (!entry || now - entry.windowStart > SUBMIT_RATE_WINDOW_MS) {
    submitRateMap.set(identity, { count: 1, windowStart: now });
    return true;
  }
  entry.count++;
  return entry.count <= SUBMIT_RATE_LIMIT;
}

// Clean up stale rate-limit entries every 5 minutes to prevent memory growth
setInterval(() => {
  const now = Date.now();
  for (const [key, val] of submitRateMap) {
    if (now - val.windowStart > SUBMIT_RATE_WINDOW_MS) submitRateMap.delete(key);
  }
}, 5 * 60 * 1000);

// ==========================================
// MIDDLEWARE (SECURITY & PARSERS)
// ==========================================
// FIX: CORS restricted to known origins instead of wide-open (Issue #3)
app.use(cors({
  origin: (origin, callback) => {
    // Mobile apps (React Native) don't send Origin header — always allowed
    if (!origin) return callback(null, true);
    const allowed = [
      process.env.RENDER_EXTERNAL_URL || 'https://aegis-server-02y5.onrender.com',
      'http://localhost:3000',
      'http://localhost:8081',
    ];
    if (allowed.includes(origin)) return callback(null, true);
    // FIX: Block unknown browser origins (defense-in-depth)
    callback(new Error('CORS: Origin not allowed'));
  },
}));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Lightweight keep-alive endpoint — no auth, no DB required
// Used by GitHub Actions cron to prevent Render from sleeping
app.get('/health', (req, res) => {
  res.status(200).json({ status: 'ok', uptime: Math.floor(process.uptime()) });
});

const APP_SECRET_KEY = process.env.APP_SECRET_KEY;
const LEGACY_APP_SECRET = process.env.LEGACY_APP_SECRET || '';  // old key — remove after all users update APK
// FIX: ISO 8601 date string for legacy key retirement schedule (Issue #7)
const LEGACY_SECRET_EXPIRES_AT = process.env.LEGACY_SECRET_EXPIRES_AT || '';
if (!APP_SECRET_KEY) {
  console.error('❌  APP_SECRET_KEY environment variable is not set.');
  process.exit(1);
}
// FIX: Warn on startup if legacy secret has no retirement date (Issue #7)
if (LEGACY_APP_SECRET && !LEGACY_SECRET_EXPIRES_AT) {
  console.warn('  ⚠️  [WARNING] LEGACY_APP_SECRET is set with no expiry date. Set LEGACY_SECRET_EXPIRES_AT to schedule retirement.');
}

// App secret check (accepts both new key and legacy key during transition)
// For file download endpoints, also accepts ?key= query param since downloadAsync can't send headers
app.use((req, res, next) => {
  if (req.path.startsWith('/api/')) {
    const clientKey = req.headers['x-app-secret'] || req.query.key || '';
    // Primary key — always valid
    if (clientKey === APP_SECRET_KEY) return next();
    // FIX: Legacy key now checked against LEGACY_SECRET_EXPIRES_AT (Issue #7)
    if (LEGACY_APP_SECRET && clientKey === LEGACY_APP_SECRET) {
      if (LEGACY_SECRET_EXPIRES_AT && Date.now() > new Date(LEGACY_SECRET_EXPIRES_AT).getTime()) {
        return res.status(403).json({ success: false, error: 'Legacy API key has expired. Please update to the latest app version.' });
      }
      return next();
    }
    return res.status(403).json({ success: false, error: 'Access Denied: Unofficial Client.' });
  }
  next();
});

// DB ready guard — only block API and session routes, let UI load instantly
app.use(async (req, res, next) => {
  // If DB is connected, proceed instantly
  if (dbReady) return next();

  // If it's a static file or the main admin UI, let it serve (React/Frontend will handle API errors)
  if (!req.path.startsWith('/api/') && !req.path.startsWith('/admin-api/') && !req.path.startsWith('/s/')) {
    return next();
  }

  let attempts = 0;
  // 30 attempts * 500ms = 15 seconds wait time (shorter to prevent proxy timeouts)
  while (!dbReady && attempts < 30) {
    await new Promise(r => setTimeout(r, 500));
    attempts++;
  }

  if (!dbReady) {
    return res.status(503).json({ success: false, error: 'Database connection is initializing or broken. Please try again.' });
  }
  next();
});

// ==========================================
// TEACHER AUTH ENDPOINTS
// ==========================================

app.post('/api/register', async (req, res) => {
  const { email, password, name, college, department, allowedDomain } = req.body;
  if (!email || !password || !name)
    return res.json({ success: false, error: 'Name, email and password are required' });
  if (!isValidEmail(email))
    return res.status(400).json({ success: false, error: 'Invalid email format.' });

  const emailLower = email.toLowerCase().trim();

  // ── ADMIN WHITELIST CHECK ──────────────────────────────────────────────────
  // Only emails pre-approved by admin are allowed to register as teachers
  const approved = await ApprovedTeacher.findOne({ email: emailLower });
  if (!approved)
    return res.json({ success: false, error: 'Your email is not approved for teacher registration. Please contact the administrator.' });

  const existing = await Teacher.findOne({ email: emailLower });
  if (existing)
    return res.json({ success: false, error: 'An account with this email already exists' });

  if (password.length < 4)
    return res.json({ success: false, error: 'Password must be at least 4 characters' });

  const hashedPassword = await bcrypt.hash(password, 10);
  const finalDomain = (allowedDomain && allowedDomain.trim()) ? allowedDomain.replace(/@/g, '').trim().toLowerCase() : '';

  await Teacher.create({
    id: Date.now(),
    email: emailLower,
    name: approved.name || name.trim(), // use admin-set name as canonical
    college: (college || '').trim(),
    department: (department || '').trim(),
    allowedDomain: finalDomain,
    password: hashedPassword,
  });
  res.json({ success: true, message: 'Account created! You can now login.' });
});

app.post('/api/login', async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password)
    return res.json({ success: false, error: 'Email and password are required' });

  const emailLower = email.toLowerCase().trim();
  const user = await Teacher.findOne({ email: emailLower });
  if (!user)
    return res.json({ success: false, error: 'No account found with this email' });

  const match = await bcrypt.compare(password, user.password);
  if (!match)
    return res.json({ success: false, error: 'Incorrect password' });

  res.json({
    success: true,
    user: { id: user.id, email: user.email, name: user.name, college: user.college || '', department: user.department || '', allowedDomain: user.allowedDomain || '' },
  });
});

app.post('/api/update-profile', async (req, res) => {
  const { email, name, college, department, allowedDomain } = req.body;
  if (!email) return res.json({ success: false, error: 'Email is required' });

  const emailLower = email.toLowerCase().trim();
  const user = await Teacher.findOne({ email: emailLower });
  if (!user) return res.json({ success: false, error: 'User not found' });

  if (name) user.name = name.trim();
  if (college !== undefined) user.college = college.trim();
  if (department !== undefined) user.department = department.trim();
  if (allowedDomain !== undefined) {
    // Clean: remove @, trim, lowercase; store only domain part
    user.allowedDomain = allowedDomain.replace(/@/g, '').trim().toLowerCase();
  }
  await user.save();

  res.json({
    success: true,
    message: 'Profile updated!',
    user: { name: user.name, email: user.email, college: user.college, department: user.department, allowedDomain: user.allowedDomain || '' },
  });
});

// ---- SECURE OTP PASSWORD RESET ----

app.post('/api/forgot-password', async (req, res) => {
  const { email } = req.body;
  if (!email) return res.json({ success: false, error: 'Email is required' });

  const emailLower = email.toLowerCase().trim();
  const user = await Teacher.findOne({ email: emailLower });
  if (!user) return res.json({ success: false, error: 'No account found with this email' });

  // ── COOLDOWN: 60 seconds between OTP requests ──
  const existingOtp = await OTP.findOne({ email: emailLower });
  if (existingOtp && existingOtp.lastRequestedAt) {
    const elapsed = Date.now() - existingOtp.lastRequestedAt.getTime();
    if (elapsed < 60 * 1000) {
      const wait = Math.ceil((60 * 1000 - elapsed) / 1000);
      return res.json({ success: false, error: `Please wait ${wait} seconds before requesting a new OTP.` });
    }
  }

  // ── GENERATE OTP using crypto (NOT Math.random) ──
  const otp = crypto.randomInt(100000, 999999).toString();

  // ── HASH OTP before storing (NEVER store plaintext) ──
  const otpHash = await bcrypt.hash(otp, 10);
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000);

  await OTP.findOneAndUpdate(
    { email: emailLower },
    { otpHash, expiresAt, failedAttempts: 0, lockedUntil: null, lastRequestedAt: new Date() },
    { upsert: true, new: true }
  );

  // ── SEND OTP via Brevo HTTP API — never log or expose ──
  const emailHtml = `<div style="font-family:sans-serif;padding:20px;">
    <p>Hi <strong>${user.name}</strong>,</p>
    <p>Your OTP is: <strong style="font-size:24px;letter-spacing:4px;">${otp}</strong></p>
    <p>It expires in 10 minutes. Do not share this with anyone.</p>
  </div>`;

  const emailResult = await sendEmail(emailLower, 'Password Reset OTP - Attendance App', emailHtml);
  if (!emailResult.success) {
    return res.json({ success: false, error: emailResult.error });
  }
  // ── RESPONSE: success message ONLY — no OTP, no hints ──
  res.json({ success: true, message: `OTP sent to ${emailLower}` });
});

app.post('/api/reset-password', async (req, res) => {
  const { email, otp, newPassword } = req.body;
  if (!email || !otp || !newPassword)
    return res.json({ success: false, error: 'Email, OTP and new password are required' });

  const emailLower = email.toLowerCase().trim();
  const otpEntry = await OTP.findOne({ email: emailLower });
  if (!otpEntry) return res.json({ success: false, error: 'Invalid or expired OTP.' });

  // ── RATE LIMIT: check if locked out ──
  if (otpEntry.lockedUntil && Date.now() < otpEntry.lockedUntil.getTime()) {
    const mins = Math.ceil((otpEntry.lockedUntil.getTime() - Date.now()) / 60000);
    return res.json({ success: false, error: `Too many failed attempts. Try again in ${mins} minute(s).` });
  }

  // ── EXPIRY CHECK ──
  if (Date.now() > otpEntry.expiresAt.getTime()) {
    await OTP.deleteOne({ email: emailLower });
    return res.json({ success: false, error: 'OTP has expired. Request a new one.' });
  }

  // ── VERIFY OTP via bcrypt.compare (secure) ──
  const otpValid = await bcrypt.compare(otp, otpEntry.otpHash);
  if (!otpValid) {
    // Increment failed attempts
    otpEntry.failedAttempts += 1;
    if (otpEntry.failedAttempts >= 5) {
      // Lock for 15 minutes after 5 fails
      otpEntry.lockedUntil = new Date(Date.now() + 15 * 60 * 1000);
      otpEntry.failedAttempts = 0;
      await otpEntry.save();
      return res.json({ success: false, error: 'Too many incorrect attempts. Locked for 15 minutes.' });
    }
    await otpEntry.save();
    return res.json({ success: false, error: `Invalid OTP. ${5 - otpEntry.failedAttempts} attempt(s) remaining.` });
  }

  // ── PASSWORD VALIDATION ──
  if (newPassword.length < 4)
    return res.json({ success: false, error: 'Password must be at least 4 characters' });

  const user = await Teacher.findOne({ email: emailLower });
  if (!user) return res.json({ success: false, error: 'User not found' });

  // ── UPDATE PASSWORD & DESTROY OTP ──
  user.password = await bcrypt.hash(newPassword, 10);
  await user.save();
  await OTP.deleteOne({ email: emailLower });

  res.json({ success: true, message: 'Password reset! You can now login.' });
});

app.post('/api/change-password', async (req, res) => {
  const { email, currentPassword, newPassword } = req.body;
  if (!email || !currentPassword || !newPassword)
    return res.json({ success: false, error: 'All fields are required' });

  const user = await Teacher.findOne({ email: email.toLowerCase().trim() });
  if (!user) return res.json({ success: false, error: 'User not found' });

  const valid = await bcrypt.compare(currentPassword, user.password);
  if (!valid) return res.json({ success: false, error: 'Current password is incorrect' });

  if (newPassword.length < 4)
    return res.json({ success: false, error: 'New password must be at least 4 characters' });

  user.password = await bcrypt.hash(newPassword, 10);
  await user.save();
  res.json({ success: true, message: 'Password changed successfully!' });
});

// ==========================================
// STUDENT FORM WEB PAGE
// ==========================================
app.get('/', async (req, res) => {
  const activeSession = await Session.findOne({ active: true });
  if (activeSession && activeSession.code) {
    const baseUrl = process.env.RENDER_EXTERNAL_URL || `http://${getLocalIP()}:${PORT}`;
    return res.redirect(`/s/${activeSession.code}`);
  }
  res.send(getStudentFormHTML(null));
});

app.get('/s/:code', async (req, res) => {
  const { code } = req.params;
  const session = await Session.findOne({ code });
  if (!session) return res.send(getStudentFormHTML(null, 'Invalid or expired session link.'));
  if (session.stoppedAt) return res.send(getStudentFormHTML(null, 'This session has ended.'));
  res.send(getStudentFormHTML(session));
});

// ==========================================
// STUDENT MOBILE V2 API
// ==========================================

app.post('/api/student/login', async (req, res) => {
  const { email, deviceId } = req.body;
  if (!email || !deviceId)
    return res.json({ success: false, error: 'Email and deviceId are required' });
  // FIX: Validate student email format (Issue #5)
  if (!isValidEmail(email))
    return res.status(400).json({ success: false, error: 'Invalid email format.' });

  const emailLower = email.toLowerCase().trim();

  // 1 Phone = 1 Email: check if this deviceId is already bound to a DIFFERENT email
  const existingDevice = await Device.findOne({ deviceId });
  if (existingDevice) {
    if (existingDevice.email !== emailLower) {
      return res.json({
        success: false,
        error: `This phone is already bound to ${existingDevice.email}. Using multiple emails on one phone is NOT allowed.`,
      });
    }
    // Same device + same email = returning user
    return res.json({ success: true, message: 'Welcome back!' });
  }

  // New device — register it (email can have multiple devices)
  await Device.create({ email: emailLower, deviceId });
  res.json({ success: true, message: 'Device securely registered!', name: emailLower.split('@')[0], displayName: emailLower.split('@')[0] });
});

app.post('/api/student/decode-qr', upload.single('qrimage'), async (req, res) => {
  if (!req.file) return res.json({ success: false, error: 'No image uploaded.' });
  try {
    const image = await Jimp.fromBuffer(req.file.buffer);
    const { width, height, data } = image.bitmap;
    const imageData = new Uint8ClampedArray(data);
    const code = jsQR(imageData, width, height);
    if (code && code.data) return res.json({ success: true, data: code.data });
    return res.json({ success: false, error: 'No QR code found in the image.' });
  } catch (error) {
    console.error(error);
    return res.json({ success: false, error: 'Failed to process image file on server.' });
  }
});

app.post('/api/student/submit', async (req, res) => {
  const { email, deviceId, sessionCode, lat, lon } = req.body;
  const signature = req.headers['x-signature'];
  const timestamp = req.headers['x-timestamp'];

  if (!email || !deviceId || !sessionCode)
    return res.json({ success: false, error: 'Missing required fields' });

  // [SECURITY] HMAC Signature & Replay Protection (Issue #8)
  const payload = email.toLowerCase().trim() + deviceId + sessionCode;
  if (!isValidSignature(payload, signature, timestamp)) {
    return res.status(403).json({ success: false, error: 'Access Denied: Untrusted request signature or expired timestamp.' });
  }

  // FIX: Validate email format and GPS coordinate ranges (Issue #5)
  if (!isValidEmail(email))
    return res.status(400).json({ success: false, error: 'Invalid email format.' });
  if (lat !== undefined && lon !== undefined && !isValidGPS(lat, lon))
    return res.status(400).json({ success: false, error: 'Invalid GPS coordinates.' });

  // FIX: Rate limit — max 5 submissions per 60s per device (Issue #4)
  if (!checkSubmitRateLimit(deviceId))
    return res.status(429).json({ success: false, error: 'Too many submission attempts. Please wait.' });

  const emailLower = email.toLowerCase().trim();

  // Validate device binding: the deviceId must exist and match this email
  const boundDevice = await Device.findOne({ deviceId });
  if (!boundDevice || boundDevice.email !== emailLower)
    return res.json({ success: false, error: 'Unregistered device. Please sign in again.' });

  // Find session by code
  const activeSession = await Session.findOne({ code: sessionCode });
  if (!activeSession) return res.json({ success: false, error: 'Invalid or expired session QR.' });
  if (activeSession.stoppedAt) return res.json({ success: false, error: 'This session has ended.' });

  // Check 10-min expiry (session.sessionId is Date.now() timestamp)
  if (Date.now() - activeSession.sessionId > 10 * 60 * 1000)
    return res.json({ success: false, error: 'Session expired (10 mins limit exceeded).' });

  // Domain restriction
  if (activeSession.teacherEmail) {
    const teacher = await Teacher.findOne({ email: activeSession.teacherEmail });
    if (teacher && teacher.allowedDomain) {
      const studentDomain = emailLower.split('@')[1] || '';
      if (studentDomain.toLowerCase() !== teacher.allowedDomain.toLowerCase()) {
        return res.json({ success: false, error: `Attendance restricted to @${teacher.allowedDomain} emails.` });
      }
    }
  }

  // Location check
  if (activeSession.lat && activeSession.lon) {
    if (!lat || !lon)
      return res.json({ success: false, error: 'Location permission required.' });
    const dist = getDistanceFromLatLonInMeters(activeSession.lat, activeSession.lon, lat, lon);
    if (dist > 80)
      return res.json({ success: false, error: `Too far (${dist.toFixed(0)}m). Must be within 80m.` });
  }

  // Check for duplicate in DB synchronously to provide immediate UI feedback
  const existing = await Attendance.findOne({ sessionId: activeSession.sessionId, email: emailLower });
  if (existing) return res.json({ success: false, error: 'You have already submitted for this session.' });

  // [PERFORMANCE] Push to Batch Buffer instead of blocking on write (Issue #9)
  const rollInfo = parseRollInfo(emailLower);
  const now = new Date();

  attendanceBuffer.push({
    sessionId: activeSession.sessionId,
    email: emailLower,
    name: emailLower.split('@')[0],
    regNo: rollInfo.rollNumber,
    year: rollInfo.year,
    program: rollInfo.program,
    branch: rollInfo.branch,
    rollNo: rollInfo.rollNo,
    submittedAt: now,
    date: now.toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata' }),
    time: now.toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata', hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' }),
  });

  // Return geofence parameters so the student app can start local tracking
  const SESSION_DURATION_MS = activeSession.durationMs || 10 * 60 * 1000;
  res.json({
    success: true,
    message: 'Attendance securely accepted!',
    lat: activeSession.lat,
    lon: activeSession.lon,
    radius: activeSession.radius || 80,
    sessionDurationMs: SESSION_DURATION_MS,
  });
});

// ==========================================
// TEACHER COURSE FETCH (from MongoDB — used by mobile app HomeScreen)
// ==========================================
app.get('/api/teacher-courses', async (req, res) => {
  const { teacherEmail } = req.query;
  if (!teacherEmail) return res.json({ success: false, error: 'teacherEmail is required' });
  try {
    const emailLower = teacherEmail.toLowerCase().trim();
    const assignments = await TeacherCourse.find({ teacherEmail: emailLower });
    if (!assignments.length) return res.json({ success: true, courses: [] });
    const courseIds = assignments.map(a => a.courseId);
    const courses = await Course.find({ courseId: { $in: courseIds } });
    const result = courses.map(c => ({
      courseId: c.courseId,
      courseName: c.name,
      semester: c.semester || '',
      department: c.department || '',
    }));
    res.json({ success: true, courses: result });
  } catch (err) {
    res.json({ success: false, error: err.message });
  }
});

// ==========================================
// STUDENT COURSES & ATTENDANCE % API
// ==========================================
app.get('/api/student/courses', async (req, res) => {
  const { email } = req.query;
  if (!email) return res.json({ success: false, error: 'email is required' });
  const emailLower = email.toLowerCase().trim();
  try {
    const enrollments = await StudentCourse.find({ email: emailLower });
    if (!enrollments.length) return res.json({ success: true, courses: [] });
    const courseIds = enrollments.map(e => e.courseId);
    const courses = await Course.find({ courseId: { $in: courseIds } });
    const courseMap = {};
    courses.forEach(c => courseMap[c.courseId] = { name: c.name, semester: c.semester || '', department: c.department || '' });

    // For each course, count sessions and attendance
    const result = await Promise.all(courseIds.map(async (courseId) => {
      const courseInfo = courseMap[courseId] || { name: courseId, semester: '', department: '' };
      // Sessions for this course: name starts with courseId (format "CS301 — Subject Name")
      const sessions = await Session.find({ name: new RegExp(`^${courseId}\\s*[—-]`, 'i'), stoppedAt: { $ne: null } });
      const totalSessions = sessions.length;
      let attended = 0;
      if (totalSessions > 0) {
        const sessionIds = sessions.map(s => s.sessionId);
        attended = await Attendance.countDocuments({ email: emailLower, sessionId: { $in: sessionIds } });
      }
      const percentage = totalSessions > 0 ? Math.round((attended / totalSessions) * 100) : null;
      return {
        courseId,
        courseName: courseInfo.name,
        semester: courseInfo.semester,
        department: courseInfo.department,
        totalSessions,
        attended,
        percentage,
      };
    }));

    res.json({ success: true, courses: result });
  } catch (err) {
    res.json({ success: false, error: err.message });
  }
});

// ==========================================
// ==========================================
// TEACHER SESSION API
// ==========================================

app.post('/api/start-session', async (req, res) => {
  const { sessionName, lat, lon, teacherEmail } = req.body;
  if (!sessionName || !sessionName.trim())
    return res.json({ success: false, error: 'Session name is required' });

  const { durationMs, radius } = req.body; // optional — teacher sets via app
  const id = Date.now();
  const code = generateSessionCode();

  await Session.create({
    sessionId: id,
    name: sessionName.trim(),
    code,
    teacherEmail: (teacherEmail || '').toLowerCase().trim(),
    createdAt: new Date(),
    active: true,
    lat: lat || null,
    lon: lon || null,
    durationMs: durationMs || null,   // null = fallback to 10 min auto-close
    radius: radius || 80,     // metres — default 80 m
  });

  const baseUrl = process.env.RENDER_EXTERNAL_URL || `http://${getLocalIP()}:${PORT}`;
  res.json({ success: true, sessionId: id, sessionName: sessionName.trim(), formUrl: `${baseUrl}/s/${code}` });
});

app.post('/api/stop-session', async (req, res) => {
  await Session.updateMany({ active: true }, { $set: { active: false, stoppedAt: new Date() } });
  res.json({ success: true, message: 'Session stopped' });
});

app.post('/api/sessions/:id/stop', async (req, res) => {
  const id = parseInt(req.params.id);
  const session = await Session.findOne({ sessionId: id });
  if (!session) return res.json({ success: false, error: 'Session not found' });
  if (!session.active) return res.json({ success: false, error: 'Session already stopped' });
  session.active = false;
  session.stoppedAt = new Date();
  await session.save();
  res.json({ success: true, message: 'Session stopped' });
});

// ==========================================
// STUDENT LOCATION EVENT (geofence flip — entry/exit)
// Called ONLY when student crosses geofence boundary (not every minute)
// ==========================================
app.post('/api/student/location-event', async (req, res) => {
  const { email, deviceId, sessionCode, eventType, lat, lon, timestamp } = req.body;

  if (!email || !deviceId || !sessionCode || !eventType)
    return res.status(400).json({ success: false, error: 'Missing required fields' });

  if (!['entry', 'exit'].includes(eventType))
    return res.status(400).json({ success: false, error: 'eventType must be entry or exit' });

  const emailLower = email.toLowerCase().trim();

  // Verify device is still bound
  const device = await Device.findOne({ deviceId });
  if (!device || device.email !== emailLower)
    return res.status(403).json({ success: false, error: 'Unrecognized device.' });

  // Verify session still exists
  const session = await Session.findOne({ code: sessionCode });
  if (!session)
    return res.status(404).json({ success: false, error: 'Session not found.' });

  await LocationEvent.create({
    email: emailLower,
    deviceId,
    sessionCode,
    eventType,
    lat: lat || null,
    lon: lon || null,
    timestamp: timestamp ? new Date(timestamp) : new Date(),
  });

  console.log(`[GEO] ${emailLower} → ${eventType.toUpperCase()} session=${sessionCode}`);
  res.json({ success: true, recorded: eventType });
});

app.get('/api/status', async (req, res) => {
  const session = await Session.findOne({ active: true });
  res.json({ active: !!session, session: session || null });
});

app.get('/api/responses', async (req, res) => {
  const { sessionId } = req.query;
  let rows = [];

  if (sessionId) {
    const session = await Session.findOne({ sessionId: Number(sessionId) });
    if (session) rows = await Attendance.find({ sessionId: session.sessionId });
  } else {
    const activeSession = await Session.findOne({ active: true });
    if (activeSession) rows = await Attendance.find({ sessionId: activeSession.sessionId });
  }

  rows.sort((a, b) => (a.rollNo || '').localeCompare(b.rollNo || '', undefined, { numeric: true }));

  const sessions = await Session.find({ sessionId: { $in: rows.map(r => r.sessionId) } });
  const sessionMap = {};
  sessions.forEach(s => (sessionMap[s.sessionId] = s.name));

  res.json({
    success: true,
    responses: rows.map(r => ({
      'Roll No': r.rollNo || '-', 'Name': r.name,
      'Reg No': r.regNo || '-', 'Email': r.email,
      'Year': r.year || '-', 'Program': r.program || '-',
      'Branch': r.branch || '-', 'Session': sessionMap[r.sessionId] || 'Unknown',
      'Date': r.date, 'Time': r.time,
    })),
    count: rows.length,
    headers: ['Roll No', 'Name', 'Reg No', 'Email', 'Year', 'Program', 'Branch', 'Session', 'Date', 'Time'],
  });
});

// FIX: Optional pagination with ?page=&limit= — backward compatible when omitted (Issue #6)
app.get('/api/history', async (req, res) => {
  const page = parseInt(req.query.page) || 0;
  const limit = parseInt(req.query.limit) || 0;

  let query = Session.find().sort({ createdAt: -1 });
  let total;

  // FIX: Only paginate when params are explicitly provided — existing app gets full list (Issue #6)
  if (page > 0 || limit > 0) {
    const p = Math.max(1, page);
    const l = Math.min(100, Math.max(1, limit || 20));
    total = await Session.countDocuments();
    query = query.skip((p - 1) * l).limit(l);
  }

  const sessions = await query;
  const result = await Promise.all(sessions.map(async s => ({
    id: s.sessionId,
    name: s.name,
    createdAt: s.createdAt,
    stoppedAt: s.stoppedAt || null,
    active: s.active,
    responseCount: await Attendance.countDocuments({ sessionId: s.sessionId }),
  })));

  const response = { success: true, sessions: result };
  // FIX: Include pagination metadata only when pagination is active (Issue #6)
  if (total !== undefined) {
    response.total = total;
    response.page = Math.max(1, page);
    response.limit = Math.min(100, Math.max(1, limit || 20));
  }
  res.json(response);
});

app.delete('/api/sessions/:id', async (req, res) => {
  const id = parseInt(req.params.id);
  await Session.deleteOne({ sessionId: id });
  await Attendance.deleteMany({ sessionId: id });
  res.json({ success: true });
});

app.post('/api/sessions/delete-many', async (req, res) => {
  const { ids } = req.body;
  if (!ids || !Array.isArray(ids)) return res.json({ success: false, error: 'ids array required' });
  await Session.deleteMany({ sessionId: { $in: ids } });
  await Attendance.deleteMany({ sessionId: { $in: ids } });
  res.json({ success: true, deleted: ids.length });
});

app.post('/api/sessions/clear-all', async (req, res) => {
  const count = await Session.countDocuments();
  await Session.deleteMany({});
  await Attendance.deleteMany({});
  res.json({ success: true, deleted: count });
});

// Helper: build a single xlsx buffer for a session
async function getSessionXlsxBuffer(session, rows) {
  const excelHeaders = ['Roll No', 'Name', 'Reg No', 'Email', 'Year', 'Program', 'Branch', 'Session', 'Date', 'Time'];
  const colWidths = [{ wch: 8 }, { wch: 25 }, { wch: 18 }, { wch: 30 }, { wch: 8 }, { wch: 8 }, { wch: 8 }, { wch: 35 }, { wch: 14 }, { wch: 10 }];

  const wb = XLSX.utils.book_new();
  if (rows.length === 0) {
    const ws = XLSX.utils.aoa_to_sheet([excelHeaders]);
    XLSX.utils.book_append_sheet(wb, ws, 'Attendance');
  } else {
    const excelData = rows.map(r => ({
      'Roll No': r.rollNo || '-', 'Name': r.name,
      'Reg No': r.regNo || '-', 'Email': r.email,
      'Year': r.year || '-', 'Program': r.program || '-',
      'Branch': r.branch || '-', 'Session': session.name,
      'Date': r.date, 'Time': r.time,
    }));
    const ws = XLSX.utils.json_to_sheet(excelData);
    ws['!cols'] = colWidths;
    XLSX.utils.book_append_sheet(wb, ws, session.name.slice(0, 31));
  }
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
}

// Export multiple sessions — bundled in ZIP
app.get('/api/export-multi', async (req, res) => {
  const { ids } = req.query;
  const sessionIds = ids ? ids.split(',').map(Number) : [];

  if (sessionIds.length === 0) {
    return res.status(400).json({ success: false, error: 'sessionIds are required for multi-export.' });
  }

  const sessions = await Session.find({ sessionId: { $in: sessionIds } });
  if (sessions.length === 0) {
    return res.status(404).json({ success: false, error: 'No sessions found.' });
  }

  // Determine ZIP filename
  const uniqueNames = [...new Set(sessions.map(s => s.name))];
  let zipName = 'attendance_sessions.zip';
  if (uniqueNames.length === 1) {
    const safeSubject = uniqueNames[0].replace(/[^a-zA-Z0-9]/g, '_');
    zipName = `attendance_${safeSubject}_sessions.zip`;
  } else {
    zipName = `attendance_sessions_${Date.now()}.zip`;
  }

  const archiver = require('archiver');
  const archive = archiver('zip', { zlib: { level: 6 } });

  res.setHeader('Content-Type', 'application/zip');
  res.setHeader('Content-Disposition', `attachment; filename="${zipName}"`);

  archive.pipe(res);

  for (const session of sessions) {
    const rows = await Attendance.find({ sessionId: session.sessionId });
    rows.sort((a, b) => (a.rollNo || '').localeCompare(b.rollNo || '', undefined, { numeric: true }));

    const buffer = await getSessionXlsxBuffer(session, rows);
    const fileName = getSessionFilename(session); // attendance_<name>_<date>_<time>.xlsx
    archive.append(buffer, { name: fileName });
  }

  await archive.finalize();
});

// Export single session
app.get('/api/export', async (req, res) => {
  const { sessionId } = req.query;

  if (!sessionId) {
    return res.status(400).json({ success: false, error: 'sessionId is required for export.' });
  }

  const session = await Session.findOne({ sessionId: Number(sessionId) });
  if (!session) {
    return res.status(404).json({ success: false, error: 'Session not found.' });
  }

  const rows = await Attendance.find({ sessionId: session.sessionId });
  rows.sort((a, b) => (a.rollNo || '').localeCompare(b.rollNo || '', undefined, { numeric: true }));

  const buffer = await getSessionXlsxBuffer(session, rows);
  const safeFilename = getSessionFilename(session);

  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="${safeFilename}"`);
  res.setHeader('Content-Length', buffer.length);
  res.end(buffer);
});

// ==========================================
// HTML PAGE GENERATORS
// ==========================================
function getStudentFormHTML(session, error = null) {
  const baseUrl = process.env.RENDER_EXTERNAL_URL || `http://localhost:${PORT}`;
  const sessionCode = session ? session.code : '';
  const sessionIdVal = session ? session.sessionId : '';
  const sessionName = session ? session.name : '';

  if (error) {
    return `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"><title>Session Ended</title>
<style>body{background:#0f172a;color:#f1f5f9;font-family:sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;margin:0}
.box{text-align:center;padding:40px;background:#1e293b;border-radius:20px;max-width:400px}
.icon{font-size:60px;margin-bottom:20px}.title{font-size:24px;font-weight:700;margin-bottom:10px;color:#ef4444}
.msg{color:#94a3b8;font-size:16px}</style></head>
<body><div class="box"><div class="icon">🔒</div><div class="title">Session Unavailable</div><div class="msg">${escapeHtml(error)}</div></div></body></html>`;
  }

  if (!session) {
    return `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"><title>Attendance System</title>
<style>body{background:#0f172a;color:#f1f5f9;font-family:sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;margin:0}
.box{text-align:center;padding:40px;background:#1e293b;border-radius:20px;max-width:400px}
.icon{font-size:60px;margin-bottom:20px}.title{font-size:24px;font-weight:700;margin-bottom:10px}
.msg{color:#94a3b8;font-size:16px}</style></head>
<body><div class="box"><div class="icon">📋</div><div class="title">NIT Jamshedpur Attendance</div>
<div class="msg">No active session right now. Please check with your teacher.</div></div></body></html>`;
  }
  const apkUrl = "https://expo.dev/artifacts/eas/uXhCvXnbFh85MuZcLhNpvA.apk";

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Attendance System — Official App Required</title>
  <link href="https://fonts.googleapis.com/css2?family=Outfit:wght@400;700&display=swap" rel="stylesheet">
  <style>
    body { background: #020617; color: #f8fafc; font-family: 'Outfit', sans-serif; display: flex; align-items:center; justify-content:center; min-height:100vh; margin:0; overflow:hidden; }
    .bg { position:fixed; top:-50%; left:-50%; width:200%; height:200%; background: radial-gradient(circle at 50% 50%, #1e1b4b 0%, #020617 60%); z-index:-1; opacity:0.6; }
    .card { background: rgba(30, 41, 59, 0.5); backdrop-filter: blur(20px); border-radius: 32px; padding: 48px 32px; width: 100%; max-width: 440px; border: 1px solid rgba(255, 255, 255, 0.1); text-align: center; box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.5); }
    .icon-box { background: linear-gradient(135deg, #6366f1, #a855f7); width: 80px; height: 80px; border-radius: 24px; display: flex; align-items: center; justify-content: center; margin: 0 auto 24px; font-size: 40px; box-shadow: 0 10px 20px -5px rgba(99, 102, 241, 0.4); }
    h1 { font-size: 28px; font-weight: 700; margin-bottom: 12px; letter-spacing: -0.5px; }
    p { color: #94a3b8; line-height: 1.6; margin-bottom: 32px; font-size: 16px; }
    .session-info { background: rgba(99, 102, 241, 0.1); color: #818cf8; border: 1px solid rgba(99, 102, 241, 0.2); padding: 8px 16px; border-radius: 99px; display: inline-block; font-weight: 600; font-size: 14px; margin-bottom: 24px; }
    .btn { background: #fff; color: #020617; text-decoration: none; padding: 18px 32px; border-radius: 16px; font-weight: 700; font-size: 17px; display: block; transition: all 0.2s; box-shadow: 0 4px 12px rgba(255,255,255,0.2); }
    .btn:hover { transform: translateY(-2px); box-shadow: 0 8px 24px rgba(255,255,255,0.3); background: #f1f5f9; }
    .btn:active { transform: translateY(0); }
    .meta { margin-top: 24px; color: #475569; font-size: 13px; font-weight: 500; }
  </style>
</head>
<body>
  <div class="bg"></div>
  <div class="card">
    <div class="icon-box">📱</div>
    <h1>Official App Required</h1>
    <p>To ensure secure geofencing and device-binding integrity, attendance for this session must be marked using the official application.</p>
    
    ${sessionName ? `<div class="session-info">📚 ${escapeHtml(sessionName)}</div>` : ''}
    ${error ? `<div style="color:#f87171; margin-bottom:20px; font-weight:600;">⚠️ ${escapeHtml(error)}</div>` : ''}

    <a href="${apkUrl}" class="btn">📥 Download Official APK (v2.7.0)</a>
    
    <div class="meta">Supported on Android 9.0+</div>
  </div>
</body>
</html>`;
}

function escapeHtml(text) {
  if (!text) return '';
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// ==========================================
// ADMIN DASHBOARD & SECURE ROUTES
// ==========================================
const ADMIN_USER = process.env.ADMIN_USER;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;

if (!ADMIN_USER || !ADMIN_PASSWORD) {
  console.warn('  ⚠️ [SECURITY] ADMIN_USER or ADMIN_PASSWORD not set in environment. Admin Dashboard is DISABLED.');
}

app.get('/', (req, res) => res.redirect('/admin/'));

app.use('/admin', express.static(path.join(__dirname, 'public', 'admin'), {
  setHeaders: (res) => {
    res.setHeader('Cache-Control', 'no-cache');
  }
}));

// Use express.json() if it's not applied globally to admin-api
app.post('/admin-api/login', express.json(), (req, res) => {
  const { username, password } = req.body;
  console.log(`[AUTH] Login attempt for: "${username}"`);
  
  if (username === ADMIN_USER && password === ADMIN_PASSWORD) {
    console.log(`[AUTH] Admin login SUCCESS for user: ${username}`);
    res.json({ success: true });
  } else {
    console.warn(`[AUTH] Admin login FAILED for user: "${username}"`);
    console.warn(`       Expected user: "${ADMIN_USER}" | Expected pass length: ${ADMIN_PASSWORD ? ADMIN_PASSWORD.length : 0}`);
    res.status(401).json({ success: false, error: 'Invalid admin credentials' });
  }
});

// Protect all other /admin-api/ routes
app.use('/admin-api', (req, res, next) => {
  const user = req.headers['x-admin-user'];
  const pw = req.headers['x-admin-password'];
  if (!user || !pw || user !== ADMIN_USER || pw !== ADMIN_PASSWORD) {
    return res.status(403).json({ success: false, error: 'Unauthorized Admin' });
  }
  next();
});

app.get('/admin-api/data', async (req, res) => {
  try {
    const teachers = await Teacher.find({}, '-password').sort({ name: 1 });
    const students = await Device.find({}).sort({ registeredAt: -1 });
    const approvedTeachers = await ApprovedTeacher.find().sort({ name: 1 });
    res.json({ success: true, teachers, students, approvedTeachers });
  } catch (err) {
    res.json({ success: false, error: err.message });
  }
});

// ── Admin: Settings ──────────────────────────────────────────────────────────
app.get('/admin-api/settings', async (req, res) => {
  try {
    const threshold = await getSetting('attendanceThreshold', 75);
    res.json({ success: true, settings: { attendanceThreshold: threshold } });
  } catch (err) { res.json({ success: false, error: err.message }); }
});

app.post('/admin-api/settings', express.json(), async (req, res) => {
  try {
    const { attendanceThreshold } = req.body;
    if (attendanceThreshold !== undefined) {
      const val = parseInt(attendanceThreshold);
      if (isNaN(val) || val < 1 || val > 100)
        return res.json({ success: false, error: 'Threshold must be between 1 and 100' });
      await setSetting('attendanceThreshold', val);
      cachedAttendanceReport = null; // bust cache so next fetch uses new threshold
    }
    res.json({ success: true });
  } catch (err) { res.json({ success: false, error: err.message }); }
});

// ── Admin: Attendance Report (per-course defaulter tracking) ──────────────────
let cachedAttendanceReport = null;
let lastAttendanceReportFetch = 0;

app.get('/admin-api/attendance-report', async (req, res) => {
  try {
    const CACHE_TTL = 3 * 60 * 1000;
    if (cachedAttendanceReport && (Date.now() - lastAttendanceReportFetch < CACHE_TTL)) {
      return res.json({ success: true, report: cachedAttendanceReport, cached: true });
    }

    const threshold = await getSetting('attendanceThreshold', 75);
    const courses = await Course.find({}).sort({ courseId: 1 });
    const report = [];

    for (const course of courses) {
      const { courseId, name: courseName } = course;
      const sessions = await Session.find({
        name: new RegExp(`^${courseId}\\s*[-–]`, 'i'),
        stoppedAt: { $ne: null }
      }, { sessionId: 1 });

      const totalSessions = sessions.length;
      if (totalSessions === 0) continue;

      const sessionIds = sessions.map(s => s.sessionId);
      const enrollments = await StudentCourse.find({ courseId }, { email: 1 });
      if (!enrollments.length) continue;

      const passing = [], defaulters = [];
      const attendanceCounts = await Attendance.aggregate([
        { $match: { sessionId: { $in: sessionIds } } },
        { $group: { _id: "$email", count: { $sum: 1 } } }
      ]);
      const attendanceMap = {};
      attendanceCounts.forEach(a => attendanceMap[a._id] = a.count);

      for (const { email } of enrollments) {
        const attended = attendanceMap[email] || 0;
        const percentage = Math.round((attended / totalSessions) * 100);
        const record = { email, attended, totalSessions, percentage };
        if (percentage < threshold) defaulters.push(record);
        else passing.push(record);
      }
      defaulters.sort((a, b) => a.percentage - b.percentage);

      report.push({
        courseId, courseName, totalSessions,
        totalEnrolled: enrollments.length,
        defaulterCount: defaulters.length,
        passingCount: passing.length,
        threshold,
        avgAttendance: Math.round(
          (passing.reduce((s, r) => s + r.percentage, 0) + defaulters.reduce((s, r) => s + r.percentage, 0)) /
          enrollments.length
        ),
        defaulters, passing,
      });
    }

    cachedAttendanceReport = report;
    lastAttendanceReportFetch = Date.now();
    res.json({ success: true, report, threshold });
  } catch (err) { res.json({ success: false, error: err.message }); }
});

let cachedStats = null;
let lastStatsFetch = 0;

app.get('/admin-api/stats', async (req, res) => {
  try {
    const CACHE_TTL = 30000; // 30 seconds cache to prevent spam refreshing load
    if (cachedStats && (Date.now() - lastStatsFetch < CACHE_TTL)) {
      // Update real-time Node metrics even when cached
      cachedStats.performance.uptime = Math.floor(process.uptime());
      cachedStats.performance.memoryUsage = Math.floor(process.memoryUsage().heapUsed / 1024 / 1024);
      return res.json({ success: true, ...cachedStats, cached: true });
    }

    const start = Date.now();
    // estimatedDocumentCount is O(1) and much faster than countDocuments()
    const [tCount, sCount, aCount, dCount, approvedCount, enrCount] = await Promise.all([
      Teacher.estimatedDocumentCount(),
      Session.estimatedDocumentCount(),
      Attendance.estimatedDocumentCount(),
      Device.estimatedDocumentCount(),
      ApprovedTeacher.estimatedDocumentCount(),
      StudentCourse.estimatedDocumentCount()
    ]);
    const dbLatency = Date.now() - start;

    // Last 7 days attendance trend
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

    // Distribution metrics (based on Student Enrollments for more stable "at-a-glance" profile)
    const enrDistribution = await StudentCourse.aggregate([
      {
        $lookup: {
          from: 'courses',
          localField: 'courseId',
          foreignField: 'courseId',
          as: 'courseInfo'
        }
      },
      { $unwind: { path: '$courseInfo', preserveNullAndEmptyArrays: true } },
      { $group: { _id: { $ifNull: ["$courseInfo.department", "Misc"] }, count: { $sum: 1 } } }
    ]);

    const hourlyAgg = await Attendance.aggregate([
      { $match: { submittedAt: { $gte: sevenDaysAgo } } },
      { $project: { hour: { $hour: { date: "$submittedAt", timezone: "+05:30" } } } },
      { $group: { _id: "$hour", count: { $sum: 1 } } }
    ]);

    const branchStats = {};
    enrDistribution.forEach(b => branchStats[b._id] = b.count);

    const hourlyDistribution = Array(24).fill(0);
    hourlyAgg.forEach(h => {
      if (h._id >= 0 && h._id < 24) hourlyDistribution[h._id] = h.count;
    });

    cachedStats = {
      counts: { 
        teachers: approvedCount, // Show whitelisted faculty as primary
        registeredTeachers: tCount,
        sessions: sCount, 
        attendance: aCount, 
        devices: dCount,
        enrollments: enrCount
      },
      performance: {
        uptime: Math.floor(process.uptime()),
        dbLatency,
        memoryUsage: Math.floor(process.memoryUsage().heapUsed / 1024 / 1024)
      },
      distribution: {
        branches: branchStats,
        hourly: hourlyDistribution
      }
    };
    lastStatsFetch = Date.now();

    res.json({ success: true, ...cachedStats, cached: false });
  } catch (err) {
    res.json({ success: false, error: err.message });
  }
});

app.delete('/admin-api/teacher/:email', async (req, res) => {
  try {
    const email = req.params.email.toLowerCase();
    await Teacher.deleteOne({ email });
    await Session.updateMany({ teacherEmail: email, active: true }, { active: false, stoppedAt: new Date() });
    res.json({ success: true, message: 'Teacher deleted' });
  } catch (err) {
    res.json({ success: false, error: err.message });
  }
});

// ── Approved Teacher Whitelist ─────────────────────────────────────────────────
app.get('/admin-api/approved-teachers', async (req, res) => {
  try {
    const list = await ApprovedTeacher.find().sort({ name: 1 });
    res.json({ success: true, list });
  } catch (err) { res.json({ success: false, error: err.message }); }
});

app.post('/admin-api/approved-teachers', async (req, res) => {
  try {
    const { email, name } = req.body;
    if (!email || !name) return res.json({ success: false, error: 'Name and email are required' });
    if (!isValidEmail(email)) return res.json({ success: false, error: 'Invalid email format' });
    const emailLower = email.toLowerCase().trim();
    const existing = await ApprovedTeacher.findOne({ email: emailLower });
    if (existing) return res.json({ success: false, error: 'This email is already approved' });
    await ApprovedTeacher.create({ email: emailLower, name: name.trim() });
    res.json({ success: true, message: `${name.trim()} approved successfully` });
  } catch (err) { res.json({ success: false, error: err.message }); }
});

app.delete('/admin-api/approved-teachers/:email', async (req, res) => {
  try {
    const email = req.params.email.toLowerCase();
    // Remove from whitelist — also remove teacher account if exists
    await ApprovedTeacher.deleteOne({ email });
    await Teacher.deleteOne({ email });
    await Session.updateMany({ teacherEmail: email, active: true }, { active: false, stoppedAt: new Date() });
    res.json({ success: true, message: 'Teacher access revoked' });
  } catch (err) { res.json({ success: false, error: err.message }); }
});


app.delete('/admin-api/student/:email', async (req, res) => {
  try {
    const email = req.params.email.toLowerCase();
    await Device.deleteOne({ email });
    res.json({ success: true, message: 'Student device binding cleared' });
  } catch (err) {
    res.json({ success: false, error: err.message });
  }
});

app.post('/admin-api/students/bulk-delete', async (req, res) => {
  try {
    const { emails } = req.body;
    if (!Array.isArray(emails)) return res.json({ success: false, error: 'Expected an array of emails' });
    const matchEmails = emails.map(e => e.toLowerCase());
    const result = await Device.deleteMany({ email: { $in: matchEmails } });
    res.json({ success: true, message: `Cleared bindings for ${result.deletedCount} students.` });
  } catch (err) {
    res.json({ success: false, error: err.message });
  }
});

// ── Admin: Sessions ──────────────────────────────────────────────────────────
app.get('/admin-api/sessions', async (req, res) => {
  try {
    const sessions = await Session.find().sort({ createdAt: -1 }).limit(200);
    const result = await Promise.all(sessions.map(async s => ({
      id: s.sessionId, name: s.name, code: s.code,
      teacherEmail: s.teacherEmail || '—', active: s.active,
      createdAt: s.createdAt, stoppedAt: s.stoppedAt || null,
      lat: s.lat, lon: s.lon, radius: s.radius || 80,
      durationMs: s.durationMs || null,
      attendeeCount: await Attendance.countDocuments({ sessionId: s.sessionId }),
    })));
    res.json({ success: true, sessions: result });
  } catch (err) { res.json({ success: false, error: err.message }); }
});

app.get('/admin-api/sessions/:id/attendance', async (req, res) => {
  try {
    const rows = await Attendance.find({ sessionId: parseInt(req.params.id) }).sort({ submittedAt: 1 });
    res.json({ success: true, attendance: rows });
  } catch (err) { res.json({ success: false, error: err.message }); }
});

app.post('/admin-api/sessions/:id/stop', async (req, res) => {
  try {
    const s = await Session.findOne({ sessionId: parseInt(req.params.id) });
    if (!s) return res.json({ success: false, error: 'Session not found' });
    s.active = false; s.stoppedAt = new Date(); await s.save();
    res.json({ success: true });
  } catch (err) { res.json({ success: false, error: err.message }); }
});

app.delete('/admin-api/sessions/:id', async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    await Session.deleteOne({ sessionId: id });
    await Attendance.deleteMany({ sessionId: id });
    res.json({ success: true });
  } catch (err) { res.json({ success: false, error: err.message }); }
});

app.post('/admin-api/sessions/delete-many', async (req, res) => {
  try {
    const { ids } = req.body;
    if (!Array.isArray(ids)) return res.json({ success: false, error: 'ids array required' });
    await Session.deleteMany({ sessionId: { $in: ids } });
    await Attendance.deleteMany({ sessionId: { $in: ids } });
    res.json({ success: true, deleted: ids.length });
  } catch (err) { res.json({ success: false, error: err.message }); }
});

// ── Admin: Geo Events ────────────────────────────────────────────────────────
app.get('/admin-api/geo-events', async (req, res) => {
  try {
    const { sessionCode, limit } = req.query;
    const filter = sessionCode ? { sessionCode } : {};
    const events = await LocationEvent.find(filter).sort({ timestamp: -1 }).limit(parseInt(limit) || 200);
    res.json({ success: true, events });
  } catch (err) { res.json({ success: false, error: err.message }); }
});

// ── Admin: Export session XLSX ────────────────────────────────────────────────
app.get('/admin-api/export/:id', async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const session = await Session.findOne({ sessionId: id });
    if (!session) return res.status(404).json({ success: false, error: 'Session not found' });
    const rows = await Attendance.find({ sessionId: id }).sort({ rollNo: 1 });
    const buffer = await getSessionXlsxBuffer(session, rows);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${getSessionFilename(session)}"`);
    res.end(buffer);
  } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

// ── Admin: Departments ────────────────────────────────────────────────────────
app.get('/admin-api/departments', async (req, res) => {
  try {
    const depts = await Department.find().sort({ name: 1 });
    res.json({ success: true, departments: depts });
  } catch (err) { res.json({ success: false, error: err.message }); }
});

app.post('/admin-api/departments', async (req, res) => {
  try {
    const { deptId, name } = req.body;
    if (!deptId || !name) return res.json({ success: false, error: 'Department ID and name are required' });
    const id = deptId.trim().toUpperCase();
    const existing = await Department.findOne({ deptId: id });
    if (existing) return res.json({ success: false, error: 'Department ID already exists' });
    const dept = await Department.create({ deptId: id, name: name.trim() });
    res.json({ success: true, department: dept });
  } catch (err) { res.json({ success: false, error: err.message }); }
});

app.delete('/admin-api/departments/:id', async (req, res) => {
  try {
    const deptId = req.params.id.toUpperCase();
    // Remove dept + all its courses + assignments
    const courses = await Course.find({ department: deptId });
    const courseIds = courses.map(c => c.courseId);
    await TeacherCourse.deleteMany({ courseId: { $in: courseIds } });
    await Course.deleteMany({ department: deptId });
    await Department.deleteOne({ deptId });
    res.json({ success: true });
  } catch (err) { res.json({ success: false, error: err.message }); }
});

// ── Admin: Courses ────────────────────────────────────────────────────────────
app.get('/admin-api/courses', async (req, res) => {
  try {
    const courses = await Course.find().sort({ department: 1, semester: 1, name: 1 });
    res.json({ success: true, courses });
  } catch (err) { res.json({ success: false, error: err.message }); }
});

app.post('/admin-api/courses', async (req, res) => {
  try {
    const { courseId, name, semester, department } = req.body;
    if (!courseId || !name) return res.json({ success: false, error: 'courseId and name are required' });
    const existing = await Course.findOne({ courseId: courseId.trim().toUpperCase() });
    if (existing) return res.json({ success: false, error: 'Course ID already exists' });
    const course = await Course.create({
      courseId: courseId.trim().toUpperCase(),
      name: name.trim(),
      semester: (semester || '').trim(),
      department: (department || '').trim().toUpperCase(),
    });
    res.json({ success: true, course });
  } catch (err) { res.json({ success: false, error: err.message }); }
});

app.put('/admin-api/courses/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { name, semester, department } = req.body;
    const course = await Course.findOneAndUpdate(
      { courseId: id.toUpperCase() },
      { 
        name: name ? name.trim() : undefined, 
        semester: semester ? semester.trim() : undefined, 
        department: department ? department.trim().toUpperCase() : undefined 
      },
      { new: true }
    );
    if (!course) return res.json({ success: false, error: 'Course not found' });
    res.json({ success: true, course });
  } catch (err) { res.json({ success: false, error: err.message }); }
});

app.delete('/admin-api/courses/:id', async (req, res) => {
  try {
    const courseId = req.params.id;
    await Course.deleteOne({ courseId });
    await TeacherCourse.deleteMany({ courseId }); // also remove assignments
    res.json({ success: true });
  } catch (err) { res.json({ success: false, error: err.message }); }
});

// ── Admin: Teacher-Course Assignments ─────────────────────────────────────────
app.get('/admin-api/teacher-courses', async (req, res) => {
  try {
    const assignments = await TeacherCourse.find().sort({ assignedAt: -1 });
    // Enrich with course names and teacher names
    const courses = await Course.find();
    const [teachers, approved] = await Promise.all([
      Teacher.find({}, 'email name'),
      ApprovedTeacher.find({}, 'email name')
    ]);
    const courseMap = {}; courses.forEach(c => courseMap[c.courseId] = c.name);
    const teacherMap = {};
    approved.forEach(t => teacherMap[t.email.toLowerCase()] = t.name);
    teachers.forEach(t => teacherMap[t.email.toLowerCase()] = t.name);
    const enriched = assignments.map(a => ({
      _id: a._id,
      teacherEmail: a.teacherEmail,
      teacherName: teacherMap[a.teacherEmail] || '—',
      courseId: a.courseId,
      courseName: courseMap[a.courseId] || '—',
      assignedAt: a.assignedAt,
    }));
    res.json({ success: true, assignments: enriched });
  } catch (err) { res.json({ success: false, error: err.message }); }
});

app.post('/admin-api/teacher-courses', async (req, res) => {
  try {
    const { teacherEmail, courseId } = req.body;
    if (!teacherEmail || !courseId) return res.json({ success: false, error: 'teacherEmail and courseId are required' });
    const teacher = await ApprovedTeacher.findOne({ email: teacherEmail.toLowerCase().trim() });
    if (!teacher) return res.json({ success: false, error: 'Teacher not found in whitelist' });
    const course = await Course.findOne({ courseId: courseId.trim().toUpperCase() });
    if (!course) return res.json({ success: false, error: 'Course not found' });
    await TeacherCourse.create({ teacherEmail: teacherEmail.toLowerCase().trim(), courseId: courseId.trim().toUpperCase() });
    res.json({ success: true, message: `${teacher.name} assigned to ${course.name}` });
  } catch (err) {
    if (err.code === 11000) return res.json({ success: false, error: 'This teacher is already assigned to this course' });
    res.json({ success: false, error: err.message });
  }
});

app.delete('/admin-api/teacher-courses/:id', async (req, res) => {
  try {
    await TeacherCourse.deleteOne({ _id: req.params.id });
    res.json({ success: true });
  } catch (err) { res.json({ success: false, error: err.message }); }
});

app.get('/admin-api/email-logs', async (req, res) => {
  try {
    const logs = await EmailLog.find().sort({ sentAt: -1 }).limit(100);
    res.json({ success: true, logs });
  } catch (err) { res.json({ success: false, error: err.message }); }
});

// ── Admin: Student Enrollments (bulk Excel upload) ────────────────────────────
app.get('/admin-api/enrollments', async (req, res) => {
  try {
    const { courseId } = req.query;
    const filter = courseId ? { courseId } : {};
    const enrollments = await StudentCourse.find(filter).sort({ enrolledAt: -1 });
    res.json({ success: true, enrollments, count: enrollments.length });
  } catch (err) { res.json({ success: false, error: err.message }); }
});

app.post('/admin-api/enrollments/upload', upload.single('file'), async (req, res) => {
  const { courseId } = req.body;
  if (!courseId) return res.json({ success: false, error: 'courseId is required' });
  if (!req.file) return res.json({ success: false, error: 'Excel file is required' });

  try {
    const course = await Course.findOne({ courseId: courseId.trim().toUpperCase() });
    if (!course) return res.json({ success: false, error: `Course ${courseId} not found` });

    const workbook = XLSX.read(req.file.buffer, { type: 'buffer' });
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });

    // Find the email column (case-insensitive header match)
    if (rows.length < 2) return res.json({ success: false, error: 'Excel file is empty or has no data rows' });
    const header = rows[0].map(h => String(h).toLowerCase().trim());
    const emailCol = header.findIndex(h => h.includes('email') || h.includes('mail'));
    if (emailCol === -1) return res.json({ success: false, error: 'No email column found. Add a column with header "Email" or "StudentEmail".' });

    const emails = [];
    for (let i = 1; i < rows.length; i++) {
      const raw = String(rows[i][emailCol] || '').trim().toLowerCase();
      if (raw && isValidEmail(raw)) emails.push(raw);
    }

    if (!emails.length) return res.json({ success: false, error: 'No valid email addresses found in the file.' });

    const courseIdUpper = courseId.trim().toUpperCase();
    const docs = emails.map(email => ({ email, courseId: courseIdUpper }));

    // Upsert — skip duplicates, insert new ones
    let inserted = 0, skipped = 0;
    for (const doc of docs) {
      try {
        await StudentCourse.create(doc);
        inserted++;
      } catch (e) {
        if (e.code === 11000) skipped++; // duplicate — already enrolled
        else throw e;
      }
    }

    res.json({
      success: true,
      message: `✅ ${inserted} students enrolled in ${courseIdUpper}. ${skipped > 0 ? skipped + ' already existed (skipped).' : ''}`,
      inserted,
      skipped,
      total: emails.length,
    });
  } catch (err) {
    res.json({ success: false, error: err.message });
  }
});

app.delete('/admin-api/enrollments/:courseId', async (req, res) => {
  try {
    const courseId = req.params.courseId.toUpperCase();
    const result = await StudentCourse.deleteMany({ courseId });
    res.json({ success: true, deleted: result.deletedCount });
  } catch (err) { res.json({ success: false, error: err.message }); }
});

app.delete('/admin-api/enrollments/:courseId/:email', async (req, res) => {
  try {
    const courseId = req.params.courseId.toUpperCase();
    const email = req.params.email.toLowerCase();
    await StudentCourse.deleteOne({ courseId, email });
    res.json({ success: true });
  } catch (err) { res.json({ success: false, error: err.message }); }
});

// ── Admin: Course Groups (Folders) ──────────────────────────────────────────

// GET all groups
app.get('/admin-api/course-groups', async (req, res) => {
  try {
    const groups = await CourseGroup.find().sort({ createdAt: -1 });
    res.json({ success: true, groups });
  } catch (err) { res.json({ success: false, error: err.message }); }
});

// POST create a new group
app.post('/admin-api/course-groups', express.json(), async (req, res) => {
  try {
    const { name } = req.body;
    if (!name || !name.trim()) return res.json({ success: false, error: 'Group name is required' });
    const group = await CourseGroup.create({ name: name.trim(), courseIds: [] });
    res.json({ success: true, group });
  } catch (err) {
    if (err.code === 11000) return res.json({ success: false, error: 'A group with that name already exists' });
    res.json({ success: false, error: err.message });
  }
});

// PATCH add a course to a group
app.patch('/admin-api/course-groups/:id/add-course', express.json(), async (req, res) => {
  try {
    const { courseId } = req.body;
    if (!courseId) return res.json({ success: false, error: 'courseId is required' });
    const courseIdUpper = courseId.trim().toUpperCase();
    const course = await Course.findOne({ courseId: courseIdUpper });
    if (!course) return res.json({ success: false, error: `Course ${courseIdUpper} not found` });
    const group = await CourseGroup.findByIdAndUpdate(
      req.params.id,
      { $addToSet: { courseIds: courseIdUpper } },
      { new: true }
    );
    if (!group) return res.json({ success: false, error: 'Group not found' });
    res.json({ success: true, group });
  } catch (err) { res.json({ success: false, error: err.message }); }
});

// PATCH remove a course from a group
app.patch('/admin-api/course-groups/:id/remove-course', express.json(), async (req, res) => {
  try {
    const { courseId, flush } = req.body;
    const cid = courseId.trim().toUpperCase();
    const group = await CourseGroup.findByIdAndUpdate(
      req.params.id,
      { $pull: { courseIds: cid } },
      { new: true }
    );
    if (!group) return res.json({ success: false, error: 'Group not found' });

    if (flush) {
      // Wiping students from this specific course
      await StudentCourse.deleteMany({ courseId: cid });
    }

    res.json({ success: true, group });
  } catch (err) { res.json({ success: false, error: err.message }); }
});

// DELETE a group
app.delete('/admin-api/course-groups/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { flush } = req.query;
    const group = await CourseGroup.findById(id);
    if (!group) return res.json({ success: false, error: 'Group not found' });

    if (flush === 'true') {
      await StudentCourse.deleteMany({ courseId: { $in: group.courseIds } });
    }

    await CourseGroup.findByIdAndDelete(id);
    res.json({ success: true, flushed: flush === 'true' });
  } catch (err) { res.json({ success: false, error: err.message }); }
});

// POST bulk enroll students from Excel into ALL courses in a group
app.post('/admin-api/course-groups/:id/enroll', upload.single('file'), async (req, res) => {
  try {
    const group = await CourseGroup.findById(req.params.id);
    if (!group) return res.json({ success: false, error: 'Group not found' });
    if (!group.courseIds.length) return res.json({ success: false, error: 'This group has no courses. Add courses first.' });
    if (!req.file) return res.json({ success: false, error: 'Excel file is required' });

    const workbook = XLSX.read(req.file.buffer, { type: 'buffer' });
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });

    if (rows.length < 2) return res.json({ success: false, error: 'Excel file is empty or has no data rows' });
    const header = rows[0].map(h => String(h).toLowerCase().trim());
    const emailCol = header.findIndex(h => h.includes('email') || h.includes('mail'));
    if (emailCol === -1) return res.json({ success: false, error: 'No email column found. Add a column header named "Email".' });

    const emails = [];
    for (let i = 1; i < rows.length; i++) {
      const raw = String(rows[i][emailCol] || '').trim().toLowerCase();
      if (raw && isValidEmail(raw)) emails.push(raw);
    }
    if (!emails.length) return res.json({ success: false, error: 'No valid email addresses found in the file.' });

    let inserted = 0, skipped = 0;
    for (const courseId of group.courseIds) {
      for (const email of emails) {
        try {
          await StudentCourse.create({ email, courseId });
          inserted++;
        } catch (e) {
          if (e.code === 11000) skipped++;
          else throw e;
        }
      }
    }

    res.json({
      success: true,
      message: `✅ Enrolled ${emails.length} students into ${group.courseIds.length} courses. ${inserted} new records added, ${skipped} already existed.`,
      inserted, skipped, students: emails.length, courses: group.courseIds.length,
    });
  } catch (err) { res.json({ success: false, error: err.message }); }
});

// ==========================================
// BACKGROUND JOB: LOW ATTENDANCE EMAIL ALERTS
// ==========================================
const DAILY_EMAIL_LIMIT = 400; // Safe limit per day
const DAYS_BETWEEN_ALERTS = 7; // Don't email same student for same course within 7 days

async function runAttendanceEmailJob() {
  if (!process.env.BREVO_API_KEY) {
    console.log('[MAILER] Missing BREVO_API_KEY. Skipping email alerts.');
    return;
  }

  try {
    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);
    const emailsSentToday = await EmailLog.countDocuments({ sentAt: { $gte: startOfDay } });
    
    if (emailsSentToday >= DAILY_EMAIL_LIMIT) {
      console.log(`[MAILER] Daily limit reached (${emailsSentToday}/${DAILY_EMAIL_LIMIT}). Suspended until tomorrow.`);
      return;
    }
    
    let quotaRemaining = DAILY_EMAIL_LIMIT - emailsSentToday;
    let sentInThisRun = 0;

    const enrollments = await StudentCourse.find({});
    if (enrollments.length === 0) return;

    const courseIds = [...new Set(enrollments.map(e => e.courseId))];
    const courses = await Course.find({ courseId: { $in: courseIds } });
    const courseMap = {};
    courses.forEach(c => courseMap[c.courseId] = { name: c.name });

    // Cache session counts per course to prevent DB spam
    const courseSessionCounts = {};
    const courseSessionIds = {};
    for (const cid of courseIds) {
      // Sessions follow the format "CS301 — Subject Name"
      const sessions = await Session.find({ name: new RegExp(`^${cid}\\s*[—-]`, 'i'), stoppedAt: { $ne: null } }, 'sessionId');
      courseSessionCounts[cid] = sessions.length;
      courseSessionIds[cid] = sessions.map(s => s.sessionId);
    }

    // Step 1: Group low attendance courses by student email
    const studentAlerts = {};

    for (const enrollment of enrollments) {
      const { email, courseId } = enrollment;
      const totalSessions = courseSessionCounts[courseId] || 0;
      
      // Don't alert if course just started (less than 3 sessions total)
      if (totalSessions < 3) continue;

      const attended = await Attendance.countDocuments({ email, sessionId: { $in: courseSessionIds[courseId] } });
      const percentage = Math.round((attended / totalSessions) * 100);

      if (percentage < ALERT_THRESHOLD) {
        if (!studentAlerts[email]) studentAlerts[email] = [];
        studentAlerts[email].push({ courseId, name: courseMap[courseId]?.name || courseId, percentage, attended, totalSessions });
      }
    }

    // Step 2: Send ALL low attendance data for a student in ONE single email
    for (const [email, alertCourses] of Object.entries(studentAlerts)) {
      if (quotaRemaining <= 0) break;

      const sevenDaysAgo = new Date();
      sevenDaysAgo.setDate(sevenDaysAgo.getDate() - DAYS_BETWEEN_ALERTS);

      const alertCourseIds = alertCourses.map(c => c.courseId);

      // Check if we already emailed this student about low attendance in the last 7 days
      const recentLog = await EmailLog.findOne({
        email,
        sentAt: { $gte: sevenDaysAgo }
      });

      if (!recentLog) {
        const coursesHtml = alertCourses.map(c => 
          `<li style="margin-bottom: 8px;">
            <strong>${c.courseId} - ${c.name}</strong>: <span style="color:#ef4444;">${c.percentage}%</span> <span style="color:#6b7280; font-size:14px;">(${c.attended}/${c.totalSessions} classes)</span>
          </li>`
        ).join('');

        const isMultiple = alertCourses.length > 1;
        const subject = isMultiple ? `⚠️ Low Attendance Warning: ${alertCourses.length} Subjects` : `⚠️ Low Attendance Warning: ${alertCourses[0].courseId}`;
        const html = `
            <div style="font-family: Arial, sans-serif; padding: 24px; max-width: 600px; border: 1px solid #e5e7eb; border-radius: 12px; margin: 0 auto;">
              <h2 style="color: #ef4444; margin-top: 0;">Attendance Alert</h2>
              <p>Hello,</p>
              <p>Your current attendance has fallen below the mandatory minimum of ${ALERT_THRESHOLD}% in the following course${isMultiple ? 's' : ''}:</p>
              
              <ul style="background: #f9fafb; padding: 16px 16px 16px 36px; border-radius: 8px; border: 1px solid #f3f4f6; font-size: 16px;">
                ${coursesHtml}
              </ul>

              <p>Please ensure you attend the remaining classes to avoid consequences at the end of the semester.</p>
              <br>
              <p style="font-size: 12px; color: #6b7280; border-top: 1px solid #e5e7eb; padding-top: 12px;">This is an automated message from A.E.G.I.S. Please do not reply.</p>
            </div>
          `;

        try {
          const mailRes = await sendEmail(email, subject, html);
          if (mailRes.success) {
            sentInThisRun++;
            quotaRemaining--;
          }
          
          // 2-second rate-limit throttle to avoid spam blocks
          await new Promise(resolve => setTimeout(resolve, 2000));
        } catch (mailErr) {
          console.error(`[MAILER] Failed to send to ${email}:`, mailErr.message);
        }
      }
    }
    
    if (sentInThisRun > 0) console.log(`[MAILER] Sent ${sentInThisRun} consolidated alerts.`);

  } catch (err) {
    console.error('[MAILER] Job error:', err);
  }
}

// ==========================================
// START SERVER
// ==========================================
app.listen(PORT, '0.0.0.0', () => {
  const ip = getLocalIP();
  console.log('  ║   🛡️   A.E.G.I.S — Attendance Server        ║');
  console.log('  ║   Automated Entry Geo-fenced ID System       ║');
  console.log('  ╠══════════════════════════════════════════════╣');
  console.log(`  ║  Local:   http://localhost:${PORT}             ║`);
  console.log(`  ║  Network: http://${ip}:${PORT}        ║`);
  console.log('  ╠══════════════════════════════════════════════╣');
  console.log(`  ║  Admin:   ${ADMIN_USER ? 'user=' + ADMIN_USER + ' pw=see env' : '⚠️  NOT SET'}          ║`);
  console.log('  ║  Storage: MongoDB Atlas 🍃                   ║');
  console.log('  ╚══════════════════════════════════════════════╝');
  console.log('');

  if (!process.env.RENDER_EXTERNAL_URL) {
    process.env.RENDER_EXTERNAL_URL = 'https://aegis-server-02y5.onrender.com';
  }

  // Connect to MongoDB in background (HTTP server already running)
  connectDB().then(() => {
    // Auto-close sessions that exceed their set duration (or 10 min default)
    setInterval(async () => {
      try {
        const nowMs = Date.now();
        const expiredSessions = await Session.find({ active: true });
        for (const s of expiredSessions) {
          const duration = s.durationMs || 10 * 60 * 1000;
          if (nowMs - s.sessionId > duration) {
            s.active = false;
            s.stoppedAt = new Date(s.sessionId + duration);
            await s.save();
            console.log(`[AUTO-CLOSE] Session ${s.name} closed`);
          }
        }
      } catch (e) {
        console.error('Auto-close error:', e.message);
      }
    }, 10000);

    setInterval(flushAttendanceBuffer, 3000);
    setInterval(runAttendanceEmailJob, 6 * 60 * 60 * 1000);
    setTimeout(runAttendanceEmailJob, 2 * 60 * 1000);
  });
});

// ==========================================
// GLOBAL CRASH GUARDS
// ==========================================
process.on('uncaughtException', (err) => {
  console.error('  ❌  Uncaught Exception (server kept alive):', err.message);
});
process.on('unhandledRejection', (reason) => {
  console.error('  ❌  Unhandled Rejection (server kept alive):', reason);
});
