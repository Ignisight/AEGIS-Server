const supabase = require('./supabaseClient');

const FACE_URL = process.env.FACE_SERVICE_URL 
  || 'http://localhost:8001';

// ─────────────────────────────────────────
// Python service calls
// ─────────────────────────────────────────
async function extractEmbedding(base64Image) {
  try {
    const res = await fetch(`${FACE_URL}/extract-embedding`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ image: base64Image }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.detail || 'Extraction failed');
    return data;
  } catch (err) {
    console.error(`[FACE] extractEmbedding failed (URL: ${FACE_URL}):`, err.message);
    if (err.message.includes('fetch failed')) {
      throw new Error(`AI Service unreachable at ${FACE_URL}. Check if the service is running.`);
    }
    throw err;
  }
}

async function verifyEmbedding(base64Image, faceRecord) {
  try {
    const res = await fetch(`${FACE_URL}/verify-face`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        image: base64Image,
        golden_embedding:  faceRecord.golden_embedding,
        active_embedding:  faceRecord.active_embedding,
        update_count:      faceRecord.update_count,
        last_update_date:  faceRecord.last_update_date 
                             || '2000-01-01',
        flagged:           faceRecord.flagged || false,
      }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.detail || 'Verification failed');
    return data;
  } catch (err) {
    console.error(`[FACE] verifyEmbedding failed (URL: ${FACE_URL}):`, err.message);
    if (err.message.includes('fetch failed')) {
      throw new Error(`AI Service unreachable at ${FACE_URL}. Check if the service is running.`);
    }
    throw err;
  }
}

// ─────────────────────────────────────────
// Supabase operations
// ─────────────────────────────────────────

// Store on initial registration
async function storeFaceEmbedding(email, embedding, confidence) {
  // Both golden and active start as the same embedding
  const { error } = await supabase
    .from('face_embeddings')
    .upsert({
      email,
      golden_embedding:  embedding,
      golden_confidence: confidence,
      active_embedding:  embedding,   // starts same as golden
      active_confidence: confidence,
      drift_score:       0,
      update_count:      0,
      flagged:           false,
    }, { onConflict: 'email' });

  if (error) throw new Error('Supabase store failed: ' + error.message);
}

// Fetch for verification
async function getFaceEmbedding(email) {
  const { data, error } = await supabase
    .from('face_embeddings')
    .select(`
      golden_embedding,
      active_embedding,
      golden_confidence,
      active_confidence,
      drift_score,
      update_count,
      last_update_date,
      flagged,
      flagged_reason
    `)
    .eq('email', email)
    .single();

  if (error || !data) return null;
  return data;
}

// Update active template after high-confidence scan
async function updateActiveTemplate(
  email, 
  newActiveEmbedding, 
  drift, 
  currentCount
) {
  const today = new Date().toISOString().split('T')[0];
  const { error } = await supabase
    .from('face_embeddings')
    .update({
      active_embedding:  newActiveEmbedding,
      drift_score:       drift,
      update_count:      currentCount + 1,
      last_update_date:  today,
      last_updated:      new Date().toISOString(),
    })
    .eq('email', email);

  if (error) throw new Error(
    'Template update failed: ' + error.message
  );
}

// Flag suspicious account
async function flagAccount(email, reason) {
  const { error } = await supabase
    .from('face_embeddings')
    .update({
      flagged:        true,
      flagged_reason: reason,
      flagged_at:     new Date().toISOString(),
    })
    .eq('email', email);

  if (error) console.error('Flag failed:', error.message);
  return { email, reason, flaggedAt: new Date() };
}

// Reset to golden (Admin action)
async function resetToGolden(email) {
  const { data } = await supabase
    .from('face_embeddings')
    .select('golden_embedding, golden_confidence')
    .eq('email', email)
    .single();

  if (!data) throw new Error('No golden record found');

  const { error } = await supabase
    .from('face_embeddings')
    .update({
      active_embedding:  data.golden_embedding,
      active_confidence: data.golden_confidence,
      drift_score:       0,
      update_count:      0,
      flagged:           false,
      flagged_reason:    null,
      flagged_at:        null,
      last_updated:      new Date().toISOString(),
    })
    .eq('email', email);

  if (error) throw new Error('Reset failed: ' + error.message);
}

async function deleteFaceEmbedding(email) {
  const { error } = await supabase
    .from('face_embeddings')
    .delete()
    .eq('email', email);
  if (error) throw new Error('Delete failed: ' + error.message);
}

module.exports = {
  extractEmbedding,
  verifyEmbedding,
  storeFaceEmbedding,
  getFaceEmbedding,
  updateActiveTemplate,
  flagAccount,
  resetToGolden,
  deleteFaceEmbedding,
};
