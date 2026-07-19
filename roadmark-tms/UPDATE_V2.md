# Demo v2 — AI Rate Con Intake (setup, ~20 min)

**What's new:** on the Loads page there's now a **"📄 New from rate con (AI)"** button.
Drop a broker's rate confirmation (PDF or photo) → AI reads it (5–15 s) → the load form
opens pre-filled (customer matched, rate, pickup/delivery, times, weight, notes), with
lower-confidence fields flagged for a second look → **Create load + attach rate con**
saves the load with the document attached. Existing loads also got a **Documents**
section in their drawer: attach and open PODs, BOLs, lumper receipts.

Three setup steps: update the code, deploy the AI function, add your Anthropic key.

---

## Step 1 — Update the code on your computer (5 min)

1. Extract this zip **over** `C:\TRUCKWRENCH\roadmark-tms`, replacing all files when
   asked (your `.env.local` is not in the zip, so it survives).
2. Push the update to the live site:

```powershell
cd C:\TRUCKWRENCH\roadmark-tms
git add -A
git commit -m "AI rate con intake + load documents"
git push
```

Vercel redeploys automatically (~2 min). You can also test locally first with
`npm run dev`.

## Step 2 — Get an Anthropic API key (5 min)

This is what lets the app read documents with AI. Costs are pay-per-use: a typical rate
con costs **1–3 cents** to read.

1. Go to **console.anthropic.com** → sign up / log in.
2. **Billing** → add a payment method (you can start with a small credit like $5 —
   that's roughly 200–500 documents).
3. **API Keys → Create Key** → name it `roadmark-tms` → copy the key
   (starts with `sk-ant-...`). It's shown once — save it somewhere safe.

## Step 3 — Deploy the AI function in Supabase (10 min, all in the browser)

1. Supabase Dashboard → **Edge Functions** (left sidebar).
2. Click **Deploy a new function** → choose **Via Editor** (write/paste code in the
   browser).
3. Function name: exactly `extract-document`
4. Delete the sample code in the editor, and paste the **entire contents** of
   `supabase/functions/extract-document/index.ts` from this zip (open it in Notepad,
   Ctrl+A, Ctrl+C, paste).
5. Click **Deploy function**.
6. Add the key: **Edge Functions → Secrets** (or Project Settings → Edge Functions →
   Secrets) → **Add secret**:
   - Name: `ANTHROPIC_API_KEY`
   - Value: your `sk-ant-...` key
   → Save.

## Step 4 — Try it

1. Open the site (local or live) → **Loads** → **📄 New from rate con (AI)**.
2. Pick a real rate confirmation PDF from your email (or a phone photo of one).
3. Watch: "Reading the rate con…" → the form opens pre-filled with a yellow banner.
   - If the broker matched an existing customer, it's already selected; otherwise add
     them under Customers and pick them.
   - Fields the AI was less sure about are listed in the banner — check those first.
   - **Open the document** shows the PDF side-by-side for comparison.
4. Assign driver/truck, click **Create load + attach rate con**.
5. Open the created load → the rate con is in its **Documents** section. Try attaching
   a POD to load #1 as well.

## Troubleshooting

- **"Extraction function failed — is it deployed?"** → Step 3 wasn't completed, or the
  function name isn't exactly `extract-document`.
- **Error mentions ANTHROPIC_API_KEY** → the secret from step 3.6 is missing or
  misspelled. After adding a secret, re-deploy the function once (Edge Functions → the
  function → Deploy) so it picks it up.
- **"AI request failed (401)"** → the key is wrong/revoked; create a new one.
- **"AI request failed (400)" mentioning credit** → add billing credit in the Anthropic
  console.
- **Upload fails** → file over 15 MB, or the storage bucket policies from migration 005
  didn't run — re-run `005_documents_ai.sql` in the SQL Editor (safe to re-run).
- Every attempt is recorded in the `extraction_jobs` table (SQL Editor:
  `select status, error, created_at from extraction_jobs order by created_at desc limit 5;`)
  — the `error` column says exactly what went wrong.

## What's next in the build

Same pipeline, next targets: repair-invoice scan into Maintenance (auto On Driver
deductions), assignments UI, multi-stop entry, fuel/toll CSV import, then settlements.
Say the word and I'll build the next piece.
