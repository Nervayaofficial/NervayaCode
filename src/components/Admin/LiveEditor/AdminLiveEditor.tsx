'use client';

import React, { useState } from 'react';
import { SupplementFormData, AdditionalSection } from '@/types/supplement.types';
import { ProductImageGallery } from '@/components/Supplements/ProductDetail';
import { EditableField } from './EditableField';
import ImageUpload from '@/components/ImageUpload/ImageUpload';
import MultiImageUpload from '@/components/ImageUpload/MultiImageUpload';
import { Icon } from '@iconify/react';
import { ICON_SAVE_FANCY, ICON_TRASH, ICON_CAMERA, ICON_INFO, ICON_PLUS_CIRCLE } from '@/constants/icons';
import styles from './AdminLiveEditor.module.css';
import detailStyles from '@/app/(customer)/sleep-supplements/detail.module.css';
import infoStyles from '@/components/Supplements/ProductDetail/ProductInfo/ProductInfo.module.css';
import tabStyles from '@/components/Supplements/ProductDetail/TabDescription/TabDescription.module.css';
import { RichTextEditor } from '@/components/common/RichTextEditor';
import NextImage from 'next/image';

interface AdminLiveEditorProps {
  formData: SupplementFormData;
  setFormData: React.Dispatch<React.SetStateAction<SupplementFormData | null>>;
  onSave: () => void;
  loading?: boolean;
}

const AdminLiveEditor: React.FC<AdminLiveEditorProps> = ({ formData, setFormData, onSave, loading }) => {
  const [activeTab, setActiveTab] = useState<'description' | 'shipping'>('description');
  const [mediaUploading, setMediaUploading] = useState(false);

  const handleChange = (field: keyof SupplementFormData, value: SupplementFormData[keyof SupplementFormData]) => {
    setFormData((prev) => (prev ? { ...prev, [field]: value } : prev));
  };

  const handleAddSection = () => {
    const newSections = [...(formData.additionalSections || []), { title: 'New Heading', content: [] }];
    handleChange('additionalSections', newSections);
  };

  const handleRemoveSection = (index: number) => {
    const newSections = (formData.additionalSections || []).filter((_, i) => i !== index);
    handleChange('additionalSections', newSections);
  };

  const handleSectionChange = (index: number, field: keyof AdditionalSection, value: string) => {
    const newSections = [...(formData.additionalSections || [])];
    if (field === 'content') {
      const arrayValue = value
        .split('\n')
        .map((s: string) => s.trim())
        .filter(Boolean);
      newSections[index] = { ...newSections[index], content: arrayValue };
    } else {
      newSections[index] = { ...newSections[index], title: value };
    }
    handleChange('additionalSections', newSections);
  };

  const handleAddBenefit = () => {
    if (formData.benefits.length >= 5) return;
    const newBenefits = [...(formData.benefits || []), ''];
    handleChange('benefits', newBenefits);
  };

  const handleRemoveBenefit = (index: number) => {
    const newBenefits = (formData.benefits || []).filter((_, i) => i !== index);
    handleChange('benefits', newBenefits);
  };

  const handleBenefitChange = (index: number, value: string) => {
    const newBenefits = [...(formData.benefits || [])];
    newBenefits[index] = value;
    handleChange('benefits', newBenefits);
  };

  const handleBenefitKeyDown = (e: React.KeyboardEvent, index: number) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      if (formData.benefits.length >= 5) return;
      const newBenefits = [...(formData.benefits || [])];
      newBenefits.splice(index + 1, 0, '');
      handleChange('benefits', newBenefits);
    }
    if (e.key === 'Backspace' && !formData.benefits[index] && formData.benefits.length > 1) {
      e.preventDefault();
      handleRemoveBenefit(index);
    }
  };

  const handleBenefitPaste = (e: React.ClipboardEvent, index: number) => {
    e.preventDefault();
    const text = e.clipboardData.getData('text');
    const lines = text
      .split(/\r?\n/)
      .map((s) => s.trim())
      .filter(Boolean);
    if (lines.length > 1) {
      const currentBenefits = [...(formData.benefits || [])];
      const remainingSlots = 5 - (currentBenefits.length - 1); // Replacing 1 item with lines
      const slicedLines = lines.slice(0, Math.max(0, remainingSlots));
      currentBenefits.splice(index, 1, ...slicedLines);
      handleChange('benefits', currentBenefits);
    } else {
      handleBenefitChange(index, text);
    }
  };

  const mainImage = formData.images?.length ? formData.images[0] : formData.image;
  const discountPercent =
    formData.originalPrice && formData.originalPrice > formData.price
      ? Math.round(((formData.originalPrice - formData.price) / formData.originalPrice) * 100)
      : undefined;

  return (
    <div className={styles.liveEditor}>
      <div className={detailStyles.container}>
        <div className={detailStyles.content}>
          <div className={detailStyles.imageSection}>
            <ProductImageGallery
              mainImage={mainImage}
              images={formData.images}
              discountPercent={discountPercent}
              alt={formData.name}
            />

            {/* Visual Media Management (Multimedia Studio) */}
            <div className={styles.multimediaStudio}>
              <div className={styles.sectionHeader}>
                <h4 className={styles.studioTitle}>
                  <Icon icon={ICON_CAMERA} /> Multimedia Studio
                </h4>
                <div className={styles.tooltipRoot}>
                  <Icon icon={ICON_INFO} className={styles.infoIcon} />
                  <span className={styles.tooltipText}>Upload images to Cloudinary</span>
                </div>
              </div>

              <div className={styles.imageSelectorInline}>
                <ImageUpload
                  onUpload={(url) => handleChange('image', url)}
                  onLoadingChange={setMediaUploading}
                  initialUrl={formData.image}
                  label="Upload Primary"
                  tone="light"
                />
              </div>

              <div className={styles.galleryManagement}>
                <label className={styles.mediaLabel}>Gallery Images</label>
                <MultiImageUpload
                  urls={formData.images || []}
                  onChange={(urls) => handleChange('images', urls)}
                  label="Upload Gallery Images"
                  tone="light"
                  onLoadingChange={setMediaUploading}
                  maxImages={5}
                />
                {formData.images && formData.images.length > 0 && (
                  <div className={styles.galleryThumbGrid}>
                    {formData.images.map((url) => (
                      <div key={`gallery-thumb-${url}`} className={styles.galleryThumbItem}>
                        <NextImage src={url} alt="Gallery Preview" fill className={styles.previewThumb} unoptimized />
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>

          <div className={detailStyles.detailsSection}>
            <div className={infoStyles.info}>
              <EditableField
                value={formData.name}
                onSave={(val) => handleChange('name', val)}
                label="Product Name"
                tooltip="Official product name shown to all customers"
                className={styles.titleEdit}
              />

              <EditableField
                value={formData.shortDescription || ''}
                onSave={(val) => handleChange('shortDescription', val)}
                label="Short Description"
                tooltip="A brief tagline shown under the title"
                className={styles.taglineEdit}
              />

              <div className={infoStyles.priceRow}>
                <div className={styles.priceGrid}>
                  <div className={styles.priceColumn}>
                    <span className={styles.priceLabel}>Selling Price (₹)</span>
                    <EditableField
                      value={formData.price.toString()}
                      onSave={(val) => handleChange('price', parseFloat(val) || 0)}
                      label="Price"
                      tooltip="The checkout price"
                      type="number"
                      className={styles.priceValue}
                    />
                  </div>
                  <div className={styles.priceColumn}>
                    <span className={styles.priceLabel}>Original Price (₹)</span>
                    <EditableField
                      value={formData.originalPrice?.toString() || ''}
                      onSave={(val) => handleChange('originalPrice', val ? parseFloat(val) : undefined)}
                      label="Original Price"
                      tooltip="Show a slashed price for discounts"
                      type="number"
                      className={styles.priceValue}
                    />
                  </div>
                  <div className={styles.priceColumn}>
                    <span className={styles.priceLabel}>Stock</span>
                    <EditableField
                      value={formData.stock.toString()}
                      onSave={(val) => handleChange('stock', parseInt(val, 10) || 0)}
                      label="Stock"
                      tooltip="Inventory available"
                      type="number"
                      className={styles.priceValue}
                    />
                  </div>
                </div>
              </div>

              <div className={styles.textPadSection}>
                <div className={styles.sectionHeader}>
                  <h3 className={infoStyles.highlightsTitle}>Key Benefits (Highlights)</h3>
                  <div className={styles.tooltipRoot}>
                    <Icon icon="lucide:check" className={styles.infoIcon} />
                    <span className={styles.tooltipText}>Max 5 points. Press Enter for a new point.</span>
                  </div>
                </div>

                <div className={styles.benefitList}>
                  {(formData.benefits.length > 0 ? formData.benefits : ['']).map((benefit, idx) => (
                    // eslint-disable-next-line react/no-array-index-key
                    <div key={`benefit-${idx}-${benefit.substring(0, 10)}`} className={styles.benefitItem}>
                      <span className={styles.bulletDot} />
                      <input
                        type="text"
                        className={styles.benefitInput}
                        value={benefit}
                        onChange={(e) => handleBenefitChange(idx, e.target.value)}
                        onKeyDown={(e) => handleBenefitKeyDown(e, idx)}
                        onPaste={(e) => handleBenefitPaste(e, idx)}
                        placeholder="Add a benefit point..."
                        autoFocus={idx === formData.benefits.length - 1 && benefit === ''}
                      />
                      <button
                        className={styles.benefitRemoveBtn}
                        onClick={() => handleRemoveBenefit(idx)}
                        title="Remove Point"
                      >
                        <Icon icon={ICON_TRASH} />
                      </button>
                    </div>
                  ))}
                  {formData.benefits.length < 5 && (
                    <button className={styles.addPointInline} onClick={handleAddBenefit}>
                      <Icon icon={ICON_PLUS_CIRCLE} /> Add Another Highlight ({formData.benefits.length}/5)
                    </button>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>

        <div className={styles.tabsSection}>
          <div className={styles.tabList}>
            <button
              className={`${styles.tab} ${activeTab === 'description' ? styles.activeTab : ''}`}
              onClick={() => setActiveTab('description')}
            >
              Description & Details
            </button>
            <button
              className={`${styles.tab} ${activeTab === 'shipping' ? styles.activeTab : ''}`}
              onClick={() => setActiveTab('shipping')}
            >
              Shipping & Delivery
            </button>
          </div>

          <div className={styles.tabContent}>
            {activeTab === 'description' ? (
              <div className={tabStyles.content}>
                <div className={styles.editableTabSection}>
                  <h3 className={tabStyles.heading}>Product Overview</h3>
                  <RichTextEditor
                    value={formData.description}
                    onChange={(val) => handleChange('description', val)}
                    placeholder="Provide a professional overview..."
                  />
                </div>

                <div className={styles.editableTabSection}>
                  <h3 className={tabStyles.heading}>Ingredients</h3>
                  <textarea
                    className={styles.textPad}
                    value={formData.ingredients.join('\n')}
                    onChange={(e) =>
                      handleChange(
                        'ingredients',
                        e.target.value
                          .split('\n')
                          .map((s) => s.trim())
                          .filter(Boolean),
                      )
                    }
                    placeholder="Enter ingredients, one per line..."
                  />
                  <p className={styles.hint}>Tip: Paste your ingredients list here directly.</p>
                </div>

                {/* Additional Sections Group */}
                {formData.additionalSections && formData.additionalSections.length > 0 && (
                  <div className={styles.customSectionsList}>
                    <h4 className={styles.customSectionsLabel}>Extra Information Sections</h4>
                    {formData.additionalSections.map((section, idx) => (
                      // eslint-disable-next-line react/no-array-index-key
                      <div key={`section-${idx}-${section.title}`} className={styles.customSectionCard}>
                        <div className={styles.flexBetween}>
                          <EditableField
                            value={section.title}
                            onSave={(val) => handleSectionChange(idx, 'title', val)}
                            label="Section Heading"
                            tooltip="Custom heading for this piece of information"
                            className={styles.sectionHeadingEdit}
                          />
                          <button
                            className={styles.removeSectionInline}
                            onClick={() => handleRemoveSection(idx)}
                            title="Remove Section"
                          >
                            <Icon icon={ICON_TRASH} />
                          </button>
                        </div>
                        <textarea
                          className={styles.textPad}
                          value={section.content.join('\n')}
                          onChange={(e) => handleSectionChange(idx, 'content', e.target.value)}
                          placeholder="Enter details, one per line..."
                          rows={3}
                        />
                      </div>
                    ))}
                  </div>
                )}

                <button className={styles.addSectionBtn} onClick={handleAddSection}>
                  <Icon icon={ICON_PLUS_CIRCLE} /> Add Custom Product Info Section
                </button>

                <div className={styles.editableTabSection}>
                  <h3 className={tabStyles.heading}>Suggested Use</h3>
                  <EditableField
                    value={formData.suggestedUse || ''}
                    onSave={(val) => handleChange('suggestedUse', val)}
                    label="Suggested Use"
                    tooltip="Instructions for the user"
                    multiline
                  />
                </div>
              </div>
            ) : (
              <div className={styles.staticContent}>Shipping and delivery information is managed globally.</div>
            )}
          </div>
        </div>
      </div>

      <button className={styles.saveButton} onClick={() => onSave()} disabled={loading || mediaUploading}>
        <Icon icon={loading || mediaUploading ? 'line-md:loading-twotone-loop' : ICON_SAVE_FANCY} />
        {loading ? 'Saving...' : mediaUploading ? 'Uploading Media...' : 'Save Product Changes'}
      </button>
    </div>
  );
};

export default AdminLiveEditor;
