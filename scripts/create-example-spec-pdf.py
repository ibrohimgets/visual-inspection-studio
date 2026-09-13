"""Create the searchable PCB quality-spec PDF used by the public demo."""

from pathlib import Path
import sys

from reportlab.lib import colors
from reportlab.lib.enums import TA_CENTER
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import mm
from reportlab.platypus import KeepTogether, PageBreak, Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle


OUTPUT = Path(sys.argv[1]) if len(sys.argv) > 1 else Path("output/pdf/pcb-quality-spec-example.pdf")
OUTPUT.parent.mkdir(parents=True, exist_ok=True)

NAVY = colors.HexColor("#142D3F")
PALE_BLUE = colors.HexColor("#EDF4F7")
INK = colors.HexColor("#25343E")
MUTED = colors.HexColor("#657681")
LINE = colors.HexColor("#D6E0E5")
PALE_AMBER = colors.HexColor("#FFF5DF")
AMBER = colors.HexColor("#835611")
PALE_GREEN = colors.HexColor("#EDF6F1")

styles = getSampleStyleSheet()
styles.add(ParagraphStyle(name="DocTitle", parent=styles["Title"], fontName="Helvetica-Bold", fontSize=20,
                          leading=24, textColor=NAVY, spaceAfter=5))
styles.add(ParagraphStyle(name="Subtitle", parent=styles["Normal"], fontName="Helvetica", fontSize=9,
                          leading=13, textColor=MUTED, spaceAfter=12))
styles.add(ParagraphStyle(name="Section", parent=styles["Heading2"], fontName="Helvetica-Bold", fontSize=11,
                          leading=14, textColor=NAVY, spaceBefore=10, spaceAfter=6, keepWithNext=True))
styles.add(ParagraphStyle(name="Rule", parent=styles["BodyText"], fontName="Helvetica", fontSize=9.5,
                          leading=14, textColor=INK, leftIndent=7 * mm, firstLineIndent=-7 * mm, spaceAfter=7))
styles.add(ParagraphStyle(name="Small", parent=styles["BodyText"], fontName="Helvetica", fontSize=8.5,
                          leading=12, textColor=MUTED))
styles.add(ParagraphStyle(name="Callout", parent=styles["BodyText"], fontName="Helvetica-Bold", fontSize=9,
                          leading=13, textColor=AMBER, alignment=TA_CENTER))


def header_footer(canvas, doc):
    canvas.saveState()
    width, height = A4
    canvas.setFillColor(NAVY)
    canvas.rect(0, height - 10 * mm, width, 10 * mm, fill=1, stroke=0)
    canvas.setFillColor(colors.white)
    canvas.setFont("Helvetica-Bold", 8)
    canvas.drawString(18 * mm, height - 6.5 * mm, "NORTHSTAR ELECTRONICS")
    canvas.setFont("Helvetica", 8)
    canvas.drawRightString(width - 18 * mm, height - 6.5 * mm, "CONTROLLED QUALITY DOCUMENT")
    canvas.setStrokeColor(LINE)
    canvas.line(18 * mm, 14 * mm, width - 18 * mm, 14 * mm)
    canvas.setFillColor(MUTED)
    canvas.setFont("Helvetica", 7.5)
    canvas.drawString(18 * mm, 9.5 * mm, "QSP-PCB-017 | Revision 1.0 | Portfolio demonstration")
    canvas.drawRightString(width - 18 * mm, 9.5 * mm, f"Page {doc.page}")
    canvas.restoreState()


def rule(number, title, text):
    return Paragraph(f"<b>{number}. {title}</b><br/>{text}", styles["Rule"])


doc = SimpleDocTemplate(
    str(OUTPUT),
    pagesize=A4,
    rightMargin=18 * mm,
    leftMargin=18 * mm,
    topMargin=20 * mm,
    bottomMargin=20 * mm,
    title="PCB Camera Inspection Acceptance Specification",
    author="Visual Inspection Studio",
    subject="Searchable portfolio specification for structured PCB inspection-rule extraction",
)

story = [
    Spacer(1, 3 * mm),
    Paragraph("PCB Camera Inspection<br/>Acceptance Specification", styles["DocTitle"]),
    Paragraph("Example requirements for detector findings, deterministic disposition, and human review", styles["Subtitle"]),
    Table(
        [
            ["Document", "QSP-PCB-017", "Revision", "1.0"],
            ["Owner", "Quality Engineering", "Effective", "13 September 2026"],
            ["Applies to", "PCB optical inspection cell", "Status", "Example / not production"],
        ],
        colWidths=[24 * mm, 61 * mm, 24 * mm, 62 * mm],
        style=TableStyle([
            ("BACKGROUND", (0, 0), (-1, -1), PALE_BLUE),
            ("TEXTCOLOR", (0, 0), (-1, -1), INK),
            ("FONTNAME", (0, 0), (-1, -1), "Helvetica"),
            ("FONTNAME", (0, 0), (0, -1), "Helvetica-Bold"),
            ("FONTNAME", (2, 0), (2, -1), "Helvetica-Bold"),
            ("FONTSIZE", (0, 0), (-1, -1), 8),
            ("GRID", (0, 0), (-1, -1), 0.5, LINE),
            ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
            ("TOPPADDING", (0, 0), (-1, -1), 6),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
        ]),
    ),
    Paragraph("1. Purpose and decision authority", styles["Section"]),
    Paragraph(
        "This example defines image-level acceptance logic for a PCB optical inspection cell. The detector supplies candidate regions and confidence scores. The approved deterministic policy supplies the final PASS, FAIL, or HUMAN REVIEW disposition.",
        styles["Small"],
    ),
    rule("1.1", "Approval gate", "Rules extracted from this document are draft candidates only. A quality engineer must verify the cited source evidence and explicitly approve the complete policy before it can control an inspection."),
    Paragraph("2. Defect-class requirements", styles["Section"]),
    rule("2.1", "Critical circuit defects", "Any open-circuit (OP) or short-circuit (SH) finding is critical and must result in FAIL."),
    rule("2.2", "Conductor scratches", "A conductor-scratch (CS) finding requires HUMAN REVIEW before disposition."),
    rule("2.3", "Cosmetic spur allowance", "A spur (SP) finding is acceptable for this demonstration and may PASS when no higher-priority rule applies."),
    rule("2.4", "Maximum finding count", "More than two actionable PCB defect findings in one image must result in FAIL."),
    Spacer(1, 4 * mm),
    Table(
        [[Paragraph("This document is a portfolio example, not a factory acceptance standard. A client must replace these limits with validated production requirements.", styles["Callout"])]],
        colWidths=[171 * mm],
        style=TableStyle([
            ("BACKGROUND", (0, 0), (-1, -1), PALE_AMBER),
            ("BOX", (0, 0), (-1, -1), 0.7, colors.HexColor("#DFC58D")),
            ("LEFTPADDING", (0, 0), (-1, -1), 10),
            ("RIGHTPADDING", (0, 0), (-1, -1), 10),
            ("TOPPADDING", (0, 0), (-1, -1), 9),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 9),
        ]),
    ),
    PageBreak(),
    Spacer(1, 3 * mm),
    Paragraph("Confidence and capability controls", styles["DocTitle"]),
    Paragraph("Uncertain or unsupported requirements fail safely to human review", styles["Subtitle"]),
    Paragraph("3. Detector confidence", styles["Section"]),
    rule("3.1", "Unconfirmed findings", "Findings below 30 percent confidence may be ignored. Findings from 30 percent up to but below 70 percent confidence require HUMAN REVIEW."),
    Paragraph("4. Scope boundary", styles["Section"]),
    Paragraph(
        "Calibrated length measurements and missing-component checks are outside this example policy. A client deployment must add camera calibration, a reference assembly, and validated detector capabilities before those requirements can be automated. Any future requirement that the active detector or rule engine cannot evaluate must produce HUMAN REVIEW rather than an automatic PASS or FAIL.",
        styles["Small"],
    ),
    Spacer(1, 6 * mm),
    Table(
        [["Disposition", "Meaning", "Required action"],
         ["PASS", "No fail or review rule triggered", "Release under approved process"],
         ["FAIL", "One or more fail rules triggered", "Reject and record decisive evidence"],
         ["HUMAN REVIEW", "Uncertain or unsupported requirement", "Quality engineer resolves disposition"]],
        colWidths=[30 * mm, 69 * mm, 72 * mm],
        style=TableStyle([
            ("BACKGROUND", (0, 0), (-1, 0), NAVY),
            ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
            ("BACKGROUND", (0, 1), (-1, -1), PALE_GREEN),
            ("TEXTCOLOR", (0, 1), (-1, -1), INK),
            ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
            ("FONTNAME", (0, 1), (0, -1), "Helvetica-Bold"),
            ("FONTNAME", (1, 1), (-1, -1), "Helvetica"),
            ("FONTSIZE", (0, 0), (-1, -1), 8),
            ("GRID", (0, 0), (-1, -1), 0.5, LINE),
            ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
            ("TOPPADDING", (0, 0), (-1, -1), 7),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 7),
        ]),
    ),
    Spacer(1, 7 * mm),
    KeepTogether([
        Paragraph("Approval record", styles["Section"]),
        Table(
            [["Quality engineer", "____________________________"], ["Approval date", "____________________________"], ["Approved policy version", "____________________________"]],
            colWidths=[45 * mm, 126 * mm],
            style=TableStyle([
                ("GRID", (0, 0), (-1, -1), 0.5, LINE),
                ("BACKGROUND", (0, 0), (0, -1), PALE_BLUE),
                ("FONTNAME", (0, 0), (0, -1), "Helvetica-Bold"),
                ("FONTNAME", (1, 0), (1, -1), "Helvetica"),
                ("FONTSIZE", (0, 0), (-1, -1), 8.5),
                ("TEXTCOLOR", (0, 0), (-1, -1), INK),
                ("TOPPADDING", (0, 0), (-1, -1), 7),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 7),
            ]),
        ),
    ]),
]

doc.build(story, onFirstPage=header_footer, onLaterPages=header_footer)
print(OUTPUT.resolve())
