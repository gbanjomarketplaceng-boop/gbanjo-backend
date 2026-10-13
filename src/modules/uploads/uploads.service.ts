import { HttpStatus, Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { v2 as cloudinary } from "cloudinary";
import { AppException } from "../../common/exceptions/app.exception";
import type { Env } from "../../config/env.validation";
import type { UploadedImageDto, UploadSignatureDto } from "./dto/uploads.dto";
import { ALLOWED_FORMATS, PRIVATE_URL_TTL_SECONDS, PURPOSE_RULES, type UploadPurpose } from "./uploads.constants";

interface Credentials {
  cloudName: string;
  apiKey: string;
  apiSecret: string;
}

/** cloudinary://<key>:<secret>@<cloud> → credentials */
function parseUrl(url?: string): Credentials | undefined {
  const m = url?.match(/^cloudinary:\/\/([^:]+):([^@]+)@(.+)$/);
  return m ? { apiKey: m[1], apiSecret: m[2], cloudName: m[3] } : undefined;
}

/**
 * Signed direct uploads: the browser/app sends the file straight to Cloudinary using a signature from
 * this API (so the API secret never leaves the server and files don't pass through it), then sends back
 * Cloudinary's response, which is checked against Cloudinary's own signature before it's trusted.
 * Each user can only write to — and confirm or delete from — their own folder.
 */
@Injectable()
export class UploadsService {
  private readonly logger = new Logger(UploadsService.name);
  private readonly creds?: Credentials;
  private readonly root: string;

  constructor(config: ConfigService<Env, true>) {
    const get = <K extends keyof Env>(k: K) => config.get(k, { infer: true });
    const name = get("CLOUDINARY_CLOUD_NAME");
    const key = get("CLOUDINARY_API_KEY");
    const secret = get("CLOUDINARY_API_SECRET");
    this.creds = name && key && secret ? { cloudName: name, apiKey: key, apiSecret: secret } : parseUrl(get("CLOUDINARY_URL"));
    this.root = get("CLOUDINARY_FOLDER").replace(/^\/+|\/+$/g, "");
    if (this.creds) cloudinary.config({ cloud_name: this.creds.cloudName, api_key: this.creds.apiKey, api_secret: this.creds.apiSecret, secure: true });
    else this.logger.warn("CLOUDINARY_* settings missing: image uploads are disabled (503 UPLOADS_NOT_CONFIGURED).");
  }

  private get config(): Credentials {
    if (!this.creds)
      throw new AppException(HttpStatus.SERVICE_UNAVAILABLE, "UPLOADS_NOT_CONFIGURED", "Photo uploads aren't available right now. Please try again later.");
    return this.creds;
  }

  /** e.g. gbanjo/listings/<userId>, or gbanjo/banners for site-wide images */
  private folderFor(purpose: UploadPurpose, userId: string) {
    const rule = PURPOSE_RULES[purpose];
    return rule.shared ? `${this.root}/${rule.folder}` : `${this.root}/${rule.folder}/${userId}`;
  }

  sign(purpose: UploadPurpose, userId: string): UploadSignatureDto {
    const { cloudName, apiKey, apiSecret } = this.config;
    const params: Record<string, string> = {
      timestamp: String(Math.floor(Date.now() / 1000)),
      folder: this.folderFor(purpose, userId),
      allowed_formats: ALLOWED_FORMATS,
      type: PURPOSE_RULES[purpose].private ? "authenticated" : "upload",
    };
    const signature = cloudinary.utils.api_sign_request(params, apiSecret);
    return {
      uploadUrl: `https://api.cloudinary.com/v1_1/${cloudName}/image/upload`,
      fields: { ...params, api_key: apiKey, signature },
      maxBytes: 10 * 1024 * 1024,
    };
  }

  /** Checks the upload response really came from Cloudinary for this user's folder and returns a usable URL. */
  confirm(purpose: UploadPurpose, userId: string, upload: { publicId: string; version: number; signature: string }): UploadedImageDto {
    const { apiSecret } = this.config;
    this.assertOwned(purpose, userId, upload.publicId);
    const expected = cloudinary.utils.api_sign_request({ public_id: upload.publicId, version: upload.version }, apiSecret);
    if (expected !== upload.signature)
      throw new AppException(HttpStatus.BAD_REQUEST, "INVALID_UPLOAD", "We couldn't confirm that photo. Please upload it again.");
    return this.view(purpose, upload.publicId, upload.version);
  }

  async remove(purpose: UploadPurpose, userId: string, publicId: string): Promise<void> {
    void this.config; // throws UPLOADS_NOT_CONFIGURED when Cloudinary isn't set up
    this.assertOwned(purpose, userId, publicId);
    const res = await cloudinary.uploader.destroy(publicId, { type: PURPOSE_RULES[purpose].private ? "authenticated" : "upload", invalidate: true });
    if (res.result !== "ok" && res.result !== "not found") this.logger.warn(`Cloudinary destroy ${publicId}: ${res.result}`);
  }

  /** Cloudinary is set up (photo uploads work). */
  get configured(): boolean {
    return !!this.creds;
  }

  /** True when `publicId` is in this user's folder for `purpose` (e.g. their private ID documents). */
  ownsPublicId(purpose: UploadPurpose, userId: string, publicId: string): boolean {
    return publicId.startsWith(`${this.folderFor(purpose, userId)}/`) && !publicId.includes("..");
  }

  /** Short-lived signed link to a private image (admins reviewing an ID). */
  privateUrl(publicId: string): { url: string; expiresAt: Date } | undefined {
    if (!this.creds) return undefined;
    const expiresAt = new Date(Date.now() + PRIVATE_URL_TTL_SECONDS * 1000);
    return { url: cloudinary.utils.private_download_url(publicId, "jpg", { type: "authenticated", expires_at: Math.floor(expiresAt.getTime() / 1000) }), expiresAt };
  }

  /** Best-effort delete of a public image by URL (e.g. photos of a deleted listing). Never throws. */
  async removeByUrl(purpose: UploadPurpose, userId: string, url: string): Promise<void> {
    if (!this.creds || !this.isOwnedUrl(purpose, userId, url)) return;
    const prefix = `https://res.cloudinary.com/${this.creds.cloudName}/image/upload/`;
    const folder = this.folderFor(purpose, userId);
    const path = url.slice(prefix.length).split("?")[0];
    const at = path.indexOf(`${folder}/`);
    if (at < 0) return;
    const publicId = path.slice(at).replace(/\.[a-z0-9]+$/i, "");
    await cloudinary.uploader.destroy(publicId, { invalidate: true }).catch((e: unknown) => this.logger.warn(`Cloudinary destroy ${publicId}: ${String(e)}`));
  }

  /** A home-page banner image uploaded to our Cloudinary banners folder. */
  isBannerUrl(url: string): boolean {
    return this.isOwnedUrl("banner", "", url);
  }

  /** True when `url` is one of this user's images for `purpose` in our Cloudinary account (used to vet avatar URLs). */
  isOwnedUrl(purpose: UploadPurpose, userId: string, url: string): boolean {
    if (!this.creds) return false;
    const prefix = `https://res.cloudinary.com/${this.creds.cloudName}/image/upload/`;
    if (!url.startsWith(prefix)) return false;
    // Skip transformations (e.g. f_auto,q_auto) and the version segment.
    const path = url
      .slice(prefix.length)
      .split("?")[0]
      .split("/")
      .filter((seg, i, all) => !(i < all.length - 1 && (seg.includes(",") || /^[a-z]{1,3}_/.test(seg) || /^v\d+$/.test(seg))))
      .join("/");
    return path.startsWith(`${this.folderFor(purpose, userId)}/`);
  }

  private assertOwned(purpose: UploadPurpose, userId: string, publicId: string) {
    if (!publicId.startsWith(`${this.folderFor(purpose, userId)}/`))
      throw new AppException(HttpStatus.FORBIDDEN, "NOT_YOUR_UPLOAD", "That photo doesn't belong to your account.");
  }

  private view(purpose: UploadPurpose, publicId: string, version?: number): UploadedImageDto {
    if (!PURPOSE_RULES[purpose].private)
      return { publicId, private: false, url: cloudinary.url(publicId, { secure: true, version, fetch_format: "auto", quality: "auto" }) };
    const expiresAt = new Date(Date.now() + PRIVATE_URL_TTL_SECONDS * 1000);
    const url = cloudinary.utils.private_download_url(publicId, "jpg", { type: "authenticated", expires_at: Math.floor(expiresAt.getTime() / 1000) });
    return { publicId, private: true, url, expiresAt };
  }
}
