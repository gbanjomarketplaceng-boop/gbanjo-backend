export const ID_TYPES = ["nin", "cac", "drivers-license", "voters-card", "passport"] as const;
export const CONDITIONS = ["New", "Like New", "Used", "Fairly Used"] as const;
export const DELIVERY_OPTIONS = ["buyer-pays", "i-deliver", "pickup"] as const;
export const LISTING_STATUSES = ["draft", "active", "sold"] as const;
export type ListingStatus = (typeof LISTING_STATUSES)[number];

export const MAX_PHOTOS = 10;
export const MAX_PRICE = 1_000_000_000;
/** How many listings (any status) one seller can have. */
export const MAX_LISTINGS = 500;
