import {
  CALENDAR_ACCOUNT_EMAIL,
  SHARED_CALENDAR_MAILBOX,
  getCalendarAuthMode,
  isWorkspaceEmail,
} from '@/lib/constants/workspace.constants';

/**
 * Which mailbox a therapist's session events live on.
 *
 * Domain-wide delegation can only impersonate accounts INSIDE the workspace
 * domain, so a therapist on a personal Gmail cannot host their own calendar
 * event. Two modes:
 *
 *  - `own`    — they have an @nervaya.com mailbox. Events land on their real
 *               calendar; they are the organizer and the Meet host. The
 *               dashboard shows their calendar as-is.
 *  - `shared` — they do not. Events land on ONE shared Nervaya calendar, and
 *               the dashboard shows that calendar filtered down to just this
 *               therapist. They are invited as an attendee, so they still get
 *               the invite and the Meet link.
 *
 * Blocking bookings for `shared` therapists was the alternative, and it is not
 * viable: every currently-live therapist is on a personal address.
 */
export type CalendarOwnerMode = 'own' | 'shared';

export interface CalendarOwner {
  /** The mailbox to impersonate. Inside the workspace domain in `delegated` mode; in `oauth` mode this is the display-only CALENDAR_ACCOUNT_EMAIL. */
  mailbox: string;
  mode: CalendarOwnerMode;
  /**
   * True when this calendar holds more than one therapist's events, so reads
   * MUST be filtered by therapist before anything is shown.
   */
  requiresFiltering: boolean;
}

export function resolveCalendarOwner(therapistEmail?: string | null): CalendarOwner {
  // Without Workspace there is no delegation and therefore exactly one
  // calendar, whatever the therapist's address happens to be. Returning 'own'
  // here would skip the therapist filter and show every therapist all of the
  // shared calendar's events — so this check must come FIRST.
  if (getCalendarAuthMode() === 'oauth') {
    return {
      mailbox: CALENDAR_ACCOUNT_EMAIL,
      mode: 'shared',
      requiresFiltering: true,
    };
  }

  if (isWorkspaceEmail(therapistEmail)) {
    return {
      mailbox: (therapistEmail as string).trim().toLowerCase(),
      mode: 'own',
      requiresFiltering: false,
    };
  }

  return {
    mailbox: SHARED_CALENDAR_MAILBOX,
    mode: 'shared',
    requiresFiltering: true,
  };
}

/**
 * True when the therapist should ALSO be added as an attendee.
 *
 * In `own` mode they are already the organizer, and inviting the organizer to
 * their own event is redundant (Google treats them as an attendee anyway). In
 * `shared` mode the event belongs to a mailbox they cannot see, so the invite
 * is the only way the Meet link reaches them.
 */
export function shouldInviteTherapist(owner: CalendarOwner): boolean {
  return owner.mode === 'shared';
}

/**
 * Tags stamped into `extendedProperties.private` on every event we create.
 *
 * These are what make the shared calendar workable: without a therapist tag
 * there is no way to show one therapist their own sessions without leaking
 * everyone else's. They also let us tell our events apart from a therapist's
 * personal appointments, and recover an event whose id we lost.
 *
 * Values must be strings — Google rejects other types.
 */
export const EVENT_TAG_KEYS = {
  KIND: 'nervayaKind',
  REF_ID: 'nervayaRefId',
  THERAPIST_ID: 'nervayaTherapistId',
} as const;

export type NervayaEventKind = 'session' | 'consultation';

export function buildEventTags(kind: NervayaEventKind, refId: string, therapistId?: string): Record<string, string> {
  return {
    [EVENT_TAG_KEYS.KIND]: kind,
    [EVENT_TAG_KEYS.REF_ID]: refId,
    ...(therapistId ? { [EVENT_TAG_KEYS.THERAPIST_ID]: therapistId } : {}),
  };
}

/**
 * The `privateExtendedProperty` filter for reading one therapist's events back
 * off a shared calendar.
 *
 * Returns null in `own` mode — that calendar holds only their events (plus
 * their personal ones, which we deliberately keep so their availability is
 * honest), so no filter is wanted.
 *
 * ⚠️ Callers in `shared` mode MUST apply this. Passing null there would return
 * every therapist's sessions to whoever asked.
 */
export function buildTherapistEventFilter(owner: CalendarOwner, therapistId: string): string | null {
  if (!owner.requiresFiltering) return null;
  return `${EVENT_TAG_KEYS.THERAPIST_ID}=${therapistId}`;
}
