import { existsSync } from "node:fs";
import path from "node:path";
import { v2 as cloudinary } from "cloudinary";

/**
 * Seed pictures live in the website's public/images folder ("/images/x.png"). Those paths only work on the
 * website, so the app (and any other site) can't show them. When Cloudinary is configured, each picture is
 * uploaded once to <CLOUDINARY_FOLDER>/seed/<name> and the seed saves the Cloudinary URL instead.
 * Re-running is cheap: an image already on Cloudinary isn't uploaded again.
 *
 * Folder with the pictures: SEED_IMAGES_DIR, or ../frontend/public/images next to this backend folder.
 */
type Creds = { cloudName: string; apiKey: string; apiSecret: string };

function creds(): Creds | undefined {
  const { CLOUDINARY_CLOUD_NAME: name, CLOUDINARY_API_KEY: key, CLOUDINARY_API_SECRET: secret, CLOUDINARY_URL: url } = process.env;
  if (name && key && secret) return { cloudName: name, apiKey: key, apiSecret: secret };
  const m = url?.match(/^cloudinary:\/\/([^:]+):([^@]+)@(.+)$/);
  return m ? { apiKey: m[1], apiSecret: m[2], cloudName: m[3] } : undefined;
}

/** "https://res.cloudinary.com/x/image/upload/v1/a.png" → same with f_auto,q_auto (smaller files, WebP/AVIF where supported). */
const optimised = (url: string) => url.replace("/image/upload/", "/image/upload/f_auto,q_auto/");

export function imageResolver() {
  const c = creds();
  const dir = process.env.SEED_IMAGES_DIR ?? path.resolve(__dirname, "../../frontend/public/images");
  const root = (process.env.CLOUDINARY_FOLDER ?? "gbanjo").replace(/^\/+|\/+$/g, "");
  const done = new Map<string, Promise<string>>();
  let warned = false;
  let uploaded = 0;

  if (c) cloudinary.config({ cloud_name: c.cloudName, api_key: c.apiKey, api_secret: c.apiSecret, secure: true });

  /** Returns a URL every app can load: the Cloudinary copy when possible, otherwise the original path. */
  const resolve = async (ref: string): Promise<string> => {
    if (!ref.startsWith("/images/")) return ref; // already a full URL
    const hit = done.get(ref);
    if (hit) return hit; // same picture used twice: one upload
    if (!c) {
      if (!warned) console.warn("Cloudinary isn't configured (CLOUDINARY_*): seed pictures keep their /images/... paths, which only the website can show.");
      warned = true;
      return ref;
    }
    const file = path.join(dir, path.basename(ref));
    if (!existsSync(file)) {
      console.warn(`Seed picture not found: ${file} (keeping ${ref}). Set SEED_IMAGES_DIR to the website's public/images folder.`);
      return ref;
    }
    const publicId = `${root}/seed/${path.basename(ref).replace(/\.[^.]+$/, "")}`;
    // overwrite: false → if it's already there, Cloudinary returns the existing image instead of uploading again.
    const job = cloudinary.uploader.upload(file, { public_id: publicId, overwrite: false, resource_type: "image" }).then((r) => {
      uploaded++;
      return optimised(r.secure_url);
    });
    done.set(ref, job);
    return job;
  };

  return { resolve, enabled: !!c, count: () => uploaded };
}
