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

## How To Use

1. アプリを起動し、キーアートを読み込みます。
2. 必要ならロゴ画像を追加します。
3. プレビュー画像をクリックして注目点を設定します。
4. 出力モードを選びます。
5. 必要な Steam 出力サイズを選びます。
6. `Generate all Steam images` を押して出力先フォルダを選びます。

## Export Modes

- `Fill (crop)`: 推奨。アスペクト比を合わせるためにトリミングします。
- `Fit (black)`: 全体を収め、余白は黒で埋めます。
- `Fit Extend (blur)`: 全体を収め、余白はぼかし背景で埋めます。

## Output Targets

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

ロゴ対象では通常版に加えて、ロゴ付きの別ファイルも出力されます。

## Development

実装本体は [`SteamImageExporter/`](./SteamImageExporter) 配下にあります。

```bash
cd SteamImageExporter
npm install
npm run dev
```

ビルド:

```bash
cd SteamImageExporter
npm run build
npm run tauri build
```

## Metadata

アプリのメタデータは `SteamImageExporter/src/config/app-metadata.json` に集約しています。ビルド前には `npm run sync:metadata` が実行され、各設定ファイルへ同期されます。

## Release

GitHub Releases ベースでの配布を前提にしています。新しいバージョンがある場合、アプリ内の `Info` ボタン横に `NEW` を表示します。

## Notes

- 出力はすべて `png` です。
- 注目点を指定しない場合は中央基準で切り抜きます。
- 更新確認に失敗しても画像生成自体は使えます。
- Steam 向け CI / SteamPipe 運用メモは `SteamImageExporter/steam/README.md` にあります。
