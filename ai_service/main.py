from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
from contextlib import asynccontextmanager
import base64
import numpy as np
from deepface import DeepFace
import cv2
import os
from scipy.fftpack import fft2, fftshift

# ─────────────────────────────────────────
# CONFIG (v6.0 Advanced Edition)
# ─────────────────────────────────────────
MODEL_NAME = "ArcFace"      # SOTA recognition
DETECTOR   = "retinaface"   # SOTA detection
THRESHOLD  = 0.60           # Relaxed for glasses/accessories tolerance
MIN_CONFIDENCE = 0.85
LEARNING_RATE = 0.1

@asynccontextmanager
async def lifespan(app: FastAPI):
    print(f"⏳ Hugging Face: Preloading {MODEL_NAME} + {DETECTOR}...")
    # Pre-load models into RAM to prevent timeout on first request
    dummy = np.zeros((160, 160, 3), dtype=np.uint8)
    try:
        DeepFace.represent(img_path=dummy, model_name=MODEL_NAME, detector_backend=DETECTOR, enforce_detection=False)
    except Exception as e: 
        print(f"Preload warning: {e}")
    print("✅ Advanced AI Models Ready!")
    yield

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

def check_static_content(image_list):
    """
    Checks if multiple frames are identical (Static Content).
    If pixel variance between frames is near zero, it's likely a photo or a static file.
    """
    if not isinstance(image_list, list) or len(image_list) < 2:
        return False, 0.0
    
    try:
        frames = [decode_image(img) for img in image_list[:3]]
        # Calculate mean absolute difference between first and last frame
        diff = cv2.absdiff(frames[0], frames[-1])
        mean_diff = np.mean(diff)
        
        # If the average pixel change is less than 0.5, it's essentially a still image
        return mean_diff < 0.5, mean_diff
    except:
        return False, 0.0

def detect_moire_patterns(img):
    """
    Advanced Anti-Spoofing: Frequency Domain Analysis (FFT).
    Screens (LCD/OLED) have a periodic pixel grid that creates high-frequency 
    spikes (Moire patterns) not found in human skin.
    """
    gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
    f = fft2(gray)
    fshift = fftshift(f)
    magnitude_spectrum = 20 * np.log(np.abs(fshift) + 1)
    
    # Calculate high-frequency energy ratio
    h, w = magnitude_spectrum.shape
    center_h, center_w = h // 2, w // 2
    
    # Mask out the low frequencies (center of the spectrum)
    inner_radius = min(h, w) // 10
    magnitude_spectrum[center_h-inner_radius:center_h+inner_radius, center_w-inner_radius:center_w+inner_radius] = 0
    
    # Energy in high frequency
    high_freq_energy = np.sum(magnitude_spectrum)
    total_pixels = h * w
    normalized_energy = high_freq_energy / total_pixels
    
    # Threshold for Moire detection: Screens usually score > 15
    return normalized_energy > 15.0, normalized_energy

def detect_spoofing(img):
    """
    Hybrid Spoofing Detection: 
    1. Laplacian Variance (Blur/Resolution check)
    2. Moire Pattern detection (Screen pixel grid check)
    """
    gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
    variance = cv2.Laplacian(gray, cv2.CV_64F).var()
    
    is_moire, moire_score = detect_moire_patterns(img)
    
    # Rejection logic
    is_spoof = (variance < 90) or is_moire
    return is_spoof, variance, moire_score

@app.get("/")
async def root():
    return {
        "message": "AEGIS AI Service v6.0 (Advanced Security)",
        "engine": "ArcFace",
        "detector": "RetinaFace",
        "security": "FFT + Laplacian"
    }

@app.get("/health")
async def health():
    return {"status": "ok"}

@app.post("/extract-embedding")
async def extract_embedding(req: FaceRequest):
    try:
        img_data = req.image
        img = decode_image(img_data)
        
        # 1. Check for Static Content (Photo-of-Photo detection)
        is_static, _ = check_static_content(img_data)
        if is_static:
            raise HTTPException(status_code=400, detail="Registration rejected: Liveness failed (Static Content detected).")

        is_spoof, var, moire = detect_spoofing(img)
        if is_spoof:
            raise HTTPException(status_code=400, detail="Registration rejected: Liveness check failed (Potential Spoof).")

        results = DeepFace.represent(img_path=img, model_name=MODEL_NAME, detector_backend=DETECTOR, enforce_detection=True)
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
        
        # Decode and analyze ALL frames
        frames = []
        clarity_scores = []
        for b64 in img_data[:3]:
            img = decode_image(b64)
            # Simple clarity check using Laplacian variance
            gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
            clarity = cv2.Laplacian(gray, cv2.CV_64F).var()
            frames.append(img)
            clarity_scores.append(clarity)

        # 1. MOTION ANALYSIS (Liveness)
        # Compare first and last frame for micro-movement
        diff = cv2.absdiff(frames[0], frames[-1])
        motion_score = np.mean(diff)
        
        is_static = motion_score < 0.4  # ZERO Movement (Photo/Screen)
        is_erratic = motion_score > 45.0 # TOO MUCH Movement (Video replay/Glitch)
        
        # 2. BEST FRAME SELECTION
        # Pick the clearest frame for the actual identity match
        best_idx = np.argmax(clarity_scores)
        best_img = frames[best_idx]
        best_clarity = clarity_scores[best_idx]

        # 3. SPOOFING CHECK (Moire/Blur on best frame)
        is_moire, moire_score = detect_moire_patterns(best_img)
        is_spoof = (best_clarity < 85) or is_moire

        # 4. RECOGNITION (Using Best Frame)
        results = DeepFace.represent(img_path=best_img, model_name=MODEL_NAME, detector_backend=DETECTOR, enforce_detection=True)
        new_emb = np.array(results[0]["embedding"])
        
        gold_emb = np.array(req.golden_embedding)
        act_emb  = np.array(req.active_embedding)

        def cosine_similarity(a, b):
            return np.dot(a, b) / (np.linalg.norm(a) * np.linalg.norm(b))

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
            flag_reason = f"SPOOF_ALERT: Screen/Moire={moire_score:.1f}, Clarity={best_clarity:.1f}"
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
            "anti_spoofing": {"clarity": best_clarity, "moire": moire_score, "motion": motion_score}
        }
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))
