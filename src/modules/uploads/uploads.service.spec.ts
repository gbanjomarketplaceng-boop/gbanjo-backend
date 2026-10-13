import { v2 as cloudinary } from "cloudinary";
import { UploadsService } from "./uploads.service";

const settings: Record<string, unknown> = {
  CLOUDINARY_CLOUD_NAME: "demo-cloud",
  CLOUDINARY_API_KEY: "123456",
  CLOUDINARY_API_SECRET: "s3cret",
  CLOUDINARY_FOLDER: "gbanjo",
};
const make = (over: Record<string, unknown> = {}) =>
  new UploadsService({ get: (k: string) => ({ ...settings, ...over })[k] } as never);

describe("UploadsService", () => {
  const svc = make();

  it("signs uploads into the user's own folder", () => {
    const sig = svc.sign("listing_photo", "user1");
    expect(sig.uploadUrl).toBe("https://api.cloudinary.com/v1_1/demo-cloud/image/upload");
    expect(sig.fields).toMatchObject({ folder: "gbanjo/listings/user1", type: "upload", api_key: "123456" });
    const { signature, api_key, ...signed } = sig.fields;
    expect(api_key).toBe("123456");
    expect(signature).toBe(cloudinary.utils.api_sign_request(signed, "s3cret"));
    expect(sig.fields).not.toHaveProperty("api_secret");
  });

  it("keeps ID documents private", () => {
    expect(svc.sign("id_document", "user1").fields).toMatchObject({ folder: "gbanjo/id-documents/user1", type: "authenticated" });
  });

  it("confirms a genuine Cloudinary response and returns a URL", () => {
    const publicId = "gbanjo/listings/user1/abc";
    const signature = cloudinary.utils.api_sign_request({ public_id: publicId, version: 17 }, "s3cret");
    const img = svc.confirm("listing_photo", "user1", { publicId, version: 17, signature });
    expect(img.private).toBe(false);
    expect(img.url).toContain("https://res.cloudinary.com/demo-cloud/image/upload/");
    expect(img.url).toContain(publicId);
  });

  it("returns an expiring link for a private ID image", () => {
    const publicId = "gbanjo/id-documents/user1/front";
    const signature = cloudinary.utils.api_sign_request({ public_id: publicId, version: 3 }, "s3cret");
    const img = svc.confirm("id_document", "user1", { publicId, version: 3, signature });
    expect(img.private).toBe(true);
    expect(img.expiresAt!.getTime()).toBeGreaterThan(Date.now());
  });

  it("rejects forged responses and other users' folders", () => {
    expect(() => svc.confirm("listing_photo", "user1", { publicId: "gbanjo/listings/user1/abc", version: 1, signature: "0".repeat(40) })).toThrow(
      expect.objectContaining({ code: "INVALID_UPLOAD" }),
    );
    const other = "gbanjo/listings/user2/abc";
    const signature = cloudinary.utils.api_sign_request({ public_id: other, version: 1 }, "s3cret");
    expect(() => svc.confirm("listing_photo", "user1", { publicId: other, version: 1, signature })).toThrow(expect.objectContaining({ code: "NOT_YOUR_UPLOAD" }));
  });

  it("vets avatar URLs", () => {
    expect(svc.isOwnedUrl("avatar", "user1", "https://res.cloudinary.com/demo-cloud/image/upload/v17/gbanjo/avatars/user1/me.jpg")).toBe(true);
    expect(svc.isOwnedUrl("avatar", "user1", "https://res.cloudinary.com/demo-cloud/image/upload/v17/gbanjo/avatars/user2/me.jpg")).toBe(false);
    expect(svc.isOwnedUrl("avatar", "user1", "https://evil.example/gbanjo/avatars/user1/me.jpg")).toBe(false);
  });

  it("banners go to one shared folder and their URLs are recognised", () => {
    expect(svc.sign("banner", "admin1").fields.folder).toBe("gbanjo/banners");
    const publicId = "gbanjo/banners/back-to-school";
    const signature = cloudinary.utils.api_sign_request({ public_id: publicId, version: 5 }, "s3cret");
    const { url } = svc.confirm("banner", "admin2", { publicId, version: 5, signature });
    expect(svc.isBannerUrl(url)).toBe(true);
    expect(svc.isBannerUrl("https://res.cloudinary.com/demo-cloud/image/upload/f_auto,q_auto/v5/gbanjo/listings/u1/x")).toBe(false);
  });

  it("reads CLOUDINARY_URL too, and refuses when not configured", () => {
    const fromUrl = make({ CLOUDINARY_CLOUD_NAME: undefined, CLOUDINARY_URL: "cloudinary://k1:sec@cloud-b" });
    expect(fromUrl.sign("avatar", "u").uploadUrl).toContain("/cloud-b/");
    const off = make({ CLOUDINARY_CLOUD_NAME: undefined, CLOUDINARY_API_KEY: undefined, CLOUDINARY_API_SECRET: undefined });
    expect(() => off.sign("avatar", "u")).toThrow(expect.objectContaining({ code: "UPLOADS_NOT_CONFIGURED" }));
  });
});
