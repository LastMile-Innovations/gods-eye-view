import { t } from '../i18n/index.js';

/** Transient text conversation. Private native records are never attached implicitly. */
export function renderChatView({
  context,
  content,
  node,
  button,
  field,
  send,
  refresh,
  load,
}) {
  delete content.dataset.draftForm;
  const available =
    context.harness?.executionAvailability?.chat === 'configured_unverified';
  const pending = context.chatPending || context.harnessLoading;
  content.append(
    node('h1', { text: t('Chat') }),
    node('p', {
      className: 'nw-muted',
      text: t(
        'Only the text you send goes to the AI service. This conversation clears when you sign out or reload.',
      ),
    }),
  );
  if (!available) {
    content.append(
      node('p', { role: 'status', text: t('Chat is not available yet.') }),
      button(t('Refresh'), load, { disabled: pending }),
    );
    return;
  }
  const transcript = node('div', {
    className: 'nw-chat-transcript',
    'aria-live': 'polite',
    'aria-busy': String(Boolean(context.chatPending)),
  });
  for (const message of context.chatMessages || [])
    transcript.append(
      node(
        'article',
        { className: 'nw-service-card' },
        node('h2', {
          text: message.role === 'user' ? t('You') : t('AI response'),
        }),
        node('p', { className: 'nw-chat-text', text: message.content }),
      ),
    );
  content.append(transcript);
  if (context.chatError)
    content.append(node('p', { role: 'alert', text: context.chatError }));
  const input = node('textarea', {
    name: 'agent-chat-text',
    rows: 4,
    maxLength: 16000,
    value: context.chatInput || '',
    disabled: pending,
  });
  input.addEventListener('input', () => {
    context.chatInput = input.value;
  });
  content.append(
    field(t('Message'), input),
    node(
      'div',
      { className: 'nw-actions' },
      button(
        context.chatPending ? t('Waiting for a response…') : t('Send'),
        () => {
          if (input.value.trim()) return send(input.value);
        },
        { className: 'nw-primary', disabled: pending },
      ),
      button(
        t('Clear conversation'),
        () => {
          context.chatMessages = [];
          context.chatInput = '';
          context.chatError = undefined;
          refresh();
        },
        { disabled: pending },
      ),
    ),
  );
}
