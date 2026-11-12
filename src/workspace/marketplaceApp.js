import { t, msg } from '../i18n/index.js';
/**
 * NeighborOS Market — The Universal Shopping & Commerce Canvas (`NBR-MARKET-001`).
 * Canonical Product Graph + Global Offer Network + Unified Product Page + Universal Cart.
 * One product identity -> distinct variants -> competing merchant offers -> verified landed costs.
 */
import { formatExactMoney, parseExactMoneyInput } from './capabilityBus.js';
import { propertyGrid, statusBar } from './ui.js';
import {
  CANONICAL_PRODUCTS,
  computeLandedCost,
  rankOffers,
  searchProductGraph,
  getUniversalCart,
  addToUniversalCart,
  removeFromUniversalCart,
  calculateCartSummary,
} from './marketCatalog.js';

const CATEGORIES = [
  { id: 'all', label: msg('All Categories') },
  { id: 'tools-equipment', label: msg('Tools & Heavy Equipment') },
  { id: 'materials', label: msg('Materials & Lumber') },
  { id: 'electrical', label: msg('Electrical & Solar') },
  { id: 'equipment', label: msg('Equipment') },
  { id: 'skilled-trades', label: msg('Skilled Trades') },
  { id: 'tool-rental', label: msg('Tool & Heavy Rental') },
  { id: 'local-services', label: msg('Local Services') },
  { id: 'civic-bounty', label: msg('Civic Bounty') },
];

const RATE_BASES = ['fixed', 'hourly', 'daily', 'per_unit'];

export function renderMarketplaceApp({
  context,
  content,
  domainNetwork,
  snapshot,
  bus,
  node,
  button,
  field,
  busy,
  blocked,
  commit,
  show,
}) {
  content.className = 'nd-app-body nw-domain-view nw-market-app';
  content.replaceChildren();

  const handoff = bus?.consumeHandoff('marketplace');
  if (handoff) {
    if (handoff.action === 'source-bom') {
      context.query = handoff.payload?.query || '';
      context.activeProjectId = handoff.payload?.projectId || '';
      context.activeBomItem = handoff.payload?.bomItem || null;
      context.tab = 'products';
      context.selectedProductId = null;
    } else if (handoff.action === 'filter-by-place') {
      context.placeFilter = handoff.payload?.placeId || '';
      context.tab = 'products';
    } else if (handoff.action === 'inspect-product') {
      context.tab = 'products';
      context.selectedProductId = handoff.payload?.productId || null;
      if (handoff.payload?.variantId) {
        context.selectedVariantId = handoff.payload.variantId;
      }
    }
  }

  const offers = domainNetwork?.offers || [];
  const proposals = domainNetwork?.proposals || [];
  const commitments = domainNetwork?.commitments || [];
  const projects = domainNetwork?.projects || [];
  const summary = domainNetwork?.summary || {};
  const allItems = snapshot?.items || [];
  const places = allItems.filter((i) => i.payload?.kind === 'place');

  content.dataset.draftForm = `marketplace:${context.tab || 'main'}:v1`;
  const tab = context.tab || 'products';
  const categoryFilter = context.category || 'all';
  const searchQuery = (context.query || '').toLowerCase();
  const cart = getUniversalCart(context);
  const cartTotals = calculateCartSummary(cart);

  const rerender = () =>
    renderMarketplaceApp({
      context,
      content,
      domainNetwork,
      snapshot,
      bus,
      node,
      button,
      field,
      busy,
      blocked,
      commit,
      show,
    });

  // Top Command Toolbar
  const tabsBar = node(
    'div',
    { className: 'nw-tabs' },
    button(
      `Products (${CANONICAL_PRODUCTS.length})`,
      () => {
        context.tab = 'products';
        rerender();
      },
      {
        className: tab === 'products' ? 'nw-primary' : '',
        'aria-pressed': String(tab === 'products'),
      },
    ),
    button(
      `Offers (${offers.length})`,
      () => {
        context.tab = 'offers';
        rerender();
      },
      {
        className: tab === 'offers' ? 'nw-primary' : '',
        'aria-pressed': String(tab === 'offers'),
      },
    ),
    button(
      `Proposals & Commitments (${proposals.length + commitments.length})`,
      () => {
        context.tab = 'proposals';
        rerender();
      },
      {
        className: tab === 'proposals' ? 'nw-primary' : '',
        'aria-pressed': String(tab === 'proposals'),
      },
    ),
    button(
      `Cart (${cartTotals.itemCount})`,
      () => {
        context.tab = 'cart';
        rerender();
      },
      {
        className: tab === 'cart' ? 'nw-primary' : '',
        'aria-pressed': String(tab === 'cart'),
      },
    ),
    button(
      'New offer',
      () => {
        context.tab = 'create-offer';
        rerender();
      },
      {
        className: tab === 'create-offer' ? 'nw-primary' : '',
        'aria-pressed': String(tab === 'create-offer'),
      },
    ),
  );

  const head = node(
    'div',
    { className: 'nw-service-head nw-app-toolbar' },
    node(
      'div',
      { className: 'nw-head-row' },
      node('h1', { text: 'Market' }),
      tabsBar,
      node(
        'div',
        { className: 'nw-stat-pills' },
        node('span', {
          className: 'nw-pill',
          text: `${CANONICAL_PRODUCTS.length} Canonical Products`,
        }),
        node('span', {
          className: 'nw-pill',
          text: `${offers.length} Local Offers`,
        }),
        node('span', {
          className: 'nw-pill nw-pill-accent',
          text: `Cart: ${formatExactMoney(cartTotals.grandTotalMinor, 'USD')}`,
        }),
      ),
    ),
  );
  content.append(head);

  const bodyWrap = node('div', { className: 'nw-app-scroll-body' });
  content.append(bodyWrap);

  if (context.activeBomItem) {
    const banner = node(
      'div',
      { className: 'nw-handoff-banner' },
      node('strong', {
        text: `Sourcing BOM Item: "${context.activeBomItem.item}" (Est. ${formatExactMoney(context.activeBomItem.estimatedMinorUnits)})`,
      }),
      button(
        'Clear Sourcing Filter',
        () => {
          context.activeBomItem = null;
          context.activeProjectId = '';
          context.query = '';
          rerender();
        },
        { className: 'nw-small-btn' },
      ),
    );
    bodyWrap.append(banner);
  }

  // TAB 1: Universal Product Graph & Unified Product Page
  if (tab === 'products') {
    renderUniversalProductSection();
    return;
  }

  // TAB 2: Universal Multi-Merchant Cart
  if (tab === 'cart') {
    renderUniversalCartSection();
    return;
  }

  // TAB 3: Create Local Offer
  if (tab === 'create-offer') {
    renderCreateOfferSection();
    return;
  }

  // TAB 4: Proposals & Commitments
  if (tab === 'proposals') {
    renderProposalsSection();
    return;
  }

  // TAB 5: Local Service & Trade Offers
  if (tab === 'offers') {
    renderLocalOffersSection();
    return;
  }

  // --- SUBSECTION RENDERERS ---

  function renderUniversalProductSection() {
    const selectedProduct = CANONICAL_PRODUCTS.find(
      (p) => p.id === context.selectedProductId,
    );

    if (selectedProduct) {
      renderUnifiedProductPage(selectedProduct);
    } else {
      renderProductCatalogGrid();
    }
  }

  function renderProductCatalogGrid() {
    const searchIn = node('input', {
      type: 'search',
      placeholder: t('Search canonical products, GTIN, MPN, brand, specs…'),
      value: context.query || '',
      oninput: (e) => {
        context.query = e.target.value;
        rerender();
      },
    });
    const catFilterSelect = node(
      'select',
      {
        onchange: (e) => {
          context.category = e.target.value;
          rerender();
        },
      },
      ...CATEGORIES.map((c) =>
        node('option', {
          value: c.id,
          text: t(c.label),
          selected: c.id === categoryFilter,
        }),
      ),
    );

    const filterBar = node(
      'div',
      { className: 'nw-filter-bar' },
      searchIn,
      catFilterSelect,
    );
    bodyWrap.append(filterBar);

    const matchedProducts = searchProductGraph(searchQuery, categoryFilter);

    if (!matchedProducts.length) {
      bodyWrap.append(
        node(
          'article',
          { className: 'nw-service-card nw-empty-state' },
          node('h2', { text: 'No matching products in catalog' }),
          node('p', {
            className: 'nw-muted',
            text: 'Try searching by brand name, MPN, or clear your category filter.',
          }),
        ),
      );
      content.append(statusBar([`0 products found for "${context.query}"`]));
      return;
    }

    const grid = node('div', {
      className: 'nw-domain-grid nw-product-catalog-grid',
    });
    for (const prod of matchedProducts) {
      const allOffers = prod.offers || [];
      const ranked = rankOffers(allOffers, 'lowest_total');
      const lowestOffer = ranked[0];
      const lowestLanded = lowestOffer ? computeLandedCost(lowestOffer) : null;
      const localOfferCount = allOffers.filter(
        (o) => o.sellerType === 'local_store' || o.fulfillmentType === 'pickup',
      ).length;

      const card = node(
        'article',
        { className: 'nw-service-card nw-product-card' },
        node(
          'div',
          { className: 'nw-card-top' },
          node('span', { className: 'nw-badge', text: prod.brand }),
          node('span', {
            className: 'nw-muted nw-rating-tag',
            text: `★ ${prod.rating} (${prod.reviewCount})`,
          }),
        ),
        node('h2', { text: prod.title }),
        node('p', { className: 'nw-muted', text: prod.family }),
        node('p', { text: prod.description.slice(0, 130) + '…' }),
        node(
          'div',
          { className: 'nw-product-meta-row' },
          node('span', {
            className: 'nw-pill',
            text: `${prod.variants.length} variant(s)`,
          }),
          node('span', {
            className: 'nw-pill',
            text: `${allOffers.length} merchant offer(s)`,
          }),
          localOfferCount
            ? node('span', {
                className: 'nw-pill nw-pill-accent',
                text: `${localOfferCount} local pickup option(s)`,
              })
            : null,
        ),
        lowestLanded
          ? node(
              'div',
              { className: 'nw-landed-highlight' },
              node('span', {
                className: 'nw-muted',
                text: 'Verified Lowest Landed Total: ',
              }),
              node('strong', {
                className: 'nw-price-tag',
                text: formatExactMoney(
                  lowestLanded.totalLanded.amountMinorUnits,
                  'USD',
                ),
              }),
              node('span', {
                className: 'nw-muted',
                text: ` (${lowestOffer.deliveryLabel})`,
              }),
            )
          : null,
        node(
          'div',
          { className: 'nw-actions' },
          button(
            'Explore Buying Options',
            () => {
              context.selectedProductId = prod.id;
              context.selectedVariantId = prod.variants[0]?.id;
              context.selectedCondition = 'all';
              context.offerSort = 'lowest_total';
              context.representationMode = '3d';
              rerender();
            },
            { className: 'nw-primary' },
          ),
          button('Add to Project', () => {
            bus?.handoff({
              targetApp: 'projects',
              action: 'attach-offer',
              payload: {
                offerId: lowestOffer?.id || prod.id,
                offerTitle: `${prod.title} (${prod.variants[0]?.name})`,
                price: lowestOffer
                  ? lowestOffer.price
                  : { currency: 'USD', amountMinorUnits: 0 },
                providerName: lowestOffer?.sellerName || prod.brand,
                projectId: context.activeProjectId || null,
              },
            });
          }),
          button('Share in Social', () => {
            bus?.handoff({
              targetApp: 'social',
              action: 'share-object',
              payload: {
                sharedObjectId: prod.id,
                sharedObjectKind: 'market-product',
                title: prod.title,
              },
            });
          }),
        ),
      );
      grid.append(card);
    }
    bodyWrap.append(grid);
    content.append(
      statusBar([
        `${matchedProducts.length} Canonical Products indexed`,
        'Quanta Universal Product Graph (QUPG)',
        'MKT-INV-001 Compliant',
      ]),
    );
  }

  function renderUnifiedProductPage(product) {
    const activeVariantId =
      context.selectedVariantId || product.variants[0]?.id;
    const currentVariant =
      product.variants.find((v) => v.id === activeVariantId) ||
      product.variants[0];
    const conditionFilter = context.selectedCondition || 'all';
    const sortMode = context.offerSort || 'lowest_total';
    const repMode = context.representationMode || '3d';

    // Top Navigation / Back button
    const backNav = node(
      'div',
      { className: 'nw-product-back-nav' },
      button(
        '← Back to Catalog',
        () => {
          context.selectedProductId = null;
          rerender();
        },
        { className: 'nw-small-btn' },
      ),
      node('span', {
        className: 'nw-breadcrumb',
        text: `Catalog > ${product.brand} > ${product.family}`,
      }),
      node('code', { className: 'nw-qid', text: product.qid }),
    );
    bodyWrap.append(backNav);

    // Two-Column Layout: Left (3D Viewer / Spec Media), Right (Specs, Variants, Competing Offers)
    const productWorkspace = node('div', { className: 'nw-product-workspace' });

    // LEFT: Interactive 3D / Diagram / Media representation
    const mediaPane = node('div', { className: 'nw-product-media-pane' });
    const repTabs = node(
      'div',
      { className: 'nw-rep-tabs' },
      button(
        '3D Interactive View',
        () => {
          context.representationMode = '3d';
          rerender();
        },
        {
          className:
            repMode === '3d' ? 'nw-primary nw-small-btn' : 'nw-small-btn',
          'aria-pressed': String(repMode === '3d'),
        },
      ),
      button(
        'Technical Blueprint',
        () => {
          context.representationMode = 'diagram';
          rerender();
        },
        {
          className:
            repMode === 'diagram' ? 'nw-primary nw-small-btn' : 'nw-small-btn',
          'aria-pressed': String(repMode === 'diagram'),
        },
      ),
      button(
        'Photo & Clearance',
        () => {
          context.representationMode = 'photo';
          rerender();
        },
        {
          className:
            repMode === 'photo' ? 'nw-primary nw-small-btn' : 'nw-small-btn',
          'aria-pressed': String(repMode === 'photo'),
        },
      ),
    );
    mediaPane.append(repTabs);

    const viewerBox = node('div', { className: 'nw-3d-viewer-box' });
    const canvas = document.createElement('canvas');
    canvas.width = 380;
    canvas.height = 260;
    canvas.className = 'nw-interactive-3d-canvas';
    initInteractive3DViewer(canvas, product.id, repMode);
    viewerBox.append(canvas);

    const captionText =
      repMode === '3d'
        ? 'Interactive 3D Dimensional Model · Drag to orbit / inspect clearance'
        : repMode === 'diagram'
          ? 'Mechanical Schematic · Verified Tolerances & Mounting Interfaces'
          : 'High-Resolution Visual Verification & Packaging Context';
    viewerBox.append(
      node('p', { className: 'nw-viewer-caption', text: captionText }),
    );
    mediaPane.append(viewerBox);

    // Specifications Property Grid
    const specBox = node(
      'div',
      { className: 'nw-subpanel' },
      node('h3', { text: 'Technical Specifications' }),
      propertyGrid(product.specifications),
    );
    mediaPane.append(specBox);

    // Documentation list
    const docBox = node(
      'div',
      { className: 'nw-subpanel' },
      node('h3', { text: 'Manuals & Certified Documentation' }),
      ...product.documentation.map((doc) =>
        node('p', { className: 'nw-muted', text: `📄 ${doc}` }),
      ),
    );
    mediaPane.append(docBox);

    // Compatibility list
    const compBox = node(
      'div',
      { className: 'nw-subpanel' },
      node('h3', { text: 'Verified Compatibility & Fitment' }),
      ...product.compatibility.map((c) =>
        node('p', { className: 'nw-muted', text: `✓ ${c}` }),
      ),
    );
    mediaPane.append(compBox);

    productWorkspace.append(mediaPane);

    // RIGHT: Product Header, Variant Selector, Condition Filter, Competing Offers
    const detailPane = node('div', { className: 'nw-product-detail-pane' });

    const headerCard = node(
      'article',
      { className: 'nw-service-card' },
      node(
        'div',
        { className: 'nw-card-top' },
        node('span', { className: 'nw-badge', text: product.brand }),
        node('strong', {
          className: 'nw-rating-tag',
          text: `★ ${product.rating} / 5.0 (${product.reviewCount} reviews)`,
        }),
      ),
      node('h1', { text: product.title }),
      node('p', { className: 'nw-muted', text: product.description }),
    );
    detailPane.append(headerCard);

    // Variant Selector (MKT-INV-002: Distinct variants maintain their GTIN & MPN)
    const variantBox = node(
      'div',
      { className: 'nw-service-card nw-variant-selector-card' },
      node('h3', { text: 'Configuration / Product Variant' }),
      node(
        'div',
        { className: 'nw-variant-pills' },
        ...product.variants.map((v) =>
          button(
            v.name,
            () => {
              context.selectedVariantId = v.id;
              rerender();
            },
            {
              className:
                v.id === currentVariant.id
                  ? 'nw-primary nw-variant-btn'
                  : 'nw-variant-btn',
              'aria-pressed': String(v.id === currentVariant.id),
            },
          ),
        ),
      ),
      node(
        'div',
        { className: 'nw-variant-meta' },
        node('span', {
          className: 'nw-muted',
          text: `MPN: ${currentVariant.mpn}`,
        }),
        node('span', {
          className: 'nw-muted',
          text: ` · GTIN: ${currentVariant.gtin}`,
        }),
        node('p', { text: currentVariant.description }),
      ),
    );
    detailPane.append(variantBox);

    // Buying Options / Merchant Offers Comparison Section
    const allOffers = product.offers || [];
    const filteredOffers = rankOffers(
      allOffers,
      sortMode,
      currentVariant.id,
      conditionFilter,
    );

    const buyingSection = node(
      'div',
      { className: 'nw-buying-options-section' },
      node(
        'div',
        { className: 'nw-options-header' },
        node('h2', {
          text: `Buying Options (${filteredOffers.length} available)`,
        }),
        // Condition filter pills
        node(
          'div',
          { className: 'nw-condition-filter' },
          ...[
            ['all', 'All Conditions'],
            ['new', 'New'],
            ['refurbished', 'Refurbished'],
            ['used', 'Used'],
          ].map(([condId, label]) =>
            button(
              label,
              () => {
                context.selectedCondition = condId;
                rerender();
              },
              {
                className:
                  conditionFilter === condId
                    ? 'nw-small-btn nw-primary'
                    : 'nw-small-btn',
                'aria-pressed': String(conditionFilter === condId),
              },
            ),
          ),
        ),
        // Sort Dropdown
        node(
          'div',
          { className: 'nw-sort-control' },
          node('span', { className: 'nw-muted', text: 'Sort by: ' }),
          ...[
            ['lowest_total', 'Lowest Total'],
            ['fastest', 'Fastest'],
            ['closest', 'Closest'],
            ['best_warranty', 'Best Warranty'],
          ].map(([sortId, label]) =>
            button(
              label,
              () => {
                context.offerSort = sortId;
                rerender();
              },
              {
                className:
                  sortMode === sortId
                    ? 'nw-small-btn nw-tab-active'
                    : 'nw-small-btn',
                'aria-pressed': String(sortMode === sortId),
              },
            ),
          ),
        ),
      ),
    );

    if (!filteredOffers.length) {
      buyingSection.append(
        node(
          'div',
          { className: 'nw-subpanel nw-empty-state' },
          node('p', {
            className: 'nw-muted',
            text: 'No seller offers match the selected condition and variant. Try switching to "All Conditions".',
          }),
        ),
      );
    } else {
      const offersList = node('div', { className: 'nw-offers-list' });
      for (const off of filteredOffers) {
        const landed = computeLandedCost(off);
        const isLowest =
          filteredOffers[0]?.id === off.id && sortMode === 'lowest_total';

        const offerRow = node(
          'article',
          {
            className: `nw-service-card nw-offer-row ${isLowest ? 'nw-offer-row-lowest' : ''}`,
          },
          node(
            'div',
            { className: 'nw-offer-row-main' },
            node(
              'div',
              { className: 'nw-offer-seller-info' },
              node('strong', { text: off.sellerName }),
              node('span', { className: 'nw-badge', text: off.sellerBadge }),
              node('span', {
                className: `nw-badge nw-badge-${off.condition}`,
                text: off.conditionLabel,
              }),
            ),
            node(
              'div',
              { className: 'nw-offer-pricing' },
              node('strong', {
                className: 'nw-price-tag',
                text: formatExactMoney(
                  landed.totalLanded.amountMinorUnits,
                  'USD',
                ),
              }),
              node('span', {
                className: 'nw-muted nw-landed-breakdown',
                text: landed.breakdownText,
              }),
            ),
          ),
          node(
            'div',
            { className: 'nw-offer-fulfillment-info' },
            node('span', { className: 'nw-pill', text: off.deliveryLabel }),
            node('span', {
              className: 'nw-pill nw-pill-accent',
              text: off.purchasePath.replace('_', ' ').toUpperCase(),
            }),
            node('span', {
              className: 'nw-muted',
              text: `Warranty: ${off.warranty}`,
            }),
          ),
          node(
            'div',
            { className: 'nw-actions' },
            button(
              'Buy Now',
              async () => {
                show(
                  `Preparing ${off.purchasePath.replace('_', ' ')} for ${formatExactMoney(landed.totalLanded.amountMinorUnits, 'USD')}…`,
                );
                await commit({
                  op: 'executeCheckout',
                  payload: {
                    productId: product.id,
                    productTitle: product.title,
                    variantId: currentVariant.id,
                    offerId: off.id,
                    sellerName: off.sellerName,
                    price: off.price,
                    totalLandedMinorUnits: landed.totalLanded.amountMinorUnits,
                    currency: 'USD',
                    purchasePath: off.purchasePath,
                  },
                });
                show(
                  `Purchased ${product.title} from ${off.sellerName}. Receipt recorded.`,
                );
              },
              { disabled: busy || blocked, className: 'nw-primary' },
            ),
            button('+ Add to Cart', () => {
              addToUniversalCart(context, {
                product,
                variant: currentVariant,
                offer: off,
              });
              show(`Added ${currentVariant.name} (${off.sellerName}) to Cart.`);
              rerender();
            }),
            Array.isArray(off.coordinates)
              ? button('Fly to Store', () => {
                  bus?.selectObject(
                    {
                      id: off.id,
                      kind: 'market-offer',
                      title: `${off.sellerName} · ${product.title}`,
                      coordinates: off.coordinates,
                      sourceApp: 'marketplace',
                      payload: off,
                    },
                    { flyTo: true },
                  );
                })
              : null,
          ),
        );
        offersList.append(offerRow);
      }
      buyingSection.append(offersList);
    }
    detailPane.append(buyingSection);

    // Cross-App Integration Bar
    const crossActions = node(
      'div',
      { className: 'nw-actions nw-cross-app-bar' },
      button('Add to Project BOM', () => {
        bus?.handoff({
          targetApp: 'projects',
          action: 'attach-offer',
          payload: {
            offerId: filteredOffers[0]?.id || product.id,
            offerTitle: `${product.title} (${currentVariant.name})`,
            price: filteredOffers[0]?.price || {
              currency: 'USD',
              amountMinorUnits: 0,
            },
            providerName: filteredOffers[0]?.sellerName || product.brand,
            projectId: context.activeProjectId || null,
          },
        });
        show(`Handoff to Projects: Sourced ${product.title}`);
      }),
      button('Share in Social', () => {
        bus?.handoff({
          targetApp: 'social',
          action: 'share-object',
          payload: {
            sharedObjectId: product.id,
            sharedObjectKind: 'market-product',
            title: `${product.title} (${product.brand})`,
          },
        });
      }),
      button('Plan Installation with Agent', () => {
        bus?.handoff({
          targetApp: 'agent',
          action: 'prompt-with-context',
          payload: {
            prompt: `Source and install ${product.title} (${currentVariant.name}) for our neighborhood workspace`,
          },
        });
      }),
      button('Watch Price', () => {
        context.priceWatch = !context.priceWatch;
        show(
          context.priceWatch
            ? `Price watch active for ${product.title}`
            : `Price watch cleared.`,
        );
        rerender();
      }),
    );
    detailPane.append(crossActions);

    productWorkspace.append(detailPane);
    bodyWrap.append(productWorkspace);

    content.append(
      statusBar([
        `Product: ${product.title}`,
        `Variant: ${currentVariant.name}`,
        `${filteredOffers.length} Verified Seller Offers`,
        `Lowest Landed: ${filteredOffers[0] ? formatExactMoney(computeLandedCost(filteredOffers[0]).totalLanded.amountMinorUnits, 'USD') : 'N/A'}`,
      ]),
    );
  }

  function renderUniversalCartSection() {
    const items = cart.items || [];
    bodyWrap.append(
      node(
        'div',
        { className: 'nw-service-head nw-app-toolbar' },
        node('h2', {
          text: `Universal Multi-Merchant Cart (${items.length} items)`,
        }),
        button(
          '← Back to Products',
          () => {
            context.tab = 'products';
            rerender();
          },
          { className: 'nw-small-btn' },
        ),
      ),
    );

    if (!items.length) {
      bodyWrap.append(
        node(
          'article',
          { className: 'nw-service-card nw-empty-state' },
          node('h2', { text: 'Your Universal Cart is empty' }),
          node('p', {
            className: 'nw-muted',
            text: 'Browse products across verified sellers and add items to compare landed costs and check out.',
          }),
          button(
            'Browse Products',
            () => {
              context.tab = 'products';
              rerender();
            },
            { className: 'nw-primary' },
          ),
        ),
      );
      content.append(statusBar(['Universal Cart empty', '0 merchants']));
      return;
    }

    const cartGrid = node('div', { className: 'nw-cart-grid' });
    const itemsList = node('div', { className: 'nw-cart-items-column' });

    // Group items by merchant
    const merchantGroups = new Map();
    for (const item of items) {
      if (!merchantGroups.has(item.sellerName)) {
        merchantGroups.set(item.sellerName, []);
      }
      merchantGroups.get(item.sellerName).push(item);
    }

    for (const [merchantName, mItems] of merchantGroups) {
      const merchantCard = node(
        'article',
        { className: 'nw-service-card nw-merchant-cart-group' },
        node(
          'div',
          { className: 'nw-card-top' },
          node('strong', { text: merchantName }),
          node('span', {
            className: 'nw-badge',
            text:
              mItems[0]?.purchasePath?.replace('_', ' ').toUpperCase() ||
              'CHECKOUT',
          }),
        ),
      );

      for (const item of mItems) {
        const itemRow = node(
          'div',
          { className: 'nw-cart-item-row' },
          node(
            'div',
            { className: 'nw-cart-item-desc' },
            node('strong', { text: item.productTitle }),
            node('span', {
              className: 'nw-muted',
              text: ` · ${item.variantName} (${item.condition})`,
            }),
            node('p', { className: 'nw-muted', text: item.deliveryLabel }),
          ),
          node(
            'div',
            { className: 'nw-cart-item-actions' },
            node('span', { text: `Qty: ${item.quantity || 1}` }),
            node('strong', {
              className: 'nw-price-tag',
              text: formatExactMoney(
                (item.price?.amountMinorUnits || 0) * (item.quantity || 1),
                'USD',
              ),
            }),
            button(
              'Remove',
              () => {
                removeFromUniversalCart(context, item.id);
                rerender();
              },
              { className: 'nw-small-btn' },
            ),
          ),
        );
        merchantCard.append(itemRow);
      }
      itemsList.append(merchantCard);
    }
    cartGrid.append(itemsList);

    // Order Summary & Explicit Consent Gate (MKT-INV-016)
    const summaryCard = node(
      'article',
      { className: 'nw-service-card nw-cart-summary-card' },
      node('h3', { text: 'Landed Cost Summary' }),
      propertyGrid([
        ['Items Subtotal', formatExactMoney(cartTotals.itemTotalMinor, 'USD')],
        [
          'Shipping & Handling',
          formatExactMoney(cartTotals.shippingTotalMinor, 'USD'),
        ],
        [
          'Estimated Sales Tax',
          formatExactMoney(cartTotals.taxTotalMinor, 'USD'),
        ],
        [
          'Discounts & Rebates',
          cartTotals.discountTotalMinor
            ? `-${formatExactMoney(cartTotals.discountTotalMinor, 'USD')}`
            : '$0.00',
        ],
        ['Grand Total', formatExactMoney(cartTotals.grandTotalMinor, 'USD')],
      ]),
      node('p', {
        className: 'nw-muted',
        text: `Coordinating across ${cartTotals.merchantCount} distinct merchant(s). Each seller order is verified atomically.`,
      }),
    );

    const consentCheck = node('input', {
      type: 'checkbox',
      checked: Boolean(context.cartConsentApproved),
      onchange: (e) => {
        context.cartConsentApproved = e.target.checked;
      },
    });
    const consentLabel = node(
      'label',
      { className: 'nw-gate-check' },
      consentCheck,
      node('span', {
        text: `I review and authorize the total charge of ${formatExactMoney(cartTotals.grandTotalMinor, 'USD')} across ${cartTotals.merchantCount} seller(s).`,
      }),
    );
    summaryCard.append(consentLabel);

    summaryCard.append(
      node(
        'div',
        { className: 'nw-actions' },
        button(
          'Complete Multi-Merchant Checkout',
          async () => {
            if (!context.cartConsentApproved) {
              show(
                'Explicit authorization checkbox must be confirmed before spending.',
                true,
              );
              return;
            }
            show(
              `Executing atomic multi-merchant checkout for ${formatExactMoney(cartTotals.grandTotalMinor, 'USD')}…`,
            );
            await commit({
              op: 'executeCartCheckout',
              payload: {
                itemCount: cartTotals.itemCount,
                merchantCount: cartTotals.merchantCount,
                grandTotalMinor: cartTotals.grandTotalMinor,
                currency: 'USD',
                items: cart.items,
              },
            });
            context.cart = { items: [] };
            context.cartConsentApproved = false;
            show(
              'Multi-merchant checkout completed. Receipts minted in Quanta.',
            );
            context.tab = 'products';
            rerender();
          },
          { disabled: busy || blocked, className: 'nw-primary' },
        ),
        button('Clear Cart', () => {
          context.cart = { items: [] };
          rerender();
        }),
      ),
    );
    cartGrid.append(summaryCard);
    bodyWrap.append(cartGrid);

    content.append(
      statusBar([
        `Cart Total: ${formatExactMoney(cartTotals.grandTotalMinor, 'USD')}`,
        `${cartTotals.itemCount} items across ${cartTotals.merchantCount} merchants`,
        'Explicit Human Authorization Gate Active',
      ]),
    );
  }

  function renderCreateOfferSection() {
    const titleIn = node('input', {
      placeholder: t('e.g. Structural Timber & Hardware Package'),
    });
    const catSelect = node(
      'select',
      {},
      ...CATEGORIES.filter((c) => c.id !== 'all').map((c) =>
        node('option', { value: c.id, text: t(c.label) }),
      ),
    );
    const providerIn = node('input', {
      placeholder: t('e.g. Redwood Cooperative Mill'),
    });
    const skillsIn = node('input', {
      placeholder: t('e.g. Licensed C-10 · Heavy Timber · Same-day delivery'),
    });
    const priceIn = node('input', {
      placeholder: t('Exact USD amount (e.g. 480.00)'),
      value: '250.00',
    });
    const rateSelect = node(
      'select',
      {},
      ...RATE_BASES.map((r) => node('option', { value: r, text: r })),
    );
    const placeSelect = node(
      'select',
      {},
      node('option', { value: '', text: '— Optional Linked Place —' }),
      ...places.map((p) =>
        node('option', { value: p.id, text: p.payload.title }),
      ),
    );
    const descIn = node('textarea', {
      rows: 3,
      placeholder: t(
        'Describe scope, tools included, and availability in the neighborhood…',
      ),
    });

    const formCard = node(
      'article',
      { className: 'nw-service-card nw-form-card' },
      node('h2', { text: 'Publish Local Market Offer' }),
      node(
        'div',
        { className: 'nw-form-grid' },
        field('Offer Title', titleIn),
        field('Category', catSelect),
        field('Provider / Guild Name', providerIn),
        field('Credentials & Skills', skillsIn),
        field('Exact Price (USD)', priceIn),
        field('Rate Basis', rateSelect),
        field('Neighborhood Place', placeSelect),
      ),
      field('Detailed Scope & Terms', descIn),
      node(
        'div',
        { className: 'nw-actions' },
        button('Cancel', () => {
          context.tab = 'products';
          rerender();
        }),
        button(
          'Commit Offer to Quanta',
          async () => {
            const parsedMoney = parseExactMoneyInput(priceIn.value, 'USD');
            if (!parsedMoney) {
              show(
                'Enter a valid exact dollar amount (up to 2 decimal places).',
                true,
              );
              return;
            }
            const chosenPlace = places.find((p) => p.id === placeSelect.value);
            await commit({
              op: 'saveMarketOffer',
              payload: {
                title: titleIn.value.trim(),
                category: catSelect.value,
                providerName: providerIn.value.trim(),
                providerSkills: skillsIn.value.trim(),
                description: descIn.value.trim(),
                price: parsedMoney,
                rateBasis: rateSelect.value,
                status: 'available',
                placeId: chosenPlace ? chosenPlace.id : null,
                coordinates: chosenPlace?.payload?.coordinates || null,
                refs: chosenPlace ? [chosenPlace.id] : [],
              },
            });
            context.tab = 'offers';
          },
          { disabled: busy || blocked, className: 'nw-primary' },
        ),
      ),
    );
    bodyWrap.append(formCard);
    content.append(
      statusBar([
        `Offers: ${offers.length}`,
        `Committed: ${formatExactMoney(summary.totalCommittedMinorUnits || 0)}`,
      ]),
    );
  }

  function renderProposalsSection() {
    if (!proposals.length && !commitments.length) {
      bodyWrap.append(
        node(
          'article',
          { className: 'nw-service-card nw-empty-state' },
          node('h2', { text: 'No proposals or commitments' }),
          node('p', {
            className: 'nw-muted',
            text: 'Open an offer to draft a proposal. Review its scope and price before accepting a commitment.',
          }),
          button('Browse products', () => {
            context.tab = 'products';
            rerender();
          }),
        ),
      );
      return;
    }
    const list = node('div', { className: 'nw-domain-grid' });
    for (const cmt of commitments) {
      const c = cmt.payload;
      const card = node(
        'article',
        { className: 'nw-service-card' },
        node(
          'div',
          { className: 'nw-card-top' },
          node('span', {
            className: `nw-badge nw-badge-${c.status}`,
            text: `COMMITMENT · ${String(c.outcomeState || 'in_progress').toUpperCase()}`,
          }),
          node('strong', {
            className: 'nw-price-tag',
            text: formatExactMoney(c.agreedPrice),
          }),
        ),
        node('h2', { text: c.title }),
        propertyGrid([
          ['Counterparty', c.counterparty],
          [
            'Pinned revisions',
            `Proposal #${c.pinnedProposalRevision}${c.pinnedOfferRevision ? ` · Offer #${c.pinnedOfferRevision}` : ''}`,
            true,
          ],
          ['Receipt', c.effectReceipt, true],
        ]),
        c.scopeNote ? node('p', { text: c.scopeNote }) : null,
        c.verificationNote
          ? node('p', {
              className: 'nw-muted',
              text: `Verification Note: ${c.verificationNote} (${(c.verifiedEvidenceIds || []).length} evidence ref(s))`,
            })
          : null,
      );

      if (c.outcomeState !== 'verified_complete') {
        const evidenceOptions = [
          ...allItems.map((item) => ({
            id: item.id,
            label: `[${item.payload?.kind || 'record'}] ${item.payload?.title || item.id.slice(0, 10)}`,
          })),
          ...offers.map((o) => ({
            id: o.id,
            label: t('[Offer] {title}', {
              title: o.payload?.title || o.id.slice(0, 10),
            }),
          })),
        ];
        const evSelect = node(
          'select',
          {},
          node('option', {
            value: '',
            text: '— Select Verification Record / Document QID —',
          }),
          ...evidenceOptions.map((opt) =>
            node('option', { value: opt.id, text: opt.label }),
          ),
        );
        const noteIn = node('input', {
          placeholder: t('Inspection / verification note…'),
          value: c.verificationNote || 'Field inspection completed.',
        });
        card.append(
          node(
            'div',
            { className: 'nw-form-grid' },
            field('Verification Evidence / Record', evSelect),
            field('Outcome Note', noteIn),
          ),
          node(
            'div',
            { className: 'nw-actions' },
            c.outcomeState === 'in_progress'
              ? button(
                  'Report Completed (Unverified)',
                  () =>
                    commit({
                      op: 'verifyCommitmentOutcome',
                      commitmentId: cmt.id,
                      expectedRevision: cmt.revision,
                      outcomeState: 'reported_complete',
                      evidenceIds: evSelect.value ? [evSelect.value] : [],
                      verificationNote:
                        noteIn.value.trim() || 'Reported complete by party.',
                    }),
                  { disabled: busy || blocked },
                )
              : null,
            button(
              'Verify Outcome with Evidence',
              () => {
                if (!evSelect.value) {
                  show(
                    'Verified Outcome requires selecting an authoritative Quanta Record/Document/Evidence QID.',
                    true,
                  );
                  return;
                }
                return commit({
                  op: 'verifyCommitmentOutcome',
                  commitmentId: cmt.id,
                  expectedRevision: cmt.revision,
                  outcomeState: 'verified_complete',
                  evidenceIds: [evSelect.value],
                  verificationNote:
                    noteIn.value.trim() ||
                    'Verified complete with linked Quanta record.',
                });
              },
              { disabled: busy || blocked, className: 'nw-primary' },
            ),
          ),
        );
      }
      list.append(card);
    }

    for (const prop of proposals) {
      const p = prop.payload;
      const linkedOffer = offers.find((o) => o.id === p.offerId);
      const card = node(
        'article',
        { className: 'nw-service-card' },
        node(
          'div',
          { className: 'nw-card-top' },
          node('span', {
            className: `nw-badge nw-badge-${p.status}`,
            text: p.status.toUpperCase(),
          }),
          node('strong', {
            className: 'nw-price-tag',
            text: formatExactMoney(p.totalPrice),
          }),
        ),
        node('h2', { text: p.title }),
        node('p', {
          className: 'nw-muted',
          text: `Counterparty: ${p.counterparty} · Revision ${prop.revision}`,
        }),
        node('p', { text: p.scope }),
      );
      if (Array.isArray(p.deliverables) && p.deliverables.length) {
        const ul = node('ul', { className: 'nw-deliverable-list' });
        for (const d of p.deliverables) {
          ul.append(
            node('li', {
              text: `${d.title} — ${formatExactMoney(d.amountMinorUnits)}`,
            }),
          );
        }
        card.append(ul);
      }
      const actions = node('div', { className: 'nw-actions' });
      if (p.status === 'proposed') {
        actions.append(
          button(
            'Accept Terms & Mint Commitment',
            () =>
              commit({
                op: 'saveCommitment',
                proposalId: prop.id,
                expectedProposalRevision: prop.revision,
                expectedOfferRevision: linkedOffer
                  ? linkedOffer.revision
                  : null,
                projectId: p.projectId || null,
                termsAccepted: true,
                scopeNote: `Committed exact terms for ${p.title}`,
              }),
            { disabled: busy || blocked, className: 'nw-primary' },
          ),
        );
      }
      actions.append(
        button('Share in Social', () =>
          bus?.handoff({
            targetApp: 'social',
            action: 'share-object',
            payload: {
              sharedObjectId: prop.id,
              sharedObjectKind: 'proposal',
              title: p.title,
            },
          }),
        ),
      );
      card.append(actions);
      list.append(card);
    }
    bodyWrap.append(list);
    content.append(
      statusBar([
        `${proposals.length} Proposals`,
        `${commitments.length} Commitments`,
        `Verified: ${formatExactMoney(summary.totalVerifiedMinorUnits || 0)}`,
      ]),
    );
  }

  function renderLocalOffersSection() {
    const searchIn = node('input', {
      type: 'search',
      placeholder: t('Search trades, tools, lumber, providers…'),
      value: context.query || '',
      oninput: (e) => {
        context.query = e.target.value;
        rerender();
      },
    });
    const catFilterSelect = node(
      'select',
      {
        onchange: (e) => {
          context.category = e.target.value;
          rerender();
        },
      },
      ...CATEGORIES.map((c) =>
        node('option', {
          value: c.id,
          text: t(c.label),
          selected: c.id === categoryFilter,
        }),
      ),
    );

    const filterBar = node(
      'div',
      { className: 'nw-filter-bar' },
      searchIn,
      catFilterSelect,
    );
    bodyWrap.append(filterBar);

    const filteredOffers = offers.filter((o) => {
      const p = o.payload;
      if (categoryFilter !== 'all' && p.category !== categoryFilter)
        return false;
      if (context.placeFilter && p.placeId !== context.placeFilter)
        return false;
      if (!searchQuery) return true;
      const hay =
        `${p.title} ${p.providerName} ${p.providerSkills} ${p.description} ${p.category}`.toLowerCase();
      return hay.includes(searchQuery);
    });

    if (!filteredOffers.length) {
      bodyWrap.append(
        node(
          'article',
          { className: 'nw-service-card nw-empty-state' },
          node('h2', {
            text: offers.length ? 'No Matching Offers' : 'No offers',
          }),
          node('p', {
            className: 'nw-muted',
            text: offers.length
              ? 'Try clearing your search or category filter.'
              : 'Create an offer to list materials, equipment, or services. Availability is recorded by the owner.',
          }),
        ),
      );
      content.append(statusBar([`0 of ${offers.length} offers shown`]));
      return;
    }

    const grid = node('div', { className: 'nw-domain-grid' });
    for (const offer of filteredOffers) {
      const p = offer.payload;
      const isSelected = context.selectedOfferId === offer.id;
      const card = node(
        'article',
        {
          className: `nw-service-card nw-offer-card ${isSelected ? 'nw-card-selected' : ''}`,
        },
        node(
          'div',
          { className: 'nw-card-top' },
          node('span', { className: 'nw-badge', text: p.category }),
          node('strong', {
            className: 'nw-price-tag',
            text: `${formatExactMoney(p.price)} / ${p.rateBasis}`,
          }),
        ),
        node('h2', { text: p.title }),
        node('p', {
          className: 'nw-provider-line',
          text: `${p.providerName}${p.providerSkills ? ` · ${p.providerSkills}` : ''}`,
        }),
        node('p', { className: 'nw-muted', text: p.description }),
      );

      const actions = node(
        'div',
        { className: 'nw-actions' },
        button(
          'Draft Proposal',
          () => {
            context.selectedOfferId = offer.id;
            bus?.selectObject(
              {
                id: offer.id,
                kind: 'market-offer',
                title: p.title,
                coordinates: p.coordinates,
                placeId: p.placeId,
                sourceApp: 'marketplace',
                payload: p,
              },
              { flyTo: true },
            );
            rerender();
          },
          { className: 'nw-primary' },
        ),
        button('Add to project', () => {
          bus?.handoff({
            targetApp: 'projects',
            action: 'attach-offer',
            payload: {
              offerId: offer.id,
              offerTitle: p.title,
              price: p.price,
              providerName: p.providerName,
              projectId: context.activeProjectId || null,
            },
          });
        }),
        button('Share', () =>
          bus?.handoff({
            targetApp: 'social',
            action: 'share-object',
            payload: {
              sharedObjectId: offer.id,
              sharedObjectKind: 'market-offer',
              title: p.title,
            },
          }),
        ),
      );
      card.append(actions);

      if (isSelected) {
        const propProjectSelect = node(
          'select',
          {},
          node('option', { value: '', text: '— Optional Linked Project —' }),
          ...projects.map((prj) =>
            node('option', {
              value: prj.id,
              text: prj.payload.title,
              selected: prj.id === context.activeProjectId,
            }),
          ),
        );
        const scopeIn = node('input', {
          value: context.activeBomItem
            ? `Supply & execute "${context.activeBomItem.item}" per project specification`
            : `Standard neighborhood fulfillment for ${p.title}`,
        });
        const priceInput = node('input', {
          value: (p.price.amountMinorUnits / 100).toFixed(2),
        });

        const composer = node(
          'div',
          { className: 'nw-inline-composer' },
          node('h3', { text: `Create Proposal for ${p.providerName}` }),
          field('Link to Project', propProjectSelect),
          field('Deliverable Scope', scopeIn),
          field('Agreed Total (USD)', priceInput),
          node(
            'div',
            { className: 'nw-actions' },
            button(
              'Submit Binding Proposal',
              async () => {
                const money = parseExactMoneyInput(priceInput.value, 'USD');
                if (!money) {
                  show('Invalid exact dollar amount.', true);
                  return;
                }
                await commit({
                  op: 'saveProposal',
                  payload: {
                    title: t('{title} — Proposal', { title: p.title }),
                    offerId: offer.id,
                    projectId: propProjectSelect.value || null,
                    counterparty: p.providerName,
                    scope: scopeIn.value.trim(),
                    deliverables: [
                      {
                        title: scopeIn.value.trim() || p.title,
                        amountMinorUnits: money.amountMinorUnits,
                      },
                    ],
                    totalPrice: money,
                    status: 'accepted',
                    evidenceIds: [],
                  },
                });
                context.selectedOfferId = null;
                context.tab = 'proposals';
              },
              { disabled: busy || blocked, className: 'nw-primary' },
            ),
            button('Cancel', () => {
              context.selectedOfferId = null;
              rerender();
            }),
          ),
        );
        card.append(composer);
      }

      grid.append(card);
    }
    bodyWrap.append(grid);
    content.append(
      statusBar([
        `${filteredOffers.length} of ${offers.length} offers`,
        `Committed: ${formatExactMoney(summary.totalCommittedMinorUnits || 0)}`,
        `Verified: ${formatExactMoney(summary.totalVerifiedMinorUnits || 0)}`,
      ]),
    );
  }
}

/**
 * Interactive 3D Canvas Projection Renderer.
 * Draws an interactive, continuously orbiting 3D representation or technical blueprint.
 */
function initInteractive3DViewer(canvas, productId, mode = '3d') {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  let angleY = 0.5;
  let angleX = 0.3;
  let isDragging = false;
  let lastX = 0;
  let lastY = 0;
  let animId = null;

  canvas.addEventListener('mousedown', (e) => {
    isDragging = true;
    lastX = e.clientX;
    lastY = e.clientY;
  });
  window.addEventListener('mouseup', () => {
    isDragging = false;
  });
  canvas.addEventListener('mousemove', (e) => {
    if (!isDragging) return;
    const dx = e.clientX - lastX;
    const dy = e.clientY - lastY;
    lastX = e.clientX;
    lastY = e.clientY;
    angleY += dx * 0.01;
    angleX += dy * 0.01;
  });

  function renderFrame() {
    if (!canvas.isConnected) {
      if (animId) cancelAnimationFrame(animId);
      return;
    }

    if (!isDragging && mode === '3d') {
      angleY += 0.008;
    }

    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // Background gradient
    const bgGrad = ctx.createLinearGradient(0, 0, 0, canvas.height);
    bgGrad.addColorStop(0, '#101417');
    bgGrad.addColorStop(1, '#171c21');
    ctx.fillStyle = bgGrad;
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // Grid Floor
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.05)';
    ctx.lineWidth = 1;
    const cx = canvas.width / 2;
    const cy = canvas.height / 2 + 30;

    for (let i = -100; i <= 100; i += 25) {
      ctx.beginPath();
      ctx.moveTo(cx + i * Math.cos(angleY) * 0.8, cy + i * 0.3);
      ctx.lineTo(cx - i * Math.sin(angleY) * 0.8, cy + 50);
      ctx.stroke();
    }

    if (mode === 'diagram') {
      drawTechnicalBlueprint(ctx, canvas, productId);
    } else if (mode === 'photo') {
      drawPhotoRepresentation(ctx, canvas, productId);
    } else {
      draw3DGeometry(ctx, cx, cy - 20, angleX, angleY, productId);
    }

    animId = requestAnimationFrame(renderFrame);
  }

  animId = requestAnimationFrame(renderFrame);
}

function projectPoint(x, y, z, cx, cy, angleX, angleY) {
  // Rotate around Y
  const cosY = Math.cos(angleY);
  const sinY = Math.sin(angleY);
  const x1 = x * cosY - z * sinY;
  const z1 = x * sinY + z * cosY;

  // Rotate around X
  const cosX = Math.cos(angleX);
  const sinX = Math.sin(angleX);
  const y2 = y * cosX - z1 * sinX;
  const z2 = y * sinX + z1 * cosX;

  const fov = 350;
  const scale = fov / (fov + z2 + 100);
  return {
    x: cx + x1 * scale,
    y: cy + y2 * scale,
    depth: z2,
  };
}

function draw3DGeometry(ctx, cx, cy, angleX, angleY, productId) {
  ctx.save();

  // Model-specific wireframe meshes
  let vertices = [];
  let edges = [];

  if (productId.includes('dewalt') || productId.includes('drill')) {
    // Drill Body: Main housing + chuck cylinder + grip + battery base
    vertices = [
      // Motor housing cube
      [-30, -35, -20],
      [30, -35, -20],
      [30, -5, -20],
      [-30, -5, -20],
      [-30, -35, 20],
      [30, -35, 20],
      [30, -5, 20],
      [-30, -5, 20],
      // Chuck nose
      [30, -25, -12],
      [55, -25, -12],
      [55, -15, -12],
      [30, -15, -12],
      [30, -25, 12],
      [55, -25, 12],
      [55, -15, 12],
      [30, -15, 12],
      // Handle Grip
      [-10, -5, -12],
      [8, -5, -12],
      [8, 35, -12],
      [-10, 35, -12],
      [-10, -5, 12],
      [8, -5, 12],
      [8, 35, 12],
      [-10, 35, 12],
      // Battery Base Foot
      [-22, 35, -24],
      [20, 35, -24],
      [20, 52, -24],
      [-22, 52, -24],
      [-22, 35, 24],
      [20, 35, 24],
      [20, 52, 24],
      [-22, 52, 24],
    ];

    edges = [
      [0, 1],
      [1, 2],
      [2, 3],
      [3, 0],
      [4, 5],
      [5, 6],
      [6, 7],
      [7, 4],
      [0, 4],
      [1, 5],
      [2, 6],
      [3, 7],
      [8, 9],
      [9, 10],
      [10, 11],
      [11, 8],
      [12, 13],
      [13, 14],
      [14, 15],
      [15, 12],
      [8, 12],
      [9, 13],
      [10, 14],
      [11, 15],
      [16, 17],
      [17, 18],
      [18, 19],
      [19, 16],
      [20, 21],
      [21, 22],
      [22, 23],
      [23, 20],
      [16, 20],
      [17, 21],
      [18, 22],
      [19, 23],
      [24, 25],
      [25, 26],
      [26, 27],
      [27, 24],
      [28, 29],
      [29, 30],
      [30, 31],
      [31, 28],
      [24, 28],
      [25, 29],
      [26, 30],
      [27, 31],
    ];
  } else if (productId.includes('lumber')) {
    // 2x6 Timber dimensional beam
    vertices = [
      [-90, -12, -28],
      [90, -12, -28],
      [90, 12, -28],
      [-90, 12, -28],
      [-90, -12, 28],
      [90, -12, 28],
      [90, 12, 28],
      [-90, 12, 28],
    ];
    edges = [
      [0, 1],
      [1, 2],
      [2, 3],
      [3, 0],
      [4, 5],
      [5, 6],
      [6, 7],
      [7, 4],
      [0, 4],
      [1, 5],
      [2, 6],
      [3, 7],
    ];
  } else {
    // Subpanel / Equipment load center enclosure
    vertices = [
      [-40, -50, -18],
      [40, -50, -18],
      [40, 50, -18],
      [-40, 50, -18],
      [-40, -50, 18],
      [40, -50, 18],
      [40, 50, 18],
      [-40, 50, 18],
    ];
    edges = [
      [0, 1],
      [1, 2],
      [2, 3],
      [3, 0],
      [4, 5],
      [5, 6],
      [6, 7],
      [7, 4],
      [0, 4],
      [1, 5],
      [2, 6],
      [3, 7],
    ];
  }

  const projected = vertices.map((v) =>
    projectPoint(v[0], v[1], v[2], cx, cy, angleX, angleY),
  );

  // Stroke lines
  ctx.strokeStyle = '#f4b860';
  ctx.lineWidth = 1.6;
  ctx.shadowColor = 'rgba(244, 184, 96, 0.4)';
  ctx.shadowBlur = 6;

  for (const [i1, i2] of edges) {
    const p1 = projected[i1];
    const p2 = projected[i2];
    ctx.beginPath();
    ctx.moveTo(p1.x, p1.y);
    ctx.lineTo(p2.x, p2.y);
    ctx.stroke();
  }

  // Draw node points
  ctx.fillStyle = '#ffffff';
  for (const p of projected) {
    ctx.beginPath();
    ctx.arc(p.x, p.y, 2, 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.restore();
}

function drawTechnicalBlueprint(ctx, canvas, productId) {
  ctx.save();
  ctx.strokeStyle = 'rgba(89, 221, 208, 0.6)';
  ctx.fillStyle = 'rgba(89, 221, 208, 0.9)';
  ctx.lineWidth = 1.2;
  ctx.font = '10px monospace';

  const w = canvas.width;
  const h = canvas.height;

  // Blueprint outer boundary
  ctx.strokeRect(30, 25, w - 60, h - 50);

  // Crosshairs
  ctx.beginPath();
  ctx.moveTo(w / 2, 20);
  ctx.lineTo(w / 2, h - 20);
  ctx.moveTo(25, h / 2);
  ctx.lineTo(w - 25, h / 2);
  ctx.strokeStyle = 'rgba(89, 221, 208, 0.15)';
  ctx.stroke();

  // Dimension Callouts
  ctx.fillText('TITLE: CERTIFIED PRODUCT BLUEPRINT', 40, 45);
  ctx.fillText(`ID: ${productId.toUpperCase()}`, 40, 60);
  ctx.fillText('SCALE: 1:1 REVISED CAD MODEL', 40, 75);
  ctx.fillText('LENGTH: 6.37" (162 mm) [±0.05"]', 40, h - 50);
  ctx.fillText('TORQUE RATING: 904 IN-LBS MAX', 40, h - 38);

  ctx.restore();
}

function drawPhotoRepresentation(ctx, canvas, productId) {
  ctx.save();
  const cx = canvas.width / 2;
  const cy = canvas.height / 2;

  ctx.fillStyle = 'rgba(255, 255, 255, 0.08)';
  ctx.beginPath();
  ctx.arc(cx, cy, 75, 0, Math.PI * 2);
  ctx.fill();

  ctx.strokeStyle = '#f4b860';
  ctx.lineWidth = 2;
  ctx.strokeRect(cx - 50, cy - 40, 100, 80);

  ctx.fillStyle = '#ffffff';
  ctx.font = '11px sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('Photographic Preview', cx, cy - 5);
  ctx.fillStyle = '#94a3b8';
  ctx.font = '9px monospace';
  ctx.fillText('Verified Manufacturer Imagery', cx, cy + 12);

  ctx.restore();
}
