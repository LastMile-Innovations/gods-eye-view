# NeighborOS Market — The Universal Shopping & Commerce Canvas

Specification: `NBR-MARKET-001`  
Architecture: Quanta Universal Product Graph (QUPG) + Global Offer Network + Market App + Global Canvas + QHarness  
Status: BUILT_LOCAL / REVIEW_PENDING  
Date: October 17, 2026

---

## 1. Executive Summary & Core Tenets

NeighborOS Market provides one unified place to discover virtually anything sold anywhere, with one canonical product page displaying every available purchase option that can be legitimately accessed and verified.

Rather than duplicating listings for every merchant who sells a given item, Market anchors to a canonical technical identity in the **Quanta Universal Product Graph (QUPG)**. Sellers compete through offers attached to that identity.

```
                      UNIVERSAL PRODUCT (Canonical QID)
                                     │
           Technical Identity · Specifications · CAD Projections
          Variants · Compatibility · Reviews · Evidence · History
                                     │
         ┌───────────────────────────┼───────────────────────────┐
         ▼                           ▼                           ▼
    VARIANT A                   VARIANT B                   VARIANT C
   (Bare Tool)               (1-Battery Kit)             (2-Battery Kit)
         │                           │                           │
         ▼                           ▼                           ▼
 ┌───────┴───────┬───────────────┬───┴───────────┬───────────────┴───────┐
 │               │               │               │                       │
Retail         Brand           Local           Used                  Wholesale
Offer          Direct          Store           Unit                  Distributor
 │               │               │               │                       │
 └───────┬───────┴───────────────┴───────────────┴───────────────────────┘
         ▼
  OFFER COMPARISON & RANKING
  Landed Cost · Availability · Fulfillment · Seller Rating · Warranty · Distance
         ▼
  PURCHASE PATHWAYS
  Native Checkout / Partner Checkout / Seller Direct / Quote / Trade Proposal
```

### The "One Listing" Invariant

Market implements **one canonical product page per distinct catalog product**, rather than forcing genuinely different items into one record.
- **GS1 GTIN Alignment**: Distinct GTINs and MPNs identify qualifying product variations (such as tool-only vs battery kits, sizes, voltages).
- **Legitimate Variants**: Preserved under the canonical product family, allowing buyers to switch configurations seamlessly.
- **Unique Physical Items**: Used, surplus, or serialized items attach to their exact variant while retaining condition notes, defects, serial info, and ownership provenance.

---

## 2. Industry Interoperability & External Commerce Standards

Market federates external retail catalogs and protocols without compromising licensing or data constraints:

1. **Shopify Global Catalog (MCP Service)**:
   - Queries participating Shopify merchant catalogs via Model Context Protocol (MCP).
   - Clusters results by Shopify Universal Product IDs at query time.
   - Enforces live lookup terms: zero permanent caching of external search results or downloading of merchant imagery outside permitted display.
2. **Universal Commerce Protocol (UCP)**:
   - Leverages Google & Shopify's open commerce interoperability standard.
   - Separates discovery, pricing, carts, checkout, and identity linking into modular capabilities.
   - Implements capability advertisement: Market verifies whether a seller supports native checkout, partner checkout, or seller-redirect.
   - Recognizes that catalog quotes are non-binding until transactional verification at checkout.
3. **eBay Browse API**:
   - Supports GTIN and MPN lookup for second-hand, refurbished, and surplus marketplace items.
   - Redirects to external seller checkout when direct purchasing API access is restricted.
4. **Amazon Selling Partner API (SP-API)**:
   - Integrates authorized commercial selling partners with live inventory positions.

---

## 3. Quanta Universal Product Graph (QUPG) Core Objects

| Semantic Object | Purpose | Implementation Entity |
|---|---|---|
| `ProductFamily` | Related products under a common brand or platform | `family` in catalog definitions (e.g. *DeWalt 20V MAX XR*) |
| `Product` | Distinct commercial product definition with canonical QID | `CANONICAL_PRODUCTS` in `marketCatalog.js` |
| `ProductVariant` | Distinct configuration or packaging with unique MPN/GTIN | `variants[]` array (Bare Tool, 1-Battery, 2-Battery) |
| `UniqueItem` | Individually distinguishable physical unit | `condition`, serial, provenance records |
| `Seller` | Entity offering the product | `sellerId`, `sellerName`, `sellerType`, `sellerBadge` |
| `Offer` | Commercial terms for a variant | `price`, `shipping`, `taxRate`, `duties`, `discounts` |
| `InventoryPosition` | Stock and location metadata | `deliveryDays`, `fulfillmentType`, `coordinates` |
| `FulfillmentOption` | Delivery, pickup, or freight method | `pickup`, `shipping`, `freight` |
| `PurchasePath` | Transaction execution path | `native_checkout`, `partner_checkout`, `seller_site` |
| `PriceObservation` | Point-in-time price record | Audit log of historical offer prices |
| `ProductClaim` | Attributed specification or standard | `specifications[]` (torque, RPM, battery platform) |
| `Compatibility` | Verified physical or electrical relationship | `compatibility[]` (cross-platform batteries, bits) |
| `Review` | Attributed user assessment | `rating`, `reviewCount`, evidence references |
| `OwnershipRecord` | Link between physical item and citizen inventory | Private Garage / Records handoff |

---

## 4. Unified Product Page & Interactive 3D Visualizer

The unified product experience in `marketplaceApp.js` replaces toy cards with an engineering-grade workspace:

1. **Interactive 3D Canvas Projection**:
   - High-performance, unencumbered 3D canvas viewer (`.nw-3d-viewer-box`).
   - Drag-to-orbit wireframe inspection with real-time azimuthal and elevation angle updates.
   - **View Modes**:
     - *CAD Wireframe*: Isometric technical wireframe projection.
     - *Blueprint*: Orthographic front/side engineering layout with dimension calipers.
     - *Clearance*: Clearance bounding box showing operating volume and hand-guard envelopes.
2. **Variant Selection**:
   - Clean segmented cards displaying exact Manufacturer Part Numbers (MPN) and GS1 GTINs.
   - Real-time offer filtering based on the active variant.
3. **Condition Matrix**:
   - Instant filtering across `New`, `Refurbished`, `Open Box`, and `Used`.
4. **Buying Options Comparison Matrix**:
   - Tabular, high-density comparison of all competing merchants.
   - Badges for Local Store, Manufacturer Direct, Authorized Retailer, and Certified Lab.
   - Landed cost breakdown tooltips showing exact shipping and sales tax components.
   - 1-click `Add to Universal Cart` or `Checkout`.
5. **Cross-Application Handoffs**:
   - **Add to Project BOM**: Pushes product reference and landed cost directly into the active Project Bill of Materials (`projectsApp.js`).
   - **Share in Social**: Composes a verified product link with landed price in Citizen Messages (`socialMessagesApp.js`).
   - **Plan Installation with Agent**: Seeds an execution goal into the autonomous planning assistant (`agentApp.js`).
   - **Fly to Store**: Direct Cesium camera transition to the physical retailer's storefront on the 3D globe.

---

## 5. Exact Landed Cost Engine

Floating-point currency calculations cause cumulative rounding errors across multi-item, multi-tax transactions. Market implements an **integer minor units engine** (`computeLandedCost` in `marketCatalog.js`):

$$\text{LandedCost} = \max(0, \text{ItemPrice} + \text{Shipping} + \text{Tax} + \text{Duties} - \text{Discounts})$$

- All arithmetic is executed on `amountMinorUnits` (cents in USD, pence in GBP).
- Tax is calculated per line item using explicit local tax rates without rounding creep.
- Verified status is tagged as `live_verified` only when the merchant or adapter returns real-time inventory and pricing confirmation.

---

## 6. Universal Multi-Merchant Cart & Human Authorization Gate

The Universal Cart in `marketplaceApp.js` orchestrates items across multiple disparate merchants:

1. **Merchant-Grouped Checkout**:
   - Cart items are grouped by seller so distinct fulfillment policies and shipping costs remain transparent.
2. **Financial Summary**:
   - Items total, shipping total, estimated tax, and grand landed cost are summed in exact integer minor units.
3. **Human Authorization Gate (`MKT-INV-016`)**:
   - Autonomous purchasing without human consent is strictly prohibited.
   - Checkout buttons remain disabled until the buyer deliberately checks:
     > *"I explicitly authorize placing orders with the merchants listed above."*

---

## 7. System Invariants (`MKT-INV-001` .. `MKT-INV-018`)

| Invariant ID | Requirement | Verification Method |
|---|---|---|
| `MKT-INV-001` | One canonical product record per distinct catalog definition | QUPG graph index uniqueness test |
| `MKT-INV-002` | Never merge distinct variants with different GTINs into one record | Variant test in `marketCatalog.test.mjs` |
| `MKT-INV-003` | Never merge unique used items with different conditions/serials | UniqueItem property verification |
| `MKT-INV-004` | All monetary amounts must use integer minor units (`ExactMoney`) | `ExactMoney` unit tests |
| `MKT-INV-005` | Landed cost must include item, shipping, tax, and duties | `computeLandedCost` unit tests |
| `MKT-INV-006` | Cost components that cannot be verified must be flagged | `isVerified: false` audit |
| `MKT-INV-007` | External search results (Shopify MCP) must not be cached permanently | Query-time memory adapter boundary |
| `MKT-INV-008` | External images must not be scraped or stored outside viewing terms | Canvas rendering and CDN proxy contract |
| `MKT-INV-009` | Commercial terms must be re-verified at checkout | Purchase path validation gate |
| `MKT-INV-010` | Offers must be rankable by Lowest Total, Fastest, Closest, and Warranty | `rankOffers` unit tests |
| `MKT-INV-011` | Local stores must expose geographic coordinates for 3D globe picking | Globe marker projection test |
| `MKT-INV-012` | Products must support cross-app handoffs to Projects BOM | `capabilityBus` handoff verification |
| `MKT-INV-013` | Products must support cross-app handoffs to Social Messages | Message draft composer reference test |
| `MKT-INV-014` | Products must support cross-app handoffs to Agent planning | Agent goal seeding test |
| `MKT-INV-015` | Multi-merchant cart must compute exact grouped totals | `calculateCartSummary` unit test |
| `MKT-INV-016` | Checkout requires explicit human authorization checkbox | DOM interaction test in `marketplaceApp.js` |
| `MKT-INV-017` | Technical specifications and CAD views must render without blocking | 3D canvas animation loop audit |
| `MKT-INV-018` | Backward compatibility with legacy Quanta proposals and trade offers | Quanta offer/proposal tests pass |

---

## 8. Verification & Test Evidence

- **Unit Test Suite**: `src/workspace/marketCatalog.test.mjs` (5 passing tests).
- **Workspace Test Suite**: `node --test src/workspace/*.test.mjs` (32 passing tests).
- **Boundary & i18n Checks**: `npm run i18n && npm run check:boundaries` (0 missing messages, 0 unused messages, 0 boundary violations).
