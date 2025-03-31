import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import supabase from './config/supabase.js';
import { sendWhatsAppMessage } from './services/whatsapp.js';
import { generateResponse } from './services/gpt.js';

dotenv.config();

const app = express();
const port = process.env.PORT || 5000;

app.use(cors());
app.use(express.json());

// Store user data
app.post('/api/onboarding', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('users')
      .insert([req.body])
      .select();

    if (error) throw error;
    res.json(data[0]);
  } catch (error) {
    console.error('Error saving user data:', error);
    res.status(500).json({ error: 'Failed to save user data' });
  }
});

// Handle incoming WhatsApp messages
app.post('/api/webhook/whatsapp', async (req, res) => {
  try {
    const { Body, From } = req.body;
    
    // Get user data from Supabase
    const { data: userData, error } = await supabase
      .from('users')
      .select('*')
      .eq('phone', From)
      .single();

    if (error) throw error;

    // Generate AI response
    const aiResponse = await generateResponse(Body, userData);

    // Send response back via WhatsApp
    await sendWhatsAppMessage(From, aiResponse);

    res.status(200).send('OK');
  } catch (error) {
    console.error('Error processing webhook:', error);
    res.status(500).json({ error: 'Failed to process webhook' });
  }
});

app.listen(port, () => {
  console.log(`Server running on port ${port}`);
}); 