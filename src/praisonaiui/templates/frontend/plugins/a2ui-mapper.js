/**
 * Plain-JS A2UI v0.9 → DOM mapper (dashboard fallback before JSON pre).
 */

function textFromNode(node) {
  if (!node || typeof node !== 'object') return '';
  const text = node.text;
  if (typeof text === 'string') return text;
  if (text && typeof text === 'object') {
    return String(text.literal ?? text.path ?? '');
  }
  return String(node.content ?? node.label ?? '');
}

function actionFromNode(node) {
  if (!node || typeof node !== 'object') return null;
  const action = node.action ?? node.onAction ?? node.event;
  if (!action) return null;
  if (typeof action === 'string') return { name: action };
  if (typeof action === 'object') return action;
  return null;
}

def renderMappedComponent(comp, surfaceId, onAction) {
  const type = comp.component;
  if (!type) return null;

  if (type === 'Column' || type === 'Row') {
    const el = document.createElement('div');
    el.className = 'db-a2ui-' + type.toLowerCase();
    el.style.display = 'flex';
    el.style.flexDirection = type === 'Column' ? 'column' : 'row';
    el.style.gap = '8px';
    const children = comp.children ?? comp.childComponents ?? [];
    let hasChild = false;
    for (const child of children) {
      const childEl = renderMappedComponent(child, surfaceId, onAction);
      if (childEl) {
        el.appendChild(childEl);
        hasChild = true;
      }
    }
    return hasChild ? el : null;
  }
  if (type === 'Card') {
    const el = document.createElement('div');
    el.className = 'db-a2ui-card db-card';
    el.style.padding = '12px';
    const title = textFromNode(comp);
    if (title) {
      const h = document.createElement('div');
      h.className = 'db-a2ui-text';
      h.style.fontWeight = '600';
      h.textContent = title;
      el.appendChild(h);
    }
    const children = comp.children ?? comp.childComponents ?? [];
    for (const child of children) {
      const childEl = renderMappedComponent(child, surfaceId, onAction);
      if (childEl) el.appendChild(childEl);
    }
    return el;
  }

  if (type === 'Text') {
    const el = document.createElement('p');
    el.className = 'db-a2ui-text';
    el.textContent = textFromNode(comp);
    return el;
  }
  if (type === 'Markdown') {
    const el = document.createElement('div');
    el.className = 'db-a2ui-markdown';
    el.textContent = textFromNode(comp);
    return el;
  }
  if (type === 'Divider') {
    const el = document.createElement('hr');
    el.className = 'db-a2ui-divider';
    return el;
  }
  if (type === 'Image') {
    const el = document.createElement('img');
    el.className = 'db-a2ui-image';
    const url = comp.url?.literal ?? comp.url;
    el.src = String(url ?? '');
    el.alt = textFromNode(comp);
    return el;
  }
  if (type === 'Button') {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'db-btn db-a2ui-button';
    btn.textContent = textFromNode(comp);
    const action = actionFromNode(comp);
    const componentId = comp.id ?? comp.componentId ?? null;
    if (action || componentId) {
      btn.addEventListener('click', () => {
        if (typeof onAction === 'function') {
          onAction({
            component_id: componentId,
            action: action?.name ?? action?.type ?? 'click',
            data: action?.payload ?? action ?? {},
          });
        }
      });
    }
    return btn;
  }
  return null;
}

/**
 * Map A2UI messages to a DOM fragment. Returns null if unmapped types present.
 */
export function a2uiMessagesToFragment(messages, surfaceId, onAction) {
  const wrap = document.createDocumentFragment();
  let sawMapped = false;

  for (const msg of messages || []) {
    const update = msg.updateComponents;
    const components = update?.components ?? update?.componentList;
    if (!Array.isArray(components)) continue;

    for (const comp of components) {
      const el = renderMappedComponent(comp, surfaceId, onAction);
      if (el) {
        wrap.appendChild(el);
        sawMapped = true;
      }
    }
  }

  if (!sawMapped) return null;
  return wrap;
}
