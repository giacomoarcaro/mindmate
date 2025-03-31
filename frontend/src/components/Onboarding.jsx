import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';

export default function Onboarding() {
  const { t } = useTranslation();
  const [answers, setAnswers] = useState({});
  const [step, setStep] = useState(0);
  const questions = t('questions', { returnObjects: true });
  const current = questions[step];

  const handleAnswer = (answer) => {
    setAnswers(prev => ({ ...prev, [current.id]: answer }));
    if (step + 1 < questions.length) {
      setStep(step + 1);
    } else {
      submitForm();
    }
  };

  const submitForm = async () => {
    try {
      const response = await fetch("/api/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(answers)
      });
      
      if (response.ok) {
        window.location.href = "https://wa.me/1234567890"; // Replace with your WhatsApp number
      }
    } catch (error) {
      console.error('Error submitting form:', error);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-b from-blue-50 to-white flex flex-col items-center px-4 py-12">
      <div className="max-w-xl w-full bg-white rounded-2xl shadow-xl p-8">
        <div className="mb-8">
          <div className="w-full bg-gray-200 rounded-full h-2.5">
            <div 
              className="bg-blue-600 h-2.5 rounded-full transition-all duration-300"
              style={{ width: `${((step + 1) / questions.length) * 100}%` }}
            ></div>
          </div>
          <p className="text-sm text-gray-500 mt-2">
            {step + 1} / {questions.length}
          </p>
        </div>

        <h2 className="text-2xl font-bold text-gray-900 mb-6">{current.q}</h2>
        
        {current.options && (
          <div className="space-y-4">
            {current.options.map((option, index) => (
              <button
                key={index}
                onClick={() => handleAnswer(option)}
                className="w-full bg-white border-2 border-blue-100 rounded-xl p-4 text-left hover:bg-blue-50 hover:border-blue-200 transition-colors duration-200"
              >
                {option}
              </button>
            ))}
          </div>
        )}

        {current.input && (
          <div className="space-y-4">
            <input
              type="text"
              onBlur={(e) => handleAnswer(e.target.value)}
              className="w-full p-4 border-2 border-blue-100 rounded-xl focus:outline-none focus:border-blue-300"
              placeholder="Type your answer..."
            />
          </div>
        )}
      </div>
    </div>
  );
} 