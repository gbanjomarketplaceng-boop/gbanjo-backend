# Reviews & ratings

- Any signed-in user can rate a product 1–5 stars with an optional comment (up to 1000 characters). One review per person per product; posting again edits it.
- Sellers can't review their own listings. Admins can remove any review.
- A product's `rating` (average, 1 decimal) and `reviews` (count) are recalculated from real reviews every time one is added, edited or deleted, so cards, the product page and the "Top rated" sort always match. The seed no longer writes made-up ratings.

| Method | Path | Auth |
|---|---|---|
| GET | `/products/:id/reviews?sort=newest\|highest\|lowest&page=&limit=` | public — reviews + `summary { average, count, breakdown }` |
| GET | `/products/:id/reviews/mine` | `{ review, canReview }` |
| PUT | `/products/:id/reviews/mine` | `{ rating, text? }` |
| DELETE | `/products/:id/reviews/mine` | – |
| DELETE | `/admin/reviews/:id` | admin |

Website: the "Rating & Reviews" box on the product page shows the latest reviews, "View All Reviews", and "Write a Review" / "Edit Your Review".

Later: once orders are saved on the server, limit reviews to people who bought the item and show a "Verified purchase" badge.
