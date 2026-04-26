const supabase = require('./supabaseClient');

const FACE_URL = process.env.FACE_SERVICE_URL 
  || 'http://localhost:8001';

// ─────────────────────────────────────────
// Python service calls
// ─────────────────────────────────────────
async function extractEmbedding(payload) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 120000); // 120s for cold starts

  try {
    const res = await fetch(`${FACE_URL}/extract-embedding`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: controller.signal
    });
    clearTimeout(timeoutId);
    
    const text = await res.text();
    let data;
    try { data = JSON.parse(text); } catch { throw new Error(text.slice(0, 200)); }
    if (!res.ok) throw new Error(data.detail || 'Extraction failed');
    return data;
  } catch (err) {
    clearTimeout(timeoutId);
    console.error(`[FACE] extractEmbedding failed:`, err.message);
    if (err.name === 'AbortError') {
      throw new Error('AI Service is waking up. Please wait 1 minute and try again.');
    }
    throw err;
  }
}

async function verifyEmbedding(payload, faceRecord, livenessVerified = false) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 120000); // 120s for cold starts

  try {
    const res = await fetch(`${FACE_URL}/verify-face`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...payload,
        golden_embedding:  faceRecord.golden_embedding,
        active_embedding:  faceRecord.active_embedding,
        update_count:      faceRecord.update_count,
        last_update_date:  faceRecord.last_update_date 
                             || '2000-01-01',
        flagged:           faceRecord.flagged || false,
        liveness_verified: livenessVerified,
      }),
      signal: controller.signal
    });
    clearTimeout(timeoutId);

    const text = await res.text();
    let data;
    try { data = JSON.parse(text); } catch { throw new Error(text.slice(0, 200)); }
    if (!res.ok) throw new Error(data.detail || 'Verification failed');
    return data;
  } catch (err) {
    clearTimeout(timeoutId);
    console.error(`[FACE] verifyEmbedding failed:`, err.message);
    if (err.name === 'AbortError') {
      throw new Error('AI Service is waking up. Please wait 1 minute and try again.');
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
    .ilike('email', email)
    .maybeSingle();

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
  // Use ilike for case-insensitive deletion to ensure old records with mixed casing are cleared
  const { error } = await supabase
    .from('face_embeddings')
    .delete()
    .ilike('email', email);
    
  if (error) throw new Error('Delete failed: ' + error.message);
  console.log(`[FACE] Biometric record cleared for: ${email}`);
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
