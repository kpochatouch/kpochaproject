# Kpocha Touch FAQ (Enhanced)

**Company:** KPOCHA TOUCH NIG LTD — RC No. 7455105

**Address:** 23, Adesuwa Road, GRA, Benin City, Edo State

**Contact:** kpochaout@gmail.com

## General

Q: What is Kpocha Touch?
A: Kpocha Touch is a marketplace for verified professionals offering home and local services. It connects clients with professionals, handles payments, and enforces safety and quality controls.

Q: Is Kpocha Touch available across Nigeria?
A: Kpocha Touch operates in supported states and LGAs. Services may vary by location.

---

## Payments & Wallet

Q: How do I pay for a booking?
A: You can pay using Wallet credits or a card via Paystack. Payment is taken at booking time and held in escrow until the job is completed.

Q: What happens to the money after I pay for a booking?
A: Money is held in escrow by the platform and released to the professional after the job is completed and any holds (e.g., pending clearing period) expire.

Q: Can I get a refund?
A: Yes. Refunds are processed in case of cancellations or no-shows. If the professional doesn't show up, you will receive a full refund.

---

## Professional earnings & withdrawals

Q: How do professionals get paid?
A: When a client marks a booking completed, the booking amount moves to the professional's holdings wallet (pending balance). Holdings funds remain for a 3-day safety hold for fraud and dispute protection; after 3 days funds move to the professional's available balance and become withdrawable. The platform also runs a scheduled cashout at 7 days after job completion: professionals who wait until the 7-day cashout receive 75% of the booking amount while the platform retains 25%.

If a professional cannot wait for the scheduled 7-day cashout, they can request an early move to available balance after the 3-day hold; early release is subject to a 3% maintenance fee on the moved amount (example: ₦10,000 early release costs ₦300, net ₦9,700). Withdrawals to bank accounts require a verified bank account and confirmation with the 4-digit withdrawal PIN.

Q: What is the 3-day hold?
A: It's a fraud and dispute protection period. After job completion, funds are held as `pending` for 3 calendar days. After this period, pending funds automatically release to `available`.

Q: What is instant cashout?
A: Instant cashout lets professionals receive funds immediately (without waiting for auto-release). Instant cashout is subject to a platform fee (typically 3%). The fee is deducted at withdrawal time and the net amount is transferred to the professional's verified bank account.

Q: How is the 3% instant cashout fee calculated? Give an example.
A: Fee = 3% of the withdrawal amount. Example: If you instant cash out ₦10,000, fee = ₦300, net transfer = ₦9,700.

Q: How do I withdraw money to my bank account?
A: Set up and verify your bank account in the Profile → Payouts section. To withdraw, create a withdrawal request from `available` funds. For instant cashouts, use the instant cashout option; for scheduled withdrawals, use the standard bank transfer.

Q: Do I need a PIN to withdraw funds?
A: Yes. Professionals must set a 4-digit withdrawal PIN. The PIN is hashed (bcrypt) server-side and verified for security during withdrawals.

Q: How long does a bank transfer take?
A: Standard bank transfers usually take 1-3 business days. Instant cashouts are processed faster but attract the instant cashout fee.

---

## Reviews & Ratings

Q: How does the review system work?
A: After a booking is completed, clients can leave a rating (1-5) and a written review for the professional. Professionals can also leave feedback for clients.

Q: Do reviews affect professional visibility?
A: Yes. Average rating and number of reviews influence search ranking and booking visibility.

Q: Can I edit my review?
A: Reviews can be edited within a short window after posting; otherwise they remain as posted. Contact support if you need a change due to legitimate reasons.

---

## Verification & Safety

Q: What is face liveness verification?
A: It's an anti-fraud check requiring a short selfie video to confirm identity. It is used during professional onboarding and may be required for certain high-value transactions.

Q: Is my data safe?
A: Yes. Bank details are secured and sensitive data is encrypted and only used for payment processing.

---

## Cancellation & Disputes

Q: What is the cancellation policy?
A: Specific rules:

- If a client cancels _before_ the professional accepts the booking: full refund to the client's Wallet.
- If a client cancels _after_ the professional accepts the booking: a 3% cancellation fee applies to the booking amount (split 1.5% to the platform and 1.5% to the booked professional); the remainder is refunded to the client's Wallet.
- Professional no-show or a failed booking: full refund to the client's Wallet.
- If a professional cancels after accepting, the client receives a full refund and the professional must provide a cancellation reason.

Exact fees and additional service-specific policies may vary by service type and location; check the booking details for specifics.

Q: How do I dispute a booking or payment?
A: Open your booking → Report Issue → Submit details/photos. Support will investigate and may issue refunds if warranted.

---

## Account & Support

Q: How do I become a professional?
A: Tap **Become a Professional** in the app, complete the multi-step onboarding (profile, service list, ID upload, face liveness verification), and submit for review.

Q: What if I forget my withdrawal PIN?
A: Use the `Forgot PIN` option to request a reset. Verification steps are required to reset your withdrawal PIN.

Q: How do I contact support?
A: In-app Help → Contact Support, or email kpochaout@gmail.com.

---

## Technical

Q: What payment provider do you use?
A: We use Paystack for card processing and bank transfers.

Q: How do I update my bank details?
A: Profile → Payouts → Add/Update Bank Account. You may be asked to re-verify using Paystack's bank resolution and identity checks.

---

If you have a specific question not covered here, use the in-app Help & Support to get immediate assistance.
