# Naoki Ise — Portfolio (Astro)

[naokiise.com/info](https://naokiise.com/info) 向けの Astro サイトです。

## 開発

```bash
npm install
npm run dev
```

http://localhost:4321/info/ でプレビューできます。

## ビルド

```bash
npm run build
npm run preview
```

## 公開

リポジトリ: [github.com/naokiise/info-naokiise](https://github.com/naokiise/info-naokiise)

```bash
npm run deploy
```

`npm run deploy` は `dist/info/` を [naokiise.github.io](https://github.com/naokiise/naokiise.github.io) の `info/` に push し、https://naokiise.com/info/ で公開します。

## 構成

- `src/pages/index.astro` — トップページ
- `src/data/works.md` — 作品・実績データ
- `src/components/` — UI コンポーネント
- `src/styles/global.css` — スタイル

## データ更新

`src/data/works.md` を編集して保存すると、開発サーバーが自動で反映します。
各作品の追加・編集・削除は基本的に `src/data/works.md` で行います。
