-- Add description, welcome_message, and logo_url fields to agents table
-- These fields are used by the widget to customize the chat experience

ALTER TABLE agents ADD COLUMN IF NOT EXISTS description TEXT;
ALTER TABLE agents ADD COLUMN IF NOT EXISTS welcome_message TEXT DEFAULT 'How can I help?';
ALTER TABLE agents ADD COLUMN IF NOT EXISTS logo_url TEXT;
