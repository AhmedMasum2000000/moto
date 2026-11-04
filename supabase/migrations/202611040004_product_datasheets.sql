-- Product data sheets (PDS): staff may upload PDF files alongside pictures.
alter table public.moto_media drop constraint if exists moto_media_mime_type_check;
alter table public.moto_media add constraint moto_media_mime_type_check
  check (mime_type in ('image/png','image/jpeg','image/webp','application/pdf'));
alter table public.moto_media drop constraint if exists moto_media_size_bytes_check;
alter table public.moto_media add constraint moto_media_size_bytes_check
  check (size_bytes between 1 and 10485760);
update storage.buckets
   set allowed_mime_types = array['image/png','image/jpeg','image/webp','application/pdf'],
       file_size_limit = 10485760
 where id in ('moto-media','moto-public');
