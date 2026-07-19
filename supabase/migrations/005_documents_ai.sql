-- 005_documents_ai.sql — central document registry, AI extraction jobs, import batches
-- Also creates the storage bucket + policies.

create table if not exists documents (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  entity_type text not null check (entity_type in
    ('load','driver','truck','trailer','maintenance_invoice','insurance_policy',
     'customer','employee','company','settlement','expense','other')),
  entity_id uuid,
  doc_type text not null default 'other' check (doc_type in
    ('rate_con','pod','bol','lumper','invoice','receipt','coi','cdl','medical_card',
     'w9','contract','statement','photo','registration','inspection','permit','other')),
  file_name text not null,
  file_path text not null,          -- company-docs/{company_id}/{entity_type}/{entity_id}/{uuid}_{file_name}
  mime_type text,
  size_bytes bigint,
  extraction_job_id uuid,
  uploaded_by uuid references profiles(id),
  created_at timestamptz not null default now()
);
create index if not exists idx_docs_entity on documents(entity_type, entity_id);
create index if not exists idx_docs_company on documents(company_id, created_at desc);

create table if not exists extraction_jobs (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  kind text not null check (kind in
    ('rate_confirmation','repair_invoice','fuel_statement','toll_statement',
     'insurance_policy','driver_document','other')),
  status text not null default 'pending' check (status in
    ('pending','processing','needs_review','approved','failed')),
  file_path text not null,
  file_name text,
  raw_text text,                     -- extracted text (debug / re-run)
  extracted jsonb,                   -- structured result from the model
  confidence jsonb,                  -- per-field confidence 0..1
  error text,
  applied_entity_type text,
  applied_entity_id uuid,
  reviewed_by uuid references profiles(id),
  reviewed_at timestamptz,
  created_by uuid references profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_extraction_status on extraction_jobs(company_id, status, created_at desc);

create table if not exists import_batches (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  kind text not null check (kind in
    ('fuel','toll','drivers','trucks','trailers','loads','customers','vendors',
     'deductions','employees','expenses','other')),
  file_name text,
  total_rows integer not null default 0,
  imported_rows integer not null default 0,
  skipped_rows integer not null default 0,
  errors jsonb,
  created_by uuid references profiles(id),
  created_at timestamptz not null default now()
);

-- late foreign keys now that documents/extraction exist
alter table compliance_items
  drop constraint if exists compliance_items_document_fk,
  add constraint compliance_items_document_fk
  foreign key (document_id) references documents(id) on delete set null;

alter table maintenance_invoices
  drop constraint if exists maintenance_invoices_extraction_fk,
  add constraint maintenance_invoices_extraction_fk
  foreign key (extraction_job_id) references extraction_jobs(id) on delete set null;

-- ============================================================ RLS
do $$
declare t text;
begin
  foreach t in array array['documents','extraction_jobs','import_batches']
  loop
    execute format('alter table %I enable row level security', t);
    execute format('drop policy if exists %I_select on %I', t, t);
    execute format('create policy %I_select on %I for select using (app.is_member(company_id))', t, t);
    execute format('drop policy if exists %I_write on %I', t, t);
    execute format($f$create policy %I_write on %I for all
      using (app.is_member(company_id))
      with check (app.is_member(company_id))$f$, t, t);
  end loop;
end $$;
-- (any active member can upload docs / run extraction; deleting docs = admin only)
drop policy if exists documents_delete on documents;
create policy documents_delete on documents for delete using (app.is_admin(company_id));

-- ============================================================ storage bucket + policies
insert into storage.buckets (id, name, public)
values ('company-docs','company-docs', false)
on conflict (id) do nothing;

-- path convention: {company_id}/{entity_type}/{entity_id}/{filename}
drop policy if exists "company docs read" on storage.objects;
create policy "company docs read" on storage.objects for select
  using (bucket_id = 'company-docs'
     and app.is_member(((storage.foldername(name))[1])::uuid));

drop policy if exists "company docs insert" on storage.objects;
create policy "company docs insert" on storage.objects for insert
  with check (bucket_id = 'company-docs'
     and app.is_member(((storage.foldername(name))[1])::uuid));

drop policy if exists "company docs delete" on storage.objects;
create policy "company docs delete" on storage.objects for delete
  using (bucket_id = 'company-docs'
     and app.is_admin(((storage.foldername(name))[1])::uuid));
