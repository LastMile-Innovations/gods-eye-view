/** Explicit textual-field boundary shared with native draft validation. Never include consent. */
export const DRAFT_FIELDS = new Set([
  'longitude',
  'latitude',
  'next-lifecycle-state',
  'dimension-integrity',
  'dimension-integrity-notes',
  'dimension-origin',
  'dimension-origin-notes',
  'dimension-time',
  'dimension-time-notes',
  'dimension-location',
  'dimension-location-notes',
  'dimension-content',
  'dimension-content-notes',
  'dimension-corroboration',
  'dimension-corroboration-notes',
  'title',
  'kind',
  'description',
  'project-title',
  'total-budget-usd',
  'initial-stage',
  'place-on-globe',
  'project-description',
  'milestones-one-per-line',
  'bill-of-materials-format-item-category-usd-amount',
  'natural-language-intent-prompt',
  'target-budget-envelope-usd',
  'anchor-place-on-globe',
  'offer-title',
  'category',
  'provider-guild-name',
  'credentials-skills',
  'exact-price-usd',
  'rate-basis',
  'neighborhood-place',
  'detailed-scope-terms',
  'verification-evidence-record',
  'outcome-note',
  'link-to-project',
  'deliverable-scope',
  'agreed-total-usd',
  'channel',
  'author',
  'attach-live-object-card',
  'message-body',
  'desk-name',
  'evidence-title',
  'origin-group',
  'asserted-time',
  'evidence-notes',
  'evidence-family',
  'source-type',
  'derived-from',
  'claim-text',
  'claim-rationale',
  'casebook-title',
  'casebook-description',
  'redaction-ranges',
  'derivative-title',
  'redaction-reason',
  'disclosure-title',
  'withdrawal-note',
  'review-note',
  'details',
]);
export const draftFieldKey = (label, control) => {
  if (
    ['file', 'password', 'checkbox', 'radio', 'hidden'].includes(
      control.type,
    ) ||
    control.readOnly
  )
    return null;
  const name =
    control.name ||
    String(label)
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '');
  return DRAFT_FIELDS.has(name) ? name : null;
};
export function captureFields(scope) {
  return Object.fromEntries(
    [...scope.querySelectorAll('[data-draft-key]')]
      .filter(
        (el) =>
          !el.readOnly &&
          !['file', 'password', 'checkbox', 'radio'].includes(el.type),
      )
      .map((el) => [el.dataset.draftKey, el.value]),
  );
}
export function restoreFields(scope, fields = {}) {
  for (const el of scope.querySelectorAll('[data-draft-key]')) {
    const value = fields[el.dataset.draftKey];
    if (
      typeof value === 'string' &&
      !el.readOnly &&
      !['file', 'password', 'checkbox', 'radio'].includes(el.type)
    ) {
      if (
        el.tagName !== 'SELECT' ||
        [...el.options].some((o) => o.value === value)
      )
        el.value = value;
    }
  }
}
