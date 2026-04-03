# Steam Image Exporter

Steam ストア公開で必要になりがちな画像セットを、1 枚のキーアートからまとめて生成するデスクトップアプリです。

入力画像を読み込み、必要に応じてロゴを重ね、Steam 向けの複数サイズを書き出します。ロゴ配置のテンプレート確認、注目点の指定、簡易プリフライトチェックにも対応しています。

## Features

- 1 枚のキーアートから Steam 用画像を一括生成
- `png` / `jpg` / `jpeg` / `webp` の入力に対応
- ロゴ画像のドラッグ&ドロップ対応
- ロゴ背景透過の自動処理
- テンプレートごとのロゴ配置プレビュー
- 画像クリックによる注目点の指定
- 出力前のプリフライトチェック
- GitHub Releases ベースの更新確認

## Use Case

- Steam ストア素材を都度リサイズするのが面倒
- ストア画像ごとにロゴ位置を何度も微調整したくない
- キーアートの見せたい位置をサイズごとにできるだけ揃えたい
- 公開前に必要な画像をまとめて吐き出したい

## How To Use

1. アプリを起動し、キーアートを読み込みます。
2. 必要ならロゴ画像を追加します。
3. プレビュー画像をクリックして注目点を設定します。
4. 出力モードを選びます。
5. 必要な Steam 出力サイズを選びます。
6. `Generate all Steam images` を押して出力先フォルダを選びます。

### Recommended Workflow

- 基本は `Fill (crop)` を使う
- ロゴ付きの見え方を先に `Template` タブで確認する
- 被写体やタイトルを中央に寄せたい場合は注目点を明示的に打つ
- 余白を残したい場合だけ `Fit` または `Fit Extend` を使う

### Export Modes

- `Fill (crop)`: 推奨。アスペクト比を合わせるためにトリミングします。
- `Fit (black)`: 全体を収め、余白は黒で埋めます。
- `Fit Extend (blur)`: 全体を収め、余白はぼかし背景で埋めます。

## Output Targets

デフォルトでは以下の Steam 向け画像を選択できます。

| Name | Size |
| --- | --- |
| `header_capsule` | `920x430` |
| `small_capsule` | `462x174` |
| `main_capsule` | `1232x706` |
| `vertical_capsule` | `748x896` |
| `screenshot` | `1920x1080` |
| `page_background` | `1438x810` |
| `library_capsule` | `600x900` |
| `library_hero` | `3840x1240` |
| `library_logo` | `1280x720` |
| `event_cover` | `800x450` |
| `event_header` | `1920x622` |
| `broadcast_side_panel` | `155x337` |
| `community_icon` | `184x184` |
| `client_image` | `16x16` |
| `client_icon` | `32x32` |

### Logo-Related Outputs

以下はロゴ画像があると効果を発揮する出力です。

- `header_capsule`
- `small_capsule`
- `main_capsule`
- `vertical_capsule`
- `library_capsule`
- `library_logo`

ロゴ対象では通常版に加えて、ロゴ付きの別ファイルも出力されます。

## Output Naming

出力は選択したフォルダ配下にタイムスタンプ付きの新規ディレクトリを作成して保存します。

```text
{input_name}_steam_{timestamp}/
```

ファイル名は以下の形式です。

```text
{name}_{width}x{height}.png
{name}_{width}x{height}_logo.png
```

## Template Presets

- `Balanced`: 中央寄せで安定した見え方
- `Impact`: ロゴを大きめに置いて強い印象にする
- `Compact`: ロゴを小さめにして背景を見せる
- `Cinematic`: 上寄せでシネマ風に見せる
- `Corner`: 右下寄せで控えめに配置する

## Notes

- 注目点を指定しない場合は中央基準で切り抜きます。
- ロゴ背景透過は単色背景に近いロゴで特に有効です。
- 出力はすべて `png` です。
- 出力先に書き込みできない場合はプリフライトで検出します。
- 更新情報は GitHub Releases API を使って取得します。
- 更新確認に失敗しても画像生成自体は使えます。

## Metadata

アプリのメタデータは `src/config/app-metadata.json` に集約しています。

主な設定項目:

- アプリ名
- バージョン
- 作者情報
- GitHub リポジトリ URL
- GitHub Releases API URL
- リリースページ URL

ビルド前には `npm run sync:metadata` が実行され、以下へ同期されます。

- `package.json`
- `package-lock.json`
- `src-tauri/tauri.conf.json`

## Development

### Requirements

- Node.js
- npm
- Rust
- Tauri のビルドに必要な各 OS の依存関係

### Local Run

```bash
npm install
npm run dev
```

### Lint

```bash
npm run lint
```

### Build

```bash
npm run build
npm run tauri build
```

## Release

GitHub Releases ベースでの配布を前提にしています。

1. `src/config/app-metadata.json` の `appVersion` を更新する
2. 必要なら作者リンクやリリース URL を更新する
3. `npm run lint`
4. `npm run build`
5. リリース用コミットとタグを push する
6. GitHub Releases を作成する

アプリ内では `Info` から作者情報やリリース情報を確認できます。新しいバージョンがある場合は `Info` ボタン横に `NEW` を表示します。

## Steam Workflow Memo

Steam 向け CI / SteamPipe 運用メモは [steam/README.md](./steam/README.md) にあります。
