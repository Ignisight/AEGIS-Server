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
MODEL_NAME = "Facenet512"
DETECTOR   = "opencv"
THRESHOLD  = 0.68
MIN_CONFIDENCE = 0.85

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
    image: str                 # base64 image

class VerifyRequest(BaseModel):
    image: str                 # base64 image
    stored_embedding: list     # 512 floats from Supabase

# ─────────────────────────────────────────
# HELPERS
# ─────────────────────────────────────────
def decode_image(b64: str):
    """Convert base64 string to numpy image."""
    try:
        if "," in b64:
            b64 = b64.split(",")[1]
        img_bytes = base64.b64decode(b64)
        arr = np.frombuffer(img_bytes, np.uint8)
        img = cv2.imdecode(arr, cv2.IMREAD_COLOR)
        if img is None:
            raise ValueError("Could not decode image")
        return img
    except Exception as e:
        raise HTTPException(400, f"Invalid image data: {str(e)}")

def get_embedding(img):
    """Extract face embedding. Raises on no face or multiple faces."""
    try:
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
        
        confidence = result[0].get("face_confidence", 1.0)
        if confidence < MIN_CONFIDENCE:
            raise HTTPException(400,
                "Face not clear enough. "
                "Try better lighting and face camera directly.")
        
        return result[0]["embedding"], confidence
    except Exception as e:
        msg = str(e)
        if "Face could not be detected" in msg:
            raise HTTPException(400, "No face detected. Ensure good lighting.")
        raise HTTPException(500, f"DeepFace error: {msg}")

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
        "embedding": embedding,
        "face_confidence": confidence,
    }

@app.post("/verify-face")
async def verify_face(req: VerifyRequest):
    """
    Called on every attendance scan.
    Compares new photo against stored embedding.
    """
    img = decode_image(req.image)
    new_embedding, _ = get_embedding(img)

    # Cosine similarity calculation
    a = np.array(new_embedding)
    b = np.array(req.stored_embedding)
    
    # Safety check for shape
    if a.shape != b.shape:
        raise HTTPException(400, f"Embedding shape mismatch: {a.shape} vs {b.shape}")

    similarity = float(
        np.dot(a, b) / 
        (np.linalg.norm(a) * np.linalg.norm(b))
    )

    return {
        "success": True,
        "match": similarity >= THRESHOLD,
        "similarity": round(similarity, 4),
        "threshold": THRESHOLD,
    }
