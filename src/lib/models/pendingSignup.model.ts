import mongoose, { Schema, Model, Document } from 'mongoose';

export interface IPendingSignup extends Document {
  phone: string;
  name: string;
  expiresAt: Date;
}

const pendingSignupSchema = new Schema<IPendingSignup>({
  phone: {
    type: String,
    required: true,
    unique: true,
    trim: true,
  },
  name: {
    type: String,
    required: true,
    trim: true,
  },
  // No `role`. It was writable from the signup request body and rode through to
  // user creation, so a caller could ask for THERAPIST and get it. Signup only
  // ever creates customers; the field is gone so it cannot be reintroduced by
  // accident. Any in-flight document still carrying one is ignored (strict mode)
  // and expires within the 10-minute TTL.
  expiresAt: {
    type: Date,
    required: true,
  },
});

pendingSignupSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

// Force Mongoose to use the updated schema in development. Without this the model
// compiled before a schema change survives hot-reload, and `strict: true` silently
// drops the new field on write — the update succeeds having written nothing.
if (process.env.NODE_ENV === 'development') {
  delete mongoose.models.PendingSignup;
}

const PendingSignup: Model<IPendingSignup> =
  mongoose.models.PendingSignup || mongoose.model<IPendingSignup>('PendingSignup', pendingSignupSchema);

export default PendingSignup;
