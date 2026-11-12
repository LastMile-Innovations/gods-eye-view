import { formatExactMoney } from './capabilityBus.js';

/**
 * NeighborOS Universal Product Graph (QUPG) & Landed Cost Engine (`NBR-MARKET-001`).
 * Single canonical identity per distinct product definition, with legitimate variants
 * and multi-merchant offers comparing landed costs, fulfillment, and purchase paths.
 */

export const CANONICAL_PRODUCTS = [
  {
    id: 'prod-dewalt-dcd800',
    qid: 'Q-PROD-DEWALT-DCD800-XR',
    family: 'DeWalt 20V MAX XR Brushless Cordless Drill',
    // i18n-ignore: canonical catalog product title
    title: 'DeWalt 20V MAX XR 1/2-in. Brushless Cordless Drill / Driver',
    brand: 'DeWalt',
    category: 'tools-equipment',
    rating: 4.8,
    reviewCount: 312,
    description:
      'High-performance brushless motor delivers up to 2,000 RPM and 904 in-lbs of torque in a compact 6.37-inch length. Engineered for heavy-duty framing, hole-sawing, and structural timber fastening.',
    specifications: [
      ['Motor Type', 'Brushless DC High-Efficiency'],
      ['Max Torque', '904 in-lbs (102 Nm)'],
      ['Chuck Size & Type', '1/2 in. Heavy-Duty Metal Ratcheting Chuck'],
      ['No-Load Speed', '0-650 / 0-2,000 RPM (2-Speed Gearbox)'],
      ['Tool Length', '6.37 in. (162 mm)'],
      ['Bare Tool Weight', '2.8 lbs (1.27 kg)'],
      ['Battery Platform', 'DeWalt 20V MAX / FLEXVOLT Compatible'],
    ],
    documentation: [
      'Instruction Manual (DCD800-NA-EN/ES/FR)',
      'Exploded Parts Diagram & BOM (Rev C)',
      '3-Year Limited Warranty Statement',
    ],
    compatibility: [
      'DeWalt 20V MAX Batteries (DCB200, DCB203, DCB204, DCB205, DCB208)',
      'DeWalt FLEXVOLT Batteries (DCB606, DCB609, DCB612)',
      'Standard 1/2-inch and 1/4-inch hex-shank driver bits',
    ],
    variants: [
      {
        id: 'tool_only',
        name: 'Bare Tool (No Battery)',
        mpn: 'DCD800B',
        gtin: '885911762145',
        description: 'Includes DCD800 Drill/Driver and Belt Hook.',
      },
      {
        id: 'one_battery',
        name: '1-Battery 2.0Ah Compact Kit',
        mpn: 'DCD800D1',
        gtin: '885911762152',
        description:
          'Includes DCD800 Drill, (1) DCB203 2.0Ah Battery, Charger, and Bag.',
      },
      {
        id: 'two_battery',
        name: '2-Battery 5.0Ah High-Capacity Kit',
        mpn: 'DCD800P2',
        gtin: '885911762169',
        description:
          'Includes DCD800 Drill, (2) DCB205 5.0Ah XR Batteries, Multi-Voltage Charger, and Contractor Kit Box.',
      },
    ],
    offers: [
      {
        id: 'off-dewalt-ace-local',
        sellerId: 'seller-berkeley-ace',
        sellerName: 'Berkeley Tool & Hardware Supply',
        sellerType: 'local_store',
        sellerBadge: 'Neighborhood Hardware Store',
        coordinates: [-122.273, 37.8715],
        variantId: 'tool_only',
        condition: 'new',
        conditionLabel: 'New in Box',
        price: { currency: 'USD', amountMinorUnits: 14900 },
        shipping: { currency: 'USD', amountMinorUnits: 0 },
        taxRate: 0.0825,
        duties: { currency: 'USD', amountMinorUnits: 0 },
        discounts: { currency: 'USD', amountMinorUnits: 0 },
        deliveryDays: 0,
        deliveryLabel: 'Today · Free In-Store Pickup',
        fulfillmentType: 'pickup',
        purchasePath: 'native_checkout',
        warranty: '3-Year Manufacturer + Local Store Replacement Support',
        returns: '30-Day Hassle-Free Local Return',
        freshness: 'live_verified',
      },
      {
        id: 'off-dewalt-direct',
        sellerId: 'seller-dewalt-brand',
        sellerName: 'DeWalt Factory Direct Store',
        sellerType: 'manufacturer_direct',
        sellerBadge: 'Manufacturer Direct',
        coordinates: null,
        variantId: 'tool_only',
        condition: 'new',
        conditionLabel: 'Brand New (Factory Sealed)',
        price: { currency: 'USD', amountMinorUnits: 15900 },
        shipping: { currency: 'USD', amountMinorUnits: 0 },
        taxRate: 0.0825,
        duties: { currency: 'USD', amountMinorUnits: 0 },
        discounts: { currency: 'USD', amountMinorUnits: 0 },
        deliveryDays: 4,
        deliveryLabel: '4 business days · Free Ground Shipping',
        fulfillmentType: 'shipping',
        purchasePath: 'partner_checkout',
        warranty: '3-Year Official DeWalt Guarantee + 1-Year Free Service',
        returns: '45-Day Official Return Window',
        freshness: 'live_verified',
      },
      {
        id: 'off-dewalt-online-supply',
        sellerId: 'seller-northern-tool',
        sellerName: 'Northern Equipment & Tool Co.',
        sellerType: 'authorized_retailer',
        sellerBadge: 'Authorized Retailer',
        coordinates: null,
        variantId: 'tool_only',
        condition: 'new',
        conditionLabel: 'New in Box',
        price: { currency: 'USD', amountMinorUnits: 13900 },
        shipping: { currency: 'USD', amountMinorUnits: 995 },
        taxRate: 0.0825,
        duties: { currency: 'USD', amountMinorUnits: 0 },
        discounts: { currency: 'USD', amountMinorUnits: 0 },
        deliveryDays: 3,
        deliveryLabel: '3 business days · Tracked Parcel',
        fulfillmentType: 'shipping',
        purchasePath: 'seller_checkout',
        warranty: '3-Year Standard Manufacturer Warranty',
        returns: '30-Day Return (Buyer pays return postage)',
        freshness: 'recently_confirmed',
      },
      {
        id: 'off-dewalt-renew',
        sellerId: 'seller-renew-hub',
        sellerName: 'Certified Tool ReNew Hub',
        sellerType: 'refurbished_seller',
        sellerBadge: 'Factory Certified Refurbished',
        coordinates: null,
        variantId: 'tool_only',
        condition: 'refurbished',
        conditionLabel: 'Certified Refurbished (Grade A)',
        price: { currency: 'USD', amountMinorUnits: 10900 },
        shipping: { currency: 'USD', amountMinorUnits: 650 },
        taxRate: 0.0825,
        duties: { currency: 'USD', amountMinorUnits: 0 },
        discounts: { currency: 'USD', amountMinorUnits: 0 },
        deliveryDays: 5,
        deliveryLabel: '5 business days · Reconditioned Packaging',
        fulfillmentType: 'shipping',
        purchasePath: 'partner_checkout',
        warranty: '90-Day Comprehensive ReNew Warranty',
        returns: '30-Day Money-Back Guarantee',
        freshness: 'live_verified',
      },
      {
        id: 'off-dewalt-coop-used',
        sellerId: 'seller-eastbay-coop',
        sellerName: 'Oakland East Bay Maker Co-op Member',
        sellerType: 'used_seller',
        sellerBadge: 'Verified Community Member',
        coordinates: [-122.261, 37.8044],
        variantId: 'tool_only',
        condition: 'used',
        conditionLabel: 'Used — Excellent Condition',
        price: { currency: 'USD', amountMinorUnits: 8500 },
        shipping: { currency: 'USD', amountMinorUnits: 0 },
        taxRate: 0,
        duties: { currency: 'USD', amountMinorUnits: 0 },
        discounts: { currency: 'USD', amountMinorUnits: 0 },
        deliveryDays: 0,
        deliveryLabel: 'Same-day arrange pickup in Oakland',
        fulfillmentType: 'pickup',
        purchasePath: 'contact_offer',
        warranty: 'No manufacturer warranty; tested operational in workshop',
        returns: '7-day peer return if defective',
        freshness: 'seller_reported',
      },
      {
        id: 'off-dewalt-kit-2bat-ace',
        sellerId: 'seller-berkeley-ace',
        sellerName: 'Berkeley Tool & Hardware Supply',
        sellerType: 'local_store',
        sellerBadge: 'Neighborhood Hardware Store',
        coordinates: [-122.273, 37.8715],
        variantId: 'two_battery',
        condition: 'new',
        conditionLabel: 'New in Box',
        price: { currency: 'USD', amountMinorUnits: 27900 },
        shipping: { currency: 'USD', amountMinorUnits: 0 },
        taxRate: 0.0825,
        duties: { currency: 'USD', amountMinorUnits: 0 },
        discounts: { currency: 'USD', amountMinorUnits: 2000 },
        deliveryDays: 0,
        deliveryLabel: 'Today · In-Store Pickup ($20 instant rebate applied)',
        fulfillmentType: 'pickup',
        purchasePath: 'native_checkout',
        warranty: '3-Year Manufacturer Warranty + 3-Year Battery Service',
        returns: '30-Day Hassle-Free Local Return',
        freshness: 'live_verified',
      },
      {
        id: 'off-dewalt-kit-1bat-brand',
        sellerId: 'seller-dewalt-brand',
        sellerName: 'DeWalt Factory Direct Store',
        sellerType: 'manufacturer_direct',
        sellerBadge: 'Manufacturer Direct',
        coordinates: null,
        variantId: 'one_battery',
        condition: 'new',
        conditionLabel: 'Brand New (Factory Sealed)',
        price: { currency: 'USD', amountMinorUnits: 19900 },
        shipping: { currency: 'USD', amountMinorUnits: 0 },
        taxRate: 0.0825,
        duties: { currency: 'USD', amountMinorUnits: 0 },
        discounts: { currency: 'USD', amountMinorUnits: 0 },
        deliveryDays: 4,
        deliveryLabel: '4 business days · Free Ground Shipping',
        fulfillmentType: 'shipping',
        purchasePath: 'partner_checkout',
        warranty: '3-Year Official DeWalt Guarantee',
        returns: '45-Day Official Return Window',
        freshness: 'live_verified',
      },
    ],
  },
  {
    id: 'prod-lumber-2x6x16',
    qid: 'Q-PROD-LUMBER-DF-2X6X16',
    family: '2x6 Kiln-Dried Douglas Fir Structural Framing Lumber',
    // i18n-ignore: canonical catalog product title
    title: '2-in. x 6-in. x 16-ft. #2 & Btr Kiln-Dried Douglas Fir Lumber',
    brand: 'Pacific Northwest Timber Alliance',
    category: 'materials',
    rating: 4.9,
    reviewCount: 88,
    description:
      'SFI-certified sustainable Pacific Northwest Douglas Fir, surfaced 4 sides (S4S), kiln-dried to under 19% moisture content. Premium structural grade for floor joists, rafters, and deck framing.',
    specifications: [
      ['Nominal Dimensions', '2 in. x 6 in. x 16 ft.'],
      ['Actual Dimensions', '1-1/2 in. x 5-1/2 in. x 192 in.'],
      ['Wood Species', 'Douglas Fir (Pseudotsuga menziesii)'],
      ['Grade', '#2 and Better Structural'],
      ['Moisture Content', 'Kiln-Dried (KD-19)'],
      ['Certifications', 'SFI Sustainable Forestry Initiative Certified'],
    ],
    documentation: [
      'Structural Load Span Tables (WCLIB Rules 17)',
      'Moisture Testing & Environmental Product Declaration (EPD)',
    ],
    compatibility: [
      'Standard 16-inch and 24-inch on-center framing layouts',
      'Simpson Strong-Tie LU26 / LUS26 joist hangers',
      'Hot-dip galvanized or structural stainless fasteners',
    ],
    variants: [
      {
        id: 'single_board',
        name: 'Single Board (16 ft.)',
        mpn: 'DF-2616-S4S',
        gtin: '041234567891',
        description: 'Individual hand-culled 16-foot board.',
      },
      {
        id: 'contractor_bundle',
        name: 'Contractor Unit (48 Boards)',
        mpn: 'DF-2616-UNIT48',
        gtin: '041234567892',
        description:
          'Banded jobsite bundle of 48 boards with moisture-resistant wrap.',
      },
    ],
    offers: [
      {
        id: 'off-lumber-redwood-mill',
        sellerId: 'seller-redwood-mill',
        sellerName: 'Redwood Cooperative Mill',
        sellerType: 'local_store',
        sellerBadge: 'Regional Worker Cooperative',
        coordinates: [-122.285, 37.865],
        variantId: 'single_board',
        condition: 'new',
        conditionLabel: 'Mill Fresh',
        price: { currency: 'USD', amountMinorUnits: 1450 },
        shipping: { currency: 'USD', amountMinorUnits: 2500 },
        taxRate: 0.0825,
        duties: { currency: 'USD', amountMinorUnits: 0 },
        discounts: { currency: 'USD', amountMinorUnits: 0 },
        deliveryDays: 1,
        deliveryLabel: 'Tomorrow · Flat-rate local truck drop',
        fulfillmentType: 'local_delivery',
        purchasePath: 'native_checkout',
        warranty: 'Mill Inspection Grade Guarantee',
        returns: 'Exchange warped boards at delivery',
        freshness: 'live_verified',
      },
      {
        id: 'off-lumber-golden-state',
        sellerId: 'seller-golden-state',
        sellerName: 'Golden State Building Materials',
        sellerType: 'authorized_retailer',
        sellerBadge: 'Commercial Building Supply',
        coordinates: [-122.295, 37.842],
        variantId: 'single_board',
        condition: 'new',
        conditionLabel: 'Yard Stock',
        price: { currency: 'USD', amountMinorUnits: 1380 },
        shipping: { currency: 'USD', amountMinorUnits: 3500 },
        taxRate: 0.0825,
        duties: { currency: 'USD', amountMinorUnits: 0 },
        discounts: { currency: 'USD', amountMinorUnits: 0 },
        deliveryDays: 2,
        deliveryLabel: '2 business days · Boom truck delivery',
        fulfillmentType: 'local_delivery',
        purchasePath: 'partner_checkout',
        warranty: 'Standard commercial grade guarantee',
        returns: 'Returnable within 14 days with restocking fee',
        freshness: 'recently_confirmed',
      },
      {
        id: 'off-lumber-bundle-mill',
        sellerId: 'seller-redwood-mill',
        sellerName: 'Redwood Cooperative Mill',
        sellerType: 'local_store',
        sellerBadge: 'Regional Worker Cooperative',
        coordinates: [-122.285, 37.865],
        variantId: 'contractor_bundle',
        condition: 'new',
        conditionLabel: 'Banded Mill Unit',
        price: { currency: 'USD', amountMinorUnits: 62400 },
        shipping: { currency: 'USD', amountMinorUnits: 0 },
        taxRate: 0.0825,
        duties: { currency: 'USD', amountMinorUnits: 0 },
        discounts: { currency: 'USD', amountMinorUnits: 4800 },
        deliveryDays: 1,
        deliveryLabel:
          'Tomorrow · Free Jobsite Crane Drop ($48 bulk discount applied)',
        fulfillmentType: 'local_delivery',
        purchasePath: 'native_checkout',
        warranty: 'Full Unit Grade Certification',
        returns: 'Full unit inspection guarantee',
        freshness: 'live_verified',
      },
    ],
  },
  {
    id: 'prod-bosch-blaze-165',
    qid: 'Q-PROD-BOSCH-BLAZE-GLM165',
    family: 'Bosch BLAZE Laser Distance Measure',
    // i18n-ignore: canonical catalog product title
    title: 'Bosch BLAZE 165-ft. Laser Measure with Real-Time Distance & Area',
    brand: 'Bosch',
    category: 'tools-equipment',
    rating: 4.7,
    reviewCount: 194,
    description:
      'Extreme accuracy up to ±1/16 in. with a 165-ft. range. Features backlit color display, real-time continuous measuring, square footage area calculations, and rugged rubberized overmold casing.',
    specifications: [
      ['Measuring Range', '0.5 ft. up to 165 ft. (0.15 m - 50 m)'],
      ['Accuracy', '±1/16 in. (±1.5 mm)'],
      ['Laser Diode', 'Class II 635 nm, <1mW'],
      ['Display', 'Backlit High-Contrast Color Display'],
      ['Battery Life', 'Up to 10,000 Individual Measurements (2x AAA)'],
      ['Drop Protection', 'Engineered to withstand up to 4 ft. drops (IP54)'],
    ],
    documentation: [
      'Quick Start Guide & Calibration Card',
      'Safety and Laser Classification Compliance Sheet',
    ],
    compatibility: [
      'Standard 1/4-20 tripod mounts',
      'Compatible with digital site survey workflow',
    ],
    variants: [
      {
        id: 'standard_unit',
        name: 'Standard Laser Measure Kit',
        mpn: 'GLM165-40',
        gtin: '000346638424',
        description:
          'Includes Laser Measure, Hand Strap, (2) AAA Batteries, and Pouch.',
      },
    ],
    offers: [
      {
        id: 'off-bosch-local-ace',
        sellerId: 'seller-berkeley-ace',
        sellerName: 'Berkeley Tool & Hardware Supply',
        sellerType: 'local_store',
        sellerBadge: 'Neighborhood Hardware Store',
        coordinates: [-122.273, 37.8715],
        variantId: 'standard_unit',
        condition: 'new',
        conditionLabel: 'New in Box',
        price: { currency: 'USD', amountMinorUnits: 5995 },
        shipping: { currency: 'USD', amountMinorUnits: 0 },
        taxRate: 0.0825,
        duties: { currency: 'USD', amountMinorUnits: 0 },
        discounts: { currency: 'USD', amountMinorUnits: 0 },
        deliveryDays: 0,
        deliveryLabel: 'Today · Ready in 30 mins for Pickup',
        fulfillmentType: 'pickup',
        purchasePath: 'native_checkout',
        warranty: '2-Year Limited Bosch Warranty',
        returns: '30-Day Local Store Returns',
        freshness: 'live_verified',
      },
      {
        id: 'off-bosch-direct',
        sellerId: 'seller-bosch-direct',
        sellerName: 'Bosch Power Tools Direct',
        sellerType: 'manufacturer_direct',
        sellerBadge: 'Manufacturer Direct',
        coordinates: null,
        variantId: 'standard_unit',
        condition: 'new',
        conditionLabel: 'New (Factory Sealed)',
        price: { currency: 'USD', amountMinorUnits: 6499 },
        shipping: { currency: 'USD', amountMinorUnits: 0 },
        taxRate: 0.0825,
        duties: { currency: 'USD', amountMinorUnits: 0 },
        discounts: { currency: 'USD', amountMinorUnits: 500 },
        deliveryDays: 3,
        deliveryLabel: '3 business days · Free Shipping ($5 instant discount)',
        fulfillmentType: 'shipping',
        purchasePath: 'partner_checkout',
        warranty: '3-Year with PRO360 Online Registration',
        returns: '30-Day Official Return Window',
        freshness: 'live_verified',
      },
      {
        id: 'off-bosch-refurb',
        sellerId: 'seller-renew-hub',
        sellerName: 'Certified Tool ReNew Hub',
        sellerType: 'refurbished_seller',
        sellerBadge: 'Certified Calibration Lab',
        coordinates: null,
        variantId: 'standard_unit',
        condition: 'refurbished',
        conditionLabel: 'Factory Recalibrated Grade A',
        price: { currency: 'USD', amountMinorUnits: 4200 },
        shipping: { currency: 'USD', amountMinorUnits: 495 },
        taxRate: 0.0825,
        duties: { currency: 'USD', amountMinorUnits: 0 },
        discounts: { currency: 'USD', amountMinorUnits: 0 },
        deliveryDays: 4,
        deliveryLabel: '4 business days · Calibration Certificate Included',
        fulfillmentType: 'shipping',
        purchasePath: 'partner_checkout',
        warranty: '90-Day Lab Calibration Warranty',
        returns: '30-Day Return Guarantee',
        freshness: 'live_verified',
      },
    ],
  },
  {
    id: 'prod-solar-subpanel-100a',
    qid: 'Q-PROD-SCHNEIDER-HOMELINE-100A',
    family: 'Square D Homeline Solar-Ready Subpanel',
    title:
      // i18n-ignore: canonical catalog product title
      'Square D Homeline 100A 12-Space 24-Circuit Solar-Ready Outdoor Subpanel',
    brand: 'Square D by Schneider Electric',
    category: 'electrical',
    rating: 4.9,
    reviewCount: 64,
    description:
      'NEMA 3R rainproof outdoor load center with busbar ratings engineered specifically for renewable energy and solar backfeed compliance (NEC 705.12). Accommodates dual main supply breakers.',
    specifications: [
      ['Amperage Rating', '100 Amperes'],
      ['Spaces / Circuits', '12 Spaces / 24 Single-Pole Circuits'],
      ['Enclosure Rating', 'NEMA 3R Outdoor Rainproof Enclosure'],
      [
        'Solar Backfeed Rating',
        'Rated up to 225A Busbar for High-Output Solar',
      ],
      ['Voltage', '120/240V AC Single-Phase 3-Wire'],
      ['UL Listing', 'UL 67 Listed Electric Panelboard'],
    ],
    documentation: [
      'NEC 705.12 Solar Interconnection Diagram',
      'Torque Specifications and Wire Gauge Guide (AWG #4 - 2/0 Al/Cu)',
    ],
    compatibility: [
      'Square D Homeline Circuit Breakers (HOM)',
      'Compatible with grid-tied inverters and ESS subfeed lugs',
    ],
    variants: [
      {
        id: 'nema_3r_outdoor',
        name: 'NEMA 3R Outdoor Rainproof Enclosure',
        mpn: 'HOM1224L100RBCVP',
        gtin: '785901861234',
        description:
          'Complete outdoor package with factory ground bar and feed-through lugs.',
      },
    ],
    offers: [
      {
        id: 'off-panel-berkeley-electric',
        sellerId: 'seller-bay-electric',
        sellerName: 'East Bay Electrical Supply Guild',
        sellerType: 'local_store',
        sellerBadge: 'Licensed Wholesaler & Trade Supply',
        coordinates: [-122.288, 37.854],
        variantId: 'nema_3r_outdoor',
        condition: 'new',
        conditionLabel: 'New in Box',
        price: { currency: 'USD', amountMinorUnits: 18900 },
        shipping: { currency: 'USD', amountMinorUnits: 0 },
        taxRate: 0.0825,
        duties: { currency: 'USD', amountMinorUnits: 0 },
        discounts: { currency: 'USD', amountMinorUnits: 0 },
        deliveryDays: 0,
        deliveryLabel: 'Today · Counter Pickup in Berkeley',
        fulfillmentType: 'pickup',
        purchasePath: 'native_checkout',
        warranty: '10-Year Square D Manufacturer Warranty',
        returns: '30-Day Trade Return (Uninstalled)',
        freshness: 'live_verified',
      },
      {
        id: 'off-panel-commercial-direct',
        sellerId: 'seller-schneider-direct',
        sellerName: 'Schneider Electric Direct Distribution',
        sellerType: 'manufacturer_direct',
        sellerBadge: 'Commercial Direct',
        coordinates: null,
        variantId: 'nema_3r_outdoor',
        condition: 'new',
        conditionLabel: 'Factory Pallet Stock',
        price: { currency: 'USD', amountMinorUnits: 17900 },
        shipping: { currency: 'USD', amountMinorUnits: 1450 },
        taxRate: 0.0825,
        duties: { currency: 'USD', amountMinorUnits: 0 },
        discounts: { currency: 'USD', amountMinorUnits: 0 },
        deliveryDays: 3,
        deliveryLabel: '3 business days · Freight delivery',
        fulfillmentType: 'shipping',
        purchasePath: 'partner_checkout',
        warranty: '10-Year Full Manufacturer Guarantee',
        returns: '30-Day Commercial Policy',
        freshness: 'live_verified',
      },
    ],
  },
];

/**
 * Landed Cost Calculation Engine (`NBR-MARKET-001` Section 5).
 * Landed Cost = Item Price + Shipping + Taxes + Duties + Fees - Discounts.
 * Exact integer minor units are used to prevent IEEE 754 drift.
 */
export function computeLandedCost(offer) {
  if (!offer || !offer.price) {
    return {
      itemPrice: { currency: 'USD', amountMinorUnits: 0 },
      shipping: { currency: 'USD', amountMinorUnits: 0 },
      tax: { currency: 'USD', amountMinorUnits: 0 },
      duties: { currency: 'USD', amountMinorUnits: 0 },
      discounts: { currency: 'USD', amountMinorUnits: 0 },
      totalLanded: { currency: 'USD', amountMinorUnits: 0 },
      isVerified: false,
    };
  }

  const currency = offer.price.currency || 'USD';
  const itemMinor = offer.price.amountMinorUnits || 0;
  const shippingMinor = offer.shipping?.amountMinorUnits || 0;
  const taxMinor = Math.round(itemMinor * (offer.taxRate || 0));
  const dutiesMinor = offer.duties?.amountMinorUnits || 0;
  const discountsMinor = offer.discounts?.amountMinorUnits || 0;

  const totalMinor = Math.max(
    0,
    itemMinor + shippingMinor + taxMinor + dutiesMinor - discountsMinor,
  );

  return {
    itemPrice: { currency, amountMinorUnits: itemMinor },
    shipping: { currency, amountMinorUnits: shippingMinor },
    tax: { currency, amountMinorUnits: taxMinor },
    duties: { currency, amountMinorUnits: dutiesMinor },
    discounts: { currency, amountMinorUnits: discountsMinor },
    totalLanded: { currency, amountMinorUnits: totalMinor },
    isVerified: offer.freshness === 'live_verified',
    breakdownText: `${formatExactMoney(itemMinor, currency)} + ${formatExactMoney(shippingMinor, currency)} ship + ${formatExactMoney(taxMinor, currency)} tax${discountsMinor ? ` - ${formatExactMoney(discountsMinor, currency)} discount` : ''}`,
  };
}

/**
 * Filter & Rank Offers by Buyer Preference.
 */
export function rankOffers(
  offers,
  criteria = 'lowest_total',
  variantFilter = null,
  conditionFilter = null,
) {
  let list = [...offers];
  if (variantFilter && variantFilter !== 'all') {
    list = list.filter((o) => o.variantId === variantFilter);
  }
  if (conditionFilter && conditionFilter !== 'all') {
    list = list.filter((o) => o.condition === conditionFilter);
  }

  return list.sort((a, b) => {
    const costA = computeLandedCost(a).totalLanded.amountMinorUnits;
    const costB = computeLandedCost(b).totalLanded.amountMinorUnits;

    if (criteria === 'lowest_total') {
      return costA - costB;
    }
    if (criteria === 'fastest') {
      const daysA = a.deliveryDays ?? 99;
      const daysB = b.deliveryDays ?? 99;
      if (daysA !== daysB) return daysA - daysB;
      return costA - costB;
    }
    if (criteria === 'closest') {
      const isLocalA =
        a.sellerType === 'local_store' || a.fulfillmentType === 'pickup'
          ? 0
          : 1;
      const isLocalB =
        b.sellerType === 'local_store' || b.fulfillmentType === 'pickup'
          ? 0
          : 1;
      if (isLocalA !== isLocalB) return isLocalA - isLocalB;
      return costA - costB;
    }
    if (criteria === 'best_warranty') {
      const wScore = (o) =>
        o.sellerType === 'manufacturer_direct'
          ? 3
          : o.sellerType === 'local_store'
            ? 2
            : 1;
      if (wScore(b) !== wScore(a)) return wScore(b) - wScore(a);
      return costA - costB;
    }
    if (criteria === 'condition') {
      const cScore = { new: 4, open_box: 3, refurbished: 2, used: 1 };
      const sA = cScore[a.condition] || 0;
      const sB = cScore[b.condition] || 0;
      if (sB !== sA) return sB - sA;
      return costA - costB;
    }
    return costA - costB;
  });
}

/**
 * Search Universal Product Graph by query, category, and identifiers.
 */
export function searchProductGraph(query = '', category = 'all') {
  const q = (query || '').trim().toLowerCase();
  let list = CANONICAL_PRODUCTS;

  if (category && category !== 'all') {
    list = list.filter((p) => p.category === category);
  }

  if (!q) return list;

  return list.filter((p) => {
    const hay =
      `${p.title} ${p.family} ${p.brand} ${p.category} ${p.description} ${p.variants.map((v) => `${v.name} ${v.mpn} ${v.gtin}`).join(' ')}`.toLowerCase();
    return hay.includes(q);
  });
}

/**
 * Universal Multi-Seller Cart Controller.
 */
export function getUniversalCart(context) {
  if (!context.cart) {
    context.cart = { items: [] };
  }
  return context.cart;
}

export function addToUniversalCart(context, { product, variant, offer }) {
  const cart = getUniversalCart(context);
  const existing = cart.items.find((item) => item.offerId === offer.id);
  if (existing) {
    existing.quantity = (existing.quantity || 1) + 1;
  } else {
    cart.items.push({
      id: `cart-${crypto.randomUUID().slice(0, 8)}`,
      productId: product.id,
      productTitle: product.title,
      brand: product.brand,
      variantId: variant.id,
      variantName: variant.name,
      offerId: offer.id,
      sellerName: offer.sellerName,
      sellerType: offer.sellerType,
      purchasePath: offer.purchasePath,
      price: offer.price,
      shipping: offer.shipping,
      taxRate: offer.taxRate,
      duties: offer.duties,
      discounts: offer.discounts,
      condition: offer.condition,
      deliveryLabel: offer.deliveryLabel,
      quantity: 1,
    });
  }
  return cart;
}

export function removeFromUniversalCart(context, cartItemId) {
  const cart = getUniversalCart(context);
  cart.items = cart.items.filter((item) => item.id !== cartItemId);
  return cart;
}

export function calculateCartSummary(cart) {
  const items = cart?.items || [];
  let itemTotalMinor = 0;
  let shippingTotalMinor = 0;
  let taxTotalMinor = 0;
  let discountTotalMinor = 0;

  for (const item of items) {
    const qty = item.quantity || 1;
    const itemMinor = (item.price?.amountMinorUnits || 0) * qty;
    const shipMinor = item.shipping?.amountMinorUnits || 0;
    const taxMinor = Math.round(itemMinor * (item.taxRate || 0));
    const discMinor = (item.discounts?.amountMinorUnits || 0) * qty;

    itemTotalMinor += itemMinor;
    shippingTotalMinor += shipMinor;
    taxTotalMinor += taxMinor;
    discountTotalMinor += discMinor;
  }

  const grandTotalMinor = Math.max(
    0,
    itemTotalMinor + shippingTotalMinor + taxTotalMinor - discountTotalMinor,
  );

  return {
    itemCount: items.reduce((acc, it) => acc + (it.quantity || 1), 0),
    merchantCount: new Set(items.map((it) => it.sellerName)).size,
    itemTotalMinor,
    shippingTotalMinor,
    taxTotalMinor,
    discountTotalMinor,
    grandTotalMinor,
    currency: 'USD',
  };
}
