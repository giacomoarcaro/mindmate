# MindMate AI - Assistente psicologico AI via WhatsApp

Un assistente psicologico multilingua che utilizza AI per fornire supporto emotivo via WhatsApp.

## 🏗️ Architettura

- **Frontend**: React + Tailwind + i18next (multilingua)
- **Backend**: Node.js + Express
- **Database**: Supabase
- **Integrazione**: WhatsApp (Twilio) + GPT-4 Turbo
- **Deploy**: Frontend su Vercel, Backend su Railway/Docker

## 📁 Struttura del Progetto

```
mindmate/
├── frontend/           # React frontend
├── backend/           # Express backend
├── docker/           # Configurazioni Docker
├── locales/          # Traduzioni i18n
├── gpt/              # System prompt GPT
└── vercel.json       # Configurazione Vercel
```

## 🚀 Deploy

### Frontend (Vercel)

1. Installa Vercel CLI:
```bash
npm install -g vercel
```

2. Deploy:
```bash
cd frontend
vercel --prod
```

### Backend (Railway/Docker)

#### Railway
```bash
cd backend
railway up
```

#### Docker
```bash
cd docker
docker-compose up -d
```

## 🔐 Variabili d'Ambiente

### Frontend (.env)
```
REACT_APP_SUPABASE_URL=your_supabase_url
REACT_APP_SUPABASE_ANON_KEY=your_supabase_key
REACT_APP_API_URL=your_backend_url
```

### Backend (.env)
```
SUPABASE_URL=your_supabase_url
SUPABASE_KEY=your_supabase_key
TWILIO_SID=your_twilio_sid
TWILIO_AUTH_TOKEN=your_twilio_token
TWILIO_NUMBER=your_twilio_number
OPENAI_API_KEY=your_openai_key
```

## 🧪 Test Locale

1. Frontend:
```bash
cd frontend
npm install
npm start
```

2. Backend:
```bash
cd backend
npm install
npm run dev
```

## 📱 Funzionalità

- Onboarding multilingua (IT/EN)
- Rilevamento automatico lingua
- Integrazione WhatsApp
- Risposte AI personalizzate
- Monitoraggio utenti via Supabase
- Interfaccia moderna con Tailwind CSS

## 🤖 GPT System Prompt

Il sistema utilizza GPT-4 Turbo con un prompt personalizzato per:
- Adattare il tono alla lingua dell'utente
- Personalizzare le risposte in base all'onboarding
- Selezionare il modello terapeutico appropriato
- Mantenere un approccio empatico e non diagnostico

## 📝 Note di Sviluppo

- Il frontend è configurato per Vercel con routing SPA
- Il backend è containerizzato per facile deploy
- Le traduzioni sono gestite via i18next
- Il database è strutturato per scalabilità

## 🔒 Sicurezza

- Variabili d'ambiente protette
- Row Level Security su Supabase
- Validazione input utente
- Rate limiting API
- Sanitizzazione risposte GPT 