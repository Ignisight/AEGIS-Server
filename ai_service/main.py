from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
from contextlib import asynccontextmanager
import base64
import numpy as np
from deepface import DeepFace
import cv2
import os
import asyncio
from concurrent.futures import ThreadPoolExecutor

# ─────────────────────────────────────────
# CONFIG (v7.0 Performance Edition)
# ─────────────────────────────────────────
MODEL_NAME = "ArcFace"      # SOTA recognition
DETECTOR   = "ssd"          # 5x faster than RetinaFace on CPU, still accurate
THRESHOLD  = 0.60           # Relaxed for glasses/accessories tolerance
MIN_CONFIDENCE = 0.80       # Slightly relaxed for faster detector
LEARNING_RATE = 0.1
MAX_IMG_DIM = 640           # Downscale large images for speed

# Thread pool for CPU-bound inference (process multiple requests concurrently)
executor = ThreadPoolExecutor(max_workers=3)

@asynccontextmanager
async def lifespan(app: FastAPI):
    print(f"⏳ Hugging Face: Preloading {MODEL_NAME} + {DETECTOR}...")
    # Pre-load models into RAM to prevent timeout on first request
    dummy = np.zeros((160, 160, 3), dtype=np.uint8)
    try:
        DeepFace.represent(img_path=dummy, model_name=MODEL_NAME, detector_backend=DETECTOR, enforce_detection=False)
    except Exception as e: 
        print(f"Preload warning: {e}")
    print("✅ Performance AI Models Ready!")
    yield
    executor.shutdown(wait=False)

app = FastAPI(lifespan=lifespan)

class FaceRequest(BaseModel):
    image: str | list[str]

class VerifyRequest(BaseModel):
    image: str | list[str] = ""
    images: list[str] = [] # Support both legacy and burst
    golden_embedding: list
    active_embedding: list
    update_count: int = 0
    last_update_date: str = ""
    flagged: bool = False
    liveness_verified: bool = False

def decode_image(data):
    # Handle both single image string and list of images
    b64 = data[0] if isinstance(data, list) else data
    if "," in b64: b64 = b64.split(",")[1]
    arr = np.frombuffer(base64.b64decode(b64), np.uint8)
    img = cv2.imdecode(arr, cv2.IMREAD_COLOR)
    if img is None: raise ValueError("Invalid image data")
    return img

def resize_for_speed(img):
    """Downscale large images to save CPU while keeping face detail."""
    h, w = img.shape[:2]
    if max(h, w) > MAX_IMG_DIM:
        scale = MAX_IMG_DIM / max(h, w)
        img = cv2.resize(img, (int(w * scale), int(h * scale)), interpolation=cv2.INTER_AREA)
    return img

def check_static_content(image_list):
    """
    Checks if multiple frames are identical (Static Content).
    If pixel variance between frames is near zero, it's likely a photo or a static file.
    """
    if not isinstance(image_list, list) or len(image_list) < 2:
        return False, 0.0
    
    try:
        # Only decode first and last frame (skip middle for speed)
        first = resize_for_speed(decode_image(image_list[0]))
        last = resize_for_speed(decode_image(image_list[-1]))
        diff = cv2.absdiff(first, last)
        mean_diff = np.mean(diff)
        
        # If the average pixel change is less than 0.5, it's essentially a still image
        return mean_diff < 0.5, mean_diff
    except:
        return False, 0.0

def detect_spoofing_fast(img):
    """
    Lightweight Spoofing Detection (optimized for CPU):
    1. Laplacian Variance (Blur/Resolution check)
    2. Color histogram analysis (screens have unnatural color distribution)
    """
    gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
    variance = cv2.Laplacian(gray, cv2.CV_64F).var()
    
    # Simple screen detection: check for unnatural color uniformity
    # Screens tend to have very uniform brightness in background regions
    hsv = cv2.cvtColor(img, cv2.COLOR_BGR2HSV)
    saturation_std = np.std(hsv[:,:,1])
    
    # Low blur variance = photo/print, very low saturation variance = screen
    is_spoof = (variance < 90) or (saturation_std < 15)
    return is_spoof, variance, saturation_std

def _sync_extract(img):
    """Run DeepFace in thread pool to not block the event loop."""
    return DeepFace.represent(
        img_path=img,
        model_name=MODEL_NAME,
        detector_backend=DETECTOR,
        enforce_detection=True
    )

@app.get("/")
async def root():
    return {
        "message": "AEGIS AI Service v7.0 (Performance Edition)",
        "engine": "ArcFace",
        "detector": "SSD (5x faster)",
        "security": "Laplacian + HSV + Motion"
    }

@app.get("/health")
async def health():
    return {"status": "ok"}

@app.post("/extract-embedding")
async def extract_embedding(req: FaceRequest):
    try:
        img_data = req.image
        img = decode_image(img_data)
        img = resize_for_speed(img)
        
        # 1. Check for Static Content (Photo-of-Photo detection)
        is_static, _ = check_static_content(img_data)
        if is_static:
            raise HTTPException(status_code=400, detail="Registration rejected: Liveness failed (Static Content detected).")

        is_spoof, var, sat = detect_spoofing_fast(img)
        if is_spoof:
            raise HTTPException(status_code=400, detail="Registration rejected: Liveness check failed (Potential Spoof).")

        # Run inference in thread pool for async concurrency
        loop = asyncio.get_event_loop()
        results = await loop.run_in_executor(executor, _sync_extract, img)
        res = results[0]
        if res["face_confidence"] < MIN_CONFIDENCE:
            raise HTTPException(status_code=400, detail="Face not clear enough")
        return {"embedding": res["embedding"], "face_confidence": res["face_confidence"]}
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))

@app.post("/verify-face")
async def verify_face(req: VerifyRequest):
    try:
        # Unified image source handling
        if req.images and len(req.images) > 0:
            img_data = req.images
        elif isinstance(req.image, list):
            img_data = req.image
        else:
            img_data = [req.image]
        
        # OPTIMIZATION: Quick motion analysis using only first+last frame (skip full decode of middle)
        motion_score = 0.0
        if len(img_data) >= 2:
            first = resize_for_speed(decode_image(img_data[0]))
            last = resize_for_speed(decode_image(img_data[-1]))
            diff = cv2.absdiff(first, last)
            motion_score = np.mean(diff)
        
        is_static = motion_score < 0.4   # ZERO Movement (Photo/Screen)
        is_erratic = motion_score > 45.0  # TOO MUCH Movement (Video replay/Glitch)
        
        # OPTIMIZATION: Only decode + analyze the BEST frame (pick middle for stability)
        best_idx = len(img_data) // 2 if len(img_data) > 1 else 0
        best_img = resize_for_speed(decode_image(img_data[best_idx]))
        
        # Clarity check on best frame only
        gray = cv2.cvtColor(best_img, cv2.COLOR_BGR2GRAY)
        best_clarity = cv2.Laplacian(gray, cv2.CV_64F).var()

        # Lightweight spoofing check (replaces expensive FFT)
        is_spoof, _, sat_score = detect_spoofing_fast(best_img)

        # RECOGNITION (Using Best Frame — run in thread pool)
        loop = asyncio.get_event_loop()
        results = await loop.run_in_executor(executor, _sync_extract, best_img)
        new_emb = np.array(results[0]["embedding"])
        
        gold_emb = np.array(req.golden_embedding)
        act_emb  = np.array(req.active_embedding)

        # Vectorized cosine similarity (numpy is fast)
        def cosine_similarity(a, b):
            return float(np.dot(a, b) / (np.linalg.norm(a) * np.linalg.norm(b)))

        score_golden = cosine_similarity(new_emb, gold_emb)
        score_active = cosine_similarity(new_emb, act_emb)
        drift        = cosine_similarity(act_emb, gold_emb)

        verified = (score_golden > THRESHOLD) or (score_active > THRESHOLD)
        
        # 5. SECURITY DECISION
        should_flag = False
        flag_reason = None
        
        if is_static:
            should_flag = True
            flag_reason = "SPOOF_ALERT: Static Content (Photo detected)"
            verified = False
        elif is_erratic:
            should_flag = True
            flag_reason = "SPOOF_ALERT: Erratic Motion (Video replay detected)"
            verified = False
        elif is_spoof:
            should_flag = True
            flag_reason = f"SPOOF_ALERT: Clarity={best_clarity:.1f}, Saturation={sat_score:.1f}"
            verified = False 
            
        if not req.liveness_verified:
            should_flag = True
            flag_reason = "SEC_BYPASS: App-side signal missing."
            verified = False 

        if drift < 0.78:
            should_flag = True
            flag_reason = f"BIOMETRIC_DRIFT: Score {drift:.2f}"

        # Adaptive update
        updated_active = None
        if verified and not should_flag and not req.flagged:
            updated_active = (act_emb * (1 - LEARNING_RATE) + new_emb * LEARNING_RATE).tolist()

        return {
            "success": True,
            "verified": bool(verified),
            "match": bool(verified),
            "score_golden": float(score_golden),
            "score_active": float(score_active),
            "drift": float(drift),
            "should_flag": should_flag,
            "flag_reason": flag_reason,
            "updated_active": updated_active,
            "anti_spoofing": {"clarity": best_clarity, "saturation_std": sat_score, "motion": motion_score}
        }
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))
