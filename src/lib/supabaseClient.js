import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.REACT_APP_SUPABASE_URL;
const supabaseKey = process.env.REACT_APP_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseKey) {
  throw new Error('Missing Supabase environment variables');
}

export const supabase = createClient(supabaseUrl, supabaseKey);

// Database types
export const DB_TABLES = {
  USERS: 'users',
  CONVERSATIONS: 'conversations',
  THERAPY_SESSIONS: 'therapy_sessions'
};

// Database operations
export const db = {
  // User operations
  createUser: async (userData) => {
    const { data, error } = await supabase
      .from(DB_TABLES.USERS)
      .insert([userData])
      .select()
      .single();
    
    if (error) throw error;
    return data;
  },

  getUser: async (userId) => {
    const { data, error } = await supabase
      .from(DB_TABLES.USERS)
      .select('*')
      .eq('id', userId)
      .single();
    
    if (error) throw error;
    return data;
  },

  // Conversation operations
  createConversation: async (conversationData) => {
    const { data, error } = await supabase
      .from(DB_TABLES.CONVERSATIONS)
      .insert([conversationData])
      .select()
      .single();
    
    if (error) throw error;
    return data;
  },

  // Therapy session operations
  createTherapySession: async (sessionData) => {
    const { data, error } = await supabase
      .from(DB_TABLES.THERAPY_SESSIONS)
      .insert([sessionData])
      .select()
      .single();
    
    if (error) throw error;
    return data;
  }
}; 