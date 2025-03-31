const express = require("express");
const bodyParser = require("body-parser");
const cors = require("cors");
const twilio = require('twilio');
const { createClient } = require('@supabase/supabase-js');
const OpenAI = require('openai');
require('dotenv').config();

const app = express();
app.use(cors());
app.use(bodyParser.json());

// Initialize clients
const accountSid = process.env.TWILIO_ACCOUNT_SID;
const authToken = process.env.TWILIO_AUTH_TOKEN;
const twilioClient = twilio(accountSid, authToken);

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

// GPT System Prompt based on language and user context
const getSystemPrompt = (language, answers) => {
  const basePrompt = {
    role: "system",
    content: language === 'it' 
      ? "Sei MindMate AI, un assistente psicologico compassionevole. Usa un tono empatico e terapeutico. Basati sulle risposte dell'utente per personalizzare i consigli. Scegli il miglior modello terapeutico (CBT, ACT, terapia di supporto, motivazionale). Non dare mai consigli medici o diagnosi. Ricorda sempre all'utente che non è solo."
      : "You are MindMate AI, a compassionate psychological assistant. Use an empathetic and therapeutic tone. Base your advice on the user's responses. Choose the best therapeutic model (CBT, ACT, supportive therapy, motivational). Never give medical advice or diagnoses. Always remind the user they are not alone."
  };

  // Add therapeutic approach based on answers
  const hasPreviousExperience = answers[3] === (language === 'it' ? 'Sì' : 'Yes');
  const currentMood = answers[4];
  
  const therapeuticApproach = {
    role: "system",
    content: hasPreviousExperience
      ? language === 'it'
        ? "L'utente ha esperienza precedente con la terapia. Usa tecniche avanzate di CBT e ACT."
        : "User has previous therapy experience. Use advanced CBT and ACT techniques."
      : language === 'it'
        ? "L'utente è nuovo alla terapia. Inizia con approccio supportivo e psicoeducativo."
        : "User is new to therapy. Start with supportive and psychoeducational approach."
  };

  return [basePrompt, therapeuticApproach];
};

// Save user data to Supabase
const saveUserData = async (answers, language, phone) => {
  const { data, error } = await supabase
    .from('users')
    .insert([{
      answers,
      language,
      phone,
      created_at: new Date().toISOString()
    }])
    .select()
    .single();

  if (error) throw error;
  return data;
};

app.post("/api/start", async (req, res) => {
  const { answers, phone } = req.body;
  console.log("New user:", answers);

  try {
    // Determine language based on answers
    const language = answers.language || 'en';
    
    // Save user data to Supabase
    const userData = await saveUserData(answers, language, phone);
    
    // Get appropriate system prompt
    const systemPrompt = getSystemPrompt(language, answers);

    // Send initial WhatsApp message
    const initialMessage = language === 'it'
      ? 'Ciao! Sono MindMate AI. Sono qui per aiutarti in base alle tue risposte.'
      : 'Hi! I\'m MindMate AI. I\'m here to help you based on your responses.';

    await twilioClient.messages.create({
      from: `whatsapp:${process.env.TWILIO_WHATSAPP_NUMBER}`,
      body: initialMessage,
      to: `whatsapp:${phone}`
    });

    // Create initial therapy session
    await supabase.from('therapy_sessions').insert([{
      user_id: userData.id,
      language,
      status: 'active',
      created_at: new Date().toISOString()
    }]);

    res.json({ success: true, userId: userData.id });
  } catch (error) {
    console.error('Error:', error);
    res.status(500).json({ error: 'Failed to process request' });
  }
});

// Webhook endpoint for ongoing WhatsApp conversations
app.post("/webhook/whatsapp", async (req, res) => {
  const { Body, From, To } = req.body;
  
  try {
    // Get user context from database
    const { data: userData, error: userError } = await supabase
      .from('users')
      .select('*')
      .eq('phone', From.replace('whatsapp:', ''))
      .single();

    if (userError) throw userError;

    // Get active therapy session
    const { data: sessionData, error: sessionError } = await supabase
      .from('therapy_sessions')
      .select('*')
      .eq('user_id', userData.id)
      .eq('status', 'active')
      .single();

    if (sessionError) throw sessionError;

    // Get conversation history
    const { data: conversationHistory } = await supabase
      .from('conversations')
      .select('*')
      .eq('session_id', sessionData.id)
      .order('created_at', { ascending: true });

    // Prepare messages for GPT
    const messages = [
      ...getSystemPrompt(userData.language, userData.answers),
      ...(conversationHistory || []).map(msg => ({
        role: msg.role,
        content: msg.content
      })),
      { role: "user", content: Body }
    ];

    // Get GPT response
    const completion = await openai.chat.completions.create({
      model: "gpt-4",
      messages,
      temperature: 0.7,
      max_tokens: 500
    });

    const aiResponse = completion.choices[0].message.content;

    // Save conversation to database
    await supabase.from('conversations').insert([
      {
        session_id: sessionData.id,
        role: 'user',
        content: Body
      },
      {
        session_id: sessionData.id,
        role: 'assistant',
        content: aiResponse
      }
    ]);

    // Send response via WhatsApp
    await twilioClient.messages.create({
      from: To,
      body: aiResponse,
      to: From
    });
    
    res.sendStatus(200);
  } catch (error) {
    console.error('Webhook error:', error);
    res.status(500).json({ error: 'Failed to process webhook' });
  }
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
}); 