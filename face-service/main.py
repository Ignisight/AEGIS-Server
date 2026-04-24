from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
from contextlib import asynccontextmanager
import base64
import numpy as np
from deepface import DeepFace
import cv2
import os

# ─────────────────────────────────────────
# CONFIG
# ─────────────────────────────────────────
MODEL_NAME = "Facenet"   # Lighter version (128d) for 512MB RAM compatibility
DETECTOR   = "opencv"
THRESHOLD  = 0.40        # Adjusted threshold for standard Facenet
MIN_CONFIDENCE = 0.85
LEARNING_RATE = 0.1

# ─────────────────────────────────────────
# PRELOAD MODEL ON STARTUP
# Saves 800ms on first real request
# ─────────────────────────────────────────
@asynccontextmanager
async def lifespan(app: FastAPI):
    print("⏳ Preloading FaceNet512 model...")
    # Create a small dummy image for initial loading
    dummy = np.zeros((160, 160, 3), dtype=np.uint8)
    try:
        DeepFace.represent(
            img_path=dummy,
            model_name=MODEL_NAME,
            detector_backend=DETECTOR,
            enforce_detection=False,
        )
    except Exception:
        pass  # expected on blank image — model is loaded
    print("✅ Model ready.")
    yield

app = FastAPI(lifespan=lifespan)

# ─────────────────────────────────────────
# MODELS
# ─────────────────────────────────────────
class FaceRequest(BaseModel):
    image: str

class VerifyRequest(BaseModel):
    image: str
    golden_embedding: list    # never changes
    active_embedding: list    # current working template
    update_count: int         # how many updates so far
    last_update_date: str     # YYYY-MM-DD, for rate limiting
    flagged: bool             # if account is flagged

# ─────────────────────────────────────────
# HELPERS
# ─────────────────────────────────────────
def decode_image(b64: str):
    if "," in b64:
        b64 = b64.split(",")[1]
    arr = np.frombuffer(base64.b64decode(b64), np.uint8)
    img = cv2.imdecode(arr, cv2.IMREAD_COLOR)
    if img is None:
        raise ValueError("Could not decode image")
    return img

def get_embedding(img):
    result = DeepFace.represent(
        img_path=img,
        model_name=MODEL_NAME,
        detector_backend=DETECTOR,
        enforce_detection=True,
        align=True,
    )
    if not result:
        raise HTTPException(400, "No face detected")
    if len(result) > 1:
        raise HTTPException(400,
            "Multiple faces detected. "
            "Ensure only your face is visible.")
    conf = result[0].get("face_confidence", 1.0)
    if conf < MIN_CONFIDENCE:
        raise HTTPException(400,
            "Face not clear enough. "
            "Try better lighting.")
    return np.array(result[0]["embedding"]), conf

def cosine_similarity(a: np.ndarray, b: np.ndarray) -> float:
    norm = np.linalg.norm(a) * np.linalg.norm(b)
    if norm == 0:
        return 0.0
    return float(np.dot(a, b) / norm)

def cosine_distance(a: np.ndarray, b: np.ndarray) -> float:
    return 1.0 - cosine_similarity(a, b)

def blend_embeddings(
    old: np.ndarray,
    new: np.ndarray,
    rate: float = LEARNING_RATE
) -> np.ndarray:
    """Weighted average — nudges old toward new."""
    blended = (old * (1 - rate)) + (new * rate)
    # Renormalize to unit vector
    norm = np.linalg.norm(blended)
    return blended / norm if norm > 0 else blended

# ─────────────────────────────────────────
# ROUTES
# ─────────────────────────────────────────
@app.get("/health")
async def health():
    return {"status": "ok", "model": MODEL_NAME}

@app.post("/extract-embedding")
async def extract_embedding(req: FaceRequest):
    """
    Called once on first registration.
    Returns 512-float embedding to store in Supabase.
    """
    img = decode_image(req.image)
    embedding, confidence = get_embedding(img)
    return {
        "success": True,
        "embedding": embedding.tolist(),
        "face_confidence": confidence,
    }

@app.post("/verify-face")
async def verify_face(req: VerifyRequest):
    """
    Called on every attendance scan.
    Compares new photo against BOTH golden and active embeddings.
    """
    img = decode_image(req.image)
    new_embedding, _ = get_embedding(img)

    # Convert all to numpy arrays
    new_v    = np.array(new_embedding)
    golden_v = np.array(req.golden_embedding)
    active_v = np.array(req.active_embedding)

    # 1. Similarity with Golden (original identity)
    sim_golden = cosine_similarity(new_v, golden_v)
    
    # 2. Similarity with Active (latest learned template)
    sim_active = cosine_similarity(new_v, active_v)

    # Calculate drift: how much has the current face moved away from the original golden template?
    drift = round(cosine_distance(golden_v, active_v), 4)

    # Match logic: must match at least one template above threshold
    is_match = (sim_active >= THRESHOLD) or (sim_golden >= THRESHOLD)

    # Security flagging:
    # If it matches the 'active' template but similarity with 'golden' is very low, 
    # it might be a slow 'morph' or proxy swap.
    should_flag = False
    flag_reason = None
    if is_match and sim_golden < (THRESHOLD - 0.15):
        should_flag = True
        flag_reason = "Significant template drift detected. Requires manual review."

    # Adaptive Update:
    # If it's a very high confidence match, we can blend it into the active template
    # to account for natural aging, hair changes, etc.
    updated_active = active_v.tolist()
    if is_match and sim_active > 0.85 and not should_flag:
        new_active_v = blend_embeddings(active_v, new_v, rate=LEARNING_RATE)
        updated_active = new_active_v.tolist()

    return {
        "success": True,
        "match": is_match,
        "similarity": round(max(sim_active, sim_golden), 4),
        "score_active": round(sim_active, 4),
        "score_golden": round(sim_golden, 4),
        "drift": drift,
        "should_flag": should_flag,
        "flag_reason": flag_reason,
        "threshold": THRESHOLD,
        "updated_active": updated_active
    }
