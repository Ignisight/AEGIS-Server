const supabase = require('./supabaseClient');

const FACE_URL = process.env.FACE_SERVICE_URL 
  || 'http://localhost:8001';

// ─────────────────────────────────────────
// Python service calls
// ─────────────────────────────────────────
async function extractEmbedding(base64Image) {
  const res = await fetch(`${FACE_URL}/extract-embedding`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ image: base64Image }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.detail || 'Extraction failed');
  return data;
}

async function verifyEmbedding(base64Image, storedEmbedding) {
  const res = await fetch(`${FACE_URL}/verify-face`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      image: base64Image,
      stored_embedding: storedEmbedding,
    }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.detail || 'Verification failed');
  return data;
}

// ─────────────────────────────────────────
// Supabase operations
// ─────────────────────────────────────────
async function storeFaceEmbedding(email, embedding, confidence) {
  const { error } = await supabase
    .from('face_embeddings')
    .upsert(
      { email, embedding, face_confidence: confidence },
      { onConflict: 'email' }
    );
  if (error) throw new Error('Supabase store failed: ' + error.message);
}

async function getFaceEmbedding(email) {
  const { data, error } = await supabase
    .from('face_embeddings')
    .select('embedding, face_confidence')
    .eq('email', email)
    .single();
  if (error || !data) return null;
  return data;
}

async function deleteFaceEmbedding(email) {
  const { error } = await supabase
    .from('face_embeddings')
    .delete()
    .eq('email', email);
  if (error) throw new Error('Supabase delete failed: ' + error.message);
}

module.exports = {
  extractEmbedding,
  verifyEmbedding,
  storeFaceEmbedding,
  getFaceEmbedding,
  deleteFaceEmbedding,
};
