"""按 plan.mjs 生成的草稿计划写出剪映草稿（pyJianYingDraft==0.3.1）。

用法：python3 write_draft.py <计划.json> <草稿根目录>
素材全部复制进 <草稿>/materials/；保存后把 draft_content.json 复制为 draft_info.json
（macOS 剪映 11.x 读后者）。任一步失败都会删掉本次新建的草稿文件夹。
"""
import json
import os
import shutil
import sys

import pyJianYingDraft as draft
from pyJianYingDraft import Timerange, TrackSpec, TrackType
from pyJianYingDraft.exceptions import SegmentOverlap


def unique_copy(src: str, dest_dir: str, name: str, taken: set[str]) -> str:
    """复制素材到 dest_dir，重名时加序号。"""
    stem, ext = os.path.splitext(name)
    out, i = name, 2
    while out in taken:
        out, i = f"{stem} ({i}){ext}", i + 1
    taken.add(out)
    return shutil.copy(src, os.path.join(dest_dir, out))


def add(script: draft.ScriptFile, segment: object, track: str | None, what: str) -> None:
    try:
        script.add_segment(segment, track)
    except SegmentOverlap:
        start = segment.target_timerange.start / 1e6
        raise SystemExit(f"{what}在 {start:.2f}s 处与前一段重叠，同一条轨上放不下；请调整 film.json 里人声的 at") from None


def build(plan: dict, draft_dir: str, script: draft.ScriptFile) -> None:
    mdir = os.path.join(draft_dir, "materials")
    os.makedirs(mdir)
    taken = set()

    script.append_track(TrackSpec(TrackType.video))
    for v in plan["video"]:
        material = draft.VideoMaterial(unique_copy(v["file"], mdir, f"{v['name']}.mp4", taken))
        duration = min(v["duration"], material.duration)
        add(script, draft.VideoSegment(material, Timerange(v["start"], duration)), None, f"镜头 {v['name']} ")

    for t in plan["audioTracks"]:
        script.append_track(TrackSpec(TrackType.audio, t["name"]))
        for s in t["segments"]:
            material = draft.AudioMaterial(unique_copy(s["file"], mdir, os.path.basename(s["file"]), taken))
            duration = min(s["maxDuration"], material.duration)
            add(script, draft.AudioSegment(material, Timerange(s["start"], duration), volume=s["volume"]), t["name"], f"音轨「{t['name']}」")

    if plan["subtitles"]:
        script.append_track(TrackSpec(TrackType.text))
        for s in plan["subtitles"]:
            add(script, draft.TextSegment(s["text"], Timerange(s["start"], s["duration"])), None, f"字幕「{s['text']}」")


def main() -> None:
    plan_file, root = sys.argv[1], sys.argv[2]
    with open(plan_file, encoding="utf-8") as f:
        plan = json.load(f)
    draft_dir = os.path.join(root, plan["name"])
    script = draft.DraftFolder(root).create_draft(plan["name"], plan["width"], plan["height"], fps=plan["fps"], allow_replace=False)
    try:
        build(plan, draft_dir, script)
        script.save()
        shutil.copy(os.path.join(draft_dir, "draft_content.json"), os.path.join(draft_dir, "draft_info.json"))
    except BaseException:
        shutil.rmtree(draft_dir, ignore_errors=True)
        raise


if __name__ == "__main__":
    main()
