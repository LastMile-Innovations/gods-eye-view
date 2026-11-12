import { t, msg } from '../i18n/index.js';
/**
 * NeighborOS Social, Communities & Direct Messages Application (`U17`).
 * Supports neighborhood channels, discussion threads, inline replies, and live
 * interactive Shared Object Cards for Projects, Marketplace Offers, Proposals, and Places.
 */
import { formatExactMoney } from './capabilityBus.js';
import { statusBar } from './ui.js';

const CHANNELS = [
  { id: 'all', label: msg('All Channels') },
  { id: 'projects', label: msg('#projects') },
  { id: 'marketplace', label: msg('#marketplace') },
  { id: 'mutual-aid', label: msg('#mutual-aid') },
  { id: 'general', label: msg('#general') },
  { id: 'direct', label: msg('Direct Messages') },
];

export function renderSocialMessagesApp({
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
}) {
  content.className = 'nd-app-body nw-domain-view nw-social-app';
  content.replaceChildren();

  const posts = domainNetwork?.socialPosts || [];
  const offers = domainNetwork?.offers || [];
  const projects = domainNetwork?.projects || [];
  const proposals = domainNetwork?.proposals || [];
  const records = snapshot?.items || [];

  const handoff = bus?.consumeHandoff('social');
  if (handoff && handoff.action === 'share-object') {
    context.sharedObjectId = handoff.payload?.sharedObjectId || '';
    context.sharedObjectKind = handoff.payload?.sharedObjectKind || 'record';
    context.sharedObjectTitle = handoff.payload?.title || '';
    context.composing = true;
  }

  const activeChannel = context.channel || 'all';
  const rerender = () =>
    renderSocialMessagesApp({
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
    });

  const resolveSharedObject = (id, kind) => {
    if (!id) return null;
    const offer = offers.find((o) => o.id === id);
    if (offer)
      return {
        id,
        kind: 'market-offer',
        title: offer.payload.title,
        subtitle: `${offer.payload.providerName} · ${formatExactMoney(offer.payload.price)}`,
        coordinates: offer.payload.coordinates,
        targetApp: 'marketplace',
      };
    const project = projects.find((p) => p.id === id);
    if (project)
      return {
        id,
        kind: 'project',
        title: project.payload.title,
        subtitle: t('Stage: {stage} · Budget {budget}', {
          stage: project.payload.stage.toUpperCase(),
          budget: formatExactMoney(project.payload.budget),
        }),
        coordinates: project.payload.coordinates,
        targetApp: 'projects',
      };
    const proposal = proposals.find((p) => p.id === id);
    if (proposal)
      return {
        id,
        kind: 'proposal',
        title: proposal.payload.title,
        subtitle: `${proposal.payload.counterparty} · ${formatExactMoney(proposal.payload.totalPrice)}`,
        coordinates: null,
        targetApp: 'marketplace',
      };
    const rec = records.find((r) => r.id === id);
    if (rec)
      return {
        id,
        kind: rec.payload.kind || kind || 'record',
        title: rec.payload.title,
        subtitle: rec.payload.description || rec.payload.kind,
        coordinates: rec.payload.coordinates,
        targetApp: 'records',
      };
    return {
      id,
      kind: kind || 'object',
      title: t('Linked object {id}…', { id: id.slice(0, 8) }),
      subtitle: t('Quanta native reference'),
      coordinates: null,
      targetApp: 'records',
    };
  };

  content.dataset.draftForm = `social:${context.tab || 'main'}:v1`;
  const head = node(
    'div',
    { className: 'nw-service-head nw-app-toolbar' },
    node(
      'div',
      { className: 'nw-head-row' },
      node('h1', { text: 'Messages' }),
      node('span', {
        className: 'nw-toolbar-summary',
        text: `${posts.length}`,
      }),
      button(
        context.composing ? 'Close draft' : 'New message',
        () => {
          context.composing = !context.composing;
          rerender();
        },
        { className: 'nw-primary' },
      ),
    ),
  );
  content.append(head);

  const channelSidebar = node(
    'aside',
    { className: 'nw-channel-sidebar nw-tabs' },
    ...CHANNELS.map((ch) => {
      const count =
        ch.id === 'all'
          ? posts.length
          : posts.filter((p) => p.payload.channel === ch.id).length;
      const btn = button(
        t(ch.label),
        () => {
          context.channel = ch.id;
          rerender();
        },
        {
          className: `nw-channel-btn ${activeChannel === ch.id ? 'nw-primary' : ''}`,
          'aria-pressed': String(activeChannel === ch.id),
        },
      );
      btn.dataset.count = String(count);
      return btn;
    }),
  );

  const mainPane = node('main', { className: 'nw-social-main' });
  const workspace = node(
    'div',
    { className: 'nw-social-workspace' },
    channelSidebar,
    mainPane,
  );
  content.append(workspace);

  if (context.composing) {
    const chSelect = node(
      'select',
      {},
      ...CHANNELS.filter((c) => c.id !== 'all').map((c) =>
        node('option', {
          value: c.id,
          text: t(c.label),
          selected:
            c.id === (activeChannel === 'all' ? 'projects' : activeChannel),
        }),
      ),
    );
    const authorIn = node('input', {
      placeholder: t('Your name or guild handle'),
      value: context.authorName || 'Neighbor Owner',
    });
    const titleIn = node('input', {
      placeholder: t('Thread subject…'),
      value: context.sharedObjectTitle
        ? `Discussion: ${context.sharedObjectTitle}`
        : '',
    });
    const bodyIn = node('textarea', {
      rows: 3,
      placeholder: t(
        'Share updates, coordinate tool deliveries, or invite collaborators…',
      ),
    });

    const allShareable = [
      ...projects.map((p) => ({
        id: p.id,
        kind: 'project',
        label: t('[Project] {title}', { title: p.payload.title }),
      })),
      ...offers.map((o) => ({
        id: o.id,
        kind: 'market-offer',
        label: t('[Market Offer] {title}', { title: o.payload.title }),
      })),
      ...records.map((r) => ({
        id: r.id,
        kind: r.payload.kind,
        label: `[${r.payload.kind}] ${r.payload.title}`,
      })),
    ];
    const sharedSelect = node(
      'select',
      {},
      node('option', { value: '', text: '— Optional Shared Object Card —' }),
      ...allShareable.map((item) =>
        node('option', {
          value: `${item.id}|${item.kind}`,
          text: item.label,
          selected: item.id === context.sharedObjectId,
        }),
      ),
    );

    const composerCard = node(
      'article',
      { className: 'nw-service-card nw-form-card' },
      node('h2', { text: 'Post to Neighborhood Channel' }),
      node(
        'div',
        { className: 'nw-form-grid' },
        field('Channel', chSelect),
        field('Author', authorIn),
        field('Title', titleIn),
        field('Attach Live Object Card', sharedSelect),
      ),
      field('Message Body', bodyIn),
      node(
        'div',
        { className: 'nw-actions' },
        button(
          'Publish Thread to Quanta',
          async () => {
            const [shId, shKind] = (sharedSelect.value || '').split('|');
            context.authorName = authorIn.value.trim() || 'Neighbor Owner';
            await commit({
              op: 'saveSocialPost',
              payload: {
                channel: chSelect.value,
                author: context.authorName,
                title: titleIn.value.trim(),
                body: bodyIn.value.trim(),
                sharedObjectId: shId || null,
                sharedObjectKind: shKind || null,
                replies: [],
                refs: shId ? [shId] : [],
              },
            });
            context.composing = false;
            context.sharedObjectId = '';
            context.sharedObjectTitle = '';
          },
          { disabled: busy || blocked, className: 'nw-primary' },
        ),
      ),
    );
    mainPane.append(composerCard);
  }

  const filtered = posts.filter((p) =>
    activeChannel === 'all' ? true : p.payload.channel === activeChannel,
  );

  if (!filtered.length) {
    mainPane.append(
      node(
        'article',
        { className: 'nw-service-card nw-empty-state' },
        node('h2', { text: 'No Threads in This Channel Yet' }),
        node('p', {
          className: 'nw-muted',
          text: 'Start a thread above or share any Project, Marketplace Offer, or Place card directly into Social.',
        }),
      ),
    );
    content.append(statusBar([`Channel: ${activeChannel}`, `0 threads`]));
    return;
  }

  const stack = node('div', { className: 'nw-domain-stack' });
  for (const post of filtered) {
    const p = post.payload;
    const shared = resolveSharedObject(p.sharedObjectId, p.sharedObjectKind);
    const card = node(
      'article',
      { className: 'nw-service-card nw-thread-card' },
      node(
        'div',
        { className: 'nw-card-top' },
        node('span', { className: 'nw-badge', text: `#${p.channel}` }),
        node('span', {
          className: 'nw-muted',
          text: `${p.author} · Rev ${post.revision} · ${(p.replies || []).length} replies`,
        }),
      ),
      node('h2', { text: p.title }),
      node('p', { text: p.body }),
    );

    if (shared) {
      const embed = node(
        'div',
        { className: 'nw-shared-object-card' },
        node(
          'div',
          {},
          node('span', {
            className: 'nw-badge nw-badge-accent',
            text: shared.kind.toUpperCase(),
          }),
          node('strong', { text: ` ${shared.title}` }),
          node('p', { className: 'nw-muted', text: shared.subtitle }),
        ),
        button(
          'Open Linked Object',
          () => {
            bus?.selectObject(
              {
                id: shared.id,
                kind: shared.kind,
                title: shared.title,
                coordinates: shared.coordinates,
                sourceApp: 'social',
              },
              { flyTo: true },
            );
            bus?.handoff({
              targetApp: shared.targetApp,
              action: 'inspect-object',
              payload: { id: shared.id },
            });
          },
          { className: 'nw-small-btn nw-primary' },
        ),
      );
      card.append(embed);
    }

    // Replies
    const repliesBox = node('div', { className: 'nw-replies-box' });
    for (const r of p.replies || []) {
      repliesBox.append(
        node(
          'div',
          { className: 'nw-reply-row' },
          node('strong', { text: `${r.author}: ` }),
          node('span', { text: r.body }),
        ),
      );
    }

    const replyIn = node('input', {
      placeholder: t('Write a reply to this thread…'),
    });
    const replyBar = node(
      'div',
      { className: 'nw-reply-bar' },
      replyIn,
      button(
        'Reply',
        async () => {
          const text = replyIn.value.trim();
          if (!text) return;
          const nextReplies = [
            ...(p.replies || []),
            {
              author: context.authorName || 'Neighbor Owner',
              body: text,
              createdAtMs: Date.now(),
            },
          ];
          await commit({
            op: 'saveSocialPost',
            id: post.id,
            expected: post.revision,
            payload: {
              channel: p.channel,
              author: p.author,
              title: p.title,
              body: p.body,
              sharedObjectId: p.sharedObjectId,
              sharedObjectKind: p.sharedObjectKind,
              replies: nextReplies,
              refs: p.refs || [],
            },
          });
        },
        { disabled: busy || blocked, className: 'nw-small-btn nw-primary' },
      ),
    );
    card.append(repliesBox, replyBar);
    stack.append(card);
  }
  mainPane.append(stack);
  content.append(
    statusBar([
      `Channel: ${activeChannel}`,
      `${filtered.length} of ${posts.length} threads`,
    ]),
  );
}
