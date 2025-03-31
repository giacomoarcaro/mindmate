# MindMate - Multilingual Psychological Support

A React application that provides 24/7 psychological support via WhatsApp, with automatic language detection and a smooth onboarding process.

## Features

- 🌐 Automatic language detection (English/Italian)
- 📱 WhatsApp integration
- 🎨 Modern UI with Tailwind CSS
- 📝 Dynamic onboarding questionnaire
- 🔄 Real-time progress tracking

## Prerequisites

- Node.js (v14 or higher)
- npm or yarn
- Twilio account with WhatsApp capabilities
- Environment variables for Twilio credentials

## Setup

1. Clone the repository:
```bash
git clone <repository-url>
cd mindmate
```

2. Install dependencies:
```bash
npm install
```

3. Create a `.env` file in the root directory:
```env
TWILIO_ACCOUNT_SID=your_account_sid
TWILIO_AUTH_TOKEN=your_auth_token
```

4. Start the development server:
```bash
npm start
```

5. In a separate terminal, start the backend server:
```bash
node server.js
```

## Environment Variables

- `TWILIO_ACCOUNT_SID`: Your Twilio Account SID
- `TWILIO_AUTH_TOKEN`: Your Twilio Auth Token

## Usage

1. Visit `http://localhost:3000` in your browser
2. The application will automatically detect your language
3. Click "Start Now" to begin the onboarding process
4. Answer the questions to complete the onboarding
5. You'll be redirected to WhatsApp to continue the conversation

## Contributing

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add some amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## License

This project is licensed under the MIT License - see the LICENSE file for details. 