import mongoose, { Schema, Document, Model, Types } from 'mongoose';
import {
  PAYMENT_STATUS,
  ORDER_STATUS,
  PAYMENT_STATUS_VALUES,
  ORDER_STATUS_VALUES,
  PaymentStatus,
  OrderStatus,
  type ItemType,
} from '@/lib/constants/enums';

export interface IOrderItem {
  itemType: ItemType;
  itemId: Types.ObjectId | string;
  name: string;
  quantity: number;
  price: number;
  image: string;
  metadata?: Record<string, unknown>;
}

export interface IShippingAddress {
  name: string;
  phone: string;
  addressLine1: string;
  addressLine2?: string;
  city: string;
  state: string;
  zipCode: string;
  country: string;
}

export interface IOrder extends Document {
  userId: Types.ObjectId;
  items: IOrderItem[];
  totalAmount: number;
  paymentId?: string;
  razorpayOrderId?: string;
  paymentStatus: PaymentStatus;
  orderStatus: OrderStatus;
  shippingAddress?: IShippingAddress;

  promoCode?: string;
  promoDiscount?: number;
  /** Allocated once the order is paid; never reissued. */
  invoiceNumber?: string;
  /** Cloudinary URL of the rendered invoice PDF. */
  invoiceUrl?: string;
  /**
   * Meta click identifiers captured in the browser at create-order time.
   * Persisted because the Razorpay webhook path has no cookies, and that is the
   * path that fires when the customer closed the tab before returning.
   */
  metaAttribution?: {
    fbp?: string;
    fbc?: string;
    eventSourceUrl?: string;
  };
  createdAt: Date;
  updatedAt: Date;
}

const orderItemSchema = new Schema<IOrderItem>(
  {
    itemType: {
      type: String,
      enum: ['Supplement', 'DriftOff', 'Therapy'],
      required: true,
    },
    itemId: {
      type: Schema.Types.Mixed,
      required: true,
    },
    name: {
      type: String,
      required: true,
    },
    quantity: {
      type: Number,
      required: true,
      min: 1,
    },
    price: {
      type: Number,
      required: true,
      min: 0,
    },
    image: {
      type: String,
      default: '',
    },
    metadata: {
      type: Schema.Types.Mixed,
      default: {},
    },
  },
  { _id: false },
);

const shippingAddressSchema = new Schema<IShippingAddress>(
  {
    name: {
      type: String,
      required: [true, 'Name is required'],
      trim: true,
    },
    phone: {
      type: String,
      required: [true, 'Phone is required'],
      trim: true,
    },
    addressLine1: {
      type: String,
      required: [true, 'Address line 1 is required'],
      trim: true,
    },
    addressLine2: {
      type: String,
      trim: true,
    },
    city: {
      type: String,
      required: [true, 'City is required'],
      trim: true,
    },
    state: {
      type: String,
      required: [true, 'State is required'],
      trim: true,
    },
    zipCode: {
      type: String,
      required: [true, 'Zip code is required'],
      trim: true,
    },
    country: {
      type: String,
      required: [true, 'Country is required'],
      trim: true,
      default: 'India',
    },
  },
  { _id: false },
);

const orderSchema = new Schema<IOrder>(
  {
    userId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: [true, 'User ID is required'],
      index: true,
    },
    items: {
      type: [orderItemSchema],
      required: [true, 'Items are required'],
    },
    totalAmount: {
      type: Number,
      required: [true, 'Total amount is required'],
      min: [0, 'Total amount must be non-negative'],
    },
    paymentId: {
      type: String,
    },
    razorpayOrderId: {
      type: String,
      index: true,
    },
    paymentStatus: {
      type: String,
      enum: PAYMENT_STATUS_VALUES,
      default: PAYMENT_STATUS.PENDING,
      required: true,
    },
    orderStatus: {
      type: String,
      enum: ORDER_STATUS_VALUES,
      default: ORDER_STATUS.PENDING,
      required: true,
    },
    shippingAddress: {
      type: shippingAddressSchema,
      required: false,
    },
    promoCode: { type: String },
    promoDiscount: { type: Number, min: 0 },
    invoiceNumber: { type: String, index: true },
    invoiceUrl: { type: String },
    metaAttribution: {
      type: new Schema(
        {
          fbp: { type: String },
          fbc: { type: String },
          eventSourceUrl: { type: String },
        },
        { _id: false },
      ),
      required: false,
    },
  },
  {
    timestamps: true,
  },
);

orderSchema.index({ userId: 1, createdAt: -1 });
orderSchema.index({ orderStatus: 1, createdAt: -1 });
orderSchema.index({ paymentStatus: 1, createdAt: -1 });

// Force Mongoose to use the updated schema in development
if (process.env.NODE_ENV === 'development') {
  delete mongoose.models.Order;
}

const Order: Model<IOrder> = mongoose.models.Order || mongoose.model<IOrder>('Order', orderSchema);

export default Order;
