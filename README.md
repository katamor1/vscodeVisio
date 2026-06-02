# VS Code Visio フローチャート

選択した C コード、またはカーソル位置を含む C ファイルの内容から、Microsoft Visio の基本フローチャート VSDX ファイルを生成するローカル拡張です。

## 機能

- C ファイルの選択範囲を解析し、Visio の基本フローチャートとして出力します。
- 選択範囲がない場合は、現在の C ファイルとカーソル位置をもとにフローチャートを生成します。
- `if`、ループ、`return`、コメントなどをフロー要素として扱い、Visio 上で確認しやすい配置に変換します。
- 生成ファイルはタイムスタンプ付きの `.vsdx` として保存します。
- 設定により、生成後に VSDX ファイルを自動で開けます。

## 必要条件

- Windows 上の VS Code。
- Microsoft Visio デスクトップ版。
- PowerShell から Visio COM オブジェクトを起動できる環境。
- Visio 基本フローチャートステンシル。既定では `C:\Program Files\Microsoft Office\Root\Office16\Visio Content\1041\BASFLO_M.VSSX` を使用します。

## 使い方

1. VS Code で C ファイルを開きます。
2. フローチャート化したい範囲を選択します。選択しない場合は、現在のファイルとカーソル位置から生成します。
3. エディターのコンテキストメニュー、またはコマンドパレットから `Visio: 選択範囲からフローチャートを生成` を実行します。
4. 生成された VSDX ファイルを `vscodeVisio.outputDirectory` の場所で確認します。

## コマンド

- `Visio: 選択範囲からフローチャートを生成`

このコマンドは C ファイルのエディターコンテキストメニューにも表示されます。

## 設定

- `vscodeVisio.outputDirectory`: 生成した VSDX ファイルの出力先ディレクトリ。相対パスはワークスペースフォルダーから解決されます。
- `vscodeVisio.visioStencilPath`: Visio 基本フローチャートステンシルのパス。
- `vscodeVisio.openAfterGenerate`: 生成後に VSDX ファイルを開くかどうか。

## 生成物

既定では、ワークスペース内の `visio-output` に `<元ファイル名>-<タイムスタンプ>.vsdx` を出力します。ワークスペースに属していないファイルでは、そのファイルのディレクトリを基準に相対パスを解決します。

## 既知の制限

- 対応対象は Windows と C ファイルです。
- VSDX の生成には、インストール済みの Microsoft Visio が必要です。
- Visio のステンシルパスが環境と異なる場合は、`vscodeVisio.visioStencilPath` を設定してください。
- C 構文のすべての表現を完全な制御フローとして再現するものではありません。生成結果は Visio 上で確認・調整してください。

## ローカルインストール

ビルドとテスト:

```powershell
npm install
npm test
```

生成済みまたは作成した `.vsix` は、VS Code の `拡張機能: VSIX からのインストール...` からインストールします。

## 検証

通常の TypeScript と単体テスト:

```powershell
npm run compile
npm test
```

Visio 実機での生成確認:

```powershell
npm run verify:visio
```
