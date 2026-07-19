import { supabase } from './supabase';

/** Upload a file into the company-docs bucket following the path convention.
    entityId can be 'intake' for documents not yet attached to a record. */
export async function uploadCompanyDoc(companyId, entityType, entityId, file) {
  const clean = file.name.replace(/[^\w.\-]+/g, '_');
  const path = `${companyId}/${entityType}/${entityId || 'intake'}/${crypto.randomUUID()}_${clean}`;
  const { error } = await supabase.storage.from('company-docs')
    .upload(path, file, { contentType: file.type || undefined });
  if (error) throw error;
  return { path, name: clean };
}

/** Open a stored document in a new tab via a short-lived signed URL. */
export async function openDoc(path) {
  const { data, error } = await supabase.storage.from('company-docs')
    .createSignedUrl(path, 600);
  if (error) throw error;
  window.open(data.signedUrl, '_blank', 'noopener');
}
