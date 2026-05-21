import fs from "node:fs/promises";
import path from "node:path";
import { Blob } from "node:buffer";
import { SpreadsheetFile, Workbook } from "@oai/artifact-tool";

const ROOT = "/Users/mastercui.eth/Documents/Codex/2026-05-21/files-mentioned-by-the-user-2";
const DATA_PATH = path.join(ROOT, "build/word_entries.json");
const OUT_DIR = path.join(ROOT, "outputs/word-classified-excel");
const OUT_PATH = path.join(OUT_DIR, "单词归类-横版A4打印表.xlsx");
const PREVIEW_PRINT = path.join(ROOT, "build/preview-print.png");
const PREVIEW_DATA = path.join(ROOT, "build/preview-data.png");

const THEME = {
  ink: "#16324F",
  title: "#1F4E79",
  title2: "#2E75B6",
  paleBlue: "#D9EAF7",
  blueTint: "#EEF6FC",
  gold: "#F6C85F",
  goldPale: "#FFF3D0",
  border: "#A9C4D8",
  softBorder: "#DCE7F0",
  white: "#FFFFFF",
  green: "#DDEFE3",
};

const CATEGORIES = [
  "名词",
  "动词",
  "形容词",
  "副词",
  "介词",
  "连词",
  "代词",
  "数词",
  "感叹词",
  "情态动词",
  "短语",
  "短语与固定搭配",
];

const GROUPS = 3;
const ROWS_PER_GROUP = 24;
const GROUP_WIDTH = 3;
const GAP_WIDTH = 1;
const PAGE_ROWS = ROWS_PER_GROUP + 3;
const PAGE_COLS = GROUPS * GROUP_WIDTH + (GROUPS - 1) * GAP_WIDTH;
const letters = "ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("");

function colName(index) {
  let n = index + 1;
  let out = "";
  while (n > 0) {
    const r = (n - 1) % 26;
    out = String.fromCharCode(65 + r) + out;
    n = Math.floor((n - 1) / 26);
  }
  return out;
}

function addr(row, col) {
  return `${colName(col)}${row + 1}`;
}

function rangeAddr(r1, c1, r2, c2) {
  return `${addr(r1, c1)}:${addr(r2, c2)}`;
}

function cleanSheetName(name) {
  return name.replace(/[\\/?*[\]:]/g, "").slice(0, 31);
}

function rowsForLetter(entries) {
  const rows = [];
  const byCategory = new Map();
  for (const category of CATEGORIES) byCategory.set(category, []);
  for (const entry of entries) {
    if (!byCategory.has(entry.category)) byCategory.set(entry.category, []);
    byCategory.get(entry.category).push(entry);
  }
  for (const [category, items] of byCategory.entries()) {
    if (!items.length) continue;
    rows.push({ type: "category", category, count: items.length });
    for (const item of items) rows.push({ type: "entry", ...item });
  }
  return rows;
}

function chunkRows(rows, capacity) {
  const chunks = [];
  for (let i = 0; i < rows.length; i += capacity) chunks.push(rows.slice(i, i + capacity));
  return chunks.length ? chunks : [[]];
}

function setCell(sheet, row, col, value, format = {}) {
  const cell = sheet.getRange(addr(row, col));
  cell.values = [[value]];
  if (Object.keys(format).length) cell.format = format;
  return cell;
}

function setRange(sheet, r1, c1, r2, c2, format) {
  const range = sheet.getRange(rangeAddr(r1, c1, r2, c2));
  range.format = format;
  return range;
}

function writePrintSheet(sheet, entries) {
  sheet.showGridLines = false;
  const entriesByLetter = new Map();
  for (const entry of entries) {
    if (!entriesByLetter.has(entry.letter)) entriesByLetter.set(entry.letter, []);
    entriesByLetter.get(entry.letter).push(entry);
  }

  let top = 0;
  const anchors = {};
  const pages = [];
  for (const letter of letters) {
    const items = entriesByLetter.get(letter) ?? [];
    if (!items.length) continue;
    const flowRows = rowsForLetter(items);
    const chunks = chunkRows(flowRows, ROWS_PER_GROUP * GROUPS);
    chunks.forEach((chunk, chunkIndex) => {
      const pageTop = top;
      if (!anchors[letter]) anchors[letter] = addr(pageTop, 0);
      pages.push({ letter, pageTop, chunkIndex, count: items.length });

      sheet.getRange(rangeAddr(pageTop, 0, pageTop, PAGE_COLS - 1)).merge();
      setCell(
        sheet,
        pageTop,
        0,
        `${letter} 开头单词${chunks.length > 1 ? `（${chunkIndex + 1}/${chunks.length}）` : ""}`,
        {
          fill: THEME.title,
          font: { name: "Microsoft YaHei", size: 18, bold: true, color: THEME.white },
          horizontalAlignment: "center",
          verticalAlignment: "center",
        },
      );
      sheet.getRange(rangeAddr(pageTop, 0, pageTop, PAGE_COLS - 1)).format.rowHeight = 27;

      for (let g = 0; g < GROUPS; g++) {
        const startCol = g * (GROUP_WIDTH + GAP_WIDTH);
        const headerRow = pageTop + 1;
        sheet.getRange(rangeAddr(headerRow, startCol, headerRow, startCol + 2)).values = [["英文单词 / 短语", "音标", "中文解释"]];
        setRange(sheet, headerRow, startCol, headerRow, startCol + 2, {
          fill: THEME.paleBlue,
          font: { name: "Microsoft YaHei", size: 9, bold: true, color: THEME.ink },
          borders: { preset: "all", style: "thin", color: THEME.border },
          horizontalAlignment: "center",
          verticalAlignment: "center",
        });
        sheet.getRange(rangeAddr(headerRow, startCol, headerRow, startCol + 2)).format.rowHeight = 19;
      }

      for (let i = 0; i < chunk.length; i++) {
        const g = Math.floor(i / ROWS_PER_GROUP);
        const rowWithin = i % ROWS_PER_GROUP;
        const row = pageTop + 2 + rowWithin;
        const startCol = g * (GROUP_WIDTH + GAP_WIDTH);
        const item = chunk[i];
        if (item.type === "category") {
          sheet.getRange(rangeAddr(row, startCol, row, startCol + 2)).merge();
          setCell(sheet, row, startCol, `${item.category}（${item.count}）`, {
            fill: THEME.gold,
            font: { name: "Microsoft YaHei", size: 9, bold: true, color: THEME.ink },
            borders: { preset: "all", style: "thin", color: THEME.border },
            horizontalAlignment: "left",
            verticalAlignment: "center",
          });
        } else {
          const fill = rowWithin % 2 === 0 ? THEME.white : THEME.blueTint;
          sheet.getRange(rangeAddr(row, startCol, row, startCol + 2)).values = [[item.word, item.phonetic, item.meaning]];
          setRange(sheet, row, startCol, row, startCol + 2, {
            fill,
            font: { name: "Microsoft YaHei", size: 8, color: THEME.ink },
            borders: { preset: "all", style: "thin", color: THEME.softBorder },
            verticalAlignment: "top",
            wrapText: true,
          });
          sheet.getRange(addr(row, startCol)).format.font = { name: "Calibri", size: 9, bold: true, color: "#0F3557" };
          sheet.getRange(addr(row, startCol + 1)).format.font = { name: "Calibri", size: 8, italic: true, color: "#495B6B" };
        }
        sheet.getRange(rangeAddr(row, startCol, row, startCol + 2)).format.rowHeight = item.type === "category" ? 17 : 20;
      }

      for (let g = 0; g < GROUPS; g++) {
        const startCol = g * (GROUP_WIDTH + GAP_WIDTH);
        setRange(sheet, pageTop, startCol, pageTop + PAGE_ROWS - 2, startCol + 2, {
          borders: { preset: "outside", style: "medium", color: THEME.title2 },
        });
      }

      top += PAGE_ROWS;
    });
  }

  for (let c = 0; c < PAGE_COLS; c++) {
    const column = colName(c);
    const isGap = (c + 1) % 4 === 0;
    const width = isGap ? 16 : c % 4 === 0 ? 88 : c % 4 === 1 ? 78 : 165;
    sheet.getRange(`${column}:${column}`).format.columnWidthPx = width;
  }
  sheet.getRange(`A1:${colName(PAGE_COLS - 1)}${top}`).format.verticalAlignment = "top";
  sheet.getRange(`A1:${colName(PAGE_COLS - 1)}${top}`).format.wrapText = true;
  return { anchors, pages, totalRows: top };
}

function writeIndexSheet(sheet, entries, anchors) {
  sheet.showGridLines = false;
  const countsByLetter = new Map();
  const countsByCategory = new Map();
  for (const entry of entries) {
    countsByLetter.set(entry.letter, (countsByLetter.get(entry.letter) ?? 0) + 1);
    countsByCategory.set(entry.category, (countsByCategory.get(entry.category) ?? 0) + 1);
  }
  sheet.getRange("A1:H1").merge();
  setCell(sheet, 0, 0, "单词归类横版打印表", {
    fill: THEME.title,
    font: { name: "Microsoft YaHei", size: 20, bold: true, color: THEME.white },
    horizontalAlignment: "center",
    verticalAlignment: "center",
  });
  sheet.getRange("A1:H1").format.rowHeight = 34;
  sheet.getRange("A2:H2").merge();
  setCell(sheet, 1, 0, `共 ${entries.length} 条词条。打印版按 A4 横向三栏平铺；数据版保留完整筛选明细。`, {
    fill: THEME.blueTint,
    font: { name: "Microsoft YaHei", size: 10, color: THEME.ink },
    horizontalAlignment: "center",
    verticalAlignment: "center",
  });

  sheet.getRange("A4:B4").values = [["字母", "词条数"]];
  setRange(sheet, 3, 0, 3, 1, {
    fill: THEME.paleBlue,
    font: { name: "Microsoft YaHei", size: 10, bold: true, color: THEME.ink },
    borders: { preset: "all", style: "thin", color: THEME.border },
    horizontalAlignment: "center",
  });

  const letterRows = [...countsByLetter.entries()].sort().map(([letter, count]) => [letter, count]);
  sheet.getRange(`A5:B${4 + letterRows.length}`).values = letterRows;
  setRange(sheet, 4, 0, 3 + letterRows.length, 1, {
    fill: THEME.white,
    font: { name: "Microsoft YaHei", size: 10, color: THEME.ink },
    borders: { preset: "all", style: "thin", color: THEME.softBorder },
    horizontalAlignment: "center",
  });

  sheet.getRange("D4:E4").values = [["分类", "词条数"]];
  setRange(sheet, 3, 3, 3, 4, {
    fill: THEME.paleBlue,
    font: { name: "Microsoft YaHei", size: 10, bold: true, color: THEME.ink },
    borders: { preset: "all", style: "thin", color: THEME.border },
    horizontalAlignment: "center",
  });
  const categoryRows = CATEGORIES.filter((c) => countsByCategory.has(c)).map((c) => [c, countsByCategory.get(c)]);
  sheet.getRange(`D5:E${4 + categoryRows.length}`).values = categoryRows;
  setRange(sheet, 4, 3, 3 + categoryRows.length, 4, {
    fill: THEME.white,
    font: { name: "Microsoft YaHei", size: 10, color: THEME.ink },
    borders: { preset: "all", style: "thin", color: THEME.softBorder },
    horizontalAlignment: "center",
  });

  sheet.getRange("G4:H4").values = [["快捷入口", "说明"]];
  setRange(sheet, 3, 6, 3, 7, {
    fill: THEME.paleBlue,
    font: { name: "Microsoft YaHei", size: 10, bold: true, color: THEME.ink },
    borders: { preset: "all", style: "thin", color: THEME.border },
    horizontalAlignment: "center",
  });
  const linkRows = [...countsByLetter.keys()].sort();
  for (let i = 0; i < linkRows.length; i++) {
    const letter = linkRows[i];
    const row = 4 + i;
    sheet.getRange(addr(row, 6)).formulas = [[`=HYPERLINK("#'打印版'!${anchors[letter]}","${letter} 开头")`]];
    sheet.getRange(addr(row, 7)).values = [[`${countsByLetter.get(letter)} 条`]];
  }
  setRange(sheet, 4, 6, 3 + linkRows.length, 7, {
    fill: THEME.white,
    font: { name: "Microsoft YaHei", size: 10, color: THEME.ink },
    borders: { preset: "all", style: "thin", color: THEME.softBorder },
    horizontalAlignment: "center",
  });

  for (const [column, width] of Object.entries({ A: 68, B: 78, C: 26, D: 130, E: 78, F: 26, G: 100, H: 88 })) {
    sheet.getRange(`${column}:${column}`).format.columnWidthPx = width;
  }
}

function writeDataSheet(sheet, entries) {
  sheet.showGridLines = false;
  const headers = ["字母", "分类", "序号", "英文单词/短语", "音标", "中文解释", "原文"];
  const rows = entries.map((e) => [e.letter, e.category, e.order ?? "", e.word, e.phonetic, e.meaning, e.raw]);
  sheet.getRange(`A1:G${rows.length + 1}`).values = [headers, ...rows];
  setRange(sheet, 0, 0, 0, headers.length - 1, {
    fill: THEME.title,
    font: { name: "Microsoft YaHei", size: 10, bold: true, color: THEME.white },
    borders: { preset: "all", style: "thin", color: THEME.border },
    horizontalAlignment: "center",
    verticalAlignment: "center",
  });
  setRange(sheet, 1, 0, rows.length, headers.length - 1, {
    fill: THEME.white,
    font: { name: "Microsoft YaHei", size: 9, color: THEME.ink },
    borders: { preset: "all", style: "thin", color: THEME.softBorder },
    verticalAlignment: "top",
    wrapText: true,
  });
  sheet.getRange(`A1:G${rows.length + 1}`).format.rowHeight = 18;
  sheet.getRange("A:A").format.columnWidthPx = 52;
  sheet.getRange("B:B").format.columnWidthPx = 112;
  sheet.getRange("C:C").format.columnWidthPx = 48;
  sheet.getRange("D:D").format.columnWidthPx = 190;
  sheet.getRange("E:E").format.columnWidthPx = 130;
  sheet.getRange("F:F").format.columnWidthPx = 360;
  sheet.getRange("G:G").format.columnWidthPx = 420;
  sheet.freezePanes.freezeRows(1);
  const table = sheet.tables.add(sheet.getRange(`A1:G${rows.length + 1}`), true);
  table.name = "WordClassificationData";
  table.showBandedRows = true;
  table.showFilterButton = true;
}

const parsed = JSON.parse(await fs.readFile(DATA_PATH, "utf8"));
const workbook = Workbook.create();
const indexSheet = workbook.worksheets.getOrAdd("目录", { renameFirstIfOnlyNewSpreadsheet: true });
const printSheet = workbook.worksheets.add("打印版");
const dataSheet = workbook.worksheets.add("数据版");

const printMeta = writePrintSheet(printSheet, parsed.entries);
writeIndexSheet(indexSheet, parsed.entries, printMeta.anchors);
writeDataSheet(dataSheet, parsed.entries);

await fs.mkdir(OUT_DIR, { recursive: true });

const printBlob = await workbook.render({ sheetName: "打印版", range: `A1:K${PAGE_ROWS}`, scale: 2, format: "png" });
await fs.writeFile(PREVIEW_PRINT, Buffer.from(await printBlob.arrayBuffer()));
const dataBlob = await workbook.render({ sheetName: "数据版", range: "A1:G28", scale: 2, format: "png" });
await fs.writeFile(PREVIEW_DATA, Buffer.from(await dataBlob.arrayBuffer()));

const output = await SpreadsheetFile.exportXlsx(workbook);
await output.save(OUT_PATH);

await fs.writeFile(
  path.join(ROOT, "build/workbook_meta.json"),
  JSON.stringify(
    {
      output: OUT_PATH,
      previewPrint: PREVIEW_PRINT,
      previewData: PREVIEW_DATA,
      entries: parsed.entry_count,
      letters: parsed.letters,
      printRows: printMeta.totalRows,
      pages: printMeta.pages.length,
    },
    null,
    2,
  ),
);

console.log(JSON.stringify({ output: OUT_PATH, entries: parsed.entry_count, pages: printMeta.pages.length }, null, 2));
