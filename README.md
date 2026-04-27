# 🖥️ A.E.G.I.S Backend — Security & AI Orchestrator

This is the core backend for the A.E.G.I.S ecosystem. It handles data persistence, authentication, biometric template management, and acts as a high-speed proxy to the Python AI microservice.

## ⚙️ Core Architecture

### 1. Node.js Main Server
*   **Performance**: Uses MongoDB Aggregation pipelines to deliver 6 months of attendance history in milliseconds.
*   **Integrity**: Implements strict request signature verification (SHA-256) for student attendance submissions.
*   **Database**: Hybrid storage using **MongoDB Atlas** (Sessions/Users) and **Supabase** (Biometric Embeddings).

### 2. Python AI Service (Anti-Proxy)
*   **Deep Learning**: Powered by `DeepFace` with the `ArcFace` model and `RetinaFace` detector.
*   **Liveness Engine**: Analyzes frame-to-frame pixel variance (MSE) to detect static photos.
*   **Frequency Analysis**: Uses FFT (Fast Fourier Transform) to detect Moire patterns from LCD/OLED screens.

## 📡 API Endpoints

### Student Flow
*   `POST /api/student/verify-face`: Proxy to AI service for biometric match + liveness.
*   `POST /api/student/submit`: Final attendance record with GPS & signature validation.
*   `GET /api/history`: Optimized 6-month attendance history.

### Teacher Flow
*   `POST /api/session/start`: Initializes a new geo-fenced classroom session.
*   `GET /api/responses/:sessionId`: Real-time student verification logs.

### Admin Flow (Web Dashboard)
*   **Access**: Navigate to `/admin/` (e.g., `http://localhost:3000/admin/` or your Render deployment URL).
*   **Features**: Whitelist teachers, manage biometric records, flag suspicious accounts, and view system analytics.


## 🚀 Deployment

### Requirements
*   Node.js 18+
*   MongoDB Atlas URI
*   Supabase URL & Service Key
*   Python 3.9+ (for AI Service)

### Setup
1. Set up your `.env` file (see `.env.example`).
2. Install Node dependencies: `npm install`
3. Install Python dependencies: `pip install -r requirements.txt`
4. Start the server: `npm start`

## 🛡️ Identity Logic
A.E.G.I.S uses an **Adaptive Template** system. When a student verifies with extremely high confidence (>0.85), their "Active Embedding" is slightly updated (weighted average) to account for natural changes in appearance over time (haircuts, aging, etc.), while the "Golden Record" remains fixed for permanent security.

---
**Secure Attendance System — NIT Jamshedpur** 🏛️
