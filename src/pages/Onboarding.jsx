import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';

const Onboarding = () => {
  const { t } = useTranslation();
  const [step, setStep] = useState(0);
  const [answers, setAnswers] = useState({});
  const [currentInput, setCurrentInput] = useState('');
  const questions = t('onboarding.questions', { returnObjects: true });

  const handleAnswer = (value) => {
    const currentQuestion = questions[step];
    setAnswers(prev => ({
      ...prev,
      [currentQuestion.id]: value
    }));

    if (step < questions.length - 1) {
      setStep(prev => prev + 1);
      setCurrentInput('');
    } else {
      handleSubmit();
    }
  };

  const handleInputChange = (e) => {
    setCurrentInput(e.target.value);
  };

  const handleInputSubmit = () => {
    if (currentInput.trim()) {
      handleAnswer(currentInput);
    }
  };

  const handleSubmit = async () => {
    try {
      console.log('Submitting answers:', answers); // Debug log
      const response = await fetch('http://localhost:5000/api/start', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(answers),
      });

      if (!response.ok) {
        throw new Error('Failed to submit form');
      }

      const data = await response.json();
      console.log('Response:', data); // Debug log

      // Redirect to WhatsApp
      window.location.href = data.whatsappLink || 'https://wa.me/1234567890';
    } catch (error) {
      console.error('Error submitting form:', error);
      // For development, redirect even if there's an error
      window.location.href = 'https://wa.me/1234567890';
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
                value={currentInput}
                onChange={handleInputChange}
                onKeyPress={(e) => e.key === 'Enter' && handleInputSubmit()}
                placeholder={currentQuestion.placeholder}
                className="w-full px-4 py-3 rounded-lg border border-gray-300 focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
              />
              <button
                onClick={handleInputSubmit}
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