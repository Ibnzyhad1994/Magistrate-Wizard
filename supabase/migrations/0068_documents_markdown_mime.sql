-- Allow Markdown uploads into the private documents bucket so ingestion
-- and in-app preview can store .md files with the same 25 MB cap as
-- PDF/DOCX/TXT. Do not rewrite 0011_storage.sql.

update storage.buckets
set allowed_mime_types = array[
  'application/pdf',
  'image/png',
  'image/jpeg',
  'image/webp',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'text/plain',
  'text/markdown',
  'text/x-markdown'
]
where id = 'documents';
