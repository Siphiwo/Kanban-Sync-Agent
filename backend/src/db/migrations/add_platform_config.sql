-- Migration: Add platform_config column to connections table
-- This migration adds support for platform-specific configuration

-- Add platform_config column if it doesn't exist
DO $$ 
BEGIN 
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'connections' 
        AND column_name = 'platform_config'
    ) THEN
        ALTER TABLE connections ADD COLUMN platform_config JSONB DEFAULT '{}';
    END IF;
END $$;

-- Update existing connections to have empty config
UPDATE connections SET platform_config = '{}' WHERE platform_config IS NULL;