// apps/web/src/data/services.js
// Flat, de-duplicated master list for the picker.
// Add/adjust items here; UI will auto-reflect.

export const SERVICES = [
  // Core Hair (Women/Unisex)
  "Wash & Blow-dry",
  "Silk press",
  "Trim / Dusting",
  "Cut & Style (bob, layers, pixie, etc.)",
  "Relaxer retouch / full application",
  "Texturizer / Jerry curl",
  "Deep conditioning / Steam treatment",
  "Protein treatment / Olaplex / Keratin",
  "Hot oil / Scalp therapy / Dandruff treatment",
  "Roller set / Flexi-rod set",
  "Up-do / Bridal up-do",
  "Frontal & Closure Installation (13×4, 4×4, 5×5)",
  "Weave/Weft Install (sew-in / bonding)",
  "Wig Making (machine/hand)",
  "Wig Revamp (wash, restyle, repair)",

  // Braids (grouped under one)
  "Braids: Ghana weaving",
  "Braids: Knotless (S/M/L)",
  "Braids: Box braids",
  "Braids: Cornrows (straight/zig-zag)",
  "Braids: Stitch braids",
  "Braids: Fulani",
  "Braids: Feed-in",
  "Braids: Butterfly locs",
  "Braids: Soft locs",
  "Braids: Boho braids",
  "Braids: Crochet install",

  // Locs
  "Locs: Starter (coils/twist/interlock)",
  "Locs: Retwist",
  "Locs: Interlocking",
  "Locs: Instant locs",
  "Locs: Repair",
  "Locs: Styling",

  // Twists & Natural Styles
  "Twists: Two-strand",
  "Twists: Flat twists",
  "Bantu knots",
  "Twist-out",
  "Wash-and-go",
  "Gel packing / ponytail",

  // Children (0–12)
  "Children: Cut",
  "Children: Cornrows",
  "Children: Basic braids",
  "Children: Treatment & style",

  // Hair Coloring
  "Hair Color: Root touch-up",
  "Hair Color: Full (permanent/semi)",
  "Highlights / Lowlights",
  "Balayage / Ombre",
  "Color correction",

  // Barbering (Men/Unisex)
  "Low cut / All-round",
  "Fade: Taper/Low/Mid/High",
  "Afro shape / Sponge curls",
  "Line-up / Shape-up",
  "Beard trim / Sculpt / Hot towel shave",
  "Razor shave / Head shave",
  "Hair enhancement / Dye (beard/hair)",
  "Designs (basic/advanced)",
  "Kids cut (0–12)",

  // Nails
  "Classic Manicure / Pedicure",
  "Spa Manicure / Pedicure (scrub & massage)",
  "Gel Polish (hands/feet)",
  "Acrylic Extensions (tips/forms)",
  "Builder Gel / PolyGel / Hard Gel",
  "Refill / Infill",
  "Overlay (gel/acrylic)",
  "French / Ombre",
  "Nail Art (basic/advanced)",
  "Removal / Repair",
  "Paraffin wax treatment",
  "Foot callus treatment",

  // Makeup & Head-Tie
  "Makeup: Soft glam / Day",
  "Makeup: Full glam / Night",
  "Makeup: Bridal trial / Bridal day",
  "Traditional engagement look",
  "Photoshoot / Video shoot makeup",
  "Gele tying (auto/turbo/classic)",

  // Lashes & Brows
  "Lash Extensions: Classic",
  "Lash Extensions: Hybrid",
  "Lash Extensions: Volume",
  "Lash Extensions: Mega volume",
  "Lash Refill (2–3 weeks)",
  "Lash Removal",
  "Brow Shaping (wax/thread)",
  "Brow Tint / Lamination",
  "Microblading / Microshading / Combo brows",

  // Skincare & Spa
  "Express facial / Deep-cleanse facial",
  "Acne treatment facial / Anti-aging facial",
  "Dermaplaning",
  "Microdermabrasion / Peel",
  "Back facial (Bacial)",
  "Massage: Swedish",
  "Massage: Deep-tissue",
  "Massage: Hot-stone",
  "Massage: Aromatherapy",
  "Massage: Prenatal",
  "Body scrub / Polish",
  "Body wrap",

  // Hair Removal
  "Waxing: Eyebrow",
  "Waxing: Upper lip",
  "Waxing: Underarm",
  "Waxing: Half arm",
  "Waxing: Full arm",
  "Waxing: Half leg",
  "Waxing: Full leg",
  "Waxing: Bikini / Brazilian",
  "Waxing: Chest / Back",
  "Threading: Brow / Face / Full face",
  "Sugaring",

  // Bridal & Events (Bundles)
  "Bridal Hair + Makeup (trial + day)",
  "Traditional Engagement (makeup + gele + hair)",
  "Bridal Party (per person)",
  "Groom Package (haircut + beard + facial)",
  "Photoshoot Package (hair + makeup)",
  "Home Service Bridal (with travel)",

  // Tattoos & Piercing (optional)
  "Piercing: Ear lobe",
  "Piercing: Cartilage",
  "Piercing: Nose",
  "Temporary body art / Henna",
  "Tattoo (small/medium/large)",

  // Add-Ons
  "Add-on: Shampoo & condition",
  "Add-on: Blow-dry / Silk press finish",
  "Add-on: Trim / Ends dusting",
  "Add-on: Hair steaming",
  "Add-on: Wig styling / Curling",
  "Add-on: Frontal customization / Bleach knots / Pluck",
  "Add-on: Extra bundles install (per bundle)",
  "Add-on: Beads / Accessories installation",
  "Add-on: Beard dye / Enhancement",
  "Add-on: Nail art (per nail / full set)",
  "Add-on: Cuticle treatment / Paraffin dip",
  "Add-on: Lash bath / Sealant",
  "Add-on: Gele only",
  "Add-on: 10–15 min scalp/foot/hand massage",
  "Add-on: After-hours surcharge",
  "Add-on: Home service travel fee",
  "Add-on: Outside-LGA travel fee",
  "Add-on: Emergency/same-day booking fee",
  "Add-on: Assistant/extra time fee",

  // Kids & Teens (Bundle)
  "Kids: Cornrows / Braids (basic)",
  "Kids: Twists / Loc maintenance",
  "Kids: Haircut / Line-up",
  "Kids: Party styling (beads/ribbons)",

  // Maintenance / Recurring
  "Maintenance: Wig wash & restyle",
  "Maintenance: Weave tightening",
  "Maintenance: Braids refresh (front line)",
  "Maintenance: Loc retwist / Interlock",
  "Maintenance: Lash refill",
  "Maintenance: Gel polish change",
  "Maintenance: Nail refill",
  "Maintenance: Color root touch-up",
];

// Utility to turn any name into a stable id.
export const serviceId = (name) =>
  String(name).toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
