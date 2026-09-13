"""Create the searchable quality-spec PDF used by the hosted extraction demo."""

from pathlib import Path
import sys

from reportlab.lib import colors
from reportlab.lib.enums import TA_CENTER
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import mm
from reportlab.platypus import KeepTogether, PageBreak, Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle


OUTPUT = Path(sys.argv[1]) if len(sys.argv) > 1 else Path("output/pdf/factory-quality-spec-example.pdf")
OUTPUT.parent.mkdir(parents=True, exist_ok=True)

NAVY = colors.HexColor("#18344F")
BLUE = colors.HexColor("#2E628F")
PALE_BLUE = colors.HexColor("#EDF4F9")
INK = colors.HexColor("#283643")
MUTED = colors.HexColor("#657483")
LINE = colors.HexColor("#D8E0E7")
PALE_AMBER = colors.HexColor("#FFF6E5")
AMBER = colors.HexColor("#8A5A12")

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
    canvas.drawString(18 * mm, height - 6.5 * mm, "NORTHSTAR ASSEMBLY SYSTEMS")
    canvas.setFont("Helvetica", 8)
    canvas.drawRightString(width - 18 * mm, height - 6.5 * mm, "CONTROLLED QUALITY DOCUMENT")
    canvas.setStrokeColor(LINE)
    canvas.line(18 * mm, 14 * mm, width - 18 * mm, 14 * mm)
    canvas.setFillColor(MUTED)
    canvas.setFont("Helvetica", 7.5)
    canvas.drawString(18 * mm, 9.5 * mm, "QSP-CV-001  |  Revision 1.0  |  Training / portfolio example")
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
    title="Packaging Line Camera Quality Specification",
    author="Visual Inspection Studio",
    subject="Searchable example specification for structured inspection-rule extraction",
)

story = [
    Spacer(1, 3 * mm),
    Paragraph("Packaging Line Camera<br/>Quality Specification", styles["DocTitle"]),
    Paragraph("Example specification for automated visual inspection and human review routing", styles["Subtitle"]),
    Table(
        [
            ["Document", "QSP-CV-001", "Revision", "1.0"],
            ["Owner", "Quality Engineering", "Effective", "13 September 2026"],
            ["Applies to", "Restricted packaging-line camera", "Status", "Example / not production"],
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
    Paragraph("1. Purpose and scope", styles["Section"]),
    Paragraph(
        "This specification defines camera-visible acceptance rules for a restricted packaging-line inspection frame. "
        "The automated system may propose a disposition, but a quality engineer remains responsible for approving extracted rules and resolving review cases.",
        styles["Small"],
    ),
    Paragraph("2. Object and count requirements", styles["Section"]),
    rule("2.1", "Personnel exclusion", "Any person observed inside the restricted camera frame is a critical defect and the inspection result must be REJECT."),
    rule("2.2", "Foreign animal exclusion", "Any dog, cat, or bird visible in the restricted camera frame is a major foreign-object defect and the inspection result must be REJECT."),
    rule("2.3", "Maximum restricted-object count", "No more than two restricted objects (person, dog, cat, bird, car, bus, or truck) may be present in one image. Three or more restricted objects require REJECT."),
    rule("2.4", "Vehicle escalation", "Any car, bus, or truck detection requires HUMAN REVIEW before disposition."),
    Spacer(1, 4 * mm),
    Table(
        [[Paragraph("Important: rule extraction creates a draft only. No generated rule may become active until a quality engineer reviews its source evidence and explicitly approves it.", styles["Callout"])]],
        colWidths=[171 * mm],
        style=TableStyle([
            ("BACKGROUND", (0, 0), (-1, -1), PALE_AMBER),
            ("BOX", (0, 0), (-1, -1), 0.7, colors.HexColor("#E3C994")),
            ("LEFTPADDING", (0, 0), (-1, -1), 10),
            ("RIGHTPADDING", (0, 0), (-1, -1), 10),
            ("TOPPADDING", (0, 0), (-1, -1), 9),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 9),
        ]),
    ),
    PageBreak(),
    Spacer(1, 3 * mm),
    Paragraph("Confidence, measurement, and escalation", styles["DocTitle"]),
    Paragraph("Requirements that exceed detector capability must fail safely to human review", styles["Subtitle"]),
    Paragraph("3. Confidence handling", styles["Section"]),
    rule("3.1", "Unconfirmed findings", "Unconfirmed detector findings from 30 percent up to but below 65 percent confidence require HUMAN REVIEW. Findings below 30 percent may be ignored as insufficient evidence."),
    Paragraph("4. Requirements outside the current detector contract", styles["Section"]),
    rule("4.1", "Scratch measurement", "A surface scratch longer than 2 mm requires REJECT."),
    rule("4.2", "Missing component", "A missing soldered component requires REJECT."),
    Paragraph(
        "Requirements 4.1 and 4.2 are mandatory quality requirements, but this example does not define camera calibration, millimetre conversion, a scratch detector, a reference assembly, or component-presence logic. The inspection system must route these requirements to HUMAN REVIEW until the required sensing and detector capabilities are validated.",
        styles["Small"],
    ),
    Paragraph("5. Rule approval and decision authority", styles["Section"]),
    rule("5.1", "Approval gate", "LLM-extracted rules are candidates only and must not be activated automatically."),
    rule("5.2", "Decision authority", "The deterministic inspection engine applies approved rules to detector findings. The LLM must not make the final PASS, FAIL, or HUMAN REVIEW decision for an inspected image."),
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
