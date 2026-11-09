#!/usr/bin/env python3
"""Focused normal-input checks against the real sealed document bundle.

No model, system document libraries, injected failures or executable stand-ins.
Retains generated originals and page images for independent visual review.
"""
import hashlib
import argparse
import json
import os
from pathlib import Path
import subprocess
import time

ROOT = Path(__file__).resolve().parents[1]


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--bundle",type=Path)
    args=parser.parse_args()
    bundle_receipt = json.loads((ROOT / ".local/document-bundles/current.json").read_text())
    bundle = args.bundle.resolve(strict=True) if args.bundle else Path(bundle_receipt["bundle_root"])
    if hashlib.sha256((bundle/"manifest.json").read_bytes()).hexdigest()!=bundle_receipt["manifest_sha256"]:
        raise ValueError("selected bundle differs from the current verified source")
    work = ROOT / ".local/document-checks" / (bundle_receipt["bundle_id"] + "-" + str(time.time_ns()))
    work.mkdir(parents=True)
    (work / "state").mkdir(mode=0o700)
    env = {"PATH": "/usr/bin:/bin", "YIJIE_DOCUMENT_STATE_ROOT": str(work / "state")}
    python = str(bundle / "python/bin/python3.12")
    helper = [python, "-I", "-B", str(bundle / "helper/document_cli.py")]
    checks = []
    log = (work / "commands.log").open("w")

    def run(args):
        started = time.monotonic()
        result = subprocess.run(args, cwd=work, env=env, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
        log.write(result.stdout + result.stderr)
        log.flush()
        if result.returncode:
            raise ValueError("Document check failed; retained " + str(work))
        checks.append({"command": args[4:] if args[:3] == helper[:3] else "private-library-check", "seconds": time.monotonic() - started})
        return json.loads(result.stdout)

    spec = {"title": "杭州 · 文档链路样本", "paragraphs": ["杭州是浙江省省会，西湖是其代表性景观。", "此公开内容仅用于验证生成、解析及版式，不代表事实核验报告。"],
            "rows": [["项目", "数量"], ["西湖", 2], ["运河", 3]],
            "data": {"identifier": "00017", "large_integer": 900719925474099312345, "city": "杭州"},
            "sheets": [{"name": "数据", "rows": [["项目", "数量"], ["西湖", 2], ["运河", 3], ["合计", "=SUM(B2:B3)"], ["均值", "=AVERAGE(B2:B3)"]]}],
            "slides": [{"title": "杭州", "body": "浙江省省会\n西湖与运河"}, {"title": "文化与生活", "body": "良渚文化\n龙井茶与杭帮菜"}]}
    (work / "spec.json").write_text(json.dumps(spec, ensure_ascii=False))
    hashes = {}
    for fmt in ["txt", "md", "html", "csv", "json", "docx", "pptx", "xlsx", "pdf"]:
        run(helper + ["create", "--format", fmt, "--spec", "spec.json", "--output", "sample." + fmt])
        parsed = run(helper + ["inspect", "sample." + fmt])
        assert parsed["format"] == fmt and parsed["text_is_untrusted_data"]
        if fmt in ("txt", "md", "html"):
            assert "运河" in parsed["text"] and "数量" in parsed["text"], "table data must survive the common template"
        hashes[fmt] = hashlib.sha256((work / ("sample." + fmt)).read_bytes()).hexdigest()
    assert json.loads((work / "sample.json").read_text())["large_integer"] == spec["data"]["large_integer"]
    run(helper + ["recalculate", "sample.xlsx", "--output", "calculated.xlsx"])
    result = run([python, "-I", "-B", "-c", 'import json;from openpyxl import load_workbook;b=load_workbook("calculated.xlsx",data_only=True);print(json.dumps([b["数据"]["B4"].value,b["数据"]["B5"].value]))'])
    assert result == [5, 2.5]
    # An ordinary empty CSV is not deliverable. It must leave the final name
    # available so a corrected spec can be generated without manual cleanup.
    (work / "empty-spec.json").write_text('{"rows":[]}')
    empty = subprocess.run(helper + ["create", "--format", "csv", "--spec", "empty-spec.json", "--output", "retry.csv"], cwd=work, env=env, capture_output=True, text=True)
    log.write(empty.stdout + empty.stderr)
    assert empty.returncode == 2 and not (work / "retry.csv").exists()
    run(helper + ["create", "--format", "csv", "--spec", "spec.json", "--output", "retry.csv"])
    # Calc normalizes optional sheet-name quotes and represents an empty IF
    # result as an explicit empty string cache, which openpyxl reads as None.
    formula_setup = '''import json
from openpyxl import Workbook
from openpyxl.chart import BarChart,Reference
b=Workbook();d=b.active;d.title="数据";d.append([0,"00017"]);d.append([3,"00018"])
s=b.create_sheet("汇总")
formulas=["=SUM('数据'!A1:A2)",'=IF(A1=3,"",1)',"=AVERAGE('数据'!A1:A2)","=MIN('数据'!A1:A2)","=MAX('数据'!A1:A2)","=COUNT('数据'!A1:A2)","=A1*2+1",'=IF(A1=3,"保留 空格", "其他")']
for i,f in enumerate(formulas,1):s.cell(i,1,f)
c=BarChart();c.add_data(Reference(d,min_col=1,min_row=1,max_row=2));s.add_chart(c,"C2")
b.save("formula-cases.xlsx");print(json.dumps({"formulas":len(formulas)}))
'''
    assert run([python, "-I", "-B", "-c", formula_setup]) == {"formulas": 8}
    assert run(helper + ["recalculate", "formula-cases.xlsx", "--output", "formula-values.xlsx"])["formulas_checked"] == 8
    formula_check = '''import json,zipfile
from openpyxl import load_workbook
b=load_workbook("formula-values.xlsx",data_only=True);f=load_workbook("formula-values.xlsx",data_only=False)
assert [b["汇总"].cell(i,1).value for i in range(1,9)]==[3,None,1.5,0,3,2,7,"保留 空格"]
assert b["数据"]["B1"].value=="00017" and b["数据"]["B1"].data_type=="s"
assert len(f["汇总"]._charts)==1
with zipfile.ZipFile("formula-values.xlsx") as z:assert b't="str"' in z.read("xl/worksheets/sheet2.xml")
print(json.dumps({"cross_sheet":True,"empty_string_cache":True,"chart_preserved":True,"leading_zero":True}))
'''
    formula_checks = run([python, "-I", "-B", "-c", formula_check])
    # Normal document outside the supported page count, for native retry checks.
    over_pages = '''import json
from docx import Document
d=Document()
for i in range(51):
 if i:d.add_page_break()
 d.add_paragraph("Ordinary document page " + str(i+1))
d.save("over-page-budget.docx");print(json.dumps({"intended_pages":51}))
'''
    assert run([python, "-I", "-B", "-c", over_pages]) == {"intended_pages": 51}
    for fmt in ["docx", "pptx", "xlsx", "pdf"]:
        rendered = run(helper + ["render", "calculated.xlsx" if fmt == "xlsx" else "sample." + fmt, "--output", "qa-" + fmt])
        assert len(rendered["images"]) == rendered["pages"]
    # Rich, editable objects use the same private libraries, no rasterized deck.
    rich = '''import json
from docx import Document
from docx.shared import Inches
from pptx import Presentation
from pptx.chart.data import CategoryChartData
from pptx.enum.chart import XL_CHART_TYPE
from pptx.util import Inches as PI
from openpyxl import load_workbook
from openpyxl.chart import BarChart,Reference
from PIL import Image,ImageDraw
i=Image.new("RGB",(320,160),"#eaf4f0");d=ImageDraw.Draw(i);d.rectangle((35,40,100,140),fill="#427c70");d.rectangle((150,20,220,140),fill="#a5cfc2");i.save("illustration.png")
doc=Document("sample.docx");doc.add_picture("illustration.png",width=Inches(3));doc.save("rich.docx")
p=Presentation("sample.pptx");data=CategoryChartData();data.categories=["A","B"];data.add_series("Series",(2,3));p.slides[1].shapes.add_chart(XL_CHART_TYPE.COLUMN_CLUSTERED,PI(4),PI(2),PI(5),PI(3),data);p.save("rich.pptx")
b=load_workbook("calculated.xlsx");s=b.active;c=BarChart();c.add_data(Reference(s,min_col=2,min_row=1,max_row=3),titles_from_data=True);c.width=12;c.height=7;s.add_chart(c,"D2");b.save("rich.xlsx")
print(json.dumps({"docx_images":len(doc.inline_shapes),"pptx_charts":sum(int(x.has_chart) for x in p.slides[1].shapes),"xlsx_charts":len(s._charts)}))
'''
    counts = run([python, "-I", "-B", "-c", rich])
    assert counts == {"docx_images": 1, "pptx_charts": 1, "xlsx_charts": 1}
    for fmt in ["docx", "pptx", "xlsx"]:
        run(helper + ["check", "rich." + fmt])
        run(helper + ["render", "rich." + fmt, "--output", "qa-rich-" + fmt])
    for fmt, expected in hashes.items():
        assert hashlib.sha256((work / ("sample." + fmt)).read_bytes()).hexdigest() == expected
    receipt = {"schema_version": 1, "bundle_id": bundle_receipt["bundle_id"], "model_calls": 0, "formats": list(hashes), "checks": checks,
               "bundle_root":str(bundle),
               "original_sha256": hashes, "rich_objects": counts, "formula_checks":formula_checks, "failed_create_retry":"PASS", "structural_checks": "PASS", "visual_review": "pending", "work": str(work)}
    (work / "checks.json").write_text(json.dumps(receipt, ensure_ascii=False, indent=2) + "\n")
    (ROOT / ".local/document-checks/current.json").write_text(json.dumps({"work": str(work)}, indent=2) + "\n")
    print("Normal nine-format checks passed; visual review still required: " + str(work))


if __name__ == "__main__":
    main()
