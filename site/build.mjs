import { readFile, writeFile, mkdir, rm, cp, readdir, stat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { parse } from 'yaml';
import { Marked, Renderer } from 'marked';

const root = fileURLToPath(new URL('.', import.meta.url));
const origin = 'https://recipes.leals.casa';
const favicon = `data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="14" fill="#FBF7F0"/><g fill="none" stroke="#C2562F" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"><path d="M16 29h32v16c0 7-6 10-16 10s-16-3-16-10Z"/><path d="M12 29h40M16 36H9m39 0h7M27 21c-7-7 7-7 0-14m10 14c-7-7 7-7 0-14"/></g></svg>')}`;
export const courses = Object.freeze({ mains: 'Mains', 'soups-and-stews': 'Soups & Stews', sides: 'Sides', desserts: 'Desserts', basics: 'Basics', appetizers: 'Appetizers', breads: 'Breads' });
const escape = (value) => String(value).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const json = (value) => JSON.stringify(value).replace(/</g, '\\u003c');
export const slugify = (value) => String(value).normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

export const parseDocument = (source) => {
  const match = source.replace(/^\uFEFF/, '').match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)([\s\S]*)$/);
  if (!match) throw new Error('Missing YAML frontmatter');
  const metadata = parse(match[1]);
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) throw new Error('Invalid YAML frontmatter');
  return { metadata, body: match[2].trim() };
};

export const sourceUrl = (source) => {
  if (source === 'index.md') return '/';
  if (source === 'tags.md' || source === 'tags.html') return '/tags/';
  if (source === 'weeknight-rotation.md') return '/rotation/';
  const match = source.match(/^([^/]+)\/([^/]+)\.md$/);
  if (!match || !Object.hasOwn(courses, match[1]) || !slugify(match[2])) throw new Error(`Not a published recipe: ${source}`);
  return `/${match[1]}/${slugify(match[2])}/`;
};

export const rewriteLink = (href, source) => {
  if (/^(?:[a-z][a-z\d+.-]*:|\/\/|#|\?)/i.test(href)) return href;
  const [, pathname, suffix] = href.match(/^([^?#]*)([\s\S]*)$/);
  const resolved = path.posix.normalize(pathname.startsWith('/') ? pathname.slice(1) : path.posix.join(path.posix.dirname(source), pathname));
  if (/\.md$/.test(pathname) || resolved === 'tags.html') return sourceUrl(resolved) + suffix;
  if (resolved.startsWith('images/')) return `/${resolved}${suffix}`;
  return href;
};

// Ranges retain both ends; totals do not imply a more precise time than the recipe.
export const timeRange = (value) => {
  const source = String(value).replace(/\s*\([^)]*\)\s*$/, '').trim();
  const pattern = /(\d+)(?:\s*[-–]\s*(\d+))?\s*(h(?:ours?)?|min(?:utes?)?|m)\b/gi;
  let min = 0, max = 0, found = false;
  for (const match of source.matchAll(pattern)) {
    const scale = match[3].toLowerCase().startsWith('h') ? 60 : 1;
    min += Number(match[1]) * scale;
    max += Number(match[2] ?? match[1]) * scale;
    found = true;
  }
  if (!found || source.replace(pattern, '').trim()) throw new Error(`Invalid recipe time: ${value}`);
  return { min, max };
};
const formatMinutes = (minutes) => `${minutes >= 60 ? `${Math.floor(minutes / 60)}h` : ''}${minutes >= 60 && minutes % 60 ? ' ' : ''}${minutes % 60 || minutes === 0 ? `${minutes % 60}min` : ''}`;
export const totalTime = (prep, cook) => {
  const a = timeRange(prep), b = timeRange(cook);
  const min = a.min + b.min, max = a.max + b.max;
  const total = min === max ? formatMinutes(min) : `${formatMinutes(min)}–${formatMinutes(max)}`;
  const annotations = [prep, cook].flatMap((value) => String(value).match(/\([^)]*\)/g) ?? []);
  return `${total}${annotations.length ? ` ${annotations.join(' ')}` : ''}`;
};
const isoTime = (value) => {
  const { min } = timeRange(value);
  return `PT${Math.floor(min / 60) ? `${Math.floor(min / 60)}H` : ''}${min % 60 || min === 0 ? `${min % 60}M` : ''}`;
};
const plainText = (markdown) => new Marked().parseInline(String(markdown)).replace(/<[^>]*>/g, '').replace(/&(?:amp|lt|gt|quot|#39);/g, (entity) => ({ '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'" })[entity]);

export const recipeSchema = (recipe) => {
  const meta = recipe.metadata;
  return {
    '@context': 'https://schema.org', '@type': 'Recipe', name: meta.title,
    image: [`${origin}/images/${encodeURIComponent(meta.image)}`],
    recipeIngredient: meta.ingredients.map(plainText),
    recipeInstructions: meta.instructions.map((text) => ({ '@type': 'HowToStep', text: plainText(text) })),
    prepTime: meta.prep_time_iso ?? isoTime(meta.prep_time), cookTime: meta.cook_time_iso ?? isoTime(meta.cook_time),
    recipeYield: String(meta.servings), keywords: meta.tags.join(', '),
  };
};

export const recipeSections = (body) => {
  const tokens = new Marked().lexer(body);
  const sections = { ingredients: [], instructions: [], other: [] };
  let current = 'other';
  for (const token of tokens) {
    if (token.type === 'heading' && token.depth === 2) {
      const name = token.text.toLowerCase();
      current = name === 'ingredients' || name === 'instructions' ? name : 'other';
      if (current !== 'other') continue;
    }
    if (token.type === 'heading' && token.depth === 1) continue;
    sections[current].push(token);
  }
  // Keep reference definitions available when rendering sections separately.
  for (const section of Object.values(sections)) section.links = tokens.links;
  return sections;
};
const bodyIngredients = (body) => {
  const items = [];
  const collect = (tokens) => {
    for (const token of tokens) {
      if (token.type === 'list') for (const item of token.items) {
        items.push(plainText(item.text));
        collect(item.tokens);
      }
    }
  };
  collect(recipeSections(body).ingredients);
  return items;
};
export const searchRecord = (recipe) => ({
  title: recipe.metadata.title, url: recipe.url, course: recipe.course, courseTitle: courses[recipe.course],
  tags: recipe.metadata.tags, ingredients: bodyIngredients(recipe.body),
  image: `/images/${encodeURIComponent(recipe.metadata.image)}`, prep_time: recipe.metadata.prep_time, cook_time: recipe.metadata.cook_time,
});
export const countTags = (recipes) => {
  const counts = new Map();
  for (const recipe of recipes) for (const tag of new Set(recipe.tags)) counts.set(tag, (counts.get(tag) ?? 0) + 1);
  return [...counts].map(([tag, count]) => ({ tag, count })).sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag));
};

export const parseRotation = (body) => {
  const weeks = [];
  let week;
  for (const token of new Marked().lexer(body)) {
    if (token.type === 'heading' && /^Week [AB]$/.test(token.text)) {
      week = { title: token.text, dinners: [] };
      weeks.push(week);
    } else if (week && token.type === 'table' && token.header[0]?.text === 'Night') {
      week.dinners = token.rows.map((row) => ({ night: row[0].text, dish: row[1].text, time: row[2].text }));
    }
  }
  return weeks;
};

export const renderMarkdown = (body, source, mode = 'body') => {
  const renderer = new Renderer();
  let ingredient = 0, step = 0, task = 0, listDepth = 0;
  const defaultItem = renderer.listitem;
  const defaultList = renderer.list;
  const defaultTable = renderer.table;
  // Marked inserts disabled task inputs before calling listitem; we provide saved controls.
  renderer.checkbox = () => '';
  renderer.link = function ({ href, title, tokens }) {
    if (/^\s*(?:javascript|data|vbscript):/i.test(href)) throw new Error('Unsafe link');
    return `<a href="${escape(rewriteLink(href, source))}"${title ? ` title="${escape(title)}"` : ''}>${this.parser.parseInline(tokens)}</a>`;
  };
  renderer.heading = function ({ tokens, depth, text }) { return `<h${depth} id="${slugify(text)}">${this.parser.parseInline(tokens)}</h${depth}>\n`; };
  renderer.paragraph = function ({ tokens }) {
    const callout = tokens[0]?.type === 'strong' && /:$/.test(tokens[0].text.trim());
    return `<p${callout && mode !== 'instructions' ? ' class="callout"' : ''}>${this.parser.parseInline(tokens)}</p>\n`;
  };
  renderer.table = function (token) { return `<div class="table-scroll" role="region" aria-label="Rotation table" tabindex="0">${defaultTable.call(this, token)}</div>`; };
  renderer.list = function (token) {
    listDepth++;
    try { return defaultList.call(this, token); }
    finally { listDepth--; }
  };
  renderer.listitem = function (item) {
    if (mode === 'ingredients' && listDepth === 1) {
      const index = ingredient++;
      return `<li class="ingredient"><input type="checkbox" data-save="ingredient-${index}" id="ingredient-${index}" aria-label="${escape(plainText(item.text))}"><div>${this.parser.parse(item.tokens)}</div></li>`;
    }
    if (mode === 'instructions' && listDepth === 1) {
      const index = ++step;
      return `<li class="step" data-step="${index}"><button type="button" class="step-number" aria-pressed="false" aria-label="Mark step ${index} as current">${index}</button><div>${this.parser.parse(item.tokens)}</div></li>`;
    }
    if (item.task) {
      const index = task++;
      return `<li class="task"><input type="checkbox" data-save="task-${index}" aria-label="${escape(plainText(item.text))}"${item.checked ? ' checked' : ''}><div>${this.parser.parse(item.tokens)}</div></li>`;
    }
    return defaultItem.call(this, item);
  };
  const marked = new Marked({ renderer });
  return typeof body === 'string' ? marked.parse(body) : marked.parser(body);
};
const tagLink = (tag) => `<a class="chip" href="/tags/?tag=${encodeURIComponent(tag)}">${escape(tag)}</a>`;
const image = (recipe, hero = false) => `<img class="${hero ? 'recipe-hero' : 'card-image'}" src="/images/${encodeURIComponent(recipe.metadata.image)}" alt="${escape(recipe.metadata.title)}" width="${hero ? 1200 : 600}" height="${hero ? 675 : 450}"${hero ? ' fetchpriority="high"' : ' loading="lazy"'}>`;
const card = (recipe) => `<article class="recipe-card" data-tags="${escape(json(recipe.metadata.tags))}"><a class="card-link" href="${recipe.url}">${image(recipe)}<div class="card-copy"><h3>${escape(recipe.metadata.title)}</h3><p class="time">${escape(recipe.metadata.prep_time)} prep + ${escape(recipe.metadata.cook_time)} cook</p></div></a><div class="card-tags">${recipe.metadata.tags.slice(0, 3).map(tagLink).join('')}</div></article>`;

const page = (title, body, { url = '/', description = 'Family favorites, everyday dinners, and a little something sweet. Cooked at home in Henderson.', photo, schema, pageClass = '' } = {}) => `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="theme-color" content="#FBF7F0"><title>${escape(title)} · Leal Family Recipes</title><meta name="description" content="${escape(description)}"><link rel="canonical" href="${origin}${url}"><meta property="og:type" content="${schema ? 'article' : 'website'}"><meta property="og:title" content="${escape(title)}"><meta property="og:description" content="${escape(description)}"><meta property="og:url" content="${origin}${url}">${photo ? `<meta property="og:image" content="${origin}/images/${encodeURIComponent(photo)}">` : ''}<link rel="icon" href="${escape(favicon)}" type="image/svg+xml"><link rel="stylesheet" href="/style.css"><script src="/app.js" type="module"></script>${schema ? `<script type="application/ld+json">${json(schema)}</script>` : ''}</head>
<body class="${pageClass}"><a class="skip-link" href="#main">Skip to content</a><header class="site-header"><div class="header-inner"><a class="brand" href="/"><span class="wordmark">Casa Leal</span><span>Leal Family Recipes</span></a><nav aria-label="Main navigation"><a href="/">Recipes</a><a href="/rotation/">Rotation</a><a href="/tags/">Browse tags</a></nav><div class="search"><label for="recipe-search">Find a recipe</label><input id="recipe-search" type="search" placeholder="Search recipes & ingredients" autocomplete="off" role="combobox" aria-autocomplete="list" aria-expanded="false" aria-controls="search-results"><ul id="search-results" role="listbox" aria-label="Recipe search results" hidden></ul><span id="search-status" class="sr-only" role="status"></span></div></div></header><main id="main" class="shell" tabindex="-1">${body}</main><footer class="shell"><span class="wordmark">Casa Leal</span><p>Cooked at home in Henderson.</p></footer></body></html>`;

export const renderRecipe = (recipe) => {
  const meta = recipe.metadata;
  const sections = recipeSections(recipe.body);
  const description = `${meta.title}. ${meta.prep_time} prep + ${meta.cook_time} cook. Serves ${meta.servings}.`;
  const body = `<article data-recipe="${recipe.url}"><nav class="breadcrumb" aria-label="Breadcrumb"><a href="/">Recipes</a><span aria-hidden="true">/</span><a href="/#${recipe.course}">${escape(courses[recipe.course])}</a></nav><header class="recipe-heading"><p class="eyebrow">From our family cookbook</p><h1>${escape(meta.title)}</h1><div class="chips">${meta.tags.map(tagLink).join('')}</div></header>${image(recipe, true)}<div class="recipe-bar"><dl class="meta-row">${[['Prep', meta.prep_time], ['Cook', meta.cook_time], ['Total', totalTime(meta.prep_time, meta.cook_time)], ['Servings', meta.servings]].map(([label, value]) => `<div><dt>${label}</dt><dd>${escape(value)}</dd></div>`).join('')}</dl><div class="actions"><button type="button" id="cook-mode" aria-pressed="false" hidden>Cook mode</button><button type="button" id="print-recipe">Print</button><span id="cook-status" class="sr-only" role="status"></span></div></div><div class="recipe-columns"><section class="ingredients" aria-labelledby="ingredients"><h2 id="ingredients">Ingredients</h2>${renderMarkdown(sections.ingredients, recipe.source, 'ingredients')}</section><section class="instructions" aria-labelledby="instructions"><h2 id="instructions">Instructions</h2><p class="step-hint">Tap a step to keep your place.</p>${renderMarkdown(sections.instructions, recipe.source, 'instructions')}</section></div><div class="recipe-notes prose">${renderMarkdown(sections.other, recipe.source)}</div></article>`;
  return page(meta.title, body, { url: recipe.url, photo: meta.image, description, schema: recipeSchema(recipe), pageClass: 'recipe-page' });
};

export const build = async ({ recipesDir = path.resolve(root, '..'), outputDir = path.join(root, 'dist') } = {}) => {
  const recipes = [];
  for (const course of Object.keys(courses)) {
    let entries;
    try { entries = await readdir(path.join(recipesDir, course), { withFileTypes: true }); }
    catch (error) { if (error.code === 'ENOENT') continue; throw error; }
    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith('.md') || entry.name === 'CLAUDE.md' || entry.name === 'AGENTS.md') continue;
      const source = `${course}/${entry.name}`;
      const recipe = { ...parseDocument(await readFile(path.join(recipesDir, source), 'utf8')), source, course, url: sourceUrl(source) };
      const meta = recipe.metadata;
      for (const key of ['title', 'image', 'prep_time', 'cook_time']) if (typeof meta[key] !== 'string' || !meta[key].trim()) throw new Error(`${source}: missing ${key}`);
      if (!/^[a-zA-Z0-9_-]+\.(?:jpg|jpeg|png|webp|avif|svg)$/i.test(meta.image)) throw new Error(`${source}: invalid image filename`);
      if (meta.servings === undefined || !['tags', 'ingredients', 'instructions'].every((key) => Array.isArray(meta[key]) && meta[key].every((item) => typeof item === 'string' && item.trim()))) throw new Error(`${source}: invalid recipe metadata`);
      timeRange(meta.prep_time); timeRange(meta.cook_time);
      await stat(path.join(recipesDir, 'images', meta.image));
      recipes.push(recipe);
    }
  }
  recipes.sort((a, b) => a.metadata.title.localeCompare(b.metadata.title));
  if (new Set(recipes.map((recipe) => recipe.url)).size !== recipes.length) throw new Error('Duplicate recipe URLs');
  const rotation = parseDocument(await readFile(path.join(recipesDir, 'weeknight-rotation.md'), 'utf8'));
  const weeks = parseRotation(rotation.body);
  if (weeks.length !== 2 || weeks.some((week) => week.dinners.length !== 4)) throw new Error('Rotation must have four dinners in Week A and Week B');
  const search = recipes.map(searchRecord);
  await rm(outputDir, { recursive: true, force: true });
  await mkdir(outputDir, { recursive: true });
  await cp(path.join(root, 'public'), outputDir, { recursive: true });
  await cp(path.join(recipesDir, 'images'), path.join(outputDir, 'images'), { recursive: true });
  const writePage = async (url, html) => {
    const file = path.join(outputDir, url === '/404.html' ? '404.html' : `${url.slice(1)}index.html`);
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, html);
  };
  for (const recipe of recipes) await writePage(recipe.url, renderRecipe(recipe));
  const dinners = weeks.map((week) => `<div><h3>${week.title}</h3><ol>${week.dinners.map((dinner) => `<li>${renderMarkdown(dinner.dish, 'weeknight-rotation.md')}</li>`).join('')}</ol></div>`).join('');
  const home = `<section class="home-intro"><p class="eyebrow">The family cookbook</p><h1>Good food. Right at home.</h1><p>Family favorites, everyday dinners, and a little something sweet.</p></section><section class="rotation-card" aria-labelledby="weeknight-rotation"><div class="section-heading"><div><p class="eyebrow">A little planning, a lot less wondering</p><h2 id="weeknight-rotation">Weeknight rotation</h2></div><a class="text-link" href="/rotation/">See the rotation →</a></div><div class="dinner-weeks">${dinners}</div></section><nav class="quick-tags chips" aria-label="Quick recipe filters">${['weeknight', 'quick', 'instant-pot', 'sous-vide', 'make-ahead', 'dessert'].map(tagLink).join('')}</nav>${Object.entries(courses).map(([course, title]) => { const group = recipes.filter((recipe) => recipe.course === course); return group.length ? `<section class="course-section" aria-labelledby="${course}"><div class="section-heading"><h2 id="${course}">${escape(title)}</h2><span class="muted">${group.length} recipes</span></div><div class="recipe-grid">${group.map(card).join('')}</div></section>` : ''; }).join('')}`;
  await writePage('/', page('Leal Family Recipes', home));
  await writePage('/rotation/', page('Weeknight rotation', `<article class="rotation prose" data-storage="rotation"><p class="eyebrow">The weeknight plan</p>${renderMarkdown(rotation.body.replace(/^# .+$/m, '# Weeknight rotation'), 'weeknight-rotation.md')}</article>`, { url: '/rotation/' }));
  const tags = `<section id="tag-browser"><p class="eyebrow">Find your next favorite</p><h1>Browse by tag</h1><p>Choose a tag. Choose a few to find recipes with <strong>all</strong> of them.</p><div id="tag-chips" class="chips" role="group" aria-label="Filter recipes by tag">${countTags(search).map(({ tag, count }) => `<button type="button" class="chip" data-tag="${escape(tag)}" aria-pressed="false">${escape(tag)} <span>${count}</span></button>`).join('')}</div><button id="clear-tags" type="button">Clear</button><p id="recipe-status" role="status" aria-live="polite" aria-atomic="true">${recipes.length} recipes.</p><div id="recipe-results" class="recipe-grid">${recipes.map(card).join('')}</div><noscript><p>Enable JavaScript to filter, or browse all the recipes below.</p></noscript></section>`;
  await writePage('/tags/', page('Browse by tag', tags, { url: '/tags/' }));
  await writePage('/404.html', page('Recipe not found', '<section class="not-found"><p class="eyebrow">A little off the menu</p><h1>That recipe isn’t here.</h1><p>Let’s find something good to cook.</p><a class="text-link" href="/">Back to the recipes →</a></section>', { url: '/404.html' }));
  await writeFile(path.join(outputDir, 'search.json'), json(search));
  return { recipes, outputDir };
};

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { recipes, outputDir } = await build();
  console.log(`Built ${recipes.length} recipes into ${outputDir}`);
}
