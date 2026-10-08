// Runs inside the radar dashboard's inline script, alongside its existing state and helpers.
export const SID_REVIEW_SCRIPT = String.raw`
const reviewState = { byId: new Map(), requestSeq: 0 };
function reviewPanel(f) {
  if (!state.privateUnlocked) return '';
  const record = reviewState.byId.get(f.id);
  const review = record?.review || null;
  const brief = record?.brief || null;
  const loading = !record;
  const decision = review?.decision || '';
  const options = ['Try', 'Bookmark', 'Dismiss'].map(value => '<option value="' + value + '"' + (decision === value ? ' selected' : '') + '>' + value + '</option>').join('');
  const linked = brief ? '<div class="hint">Experiment: ' + escapeHtml(brief.experiment.status) + (brief.experiment.result ? ' · ' + escapeHtml(brief.experiment.result) : '') + ' · <a href="/lab?brief=' + encodeURIComponent(brief.id) + '">Open in Community Lab</a> · <button type="button" class="inline-action" data-review-refresh>Refresh status</button></div>' : '';
  const create = review?.decision === 'Try' && !brief ? '<fieldset><legend>Private experiment</legend><p class="hint">Enter a real question and success criteria. Creating a draft does not run an experiment or publish it.</p><label>Question<textarea data-review-question required></textarea></label><label>Success criteria<textarea data-review-success required></textarea></label><button type="button" data-review-create>Create private experiment</button></fieldset>' : '';
  return '<div class="panel" id="sid-review-panel"><div class="panel-head">Owner review</div><div class="panel-body">' +
    (loading ? '<p>Loading saved review…</p>' : '<label>Decision<select data-review-decision><option value="">Choose a decision</option>' + options + '</select></label>' +
    '<label>Rationale<textarea data-review-rationale maxlength="8000">' + escapeHtml(review?.rationale || '') + '</textarea></label>' +
    '<label>Project slug (optional)<input data-review-project maxlength="100" pattern="[a-z0-9][a-z0-9-]{0,99}" value="' + escapeHtml(review?.projectSlug || '') + '"></label>' +
    '<button type="button" data-review-save>Save review</button><p data-review-status class="hint" role="status">' + (review ? 'Saved ' + escapeHtml(review.decision) + ' · ' + escapeHtml(new Date(review.updatedAt).toLocaleString()) : 'No saved decision.') + '</p>' + linked + create) + '</div></div>';
}
function bindReviewPanel(f) {
  const panel = document.getElementById('sid-review-panel');
  if (!panel || !reviewState.byId.has(f.id)) return;
  const pick = selector => panel.querySelector(selector);
  const decision = pick('[data-review-decision]');
  const rationale = pick('[data-review-rationale]');
  const project = pick('[data-review-project]');
  const status = pick('[data-review-status]');
  for (const field of [decision, rationale, project]) field.addEventListener('input', () => { status.textContent = 'Unsaved changes'; });
  pick('[data-review-save]').addEventListener('click', async () => {
    const selectedId = f.id;
    const previous = reviewState.byId.get(selectedId)?.review;
    const button = pick('[data-review-save]'); button.disabled = true;
    try {
      const response = await fetch('/api/lab/reviews/' + encodeURIComponent(selectedId), { method: 'PUT', credentials: 'same-origin', headers: { ...requestHeaders(), 'Content-Type': 'application/json' }, body: JSON.stringify({ decision: decision.value, rationale: rationale.value, projectSlug: project.value.trim() || null, expectedUpdatedAt: previous?.updatedAt || null }) });
      const data = await response.json();
      if (!response.ok) throw new Error(response.status === 409 ? 'Review changed elsewhere. Reload the finding before saving.' : data.error || 'Save failed');
      if (state.selectedId !== selectedId) return;
      reviewState.byId.set(selectedId, { ...reviewState.byId.get(selectedId), review: data.review });
      renderDetail();
    } catch (error) { if (state.selectedId === selectedId) status.textContent = error.message + ' Your edits remain here.'; }
    finally { button.disabled = false; }
  });
  const create = pick('[data-review-create]');
  const refresh = pick('[data-review-refresh]');
  if (refresh) refresh.addEventListener('click', () => loadReview(f.id));
  if (create) create.addEventListener('click', async () => {
    const selectedId = f.id;
    const question = pick('[data-review-question]').value.trim();
    const successCriteria = pick('[data-review-success]').value.trim();
    if (!question || !successCriteria) { status.textContent = 'Question and success criteria are required.'; return; }
    create.disabled = true;
    try {
      const response = await fetch('/api/lab/reviews/' + encodeURIComponent(selectedId) + '/experiment', { method: 'POST', credentials: 'same-origin', headers: { ...requestHeaders(), 'Content-Type': 'application/json' }, body: JSON.stringify({ question, successCriteria }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Experiment save failed');
      if (state.selectedId !== selectedId) return;
      await loadReview(selectedId);
    } catch (error) { if (state.selectedId === selectedId) status.textContent = error.message; }
    finally { create.disabled = false; }
  });
}
async function loadReview(id) {
  if (!state.privateUnlocked) return;
  const requestId = ++reviewState.requestSeq;
  reviewState.byId.delete(id);
  if (state.selectedId === id) renderDetail();
  try {
    const response = await fetch('/api/lab/reviews/' + encodeURIComponent(id), { credentials: 'same-origin', headers: requestHeaders() });
    const data = await response.json();
    if (requestId !== reviewState.requestSeq || state.selectedId !== id) return;
    if (!response.ok) throw new Error(data.error || 'Could not load review');
    reviewState.byId.set(id, data);
    renderDetail();
  } catch (error) {
    if (requestId !== reviewState.requestSeq || state.selectedId !== id) return;
    reviewState.byId.set(id, { review: null, brief: null });
    renderDetail();
    const panel = document.getElementById('sid-review-panel');
    if (panel) panel.querySelector('[data-review-status]').textContent = error.message + '. Reload before editing.';
    const save = panel?.querySelector('[data-review-save]'); if (save) save.disabled = true;
  }
}
`;
