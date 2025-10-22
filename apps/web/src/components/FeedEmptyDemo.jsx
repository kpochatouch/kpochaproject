// apps/web/src/components/FeedEmptyDemo.jsx
import { Link } from "react-router-dom";
import FeedCard from "./FeedCard";

export default function FeedEmptyDemo({ isPro = false }) {
  const now = Date.now();

  const longText = `Welcome to Kpocha Touch Unisex Salon

The easiest way to connect with trusted barbers, hairstylists, makeup artists, and other beauty professionals across Nigeria — right from your phone.

🪞 How It Works
1️⃣ Create Your Account
• Open Kpocha Touch and sign up with email or Google.
• Verify your address so we can match you with nearby professionals.
• Complete your profile — you can always update it later.

2️⃣ Browse & Pick Your Service
• Tap “Browse” to explore stylists in your area with photos, services, and prices.
• Use the Service Picker to choose what you need — haircut, braids, makeup, etc.

3️⃣ Book Instantly
• Tap “Book Now”. We’ll find the next available pro for your service.
• You’ll get in-app chat once accepted to confirm details.

4️⃣ Pay Securely
• Paystack checkout (card/transfer) or Kpocha Wallet.
• Payments are held for 7 days before release for your protection.

5️⃣ Chat & Track Your Order
• Use chat to share pictures or confirm location.
• Get updates if your stylist is on the way or delayed.

6️⃣ Rate & Review
• Rate your experience after the session. Reviews keep the marketplace trustworthy.

💳 Wallet & Rewards
• Track all payments in your wallet history.
• Withdraw available balance after pending period.
• Loyalty and referrals are coming soon.

🔒 Security & Trust
• All pros are ID-verified.
• Cancellations/refunds are transparent.
• Repeated no-shows lead to suspension.

🧭 Nationwide Coverage
• Active across Nigeria, starting from Edo State. Enter your area to find nearby pros.

💬 Need Help?
• Use the in-app Support Chat for refunds, booking issues, wallet or withdrawal inquiries, or reporting behavior.`;

  const samples = [
    // Text-only post (your guide)
    {
      _id: "demo_text_welcome",
      text: longText,
      media: [],
      tags: ["welcome", "guide"],
      lga: "OREDO",
      createdAt: new Date(now - 60 * 60 * 1000).toISOString(),
      pro: {
        _id: "p_demo_info",
        name: "Kpocha Touch",
        lga: "OREDO",
        photoUrl: "https://res.cloudinary.com/dupex2y3k/image/upload/v1760302703/kpocha-touch-logo_srzbiu.jpg",
      },
      proId: "p_demo_info",
      likesCount: 12,
      commentsCount: 3,
      viewsCount: 250,
    },
    // Video post (background video)
    {
      _id: "demo_video_1",
      text: "Behind the scenes from a home visit today. Fresh taper + beard line-up. Tap Book to lock your slot!",
      media: [
        {
          url: "https://res.cloudinary.com/dupex2y3k/video/upload/v1760305198/kpocha-background-1_s2s9k9.mp4",
          type: "video",
        },
      ],
      tags: ["barber", "home-service", "benin"],
      lga: "OREDO",
      createdAt: new Date(now - 2 * 60 * 60 * 1000).toISOString(),
      pro: {
        _id: "p_demo_barber",
        name: "Kpocha Demo Barber",
        lga: "OREDO",
        photoUrl: "https://i.pravatar.cc/100?img=12",
      },
      proId: "p_demo_barber",
      likesCount: 4,
      commentsCount: 1,
      viewsCount: 75,
    },
    // Image post (background-2)
    {
      _id: "demo_img_1",
      text: "Protective style install + wash day care. New clients get 10% off midweek bookings.",
      media: [
        {
          url: "https://res.cloudinary.com/dupex2y3k/image/upload/v1760305198/kpocha-background-2_hsmavd.jpg",
          type: "image",
        },
      ],
      tags: ["stylist", "protective-style", "edo"],
      lga: "IKPOBA-OKHA",
      createdAt: new Date(now - 26 * 60 * 60 * 1000).toISOString(),
      pro: {
        _id: "p_demo_stylist",
        name: "Kpocha Demo Stylist",
        lga: "IKPOBA-OKHA",
        photoUrl: "https://i.pravatar.cc/100?img=32",
      },
      proId: "p_demo_stylist",
      likesCount: 9,
      commentsCount: 2,
      viewsCount: 180,
    },
  ];

  return (
    <div className="space-y-6">
      <div className="rounded-xl border border-zinc-800 bg-black/30 p-5">
        <h3 className="text-lg font-semibold mb-2">How the Feed works</h3>
        <ul className="list-disc pl-5 text-sm text-zinc-300 space-y-1">
          <li>Professionals post photos, short videos, or text updates.</li>
          <li>Clients can like, comment, and share. Book right from a post.</li>
          <li>Use the filters above to scope by service or LGA.</li>
        </ul>
        {isPro ? (
          <div className="mt-3 text-sm">As a pro, use the <span className="font-medium">“Share an update”</span> box above to post.</div>
        ) : (
          <div className="mt-3 text-sm">
            Are you a professional?{" "}
            <Link to="/become" className="text-gold underline">Apply to join</Link> and start posting.
          </div>
        )}
      </div>

      <div className="grid md:grid-cols-2 gap-4">
        {samples.map((p) => (
          <FeedCard key={p._id} post={p} />
        ))}
      </div>

      <div className="text-xs text-zinc-500">
        These are demo examples using your Cloudinary links and guide text. Real posts will replace them as professionals start posting.
      </div>
    </div>
  );
}
