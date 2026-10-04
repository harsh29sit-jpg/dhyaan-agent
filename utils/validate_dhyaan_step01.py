"""Read-only checks for Dhyaan STEP-01 evidence; no provider calls or secrets."""
from pathlib import Path
import json
import re
from urllib.parse import unquote

ROOT = Path(__file__).resolve().parents[1]
PLAN = ROOT / "kavia-docs/CodeWiki/Artifacts/Plans/dhyaan-mcp-implementation-plan.md"
errors = []
warnings = []
checks = 0


def check(condition, label):
    global checks
    checks += 1
    if not condition:
        errors.append(label)


text = PLAN.read_text(encoding="utf-8")
parts = text.split("---", 2)
check(len(parts) == 3, "YAML front matter delimiters")
front = parts[1]
body = parts[2]
check("plan_id: PLAN-DHYAAN-MCP-001" in front, "Stable plan ID")
check(re.search(r"^status: in_progress$", front, re.M), "Plan remains in progress")
check("approved_revision: 1" in front, "Approved revision")
check("approval:\n  state: approved" in front, "Approval state")
check("execution:\n  state: blocked\n  executing_revision: 1" in front,
      "Blocked execution metadata")
step_blocks = re.findall(
    r"^  - id: (STEP-\d+)\n(.*?)(?=^  - id: STEP-|^revision_history:)",
    front, re.M | re.S
)
statuses = {
    step: re.search(r"^    status: (\w+)$", block, re.M).group(1)
    for step, block in step_blocks
}
check(statuses == {
    "STEP-01": "failed", "STEP-02": "to_do",
    "STEP-03": "to_do", "STEP-04": "to_do"
}, "Only STEP-01 executed")
step01 = body.split("### STEP-01", 1)[1].split("### STEP-02", 1)[0]
check("❌ Status: failed" in step01, "Visible STEP-01 status")
check("- [x] Record each service state and owner" in step01,
      "Service register tracker checked")
check("- [ ] Obtain exact official Delhivery" in step01,
      "Missing Delhivery tracker unchecked")
check("- [ ] Execute provider authentication smoke checks" in step01,
      "Blocked live tracker unchecked")
check("Instructions for future agent" in step01,
      "Explicit blocked continuation")
records = body.split("## Execution record", 1)[1].split("## References", 1)[0]
dated_rows = re.findall(r"^\| \d{4}-\d{2}-\d{2} \|", records, re.M)
check(1 <= len(dated_rows) <= 3, "At most three execution entries")

fixtures = ROOT / "dhyaan_mcp/contracts/provider-fixtures"
for name in ("gnani-stt.json", "gnani-tts.json"):
    data = json.loads((fixtures / name).read_text(encoding="utf-8"))
    check(data["provenance"]["kind"] == "official_documentation_example",
          f"{name}: documentation provenance")
    check(data["provenance"]["live_verified"] is False,
          f"{name}: not claimed live")
    check(data["provenance"]["source_url"].startswith("https://docs.gnani.ai/"),
          f"{name}: official source")
stt = json.loads((fixtures / "gnani-stt.json").read_text(encoding="utf-8"))
check(stt["request_contract"]["maximum_duration_seconds"] == 60,
      "STT duration bound")
check("confidence" not in stt["responses"][0]["body"],
      "No fabricated STT confidence")
tts = json.loads((fixtures / "gnani-tts.json").read_text(encoding="utf-8"))
check(tts["success_response_contract"]["body_kind"] == "raw_binary_audio",
      "TTS binary response")
check(tts["success_response_contract"]["body_stored"] is False,
      "No binary audio stored")
check(tts["request"]["body"]["language"] == "hi-IN", "TTS provider language field")

docs = [
    PLAN,
    ROOT / "kavia-docs/CodeWiki/index.md",
    ROOT / "kavia-docs/CodeWiki/Artifacts/index.md",
    ROOT / "kavia-docs/CodeWiki/Artifacts/Plans/index.md",
    ROOT / "dhyaan_mcp/docs/service-setup.md",
    ROOT / "dhyaan_mcp/docs/platform-notes.md",
    fixtures / "README.md",
]
for path in docs:
    if not path.exists():
        check(False, f"Not shell-materialized: {path.relative_to(ROOT)}")
        continue
    content = path.read_text(encoding="utf-8")
    if "kavia-docs" in path.parts:
        markdown_body = content.split("---", 2)[2].lstrip() if content.startswith("---") else content
        check(markdown_body.startswith("[CodeWiki]("), f"{path.name}: breadcrumb")
    for target in re.findall(r"\[[^\]]+\]\(((?:[^()]|\([^()]*\))+)\)", content):
        if target.startswith(("https://", "http://", "#", "mailto:")):
            continue
        resolved = path.parent / unquote(target.split("#", 1)[0])
        if not resolved.exists() and target.endswith("attachments/PRD_1.md"):
            warnings.append("PRD_1.md is attachment-reader evidence, not a materialized local file.")
        else:
            check(resolved.exists(), f"Broken local link: {path.relative_to(ROOT)} -> {target}")

setup = (ROOT / "dhyaan_mcp/docs/service-setup.md").read_text(encoding="utf-8")
register = setup.split("## Configuration and verification register", 1)[1].split(
    "## Callback and webhook paths", 1)[0]
rows = [line for line in register.splitlines() if "| missing |" in line]
check(len(rows) == 10, "Ten truthful missing-service rows")
check(all("BLOCKED:" in row for row in rows), "Every service smoke outcome blocked")
check("BLOCKED" in setup and "not executed" in setup, "No live checks claimed passed")

for warning in sorted(set(warnings)):
    print(f"WARNING: {warning}")
for error in errors:
    print(f"FAIL: {error}")
print(f"{'PASS' if not errors else 'FAIL'}: {checks} checks; {len(errors)} errors.")
raise SystemExit(1 if errors else 0)
