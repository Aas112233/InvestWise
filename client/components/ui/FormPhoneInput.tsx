import React, { useState, useEffect } from 'react';
import { Phone, ChevronDown, Globe } from 'lucide-react';
import { FormLabel } from './FormElements';

export interface CountryCodeOption {
  code: string;
  dialCode: string;
  name: string;
}

export const COUNTRY_CODES: CountryCodeOption[] = [
  { code: 'BD', dialCode: '+880', name: 'Bangladesh' },
  { code: 'US', dialCode: '+1', name: 'United States' },
  { code: 'GB', dialCode: '+44', name: 'United Kingdom' },
  { code: 'AE', dialCode: '+971', name: 'UAE' },
  { code: 'SA', dialCode: '+966', name: 'Saudi Arabia' },
  { code: 'CA', dialCode: '+1', name: 'Canada' },
  { code: 'AU', dialCode: '+61', name: 'Australia' },
  { code: 'IN', dialCode: '+91', name: 'India' },
  { code: 'SG', dialCode: '+65', name: 'Singapore' },
  { code: 'MY', dialCode: '+60', name: 'Malaysia' },
  { code: 'QA', dialCode: '+974', name: 'Qatar' },
  { code: 'KW', dialCode: '+965', name: 'Kuwait' },
  { code: 'OM', dialCode: '+968', name: 'Oman' },
  { code: 'BH', dialCode: '+973', name: 'Bahrain' },
  { code: 'DE', dialCode: '+49', name: 'Germany' },
  { code: 'FR', dialCode: '+33', name: 'France' },
  { code: 'IT', dialCode: '+39', name: 'Italy' },
  { code: 'JP', dialCode: '+81', name: 'Japan' },
  { code: 'CN', dialCode: '+86', name: 'China' },
  { code: 'ZA', dialCode: '+27', name: 'South Africa' },
];

interface FormPhoneInputProps {
  label: string;
  value?: string;
  onChange: (value: string) => void;
  error?: string;
  required?: boolean;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
}

export const FormPhoneInput: React.FC<FormPhoneInputProps> = ({
  label,
  value = '',
  onChange,
  error,
  required,
  placeholder = '17XXXXXXXX',
  disabled = false,
  className = '',
}) => {
  const [selectedDialCode, setSelectedDialCode] = useState('+880');
  const [phoneNumber, setPhoneNumber] = useState('');

  // Sync internal state when prop `value` changes
  useEffect(() => {
    if (!value) {
      setPhoneNumber('');
      return;
    }

    // Try to match dial code from value string
    const matchedCountry = COUNTRY_CODES.find((c) => value.startsWith(c.dialCode));
    if (matchedCountry) {
      setSelectedDialCode(matchedCountry.dialCode);
      setPhoneNumber(value.slice(matchedCountry.dialCode.length).trim());
    } else if (value.startsWith('+')) {
      // Unknown prefix, keep full string
      setPhoneNumber(value);
    } else {
      setPhoneNumber(value);
    }
  }, [value]);

  const handleDialCodeChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const newDialCode = e.target.value;
    setSelectedDialCode(newDialCode);
    const cleanedNumber = phoneNumber.replace(/^[+\d\s-]+/, (match) => {
      return match.startsWith('+') ? '' : match;
    }).trim();
    const combined = cleanedNumber ? `${newDialCode}${cleanedNumber}` : '';
    onChange(combined);
  };

  const handleNumberChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const inputVal = e.target.value.replace(/[^\d\s-]/g, '');
    setPhoneNumber(inputVal);
    const combined = inputVal.trim() ? `${selectedDialCode}${inputVal.trim()}` : '';
    onChange(combined);
  };

  const selectedCountry = COUNTRY_CODES.find((c) => c.dialCode === selectedDialCode) || COUNTRY_CODES[0];

  return (
    <div className={`space-y-1.5 ${className}`}>
      <FormLabel required={required}>{label}</FormLabel>
      <div className="flex rounded-2xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-slate-900 focus-within:ring-2 focus-within:ring-blue-600 dark:focus-within:ring-brand focus-within:border-transparent transition-all overflow-hidden shadow-sm">
        {/* Country Select Dropdown */}
        <div className="relative flex items-center bg-gray-50 dark:bg-slate-800/80 border-r border-gray-200 dark:border-gray-800 px-3 py-3 gap-1.5 min-w-[110px]">
          <Globe size={14} className="text-slate-500 shrink-0" />
          <span className="text-xs font-bold text-slate-700 dark:text-slate-200">{selectedCountry.dialCode}</span>
          <ChevronDown size={14} className="text-slate-400 ml-auto pointer-events-none" />
          <select
            value={selectedDialCode}
            onChange={handleDialCodeChange}
            disabled={disabled}
            className="absolute inset-0 opacity-0 cursor-pointer w-full h-full text-xs"
          >
            {COUNTRY_CODES.map((c) => (
              <option key={`${c.code}-${c.dialCode}`} value={c.dialCode} className="bg-white dark:bg-slate-900 text-slate-900 dark:text-white">
                {c.name} ({c.dialCode})
              </option>
            ))}
          </select>
        </div>

        {/* Phone Input Field */}
        <div className="relative flex-1 flex items-center px-3">
          <Phone size={16} className="text-slate-400 mr-2 shrink-0" />
          <input
            type="tel"
            value={phoneNumber}
            onChange={handleNumberChange}
            placeholder={placeholder}
            disabled={disabled}
            className="w-full bg-transparent border-none outline-none text-xs font-semibold text-slate-900 dark:text-white placeholder-slate-400 py-3"
          />
        </div>
      </div>
      {error && <p className="text-xs text-red-500 font-medium pl-1">{error}</p>}
    </div>
  );
};

export default FormPhoneInput;
