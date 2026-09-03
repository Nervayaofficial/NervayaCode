'use client';

import { useRef, useState, useEffect, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { therapistsApi } from '@/lib/api/therapists';
import { GENDER, Gender } from '@/lib/constants/enums';
import { uploadApi } from '@/lib/api/upload';
import { toast } from 'sonner';
import { parseCommaSeparated, parseTestimonials } from '@/lib/utils/therapist.utils';
import { validateEmail } from '@/lib/utils/validation.util';
import type { Therapist } from '@/types/therapist.types';
import { INITIAL_THERAPIST_FORM_DATA, type TherapistFormChangeEvent, type TherapistFormData } from './formData';

function therapistToFormData(data: Therapist): TherapistFormData {
  return {
    name: data.name || '',
    email: data.email || '',
    qualifications: Array.isArray(data.qualifications) ? data.qualifications.join(', ') : '',
    experience: data.experience != null ? String(data.experience) : '',
    gender: (data.gender as Gender) || GENDER.OTHER,
    languages: Array.isArray(data.languages) ? data.languages.join(', ') : '',
    specializations: Array.isArray(data.specializations) ? data.specializations.join(', ') : '',
    image: data.image || '',
    galleryImages: Array.isArray(data.galleryImages) ? data.galleryImages : [],
    introVideoUrl: data.introVideoUrl || '',
    bio: data.bio || '',
    bioLong: data.bioLong || '',
    quote: data.quote || '',
    messageToClient: data.messageToClient || '',
    sessionFee: data.sessionFee != null ? String(data.sessionFee) : '',
    sessionDurationMins: data.sessionDurationMins != null ? String(data.sessionDurationMins) : '',
    testimonials: data.testimonials?.map((t) => `${t.name} | ${t.clientSince ?? ''} | ${t.message}`).join('\n') ?? '',
  };
}

function toFormData(initialData: Therapist | TherapistFormData | null | undefined): TherapistFormData {
  if (!initialData) return INITIAL_THERAPIST_FORM_DATA;
  if ('_id' in initialData) {
    return therapistToFormData(initialData as Therapist);
  }
  return initialData as TherapistFormData;
}

export function useAddTherapistForm(initialData?: Therapist | TherapistFormData | null, therapistId?: string) {
  const router = useRouter();
  const videoInputRef = useRef<HTMLInputElement>(null);
  const [formData, setFormData] = useState<TherapistFormData>(() => toFormData(initialData));
  const [loading, setLoading] = useState(false);
  const [videoUploading, setVideoUploading] = useState(false);
  const [imageUploading, setImageUploading] = useState(false);
  const [currentStep, setCurrentStep] = useState(1);
  const [error, setError] = useState<string | null>(null);

  const totalSteps = 4;

  const initialSnapshot = useMemo(() => toFormData(initialData), [initialData]);
  const isDirty = JSON.stringify(formData) !== JSON.stringify(initialSnapshot);

  /**
   * Name and email live on step 1, but used to be validated only at final
   * submit — three steps later, with no indication of where to go back to.
   * Email especially: it is the therapist's sign-in identity, so catching it
   * late is expensive.
   *
   * Format is all we can check. Therapists sign in with their PERSONAL Google
   * account, so there is no domain to validate against — this field is the whole
   * authorization list for `/therapist-login`, and a typo that happens to be a
   * real Gmail would hand that stranger therapist access. Hence the warning in
   * BasicInformationSection and `scripts/audit-therapist-emails.ts`.
   */
  const validateStep = (step: number): string | null => {
    if (step !== 1) return null;

    if (!formData.name?.trim()) return 'Therapist name is required';

    const email = formData.email?.trim().toLowerCase() ?? '';
    if (!email) return 'Email is required';
    if (!validateEmail(email)) return 'Please enter a valid email address';
    return null;
  };

  const nextStep = () => {
    const problem = validateStep(currentStep);
    if (problem) {
      toast.error(problem);
      return;
    }
    setCurrentStep((prev) => Math.min(prev + 1, totalSteps));
  };

  const prevStep = () => {
    setCurrentStep((prev) => Math.max(prev - 1, 1));
  };

  useEffect(() => {
    if (initialData) {
      setFormData(toFormData(initialData));
    }
  }, [initialData]);

  const setField = (field: keyof TherapistFormData, value: string) => {
    setFormData((prev) => ({ ...prev, [field]: value }));
  };

  const handleTagChange = (field: keyof TherapistFormData, tags: string[]) => {
    setField(field, tags.join(', '));
  };

  const handleChange = (e: TherapistFormChangeEvent) => {
    const { name, value } = e.target;
    setField(name as keyof TherapistFormData, value);
  };

  const handleImageUpload = (url: string) => {
    setField('image', url);
  };

  const handleGalleryImagesChange = (urls: string[]) => {
    setFormData((prev) => ({ ...prev, galleryImages: urls }));
  };

  const handleImageLoading = (isLoading: boolean) => {
    setImageUploading(isLoading);
  };

  const handleVideoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) {
      return;
    }

    setVideoUploading(true);
    setError(null);

    try {
      const uploadForm = new FormData();
      uploadForm.append('file', file);
      const response = await uploadApi.video(uploadForm);

      if (response.success && response.data?.url) {
        setField('introVideoUrl', response.data.url);
        toast.success('Video uploaded successfully');
      } else {
        setError(response.message || 'Video upload failed');
        toast.error(response.message || 'Video upload failed');
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Video upload failed';
      setError(msg);
      toast.error(msg);
    } finally {
      setVideoUploading(false);
      if (videoInputRef.current) {
        videoInputRef.current.value = '';
      }
    }
  };

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();

    // Safety guard: only allow submission on the final step
    if (currentStep < totalSteps) {
      nextStep();
      return;
    }

    // Re-check step 1 here too: editing an existing therapist can reach the
    // final step without ever passing through nextStep's guard.
    const stepOneProblem = validateStep(1);
    if (stepOneProblem) {
      toast.error(stepOneProblem);
      setCurrentStep(1);
      return;
    }
    if (!formData.sessionFee || Number(formData.sessionFee) <= 0) {
      toast.error('Session fee must be greater than 0');
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const payload = {
        ...formData,
        gender: formData.gender,
        qualifications: parseCommaSeparated(formData.qualifications),
        languages: parseCommaSeparated(formData.languages),
        specializations: parseCommaSeparated(formData.specializations),
        experience: Number(formData.experience) || 0,
        galleryImages: formData.galleryImages,
        sessionModes: ['Online'],
        testimonials: parseTestimonials(formData.testimonials),
        sessionFee: formData.sessionFee ? Number(formData.sessionFee) : 0,
        sessionDurationMins: formData.sessionDurationMins ? Number(formData.sessionDurationMins) : 0,
      };

      const result = therapistId
        ? await therapistsApi.update(therapistId, payload)
        : await therapistsApi.create(payload);

      if (result.success) {
        toast.success(`Therapist profile ${therapistId ? 'updated' : 'created'} successfully`);
        router.push('/admin/therapists');
        return;
      }

      setError(result.message || `Failed to ${therapistId ? 'update' : 'create'} therapist`);
      toast.error(result.message || `Failed to ${therapistId ? 'update' : 'create'} therapist`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'An error occurred';
      setError(msg);
      toast.error(msg);
    } finally {
      setLoading(false);
    }
  };

  return {
    error,
    formData,
    handleChange,
    handleImageUpload,
    handleGalleryImagesChange,
    handleTagChange,
    handleSubmit,
    handleVideoUpload,
    imageUploading,
    videoUploading,
    loading,
    videoInputRef,
    handleImageLoading,
    currentStep,
    totalSteps,
    nextStep,
    prevStep,
    setCurrentStep,
    isDirty,
  };
}
