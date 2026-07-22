# 柏宝砚

SillyTavern 楼层标注改写插件的 Vue 3 UI 原型。

当前版本只实现界面和演示交互，不会调用 API，也不会将候选稿写回聊天。

## 查看原型

1. 重新加载 SillyTavern。
2. 从扩展菜单打开“柏宝砚”，或先编辑任意楼层，再点击编辑操作区中的笔形按钮。
3. 如果“柏宝箱”的“编辑楼层下方增加按钮”已开启，下方操作区也会显示同一个入口。

## 构建

```powershell
pnpm.cmd run build
```

`package.json` 的版本号会在构建前同步到 `manifest.json`，并用于 JavaScript 与 CSS 的缓存版本参数。
