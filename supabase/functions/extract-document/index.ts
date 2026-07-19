// extract-document — Roadmark TMS AI extraction edge function
// Paste this whole file into: Supabase Dashboard → Edge Functions → Deploy new function
// Function name must be exactly: extract-document
// Required secret: ANTHROPIC_API_KEY  (Edge Functions → Secrets)

import { createClient } from 'npm:@supabase/supabase-js@2';
import { encodeBase64 } from 'jsr:@std/encoding/base64';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  });

const RATE_CON_PROMPT = `You parse freight rate confirmations for a trucking company's TMS.
Read the document and respond with ONLY a JSON object — no markdown fences, no commentary.

Schema:
{
  "customer_name": string,            // broker/customer company name
  "customer_mc": string,              // MC number if shown, else ""
  "customer_load_id": string,         // broker's load/reference/PRO number
  "freight_amount": number,           // total linehaul rate in USD
  "stops": [
    {
      "stop_type": "pickup" | "delivery",
      "location_name": string,
      "city": string,
      "state": string,                // 2-letter
      "scheduled_at": string | null,  // ISO 8601 with the document's local date/time
      "appointment_type": "appt" | "fcfs"
    }
  ],
  "weight_lbs": number | null,
  "commodity": string,
  "temperature": string,              // reefer setpoint if any, else ""
  "equipment": string,                // dry van / reefer / flatbed / etc as written
  "notes": string,                    // special instructions worth showing a dispatcher
  "confidence": {                     // 0..1 per top-level field you extracted
    "customer_name": number, "customer_load_id": number, "freight_amount": number,
    "stops": number, "weight_lbs": number
  }
}

Rules: stops in document order. If a value is absent use "" / null / 0 and give it low
confidence. Never invent numbers.`;

const BOL_PROMPT = `You parse Bills of Lading for a trucking company's TMS.
Respond with ONLY JSON (no fences): {"shipper": string, "consignee": string,
"delivery_address": string, "commodity": string, "weight_lbs": number|null,
"piece_count": string, "temperature": string, "appointment": string,
"special_instructions": string, "bol_number": string,
"confidence": {"delivery_address": number, "appointment": number, "commodity": number}}`;

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const anthropicKey = Deno.env.get('ANTHROPIC_API_KEY');
    if (!anthropicKey) return json({ error: 'ANTHROPIC_API_KEY secret is not set' }, 500);

    const { job_id } = await req.json();
    if (!job_id) return json({ error: 'job_id required' }, 400);

    const admin = createClient(supabaseUrl, serviceKey);

    // who is calling?
    const authHeader = req.headers.get('Authorization') ?? '';
    const anonClient = createClient(supabaseUrl, Deno.env.get('SUPABASE_ANON_KEY')!, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: userData } = await anonClient.auth.getUser();
    if (!userData?.user) return json({ error: 'Not authenticated' }, 401);

    // load the job + check membership
    const { data: job, error: jobErr } = await admin
      .from('extraction_jobs').select('*').eq('id', job_id).single();
    if (jobErr || !job) return json({ error: 'Job not found' }, 404);

    const { data: member } = await admin
      .from('company_members').select('id')
      .eq('company_id', job.company_id).eq('user_id', userData.user.id)
      .eq('status', 'active').maybeSingle();
    if (!member) return json({ error: 'Not a member of this company' }, 403);

    await admin.from('extraction_jobs')
      .update({ status: 'processing', error: null }).eq('id', job_id);

    const fail = async (msg: string) => {
      await admin.from('extraction_jobs')
        .update({ status: 'failed', error: msg }).eq('id', job_id);
      return json({ error: msg }, 422);
    };

    // download the file
    const { data: file, error: dlErr } = await admin.storage
      .from('company-docs').download(job.file_path);
    if (dlErr || !file) return await fail('Could not download file: ' + (dlErr?.message ?? ''));
    const bytes = new Uint8Array(await file.arrayBuffer());
    if (bytes.byteLength > 15 * 1024 * 1024) return await fail('File too large (max 15 MB)');
    const b64 = encodeBase64(bytes);

    const lower = (job.file_name || job.file_path).toLowerCase();
    const isPdf = lower.endsWith('.pdf');
    const mediaType = isPdf ? 'application/pdf'
      : lower.endsWith('.png') ? 'image/png'
      : lower.endsWith('.webp') ? 'image/webp'
      : 'image/jpeg';

    const fileBlock = isPdf
      ? { type: 'document', source: { type: 'base64', media_type: mediaType, data: b64 } }
      : { type: 'image', source: { type: 'base64', media_type: mediaType, data: b64 } };

    const prompt = job.kind === 'bol' ? BOL_PROMPT : RATE_CON_PROMPT;

    const resp = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': anthropicKey,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 3000,
        temperature: 0,
        messages: [{
          role: 'user',
          content: [fileBlock, { type: 'text', text: prompt }],
        }],
      }),
    });

    if (!resp.ok) {
      const t = await resp.text();
      return await fail(`AI request failed (${resp.status}): ${t.slice(0, 300)}`);
    }
    const ai = await resp.json();
    const text = (ai.content ?? [])
      .filter((b: { type: string }) => b.type === 'text')
      .map((b: { text: string }) => b.text).join('\n');

    let extracted: Record<string, unknown>;
    try {
      extracted = JSON.parse(text.replace(/```json|```/g, '').trim());
    } catch {
      return await fail('AI response was not valid JSON — try re-running.');
    }

    await admin.from('extraction_jobs').update({
      status: 'needs_review',
      extracted,
      confidence: (extracted as { confidence?: unknown }).confidence ?? {},
      raw_text: text.slice(0, 20000),
    }).eq('id', job_id);

    return json({ ok: true, job_id, status: 'needs_review' });
  } catch (e) {
    return json({ error: String(e) }, 500);
  }
});
