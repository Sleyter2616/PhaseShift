-- Phase 2: persist TTS model on script for dedupe identity
alter table scripts add column if not exists tts_model_id text;
