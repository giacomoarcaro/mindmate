import React from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';

function Homepage() {
  const navigate = useNavigate();
  const { t } = useTranslation();

  return (
    <div className="text-center">
      <h2 className="text-4xl font-bold text-gray-900 mb-8">
        {t('welcome')}
      </h2>
      <p className="text-xl text-gray-600 mb-8">
        Your compassionate AI assistant for mental well-being
      </p>
      <button
        onClick={() => navigate('/onboarding')}
        className="bg-blue-600 text-white px-8 py-3 rounded-lg text-lg font-semibold hover:bg-blue-700 transition-colors"
      >
        {t('start')}
      </button>
    </div>
  );
}

export default Homepage; 