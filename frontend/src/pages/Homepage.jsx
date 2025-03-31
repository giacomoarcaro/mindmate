import React from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';

export default function Homepage() {
  const { t } = useTranslation();
  return (
    <div className="min-h-screen flex flex-col justify-center items-center bg-white px-4 text-center">
      <h1 className="text-4xl font-bold mb-4">{t('title')}</h1>
      <p className="text-lg mb-8">{t('subtitle')}</p>
      <Link to="/onboarding" className="bg-blue-600 text-white px-6 py-3 rounded-xl text-lg">
        {t('cta')}
      </Link>
    </div>
  );
} 