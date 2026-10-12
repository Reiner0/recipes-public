import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { parse } from 'yaml';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build, countTags, courses, parseDocument, parseRotation, recipeSchema, recipeSections, renderMarkdown, renderRecipe, rewriteLink, searchRecord, slugify, sourceUrl, timeRange, totalTime } from './build.mjs';
import { filterRecipes, searchMatch, searchRecipes, selectedTags, tagsUrl } from './public/app.js';

const recipe = {
  source: 'mains/test-dinner.md', course: 'mains', url: '/mains/test-dinner/',
  metadata: { title: 'Test Dinner', image: 'test-dinner.jpg', tags: ['weeknight', 'chicken'], prep_time: '10min', cook_time: '1h 15min', servings: 4, ingredients: ['Schema ingredient'], instructions: ['Schema step'], prep_time_iso: 'PT10M', cook_time_iso: 'PT1H15M' },
  body: '## Ingredients\n\n### For the sauce\n\n- 1 cup yogurt\n- [Tonkatsu](../basics/tonkatsu-sauce.md)\n\n## Instructions\n\n1. **Mix:** Stir it.\n\n2. Serve.\n\n## Notes\n\n**From frozen:** Thaw first.',
};

test('frontmatter parses YAML lists, CRLF, and body independently', () => {
  const result = parseDocument('---\r\ntitle: Dinner\r\ntags: [quick, chicken]\r\nservings: 4\r\n---\r\n## Ingredients\r\n\r\n- Yogurt');
  assert.equal(result.metadata.servings, 4);
  assert.deepEqual(result.metadata.tags, ['quick', 'chicken']);
  assert.match(result.body, /^## Ingredients/);
  assert.throws(() => parseDocument('No frontmatter'), /Missing YAML/);
  assert.throws(() => parseDocument('---\n- a\n---\nbody'), /Invalid YAML/);
  assert.throws(() => parseDocument('---\ntitle: a\ntitle: b\n---\nbody'), /unique/);
});

test('slug and URL mapping only publishes known courses and navigation pages', () => {
  assert.equal(slugify('Crème & Rice'), 'creme-rice');
  assert.equal(sourceUrl('mains/chicken-katsu.md'), '/mains/chicken-katsu/');
  assert.equal(sourceUrl('basics/tonkatsu-sauce.md'), '/basics/tonkatsu-sauce/');
  assert.equal(sourceUrl('weeknight-rotation.md'), '/rotation/');
  assert.equal(sourceUrl('index.md'), '/');
  assert.equal(sourceUrl('tags.md'), '/tags/');
  assert.throws(() => sourceUrl('../finances/private.md'), /Not a published recipe/);
  assert.throws(() => sourceUrl('constructor/private.md'), /Not a published recipe/);
  assert.throws(() => sourceUrl('mains/---.md'), /Not a published recipe/);
});

test('course publication allowlist matches the vault lint configuration', async () => {
  const lint = await readFile(new URL('../../scripts/vault-lint.py', import.meta.url), 'utf8');
  const values = [...lint.match(/RECIPE_COURSES = \{([^}]+)\}/)[1].matchAll(/"([a-z-]+)"/g)].map((match) => match[1]);
  assert.deepEqual(Object.keys(courses).sort(), values.sort());
});

test('links preserve query strings, fragments, and cross-course paths', () => {
  const cases = [
    ['mains/chicken-katsu.md', 'index.md', '/mains/chicken-katsu/'],
    ['tags.md?tag=quick&tag=chicken', 'index.md', '/tags/?tag=quick&tag=chicken'],
    ['tags.html?tag=weeknight', 'weeknight-rotation.md', '/tags/?tag=weeknight'],
    ['chicken-katsu.md#notes', 'mains/test-dinner.md', '/mains/chicken-katsu/#notes'],
    ['../basics/tonkatsu-sauce.md?tag=a#instructions', 'mains/test-dinner.md', '/basics/tonkatsu-sauce/?tag=a#instructions'],
    ['/mains/chicken-katsu.md?q=1#notes', 'index.md', '/mains/chicken-katsu/?q=1#notes'],
    ['../images/chicken-katsu.jpg', 'mains/test-dinner.md', '/images/chicken-katsu.jpg'],
    ['https://example.com/guide.md', 'index.md', 'https://example.com/guide.md'],
    ['#notes', 'mains/test-dinner.md', '#notes'],
  ];
  for (const [href, source, result] of cases) assert.equal(rewriteLink(href, source), result);
  assert.throws(() => rewriteLink('../../finances/private.md', recipe.source), /Not a published/);
});

test('Markdown keeps inline formatting, references, sections and callouts', () => {
  const html = renderRecipe(recipe);
  assert.match(html, /<strong>Mix:<\/strong>/);
  assert.match(html, /href="\/basics\/tonkatsu-sauce\/"/);
  assert.match(html, /id="for-the-sauce"/);
  assert.match(html, /class="callout"><strong>From frozen:/);
  assert.match(html, /data-save="ingredient-0"/);
  assert.equal((html.match(/class="step"/g) ?? []).length, 2);
  assert.match(html, />1 cup yogurt</);
  assert.match(html, /id="cook-mode"[^>]*hidden/);
  const sections = recipeSections('## Ingredients\n\n- [Sauce][s]\n\n## Instructions\n\n1. Eat.\n\n[s]: ../basics/tonkatsu-sauce.md');
  assert.match(renderMarkdown(sections.ingredients, recipe.source, 'ingredients'), /href="\/basics\/tonkatsu-sauce\/"/);
  assert.throws(() => renderMarkdown('[bad](javascript:alert)', recipe.source), /Unsafe link/);
});

test('nested step details keep bullets and do not become extra numbered steps', () => {
  const body = '1. Mix.\n   - Slowly.\n   - Gently.\n\n2. Bake.';
  const html = renderMarkdown(body, recipe.source, 'instructions');
  assert.equal((html.match(/class="step"/g) ?? []).length, 2);
  assert.match(html, /<ul>\n<li>Slowly\.<\/li>/);
});

test('duration totals handle hours, zero cook, ranges, and extra brine time', () => {
  assert.equal(totalTime('10min', '1h 15min'), '1h 25min');
  assert.equal(totalTime('5min', '0min'), '5min');
  assert.equal(totalTime('1h', '0min'), '1h');
  assert.equal(totalTime('15min', '60-75min'), '1h 15min–1h 30min');
  assert.equal(totalTime('30min (plus 12-18h brine time)', '3-4h'), '3h 30min–4h 30min (plus 12-18h brine time)');
  assert.deepEqual(timeRange('1h 15min'), { min: 75, max: 75 });
  assert.throws(() => timeRange('soon'), /Invalid recipe time/);
});

test('JSON-LD uses generated metadata, body remains the rendered source', () => {
  const schema = recipeSchema(recipe);
  assert.equal(schema['@type'], 'Recipe');
  assert.deepEqual(schema.image, ['https://recipes.leals.casa/images/test-dinner.jpg']);
  assert.deepEqual(schema.recipeIngredient, ['Schema ingredient']);
  assert.deepEqual(schema.recipeInstructions, [{ '@type': 'HowToStep', text: 'Schema step' }]);
  assert.equal(schema.prepTime, 'PT10M');
  assert.equal(schema.cookTime, 'PT1H15M');
  assert.equal(schema.recipeYield, '4');
  const html = renderRecipe(recipe);
  const visible = html.replace(/<script[\s\S]*?<\/script>/g, '');
  assert(!visible.includes('Schema ingredient'));
  assert(!visible.includes('Schema step'));
  assert.match(html, /property="og:image" content="https:\/\/recipes.leals.casa\/images\/test-dinner.jpg"/);
});

test('embedded structured data escapes a closing script in recipe metadata', () => {
  const html = renderRecipe({ ...recipe, metadata: { ...recipe.metadata, title: '</script><script>bad</script>' } });
  const script = html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)[1];
  assert.equal(JSON.parse(script).name, '</script><script>bad</script>');
  assert(!script.includes('<'));
});

test('search record uses body ingredient names, title, tags and course', () => {
  const record = searchRecord(recipe);
  assert.deepEqual(record.ingredients, ['1 cup yogurt', 'Tonkatsu']);
  assert.equal(record.title, 'Test Dinner');
  assert.equal(record.course, 'mains');
  assert.equal(record.courseTitle, 'Mains');
  assert(!record.ingredients.includes('Schema ingredient'));
  assert.deepEqual(searchRecipes([record], 'YOGURT chicken'), [record]);
  assert.deepEqual(searchRecipes([record], 'mains'), [record]);
  assert.deepEqual(searchRecipes([record], 'none'), []);
  assert.deepEqual(searchRecipes([record], '  '), []);
});

test('search ranks title prefix, word prefix, substring, tags, course, then ingredients', () => {
  const record = (title, extra = {}) => ({ title, tags: [], course: 'mains', courseTitle: 'Mains', ingredients: [], ...extra });
  const records = [
    record('Arroz Con Pollo', { ingredients: ['2 cups chicken broth'] }),
    record('Bowl', { course: 'chicken', courseTitle: 'Chicken' }),
    record('A tagged dinner', { tags: ['chicken'] }),
    record('A superchicken dinner'),
    record('Baked Chicken'),
    record('Chicken Zoodles'),
    record('Chicken Alfredo'),
    record('Unrelated'),
  ];
  const original = structuredClone(records);
  assert.deepEqual(searchRecipes(records, ' CHICK ').map(({ title }) => title), [
    'Chicken Alfredo', 'Chicken Zoodles', 'Baked Chicken', 'A superchicken dinner',
    'A tagged dinner', 'Bowl', 'Arroz Con Pollo',
  ]);
  assert.deepEqual(records, original);
  assert.deepEqual(searchMatch(records[0], 'chick'), { rank: 5, ingredient: '2 cups chicken broth' });
  for (const record of records.slice(1, 7)) assert.equal(searchMatch(record, 'chick').ingredient, undefined);
});

test('search caps alphabetical ties at eight and preserves AND matching across fields', () => {
  const records = Array.from({ length: 10 }, (_, i) => ({
    title: `Chicken ${String(9 - i).padStart(2, '0')}`, tags: ['quick'],
    course: 'mains', courseTitle: 'Mains', ingredients: ['1 cup yogurt'],
  }));
  assert.deepEqual(searchRecipes(records, 'chick').map(({ title }) => title),
    Array.from({ length: 8 }, (_, i) => `Chicken ${String(i).padStart(2, '0')}`));
  assert.equal(searchRecipes(records, 'chick yogurt quick').length, 8);
  assert.equal(searchMatch(records[0], 'chick yogurt').ingredient, undefined);
  assert.deepEqual(searchRecipes(records, 'chick missing'), []);
  assert.deepEqual(searchRecipes(records, ''), []);
  const punctuation = { ...records[0], title: 'Roast-chicken' };
  assert.equal(searchMatch(punctuation, 'chick').rank, 1);
});

test('rotation extracts dinner tables and preserves multiple dish links', () => {
  const body = '## Week A\n\n| Night | Dinner | Active time |\n|---|---|---|\n| Dinner 1 | [Chicken](mains/test-dinner.md) | 20 min |\n\n### Prep\n\n- [ ] Thaw.\n\n## Week B\n\n| Night | Dinner | Active time |\n|---|---|---|\n| Dinner 1 | [Chicken](mains/test-dinner.md) + [Sauce](basics/sauce.md) | 30 min |';
  const weeks = parseRotation(body);
  assert.equal(weeks.length, 2);
  assert.equal(weeks[0].dinners[0].night, 'Dinner 1');
  assert.equal(weeks[1].dinners[0].time, '30 min');
  const html = renderMarkdown(body, 'weeknight-rotation.md');
  assert.match(html, /class="table-scroll"/);
  assert.match(html, /data-save="task-0"/);
  assert(!html.includes('disabled'));
  assert.equal((html.match(/type="checkbox"/g) ?? []).length, 1);
  assert.match(html, /href="\/basics\/sauce\/"/);
});

test('tag counts deduplicate per recipe and sort by count then name', () => {
  assert.deepEqual(countTags([{ tags: ['quick', 'quick', 'chicken'] }, { tags: ['quick', 'asian'] }]), [
    { tag: 'quick', count: 2 }, { tag: 'asian', count: 1 }, { tag: 'chicken', count: 1 },
  ]);
});

test('tag filtering uses AND, supports deep links, clear, and preserves fragments', () => {
  const records = [{ tags: ['weeknight', 'quick'] }, { tags: ['quick'] }, { tags: ['dessert'] }];
  assert.deepEqual(filterRecipes(records, selectedTags('?tag=weeknight&tag=quick')), [records[0]]);
  assert.deepEqual(filterRecipes(records, new Set()), records);
  assert.deepEqual(filterRecipes(records, new Set(['unknown'])), []);
  assert.equal(tagsUrl('https://recipes.leals.casa/tags/?tag=old&sort=title#results', new Set(['quick', 'weeknight'])), 'https://recipes.leals.casa/tags/?sort=title&tag=quick&tag=weeknight#results');
  assert.equal(tagsUrl('https://recipes.leals.casa/tags/?tag=old', new Set()), 'https://recipes.leals.casa/tags/');
});

const luminance = (hex) => {
  const [r, g, b] = hex.match(/[a-f\d]{2}/gi).map((value) => parseInt(value, 16) / 255).map((value) => value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4);
  return .2126 * r + .7152 * g + .0722 * b;
};
const contrast = (a, b) => (Math.max(luminance(a), luminance(b)) + .05) / (Math.min(luminance(a), luminance(b)) + .05);

test('light and dark body, muted, link and chip colors meet 4.5:1 contrast', async () => {
  const css = (await readFile(new URL('./public/style.css', import.meta.url), 'utf8')).split('@media print')[0];
  for (const block of [...css.matchAll(/--background: (#[\da-f]+); --surface: (#[\da-f]+); --ink: (#[\da-f]+); --muted: (#[\da-f]+);\s*--accent: #[\da-f]+; --green: (#[\da-f]+); --line: #[\da-f]+;[\s\S]*?--link: (#[\da-f]+);/gi)]) {
    const [, background, surface, ...text] = block;
    for (const color of text) for (const base of [background, surface]) assert(contrast(color, base) >= 4.5, `${color} on ${base}: ${contrast(color, base).toFixed(2)}`);
  }
  assert.equal([...css.matchAll(/--background: (#[\da-f]+); --surface:/gi)].length, 2);
});

test('end-to-end build emits every real recipe, local links and images, and no vault data', async () => {
  const outputDir = await mkdtemp(path.join(tmpdir(), 'leals-recipes-test-'));
  const recipesDir = fileURLToPath(new URL('../', import.meta.url));
  try {
    const { recipes } = await build({ recipesDir, outputDir });
    const sources = [];
    for (const course of Object.keys(courses)) {
      let entries;
      try { entries = await readdir(path.join(recipesDir, course)); } catch (error) { if (error.code === 'ENOENT') continue; throw error; }
      sources.push(...entries.filter((name) => name.endsWith('.md') && !['CLAUDE.md', 'AGENTS.md'].includes(name)).map((name) => `${course}/${name}`));
    }
    assert.equal(recipes.length, sources.length);
    for (const source of sources) await stat(path.join(outputDir, sourceUrl(source), 'index.html'));
    const files = await readdir(outputDir, { recursive: true });
    const pages = files.filter((file) => file.endsWith('.html'));
    assert.equal(pages.length, sources.length + 4);
    for (const file of pages) {
      const html = await readFile(path.join(outputDir, file), 'utf8');
      assert(!/href="[^"\s]*\.md(?:[?#][^"]*)?"/.test(html), file);
      assert.match(html, /<main id="main"/);
      for (const [, image] of html.matchAll(/<img[^>]*src="([^"]+)"/g)) await stat(path.join(outputDir, decodeURIComponent(image)));
      for (const [, href] of html.matchAll(/href="(\/[^"?#]*)(?:[?#][^"]*)?"/g)) {
        await stat(path.join(outputDir, decodeURIComponent(href), href.endsWith('/') ? 'index.html' : ''));
      }
    }
    assert(!files.some((file) => /\.md$|_redirects|_layouts|CLAUDE|catalog|node_modules/.test(file)));
    const search = JSON.parse(await readFile(path.join(outputDir, 'search.json'), 'utf8'));
    assert.equal(search.length, sources.length);
    for (const record of search) {
      assert(record.ingredients.length > 0);
      assert(record.tags.length > 0);
      await stat(path.join(outputDir, record.image));
    }
    const rotation = await readFile(path.join(outputDir, 'rotation/index.html'), 'utf8');
    const home = await readFile(path.join(outputDir, 'index.html'), 'utf8');
    assert.match(home, /aria-labelledby="weeknight-rotation"/);
    assert.match(home, /<h2 id="weeknight-rotation">Weeknight rotation<\/h2>/);
    assert.match(home, /href="\/rotation\/">Rotation<\/a>/);
    assert.match(home, /<h3>Week A<\/h3>/);
    assert.match(home, /<h3>Week B<\/h3>/);
    assert.match(rotation, /<title>Weeknight rotation · Leal Family Recipes<\/title>/);
    assert.match(rotation, /<h1 id="weeknight-rotation">Weeknight rotation<\/h1>/);
    assert(!/This week's (?:dinners|rotation)/.test(home + rotation));
    assert(!/created:|modified:|layout:|review_by:/.test(rotation));
    assert.match(rotation, /href="\/tags\/\?tag=weeknight"/);
    for (const recipe of recipes) {
      const html = await readFile(path.join(outputDir, recipe.url, 'index.html'), 'utf8');
      assert.equal(JSON.parse(html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)[1]).name, recipe.metadata.title);
    }
  } finally { await rm(outputDir, { recursive: true, force: true }); }
});

test('Actions path checks gate each site and deploy both for dispatch, first push, or unavailable base', async () => {
  const workflow = parse(await readFile(new URL('../../.github/workflows/deploy-sites.yml', import.meta.url), 'utf8'));
  assert.deepEqual(workflow.permissions, { contents: 'read' });
  assert.deepEqual(workflow.on.push.branches, ['main']);
  const directory = await mkdtemp(path.join(tmpdir(), 'leals-workflow-test-'));
  const run = promisify(execFile);
  try {
    // This Git stub supplies isolated diff fixtures. It never accesses repository or network state.
    await writeFile(path.join(directory, 'git'), '#!/bin/bash\ncase "$1" in\ncat-file) exit "$BASE_STATUS";;\nfetch) exit "$FETCH_STATUS";;\ndiff) cat "$DIFF_FIXTURE";;\n*) exit 1;;\nesac\n', { mode: 0o755 });
    const cases = [
      { event: 'workflow_dispatch', paths: '', expected: [true, true] },
      { before: '0000000000000000000000000000000000000000', paths: '', expected: [true, true] },
      { before: '', paths: '', expected: [true, true] },
      { paths: 'recipes/mains/example.md', expected: [true, false] },
      { paths: 'recipes/site/build.mjs', expected: [true, false] },
      { paths: 'homeschool/playground/catalog.json', expected: [false, true] },
      { paths: 'homeschool/lessons/example.html', expected: [false, true] },
      { paths: 'homeschool/games/example/src/main.js', expected: [false, true] },
      { paths: 'recipes/images/example.jpg\nhomeschool/playground/wrangler.jsonc', expected: [true, true] },
      { paths: 'unrelated.txt', expected: [false, false] },
      { paths: 'unrelated.txt', base: 1, fetch: 1, expected: [true, true] },
      { paths: 'recipes/index.md', base: 1, fetch: 0, expected: [true, false] },
    ];
    for (const [index, [name, job]] of Object.entries(workflow.jobs).entries()) {
      assert.equal(job.concurrency.group, 'deploy-${{ github.job }}');
      assert.equal(job.concurrency['cancel-in-progress'], false);
      assert.equal(job.steps[0].with['fetch-depth'], 2);
      const script = job.steps.find((step) => step.id === 'changes').run.replaceAll('/tmp/', `${directory}/`);
      for (const scenario of cases) {
        const output = path.join(directory, 'output');
        const fixture = path.join(directory, 'diff');
        await writeFile(fixture, `${scenario.paths}\n`);
        await writeFile(output, '');
        await run('/bin/bash', ['-e', '-o', 'pipefail', '-c', script], { env: {
          PATH: `${directory}:/usr/bin:/bin`, EVENT: scenario.event ?? 'push', BEFORE: scenario.before ?? '1111111111111111111111111111111111111111', AFTER: '2222222222222222222222222222222222222222',
          BASE_STATUS: String(scenario.base ?? 0), FETCH_STATUS: String(scenario.fetch ?? 0), DIFF_FIXTURE: fixture, GITHUB_OUTPUT: output,
        } });
        assert.equal((await readFile(output, 'utf8')).trim(), `deploy=${scenario.expected[index]}`, `${name}: ${JSON.stringify(scenario)}`);
      }
      const setup = job.steps.find((step) => step.uses === 'actions/setup-node@v4');
      assert.equal(setup.with['node-version'], 24);
      assert.equal(setup.with['cache-dependency-path'], `${name === 'recipes' ? 'recipes/site' : 'homeschool/playground'}/package-lock.json`);
      assert.deepEqual(job.steps.filter((step) => step.run && step.id !== 'changes').map((step) => step.run), ['npm ci', 'npm run check', 'npm run build']);
      const deploy = job.steps.at(-1);
      assert.equal(deploy.uses, 'cloudflare/wrangler-action@v3');
      assert.equal(deploy.with.wranglerVersion, '4.149.0');
      assert(job.steps.slice(2).every((step) => step.if === "steps.changes.outputs.deploy == 'true'"));
    }
  } finally { await rm(directory, { recursive: true, force: true }); }
});
