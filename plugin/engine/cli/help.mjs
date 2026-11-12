// 原命令帮助正文；不再通过读取入口源文件生成。
export const HELP = `wka —— wukong-animation 引擎命令行。
  wka workbench [项目或片目录...] [--open] [--port N] [--capture|--pending|--register 文件 --step N]  自动复用本机工作台并加入项目；记录操作限单片
  wka setup                         按锁文件安装依赖到用户目录（按版本和环境隔离）
  wka check                         检查环境与所有插槽
  wka list [styles|pipelines|kits|exporters]
  wka init-project [目录]           git 初始化工程（第 1 道工序）
  wka brief <片名> [--dir 项目目录]  建占位片目录和简报空白稿（第 2 道工序）
  wka init <片名> --style <id> [--dir 项目目录] [--aspect 16:9|9:16]
  wka new style <id> --name 名称 [--category 分类] [--order N] [--dest 目录]   新建风格（默认 ~/.wukong-animation/styles/）
  wka status [项目目录]             各片制作进度与各目录占用（恢复在制项目）
  wka resume <片目录> [--json]       核实已完成产物、失败阶段和待存档签批
  wka delivery <片目录> --host codex|claude|generic [--aspect all|9:16] [--json]  生成存在性与新旧状态交付清单
  wka materials <片目录> [--add 文件或目录[,…]] [--frames N]   素材清单：导入并扫描 media/、audio/voice/、资料/ 里的素材，记录来源、查重，视频抽帧，写入 review/素材/素材清单.md（第 2 道）
  wka estimate <片目录> [--max-shot 秒] [--aspect 9:16]   渲染规模与用时估算；有镜头超过单镜上限时退出码为 2（第 4 道）
  wka recheck <片目录> [--accept --note "<复核说明>"]   插件升级后复核：列出只因引擎文件变动而过期的交付产物，确认后接受新引擎上下文
  wka signoff <片目录> "<审片结论>" [--step N]   审片节点签批：记录进度并做定版快照
  wka qc <片目录> [--proxy] [--aspect 9:16]       量化技术质检（QC）
  wka still <片目录> [--frames N] [--at s02:1.5,s03:2] [--word-review] [--proxy] [--aspect 9:16]   静帧 + 接触表
  wka animatic <片目录> [--proxy] [--aspect 9:16]   动态分镜：代表帧按镜头时长排成粗片并配上声轨
  wka render <片目录> [--proxy] [--only s01,s03] [--force] [--aspect 9:16]   渲染（--proxy 为小样；--aspect 出副版）
  wka preview <片目录> [--only s01,s03] [--native] [--force] [--aspect 9:16]   日常局部小样（--native 原画质与原帧率）
  wka clean <片目录> --render-cache [--aspect 9:16]   主动清理当前画幅的可再生渲染缓存
  wka clean <片目录> --deep [--yes]   深度清理：先列清单；加 --yes 才删缓存、可再生的审阅副本和无引用的工作台对象
  wka align-voice <片目录> [--words|--prepare --binary 路径 --model 路径|--status|--import 时间点.json --confirm "用户确认说明"]  本地台词定位；默认同时生成逐词时间表，--words 只重算词表
  wka soundtrack <片目录>           制作小样内的声轨：用户录音 + 配乐 + 音效 + 环境声，写入声音同步点（不要求镜头文件已写好）
  wka sfx <片目录> [--list]         录音音效：--list 只列来源与大小（给用户确认），不带参数则下载并处理
  wka final <片目录> [--proxy] [--only ...] [--formats mp4,gif] [--aspect 9:16|all]   制作成片：渲染、混音和编码`;
