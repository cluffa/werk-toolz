# Werk Toolz

A tiny, static, spreadsheet-styled collection of copy/paste utility tools. No build step,
no backend — just open `index.html` or serve it with GitHub Pages.

## Tools

### Search String Builder

Enter values in the **Personal**, **Business**, and **Number** columns, one row per record.
For every Personal/Business value, three variants are generated:

- the plain digits (e.g. `123456789`)
- a `T`-prefixed version (e.g. `T123456789`)
- a bracketed, dash-formatted version, formatted the way each type is normally written
  (e.g. `{123-45-6789}` / `{12-3456789}`)

The **Number** column is included as typed, with no variants.

All non-empty variants across all rows are combined into a single `OR`-joined string,
ready to paste into a search box. An optional toggle wraps each term in quotes.

All data stays in the browser tab — nothing is saved to local storage or sent anywhere,
so refreshing the page clears the sheet.

## Running locally

Just open `index.html` in a browser, or serve the folder with any static file server:

```bash
python3 -m http.server 8000
```

## Deploying to GitHub Pages

This repo is plain static HTML/CSS/JS at the root, so GitHub Pages can serve it directly:

1. Go to **Settings → Pages** in this repository.
2. Under **Build and deployment**, set **Source** to "Deploy from a branch".
3. Choose the `main` branch (after this branch is merged) and the `/ (root)` folder.
4. Save — the site will be published at `https://<owner>.github.io/<repo>/`.
