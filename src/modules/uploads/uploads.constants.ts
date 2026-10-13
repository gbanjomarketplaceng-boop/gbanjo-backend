/** What an image is for decides its folder, privacy and allowed formats. */
export const UPLOAD_PURPOSES = ["listing_photo", "id_document", "avatar", "banner"] as const;
export type UploadPurpose = (typeof UPLOAD_PURPOSES)[number];

/** `shared` folders aren't per user (banners belong to the site); `adminOnly` purposes need role ADMIN. */
export const PURPOSE_RULES: Record<UploadPurpose, { folder: string; private: boolean; shared?: boolean; adminOnly?: boolean }> = {
  listing_photo: { folder: "listings", private: false },
  // ID documents are "authenticated" assets: no public URL, only short-lived signed links.
  id_document: { folder: "id-documents", private: true },
  avatar: { folder: "avatars", private: false },
  banner: { folder: "banners", private: false, shared: true, adminOnly: true },
};

export const ALLOWED_FORMATS = "jpg,jpeg,png,webp,heic";

/** A signature is only good for this long (Cloudinary rejects older timestamps after 1 hour anyway). */
export const SIGNATURE_TTL_SECONDS = 15 * 60;

/** Lifetime of the signed link returned for a private (ID) image. */
export const PRIVATE_URL_TTL_SECONDS = 60 * 60;
