from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
from contextlib import asynccontextmanager
import base64
import numpy as np
from deepface import DeepFace
import cv2
import os
import tempfile
from typing import Optional

# ─────────────────────────────────────────
# CONFIG (v7.1 Memory-Safe)
# ─────────────────────────────────────────
MODEL_NAME = "ArcFace"      
DETECTOR   = "opencv"       
THRESHOLD  = 0.68           
LEARNING_RATE = 0.1
MAX_IMG_SIZE = 480  # Resize to save memory

@asynccontextmanager
async def lifespan(app: FastAPI):
    print(f"⏳ Preloading {MODEL_NAME}...")
    dummy = np.zeros((160, 160, 3), dtype=np.uint8)
    try:
        DeepFace.represent(img_path=dummy, model_name=MODEL_NAME, detector_backend=DETECTOR, enforce_detection=False)
    except Exception as e: 
        print(f"Preload warning: {e}")
    print("✅ AEGIS AI v7.1 Ready!")
    yield

app = FastAPI(lifespan=lifespan)

class FaceRequest(BaseModel):
    images: Optional[list[str]] = None
    video: Optional[str] = None

class VerifyRequest(BaseModel):
    images: Optional[list[str]] = None
    video: Optional[str] = None
    golden_embedding: list
    active_embedding: list
    update_count: int = 0
    last_update_date: str = ""
    flagged: bool = False
    liveness_verified: bool = False

def decode_image(b64):
    """Decode base64 image and resize to save memory."""
    if "," in b64: b64 = b64.split(",")[1]
    arr = np.frombuffer(base64.b64decode(b64), np.uint8)
    img = cv2.imdecode(arr, cv2.IMREAD_COLOR)
    if img is None: raise ValueError("Invalid image")
    # Resize to save memory — DeepFace only needs ~160x160
    h, w = img.shape[:2]
    if max(h, w) > MAX_IMG_SIZE:
        scale = MAX_IMG_SIZE / max(h, w)
        img = cv2.resize(img, (int(w * scale), int(h * scale)))
    return img

def get_frames(req):
    """Get frames from images field."""
    if req.images:
        return [decode_image(img) for img in req.images[:3]]  # Max 3
    raise ValueError("No images provided")

def check_motion(imgs):
    if len(imgs) < 2: return True, 0
    diffs = []
    for i in range(len(imgs) - 1):
        d = np.mean((imgs[i].astype("float") - imgs[i+1].astype("float")) ** 2)
        diffs.append(d)
    avg_diff = np.mean(diffs)
    is_live = 0.5 < avg_diff < 100.0
    return is_live, avg_diff

@app.get("/")
async def root():
    return {"message": "AEGIS AI v7.1 (Memory-Safe)"}

@app.get("/health")
async def health():
    return {"status": "ok"}

@app.post("/extract-embedding")
async def extract_embedding(req: FaceRequest):
    try:
        frames = get_frames(req)
        print(f"[REG] Got {len(frames)} frames, sizes: {[f.shape for f in frames]}")
        
        is_live, motion_score = check_motion(frames)
        if not is_live:
            raise HTTPException(status_code=400, detail="Liveness failed: Static content.")

        best_res = None
        for i, img in enumerate(frames):
            try:
                results = DeepFace.represent(img_path=img, model_name=MODEL_NAME, detector_backend=DETECTOR, enforce_detection=False)
                res = results[0]
                conf = float(res.get("face_confidence", 0))
                print(f"[REG] Frame {i}: confidence={conf:.3f}")
                if conf > 0.5 and (best_res is None or conf > float(best_res.get("face_confidence", 0))):
                    best_res = res
            except Exception as e:
                print(f"[REG] Frame {i} failed: {e}")
                continue
        
        if not best_res:
            raise HTTPException(status_code=400, detail="No clear face found.")
            
        return {
            "embedding": best_res["embedding"], 
            "face_confidence": best_res["face_confidence"],
            "liveness": {"is_live": bool(is_live), "motion": float(motion_score)}
        }
    except HTTPException: raise
    except Exception as e:
        print(f"[REG] ERROR: {e}")
        raise HTTPException(status_code=400, detail=str(e))

@app.post("/verify-face")
async def verify_face(req: VerifyRequest):
    try:
        frames = get_frames(req)
        print(f"[VER] Got {len(frames)} frames, sizes: {[f.shape for f in frames]}")
        
        is_live, motion_score = check_motion(frames)
        
        gold_emb = np.array(req.golden_embedding)
        act_emb = np.array(req.active_embedding)

        best_score_gold = -1.0
        best_score_act = -1.0
        best_face_confidence = 0.0
        best_embedding = None

        # Process all 3 frames for best match
        for i, img in enumerate(frames):
            try:
                results = DeepFace.represent(img_path=img, model_name=MODEL_NAME, detector_backend=DETECTOR, enforce_detection=False)
                res = results[0]
                conf = float(res.get("face_confidence", 0))
                if conf < 0.5:
                    print(f"[VER] Frame {i}: low confidence {conf:.3f}, skipping")
                    continue
                new_emb = np.array(res["embedding"])
                
                sim_gold = float(np.dot(new_emb, gold_emb) / (np.linalg.norm(new_emb) * np.linalg.norm(gold_emb)))
                sim_act = float(np.dot(new_emb, act_emb) / (np.linalg.norm(new_emb) * np.linalg.norm(act_emb)))
                
                print(f"[VER] Frame {i}: gold={sim_gold:.3f}, act={sim_act:.3f}, conf={conf:.3f}")
                
                if sim_gold > best_score_gold:
                    best_score_gold = sim_gold
                    best_score_act = sim_act
                    best_face_confidence = conf
                    best_embedding = new_emb
            except Exception as e:
                print(f"[VER] Frame {i} failed: {e}")
                continue

        if best_score_gold == -1.0:
            raise HTTPException(status_code=400, detail="No face detected.")

        verified = (best_score_gold > THRESHOLD) or (best_score_act > THRESHOLD)
        drift = float(np.dot(gold_emb, act_emb) / (np.linalg.norm(gold_emb) * np.linalg.norm(act_emb)))
        should_flag = (not is_live) or (drift < 0.78)
        
        updated_active = None
        if verified and not should_flag and best_score_gold > 0.85 and best_embedding is not None:
            updated_active = (act_emb * (1 - LEARNING_RATE) + best_embedding * LEARNING_RATE).tolist()

        print(f"[VER] Result: verified={verified}, gold={best_score_gold:.3f}, flag={should_flag}")
        
        return {
            "success": True,
            "verified": bool(verified and not should_flag),
            "score_golden": float(best_score_gold),
            "score_active": float(best_score_act),
            "face_confidence": float(best_face_confidence),
            "updated_active": updated_active,
            "should_flag": bool(should_flag),
            "liveness": {"motion": float(motion_score), "is_live": bool(is_live)}
        }
    except HTTPException: raise
    except Exception as e:
        print(f"[VER] ERROR: {e}")
        raise HTTPException(status_code=400, detail=str(e))
