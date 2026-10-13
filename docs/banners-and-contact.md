# Home banners & contact messages

## Home banners (admin-editable)

The slides at the top of the home page come from the `banners` table. `GET /banners` (public) returns the live ones in order; `GET /home` includes them as `banners`. If none are live, the web shows the built-in "Big Sale" slide.

A banner is live when `isActive` is on and now is between `startsAt` and `endsAt` (both optional).

Admins manage them at **/admin/banners** on the website (also linked from the account menu for admins): upload an image (Cloudinary, folder `<CLOUDINARY_FOLDER>/banners`), set the title, label, highlight, description, button text and link, background colour, schedule, show/hide and order.

| Method | Path | Auth |
|---|---|---|
| GET | `/banners` | public |
| GET | `/admin/banners` | admin |
| POST | `/admin/banners` | admin |
| PATCH | `/admin/banners/:id` | admin |
| DELETE | `/admin/banners/:id` | admin |

Images must be a site path (`/images/...`) or a Cloudinary URL from the banners folder. Button links must be a site path (`/products?...`) or an `https://` URL.

### Making someone an admin

```bash
npm run make-admin -- someone@email.com          # give admin rights
npm run make-admin -- someone@email.com --revoke # take them away
```

They need to sign out and back in once to see the admin menu.

## Contact messages

`POST /contact` (public, 5 per 10 minutes per IP) with `name, email, topic, orderRef?, subject, message`. Topics: Shopping, Orders & delivery, Seller inquiry, Account & payments, Something else. Returns `{ reference, message }`.

Each message is saved in `contact_messages` and emailed to `SUPPORT_EMAIL` (reply-to set to the customer), and the customer gets a confirmation email with their reference. Email needs the SMTP settings (`EMAIL_HOST`, …); without them messages are still saved.

Admins can read them with `GET /admin/contact-messages?status=NEW` and mark them handled with `PATCH /admin/contact-messages/:id` `{ status: "RESOLVED" }`.
