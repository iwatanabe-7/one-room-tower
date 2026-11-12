# ワンルームタワー（Web 版）

1部屋 = 1フロアの塔を登る、3D アクション・ローグライトの手触り確認版です。出口のゲートをくぐると、次の部屋がせり上がってきます。HP 3 で 20F の最上階を目指します。

**遊ぶ:** https://iwatanabe-7.github.io/one-room-tower/

## 操作
| | キーボード | スマホ |
|---|---|---|
| 移動 | WASD / 矢印キー | 左下のスティック |
| ジャンプ | Space | JUMP ボタン |
| ダッシュ | Shift を押している間 | スティックを端まで倒す |
| 強化を選ぶ | 1〜3 | カードをタップ |
| やり直す | R | — |

URL に `?seed=12345` を付けると、部屋の並びを固定できます。

## 開発
```bash
npm install
npm run dev     # 開発サーバー
node test/logic.test.js   # ロジックのテスト
npm run build   # dist/ に出力
```

Three.js + Vite。公開は `npm run deploy`（テスト → ビルド → `dist/` を `gh-pages` ブランチに push）。
