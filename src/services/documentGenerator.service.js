import PDFDocument from "pdfkit";
import { Document, Packer, Paragraph, TextRun, HeadingLevel, AlignmentType, BorderStyle } from "docx";
import { AppError } from "../lib/AppError.js";
import logger from "../logger/logger.js";

/**
 * Generates a premium ATS-friendly PDF from optimized resume JSON.
 */
export async function generatePdf(optimizedJson) {
  return new Promise((resolve, reject) => {
    try {
      const margin = 35;
      const doc = new PDFDocument({ margin, size: "A4", autoFirstPage: true });
      const buffers = [];
      doc.on("data", buffers.push.bind(buffers));
      doc.on("end", () => resolve(Buffer.concat(buffers)));
      doc.on("error", reject);

      const { contact = {}, summary = "", experience = [], projects = [], education = [], skills = {} } = optimizedJson;

      const primaryColor = "#111111"; // Almost black for sleek look
      const secondaryColor = "#333333";
      const accentColor = "#444444"; // Subdued accent
      const textColor = "#222222";
      
      const pageWidth = 595.28;
      const contentWidth = pageWidth - (margin * 2);

      const sanitizeText = (text) => {
        if (typeof text !== "string") return "";
        return text
          .replace(/[\u2018\u2019]/g, "'")
          .replace(/[\u201C\u201D]/g, '"')
          .replace(/[\u2013\u2014]/g, "-")
          .replace(/[\u2022\u25E6\u25A0]/g, "-")
          .replace(/->/g, "-")
          .replace(/[^\x20-\x7E\xA0-\xFF\n\r\t]/g, "");
      };

      // --- Helper to draw section header ---
      const drawSectionHeader = (title) => {
        doc.moveDown(0.3);
        doc.fontSize(11).font("Helvetica-Bold").fillColor(primaryColor).text(sanitizeText(title).toUpperCase(), margin, doc.y);
        const lineY = doc.y + 2;
        doc.moveTo(margin, lineY).lineTo(pageWidth - margin, lineY).lineWidth(1).strokeColor(primaryColor).stroke();
        doc.y = lineY + 4; // Move below the line
      };

      // --- Helper to draw a row with left and right text ---
      const drawSplitText = (leftText, rightText, leftFont = "Helvetica-Bold", rightFont = "Helvetica", size = 10) => {
        const startY = doc.y;
        if (rightText) {
          doc.fontSize(size).font(rightFont).fillColor(accentColor).text(sanitizeText(rightText), margin, startY, { align: "right", width: contentWidth, lineBreak: false });
        }
        doc.fontSize(size).font(leftFont).fillColor(primaryColor).text(sanitizeText(leftText), margin, startY, { width: contentWidth - 120 });
      };

      // -----------------------------------------------------
      // Header Section
      // -----------------------------------------------------
      doc.fontSize(18).font("Helvetica-Bold").fillColor(primaryColor).text(sanitizeText(contact.name || "Candidate"), { align: "center" });
      doc.moveDown(0.1);
      
      const contactInfo = [contact.email, contact.phone, contact.location, contact.linkedin, contact.github].map(sanitizeText).filter(Boolean).join("  |  ");
      doc.fontSize(9).font("Helvetica").fillColor(secondaryColor).text(contactInfo, { align: "center" });
      doc.moveDown(0.3);

      // -----------------------------------------------------
      // Professional Summary
      // -----------------------------------------------------
      if (summary) {
        drawSectionHeader("Professional Summary");
        doc.fontSize(9.5).font("Helvetica").fillColor(textColor).text(sanitizeText(summary), margin, doc.y, { align: "justify", lineGap: 1 });
      }

      // -----------------------------------------------------
      // Skills
      // -----------------------------------------------------
      if (skills && Object.keys(skills).length > 0) {
        drawSectionHeader("Technical Skills");
        
        for (const [category, skillList] of Object.entries(skills)) {
          if (Array.isArray(skillList) && skillList.length > 0) {
            doc.fontSize(9.5).font("Helvetica-Bold").fillColor(primaryColor).text(sanitizeText(`${category}: `), { continued: true });
            doc.font("Helvetica").fillColor(textColor).text(sanitizeText(skillList.join(", ")), { lineGap: 1 });
          }
        }
      }

      // -----------------------------------------------------
      // Work Experience
      // -----------------------------------------------------
      if (experience && experience.length > 0) {
        drawSectionHeader("Work Experience");
        
        experience.forEach((exp) => {
          const dates = [exp.startDate, exp.endDate].filter(Boolean).join(" - ");
          drawSplitText(exp.title || "", dates, "Helvetica-Bold", "Helvetica", 10);
          
          const compLoc = [exp.company, exp.location].filter(Boolean).join(", ");
          if (compLoc) {
            doc.fontSize(9.5).font("Helvetica-Oblique").fillColor(secondaryColor).text(sanitizeText(compLoc), margin, doc.y);
          }
          doc.moveDown(0.1);

          (exp.bullets || []).forEach((bullet) => {
            const y = doc.y;
            doc.fontSize(9.5).font("Helvetica").fillColor(textColor).text("-", margin, y, { lineBreak: false });
            doc.text(sanitizeText(bullet), margin + 12, y, { align: "justify", width: contentWidth - 12, lineGap: 1 });
          });
          doc.moveDown(0.2);
        });
      }

      // -----------------------------------------------------
      // Projects
      // -----------------------------------------------------
      if (projects && projects.length > 0) {
        drawSectionHeader("Projects");
        
        projects.forEach((proj) => {
          drawSplitText(proj.name || "", proj.date || "", "Helvetica-Bold", "Helvetica", 10);
          
          if (proj.techStack && proj.techStack.length > 0) {
            doc.fontSize(9.5).font("Helvetica-Oblique").fillColor(secondaryColor).text(sanitizeText(`Technologies: ${proj.techStack.join(", ")}`), margin, doc.y);
          }
          doc.moveDown(0.1);

          (proj.bullets || []).forEach((bullet) => {
            const y = doc.y;
            doc.fontSize(9.5).font("Helvetica").fillColor(textColor).text("-", margin, y, { lineBreak: false });
            doc.text(sanitizeText(bullet), margin + 12, y, { align: "justify", width: contentWidth - 12, lineGap: 1 });
          });
          doc.moveDown(0.2);
        });
      }

      // -----------------------------------------------------
      // Education
      // -----------------------------------------------------
      if (education && education.length > 0) {
        drawSectionHeader("Education");
        
        education.forEach((edu) => {
          const deg = [edu.degree, edu.field].filter(Boolean).join(" in ");
          const dates = [edu.startDate, edu.endDate].filter(Boolean).join(" - ");
          drawSplitText(deg || "Degree", dates, "Helvetica-Bold", "Helvetica", 10);
          
          const instLoc = [edu.institution, edu.location].filter(Boolean).join(", ");
          const gpa = edu.gpa ? `GPA: ${edu.gpa}` : "";
          if (instLoc || gpa) {
            drawSplitText(instLoc, gpa, "Helvetica-Oblique", "Helvetica", 9.5);
          }
          
          doc.moveDown(0.2);
        });
      }

      // -----------------------------------------------------
      // Certifications
      // -----------------------------------------------------
      if (optimizedJson.certifications && optimizedJson.certifications.length > 0) {
        drawSectionHeader("Certifications");
        
        optimizedJson.certifications.forEach((cert) => {
          const y = doc.y;
          doc.fontSize(9.5).font("Helvetica").fillColor(textColor).text("-", margin, y, { lineBreak: false });
          doc.text(sanitizeText(cert), margin + 12, y, { align: "left", width: contentWidth - 12, lineGap: 1 });
        });
      }

      doc.end();
    } catch (err) {
      logger.error("Failed to generate PDF", { error: err.message });
      reject(new AppError("Failed to generate PDF document", 500));
    }
  });
}

/**
 * Generates a premium ATS-friendly DOCX from optimized resume JSON.
 */
export async function generateDocx(optimizedJson) {
  try {
    const { contact = {}, summary = "", experience = [], projects = [], education = [], skills = {} } = optimizedJson;

    const sections = [];

    // Header
    sections.push(
      new Paragraph({
        text: contact.name || "Candidate",
        heading: HeadingLevel.HEADING_1,
        alignment: AlignmentType.CENTER,
      })
    );

    const contactInfo = [contact.email, contact.phone, contact.location, contact.linkedin, contact.github].filter(Boolean).join("  |  ");
    sections.push(
      new Paragraph({
        text: contactInfo,
        alignment: AlignmentType.CENTER,
        border: { bottom: { color: "2980B9", space: 10, style: BorderStyle.SINGLE, size: 12 } }
      })
    );
    sections.push(new Paragraph({ text: "" })); // spacing

    // Summary
    if (summary) {
      sections.push(new Paragraph({ text: "PROFESSIONAL SUMMARY", heading: HeadingLevel.HEADING_2 }));
      sections.push(new Paragraph({ text: summary, alignment: AlignmentType.JUSTIFIED }));
      sections.push(new Paragraph({ text: "" }));
    }

    // Skills
    if (skills && Object.keys(skills).length > 0) {
      sections.push(new Paragraph({ text: "TECHNICAL SKILLS", heading: HeadingLevel.HEADING_2 }));
      for (const [category, skillList] of Object.entries(skills)) {
        if (Array.isArray(skillList) && skillList.length > 0) {
          sections.push(
            new Paragraph({
              children: [
                new TextRun({ text: `${category}: `, bold: true }),
                new TextRun({ text: skillList.join(", ") }),
              ],
            })
          );
        }
      }
      sections.push(new Paragraph({ text: "" }));
    }

    // Experience
    if (experience && experience.length > 0) {
      sections.push(new Paragraph({ text: "WORK EXPERIENCE", heading: HeadingLevel.HEADING_2 }));
      experience.forEach((exp) => {
        const dates = [exp.startDate, exp.endDate].filter(Boolean).join(" - ");
        sections.push(
          new Paragraph({
            children: [
              new TextRun({ text: exp.title || "", bold: true }),
              new TextRun({ text: dates ? `   |   ${dates}` : "", color: "2980B9" }),
            ],
          })
        );
        const compLoc = [exp.company, exp.location].filter(Boolean).join(", ");
        if (compLoc) {
          sections.push(new Paragraph({ text: compLoc, italics: true }));
        }
        (exp.bullets || []).forEach((bullet) => {
          sections.push(new Paragraph({ text: bullet, bullet: { level: 0 }, alignment: AlignmentType.JUSTIFIED }));
        });
        sections.push(new Paragraph({ text: "" }));
      });
    }

    // Projects
    if (projects && projects.length > 0) {
      sections.push(new Paragraph({ text: "PROJECTS", heading: HeadingLevel.HEADING_2 }));
      projects.forEach((proj) => {
        sections.push(
          new Paragraph({
            children: [
              new TextRun({ text: proj.name || "", bold: true }),
              new TextRun({ text: proj.date ? `   |   ${proj.date}` : "", color: "2980B9" }),
            ],
          })
        );
        if (proj.techStack && proj.techStack.length > 0) {
           sections.push(new Paragraph({ text: `Technologies: ${proj.techStack.join(", ")}`, italics: true }));
        }
        (proj.bullets || []).forEach((bullet) => {
          sections.push(new Paragraph({ text: bullet, bullet: { level: 0 }, alignment: AlignmentType.JUSTIFIED }));
        });
        sections.push(new Paragraph({ text: "" }));
      });
    }

    // Education
    if (education && education.length > 0) {
      sections.push(new Paragraph({ text: "EDUCATION", heading: HeadingLevel.HEADING_2 }));
      education.forEach((edu) => {
        const deg = [edu.degree, edu.field].filter(Boolean).join(" in ");
        const dates = [edu.startDate, edu.endDate].filter(Boolean).join(" - ");
        sections.push(
          new Paragraph({
            children: [
               new TextRun({ text: deg || "Degree", bold: true }),
               new TextRun({ text: dates ? `   |   ${dates}` : "", color: "2980B9" }),
            ]
          })
        );
        const instLoc = [edu.institution, edu.location].filter(Boolean).join(", ");
        let instStr = instLoc;
        if (edu.gpa) instStr += `  |  GPA: ${edu.gpa}`;
        if (instStr) {
          sections.push(new Paragraph({ text: instStr, italics: true }));
        }
        sections.push(new Paragraph({ text: "" }));
      });
    }
    
    // Certifications
    if (optimizedJson.certifications && optimizedJson.certifications.length > 0) {
      sections.push(new Paragraph({ text: "CERTIFICATIONS", heading: HeadingLevel.HEADING_2 }));
      optimizedJson.certifications.forEach((cert) => {
         sections.push(new Paragraph({ text: cert, bullet: { level: 0 } }));
      });
    }

    const doc = new Document({
      sections: [
        {
          properties: {},
          children: sections,
        },
      ],
    });

    return await Packer.toBuffer(doc);
  } catch (err) {
    logger.error("Failed to generate DOCX", { error: err.message });
    throw new AppError("Failed to generate DOCX document", 500);
  }
}
