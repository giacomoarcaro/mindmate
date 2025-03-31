-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Users table
CREATE TABLE users (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc'::text, NOW()) NOT NULL,
    phone TEXT UNIQUE NOT NULL,
    language TEXT NOT NULL DEFAULT 'en',
    answers JSONB NOT NULL,
    last_active TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc'::text, NOW())
);

-- Therapy sessions table
CREATE TABLE therapy_sessions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc'::text, NOW()) NOT NULL,
    language TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'active',
    therapeutic_approach TEXT,
    notes JSONB
);

-- Conversations table
CREATE TABLE conversations (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    session_id UUID REFERENCES therapy_sessions(id) ON DELETE CASCADE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc'::text, NOW()) NOT NULL,
    role TEXT NOT NULL,
    content TEXT NOT NULL,
    metadata JSONB
);

-- Indexes for better query performance
CREATE INDEX idx_users_phone ON users(phone);
CREATE INDEX idx_therapy_sessions_user_id ON therapy_sessions(user_id);
CREATE INDEX idx_conversations_session_id ON conversations(session_id);

-- Row Level Security (RLS) policies
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE therapy_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE conversations ENABLE ROW LEVEL SECURITY;

-- Users policies
CREATE POLICY "Users can view their own data"
    ON users FOR SELECT
    USING (auth.uid() = id);

CREATE POLICY "Service role can manage all users"
    ON users FOR ALL
    USING (auth.role() = 'service_role');

-- Therapy sessions policies
CREATE POLICY "Users can view their own sessions"
    ON therapy_sessions FOR SELECT
    USING (auth.uid() = user_id);

CREATE POLICY "Service role can manage all sessions"
    ON therapy_sessions FOR ALL
    USING (auth.role() = 'service_role');

-- Conversations policies
CREATE POLICY "Users can view their own conversations"
    ON conversations FOR SELECT
    USING (
        EXISTS (
            SELECT 1 FROM therapy_sessions
            WHERE therapy_sessions.id = conversations.session_id
            AND therapy_sessions.user_id = auth.uid()
        )
    );

CREATE POLICY "Service role can manage all conversations"
    ON conversations FOR ALL
    USING (auth.role() = 'service_role'); 