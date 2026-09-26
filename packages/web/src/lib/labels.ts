import type { EmailKind, OfferPreset, PipelineStage, SocialPlatform } from '@outreach/shared';

/** Offer presets live on the server as a plain string field — this is the UI-side guard. */
export const OFFER_PRESETS: readonly OfferPreset[] = ['websites', 'social_media', 'balanced'];

export const OFFER_PRESET_LABELS: Record<OfferPreset, string> = {
  websites: 'Websites',
  social_media: 'Social media',
  balanced: 'Balanced',
};

export function toOfferPreset(value: string | null | undefined): OfferPreset {
  return OFFER_PRESETS.find((preset) => preset === value) ?? 'websites';
}

/** Human labels for values that the shared contract only ships as machine keys. */
export const PIPELINE_LABELS: Record<PipelineStage, string> = {
  new: 'New',
  contacted: 'Contacted',
  replied: 'Replied',
  won: 'Won',
  lost: 'Lost',
};

export const SOCIAL_LABELS: Record<SocialPlatform, string> = {
  youtube: 'YouTube',
  tiktok: 'TikTok',
  facebook: 'Facebook',
  instagram: 'Instagram',
  twitter: 'X',
  linkedin: 'LinkedIn',
  pinterest: 'Pinterest',
  threads: 'Threads',
  telegram: 'Telegram',
  whatsapp: 'WhatsApp',
  linkinbio: 'Link-in-bio',
  other: 'Other',
};

/** Short monogram shown in the round platform tile (real brand marks would be heavier). */
export const SOCIAL_GLYPHS: Record<SocialPlatform, string> = {
  youtube: 'YT',
  tiktok: 'TT',
  facebook: 'FB',
  instagram: 'IG',
  twitter: 'X',
  linkedin: 'IN',
  pinterest: 'PN',
  threads: 'TH',
  telegram: 'TG',
  whatsapp: 'WA',
  linkinbio: 'LB',
  other: '••',
};

export const EMAIL_KIND_LABELS: Record<EmailKind, string> = {
  role: 'Role address',
  personal: 'Personal',
  noreply: 'No-reply',
};

export const CHANNEL_LABELS: Record<string, string> = {
  call: 'Call',
  email: 'Email',
  dm: 'DM',
  visit: 'Visit',
  other: 'Other',
};
