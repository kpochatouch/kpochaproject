// apps/web/src/components/ServicePicker.jsx
import { useMemo } from "react";

/** Normalize for robust de-dup (case/space/punct insensitive) */
function normName(s = "") {
  return String(s).toLowerCase().replace(/\s+/g, " ").replace(/[^\w ]+/g, "").trim();
}

/**
 * Default unisex salon/beauty catalog (names only).
 * Keep IDs stable (snake-case). Prices are NOT included here.
 */
export function getDefaultCatalog() {
  const list = [
    // ===== Core Hair (Women/Unisex)
    { id: "wash_blow_dry", name: "Wash & Blow-dry" },
    { id: "silk_press", name: "Silk press" },
    { id: "trim_dusting", name: "Trim / Dusting" },
    { id: "cut_style", name: "Cut & Style (bob, layers, pixie, etc.)" },
    { id: "relaxer_retouch_full", name: "Relaxer retouch / full application" },
    { id: "texturizer_jerry_curl", name: "Texturizer / Jerry curl" },
    { id: "deep_conditioning_steam", name: "Deep conditioning / Steam treatment" },
    { id: "protein_olaplex_keratin", name: "Protein treatment / Olaplex / Keratin" },
    { id: "hot_oil_scalp_dandruff", name: "Hot oil / Scalp therapy / Dandruff treatment" },
    { id: "roller_flexi_rod_set", name: "Roller set / Flexi-rod set" },
    { id: "updo_bridal_updo", name: "Up-do / Bridal up-do" },
    { id: "frontal_closure_install", name: "Frontal & Closure Installation (13x4, 4x4, 5x5)" },
    { id: "weave_weft_install", name: "Weave/Weft Install (sew-in / bonding)" },
    { id: "wig_making_machine_hand", name: "Wig Making (machine/hand)" },
    { id: "wig_revamp", name: "Wig Revamp (wash, restyle, repair)" },

    // ===== Braids
    { id: "braids_ghana_weaving", name: "Braids: Ghana weaving" },
    { id: "braids_knotless_sml", name: "Braids: Knotless braids (S/M/L)" },
    { id: "braids_box", name: "Braids: Box braids" },
    { id: "cornrows_straight_zigzag", name: "Cornrows (straight/zig-zag)" },
    { id: "stitch_braids", name: "Stitch braids" },
    { id: "fulani_braids", name: "Fulani braids" },
    { id: "feed_in_braids", name: "Feed-in braids" },
    { id: "butterfly_locs", name: "Butterfly locs" },
    { id: "soft_locs", name: "Soft locs" },
    { id: "boho_braids", name: "Boho braids" },
    { id: "crochet_install", name: "Crochet install" },

    // ===== Locs
    { id: "starter_locs", name: "Starter locs (coils/twist/interlock)" },
    { id: "loc_retwist", name: "Retwist (locs)" },
    { id: "loc_interlocking", name: "Interlocking (locs)" },
    { id: "instant_locs", name: "Instant locs" },
    { id: "loc_repair", name: "Loc repair" },
    { id: "loc_styling", name: "Loc styling" },

    // ===== Twists & Natural Styles
    { id: "two_strand_twists", name: "Two-strand twists" },
    { id: "flat_twists", name: "Flat twists" },
    { id: "bantu_knots", name: "Bantu knots" },
    { id: "twist_out", name: "Twist-out" },
    { id: "wash_and_go", name: "Wash-and-go" },
    { id: "gel_packing_ponytail", name: "Gel packing/ponytail" },

    // ===== Children (0–12)
    { id: "child_cut", name: "Children’s Hair (0–12): Cut" },
    { id: "child_cornrows", name: "Children’s Hair (0–12): Cornrows" },
    { id: "child_basic_braids", name: "Children’s Hair (0–12): Basic braids" },
    { id: "child_treatment_style", name: "Children’s Hair (0–12): Treatment & style" },

    // ===== Hair Coloring
    { id: "root_touch_up", name: "Color root touch-up" },
    { id: "full_color", name: "Full color (permanent/semi)" },
    { id: "highlights_lowlights", name: "Highlights/lowlights" },
    { id: "balayage_ombre", name: "Balayage/ombre" },
    { id: "color_correction", name: "Color correction" },

    // ===== Barbering (Men/Unisex)
    { id: "low_cut_all_round", name: "Low cut / All-round" },
    { id: "fade_taper_low_mid_high", name: "Fade: Taper/Low/Mid/High" },
    { id: "afro_shape_sponge_curls", name: "Afro shape / Sponge curls" },
    { id: "line_up_shape_up", name: "Line-up / Shape-up" },
    { id: "beard_trim_hot_towel", name: "Beard trim / Sculpt / Hot towel shave" },
    { id: "razor_shave_head_shave", name: "Razor shave / Head shave" },
    { id: "hair_enhancement_dye", name: "Hair enhancement / Dye (beard/hair)" },
    { id: "designs_basic_advanced", name: "Designs (basic/advanced)" },
    { id: "kids_cut_0_12", name: "Kids cut (0–12)" },

    // ===== Nails
    { id: "classic_manicure", name: "Classic Manicure" },
    { id: "classic_pedicure", name: "Classic Pedicure" },
    { id: "spa_manicure_pedicure", name: "Spa Manicure / Pedicure (scrub & massage)" },
    { id: "gel_polish_hands", name: "Gel Polish (hands)" },
    { id: "gel_polish_feet", name: "Gel Polish (feet)" },
    { id: "acrylic_extensions", name: "Acrylic Extensions (tips/forms)" },
    { id: "builder_poly_hard_gel", name: "Builder Gel / PolyGel / Hard Gel" },
    { id: "refill_infill", name: "Refill / Infill" },
    { id: "overlay_gel_acrylic", name: "Overlay (gel/acrylic)" },
    { id: "french_ombre", name: "French / Ombre" },
    { id: "nail_art_basic", name: "Nail Art (basic)" },
    { id: "nail_art_advanced", name: "Nail Art (advanced)" },
    { id: "nail_removal_repair", name: "Removal / Repair" },
    { id: "paraffin_wax_treatment", name: "Paraffin wax treatment" },
    { id: "foot_callus_treatment", name: "Foot callus treatment" },

    // ===== Makeup & Head-Tie
    { id: "soft_glam_day_makeup", name: "Soft glam / Day makeup" },
    { id: "full_glam_night_makeup", name: "Full glam / Night glam" },
    { id: "bridal_trial", name: "Bridal trial" },
    { id: "bridal_day", name: "Bridal day" },
    { id: "traditional_engagement", name: "Traditional engagement look" },
    { id: "photoshoot_video_makeup", name: "Photoshoot / Video shoot makeup" },
    { id: "gele_tying_auto_turbo_classic", name: "Gele tying (auto/turbo/classic)" },

    // ===== Lashes & Brows
    { id: "lash_ext_classic", name: "Lash Extensions: Classic" },
    { id: "lash_ext_hybrid", name: "Lash Extensions: Hybrid" },
    { id: "lash_ext_volume", name: "Lash Extensions: Volume" },
    { id: "lash_ext_mega_volume", name: "Lash Extensions: Mega volume" },
    { id: "lash_refill_2_3_weeks", name: "Lash Refill (2–3 weeks)" },
    { id: "lash_removal", name: "Lash Removal" },
    { id: "brow_shaping_wax_thread", name: "Brow Shaping (wax/thread)" },
    { id: "brow_tint_lamination", name: "Brow Tint / Lamination" },
    { id: "microblading_microshading_combo", name: "Microblading / Microshading / Combo brows" },

    // ===== Skincare & Spa
    { id: "express_deep_cleanse_facial", name: "Express facial / Deep-cleanse facial" },
    { id: "acne_anti_aging_facial", name: "Acne treatment facial / Anti-aging facial" },
    { id: "dermaplaning", name: "Dermaplaning" },
    { id: "microdermabrasion_peel", name: "Microdermabrasion / Peel" },
    { id: "back_facial_bacial", name: "Back facial (Bacial)" },
    { id: "massage_swedish", name: "Massage: Swedish" },
    { id: "massage_deep_tissue", name: "Massage: Deep-tissue" },
    { id: "massage_hot_stone", name: "Massage: Hot-stone" },
    { id: "massage_aromatherapy", name: "Massage: Aromatherapy" },
    { id: "massage_prenatal", name: "Massage: Prenatal" },
    { id: "body_scrub_polish", name: "Body scrub / Polish" },
    { id: "body_wrap", name: "Body wrap" },

    // ===== Hair Removal
    { id: "waxing_eyebrow", name: "Waxing: Eyebrow" },
    { id: "waxing_upper_lip", name: "Waxing: Upper lip" },
    { id: "waxing_underarm", name: "Waxing: Underarm" },
    { id: "waxing_half_arm", name: "Waxing: Half arm" },
    { id: "waxing_full_arm", name: "Waxing: Full arm" },
    { id: "waxing_half_leg", name: "Waxing: Half leg" },
    { id: "waxing_full_leg", name: "Waxing: Full leg" },
    { id: "waxing_bikini", name: "Waxing: Bikini" },
    { id: "waxing_brazilian", name: "Waxing: Brazilian" },
    { id: "waxing_chest", name: "Waxing: Chest" },
    { id: "waxing_back", name: "Waxing: Back" },
    { id: "threading_brow", name: "Threading: Brow" },
    { id: "threading_face", name: "Threading: Face" },
    { id: "threading_full_face", name: "Threading: Full face" },
    { id: "sugaring", name: "Sugaring" },

    // ===== Bridal & Events (Bundles)
    { id: "bridal_hair_makeup_trial_day", name: "Bridal Hair + Makeup (trial + day)" },
    { id: "traditional_engagement_bundle", name: "Traditional Engagement (makeup + gele + hair)" },
    { id: "bridal_party_per_person", name: "Bridal Party (per person)" },
    { id: "groom_package", name: "Groom Package (haircut + beard + facial)" },
    { id: "photoshoot_package_hair_makeup", name: "Photoshoot Package (hair + makeup)" },
    { id: "home_service_bridal_with_travel", name: "Home Service Bridal (with travel)" },

    // ===== Tattoos & Piercing (Optional)
    { id: "piercing_ear_lobe", name: "Piercing: Ear lobe" },
    { id: "piercing_cartilage", name: "Piercing: Cartilage" },
    { id: "piercing_nose", name: "Piercing: Nose" },
    { id: "temporary_body_art_henna", name: "Temporary body art / Henna" },
    { id: "tattoo_small", name: "Tattoo (small)" },
    { id: "tattoo_medium", name: "Tattoo (medium)" },
    { id: "tattoo_large", name: "Tattoo (large)" },

    // ===== Add-Ons (attach to any main service)
    { id: "shampoo_condition", name: "Shampoo & condition" },
    { id: "blowdry_silk_finish", name: "Blow-dry / Silk press finish" },
    { id: "trim_ends_dusting", name: "Trim / Ends dusting" },
    { id: "hair_steaming", name: "Hair steaming" },
    { id: "wig_styling_curling", name: "Wig styling / Curling" },
    { id: "frontal_custom_bleach_pluck", name: "Frontal customization / Bleach knots / Pluck" },
    { id: "extra_bundles_per_bundle", name: "Extra bundles install (per bundle)" },
    { id: "beads_accessories_install", name: "Beads / Accessories installation" },
    { id: "beard_dye_enhancement", name: "Beard dye / Enhancement" },
    { id: "nail_art_per_nail_full_set", name: "Nail art (per nail / full set)" },
    { id: "cuticle_treatment_paraffin", name: "Cuticle treatment / Paraffin dip" },
    { id: "lash_bath_sealant", name: "Lash bath / Sealant" },
    { id: "gele_only_addon", name: "Gele only (as add-on)" },
    { id: "massage_10_15_min", name: "10–15 min scalp/foot/hand massage" },
    { id: "after_hours_surcharge", name: "After-hours surcharge" },
    { id: "home_service_travel_fee", name: "Home service travel fee" },
    { id: "outside_lga_travel_fee", name: "Outside-LGA travel fee" },
    { id: "emergency_same_day_fee", name: "Emergency/same-day booking fee" },
    { id: "assistant_extra_time_fee", name: "Assistant/extra time fee (very long/thick hair)" },

    // ===== Kids & Teens (Bundle)
    { id: "kids_cornrows_braids_basic", name: "Kids cornrows / braids (basic)" },
    { id: "kids_twists_loc_maintenance", name: "Kids twists / loc maintenance" },
    { id: "kids_haircut_lineup", name: "Kids haircut / line-up" },
    { id: "party_styling_beads_ribbons", name: "Party styling (beads/ribbons)" },

    // ===== Maintenance / Recurring
    { id: "wig_wash_restyle", name: "Wig wash & restyle" },
    { id: "weave_tightening", name: "Weave tightening" },
    { id: "braids_refresh_frontline", name: "Braids refresh (front line)" },
    { id: "loc_retwist_interlock", name: "Loc retwist / Interlock" },
    { id: "lash_refill_maintenance", name: "Lash refill (maintenance)" },
    { id: "gel_polish_change", name: "Gel polish change" },
    { id: "nail_refill_maintenance", name: "Nail refill (maintenance)" },
    { id: "color_root_touchup_maint", name: "Color root touch-up (maintenance)" },

    // ===== Your original baseline (kept for backward-compat; de-dup will remove overlap)
    { id: "haircut", name: "Haircut" },
    { id: "kids_cut", name: "Kids’ Cut" },
    { id: "beard_trim", name: "Beard Trim / Line Up" },
    { id: "hair_styling", name: "Hair Styling (Men/Women)" },
    { id: "braids_basic", name: "Braids (Basic)" },
    { id: "braids_knotless", name: "Braids (Knotless)" },
    { id: "cornrows", name: "Cornrows" },
    { id: "weave_install", name: "Weave / Wig Install" },
    { id: "locs_maintenance", name: "Dreadlocks Maintenance" },
    { id: "hair_coloring", name: "Hair Coloring / Tint" },
    { id: "manicure_basic", name: "Manicure (Basic)" },
    { id: "pedicure_basic", name: "Pedicure (Basic)" },
    { id: "nail_fixing", name: "Nail Fixing (Acrylic/PolyGel)" },
    { id: "gel_polish", name: "Gel Polish" },
    { id: "makeup_soft", name: "Makeup (Soft Glam)" },
    { id: "makeup_bridal_trial", name: "Makeup (Bridal Trial)" },
    { id: "lashes_classic", name: "Lashes (Classic)" },
    { id: "lashes_volume", name: "Lashes (Volume/Hybrid)" },
    { id: "facial_basic", name: "Facial (Basic)" },
    { id: "massage_relax", name: "Massage (Relaxation)" },
    { id: "hair_wash", name: "Hair Wash / Blowout" },
    { id: "edge_control", name: "Edge Control / Touch-up" },
  ];

  // De-dup by id and by normalized name to be extra safe
  const seenId = new Set();
  const seenName = new Set();
  const deduped = [];
  for (const it of list) {
    if (!it?.id || !it?.name) continue;
    const n = normName(it.name);
    if (seenId.has(it.id) || seenName.has(n)) continue;
    seenId.add(it.id);
    seenName.add(n);
    deduped.push(it);
  }
  return deduped;
}

/**
 * Props (unchanged):
 * - value: selected id or name
 * - onChange: (value, meta) => void; meta = { id, name, price? }
 * - catalog?: [{ id, name, price? }]
 * - includeOther?: boolean (default true)
 * - otherText?: string
 * - onOtherText?: (text)=>void
 * - showPrice?: boolean (default false)
 * - className?: string
 * - selectProps?: any
 */
export default function ServicePicker({
  value,
  onChange,
  catalog,
  includeOther = true,
  otherText = "",
  onOtherText,
  showPrice = false,
  className = "",
  selectProps = {},
}) {
  const items = useMemo(() => {
    const base = Array.isArray(catalog) && catalog.length ? catalog : getDefaultCatalog();
    const byId = new Set();
    const byName = new Set();
    return base.filter((it) => {
      if (!it?.id || !it?.name) return false;
      const n = normName(it.name);
      if (byId.has(it.id) || byName.has(n)) return false;
      byId.add(it.id); byName.add(n);
      return true;
    });
  }, [catalog]);

  const selectedIsOther = includeOther && value === "other";

  const formatted = (it) => {
    const hasPrice = Number.isFinite(it?.price);
    if (showPrice && hasPrice) {
      return `${it.name} — ₦${Number(it.price).toLocaleString()}`;
    }
    return it.name;
  };

  function handleSelect(e) {
    const v = e.target.value;
    if (v === "other") {
      onChange?.("other", { id: "other", name: otherText || "", price: null });
      return;
    }
    const found =
      items.find((it) => it.id === v) ||
      items.find((it) => normName(it.name) === normName(v));
    onChange?.(v, found || { id: v, name: v });
  }

  function handleOtherText(e) {
    const txt = e.target.value;
    onOtherText?.(txt);
    if (value === "other") {
      onChange?.("other", { id: "other", name: txt, price: null });
    }
  }

  return (
    <div className={`space-y-2 ${className}`}>
      <select
        value={selectedIsOther ? "other" : value || ""}
        onChange={handleSelect}
        className="w-full bg-black border border-zinc-800 rounded-lg px-3 py-2"
        {...selectProps}
      >
        <option value="" disabled>
          Select a service…
        </option>
        {items.map((it) => (
          <option key={it.id} value={it.id}>
            {formatted(it)}
          </option>
        ))}
        {includeOther && <option value="other">Other (please specify)…</option>}
      </select>

      {includeOther && selectedIsOther && (
        <input
          value={otherText}
          onChange={handleOtherText}
          placeholder="Describe the service…"
          className="w-full bg-black border border-zinc-800 rounded-lg px-3 py-2"
        />
      )}
    </div>
  );
}
