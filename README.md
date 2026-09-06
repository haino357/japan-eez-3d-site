# 日本列島とEEZ・海底地形 3Dマップ

[![Deploy to GitHub Pages](https://github.com/haino357/japan-eez-3d-site/actions/workflows/deploy.yml/badge.svg)](https://github.com/haino357/japan-eez-3d-site/actions/workflows/deploy.yml)

日本列島周辺の陸上地形、海底地形、排他的経済水域（EEZ）を、ブラウザ上で立体的に閲覧できる3Dマップです。

**公開サイト:** [https://haino357.github.io/japan-eez-3d-site/](https://haino357.github.io/japan-eez-3d-site/)

## 主な機能

- ドラッグによる3D地形の回転
- スクロールまたはピンチによる拡大・縮小
- 地形の高さと深さを1〜100倍で強調
- 南側、真上、太平洋側の3方向から視点を切り替え
- EEZの海面・側面表示を切り替え
- 地形を選択して緯度、経度、標高または水深を表示
- EEZ外縁、海岸線、日韓共同開発区域を表示

## データソース

| データ | 出典 |
| --- | --- |
| 陸上・海底地形 | [NOAA ETOPO Global Relief Model](https://www.ncei.noaa.gov/products/etopo-global-relief-model) |
| 海域境界 | [Marine Regions](https://marineregions.org/) |
| 海岸線 | [Natural Earth](https://www.naturalearthdata.com/) |

地形は約8〜9 km格子へ加工して表示しています。EEZには境界未画定海域を含むため、表示は参考情報です。法的判断や航海には使用できません。

## 使用技術

- React 19 / TypeScript
- [Three.js](https://threejs.org/)
- [Vinext](https://github.com/cloudflare/vinext)
- Tailwind CSS 4
- GitHub Actions / GitHub Pages

## ローカルで実行する

Node.js 22.13.0以上が必要です。

```bash
git clone https://github.com/haino357/japan-eez-3d-site.git
cd japan-eez-3d-site
npm ci
npm run dev
```

開発サーバーが表示するURLをブラウザで開いてください。

## 静的サイトをビルドする

```bash
npm run build
```

静的ファイルは`dist/client`に出力されます。

## GitHub Pagesへの公開

`main`ブランチへpushすると、[Deploy to GitHub Pages](.github/workflows/deploy.yml)ワークフローが次の処理を自動実行します。

1. 依存関係をインストール
2. 静的サイトをビルド
3. GitHub Pages用の成果物を作成
4. 公開サイトへデプロイ

GitHubのActions画面から`workflow_dispatch`を使って手動実行することもできます。

## 主要な構成

```text
app/
  page.tsx             ページのエントリーポイント
  terrain-viewer.tsx   3D地形ビューア
  globals.css          画面全体のスタイル
public/
  japan-data.json      地形・境界・海岸線データ
.github/workflows/
  deploy.yml           GitHub Pages公開ワークフロー
```
