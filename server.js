// =============================================
// Attendance System — MongoDB Atlas Edition
// =============================================

process.env.TZ = 'Asia/Kolkata';

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
const winston = require('winston');

// [OBSERVABILITY] Structured Logging Pipeline
const logger = winston.createLogger({
  level: 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.json()
  ),
  transports: [
    new winston.transports.Console({
      format: winston.format.combine(
        winston.format.colorize({ all: true }),
        winston.format.printf(info => `[${info.timestamp}] ${info.level}: ${info.message}`)
      )
    }),
    new winston.transports.File({ filename: 'logs/error.log', level: 'error' }),
    // Optimized: Only store critical errors in the production file to save memory/storage
  ]
});

// For an immediate, global win on structured logs across this monolithic file
console.log = (...args) => logger.info(args.join(' '));
console.error = (...args) => logger.error(args.join(' '));
console.warn = (...args) => logger.warn(args.join(' '));

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
    if (res.ok) return { success: true };
    if (res.status === 429) return { success: false, error: 'Daily email limit reached. Please try again tomorrow.' };
    console.error('Brevo API error:', data);
    return { success: false, error: data.message || 'Email send failed.' };
  } catch (err) {
    console.error('Email send error:', err.message);
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
  sessionId:    { type: Number,  required: true, unique: true, index: true },
  name:         { type: String,  required: true },
  code:         { type: String,  required: true, unique: true, index: true },
  teacherEmail: { type: String,  default: '', lowercase: true },
  createdAt:    { type: Date,    default: Date.now },
  active:       { type: Boolean, default: true, index: true },
  stoppedAt:    { type: Date,    default: null },
  lat:          { type: Number,  default: null },
  lon:          { type: Number,  default: null },
  radius:       { type: Number,  default: 80   },  // geofence radius in metres
  durationMs:   { type: Number,  default: null },  // null = use 10-min auto-close default
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

// Location Events (student entry/exit flips — retained 7 days)
const LocationEventSchema = new mongoose.Schema({
  email:       { type: String, required: true, lowercase: true, index: true },
  deviceId:    { type: String, required: true },
  sessionCode: { type: String, required: true, index: true },
  eventType:   { type: String, enum: ['entry', 'exit'], required: true },
  lat:         { type: Number },
  lon:         { type: Number },
  timestamp:   { type: Date, default: Date.now },
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
      process.env.RENDER_EXTERNAL_URL || 'https://attendance-server-ddgs.onrender.com',
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

// DB ready guard — wait up to 45s if MongoDB is still connecting (Render cold-start)
app.use(async (req, res, next) => {
  if (dbReady) return next();

  let attempts = 0;
  // 90 attempts * 500ms = 45 seconds wait time
  while (!dbReady && attempts < 90) {
    await new Promise(r => setTimeout(r, 500));
    attempts++;
  }

  if (!dbReady) {
    // Return appropriate format based on request type
    if (req.path.startsWith('/api/') || req.method === 'POST') {
      return res.status(503).json({ success: false, error: 'Database connection is taking too long to wake up. Please try again.' });
    } else {
      return res.status(503).send('<h1>Server starting up...</h1><p>The database is waking up. Please refresh the page in a few seconds.</p>');
    }
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
  // FIX: Validate email format before hitting database (Issue #5)
  if (!isValidEmail(email))
    return res.status(400).json({ success: false, error: 'Invalid email format.' });

  const emailLower = email.toLowerCase().trim();
  const existing = await Teacher.findOne({ email: emailLower });
  if (existing)
    return res.json({ success: false, error: 'An account with this email already exists' });

  if (password.length < 4)
    return res.json({ success: false, error: 'Password must be at least 4 characters' });

  const hashedPassword = await bcrypt.hash(password, 10);
  // Keep domain optional: if not provided, leave empty to allow all student domains
  const finalDomain = (allowedDomain && allowedDomain.trim()) ? allowedDomain.replace(/@/g, '').trim().toLowerCase() : '';

  await Teacher.create({
    id: Date.now(),
    email: emailLower,
    name: name.trim(),
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
    lat:              activeSession.lat,
    lon:              activeSession.lon,
    radius:           activeSession.radius || 80,
    sessionDurationMs: SESSION_DURATION_MS,
  });
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
    radius:     radius     || 80,     // metres — default 80 m
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
    email:       emailLower,
    deviceId,
    sessionCode,
    eventType,
    lat:       lat  || null,
    lon:       lon  || null,
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

app.get('/', (req, res) => res.redirect('/admin'));

app.get('/admin', (req, res) => {
  res.setHeader('Cache-Control', 'no-cache');
  const adminPath = path.join(__dirname, 'public', 'admin.html');
  if (fs.existsSync(adminPath)) {
    res.sendFile(adminPath);
  } else {
    res.status(404).send('<h1>Admin Panel Not Found</h1><p>Expected file at: ' + adminPath + '</p>');
  }
});

// Use express.json() if it's not applied globally to admin-api
app.post('/admin-api/login', express.json(), (req, res) => {
  const { username, password } = req.body;
  if (username === ADMIN_USER && password === ADMIN_PASSWORD) {
    res.json({ success: true });
  } else {
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
    res.json({ success: true, teachers, students });
  } catch (err) {
    res.json({ success: false, error: err.message });
  }
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
    const [tCount, sCount, aCount, dCount] = await Promise.all([
      Teacher.estimatedDocumentCount(),
      Session.estimatedDocumentCount(),
      Attendance.estimatedDocumentCount(),
      Device.estimatedDocumentCount()
    ]);
    const dbLatency = Date.now() - start;

    // Last 7 days attendance trend
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
    
    // Powerful MongoDB Aggregation to offload processing from Node.js Event Loop
    const pipeline = [
      { $match: { submittedAt: { $gte: sevenDaysAgo } } },
      {
        $facet: {
          branches: [
            { $group: { _id: { $ifNull: ["$branch", "Unknown"] }, count: { $sum: 1 } } }
          ],
          years: [
            { $group: { _id: { $ifNull: ["$year", "Unknown"] }, count: { $sum: 1 } } }
          ],
          hourly: [
            { $project: { hour: { $hour: { date: "$submittedAt" } } } },
            { $group: { _id: "$hour", count: { $sum: 1 } } }
          ]
        }
      }
    ];

    const aggResult = await Attendance.aggregate(pipeline);
    const result = aggResult[0] || { branches: [], years: [], hourly: [] };

    // Format output
    const branchStats = {};
    result.branches.forEach(b => branchStats[b._id || 'Unknown'] = b.count);

    const yearStats = {};
    result.years.forEach(y => yearStats[y._id || 'Unknown'] = y.count);

    const hourlyDistribution = Array(24).fill(0);
    result.hourly.forEach(h => {
      if (h._id >= 0 && h._id < 24) hourlyDistribution[h._id] = h.count;
    });

    cachedStats = {
      counts: { teachers: tCount, sessions: sCount, attendance: aCount, devices: dCount },
      performance: {
        uptime: Math.floor(process.uptime()),
        dbLatency,
        memoryUsage: Math.floor(process.memoryUsage().heapUsed / 1024 / 1024)
      },
      distribution: {
        branches: branchStats,
        years: yearStats,
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
    // Also mark their active sessions as stopped
    await Session.updateMany({ teacherEmail: email, active: true }, { active: false, stoppedAt: new Date() });
    res.json({ success: true, message: 'Teacher deleted' });
  } catch (err) {
    res.json({ success: false, error: err.message });
  }
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

// ==========================================
// START SERVER
// ==========================================
app.listen(PORT, '0.0.0.0', () => {
  const ip = getLocalIP();
  console.log('');
  console.log('  ╔══════════════════════════════════════════════╗');
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
    process.env.RENDER_EXTERNAL_URL = 'https://attendance-server-ddgs.onrender.com';
  }

  // Connect to MongoDB in background (HTTP server already running)
  connectDB().then(() => {
    // Auto-close sessions that exceed their set duration (or 10 min default)
    setInterval(async () => {
      try {
        const nowMs = Date.now();
        const expiredSessions = await Session.find({ active: true });
        for (const s of expiredSessions) {
          const duration = s.durationMs || 10 * 60 * 1000; // teacher-set or 10 min default
          if (nowMs - s.sessionId > duration) {
            s.active = false;
            s.stoppedAt = new Date(s.sessionId + duration);
            await s.save();
            console.log(`[AUTO-CLOSE] Session ${s.name} closed after ${duration / 60000} min`);
          }
        }
      } catch (e) {
        console.error('Auto-close interval error:', e.message);
      }
    }, 10000);

    // [Performance] Flush attendance buffer to database every 3 seconds
    setInterval(flushAttendanceBuffer, 3000);
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
