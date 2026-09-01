'use client';

import React, { useState } from 'react';
import { ShippingAddress } from '@/types/supplement.types';
import { Input, Button } from '@/components/common';
import { useAuth } from '@/hooks/useAuth';
import styles from './styles.module.css';

interface CheckoutFormProps {
  onSubmit: (address: ShippingAddress, saveAddress: boolean, label: string) => void;
  onCancel?: () => void;
  loading?: boolean;
  initialAddress?: Partial<ShippingAddress>;
}

type FieldErrors = Partial<Record<keyof ShippingAddress, string>>;

const NAME_REGEX = /^[A-Za-z][A-Za-z\s.'-]{1,49}$/;
const INDIAN_MOBILE_REGEX = /^[6-9]\d{9}$/;
const ZIP_REGEX = /^[1-9]\d{5}$/;

const validateField = (field: keyof ShippingAddress, value: string): string | undefined => {
  const trimmed = value.trim();
  switch (field) {
    case 'name':
      if (!trimmed) return 'Full name is required';
      if (!NAME_REGEX.test(trimmed)) return 'Enter a valid name (letters only)';
      return undefined;
    case 'phone': {
      if (!trimmed) return 'Phone number is required';
      const digits = trimmed.replace(/\D/g, '');
      if (!INDIAN_MOBILE_REGEX.test(digits)) return 'Enter a valid 10-digit mobile number';
      return undefined;
    }
    case 'addressLine1':
      if (!trimmed) return 'Address is required';
      if (trimmed.length < 4) return 'Address looks too short';
      return undefined;
    case 'city':
      if (!trimmed) return 'City is required';
      return undefined;
    case 'state':
      if (!trimmed) return 'State is required';
      return undefined;
    case 'zipCode':
      if (!trimmed) return 'Zip code is required';
      if (!ZIP_REGEX.test(trimmed)) return 'Enter a valid 6-digit PIN code';
      return undefined;
    case 'country':
      if (!trimmed) return 'Country is required';
      return undefined;
    default:
      return undefined;
  }
};

/** `+919876543210` -> `9876543210`, the 10-digit shape this form stores. */
function toNationalDigits(phone: string | null | undefined): string {
  const digits = (phone ?? '').replace(/\D/g, '');
  return digits.length >= 10 ? digits.slice(-10) : '';
}

const CheckoutForm: React.FC<CheckoutFormProps> = ({
  onSubmit,
  onCancel,
  loading: _loading = false,
  initialAddress,
}) => {
  const { user } = useAuth();
  const accountPhone = toNationalDigits(user?.phone);

  const [formData, setFormData] = useState<ShippingAddress>({
    name: initialAddress?.name || '',
    phone: initialAddress?.phone || '',
    addressLine1: initialAddress?.addressLine1 || '',
    addressLine2: initialAddress?.addressLine2 || '',
    city: initialAddress?.city || '',
    state: initialAddress?.state || '',
    zipCode: initialAddress?.zipCode || '',
    country: initialAddress?.country || 'India',
  });

  // The account number is a prefill, not a lock: it fills the field until the
  // customer types, after which their value stands even if they clear it. Derived
  // rather than written into state so a late AuthContext hydration still lands.
  const [phoneEdited, setPhoneEdited] = useState(false);
  const phoneValue = phoneEdited ? formData.phone : formData.phone || accountPhone;
  const effectiveForm: ShippingAddress = { ...formData, phone: phoneValue };

  const [saveAddress, setSaveAddress] = useState(false);
  const [label, setLabel] = useState('Home');
  const [errors, setErrors] = useState<FieldErrors>({});

  const validateAll = (): boolean => {
    const nextErrors: FieldErrors = {};
    (Object.keys(formData) as (keyof ShippingAddress)[]).forEach((field) => {
      if (field === 'addressLine2') return;
      const err = validateField(field, effectiveForm[field] || '');
      if (err) nextErrors[field] = err;
    });
    setErrors(nextErrors);
    return Object.keys(nextErrors).length === 0;
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (validateAll()) {
      onSubmit(effectiveForm, saveAddress, label);
    }
  };

  const handleChange = (field: keyof ShippingAddress, rawValue: string) => {
    let value = rawValue;
    if (field === 'phone') {
      value = rawValue.replace(/\D/g, '').slice(0, 10);
      setPhoneEdited(true);
    }
    if (field === 'zipCode') value = rawValue.replace(/\D/g, '').slice(0, 6);

    setFormData((prev) => ({ ...prev, [field]: value }));
    if (errors[field]) {
      setErrors((prev) => ({ ...prev, [field]: undefined }));
    }
  };

  const handleBlur = (field: keyof ShippingAddress) => {
    if (field === 'addressLine2') return;
    const err = validateField(field, effectiveForm[field] || '');
    setErrors((prev) => ({ ...prev, [field]: err }));
  };

  return (
    <form onSubmit={handleSubmit} className={styles.formBody} noValidate>
      <div className={styles.formGrid}>
        <Input
          label="Full Name"
          value={formData.name}
          onChange={(e) => handleChange('name', e.target.value)}
          onBlur={() => handleBlur('name')}
          error={errors.name}
          autoComplete="name"
          maxLength={50}
          required
          showRequiredIndicator
          variant="light"
          compact
        />
        <Input
          label="Phone Number"
          type="tel"
          inputMode="numeric"
          value={phoneValue}
          onChange={(e) => handleChange('phone', e.target.value)}
          onBlur={() => handleBlur('phone')}
          error={errors.phone}
          autoComplete="tel-national"
          maxLength={10}
          placeholder="10-digit mobile"
          required
          showRequiredIndicator
          variant="light"
          compact
        />
        <Input
          label="Address Line 1"
          value={formData.addressLine1}
          onChange={(e) => handleChange('addressLine1', e.target.value)}
          onBlur={() => handleBlur('addressLine1')}
          error={errors.addressLine1}
          autoComplete="address-line1"
          placeholder="House / flat, street"
          required
          showRequiredIndicator
          containerClassName={styles.fullWidth}
          variant="light"
          compact
        />
        <Input
          label="Address Line 2"
          value={formData.addressLine2}
          onChange={(e) => handleChange('addressLine2', e.target.value)}
          autoComplete="address-line2"
          placeholder="Landmark, area (optional)"
          containerClassName={styles.fullWidth}
          variant="light"
          compact
        />
        <Input
          label="City"
          value={formData.city}
          onChange={(e) => handleChange('city', e.target.value)}
          onBlur={() => handleBlur('city')}
          error={errors.city}
          autoComplete="address-level2"
          required
          showRequiredIndicator
          variant="light"
          compact
        />
        <Input
          label="State"
          value={formData.state}
          onChange={(e) => handleChange('state', e.target.value)}
          onBlur={() => handleBlur('state')}
          error={errors.state}
          autoComplete="address-level1"
          required
          showRequiredIndicator
          variant="light"
          compact
        />
        <Input
          label="Zip Code"
          inputMode="numeric"
          value={formData.zipCode}
          onChange={(e) => handleChange('zipCode', e.target.value)}
          onBlur={() => handleBlur('zipCode')}
          error={errors.zipCode}
          autoComplete="postal-code"
          maxLength={6}
          placeholder="6-digit PIN"
          required
          showRequiredIndicator
          variant="light"
          compact
        />
        <Input
          label="Country"
          value={formData.country}
          onChange={(e) => handleChange('country', e.target.value)}
          autoComplete="country-name"
          readOnly
          required
          showRequiredIndicator
          variant="light"
          compact
        />
      </div>

      <div className={styles.saveAddressSection}>
        <label className={styles.checkboxLabel}>
          <input
            type="checkbox"
            checked={saveAddress}
            onChange={(e) => setSaveAddress(e.target.checked)}
            className={styles.checkbox}
          />
          <span>Save this address for future use</span>
        </label>

        {saveAddress && (
          <div className={styles.labelSelection}>
            <span className={styles.labelText}>Save as:</span>
            <div className={styles.radioGroup}>
              {['Home', 'Work', 'Other'].map((l) => (
                <label key={l} className={styles.radioLabel}>
                  <input
                    type="radio"
                    name="addressLabel"
                    value={l}
                    checked={label === l}
                    onChange={(e) => setLabel(e.target.value)}
                    className={styles.radio}
                  />
                  {l}
                </label>
              ))}
            </div>
          </div>
        )}
      </div>

      <div className={styles.actions}>
        {onCancel && (
          <Button type="button" variant="secondary" onClick={onCancel} className={styles.cancelButton}>
            Cancel
          </Button>
        )}
        <Button type="submit" variant="primary" loading={false} className={styles.submitButton}>
          Use this address
        </Button>
      </div>
    </form>
  );
};

export default CheckoutForm;
