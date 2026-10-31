// 原命令帮助正文；不再通过读取入口源文件生成。
export const HELP = `wka —— wukong-animation 引擎命令行。
  wka setup                         按锁文件安装依赖到用户目录（按版本和环境隔离）
  wka check                         检查环境与所有插槽
  wka list [styles|pipelines|kits|exporters]
  wka init-project [目录]           git 初始化工程（第 1 道工序）
  wka brief <片名> [--dir 项目目录]  建占位片目录和简报空白稿（第 2 道工序）
  wka init <片名> --style <id> [--dir 项目目录] [--aspect 16:9|9:16]
  wka new style <id> --name 名称 [--category 分类] [--order N] [--dest 目录]   新建风格（默认 ~/.wukong-animation/styles/）
  wka status [项目目录]             各片制作进度（恢复在制项目）
  wka resume <片目录> [--json]       核实已完成产物、失败阶段和待存档签批
  wka delivery <片目录> --host codex|claude|generic [--aspect all|9:16] [--json]  生成存在性与新旧状态交付清单
  wka signoff <片目录> "<审片结论>" [--step N]   审片节点签批：记录进度并做定版快照
  wka qc <片目录> [--proxy] [--aspect 9:16]       量化技术质检（QC）
  wka still <片目录> [--frames N] [--at s02:1.5,s03:2] [--proxy] [--aspect 9:16]   静帧 + 接触表
  wka animatic <片目录> [--proxy] [--aspect 9:16]   动态分镜：代表帧按镜头时长排成粗片并配上声轨
  wka render <片目录> [--proxy] [--only s01,s03] [--force] [--aspect 9:16]   渲染（--proxy 为小样；--aspect 出副版）
  wka preview <片目录> [--only s01,s03] [--native] [--force] [--aspect 9:16]   日常局部小样（--native 原画质与原帧率）
  wka clean <片目录> --render-cache [--aspect 9:16]   主动清理当前画幅的可再生渲染缓存
  wka soundtrack <片目录>           声轨制作：配乐 + 人声，写入声音同步点（不要求镜头文件已写好）
  wka sfx <片目录> [--list]         录音音效：--list 只列来源与大小（给用户确认），不带参数则下载并处理
  wka audition <片目录> [--voices a,b,c] [--text "…"] [--rate -20%] [--pitch -2Hz]   音色试听：同一句用几个音色各合成一遍
  wka subtitles <片目录> [--force] [--preview|--preflight] [--aspect 9:16]   字幕制作：从人声生成 subtitles.srt；--preflight 预检（还没有小样时为版式预检）；--preview 烧录到小样上审阅
  wka final <片目录> [--proxy] [--only ...] [--formats mp4,gif] [--aspect 9:16|all]   终版渲染与终混`;
