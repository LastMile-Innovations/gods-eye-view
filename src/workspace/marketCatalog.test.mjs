import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CANONICAL_PRODUCTS,
  computeLandedCost,
  rankOffers,
  searchProductGraph,
  addToUniversalCart,
  removeFromUniversalCart,
  calculateCartSummary,
} from './marketCatalog.js';

test('QUPG Canonical Catalog has distinct products with variants and verified merchant offers', () => {
  assert.ok(CANONICAL_PRODUCTS.length >= 4);
  const drill = CANONICAL_PRODUCTS.find((p) => p.id === 'prod-dewalt-dcd800');
  assert.ok(drill);
  assert.equal(drill.brand, 'DeWalt');
  assert.ok(drill.variants.length >= 3);
  assert.ok(drill.offers.length >= 5);

  // MKT-INV-001 & MKT-INV-002: Distinct variants preserve their GTIN/MPN
  const toolOnly = drill.variants.find((v) => v.id === 'tool_only');
  const twoBat = drill.variants.find((v) => v.id === 'two_battery');
  assert.notEqual(toolOnly.mpn, twoBat.mpn);
  assert.notEqual(toolOnly.gtin, twoBat.gtin);
});

test('Landed Cost Engine calculates exact minor units without floating-point drift', () => {
  const drill = CANONICAL_PRODUCTS.find((p) => p.id === 'prod-dewalt-dcd800');
  const localAceOffer = drill.offers.find((o) => o.id === 'off-dewalt-ace-local');

  const landed = computeLandedCost(localAceOffer);
  // Item: $149.00 (14900), Shipping: $0, Tax @ 8.25%: round(14900 * 0.0825) = 1229 ($12.29)
  // Total: 14900 + 0 + 1229 = 16129 ($161.29)
  assert.equal(landed.itemPrice.amountMinorUnits, 14900);
  assert.equal(landed.shipping.amountMinorUnits, 0);
  assert.equal(landed.tax.amountMinorUnits, 1229);
  assert.equal(landed.totalLanded.amountMinorUnits, 16129);
  assert.equal(landed.isVerified, true);
});

test('Offer ranking correctly sorts by Lowest Total, Fastest, and Closest Pickup', () => {
  const drill = CANONICAL_PRODUCTS.find((p) => p.id === 'prod-dewalt-dcd800');
  const toolOnlyOffers = drill.offers.filter((o) => o.variantId === 'tool_only');

  const lowest = rankOffers(toolOnlyOffers, 'lowest_total');
  // Used offer ($85.00, no tax, 0 shipping) should be lowest landed cost
  assert.equal(lowest[0].id, 'off-dewalt-coop-used');

  const fastest = rankOffers(toolOnlyOffers, 'fastest');
  // Local Ace (0 days pickup) or Oakland Co-op (0 days) should be fastest
  assert.equal(fastest[0].deliveryDays, 0);

  const closest = rankOffers(toolOnlyOffers, 'closest');
  // Local store / pickup offer first
  assert.ok(closest[0].sellerType === 'local_store' || closest[0].fulfillmentType === 'pickup');
});

test('Universal Product Graph search finds products by text, GTIN, or MPN', () => {
  const byTitle = searchProductGraph('brushless cordless drill');
  assert.ok(byTitle.some((p) => p.id === 'prod-dewalt-dcd800'));

  const byGtin = searchProductGraph('885911762145');
  assert.ok(byGtin.some((p) => p.id === 'prod-dewalt-dcd800'));

  const byCategory = searchProductGraph('', 'electrical');
  assert.ok(byCategory.some((p) => p.id === 'prod-solar-subpanel-100a'));
});

test('Universal Multi-Seller Cart tracks items and computes exact multi-merchant totals', () => {
  const context = {};
  const drill = CANONICAL_PRODUCTS.find((p) => p.id === 'prod-dewalt-dcd800');
  const variant = drill.variants[0];
  const offer = drill.offers[0];

  addToUniversalCart(context, { product: drill, variant, offer });
  assert.equal(context.cart.items.length, 1);
  assert.equal(context.cart.items[0].quantity, 1);

  // Add again increments quantity
  addToUniversalCart(context, { product: drill, variant, offer });
  assert.equal(context.cart.items[0].quantity, 2);

  const summary = calculateCartSummary(context.cart);
  assert.equal(summary.itemCount, 2);
  assert.equal(summary.merchantCount, 1);
  assert.equal(summary.itemTotalMinor, 14900 * 2);

  removeFromUniversalCart(context, context.cart.items[0].id);
  assert.equal(context.cart.items.length, 0);
});
