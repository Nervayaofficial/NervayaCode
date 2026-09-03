'use client';

import React from 'react';
import Link from 'next/link';

import { AUTH_FORM_MODE, AUTH_STEP, type AuthFormMode } from '@/lib/constants/enums';
import { AuthShell } from '@/components/AuthShell';
import { ROUTES } from '@/utils/routesConstants';
import { OTPVerificationStep } from './OTPVerificationStep';
import { LoginForm } from './LoginForm';
import { SignupForm } from './SignupForm';
import { useLoginSignupFlow } from './useLoginSignupFlow';
import styles from './styles.module.css';

export interface LoginSignupFormProps {
  initialMode?: AuthFormMode;
  returnUrl?: string;
}

/**
 * Customer sign-in: WhatsApp number + OTP, and nothing else.
 *
 * There is deliberately no "Continue with Google" here. Google sign-in is the
 * therapist door (`/therapist-login`), and its only account-creating branch used
 * to mint a CUSTOMER with `phone: null` — which is what made the WhatsApp number
 * optional in practice. Every customer account now comes through the OTP path,
 * so every customer has a verified number.
 */
const LoginSignupForm: React.FC<LoginSignupFormProps> = ({ initialMode = AUTH_FORM_MODE.LOGIN, returnUrl }) => {
  const {
    authStep,
    otpPurpose,
    isSignup,
    phone,
    name,
    fieldErrors,
    loading,
    error,
    onLoginSubmit,
    onSignupSubmit,
    onOtpSuccess,
    onOtpBack,
    switchMode,
    handleInputChange,
  } = useLoginSignupFlow({ initialMode, returnUrl });

  if (authStep === AUTH_STEP.OTP) {
    return (
      <AuthShell>
        <OTPVerificationStep
          phone={phone.trim()}
          purpose={otpPurpose}
          onSuccess={onOtpSuccess}
          onBack={onOtpBack}
          // The hook already primed the cooldown because both backends send the
          // first OTP on submit — auto-sending here would deliver a duplicate.
          autoSend={false}
        />
      </AuthShell>
    );
  }

  return (
    <AuthShell>
      <div className={styles.toggle} role="tablist" aria-label="Choose log in or sign up">
        <button
          type="button"
          role="tab"
          aria-selected={!isSignup}
          className={`${styles.toggleBtn} ${!isSignup ? styles.toggleActive : ''}`}
          onClick={() => switchMode(false)}
        >
          Log in
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={isSignup}
          className={`${styles.toggleBtn} ${isSignup ? styles.toggleActive : ''}`}
          onClick={() => switchMode(true)}
        >
          Sign up
        </button>
      </div>

      <div className={styles.intro}>
        <h1 className={styles.heading}>{isSignup ? 'Create your account' : 'Welcome back'}</h1>
        <p className={styles.subheading}>
          {isSignup
            ? 'Take the first step towards a happier you.'
            : 'Enter your WhatsApp number and we’ll send you a code.'}
        </p>
      </div>

      <div className={styles.formWrap} key={isSignup ? 'signup' : 'login'}>
        {isSignup ? (
          <SignupForm
            name={name}
            phone={phone}
            fieldErrors={fieldErrors}
            loading={loading}
            error={error}
            onSubmit={onSignupSubmit}
            onInputChange={handleInputChange}
          />
        ) : (
          <LoginForm
            phone={phone}
            fieldErrors={fieldErrors}
            loading={loading}
            error={error}
            onSubmit={onLoginSubmit}
            onInputChange={handleInputChange}
          />
        )}
      </div>

      <p className={styles.footerLink}>
        {isSignup ? 'Already have an account? ' : 'New here? '}
        <button type="button" className={styles.footerLinkBtn} onClick={() => switchMode(!isSignup)}>
          {isSignup ? 'Log in' : 'Sign up'}
        </button>
      </p>

      <p className={styles.staffLink}>
        Are you a therapist?{' '}
        <Link href={ROUTES.THERAPIST_LOGIN} className={styles.staffLinkAnchor}>
          Sign in here
        </Link>
      </p>
    </AuthShell>
  );
};

export default LoginSignupForm;
