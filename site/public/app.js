'use strict';

export const filterRecipes = (recipes, selected) => recipes.filter((recipe) => [...selected].every((tag) => recipe.tags.includes(tag)));
export const searchMatch = (recipe, query) => {
  const terms = query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
  if (!terms.length) return undefined;
  const title = recipe.title.toLocaleLowerCase();
  const ranks = terms.map((term) => {
    if (title.startsWith(term)) return 0;
    if (title.split(/[^\p{L}\p{N}]+/u).some((word) => word.startsWith(term))) return 1;
    if (title.includes(term)) return 2;
    if (recipe.tags.some((tag) => tag.toLocaleLowerCase().includes(term))) return 3;
    if ([recipe.course, recipe.courseTitle].some((course) => course.toLocaleLowerCase().includes(term))) return 4;
    if (recipe.ingredients.some((ingredient) => ingredient.toLocaleLowerCase().includes(term))) return 5;
    return 6;
  });
  const rank = Math.max(...ranks);
  if (rank === 6) return undefined;
  const ingredient = ranks.every((rank) => rank === 5)
    ? recipe.ingredients.find((ingredient) => terms.some((term) => ingredient.toLocaleLowerCase().includes(term)))
    : undefined;
  return { rank, ingredient };
};
export const searchRecipes = (recipes, query) => recipes
  .map((recipe) => ({ recipe, match: searchMatch(recipe, query) }))
  .filter(({ match }) => match)
  .sort((a, b) => a.match.rank - b.match.rank || a.recipe.title.localeCompare(b.recipe.title))
  .slice(0, 8)
  .map(({ recipe }) => recipe);
export const selectedTags = (search) => new Set(new URLSearchParams(search).getAll('tag').filter(Boolean));
export const tagsUrl = (href, selected) => {
  const url = new URL(href);
  url.searchParams.delete('tag');
  for (const tag of selected) url.searchParams.append('tag', tag);
  return url.href;
};

const mountSearch = () => {
  const input = document.getElementById('recipe-search');
  const list = document.getElementById('search-results');
  const status = document.getElementById('search-status');
  let data, matches = [], active = -1, revision = 0;
  const close = () => {
    revision++;
    list.hidden = true;
    input.setAttribute('aria-expanded', 'false');
    input.removeAttribute('aria-activedescendant');
    active = -1;
  };
  const select = (index) => {
    active = index;
    [...list.children].forEach((item, i) => item.setAttribute('aria-selected', String(i === active)));
    if (active >= 0) {
      input.setAttribute('aria-activedescendant', `search-option-${active}`);
      list.children[active].scrollIntoView({ block: 'nearest' });
    } else input.removeAttribute('aria-activedescendant');
  };
  const render = async () => {
    const version = ++revision;
    if (!input.value.trim()) { close(); return; }
    list.replaceChildren();
    matches = [];
    active = -1;
    input.removeAttribute('aria-activedescendant');
    try {
      data ??= fetch('/search.json').then((response) => { if (!response.ok) throw new Error('Search unavailable'); return response.json(); }).catch((error) => { data = undefined; throw error; });
      const recipes = await data;
      if (version !== revision) return;
      matches = searchRecipes(recipes, input.value);
      for (const [index, recipe] of matches.entries()) {
        const item = document.createElement('li');
        item.id = `search-option-${index}`;
        item.setAttribute('role', 'option');
        item.setAttribute('aria-selected', 'false');
        const link = document.createElement('a');
        link.href = recipe.url;
        link.tabIndex = -1;
        link.textContent = recipe.title;
        const ingredient = searchMatch(recipe, input.value).ingredient;
        if (ingredient) {
          const hint = document.createElement('small');
          hint.textContent = `ingredient: ${ingredient}`;
          link.append(hint);
        }
        const course = document.createElement('small');
        course.textContent = recipe.courseTitle;
        link.append(course);
        item.append(link);
        list.append(item);
      }
      status.textContent = matches.length ? `${matches.length} results. Use the arrow keys to choose a recipe.` : 'No recipes found.';
    } catch {
      if (version !== revision) return;
      status.textContent = 'Search is unavailable. Browse recipes below.';
    }
    if (!matches.length) {
      const item = document.createElement('li');
      item.className = 'search-message';
      item.setAttribute('role', 'presentation');
      item.textContent = status.textContent;
      list.append(item);
    }
    list.hidden = false;
    input.setAttribute('aria-expanded', 'true');
  };
  input.addEventListener('input', render);
  input.addEventListener('focus', () => { if (input.value.trim()) render(); });
  input.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' || event.key === 'Tab') { close(); return; }
    if (list.hidden || !matches.length) return;
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      select((active + (event.key === 'ArrowDown' ? 1 : active < 0 ? 0 : -1) + matches.length) % matches.length);
    } else if (event.key === 'Enter' && active >= 0) {
      event.preventDefault();
      window.location.assign(matches[active].url);
    }
  });
  document.addEventListener('click', (event) => { if (!event.target.closest('.search')) close(); });
};

const mountTags = () => {
  if (!document.getElementById('tag-browser')) return;
  const buttons = [...document.querySelectorAll('[data-tag]')];
  const cards = [...document.querySelectorAll('#recipe-results .recipe-card')];
  const clear = document.getElementById('clear-tags');
  let selected = selectedTags(location.search);
  const render = () => {
    let count = 0;
    for (const button of buttons) button.setAttribute('aria-pressed', String(selected.has(button.dataset.tag)));
    for (const card of cards) {
      card.hidden = !filterRecipes([{ tags: JSON.parse(card.dataset.tags) }], selected).length;
      if (!card.hidden) count++;
    }
    clear.disabled = selected.size === 0;
    document.getElementById('recipe-status').textContent = `${count ? `${count} recipe${count === 1 ? '' : 's'}.` : 'No recipes match.'}${selected.size ? ` Selected tags: ${[...selected].join(', ')}. Clear or tap a selected tag to remove it.` : ''}`;
  };
  const update = () => { history.replaceState(null, '', tagsUrl(location.href, selected)); render(); };
  for (const button of buttons) button.addEventListener('click', () => {
    const tag = button.dataset.tag;
    if (selected.has(tag)) selected.delete(tag); else selected.add(tag);
    update();
  });
  clear.addEventListener('click', () => { selected.clear(); update(); });
  window.addEventListener('popstate', () => { selected = selectedTags(location.search); render(); });
  render();
};

const mountCooking = () => {
  const scope = document.querySelector('[data-recipe], [data-storage]');
  if (!scope) return;
  const key = `casa-leal:${scope.dataset.recipe ?? scope.dataset.storage}`;
  let saved = {};
  try {
    const value = JSON.parse(localStorage.getItem(key));
    if (value && typeof value === 'object' && !Array.isArray(value)) saved = value;
  } catch { /* Cooking controls work even when storage is unavailable. */ }
  for (const input of scope.querySelectorAll('[data-save]')) {
    if (typeof saved[input.dataset.save] === 'boolean') input.checked = saved[input.dataset.save];
    input.addEventListener('change', () => {
      saved[input.dataset.save] = input.checked;
      try { localStorage.setItem(key, JSON.stringify(saved)); } catch { /* Keep the current page usable. */ }
    });
    input.parentElement.addEventListener('click', (event) => {
      if (event.target.closest('a, input')) return;
      input.checked = !input.checked;
      input.dispatchEvent(new Event('change'));
    });
  }
  const steps = [...scope.querySelectorAll('.step')];
  for (const step of steps) step.addEventListener('click', (event) => {
    if (event.target.closest('a')) return;
    const wasCurrent = step.classList.contains('current');
    for (const item of steps) {
      const current = item === step && !wasCurrent;
      item.classList.toggle('current', current);
      item.querySelector('.step-number').setAttribute('aria-pressed', String(current));
    }
  });
  document.getElementById('print-recipe')?.addEventListener('click', () => window.print());
  const button = document.getElementById('cook-mode');
  if (!button || !('wakeLock' in navigator)) return;
  button.hidden = false;
  let lock, wanted = false;
  const status = document.getElementById('cook-status');
  const request = async () => {
    try {
      const acquired = await navigator.wakeLock.request('screen');
      if (!wanted) { await acquired.release(); return; }
      lock = acquired;
      button.setAttribute('aria-pressed', 'true');
      button.textContent = 'Cook mode on';
      status.textContent = 'Screen will stay awake while this page is visible.';
      acquired.addEventListener('release', () => {
        if (lock !== acquired) return;
        lock = undefined;
        button.setAttribute('aria-pressed', 'false');
        button.textContent = 'Cook mode';
      });
    } catch {
      wanted = false;
      button.setAttribute('aria-pressed', 'false');
      button.textContent = 'Cook mode';
      status.textContent = 'The screen could not stay awake. You can keep cooking here.';
    }
  };
  button.addEventListener('click', async () => {
    wanted = !wanted;
    if (wanted) await request();
    else {
      await lock?.release();
      status.textContent = 'Cook mode off.';
    }
  });
  document.addEventListener('visibilitychange', () => { if (wanted && !lock && document.visibilityState === 'visible') request(); });
};

if (typeof document !== 'undefined') {
  mountSearch();
  mountTags();
  mountCooking();
}
