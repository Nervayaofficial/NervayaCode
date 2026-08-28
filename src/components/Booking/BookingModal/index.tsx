'use client';

import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { createPortal } from 'react-dom';
import { useRouter } from 'next/navigation';
import TimeSlotGrid from '../TimeSlotGrid';
import DatePicker from '../DatePicker';
import { ICON_LOADING } from '@/constants/icons';
import { Icon } from '@iconify/react';
import { BookingModalHeader } from './BookingModalHeader';
import { BookingModalFooter } from '../BookingModalFooter';
import { useBookingSlots } from './useBookingSlots';
import { useTherapist } from '@/queries/therapists/useTherapist';
import { cartApi } from '@/lib/api/cart';
import { ITEM_TYPE } from '@/lib/constants/enums';
import { trackTherapySlotSelected, trackTherapyBooked } from '@/utils/analytics';
import { RazorpayCheckoutScript } from '@/components/common';
import { ensureRazorpayLoaded } from '@/utils/loadRazorpay';
import { useAuth } from '@/hooks/useAuth';
import { usePhoneGate } from '@/hooks/usePhoneGate';
import { PhoneCollectionModal } from '@/components/PhoneCollectionModal';
import { useModalDismiss } from '@/hooks/useModalDismiss';
import { toast } from 'sonner';
import styles from './styles.module.css';

interface BookingModalProps {
  therapistId: string;
  therapistName: string;
  onClose: () => void;
  onSuccess: () => void;
  rescheduleSessionId?: string; // New prop for rescheduling
}

export default function BookingModal({
  therapistId,
  therapistName,
  onClose,
  onSuccess,
  rescheduleSessionId,
}: BookingModalProps) {
  const today = useMemo(() => {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d;
  }, []);
  const maxBookingDate = useMemo(() => {
    const d = new Date();
    d.setMonth(d.getMonth() + 1);
    d.setHours(23, 59, 59, 999);
    return d;
  }, []);

  const [selectedDate, setSelectedDate] = useState<Date>(today);
  const [visibleMonth, setVisibleMonth] = useState<Date>(() => new Date(today.getFullYear(), today.getMonth(), 1));
  const [selectedSlot, setSelectedSlot] = useState<string | null>(null);
  const [booking, setBooking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showConfirm, setShowConfirm] = useState(false);
  const [buyMode, setBuyMode] = useState<'checkout' | 'cart'>('checkout');
  const router = useRouter();

  const handleMonthChange = useCallback((monthStart: Date) => setVisibleMonth(monthStart), []);

  const { data: therapist } = useTherapist(therapistId);
  const { user } = useAuth();
  const phoneGate = usePhoneGate();

  const {
    schedule,
    loading,
    error: slotsError,
    fetchSlots,
    fullyBookedDates,
    slotAvailability,
  } = useBookingSlots(therapistId, selectedDate, visibleMonth);

  const slotsForGrid = useMemo(
    () =>
      schedule?.slots.map((slot) => ({
        _id: slot.startTime,
        therapistId,
        date: schedule.date,
        startTime: slot.startTime,
        endTime: slot.endTime,
        isAvailable: slot.isAvailable,
        isCustomized: slot.isCustomized,
        sessionId: slot.sessionId,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      })) ?? [],
    [schedule, therapistId],
  );

  const handleClose = useCallback(() => {
    onClose();
  }, [onClose]);

  const handleSlotSelect = useCallback(
    (id: string) => {
      setSelectedSlot(id);
      setError(null);
      const slot = slotsForGrid.find((s) => s._id === id);
      if (slot) {
        trackTherapySlotSelected({
          therapy_type: therapist?.specializations?.[0] || 'General Therapy',
          therapist_id: therapistId,
          therapist_name: therapistName,
          slot_datetime: `${slot.date} ${slot.startTime}`,
          price: therapist?.sessionFee ?? 0,
          currency: 'INR',
        });
      }
    },
    [slotsForGrid, therapistId, therapistName, therapist],
  );

  const handleDateSelect = useCallback(
    (date: Date) => {
      const dateOnly = new Date(date);
      dateOnly.setHours(0, 0, 0, 0);
      const todayOnly = new Date(today);
      todayOnly.setHours(0, 0, 0, 0);
      const maxDateOnly = new Date(maxBookingDate);
      maxDateOnly.setHours(0, 0, 0, 0);
      if (dateOnly < todayOnly) {
        setError('Cannot book sessions in the past');
        return;
      }
      if (dateOnly > maxDateOnly) {
        setError('Bookings are only available up to 1 month in advance');
        return;
      }
      setSelectedDate(date);
      setVisibleMonth(new Date(date.getFullYear(), date.getMonth(), 1));
      setSelectedSlot(null);
      setError(null);
    },
    [today, maxBookingDate],
  );

  const handleBookSession = async () => {
    if (!selectedSlot || !schedule) {
      setError('Please select a time slot');
      return;
    }
    const slot = schedule.slots.find((s) => s.startTime === selectedSlot);
    if (!slot || !slot.isAvailable) {
      setError('This slot has been booked. Please select another.');
      setSelectedSlot(null);
      return;
    }
    setBuyMode('checkout');
    setShowConfirm(true);
  };

  const handleAddToCart = async () => {
    if (!selectedSlot || !schedule) {
      setError('Please select a time slot');
      return;
    }
    const slot = schedule.slots.find((s) => s.startTime === selectedSlot);
    if (!slot || !slot.isAvailable) {
      setError('This slot has been booked. Please select another.');
      setSelectedSlot(null);
      return;
    }
    setBuyMode('cart');
    setShowConfirm(true);
  };

  const handleConfirmBooking = async () => {
    if (!selectedSlot || !schedule) return;
    const slot = schedule.slots.find((s) => s.startTime === selectedSlot);
    if (!slot || !slot.isAvailable) return;

    setShowConfirm(false);

    // Session links and reminders go out over WhatsApp, so a verified number is
    // required. Signup no longer collects one, so ask here. The server enforces
    // this independently with a 428 — this is just the friendlier path to it.
    if (!(await phoneGate.ensurePhone())) return;

    setBooking(true);
    setError(null);
    try {
      if (rescheduleSessionId) {
        // --- RESCHEDULING FLOW ---
        const res = await fetch(`/api/sessions/${rescheduleSessionId}/reschedule`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            date: schedule.date,
            startTime: slot.startTime,
          }),
        });
        const data = await res.json();
        if (!res.ok || !data.success) throw new Error(data.message || 'Failed to reschedule');

        toast.info('Session rescheduled successfully!', {
          style: { background: 'var(--color-accent)', color: 'var(--color-background)', border: 'none' },
        });
        onSuccess?.();
        setTimeout(() => onClose(), 1200);
      } else if (buyMode === 'checkout') {
        // --- NORMAL BOOKING FLOW ---
        const orderRes = await fetch('/api/orders/direct', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            itemType: ITEM_TYPE.THERAPY,
            itemId: therapistId,
            quantity: 1,
            metadata: { date: schedule.date, slot: slot.startTime },
          }),
        });
        const orderData = await orderRes.json();
        if (!orderRes.ok || !orderData.success) throw new Error(orderData.message || 'Failed to create order');

        const orderId = orderData.data._id;
        const amount = orderData.data.totalAmount;

        const rzpRes = await fetch('/api/payments/create-order', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ orderId, amount }),
        });
        const rzpData = await rzpRes.json();
        if (!rzpRes.ok || !rzpData.success) throw new Error(rzpData.message || 'Failed to initialize payment');

        // Test customer: the server already settled the order, so skip Razorpay.
        if (rzpData.data?.bypassed) {
          trackTherapyBooked({
            therapy_type: therapist?.specializations?.[0] || 'General Therapy',
            therapist_id: therapistId,
            therapist_name: therapistName,
            slot_datetime: `${schedule.date} ${slot.startTime}`,
            price: therapist?.sessionFee ?? 0,
            currency: 'INR',
          });
          toast.info('Booking confirmed successfully!', {
            style: { background: 'var(--color-accent)', color: 'var(--color-background)', border: 'none' },
          });
          router.push(`/order-success/${orderId}`);
          return;
        }

        // Awaited, not asserted. The <RazorpayCheckoutScript /> below uses
        // `lazyOnload`, so a quick click can beat it; and when an ad-blocker or
        // Brave Shields blocks the script outright, this surfaces that instead
        // of telling the user to retry something that cannot succeed.
        await ensureRazorpayLoaded();

        const options = {
          key: rzpData.data.key_id,
          amount: Math.round(amount * 100),
          currency: 'INR',
          name: 'Nervaya',
          description: `Therapy Booking for ${therapistName}`,
          order_id: rzpData.data.id,
          prefill: { name: user?.name || '', email: user?.email || '', contact: '' },
          theme: { color: 'var(--color-accent)' },
          handler: async (response: {
            razorpay_payment_id: string;
            razorpay_order_id: string;
            razorpay_signature: string;
          }) => {
            try {
              const verifyRes = await fetch('/api/payments/verify', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  orderId,
                  paymentId: response.razorpay_payment_id,
                  razorpaySignature: response.razorpay_signature,
                }),
              });
              const verifyData = await verifyRes.json();
              if (verifyRes.ok && verifyData.success) {
                // Payment successful
                trackTherapyBooked({
                  therapy_type: therapist?.specializations?.[0] || 'General Therapy',
                  therapist_id: therapistId,
                  therapist_name: therapistName,
                  slot_datetime: `${schedule.date} ${slot.startTime}`,
                  price: therapist?.sessionFee ?? 0,
                  currency: 'INR',
                });
                toast.info('Booking confirmed successfully!', {
                  style: { background: 'var(--color-accent)', color: 'var(--color-background)', border: 'none' },
                });
                router.push(`/order-success/${orderId}`);
              } else {
                throw new Error(verifyData.message || 'Verification failed');
              }
            } catch (err) {
              const error = err as Error;
              setError(error.message || 'Payment verification failed');
            }
          },
          modal: {
            ondismiss: () => {
              setBooking(false);
              toast.info('Payment cancelled');
            },
          },
        };

        const razorpay = new window.Razorpay(options);
        razorpay.open();
      } else {
        // Add to cart flow
        await cartApi.add(therapistId, 1, ITEM_TYPE.THERAPY, undefined, undefined, undefined, {
          date: schedule.date,
          slot: slot.startTime,
        });

        trackTherapyBooked({
          therapy_type: therapist?.specializations?.[0] || 'General Therapy',
          therapist_id: therapistId,
          therapist_name: therapistName,
          slot_datetime: `${schedule.date} ${slot.startTime}`,
          price: therapist?.sessionFee ?? 0,
          currency: 'INR',
        });

        toast.info('Added to cart successfully!', {
          style: { background: 'var(--color-accent)', color: 'var(--color-background)', border: 'none' },
        });
        onSuccess?.();
        setTimeout(() => onClose(), 1200);
      }
    } catch (err) {
      const errorMessage =
        (err as { message?: string })?.message ||
        (err instanceof Error ? err.message : 'Error booking session. Please try again.');
      setError(errorMessage);
      if (errorMessage.includes('not available') || errorMessage.includes('already booked')) {
        fetchSlots();
      }
      setBooking(false); // Only reset if an error occurred before Razorpay opened
    }
  };

  const displayError = error || slotsError;

  const formatDate = useCallback(
    (date: Date) =>
      date.toLocaleDateString('en-US', {
        weekday: 'long',
        month: 'long',
        day: 'numeric',
        year: 'numeric',
      }),
    [],
  );

  const [mounted, setMounted] = useState(false);
  const modalRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setMounted(true);
    return () => setMounted(false);
  }, []);

  useModalDismiss(mounted, modalRef, handleClose);

  if (!mounted) return null;

  const modalContent = (
    <div className={styles.overlay}>
      <RazorpayCheckoutScript />
      <div ref={modalRef} className={styles.modal} role="dialog" aria-modal="true">
        <BookingModalHeader therapistName={therapistName} onClose={handleClose} />
        <div className={styles.content}>
          <div className={styles.dateSection}>
            <h3 className={styles.sectionTitle}>Select Date</h3>
            <DatePicker
              selectedDate={selectedDate}
              onDateSelect={handleDateSelect}
              minDate={today}
              maxDate={maxBookingDate}
              fullyBookedDates={fullyBookedDates}
              onMonthChange={handleMonthChange}
              slotAvailability={slotAvailability}
            />
            {selectedDate && (
              <p className={styles.selectedDateText}>
                Selected: <strong>{formatDate(selectedDate)}</strong>
              </p>
            )}
          </div>
          <div className={styles.slotsSection}>
            <h3 className={styles.sectionTitle}>Available Time Slots</h3>
            {loading ? (
              <div className={styles.loadingContainer} aria-busy="true" aria-live="polite">
                <Icon icon={ICON_LOADING} className={styles.loaderIcon} />
              </div>
            ) : displayError && !loading ? (
              <div className={styles.errorMessage}>
                <p>{displayError}</p>
                <button type="button" className={styles.retryBtn} onClick={fetchSlots}>
                  Retry
                </button>
              </div>
            ) : (
              <TimeSlotGrid slots={slotsForGrid} selectedSlot={selectedSlot} onSlotSelect={handleSlotSelect} />
            )}
          </div>
        </div>
        {displayError && !loading && (
          <div className={styles.errorBanner}>
            <span className={styles.errorIcon}>Warning</span>
            <span>{displayError}</span>
          </div>
        )}
        {showConfirm && schedule && selectedSlot && (
          <div className={styles.confirmOverlay}>
            <div className={styles.confirmDialog}>
              <p>
                {rescheduleSessionId
                  ? 'Confirm rescheduling'
                  : `Confirm ${buyMode === 'checkout' ? 'booking & checkout' : 'adding to cart'}`}{' '}
                for <strong>{therapistName}</strong> on {schedule.date} at {selectedSlot}?
              </p>
              <div className={styles.confirmActions}>
                <button type="button" className={styles.confirmCancel} onClick={() => setShowConfirm(false)}>
                  Cancel
                </button>
                <button type="button" className={styles.confirmOk} onClick={handleConfirmBooking}>
                  Confirm
                </button>
              </div>
            </div>
          </div>
        )}
        <BookingModalFooter
          selectedSlot={selectedSlot}
          booking={booking}
          loading={loading}
          onBook={handleBookSession}
          onAddToCart={handleAddToCart}
          sessionFee={therapist?.sessionFee}
          therapistId={therapistId}
          therapistName={therapist?.name}
          selectedDate={schedule?.date}
          isRescheduling={!!rescheduleSessionId}
        />

        <PhoneCollectionModal
          isOpen={phoneGate.isOpen}
          onClose={phoneGate.close}
          onVerified={phoneGate.onVerified}
          reason="We send your session link and a reminder over WhatsApp, so we need a number we can reach you on."
        />
      </div>
    </div>
  );

  return createPortal(modalContent, document.body);
}
