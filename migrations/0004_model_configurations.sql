-- Model Providers table
-- Stores provider configurations (API keys, base URLs)
CREATE TABLE IF NOT EXISTS model_providers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('openai', 'anthropic', 'google', 'openai-compatible')),
  base_url TEXT,
  api_key TEXT NOT NULL,
  is_enabled BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by UUID REFERENCES users(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS model_providers_is_enabled_idx ON model_providers(is_enabled);
CREATE INDEX IF NOT EXISTS model_providers_type_idx ON model_providers(type);

-- Model Configurations table
-- Stores individual model definitions
CREATE TABLE IF NOT EXISTS model_configurations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_id UUID NOT NULL REFERENCES model_providers(id) ON DELETE CASCADE,
  model_id TEXT NOT NULL,
  display_name TEXT NOT NULL,
  model_type TEXT NOT NULL CHECK (model_type IN ('chat', 'embedding')),
  max_tokens INTEGER DEFAULT 4096,
  temperature DECIMAL(3, 2) DEFAULT 0.1,
  supports_streaming BOOLEAN DEFAULT true,
  supports_tools BOOLEAN DEFAULT false,
  dimensions INTEGER,
  is_enabled BOOLEAN NOT NULL DEFAULT true,
  is_default BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,

  UNIQUE(provider_id, model_id, model_type)
);

CREATE INDEX IF NOT EXISTS model_configurations_model_type_idx ON model_configurations(model_type);
CREATE INDEX IF NOT EXISTS model_configurations_is_default_idx ON model_configurations(is_default) WHERE is_default = true;
CREATE INDEX IF NOT EXISTS model_configurations_provider_id_idx ON model_configurations(provider_id);
CREATE INDEX IF NOT EXISTS model_configurations_is_enabled_idx ON model_configurations(is_enabled);

-- Function to ensure only one default per model type
CREATE OR REPLACE FUNCTION ensure_single_default_model()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.is_default = true THEN
    UPDATE model_configurations
    SET is_default = false
    WHERE model_type = NEW.model_type
      AND id != NEW.id
      AND is_default = true;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger to enforce single default
DROP TRIGGER IF EXISTS ensure_single_default_model_trigger ON model_configurations;
CREATE TRIGGER ensure_single_default_model_trigger
  BEFORE INSERT OR UPDATE ON model_configurations
  FOR EACH ROW
  EXECUTE FUNCTION ensure_single_default_model();

-- Function to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_model_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Triggers for updated_at
DROP TRIGGER IF EXISTS model_providers_updated_at ON model_providers;
CREATE TRIGGER model_providers_updated_at
  BEFORE UPDATE ON model_providers
  FOR EACH ROW
  EXECUTE FUNCTION update_model_updated_at();

DROP TRIGGER IF EXISTS model_configurations_updated_at ON model_configurations;
CREATE TRIGGER model_configurations_updated_at
  BEFORE UPDATE ON model_configurations
  FOR EACH ROW
  EXECUTE FUNCTION update_model_updated_at();
