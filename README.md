# Recipes

Personal recipe collection organized for easy discovery and meal planning.

## Organization

Recipes are organized by course type:

```
mains/          - Main dishes and entrees
sides/          - Side dishes and accompaniments
desserts/       - Desserts and sweet treats
appetizers/     - Appetizers and starters
soups-and-stews/- Soups and stews
breads/         - Breads and baked goods
basics/         - Sauces, stocks, and foundational recipes
```

## Recipe Format

Each recipe includes:
- **Frontmatter metadata**: tags, prep/cook time, servings
- **Ingredients**: with both volume and weight measurements
- **Instructions**: step-by-step with technique explanations
- **Notes**: make-ahead tips, substitutions, and common pitfalls

Example frontmatter:
```yaml
---
title: Recipe Name
tags: [christmas, main, smoker]
prep_time: 20min
cook_time: 4h
servings: 8-10
---
```

## Finding Recipes

**By occasion:**
- Christmas: `grep -l "christmas" */*.md`
- Thanksgiving: `grep -l "thanksgiving" */*.md`

**By cooking method:**
- Smoker recipes: `grep -l "smoker" */*.md`
- Instant Pot: `grep -l "instant-pot" */*.md`
- Quick recipes: `grep -l "quick" */*.md`

**By category:**
- Pasta dishes: `grep -l "pasta" */*.md`
- Make-ahead: `grep -l "make-ahead" */*.md`

**Browse all:**
```bash
ls */*.md
```
