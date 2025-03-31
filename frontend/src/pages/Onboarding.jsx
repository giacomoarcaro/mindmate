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
    if (step + 1 < questions.length) setStep(step + 1);
    else submitForm();
  };

  const submitForm = async () => {
    await fetch("/api/start", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(answers)
    });
    window.location.href = "https://wa.me/1234567890"; // replace with real WhatsApp bot link
  };

  return (
    <div className="p-4 max-w-xl mx-auto">
      <h2 className="text-2xl font-bold mb-4">{current.q}</h2>
      {current.options && current.options.map(option => (
        <button key={option} onClick={() => handleAnswer(option)} className="block w-full bg-blue-100 rounded-xl p-4 my-2">
          {option}
        </button>
      ))}
      {current.input && (
        <input type="text" onBlur={(e) => handleAnswer(e.target.value)} className="border w-full p-2 rounded-xl" />
      )}
    </div>
  );
} 