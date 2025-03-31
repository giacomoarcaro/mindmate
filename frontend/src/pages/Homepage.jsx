import React from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';

export default function Homepage() {
  const { t } = useTranslation();
  return (
    <div className="min-h-screen flex flex-col justify-center items-center bg-white px-4 text-center">
      <div className="max-w-2xl mx-auto">
        <h1 className="text-4xl font-bold mb-4 text-gray-900">{t('title')}</h1>
        <p className="text-lg mb-8 text-gray-600">{t('subtitle')}</p>
        <Link 
          to="/onboarding" 
          className="inline-block bg-indigo-600 text-white px-8 py-4 rounded-xl text-lg font-semibold hover:bg-indigo-700 transition-colors duration-200 shadow-lg hover:shadow-xl"
        >
          {t('cta')}
        </Link>
      </div>
    </div>
  );
} 