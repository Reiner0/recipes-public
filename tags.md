---
title: Browse by tag
tags: [recipe, reference, active]
created: 2026-10-11
modified: 2026-10-11
layout: default
---

# Browse by tag

Tap a tag to find recipes. Select more than one to show recipes with **all** selected tags.

[All recipes](index.md) · [Weeknight rotation](weeknight-rotation.md)

<style>
  #tag-browser button { min-height: 44px; padding: .45rem .8rem; border: 1px solid #81978b; border-radius: 1.5rem; background: #fff; color: #155b3b; font: inherit; cursor: pointer; }
  #tag-browser button[aria-pressed="true"] { background: #155b3b; color: #fff; border-color: #155b3b; }
  #tag-browser button:focus-visible, #tag-browser a:focus-visible { outline: 3px solid #155799; outline-offset: 3px; }
  #tag-chips { display: flex; flex-wrap: wrap; gap: .5rem; margin: 1rem 0; }
  #tag-browser button:disabled { opacity: .55; cursor: default; }
  #recipe-results { padding: 0; margin: 1rem 0; list-style: none; display: grid; gap: .75rem; }
  #recipe-results li { display: flex; align-items: center; gap: .85rem; padding: .75rem; border: 1px solid #dce5e0; border-radius: .4rem; }
  #recipe-results img { width: 64px; height: 64px; object-fit: cover; border-radius: .25rem; flex: none; }
  #recipe-results div { min-width: 0; overflow-wrap: anywhere; }
  #recipe-results a { font-weight: 600; }
  #recipe-results small { display: block; margin-top: .2rem; color: #52615b; }
</style>

<div id="tag-browser" hidden>
  <div id="tag-chips" role="group" aria-label="Filter recipes by tag"></div>
  <button id="clear-tags" type="button">Clear</button>
  <p id="recipe-status" role="status" aria-live="polite" aria-atomic="true"></p>
  <ul id="recipe-results" aria-label="Matching recipes"></ul>
</div>

<noscript>Enable JavaScript to filter by tag, or browse the <a href="{{ '/index.html' | relative_url }}">recipe index</a>.</noscript>

<script type="application/json" id="recipe-data">
[
{%- assign recipe_courses = 'mains,sides,desserts,soups-and-stews,basics,appetizers,breads' | split: ',' -%}
{%- assign first = true -%}
{%- for recipe_page in site.pages -%}
  {%- assign course = recipe_page.path | split: '/' | first -%}
  {%- if recipe_courses contains course and recipe_page.tags -%}
    {%- unless first -%},{%- endunless -%}
    {%- assign first = false -%}
    {
      "title": {{ recipe_page.title | jsonify }},
      "url": {{ recipe_page.url | relative_url | jsonify }},
      "tags": {{ recipe_page.tags | jsonify }},
      "prep_time": {{ recipe_page.prep_time | jsonify }},
      "cook_time": {{ recipe_page.cook_time | jsonify }},
      "image": {%- if recipe_page.image -%}{{ '/images/' | append: recipe_page.image | relative_url | jsonify }}{%- else -%}{{ nil | jsonify }}{%- endif -%}
    }
  {%- endif -%}
{%- endfor -%}
]
</script>

<script id="tag-browser-script">
'use strict';

const countTags = (recipes) => {
  const counts = new Map();
  recipes.forEach((recipe) => {
    new Set(recipe.tags).forEach((tag) => counts.set(tag, (counts.get(tag) || 0) + 1));
  });
  return Array.from(counts, ([tag, count]) => ({ tag, count }))
    .sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag));
};

const parseTags = (search) => new Set(new URLSearchParams(search).getAll('tag').filter(Boolean));

const filterRecipes = (recipes, selected) => recipes
  .filter((recipe) => Array.from(selected).every((tag) => recipe.tags.includes(tag)))
  .sort((a, b) => a.title.localeCompare(b.title));

const filterUrl = (href, selected) => {
  const url = new URL(href);
  url.searchParams.delete('tag');
  selected.forEach((tag) => url.searchParams.append('tag', tag));
  return url.href;
};

const resultStatus = (count, selected) => {
  const summary = count === 0 ? 'No recipes match.' : `${count} recipe${count === 1 ? '' : 's'}.`;
  return selected.size === 0 ? summary : `${summary} Selected tags: ${Array.from(selected).join(', ')}. Clear or tap a selected tag to remove it.`;
};

const mountTagBrowser = (doc, location, history) => {
  const recipes = JSON.parse(doc.getElementById('recipe-data').textContent);
  const selected = parseTags(location.search);
  const chips = doc.getElementById('tag-chips');
  const results = doc.getElementById('recipe-results');
  const status = doc.getElementById('recipe-status');
  const clear = doc.getElementById('clear-tags');
  const buttons = new Map();

  const render = () => {
    buttons.forEach((button, tag) => button.setAttribute('aria-pressed', String(selected.has(tag))));
    clear.disabled = selected.size === 0;
    const matching = filterRecipes(recipes, selected);
    results.replaceChildren();
    matching.forEach((recipe) => {
      const item = doc.createElement('li');
      if (recipe.image) {
        const image = doc.createElement('img');
        image.src = recipe.image;
        image.alt = '';
        image.width = 64;
        image.height = 64;
        image.loading = 'lazy';
        item.append(image);
      }
      const details = doc.createElement('div');
      const link = doc.createElement('a');
      link.href = recipe.url;
      link.textContent = recipe.title;
      const time = doc.createElement('small');
      time.textContent = `${recipe.prep_time || '—'} prep + ${recipe.cook_time || '—'} cook`;
      details.append(link, time);
      item.append(details);
      results.append(item);
    });
    status.textContent = resultStatus(matching.length, selected);
  };

  const update = () => {
    history.replaceState(null, '', filterUrl(location.href, selected));
    render();
  };

  countTags(recipes).forEach(({ tag, count }) => {
    const button = doc.createElement('button');
    button.type = 'button';
    button.textContent = `${tag} (${count})`;
    button.addEventListener('click', () => {
      if (selected.has(tag)) selected.delete(tag);
      else selected.add(tag);
      update();
    });
    buttons.set(tag, button);
    chips.append(button);
  });
  clear.addEventListener('click', () => {
    selected.clear();
    update();
  });
  render();
  doc.getElementById('tag-browser').hidden = false;
};

if (typeof document !== 'undefined') mountTagBrowser(document, window.location, window.history);
</script>
