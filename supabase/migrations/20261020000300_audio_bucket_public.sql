-- As respostas em áudio da Lis são enviadas ao WhatsApp por link (getPublicUrl no
-- nina-orchestrator). Com o bucket privado, a Meta não conseguia baixar o arquivo.
-- O bucket guarda só as falas geradas pela Lis (TTS), não mídia dos leads.
update storage.buckets set public = true where id = 'audio-messages';
