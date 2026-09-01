import type { SavedAddress } from '@/types/supplement.types';
import { Icon } from '@iconify/react';
import { ICON_BOOK_USER, ICON_PLUS } from '@/constants/icons';
import styles from './styles.module.css';

interface CheckoutSavedAddressesProps {
  addresses: SavedAddress[];
  /** `_id` of the chosen address, so the list can show which one is active. */
  selectedId?: string;
  onUseAddress: (addr: SavedAddress) => void;
  onAddNew: () => void;
}

export function CheckoutSavedAddresses({ addresses, selectedId, onUseAddress, onAddNew }: CheckoutSavedAddressesProps) {
  return (
    <div className={styles.savedAddresses}>
      <div className={styles.sectionHeader}>
        <div className={styles.headerLeft}>
          <span className={styles.sectionHeaderSymbol} aria-hidden>
            <Icon icon={ICON_BOOK_USER} width={20} height={20} />
          </span>
          <h3 className={styles.sectionTitle}>Saved Addresses</h3>
        </div>
        <button type="button" className={styles.addNewButton} onClick={onAddNew}>
          <Icon icon={ICON_PLUS} width={16} height={16} />
          Add New
        </button>
      </div>

      {addresses.length > 0 ? (
        <ul className={styles.addressList} role="radiogroup" aria-label="Saved addresses">
          {addresses.map((addr) => {
            const isSelected = addr._id === selectedId;
            return (
              <li
                key={addr._id}
                className={`${styles.addressItem} ${isSelected ? styles.selected : ''}`}
                onClick={() => onUseAddress(addr)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    onUseAddress(addr);
                  }
                }}
                role="radio"
                aria-checked={isSelected}
                tabIndex={isSelected || (!selectedId && addr === addresses[0]) ? 0 : -1}
              >
                <div className={styles.selectionIndicator}>
                  <div className={styles.radioOutline}>
                    <div className={styles.radioInner} />
                  </div>
                </div>
                <div className={styles.addressInfo}>
                  <div className={styles.addressMain}>
                    <span className={styles.addressName}>{addr.name}</span>
                    <span className={styles.addressLabel}>{addr.label}</span>
                    {addr.isDefault && <span className={styles.defaultBadge}>Default</span>}
                  </div>
                  <p className={styles.addressDetails}>
                    {addr.addressLine1}, {addr.addressLine2 ? `${addr.addressLine2}, ` : ''}
                    {addr.city}, {addr.state} {addr.zipCode}
                  </p>
                </div>
                <div className={styles.phoneInfo}>
                  <span className={styles.phoneLabel}>Phone:</span>
                  <span className={styles.phoneText}>{addr.phone}</span>
                </div>
              </li>
            );
          })}
        </ul>
      ) : (
        <div className={styles.emptyAddresses}>
          <p>No saved addresses found. Please add a new shipping address to proceed.</p>
        </div>
      )}
    </div>
  );
}
