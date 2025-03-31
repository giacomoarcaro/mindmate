import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';

const Onboarding = () => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [step, setStep] = useState(0);
  const [answers, setAnswers] = useState({});
  const questions = t('onboarding.questions', { returnObjects: true });

  const handleAnswer = (value) => {
    const currentQuestion = questions[step];
    setAnswers(prev => ({
      ...prev,
      [currentQuestion.id]: value
    }));

    if (step < questions.length - 1) {
      setStep(prev => prev + 1);
    }
  };

  const handleSubmit = async () => {
    try {
      const response = await fetch('/api/start', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(answers),
      });

      if (!response.ok) {
        throw new Error('Failed to submit form');
      }

      // Redirect to WhatsApp
      window.location.href = 'https://wa.me/1234567890';
    } catch (error) {
      console.error('Error submitting form:', error);
      // Handle error appropriately
    }
  };

  const currentQuestion = questions[step];
  const progress = ((step + 1) / questions.length) * 100;

  return (
    <div className="min-h-screen bg-gradient-to-b from-indigo-50 to-white py-12 px-4 sm:px-6 lg:px-8">
      <div className="max-w-md mx-auto">
        {/* Progress bar */}
        <div className="mb-8">
          <div className="h-2 bg-gray-200 rounded-full">
            <div
              className="h-2 bg-indigo-600 rounded-full transition-all duration-300"
              style={{ width: `${progress}%` }}
            />
          </div>
          <p className="mt-2 text-sm text-gray-500 text-center">
            Question {step + 1} of {questions.length}
          </p>
        </div>

        {/* Question card */}
        <div className="bg-white rounded-lg shadow-lg p-6">
          <h2 className="text-2xl font-bold text-gray-900 mb-6">
            {currentQuestion.text}
          </h2>

          {currentQuestion.type === 'select' ? (
            <div className="space-y-3">
              {currentQuestion.options.map((option) => (
                <button
                  key={option}
                  onClick={() => handleAnswer(option)}
                  className="w-full text-left px-4 py-3 rounded-lg border border-gray-300 hover:border-indigo-500 hover:bg-indigo-50 transition-colors duration-200"
                >
                  {option}
                </button>
              ))}
            </div>
          ) : (
            <div className="space-y-4">
              <input
                type={currentQuestion.type}
                placeholder={currentQuestion.placeholder}
                onChange={(e) => handleAnswer(e.target.value)}
                className="w-full px-4 py-3 rounded-lg border border-gray-300 focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
              />
              <button
                onClick={() => handleAnswer(answers[currentQuestion.id] || '')}
                className="w-full px-4 py-3 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition-colors duration-200"
              >
                {step === questions.length - 1 ? t('onboarding.buttons.submit') : t('onboarding.buttons.next')}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default Onboarding; 