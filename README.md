# Naoki Ise — Portfolio (Astro)

[info.naokiise.com](https://info.naokiise.com/) を再実装したAstroサイトです。

## 開発

```bash
npm install
npm run dev
```

http://localhost:4321 でプレビューできます。

## ビルド

```bash
npm run build
npm run preview
```

## GitHub Pages 公開

リポジトリ: [github.com/naokiise/info-naokiise](https://github.com/naokiise/info-naokiise)

```bash
npm run deploy
```

`main` にソースを push し、`npm run deploy` で `gh-pages` ブランチへビルド成果物を公開します。

- 公開 URL: https://naokiise.github.io/info-naokiise/
- カスタムドメイン `info.naokiise.com` を使う場合は `public/CNAME` を復元し、`astro.config.mjs` の `site` / `base` を調整

## 構成

- `src/pages/index.astro` — トップページ
- `src/data/site.json` — 作品・実績データ
- `src/components/` — UI コンポーネント
- `src/styles/global.css` — Notion 風スタイル

## データ更新

`src/data/site.json` を編集して保存すると、開発サーバーが自動で反映します。
