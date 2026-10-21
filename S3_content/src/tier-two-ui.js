function node(tag, text, className) {
  const result = document.createElement(tag);
  if (text != null) result.textContent = text;
  if (className) result.className = className;
  return result;
}

export function createTierTwoUi({ getPresentation, resolve, preview, mapHost, status }) {
  let dialog = null, panel = null, signature = '', selected = null, identity = '';
  const closeDialog = () => { if (dialog) { dialog.close(); dialog.remove(); dialog = null; } };
  const closePanel = () => { panel?.remove(); panel = null; };
  const submit = async selection => {
    try { await resolve(selection); }
    catch (error) { status(error.message); }
    sync(true);
  };
  function sync(force = false) {
    const view = getPresentation();
    if (view?.id !== identity) { selected = null; identity = view?.id || ''; }
    const key = JSON.stringify(view);
    if (!force && key === signature) return;
    signature = key;
    closeDialog(); closePanel();
    if (!view) { selected = null; preview(null); return; }
    if (view.choices?.length || view.options?.length) {
      dialog = node('dialog', null, 'tier-two-dialog');
      dialog.setAttribute('aria-label', view.title);
      dialog.append(node('h2', view.title));
      if (view.message) dialog.append(node('p', view.message));
      for (const entry of view.choices || view.options || []) {
        const button = node('button', entry.label); button.type = 'button';
        button.disabled = Boolean(entry.disabled); if (entry.description) button.title = entry.description;
        button.onclick = () => void submit({ [view.choices ? 'choice' : 'option']: entry.key });
        dialog.append(button);
      }
      dialog.addEventListener('keydown', event => event.stopPropagation());
      dialog.addEventListener('cancel', event => { event.preventDefault(); void submit({ dismiss: true }); });
      document.body.append(dialog); dialog.showModal(); return;
    }
    panel = node('section', null, 'tier-two-target-panel');
    panel.setAttribute('aria-label', view.title);
    panel.append(node('h2', view.title), node('p', view.message || 'Pick target.'));
    for (const entry of view.gear || []) {
      const button = node('button', entry.label); button.type = 'button';
      button.onclick = () => void submit({ gearIndex: entry.gearIndex }); panel.append(button);
    }
    if (view.area) {
      const confirm = node('button', 'Confirm'); confirm.type = 'button'; confirm.disabled = !selected;
      confirm.onclick = () => { if (selected) void submit({ ...selected, confirmed: true }); };
      panel.append(confirm);
    }
    const cancel = node('button', 'Cancel'); cancel.type = 'button'; cancel.onclick = () => void submit({ dismiss: true });
    panel.append(cancel); mapHost.parentElement.append(panel);
    if (view.area && selected) preview({ ...selected, ...view.area });
  }
  function click(x, y, targetId = null) {
    const view = getPresentation();
    if (!view || view.choices?.length || view.options?.length) return false;
    if (view.area) { selected = { x, y }; preview({ x, y, ...view.area }); sync(true); }
    else void submit({ x, y, targetId });
    return true;
  }
  return { sync, click, close: () => { closeDialog(); closePanel(); preview(null); } };
}
