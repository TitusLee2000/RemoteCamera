import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

export const STORAGE_BUCKET = 'recordings'

export async function uploadToStorage(key, buffer, contentType = 'video/webm') {
  const { error } = await supabase.storage
    .from(STORAGE_BUCKET)
    .upload(key, buffer, { contentType, upsert: false })
  if (error) throw error
}

export async function deleteFromStorage(key) {
  const { error } = await supabase.storage.from(STORAGE_BUCKET).remove([key])
  if (error) throw error
}

export async function getSignedDownloadUrl(key, expiresInSeconds = 3600) {
  const { data, error } = await supabase.storage
    .from(STORAGE_BUCKET)
    .createSignedUrl(key, expiresInSeconds)
  if (error) throw error
  return data.signedUrl
}
