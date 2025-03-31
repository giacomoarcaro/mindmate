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
      await fetch("/api/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(answers)
      });
      window.location.href = "https://wa.me/1234567890"; // Replace with actual WhatsApp number
    } catch (error) {
      console.error('Error submitting form:', error);
    }
  };

  return (
    <div className="min-h-screen bg-gray-50 py-12 px-4 sm:px-6 lg:px-8">
      <div className="max-w-xl mx-auto">
        {/* Progress bar */}
        <div className="mb-8">
          <div className="flex justify-between mb-2">
            {questions.map((_, index) => (
              <div
                key={index}
                className={`w-1/4 h-2 rounded ${
                  index <= step ? 'bg-indigo-600' : 'bg-gray-200'
                }`}
              />
            ))}
          </div>
          <p className="text-sm text-gray-500 text-center">
            Step {step + 1} of {questions.length}
          </p>
        </div>

        {/* Question card */}
        <div className="bg-white rounded-2xl shadow-lg p-6">
          <h2 className="text-2xl font-semibold text-gray-900 mb-6">
            {current.q}
          </h2>

          {/* Multiple choice options */}
          {current.options && (
            <div className="space-y-3">
              {current.options.map(option => (
                <button
                  key={option}
                  onClick={() => handleAnswer(option)}
                  className="w-full text-left p-4 rounded-xl bg-gray-50 hover:bg-indigo-50 border-2 border-transparent hover:border-indigo-200 transition-all duration-200"
                >
                  {option}
                </button>
              ))}
            </div>
          )}

          {/* Text input */}
          {current.input && (
            <div className="space-y-3">
              <input
                type="text"
                onBlur={(e) => handleAnswer(e.target.value)}
                className="w-full p-4 rounded-xl border-2 border-gray-200 focus:border-indigo-500 focus:ring-2 focus:ring-indigo-200 transition-all duration-200"
                placeholder="Type your answer..."
              />
            </div>
          )}
        </div>
      </div>
    </div>
  );
} 