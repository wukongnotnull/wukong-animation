---
name: wukong-animation
description: 用代码制作动画短片、产品讲解、水墨动画与发布会视频，或继续在制作品；包括环境检查、浏览风格、简报、剧本、分镜、声音、字幕、渲染和剪映草稿交付。
---

# wukong-animation

先取得当前实际加载的本 SKILL.md 的真实绝对位置，其所在目录就是安装根；引擎为该根下 engine/bin/wka.mjs。不得从工作目录、源码仓库或缓存版本猜测安装根。制作命令在用户选择的作品目录执行，安装目录不能当作品目录。

先读 [宿主能力规则](skills/director/HOSTS.md)。环境安装或检查读 [setup](skills/setup/INSTRUCTIONS.md)；浏览/推荐风格读 [styles](skills/styles/INSTRUCTIONS.md)；开拍/恢复作品读 [film](skills/film/INSTRUCTIONS.md)，并按 [director](skills/director/INSTRUCTIONS.md) 执行；创建风格读 [new-style](skills/new-style/INSTRUCTIONS.md)。它们是同一制作流程，不能以开拍请求代替后续审片签批。

检查环境用 `node "<安装根>/engine/bin/wka.mjs" check`，列风格用 `node "<安装根>/engine/bin/wka.mjs" list styles`。setup 未通过不得报告已能渲染。新作品写入用户选定目录；现有作品先核对状态再继续。没有终端或文件权限时只完成能完成的简报/剧本，说明执行限制并等待合适环境，不虚报安装或渲染成功。
