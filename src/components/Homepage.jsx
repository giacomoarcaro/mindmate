import React from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';

export default function Homepage() {
  const { t } = useTranslation();
  return (
    <div className="min-h-screen bg-gradient-to-b from-blue-50 to-white flex flex-col justify-center items-center px-4">
      <div className="max-w-2xl text-center">
        <h1 className="text-5xl font-bold text-gray-900 mb-6">{t('title')}</h1>
        <p className="text-xl text-gray-600 mb-12">{t('subtitle')}</p>
        <Link 
          to="/onboarding" 
          className="inline-block bg-blue-600 text-white px-8 py-4 rounded-xl text-lg font-semibold hover:bg-blue-700 transition-colors duration-200 shadow-lg hover:shadow-xl"
        >
          {t('cta')}
        </Link>
      </div>
    </div>
  );
} 