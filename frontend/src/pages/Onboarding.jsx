import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';

const steps = [
  { id: 'name', field: 'name' },
  { id: 'age', field: 'age' },
  { id: 'concerns', field: 'concerns' },
  { id: 'goals', field: 'goals' },
  { id: 'preferences', field: 'preferences' }
];

function Onboarding() {
  const navigate = useNavigate();
  const { t } = useTranslation();
  const [currentStep, setCurrentStep] = useState(0);
  const [formData, setFormData] = useState({
    name: '',
    age: '',
    concerns: '',
    goals: '',
    preferences: ''
  });

  const handleInputChange = (e) => {
    const { name, value } = e.target;
    setFormData(prev => ({
      ...prev,
      [name]: value
    }));
  };

  const handleNext = () => {
    if (currentStep < steps.length - 1) {
      setCurrentStep(prev => prev + 1);
    } else {
      // Submit form data to backend
      console.log('Form submitted:', formData);
      navigate('/chat');
    }
  };

  const handleBack = () => {
    if (currentStep > 0) {
      setCurrentStep(prev => prev - 1);
    }
  };

  return (
    <div className="max-w-2xl mx-auto">
      <div className="mb-8">
        <div className="flex justify-between mb-2">
          {steps.map((step, index) => (
            <div
              key={step.id}
              className={`w-1/5 h-2 rounded ${
                index <= currentStep ? 'bg-blue-600' : 'bg-gray-200'
              }`}
            />
          ))}
        </div>
        <p className="text-sm text-gray-500">
          Step {currentStep + 1} of {steps.length}
        </p>
      </div>

      <div className="bg-white p-6 rounded-lg shadow">
        <h2 className="text-2xl font-bold mb-6">
          {t(`onboarding.${steps[currentStep].field}`)}
        </h2>

        <div className="mb-6">
          <input
            type="text"
            name={steps[currentStep].field}
            value={formData[steps[currentStep].field]}
            onChange={handleInputChange}
            className="w-full px-4 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            placeholder={t(`onboarding.${steps[currentStep].field}`)}
          />
        </div>

        <div className="flex justify-between">
          <button
            onClick={handleBack}
            disabled={currentStep === 0}
            className="px-4 py-2 text-gray-600 hover:text-gray-800 disabled:opacity-50"
          >
            {t('common.back')}
          </button>
          <button
            onClick={handleNext}
            className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
          >
            {currentStep === steps.length - 1 ? t('common.submit') : t('common.next')}
          </button>
        </div>
      </div>
    </div>
  );
}

export default Onboarding; 