from __future__ import annotations

import json
import re
import sys
from pathlib import Path

from docx import Document


SOURCE = Path("/Users/mastercui.eth/Library/Containers/com.tencent.xinWeChat/Data/Documents/xwechat_files/cuijin_9add/msg/file/2026-05/单词归类(2)(2).docx")
OUT = Path("/Users/mastercui.eth/Documents/Codex/2026-05-21/files-mentioned-by-the-user-2/build/word_entries.json")

LETTER_RE = re.compile(r"^([A-Z])\s*开头(?:的)?单词$")
CATEGORY_RE = re.compile(r"^(?:[一二三四五六七八九十]+、)?(.+?)(?:（([A-Za-z ]+)）)?$")
NUMBERED_RE = re.compile(r"^(\d+)\.\s*(.+)$")


CATEGORY_MAP = {
    "名词": "名词",
    "动词": "动词",
    "形容词": "形容词",
    "副词": "副词",
    "介词": "介词",
    "连词": "连词",
    "代词": "代词",
    "数词": "数词",
    "感叹词": "感叹词",
    "情态动词": "情态动词",
    "短语": "短语",
    "短语与固定搭配": "短语与固定搭配",
}


def normalize_category(text: str) -> str | None:
    text = text.strip()
    if not text or text.startswith("----powered"):
        return None
    match = CATEGORY_RE.match(text)
    if not match:
        return None
    name = match.group(1).strip()
    name = re.sub(r"（.*?）", "", name).strip()
    name = re.sub(r"按.*$", "", name).strip()
    name = name.rstrip("：:")
    for key, normalized in CATEGORY_MAP.items():
        if name.startswith(key):
            return normalized
    return None


def split_entry(raw: str, category: str = "") -> tuple[str, str, str, str, str]:
    match = NUMBERED_RE.match(raw)
    if match:
        raw = match.group(2).strip()
    phonetic = ""
    word = raw
    meaning = ""
    phrase_head = ""
    phrase_tail = ""

    slash_match = re.search(r"\s(/[^/]+/)\s*", raw)
    if slash_match:
        word = raw[: slash_match.start()].strip()
        phonetic = slash_match.group(1).strip()
        meaning = raw[slash_match.end() :].strip()
    else:
        if category in {"短语", "短语与固定搭配"}:
            meaning_start = None
            for idx, char in enumerate(raw):
                if "\u4e00" <= char <= "\u9fff":
                    meaning_start = idx
                    break
            if meaning_start is not None:
                word = raw[:meaning_start].strip()
                meaning = raw[meaning_start:].strip()
            else:
                word = raw.strip()
        else:
            parts = raw.split(maxsplit=1)
            if len(parts) == 2:
                word, meaning = parts[0].strip(), parts[1].strip()
            else:
                word = raw.strip()
    if meaning.startswith("="):
        meaning = meaning[1:].strip()
    if category in {"短语", "短语与固定搭配"}:
        phrase_parts = word.split(maxsplit=1)
        phrase_head = phrase_parts[0] if phrase_parts else word
        phrase_tail = phrase_parts[1] if len(phrase_parts) > 1 else ""

    return word, phonetic, meaning, phrase_head, phrase_tail


def main() -> None:
    doc = Document(SOURCE)
    lines = [p.text.strip() for p in doc.paragraphs if p.text.strip()]
    entries: list[dict[str, object]] = []
    letter = ""
    category = ""
    skipped: list[str] = []

    for line in lines:
        letter_match = LETTER_RE.match(line.replace(" ", ""))
        if letter_match:
            letter = letter_match.group(1)
            category = ""
            continue

        normalized_category = normalize_category(line)
        if normalized_category and not NUMBERED_RE.match(line):
            category = normalized_category
            continue

        if not letter or not category:
            skipped.append(line)
            continue

        if line in {"无纯代词。"} or line.startswith("（本次") or line.startswith("----powered"):
            continue

        numbered = NUMBERED_RE.match(line)
        order = int(numbered.group(1)) if numbered else None
        word, phonetic, meaning, phrase_head, phrase_tail = split_entry(line, category)
        if not word:
            skipped.append(line)
            continue
        entries.append(
            {
                "letter": letter,
                "category": category,
                "order": order,
                "word": word,
                "phraseHead": phrase_head,
                "phraseTail": phrase_tail,
                "phonetic": phonetic,
                "meaning": meaning,
                "raw": line,
            }
        )

    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(
        json.dumps(
            {
                "source": str(SOURCE),
                "entry_count": len(entries),
                "letters": sorted({e["letter"] for e in entries}),
                "entries": entries,
                "skipped": skipped,
            },
            ensure_ascii=False,
            indent=2,
        ),
        encoding="utf-8",
    )
    print(f"entries={len(entries)} letters={''.join(sorted({e['letter'] for e in entries}))} skipped={len(skipped)}")


if __name__ == "__main__":
    sys.exit(main())
