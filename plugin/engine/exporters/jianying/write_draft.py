"""按 plan.mjs 生成的草稿计划写出剪映草稿（pyJianYingDraft==0.3.1）。

用法：python3 write_draft.py <计划.json> <草稿根目录>
素材全部复制进 <草稿>/materials/；保存后换上新的草稿 id，再把 draft_content.json 复制为
draft_info.json（macOS 剪映 11.x 读后者）。任一步失败都会删掉本次新建的草稿文件夹。
"""
import json
import os
import shutil
import sys
import uuid

import pyJianYingDraft as draft
from pyJianYingDraft import ClipSettings, FontType, TextBorder, TextStyle, Timerange, TrackSpec, TrackType
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
        raise SystemExit(f"{what}在 {start:.2f}s 处与同一条轨上的前一段重叠") from None


def text_options(style: dict | None) -> dict:
    """plan.mjs 换算好的字幕样式 → TextSegment 的关键字参数；没有样式就用剪映默认。"""
    if not style:
        return {}
    border = style["border"]
    options = {
        "style": TextStyle(size=style["size"], color=tuple(style["color"]), alpha=style["alpha"]),
        "clip_settings": ClipSettings(transform_y=style["transformY"]),
    }
    if border["width"] > 0 and border["alpha"] > 0:
        options["border"] = TextBorder(color=tuple(border["color"]), alpha=border["alpha"], width=border["width"])
    if style["font"]:
        options["font"] = FontType[style["font"]]
    return options


def build(plan: dict, draft_dir: str, script: draft.ScriptFile) -> None:
    mdir = os.path.join(draft_dir, "materials")
    os.makedirs(mdir)
    taken = set()

    script.append_track(TrackSpec(TrackType.video))
    for v in plan["video"]:
        material = draft.VideoMaterial(unique_copy(v["file"], mdir, f"{v['name']}.mp4", taken))
        duration = min(v["duration"], material.duration)
        add(script, draft.VideoSegment(material, Timerange(v["start"], duration)), None, f"镜头 {v['name']} ")

    materials = {}  # 同一文件切成多段时只复制、登记一次素材
    for t in plan["audioTracks"]:
        script.append_track(TrackSpec(TrackType.audio, t["name"]))
        for s in t["segments"]:
            material = materials.get(s["file"])
            if material is None:
                material = materials[s["file"]] = draft.AudioMaterial(unique_copy(s["file"], mdir, os.path.basename(s["file"]), taken))
            duration = min(s["maxDuration"], material.duration - s["sourceStart"])
            if duration <= 0:
                continue
            segment = draft.AudioSegment(material, Timerange(s["start"], duration), source_timerange=Timerange(s["sourceStart"], duration), volume=s["volume"])
            add(script, segment, t["name"], f"音轨「{t['name']}」")

    options = text_options(plan.get("subtitleStyle"))
    for t in plan["subtitleTracks"]:
        script.append_track(TrackSpec(TrackType.text, t["name"]))
        for s in t["segments"]:
            add(script, draft.TextSegment(s["text"], Timerange(s["start"], s["duration"]), **options), t["name"], f"字幕「{s['text']}」")


def update_json(file: str, **fields: object) -> None:
    with open(file, encoding="utf-8") as f:
        data = json.load(f)
    with open(file, "w", encoding="utf-8") as f:
        json.dump({**data, **fields}, f, ensure_ascii=False)


def fresh_ids(draft_dir: str, root: str, name: str) -> None:
    """pyJianYingDraft 模板里的草稿 id 是写死的，所有导出的草稿共用一个 id，剪映会按 id 复用缓存的旧时间线：每次换新 id。"""
    new_id = lambda: str(uuid.uuid4()).upper()
    update_json(os.path.join(draft_dir, "draft_content.json"), id=new_id())
    update_json(os.path.join(draft_dir, "draft_meta_info.json"), draft_id=new_id(), draft_name=name, draft_fold_path=draft_dir, draft_root_path=root)


def main() -> None:
    plan_file, root = sys.argv[1], sys.argv[2]
    with open(plan_file, encoding="utf-8") as f:
        plan = json.load(f)
    draft_dir = os.path.join(root, plan["name"])
    script = draft.DraftFolder(root).create_draft(plan["name"], plan["width"], plan["height"], fps=plan["fps"], allow_replace=False)
    try:
        build(plan, draft_dir, script)
        script.save()
        fresh_ids(draft_dir, root, plan["name"])
        shutil.copy(os.path.join(draft_dir, "draft_content.json"), os.path.join(draft_dir, "draft_info.json"))
    except BaseException:
        shutil.rmtree(draft_dir, ignore_errors=True)
        raise


if __name__ == "__main__":
    main()
